'use strict';

/**
 * Renderer. Runs with context isolation on and no Node access — everything
 * privileged goes through `window.panebox` (see preload.js).
 *
 * All user-controlled strings (service names, URLs) are written with
 * textContent or element properties, never innerHTML. The only innerHTML use is
 * for the static brand SVGs bundled in icons.js.
 */

const $ = (id) => document.getElementById(id);

/** At most one title-derived alert per service per minute. */
const ACTIVITY_ALERT_COOLDOWN_MS = 60_000;

const state = {
  config: null,
  activeId: null,
  webviews: new Map(), // appId -> <webview>
  ready: new Set(), // appIds whose webview has emitted dom-ready
  tabs: new Map(), // appId -> { tab, badgeEl }
  badges: new Map(), // appId -> number (-1 means "dot")
  badgeSource: new Map(), // appId -> 'api' | 'title'
  lastActive: new Map(), // appId -> timestamp
  lastNotification: new Map(), // appId -> notification id from the webview
  lastActivityAlert: new Map(), // appId -> timestamp, rate-limits title-based alerts
  findMatches: { current: 0, total: 0 },
  taskTimer: null,
  dragSourceId: null,
};

const settings = () => state.config.settings;
const apps = () => state.config.apps;
const appById = (id) => apps().find((a) => a.id === id) || null;
const partitionFor = (app) =>
  app.session === 'shared' ? 'persist:panebox-shared' : `persist:${app.id}`;

function save(patch) {
  return window.panebox.config.merge(patch);
}

/**
 * Every <webview> method throws until the element is attached and dom-ready has
 * fired. Callers reach for them from timers, menu commands and clicks that can
 * all land in that window, so funnel them through here.
 */
function withWebview(appId, fn, fallback = null) {
  const wv = state.webviews.get(appId);
  if (!wv || !state.ready.has(appId)) return fallback;
  try {
    return fn(wv);
  } catch {
    return fallback;
  }
}

function saveApps() {
  return save({ apps: apps() });
}

// ------------------------------------------------------------------- icons

/** Returns a fresh node for a service's icon. Never fetches from a third party. */
function iconNode(app, sizeClass) {
  const key = app.serviceKey;

  if (app.favicon && /^(https?:|data:)/i.test(app.favicon)) {
    const img = document.createElement('img');
    img.src = app.favicon;
    img.alt = '';
    img.addEventListener('error', () => {
      const fallback = avatarNode(app);
      if (img.parentElement) img.parentElement.replaceChild(fallback, img);
    });
    return img;
  }

  if (key && window.ICONS.has(key)) {
    const span = document.createElement('span');
    span.className = 'brand-icon';
    span.innerHTML = window.ICONS.BRAND[key]; // static, bundled markup
    const svg = span.firstElementChild;
    if (svg) {
      if (sizeClass) svg.classList.add(sizeClass);
      return svg;
    }
  }

  return avatarNode(app);
}

function avatarNode(app) {
  const { initials, background } = window.ICONS.letterAvatar(app.name, app.color);
  const div = document.createElement('div');
  div.className = 'avatar';
  div.style.background = background;
  div.textContent = initials;
  return div;
}

// -------------------------------------------------------------- workspaces

function activeWorkspace() {
  const id = state.config.activeWorkspace;
  return state.config.workspaces.find((w) => w.id === id) || state.config.workspaces[0];
}

function visibleApps() {
  const ws = activeWorkspace();
  if (!ws || !ws.appIds) return apps();
  return apps().filter((a) => ws.appIds.includes(a.id));
}

// ------------------------------------------------------------------ tabs

function renderSidebar() {
  const list = $('app-list');
  list.textContent = '';
  state.tabs.clear();

  const visible = visibleApps();
  $('workspace-label').textContent = activeWorkspace() ? activeWorkspace().name : 'All';

  if (!visible.length) {
    const ws = activeWorkspace();
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';

    const label = document.createElement('span');
    label.textContent = ws && ws.appIds ? 'Group is empty' : 'No services';
    empty.appendChild(label);

    const action = document.createElement('button');
    action.textContent = ws && ws.appIds ? 'Choose' : 'Add';
    action.addEventListener('click', () => {
      if (ws && ws.appIds) openWorkspacePicker(ws.id);
      else {
        renderCatalog();
        openModal('add-modal');
      }
    });
    empty.appendChild(action);

    list.appendChild(empty);
    return;
  }

  for (const app of visible) {
    const wrapper = document.createElement('div');
    wrapper.className = 'app-tab-wrapper';
    wrapper.draggable = true;
    wrapper.dataset.appId = app.id;
    wrapper.title = 'Drag to reorder';

    const tab = document.createElement('div');
    tab.className = 'app-tab' + (app.id === state.activeId ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(app.id === state.activeId));
    tab.appendChild(iconNode(app));
    if (!state.webviews.has(app.id)) tab.classList.add('sleeping');

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.hidden = true;
    tab.appendChild(badge);

    const del = document.createElement('div');
    del.className = 'tab-delete-btn';
    del.textContent = '✕';
    del.title = `Remove ${app.name}`;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${app.name}" from Panebox?\n\nIts saved login is deleted too.`)) {
        removeApp(app.id);
      }
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'app-tooltip';
    tooltip.textContent = app.name;

    tab.addEventListener('click', () => switchTab(app.id));
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openServiceModal(app.id);
    });

    wrapper.addEventListener('dragstart', (e) => {
      state.dragSourceId = app.id;
      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox/Chromium need data set for the drag to start at all.
      e.dataTransfer.setData('text/plain', app.id);
    });
    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      state.dragSourceId = null;
    });
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (state.dragSourceId && state.dragSourceId !== app.id) wrapper.classList.add('drag-over');
    });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      reorderApps(state.dragSourceId, app.id);
    });

    wrapper.append(tab, del, tooltip);
    list.appendChild(wrapper);
    state.tabs.set(app.id, { tab, badgeEl: badge });
  }

  // The add button lives with the services, not stranded in the footer — it is
  // where you look when you want another one.
  const addWrap = document.createElement('div');
  addWrap.className = 'app-tab-wrapper';

  const addTile = document.createElement('button');
  addTile.className = 'app-add-tile';
  addTile.setAttribute('aria-label', 'Add a service');
  addTile.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  addTile.addEventListener('click', () => {
    renderCatalog();
    openModal('add-modal');
  });

  const addTip = document.createElement('div');
  addTip.className = 'app-tooltip';
  const ws = activeWorkspace();
  addTip.textContent = ws && ws.appIds ? `Add to ${ws.name}` : 'Add a service';

  addWrap.append(addTile, addTip);
  list.appendChild(addWrap);

  refreshBadges();
}

