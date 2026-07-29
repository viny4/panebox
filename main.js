'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  session,
  shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

const { createStore } = require('./lib/store');
const { isAuthUrl } = require('./lib/urls');
const { isNewer, parseRepo } = require('./lib/version');

const WEBVIEW_PRELOAD = path.join(__dirname, 'webview-preload.js');
const ASSETS = path.join(__dirname, 'assets');

// A modern desktop Chrome UA. Several services (Slack, WhatsApp, Teams) gate
// features on this and will show a "browser not supported" wall otherwise.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Must run before anything reads the name or userData path. When running from
// source the macOS Dock still shows "Electron" — that label comes from the
// Electron binary's own bundle, and only a packaged build can change it.
app.setName('Panebox');

/**
 * Names this app shipped under before settling on Panebox, newest first.
 *
 * Electron derives userData from the app name, so a rename would otherwise
 * silently orphan every service and every saved login. We copy the whole
 * directory across — including the session partitions, which is where the
 * logins actually live — from the most recent previous name that has data.
 */
const PREVIOUS_APP_NAMES = ['Sidenest', 'OmniDeck'];

function migrateFromPreviousName() {
  const current = app.getPath('userData');
  if (fs.existsSync(path.join(current, 'config.json'))) return; // already set up

  for (const name of PREVIOUS_APP_NAMES) {
    const previous = path.join(path.dirname(current), name);
    if (previous === current) continue;
    if (!fs.existsSync(path.join(previous, 'config.json'))) continue;

    try {
      fs.mkdirSync(current, { recursive: true });
      fs.cpSync(previous, current, { recursive: true, force: false, errorOnExist: false });
      console.log(`Migrated settings and logins from ${previous}`);
    } catch (err) {
      // Losing the old config is survivable; failing to boot is not.
      console.error(`Could not migrate from ${previous}:`, err.message);
    }
    return; // newest match wins
  }
}

migrateFromPreviousName();

const store = createStore(path.join(app.getPath('userData'), 'config.json'));

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------- utilities

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ------------------------------------------------------------------ session

/**
 * Applied to every session, including the per-app persistent partitions that
 * Electron creates lazily as webviews attach.
 */
function applySessionDefaults(sess) {
  sess.setUserAgent(USER_AGENT);

  // macOS uses the OS-provided spellchecker and ignores this call.
  if (process.platform !== 'darwin') {
    const languages = store.get('settings.spellcheckLanguages') || ['en-US'];
    const available = new Set(sess.availableSpellCheckerLanguages);
    const supported = languages.filter((l) => available.has(l));
    if (supported.length) sess.setSpellCheckerLanguages(supported);
  }

  // Only grant what a web-app container legitimately needs. Everything else
  // (geolocation, MIDI, serial, HID…) is denied rather than silently allowed.
  const ALLOWED = new Set([
    'notifications',
    'media',
    'mediaKeySystem',
    'fullscreen',
    'pointerLock',
    'clipboard-sanitized-write',
    'display-capture',
    'background-sync',
    'idle-detection',
  ]);
  sess.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED.has(permission));
  });
  sess.setPermissionCheckHandler((_contents, permission) => ALLOWED.has(permission));

  // Screen/window sharing for Meet, Teams, Zoom, Discord…
  sess.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      const choice = await pickScreenSource(
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
        })),
      );
      const picked = sources.find((s) => s.id === choice);
      if (!picked) return callback(); // user cancelled -> deny
      // Loopback audio capture is Windows-only.
      callback(
        process.platform === 'win32'
          ? { video: picked, audio: 'loopback' }
          : { video: picked },
      );
    } catch (err) {
      console.error('display media request failed', err);
      callback();
    }
  });
}

/** Round-trips to the renderer to show the source picker UI. */
const pendingSourcePicks = new Map();
let sourcePickSeq = 0;

function pickScreenSource(sources) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  showWindow();
  const id = ++sourcePickSeq;
  return new Promise((resolve) => {
    pendingSourcePicks.set(id, resolve);
    send('pb:pick-screen-source', { id, sources });
    // Don't leak the promise if the window dies mid-pick.
    setTimeout(() => {
      if (pendingSourcePicks.delete(id)) resolve(null);
    }, 120000);
  });
}

ipcMain.on('pb:screen-source-picked', (_e, { id, sourceId }) => {
  const resolve = pendingSourcePicks.get(id);
  if (resolve) {
    pendingSourcePicks.delete(id);
    resolve(sourceId);
  }
});

// ------------------------------------------------------------- context menu

function buildContextMenu(contents, params) {
  const menu = new Menu();

  for (const suggestion of params.dictionarySuggestions) {
    menu.append(
      new MenuItem({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion),
      }),
    );
  }
  if (params.dictionarySuggestions.length) menu.append(new MenuItem({ type: 'separator' }));

  if (params.misspelledWord) {
    menu.append(
      new MenuItem({
        label: 'Add to Dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }),
    );
    menu.append(new MenuItem({ type: 'separator' }));
  }

  if (params.linkURL) {
    menu.append(
      new MenuItem({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL),
      }),
    );
    menu.append(
      new MenuItem({
        label: 'Copy Link Address',
        click: () => require('electron').clipboard.writeText(params.linkURL),
      }),
    );
    menu.append(new MenuItem({ type: 'separator' }));
  }

  if (params.hasImageContents) {
    menu.append(
      new MenuItem({
        label: 'Copy Image',
        click: () => contents.copyImageAt(params.x, params.y),
      }),
    );
    menu.append(new MenuItem({ type: 'separator' }));
  }

  const canEdit = params.isEditable;
  menu.append(new MenuItem({ label: 'Undo', role: 'undo', enabled: canEdit }));
  menu.append(new MenuItem({ label: 'Redo', role: 'redo', enabled: canEdit }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: canEdit && !!params.selectionText }));
  menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: !!params.selectionText }));
  menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: canEdit }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(
    new MenuItem({ label: 'Reload', click: () => contents.reload() }),
  );
  menu.append(
    new MenuItem({
      label: 'Toggle Developer Tools',
      click: () => contents.toggleDevTools(),
    }),
  );

  return menu;
}

// ------------------------------------------------------------------- window

function createWindow() {
  const bounds = store.get('window') || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1300,
    height: bounds.height || 850,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    title: store.get('settings.windowTitle') || 'Panebox',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#09090d' : '#f5f5f7',
    icon: process.platform === 'linux' ? path.join(ASSETS, 'icon-256.png') : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    if (!store.get('settings.startMinimized')) mainWindow.show();
    if (store.get('settings.alwaysOnTop')) mainWindow.setAlwaysOnTop(true);
  });

  // Nothing should ever navigate the shell window itself away from index.html.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Force-harden every webview regardless of what the renderer asked for.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = WEBVIEW_PRELOAD;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
    delete webPreferences.preloadURL;
  });

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    store.set('window', mainWindow.getNormalBounds());
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);

  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('settings.closeToTray')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --------------------------------------------------------------------- tray