function reorderApps(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const list = apps();
  const from = list.findIndex((a) => a.id === sourceId);
  const to = list.findIndex((a) => a.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  saveApps();
  renderSidebar();
}

// -------------------------------------------------------------- webviews

function createWebview(app) {
  const wv = document.createElement('webview');
  wv.setAttribute('src', app.url);
  wv.setAttribute('partition', partitionFor(app));
  wv.setAttribute('allowpopups', 'true');
  wv.dataset.appId = app.id;

  wv.addEventListener('dom-ready', () => {
    state.ready.add(app.id);
    wv.setAudioMuted(!!app.muted);
    if (app.customCss) wv.insertCSS(app.customCss).catch(() => {});
    if (app.customJs) wv.executeJavaScript(app.customJs, false).catch((err) => {
      console.warn(`[${app.name}] custom JS failed:`, err && err.message);
    });
    if (app.id === state.activeId) syncUrl();
  });

  const syncUrl = () => {
    if (app.id !== state.activeId) return;
    const url = withWebview(app.id, (view) => view.getURL()) || app.url;
    $('url-input').value = url;
    $('url-lock').classList.toggle('insecure', !/^https:/i.test(url));
  };
  wv.addEventListener('did-navigate', syncUrl);
  wv.addEventListener('did-navigate-in-page', syncUrl);

  wv.addEventListener('page-title-updated', (e) => {
    // A service that reports exact counts via navigator.setAppBadge is always
    // more accurate, so once we've heard from that API we stop reading titles.
    if (state.badgeSource.get(app.id) === 'api') return;
    setBadge(app.id, parseBadgeFromTitle(e.title), 'title');
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const icon = e.favicons && e.favicons[0];
    if (!icon || icon === app.favicon) return;
    app.favicon = icon;
    saveApps();
    renderSidebar();
  });

  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'pb:notification') handleNotification(app, e.args[0]);
    else if (e.channel === 'pb:badge') setBadge(app.id, e.args[0].count, 'api');
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // aborted by a redirect, not a real failure
    console.warn(`[${app.name}] failed to load: ${e.errorDescription} (${e.validatedURL})`);
  });

  $('view-container').appendChild(wv);
  state.webviews.set(app.id, wv);
  state.lastActive.set(app.id, Date.now());
  return wv;
}

function destroyWebview(appId) {
  const wv = state.webviews.get(appId);
  if (!wv) return;
  wv.remove();
  state.webviews.delete(appId);
  state.ready.delete(appId);
  state.badges.delete(appId);
  state.badgeSource.delete(appId);
  state.lastActivityAlert.delete(appId);
  refreshBadges();
}

function switchTab(appId) {
  const app = appById(appId);
  if (!app) return;

  state.activeId = appId;
  state.lastActive.set(appId, Date.now());

  if (!state.webviews.has(appId)) createWebview(app);

  for (const [id, view] of state.webviews) {
    view.classList.toggle('active', id === appId);
  }
  for (const [id, { tab }] of state.tabs) {
    tab.classList.toggle('active', id === appId);
    tab.setAttribute('aria-selected', String(id === appId));
    tab.classList.toggle('sleeping', !state.webviews.has(id));
  }

  $('url-input').value = withWebview(appId, (view) => view.getURL()) || app.url;
  $('btn-mute').classList.toggle('off', !!app.muted);
  closeFind();
}

function cycle(delta) {
  const visible = visibleApps();
  if (!visible.length) return;
  const index = visible.findIndex((a) => a.id === state.activeId);
  const next = (index + delta + visible.length) % visible.length;
  switchTab(visible[next].id);
}

// ------------------------------------------------------------- badges

const parseBadgeFromTitle = (title) => window.BADGE.parseBadgeFromTitle(title);

function setBadge(appId, count, source = 'title') {
  const raw = Number(count);
  const value = Number.isFinite(raw) ? raw : 0;
  if (source === 'api') state.badgeSource.set(appId, 'api');
  // null on the very first reading, so loading a page with 5 unread doesn't
  // announce itself as 5 new arrivals.
  const previous = state.badges.has(appId) ? state.badges.get(appId) : null;
  state.badges.set(appId, value);

  if (previous !== null) {
    const rose = (value > previous && value > 0) || (value === -1 && previous === 0);
    if (rose) alertNewActivity(appId, value, previous);
  }

  refreshBadges();
}

/**
 * The workaround for Web Push.
 *
 * Services like LinkedIn, Instagram and X deliver notifications through
 * Google's push service, which Electron cannot receive. But they *do* update
 * their page title — "(2) LinkedIn" — the moment something arrives. So when a
 * service's unread count climbs while you're looking elsewhere, we raise the
 * notification ourselves.
 *
 * Only works while the service is awake; that's why the setting warns about
 * sleeping.
 */