function trayImage() {
  const file =
    process.platform === 'darwin'
      ? path.join(ASSETS, 'trayTemplate.png')
      : path.join(ASSETS, 'tray-light.png');
  const image = nativeImage.createFromPath(file);
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function refreshTrayMenu() {
  if (!tray) return;
  const dnd = !!store.get('settings.dnd');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Panebox', click: showWindow },
      { type: 'separator' },
      {
        label: 'Do Not Disturb',
        type: 'checkbox',
        checked: dnd,
        click: (item) => {
          store.set('settings.dnd', item.checked);
          send('pb:settings-changed', store.get('settings'));
          refreshTrayMenu();
        },
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: !!store.get('settings.alwaysOnTop'),
        click: (item) => {
          store.set('settings.alwaysOnTop', item.checked);
          if (mainWindow) mainWindow.setAlwaysOnTop(item.checked);
          refreshTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.setToolTip(dnd ? 'Panebox — Do Not Disturb' : 'Panebox');
}

function createTray() {
  tray = new Tray(trayImage());
  refreshTrayMenu();
  tray.on('click', () => {
    if (process.platform === 'darwin') return; // macOS opens the menu instead
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
    else showWindow();
  });
}

// --------------------------------------------------------------- app menu

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('pb:open-settings') },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              {
                label: 'Quit',
                accelerator: 'Cmd+Q',
                click: () => {
                  isQuitting = true;
                  app.quit();
                },
              },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Service…', accelerator: 'CmdOrCtrl+N', click: () => send('pb:open-add') },
        { type: 'separator' },
        { label: 'Export Configuration…', click: () => exportConfig() },
        { label: 'Import Configuration…', click: () => importConfig() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => send('pb:open-find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Service', accelerator: 'CmdOrCtrl+R', click: () => send('pb:reload-active') },
        { label: 'Next Service', accelerator: 'CmdOrCtrl+Tab', click: () => send('pb:cycle', 1) },
        { label: 'Previous Service', accelerator: 'CmdOrCtrl+Shift+Tab', click: () => send('pb:cycle', -1) },
        { type: 'separator' },
        { label: 'Toggle Todo Panel', accelerator: 'CmdOrCtrl+T', click: () => send('pb:toggle-todo') },
        { label: 'Task Manager', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('pb:open-taskmanager') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [])],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/viny4/panebox'),
        },
        {
          label: 'Check for Updates…',
          click: async () => {
            const result = await checkForUpdates({ manual: true });
            if (result.status !== 'available') send('pb:update-result', result);
          },
        },
        { type: 'separator' },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/viny4/panebox/issues'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------- import / export

async function exportConfig() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Panebox Configuration',
    defaultPath: 'panebox-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, JSON.stringify(store.all(), null, 2), 'utf8');
  return { ok: true, filePath };
}

async function importConfig() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Panebox Configuration',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const incoming = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!incoming || !Array.isArray(incoming.apps)) throw new Error('Not an Panebox config file');
    store.replace(incoming);
    send('pb:config-replaced', store.all());
    return { ok: true };
  } catch (err) {
    dialog.showErrorBox('Import failed', String(err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
}

// ---------------------------------------------------------------------- IPC

ipcMain.handle('pb:config:get', () => store.all());
ipcMain.handle('pb:config:set', (_e, patch) => {
  store.merge(patch);
  return store.all();
});
ipcMain.handle('pb:config:setKey', (_e, { key, value }) => {
  store.set(key, value);
  if (key === 'settings.dnd' || key === 'settings.alwaysOnTop') refreshTrayMenu();
  return store.all();
});
ipcMain.handle('pb:config:export', () => exportConfig());
ipcMain.handle('pb:config:import', () => importConfig());

ipcMain.handle('pb:notify', (_e, { appId, notifId, appName, title, body, silent }) => {
  if (store.get('settings.dnd')) return false;
  if (!Notification.isSupported()) return false;

  const privacy = !!store.get('settings.notificationPrivacy');
  const notification = new Notification({
    title: privacy ? appName || 'Panebox' : title || appName || 'Panebox',
    body: privacy ? 'New message' : body || '',
    silent: !!silent,
    icon: process.platform === 'linux' ? path.join(ASSETS, 'icon-256.png') : undefined,
  });
  notification.on('click', () => {
    showWindow();
    send('pb:activate-app', { appId, notifId });
  });
  notification.show();
  return true;
});

ipcMain.handle('pb:badge:set', (_e, count) => {
  const total = Number(count) || 0;
  if (process.platform === 'darwin') {
    app.dock.setBadge(total > 0 ? String(total) : '');
  } else if (typeof app.setBadgeCount === 'function') {
    app.setBadgeCount(total);
  }
  if (tray) tray.setToolTip(total > 0 ? `Panebox — ${total} unread` : 'Panebox');
  return true;
});

ipcMain.handle('pb:window:setAlwaysOnTop', (_e, value) => {
  store.set('settings.alwaysOnTop', !!value);
  if (mainWindow) mainWindow.setAlwaysOnTop(!!value);
  refreshTrayMenu();
  return true;
});

ipcMain.handle('pb:window:setTitle', (_e, title) => {
  const next = String(title || 'Panebox').slice(0, 120);
  store.set('settings.windowTitle', next);
  if (mainWindow) mainWindow.setTitle(next);
  return next;
});

ipcMain.handle('pb:theme:set', (_e, theme) => {
  const next = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
  nativeTheme.themeSource = next;
  store.set('settings.theme', next);
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('pb:theme:isDark', () => nativeTheme.shouldUseDarkColors);

/** Per-service CPU/memory, keyed by the webContents ids the renderer holds. */
ipcMain.handle('pb:metrics', (_e, entries) => {
  const { webContents } = require('electron');
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));

  return (entries || []).map(({ appId, webContentsId }) => {
    let pid = null;
    try {
      const wc = webContents.fromId(webContentsId);
      pid = wc && !wc.isDestroyed() ? wc.getOSProcessId() : null;
    } catch {
      pid = null;
    }
    const m = pid != null ? byPid.get(pid) : null;
    return {
      appId,
      pid,
      cpu: m ? Number(m.cpu.percentCPUUsage.toFixed(1)) : null,
      memoryMB: m ? Math.round(m.memory.workingSetSize / 1024) : null,
    };
  });
});

ipcMain.handle('pb:session:clear', async (_e, partition) => {
  const sess = session.fromPartition(partition);
  await sess.clearStorageData();
  await sess.clearCache();
  return true;
});

ipcMain.handle('pb:spellcheck:languages', () => {
  if (process.platform === 'darwin') return { managedByOS: true, available: [], selected: [] };
  const sess = session.defaultSession;
  return {
    managedByOS: false,
    available: sess.availableSpellCheckerLanguages,
    selected: store.get('settings.spellcheckLanguages') || ['en-US'],
  };
});

ipcMain.handle('pb:spellcheck:set', (_e, languages) => {
  store.set('settings.spellcheckLanguages', languages);
  // Re-apply to every live session so it takes effect without a restart.
  for (const app_ of store.get('apps') || []) {
    try {
      applySessionDefaults(session.fromPartition(partitionFor(app_)));
    } catch {
      /* session may not exist yet */
    }
  }
  return true;
});

// ------------------------------------------------------------ update check

/**
 * Asks GitHub whether a newer release exists.
 *
 * Deliberately *not* an auto-updater: on macOS, Squirrel refuses to install an
 * update unless the app is code-signed, and these builds aren't. Rather than
 * ship something that silently works on two platforms and fails on the third,
 * we just tell the user and open the release page.
 *
 * This is the only network request Panebox makes on its own behalf. It sends no
 * identifiers — GitHub sees an anonymous GET — and it can be turned off in
 * Settings.
 */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let updateTimer = null;

/**
 * Whether this build can download and install updates by itself.
 *
 * Squirrel.Mac refuses to apply an update unless the app carries a valid
 * Developer ID signature, and our macOS builds are unsigned. Windows (NSIS) and
 * Linux (AppImage) have no such requirement, so they get the full VS Code-style
 * experience: silent download, then "Restart to update".
 *
 * macOS falls back to notify-and-open. If you obtain an Apple Developer ID and
 * sign the build, flip MAC_BUILD_IS_SIGNED to true and macOS joins in with no
 * other change.
 */
const MAC_BUILD_IS_SIGNED = false;
const canAutoInstall = () =>
  app.isPackaged && (process.platform !== 'darwin' || MAC_BUILD_IS_SIGNED);

let updaterWired = false;
let downloadedUpdate = null;

function wireAutoUpdater() {
  if (updaterWired) return;
  updaterWired = true;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    send('pb:update-status', { phase: 'downloading', latest: info.version, current: app.getVersion() });
  });
  autoUpdater.on('download-progress', (p) => {
    send('pb:update-status', { phase: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadedUpdate = info;
    send('pb:update-status', { phase: 'ready', latest: info.version, current: app.getVersion() });
  });
  autoUpdater.on('error', (err) => {
    // Offline, rate-limited, or no release yet — never interrupt the user.
    console.error('update error:', err && err.message);
    send('pb:update-status', { phase: 'error', error: String((err && err.message) || err) });
  });

  return autoUpdater;
}

ipcMain.handle('pb:updates:install', () => {
  if (!downloadedUpdate) return false;
  isQuitting = true;
  require('electron-updater').autoUpdater.quitAndInstall();
  return true;
});

function repoInfo() {
  try {
    return parseRepo(require('./package.json').repository?.url);
  } catch {
    return null;
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (!manual && store.get('settings.checkForUpdates') === false) {
    return { status: 'disabled' };
  }

  const repo = repoInfo();
  if (!repo) {
    // Placeholder repository — nothing to check against yet.
    return { status: 'unconfigured' };
  }

  // Packaged Windows/Linux builds hand off to electron-updater, which downloads
  // and installs in the background. Everything else falls through to the
  // notify-and-open path below.
  if (canAutoInstall()) {
    try {
      const autoUpdater = wireAutoUpdater() || require('electron-updater').autoUpdater;
      const result = await autoUpdater.checkForUpdates();
      const latest = result && result.updateInfo && result.updateInfo.version;
      if (latest && isNewer(latest, app.getVersion())) {
        return { status: 'downloading', current: app.getVersion(), latest };
      }
      return { status: 'current', current: app.getVersion(), latest: latest || app.getVersion() };
    } catch (err) {
      return { status: 'error', error: String((err && err.message) || err) };
    }
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
  try {
    const response = await net.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Panebox/${app.getVersion()}`,
      },
    });

    if (response.status === 404) return { status: 'none' }; // no releases yet
    if (!response.ok) return { status: 'error', error: `HTTP ${response.status}` };

    const release = await response.json();
    const latest = release.tag_name;
    const current = app.getVersion();

    if (!isNewer(latest, current)) return { status: 'current', current, latest };

    const result = {
      status: 'available',
      current,
      latest,
      url: release.html_url || `https://github.com/${repo.owner}/${repo.repo}/releases/latest`,
      notes: typeof release.body === 'string' ? release.body.slice(0, 2000) : '',
    };
    send('pb:update-available', result);
    return result;
  } catch (err) {
    // Offline is the common case here; never surface it as a failure.
    return { status: 'error', error: String(err.message || err) };
  }
}

function scheduleUpdateChecks() {
  clearTimeout(updateTimer);
  clearInterval(updateTimer);
  // Let the app settle before touching the network.
  updateTimer = setTimeout(() => {
    checkForUpdates();
    updateTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  }, 15_000);
}

ipcMain.handle('pb:updates:check', (_e, opts) => checkForUpdates({ manual: true, ...opts }));

ipcMain.on('pb:relaunch', () => {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
});

ipcMain.on('pb:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

function partitionFor(appEntry) {
  return appEntry.session === 'shared' ? 'persist:panebox-shared' : `persist:${appEntry.id}`;
}

// -------------------------------------------------------------------- boot

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.on('session-created', applySessionDefaults);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_e, params) => {
      buildContextMenu(contents, params).popup({ window: mainWindow || undefined });
    });

    if (contents.getType() === 'webview') {
      // Keep OAuth/login popups inside the app (they need the service's
      // session); send everything else to the user's real browser.
      contents.setWindowOpenHandler(({ url, frameName }) => {
        if (isAuthUrl(url)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 620,
              height: 760,
              title: frameName || 'Sign in',
              autoHideMenuBar: true,
              webPreferences: { contextIsolation: true, nodeIntegration: false },
            },
          };
        }
        shell.openExternal(url);
        return { action: 'deny' };
      });
    }
  });

  nativeTheme.on('updated', () => {
    send('pb:theme-changed', nativeTheme.shouldUseDarkColors);
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      const dockIcon = nativeImage.createFromPath(path.join(ASSETS, 'icon-256.png'));
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }

    app.setAboutPanelOptions({
      applicationName: 'Panebox',
      applicationVersion: app.getVersion(),
      credits: 'A small, private desktop deck for your web apps.',
    });

    nativeTheme.themeSource = store.get('settings.theme') || 'system';
    applySessionDefaults(session.defaultSession);

    createWindow();
    createTray();
    buildAppMenu();
    scheduleUpdateChecks();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