function alertNewActivity(appId, value, previous) {
  const app = appById(appId);
  if (!app) return;

  const now = Date.now();
  const { alert, body } = window.ACTIVITY.evaluateActivity({
    previous,
    value,
    isActive: appId === state.activeId,
    notificationsEnabled: app.notifications !== false,
    activityAlertsEnabled: app.activityAlerts !== false,
    dnd: !!settings().dnd,
    lastAlertAt: state.lastActivityAlert.get(appId) || 0,
    now,
    cooldownMs: ACTIVITY_ALERT_COOLDOWN_MS,
  });
  if (!alert) return;

  state.lastActivityAlert.set(appId, now);
  window.panebox.notifications.show({
    appId,
    notifId: null,
    appName: app.name,
    title: app.name,
    body,
    silent: !!app.muted,
  });
}

function refreshBadges() {
  let total = 0;
  const show = settings().showBadges;

  for (const [appId, { badgeEl }] of state.tabs) {
    const app = appById(appId);
    const count = state.badges.get(appId) || 0;
    const enabled = show && app && app.badge !== false;

    if (!enabled || count === 0) {
      badgeEl.hidden = true;
      badgeEl.classList.remove('dot');
      continue;
    }
    badgeEl.hidden = false;
    if (count < 0) {
      badgeEl.classList.add('dot');
      badgeEl.textContent = '';
    } else {
      badgeEl.classList.remove('dot');
      badgeEl.textContent = count > 99 ? '99+' : String(count);
      total += count;
    }
  }

  window.panebox.notifications.setBadge(show ? total : 0);
}

// -------------------------------------------------------- notifications

function handleNotification(app, payload) {
  if (!payload) return;
  if (settings().dnd) return;
  if (app.notifications === false) return;

  state.lastNotification.set(app.id, payload.id);
  window.panebox.notifications.show({
    appId: app.id,
    notifId: payload.id,
    appName: app.name,
    title: payload.title || app.name,
    body: payload.body,
    silent: !!app.muted,
  });
}

// ------------------------------------------------------------ hibernation

function hibernationTick() {
  if (!settings().hibernateEnabled) return;
  const limit = Math.max(1, Number(settings().hibernateAfterMinutes) || 15) * 60_000;
  const now = Date.now();

  for (const [appId] of state.webviews) {
    if (appId === state.activeId) continue;
    const app = appById(appId);
    if (!app || app.hibernate === false) continue;
    const last = state.lastActive.get(appId) || now;
    if (now - last > limit) destroyWebview(appId);
  }

  for (const [id, { tab }] of state.tabs) {
    tab.classList.toggle('sleeping', !state.webviews.has(id));
  }
}

// ---------------------------------------------------------------- add app

function addApp({ name, url, serviceKey, color }) {
  let finalName = (name || '').trim();
  let finalUrl = (url || '').trim();
  if (!finalUrl) return null;
  if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;

  try {
    const parsed = new URL(finalUrl);
    if (!finalName) {
      const host = parsed.hostname.replace(/^www\./, '');
      finalName = host.split('.')[0].replace(/^./, (c) => c.toUpperCase());
    }
  } catch {
    alert('That does not look like a valid URL.');
    return null;
  }

  const app = {
    id: `app-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: finalName,
    url: finalUrl,
    serviceKey: serviceKey || null,
    color: color || null,
    favicon: null,
    session: 'isolated',
    notifications: true,
    activityAlerts: true,
    badge: true,
    hibernate: true,
    muted: false,
    customCss: '',
    customJs: '',
  };

  apps().push(app);

  // A workspace with an explicit list should include what you just added.
  const ws = activeWorkspace();
  if (ws && ws.appIds) ws.appIds.push(app.id);

  save({ apps: apps(), workspaces: state.config.workspaces });
  renderSidebar();
  switchTab(app.id);
  return app;
}

function removeApp(appId) {
  const app = appById(appId);
  if (!app) return;

  window.panebox.system.clearSession(partitionFor(app)).catch(() => {});
  destroyWebview(appId);

  state.config.apps = apps().filter((a) => a.id !== appId);
  for (const ws of state.config.workspaces) {
    if (ws.appIds) ws.appIds = ws.appIds.filter((id) => id !== appId);
  }
  save({ apps: apps(), workspaces: state.config.workspaces });

  renderSidebar();
  if (state.activeId === appId) {
    const remaining = visibleApps();
    if (remaining.length) switchTab(remaining[0].id);
    else state.activeId = null;
  }
}

// ------------------------------------------------------------ add modal UI

let catalogCategory = 'AI';

function renderCatalog() {
  const ws = activeWorkspace();
  $('add-target').textContent = ws && ws.appIds ? `Adding to "${ws.name}"` : '';

  const query = $('catalog-search').value.trim().toLowerCase();
  const tabs = $('category-tabs');
  const grid = $('catalog-grid');

  tabs.textContent = '';
  for (const category of ['All', ...window.CATALOG.CATEGORIES]) {
    const btn = document.createElement('button');
    btn.textContent = category;
    btn.className = category === catalogCategory ? 'active' : '';
    btn.addEventListener('click', () => {
      catalogCategory = category;
      renderCatalog();
    });
    tabs.appendChild(btn);
  }

  const matches = window.CATALOG.SERVICES.filter((s) => {
    const inCategory = catalogCategory === 'All' || s.category === catalogCategory;
    const inQuery = !query || s.name.toLowerCase().includes(query) || s.url.includes(query);
    return query ? inQuery : inCategory;
  });

  grid.textContent = '';
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.gridColumn = '1 / -1';
    empty.textContent = 'No matching services — use "Add a custom URL" below.';
    grid.appendChild(empty);
    return;
  }

  for (const service of matches) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.appendChild(iconNode({ name: service.name, serviceKey: service.key, color: service.color }));
    const label = document.createElement('span');
    label.textContent = service.name;
    item.appendChild(label);
    item.addEventListener('click', () => {
      addApp({ name: service.name, url: service.url, serviceKey: service.key, color: service.color });
      closeModal('add-modal');
    });
    grid.appendChild(item);
  }
}

// ---------------------------------------------------------------- modals

function openModal(id) {
  $(id).classList.add('active');
}
function closeModal(id) {
  $(id).classList.remove('active');
  if (id === 'task-modal') stopTaskManager();
}

// ------------------------------------------------------------- settings UI

function renderManageList() {
  const list = $('manage-app-list');
  list.textContent = '';

  if (!apps().length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No services yet.';
    list.appendChild(empty);
    return;
  }

  for (const app of apps()) {
    const row = document.createElement('div');
    row.className = 'manage-app-row';

    const info = document.createElement('div');
    info.className = 'manage-app-info';
    info.appendChild(iconNode(app));

    const details = document.createElement('div');
    details.className = 'manage-app-details';
    const title = document.createElement('span');
    title.className = 'manage-app-title';
    title.textContent = app.name;
    const url = document.createElement('span');
    url.className = 'manage-app-url';
    url.textContent = app.url;
    details.append(title, url);
    info.appendChild(details);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const edit = document.createElement('button');
    edit.className = 'btn-delete-row';
    edit.style.background = 'transparent';
    edit.style.color = 'var(--text-muted)';
    edit.style.borderColor = 'var(--border)';
    edit.textContent = 'Configure';
    edit.addEventListener('click', () => openServiceModal(app.id));
    const del = document.createElement('button');
    del.className = 'btn-delete-row';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      if (confirm(`Remove "${app.name}"?\n\nIts saved login is deleted too.`)) {
        removeApp(app.id);
        renderManageList();
      }
    });
    actions.append(edit, del);

    row.append(info, actions);
    list.appendChild(row);
  }
}

function renderWorkspaceList() {
  const list = $('workspace-list');
  list.textContent = '';

  for (const ws of state.config.workspaces) {
    const row = document.createElement('div');
    row.className = 'manage-app-row';

    const details = document.createElement('div');
    details.className = 'manage-app-details';

    let title;
    if (ws.appIds) {
      // Custom groups are renamed in place.
      title = document.createElement('input');
      title.className = 'inline-rename';
      title.value = ws.name;
      title.setAttribute('aria-label', `Rename ${ws.name}`);
      title.addEventListener('change', () => {
        const next = title.value.trim();
        if (!next) {
          title.value = ws.name;
          return;
        }
        ws.name = next;
        save({ workspaces: state.config.workspaces });
        renderSidebar();
      });
    } else {
      title = document.createElement('span');
      title.className = 'manage-app-title';
      title.textContent = ws.name;
    }

    const sub = document.createElement('span');
    sub.className = 'manage-app-url';
    sub.textContent = ws.appIds ? `${ws.appIds.length} service(s)` : 'All services';
    details.append(title, sub);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    if (ws.appIds) {
      const pick = document.createElement('button');
      pick.className = 'btn-delete-row';
      pick.style.background = 'transparent';
      pick.style.color = 'var(--text-muted)';
      pick.style.borderColor = 'var(--border)';
      pick.textContent = 'Choose services';
      pick.addEventListener('click', () => editWorkspaceMembers(ws));
      actions.appendChild(pick);

      const del = document.createElement('button');
      del.className = 'btn-delete-row';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        state.config.workspaces = state.config.workspaces.filter((w) => w.id !== ws.id);
        if (state.config.activeWorkspace === ws.id) state.config.activeWorkspace = 'ws-all';
        save({ workspaces: state.config.workspaces, activeWorkspace: state.config.activeWorkspace });
        renderWorkspaceList();
        renderSidebar();
      });
      actions.appendChild(del);
    }

    row.append(details, actions);
    list.appendChild(row);
  }
}

/** Simple checkbox sheet reusing the manage list area. */
function editWorkspaceMembers(ws) {
  const list = $('workspace-list');
  list.textContent = '';

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = `Services in "${ws.name}":`;
  list.appendChild(head);

  for (const app of apps()) {
    const row = document.createElement('label');
    row.className = 'manage-app-row';
    row.style.cursor = 'pointer';

    const info = document.createElement('div');
    info.className = 'manage-app-info';
    info.appendChild(iconNode(app));
    const name = document.createElement('span');
    name.className = 'manage-app-title';
    name.textContent = app.name;
    info.appendChild(name);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = ws.appIds.includes(app.id);
    check.style.accentColor = 'var(--accent)';
    check.addEventListener('change', () => {
      ws.appIds = check.checked
        ? [...ws.appIds, app.id]
        : ws.appIds.filter((id) => id !== app.id);
      save({ workspaces: state.config.workspaces });
      renderSidebar();
    });

    row.append(info, check);
    list.appendChild(row);
  }

  const done = document.createElement('button');
  done.className = 'btn-primary';
  done.textContent = 'Done';
  done.addEventListener('click', renderWorkspaceList);
  list.appendChild(done);
}

function switchWorkspace(id) {
  state.config.activeWorkspace = id;
  save({ activeWorkspace: id });
  $('workspace-menu').hidden = true;
  renderSidebar();
  const visible = visibleApps();
  if (visible.length && !visible.some((a) => a.id === state.activeId)) switchTab(visible[0].id);
}

function createWorkspace(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  // A new group starts with the service you're on, so it's never empty.
  const seed = state.activeId ? [state.activeId] : [];
  const ws = { id: `ws-${Date.now()}`, name: trimmed, appIds: seed };
  state.config.workspaces.push(ws);
  save({ workspaces: state.config.workspaces });
  return ws;
}

function renderWorkspaceMenu(anchor) {
  const menu = $('workspace-menu');
  menu.textContent = '';

  for (const ws of state.config.workspaces) {
    const row = document.createElement('div');
    row.className = 'popover-row';

    const btn = document.createElement('button');
    btn.textContent = ws.name;
    if (ws.id === state.config.activeWorkspace) btn.className = 'active';
    btn.addEventListener('click', () => switchWorkspace(ws.id));
    row.appendChild(btn);

    const count = document.createElement('span');
    count.className = 'popover-count';
    count.textContent = ws.appIds ? String(ws.appIds.length) : String(apps().length);
    row.appendChild(count);

    // "All" is the built-in view of everything and can't be edited away.
    if (ws.appIds) {
      const del = document.createElement('button');
      del.className = 'popover-del';
      del.textContent = '✕';
      del.title = `Delete "${ws.name}"`;
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete the group "${ws.name}"?\n\nYour services are not removed.`)) return;
        state.config.workspaces = state.config.workspaces.filter((w) => w.id !== ws.id);
        if (state.config.activeWorkspace === ws.id) state.config.activeWorkspace = 'ws-all';
        save({ workspaces: state.config.workspaces, activeWorkspace: state.config.activeWorkspace });
        renderWorkspaceMenu(anchor);
        renderSidebar();
      });
      row.appendChild(del);
    }

    menu.appendChild(row);
  }

  const sep = document.createElement('div');
  sep.className = 'popover-sep';
  menu.appendChild(sep);

  const form = document.createElement('form');
  form.className = 'popover-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New group name…';
  input.setAttribute('aria-label', 'New group name');
  const add = document.createElement('button');
  add.type = 'submit';
  add.textContent = '+';
  add.title = 'Create group';
  form.append(input, add);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ws = createWorkspace(input.value);
    if (!ws) return;
    input.value = '';
    switchWorkspace(ws.id);
    openWorkspacePicker(ws.id);
  });
  menu.appendChild(form);

  const manage = document.createElement('button');
  manage.className = 'popover-manage';
  manage.textContent = 'Choose services for this group…';
  manage.addEventListener('click', () => {
    menu.hidden = true;
    const current = activeWorkspace();
    if (!current || !current.appIds) {
      alert('Create a group first, then choose which services belong to it.');
      return;
    }
    openWorkspacePicker(current.id);
  });
  menu.appendChild(manage);

  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.hidden = false;
  input.focus();
}

/** Opens Settings on the Workspaces tab with this group's picker already open. */
function openWorkspacePicker(workspaceId) {
  const ws = state.config.workspaces.find((w) => w.id === workspaceId);
  if (!ws || !ws.appIds) return;
  fillSettingsForm();
  renderManageList();
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelector('[data-tab="tab-workspaces"]').classList.add('active');
  $('tab-workspaces').classList.add('active');
  editWorkspaceMembers(ws);
  openModal('settings-modal');
}

// -------------------------------------------------------- service modal

let editingAppId = null;

function openServiceModal(appId) {
  const app = appById(appId);
  if (!app) return;
  editingAppId = appId;

  $('service-title').textContent = app.name;
  $('svc-name').value = app.name;
  $('svc-url').value = app.url;
  $('svc-notifications').checked = app.notifications !== false;
  $('svc-activity').checked = app.activityAlerts !== false;
  $('svc-badge').checked = app.badge !== false;
  $('svc-hibernate').checked = app.hibernate !== false;
  $('svc-session').value = app.session || 'isolated';
  $('svc-css').value = app.customCss || '';
  $('svc-js').value = app.customJs || '';
  renderServiceWorkspaces(app);

  openModal('service-modal');
}

/** Toggle-chips for the groups this service belongs to. */
function renderServiceWorkspaces(app) {
  const container = $('svc-workspaces');
  container.textContent = '';

  const groups = state.config.workspaces.filter((w) => w.appIds);
  if (!groups.length) {
    const hint = document.createElement('span');
    hint.className = 'block-hint';
    hint.textContent = 'No groups yet — create one from the button at the top of the sidebar.';
    container.appendChild(hint);
    return;
  }

  for (const ws of groups) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (ws.appIds.includes(app.id) ? ' on' : '');
    chip.textContent = ws.name;
    chip.addEventListener('click', () => {
      const member = ws.appIds.includes(app.id);
      ws.appIds = member ? ws.appIds.filter((id) => id !== app.id) : [...ws.appIds, app.id];
      chip.classList.toggle('on', !member);
      save({ workspaces: state.config.workspaces });
      renderSidebar();
    });
    container.appendChild(chip);
  }
}

function saveServiceModal() {
  const app = appById(editingAppId);
  if (!app) return;

  const previousUrl = app.url;
  const previousSession = app.session;

  app.name = $('svc-name').value.trim() || app.name;
  app.url = $('svc-url').value.trim() || app.url;
  app.notifications = $('svc-notifications').checked;
  app.activityAlerts = $('svc-activity').checked;
  app.badge = $('svc-badge').checked;
  app.hibernate = $('svc-hibernate').checked;
  app.session = $('svc-session').value;
  app.customCss = $('svc-css').value;
  app.customJs = $('svc-js').value;

  saveApps();

  // URL or partition changed — the live webview no longer matches.
  if (app.url !== previousUrl || app.session !== previousSession) {
    destroyWebview(app.id);
    if (state.activeId === app.id) switchTab(app.id);
  }

  renderSidebar();
  renderManageList();
  closeModal('service-modal');
}

// -------------------------------------------------------- task manager

function startTaskManager() {
  const refresh = async () => {
    const entries = [];
    for (const appId of state.webviews.keys()) {
      const id = withWebview(appId, (wv) => wv.getWebContentsId());
      if (id != null) entries.push({ appId, webContentsId: id });
    }
    const metrics = await window.panebox.system.metrics(entries);
    const byId = new Map(metrics.map((m) => [m.appId, m]));

    const rows = $('task-rows');
    rows.textContent = '';
    for (const app of apps()) {
      const m = byId.get(app.id);
      const asleep = !state.webviews.has(app.id);
      const tr = document.createElement('tr');
      for (const value of [
        app.name,
        m && m.cpu != null ? `${m.cpu}%` : '—',
        m && m.memoryMB != null ? `${m.memoryMB} MB` : '—',
        asleep ? 'Sleeping' : 'Running',
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
  };

  refresh();
  state.taskTimer = setInterval(refresh, 2000);
  openModal('task-modal');
}

function stopTaskManager() {
  clearInterval(state.taskTimer);
  state.taskTimer = null;
}

// --------------------------------------------------------------- find bar

function openFind() {
  if (!state.activeId) return;
  $('find-bar').hidden = false;
  $('find-input').focus();
  $('find-input').select();
}

function closeFind() {
  $('find-bar').hidden = true;
  withWebview(state.activeId, (wv) => wv.stopFindInPage('clearSelection'));
  $('find-count').textContent = '0/0';
}

function runFind(forward = true, findNext = false) {
  const text = $('find-input').value;
  if (!text) {
    $('find-count').textContent = '0/0';
    return;
  }
  withWebview(state.activeId, (wv) => wv.findInPage(text, { forward, findNext }));
}

// -------------------------------------------------------------- todo list

function renderTodos() {
  const list = $('todo-list');
  list.textContent = '';

  for (const todo of state.config.todos) {
    const li = document.createElement('li');
    if (todo.done) li.className = 'done';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!todo.done;
    check.addEventListener('change', () => {
      todo.done = check.checked;
      save({ todos: state.config.todos });
      renderTodos();
    });

    const text = document.createElement('span');
    text.textContent = todo.text;

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', () => {
      state.config.todos = state.config.todos.filter((t) => t.id !== todo.id);
      save({ todos: state.config.todos });
      renderTodos();
    });

    li.append(check, text, del);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------- updates

let pendingUpdateUrl = null;

/** Manual/notify path: a new version exists but this build can't self-install. */
function showUpdateBanner(info) {
  if (!info || info.status !== 'available') return;
  pendingUpdateUrl = info.url;
  $('update-text').textContent = `Panebox ${info.latest} is available — you have ${info.current}.`;
  $('update-progress').hidden = true;
  $('update-restart').hidden = true;
  $('update-download').hidden = false;
  $('update-banner').hidden = false;
}

/**
 * Auto-update path (packaged Windows/Linux): electron-updater downloads in the
 * background and reports progress, then we offer a restart.
 */
function showUpdateStatus(status) {
  if (!status) return;
  const banner = $('update-banner');

  if (status.phase === 'downloading') {
    $('update-download').hidden = true;
    $('update-restart').hidden = true;
    $('update-progress').hidden = false;
    const pct = Number.isFinite(status.percent) ? status.percent : 0;
    $('update-bar').style.width = `${pct}%`;
    $('update-text').textContent = status.latest
      ? `Downloading Panebox ${status.latest}…`
      : `Downloading update… ${pct}%`;
    banner.hidden = false;
    return;
  }

  if (status.phase === 'ready') {
    $('update-progress').hidden = true;
    $('update-download').hidden = true;
    $('update-restart').hidden = false;
    $('update-text').textContent = `Panebox ${status.latest} is ready to install.`;
    banner.hidden = false;
    return;
  }

  // Errors stay silent — being offline shouldn't nag anyone.
}

/** Feedback for a manual check, where "you're up to date" is a real answer. */
function reportUpdateResult(result) {
  const messages = {
    current: `You're on the latest version (${result.current}).`,
    downloading: 'An update is downloading now — you\'ll be prompted to restart when it\'s ready.',
    none: 'No releases have been published yet.',
    unconfigured: 'Update checking is not configured for this build.',
    disabled: 'Update checking is turned off in Settings.',
    error: `Could not reach GitHub: ${result.error || 'unknown error'}`,
  };
  alert(messages[result.status] || 'Could not check for updates.');
}

// ------------------------------------------------------------ screen share

function showScreenPicker({ id, sources }) {
  const grid = $('screen-sources');
  grid.textContent = '';

  for (const source of sources) {
    const item = document.createElement('div');
    item.className = 'screen-item';

    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = '';

    const label = document.createElement('span');
    label.textContent = source.name;

    item.append(img, label);
    item.addEventListener('click', () => {
      window.panebox.screenShare.respond(id, source.id);
      closeModal('screen-modal');
    });
    grid.appendChild(item);
  }

  $('screen-cancel').onclick = () => {
    window.panebox.screenShare.respond(id, null);
    closeModal('screen-modal');
  };

  openModal('screen-modal');
}

// ------------------------------------------------------------- settings tab

function bindSettingsControls() {
  const bindSwitch = (elId, key, after) => {
    $(elId).addEventListener('change', async (e) => {
      settings()[key] = e.target.checked;
      await window.panebox.config.setKey(`settings.${key}`, e.target.checked);
      if (after) after(e.target.checked);
    });
  };

  bindSwitch('set-dnd', 'dnd', updateDndButton);
  bindSwitch('set-privacy', 'notificationPrivacy');
  bindSwitch('set-badges', 'showBadges', refreshBadges);
  bindSwitch('set-hibernate', 'hibernateEnabled');
  bindSwitch('set-tray', 'closeToTray');
  bindSwitch('set-updates', 'checkForUpdates');
  $('set-ontop').addEventListener('change', (e) => {
    settings().alwaysOnTop = e.target.checked;
    window.panebox.window.setAlwaysOnTop(e.target.checked);
  });

  $('set-theme').addEventListener('change', async (e) => {
    settings().theme = e.target.value;
    const isDark = await window.panebox.theme.set(e.target.value);
    applyTheme(isDark);
  });

  $('set-hibernate-mins').addEventListener('change', (e) => {
    const minutes = Math.min(360, Math.max(1, Number(e.target.value) || 15));
    e.target.value = minutes;
    settings().hibernateAfterMinutes = minutes;
    window.panebox.config.setKey('settings.hibernateAfterMinutes', minutes);
  });

  $('set-title').addEventListener('change', (e) => {
    window.panebox.window.setTitle(e.target.value);
  });

  $('set-spellcheck').addEventListener('change', (e) => {
    const chosen = [...e.target.selectedOptions].map((o) => o.value);
    settings().spellcheckLanguages = chosen;
    window.panebox.spellcheck.set(chosen);
  });
}

function fillSettingsForm() {
  const s = settings();
  $('set-theme').value = s.theme;
  $('set-dnd').checked = !!s.dnd;
  $('set-privacy').checked = !!s.notificationPrivacy;
  $('set-badges').checked = s.showBadges !== false;
  $('set-hibernate').checked = s.hibernateEnabled !== false;
  $('set-hibernate-mins').value = s.hibernateAfterMinutes || 15;
  $('set-ontop').checked = !!s.alwaysOnTop;
  $('set-tray').checked = s.closeToTray !== false;
  $('set-title').value = s.windowTitle || 'Panebox';
  $('set-updates').checked = s.checkForUpdates !== false;
}

async function fillSpellcheck() {
  const info = await window.panebox.spellcheck.languages();
  const select = $('set-spellcheck');
  const note = $('spellcheck-note');

  if (info.managedByOS) {
    note.textContent = 'macOS handles spellchecking with your system dictionaries.';
    select.hidden = true;
    return;
  }
  note.textContent = 'Pick one or more dictionaries.';
  select.textContent = '';
  for (const lang of info.available) {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang;
    option.selected = info.selected.includes(lang);
    select.appendChild(option);
  }
}

function updateDndButton() {
  $('btn-dnd').classList.toggle('on', !!settings().dnd);
}

function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// ---------------------------------------------------------------- migration

/**
 * Older builds kept services in localStorage. Import them once so existing
 * users don't lose their setup, then mark the migration done.
 */
function migrateLegacy() {
  if (localStorage.getItem('omnideck_migrated_v2')) return false;
  const raw =
    localStorage.getItem('omnideck_apps_v5') ||
    localStorage.getItem('omnideck_apps_v4') ||
    localStorage.getItem('omnideck_apps_v3');
  localStorage.setItem('omnideck_migrated_v2', '1');
  if (!raw) return false;

  try {
    const legacy = JSON.parse(raw);
    if (!Array.isArray(legacy) || !legacy.length) return false;

    state.config.apps = legacy.map((old, index) => ({
      id: old.id || `app-legacy-${index}`,
      name: old.name || 'App',
      url: old.url,
      serviceKey: window.CATALOG.SERVICES.find((s) => s.url === old.url)?.key || null,
      color: null,
      favicon: null, // legacy icons were third-party URLs; drop them
      session: 'isolated',
      notifications: true,
      activityAlerts: true,
      badge: true,
      hibernate: true,
      muted: false,
      customCss: '',
      customJs: '',
    }));
    save({ apps: state.config.apps });
    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------- init

async function init() {
  document.body.classList.add(`platform-${window.panebox.platform}`);

  state.config = await window.panebox.config.get();
  migrateLegacy();

  applyTheme(await window.panebox.theme.isDark());
  fillSettingsForm();
  updateDndButton();
  bindSettingsControls();
  fillSpellcheck();
  renderTodos();
  renderSidebar();

  const first = visibleApps()[0];
  if (first) switchTab(first.id);

  setInterval(hibernationTick, 30_000);
  setInterval(() => {
    if (state.activeId) state.lastActive.set(state.activeId, Date.now());
  }, 10_000);
}

// ------------------------------------------------------------------ events

document.addEventListener('DOMContentLoaded', () => {
  init();

  // --- top bar ---
  $('btn-back').addEventListener('click', () =>
    withWebview(state.activeId, (wv) => {
      if (wv.canGoBack()) wv.goBack();
    }),
  );
  $('btn-forward').addEventListener('click', () =>
    withWebview(state.activeId, (wv) => {
      if (wv.canGoForward()) wv.goForward();
    }),
  );
  $('btn-reload').addEventListener('click', () =>
    withWebview(state.activeId, (wv) => wv.reload()),
  );
  $('btn-mute').addEventListener('click', () => {
    const app = appById(state.activeId);
    if (!app) return;
    app.muted = !app.muted;
    withWebview(state.activeId, (wv) => wv.setAudioMuted(app.muted));
    $('btn-mute').classList.toggle('off', app.muted);
    saveApps();
  });
  $('btn-dnd').addEventListener('click', async () => {
    const next = !settings().dnd;
    settings().dnd = next;
    await window.panebox.config.setKey('settings.dnd', next);
    updateDndButton();
    $('set-dnd').checked = next;
  });
  $('btn-find').addEventListener('click', openFind);
  $('btn-todo').addEventListener('click', () => {
    $('todo-panel').hidden = !$('todo-panel').hidden;
  });
  $('btn-todo-close').addEventListener('click', () => {
    $('todo-panel').hidden = true;
  });

  // --- find bar ---
  $('find-input').addEventListener('input', () => runFind(true, false));
  $('find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runFind(!e.shiftKey, true);
    if (e.key === 'Escape') closeFind();
  });
  $('find-next').addEventListener('click', () => runFind(true, true));
  $('find-prev').addEventListener('click', () => runFind(false, true));
  $('find-close').addEventListener('click', closeFind);

  // --- todo ---
  $('todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('todo-input').value.trim();
    if (!text) return;
    state.config.todos.push({ id: `todo-${Date.now()}`, text, done: false });
    $('todo-input').value = '';
    save({ todos: state.config.todos });
    renderTodos();
  });

  // --- sidebar ---
  $('btn-settings').addEventListener('click', () => {
    fillSettingsForm();
    renderManageList();
    renderWorkspaceList();
    openModal('settings-modal');
  });
  $('btn-workspace').addEventListener('click', (e) => {
    e.stopPropagation();
    renderWorkspaceMenu($('btn-workspace'));
  });
  // Clicks inside the popover must not dismiss it — you type a name in there.
  $('workspace-menu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    $('workspace-menu').hidden = true;
  });

  // --- add modal ---
  $('catalog-search').addEventListener('input', renderCatalog);
  $('btn-submit-app').addEventListener('click', (e) => {
    e.preventDefault();
    const added = addApp({ name: $('custom-name').value, url: $('custom-url').value });
    if (added) {
      $('custom-name').value = '';
      $('custom-url').value = '';
      closeModal('add-modal');
    }
  });

  // --- settings modal ---
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
    });
  });

  $('workspace-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ws = createWorkspace($('workspace-name').value);
    if (!ws) return;
    $('workspace-name').value = '';
    renderSidebar();
    editWorkspaceMembers(ws);
  });

  $('btn-export').addEventListener('click', () => window.panebox.config.export());
  $('btn-import').addEventListener('click', () => window.panebox.config.import());
  $('btn-relaunch').addEventListener('click', () => window.panebox.window.relaunch());
  $('btn-taskmanager').addEventListener('click', startTaskManager);
  $('btn-check-updates').addEventListener('click', async () => {
    const result = await window.panebox.updates.check();
    if (result.status === 'available') showUpdateBanner(result);
    else if (result.status === 'downloading') showUpdateStatus({ phase: 'downloading', ...result });
    else reportUpdateResult(result);
  });
  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset all services to the defaults?\n\nSaved logins are kept, but the service list is replaced.')) return;
    state.config = await window.panebox.config.merge({ apps: null });
    window.panebox.window.relaunch();
  });

  // --- service modal ---
  $('svc-save').addEventListener('click', saveServiceModal);
  $('svc-clear').addEventListener('click', async () => {
    const app = appById(editingAppId);
    if (!app) return;
    if (!confirm(`Log out of ${app.name} and clear its local data?`)) return;
    await window.panebox.system.clearSession(partitionFor(app));
    destroyWebview(app.id);
    if (state.activeId === app.id) switchTab(app.id);
    closeModal('service-modal');
  });

  // --- generic modal closing ---
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && overlay.id !== 'screen-modal') closeModal(overlay.id);
    });
  });

  // --- keyboard ---
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('find-bar').hidden) return closeFind();
      document.querySelectorAll('.modal-overlay.active').forEach((m) => {
        if (m.id !== 'screen-modal') closeModal(m.id);
      });
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) return;

    if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      window.panebox.window.relaunch();
    } else if (e.key >= '1' && e.key <= '9') {
      const visible = visibleApps();
      const index = Number(e.key) - 1;
      if (index < visible.length) {
        e.preventDefault();
        switchTab(visible[index].id);
      }
    }
  });

  // --- main-process events ---
  window.panebox.notifications.onActivateApp((payload) => {
    const appId = typeof payload === 'string' ? payload : payload.appId;
    const notifId = typeof payload === 'string' ? null : payload.notifId;
    if (!appById(appId)) return;
    switchTab(appId);
    const id = notifId != null ? notifId : state.lastNotification.get(appId);
    if (id != null) withWebview(appId, (wv) => wv.send('pb:notification-clicked', id));
  });

  window.panebox.theme.onChanged(applyTheme);
  window.panebox.updates.onAvailable(showUpdateBanner);
  window.panebox.updates.onResult(reportUpdateResult);
  window.panebox.updates.onStatus(showUpdateStatus);

  $('update-restart').addEventListener('click', () => window.panebox.updates.install());

  $('update-download').addEventListener('click', () => {
    if (pendingUpdateUrl) window.panebox.system.openExternal(pendingUpdateUrl);
    $('update-banner').hidden = true;
  });
  $('update-dismiss').addEventListener('click', () => {
    $('update-banner').hidden = true;
  });
  window.panebox.screenShare.onRequest(showScreenPicker);

  window.panebox.config.onReplaced((config) => {
    state.config = config;
    for (const id of [...state.webviews.keys()]) destroyWebview(id);
    fillSettingsForm();
    renderTodos();
    renderSidebar();
    const first = visibleApps()[0];
    if (first) switchTab(first.id);
  });

  window.panebox.menu.onSettingsChanged((next) => {
    Object.assign(settings(), next);
    fillSettingsForm();
    updateDndButton();
  });

  window.panebox.menu.onOpenSettings(() => {
    fillSettingsForm();
    renderManageList();
    renderWorkspaceList();
    openModal('settings-modal');
  });
  window.panebox.menu.onOpenAdd(() => {
    renderCatalog();
    openModal('add-modal');
  });
  window.panebox.menu.onOpenFind(openFind);
  window.panebox.menu.onOpenTaskManager(startTaskManager);
  window.panebox.menu.onToggleTodo(() => {
    $('todo-panel').hidden = !$('todo-panel').hidden;
  });
  window.panebox.menu.onReloadActive(() =>
    withWebview(state.activeId, (wv) => wv.reload()),
  );
  window.panebox.menu.onCycle(cycle);
});

// Find-in-page results arrive on the webview, so wire them up lazily.
document.addEventListener(
  'found-in-page',
  (e) => {
    const result = e.result || (e.detail && e.detail.result);
    if (!result) return;
    state.findMatches = { current: result.activeMatchOrdinal, total: result.matches };
    $('find-count').textContent = `${result.activeMatchOrdinal}/${result.matches}`;
  },
  true,
);
