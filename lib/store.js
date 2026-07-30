'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG = require('../catalog');

/**
 * Config lives in a single JSON file in userData. It is deliberately plain and
 * human-editable — exporting your setup should just be copying this file, and
 * nothing here is ever transmitted anywhere.
 */

function defaultApps() {
  return CATALOG.DEFAULT_KEYS.map((key, index) => {
    const service = CATALOG.byKey(key);
    return {
      id: `app-${key}-${index}`,
      name: service.name,
      url: service.url,
      serviceKey: service.key,
      color: service.color,
      favicon: null,
      session: 'isolated',
      // Overrides the app-wide user agent for this service only. Some sites
      // gate on it — Google refuses OAuth from anything it reads as embedded.
      userAgent: null,
      notifications: true,
      // Fires our own alert when the unread count rises. This is what makes
      // LinkedIn/Instagram/X notify at all — they use Google's push service,
      // which no Electron app can receive.
      activityAlerts: true,
      badge: true,
      hibernate: true,
      muted: false,
      customCss: '',
      customJs: '',
    };
  });
}

function defaultConfig() {
  const apps = defaultApps();
  return {
    version: 1,
    apps,
    workspaces: [{ id: 'ws-all', name: 'All', appIds: null }],
    activeWorkspace: 'ws-all',
    todos: [],
    splitIds: [],
    window: null,
    settings: {
      theme: 'system',
      dnd: false,
      notificationPrivacy: false,
      showBadges: true,
      hibernateEnabled: true,
      hibernateAfterMinutes: 15,
      alwaysOnTop: false,
      closeToTray: true,
      startMinimized: false,
      windowTitle: 'Panebox',
      spellcheckLanguages: ['en-US'],
      // The only network request Panebox makes on its own behalf.
      checkForUpdates: true,
      sidebarHidden: false,
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Recursive merge; arrays are replaced wholesale rather than concatenated. */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function createStore(filePath) {
  let data = defaultConfig();

  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Merge over defaults so upgrades pick up newly added settings keys.
      data = deepMerge(defaultConfig(), parsed);

      // Keep the last known-good copy. Losing a service list is annoying;
      // losing it silently, with no way back, is worse.
      try {
        fs.copyFileSync(filePath, `${filePath}.backup`);
      } catch {
        /* a missing backup must never stop the app starting */
      }
    }
  } catch (err) {
    // Do NOT fall through to defaults and then overwrite the file — that turns
    // one bad read into permanent data loss. Preserve the original first.
    const quarantined = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantined);
      console.error(`Config unreadable (${err.message}); kept a copy at ${quarantined}`);
    } catch {
      console.error('Config unreadable and could not be preserved:', err.message);
    }

    // Prefer the last good backup over starting from scratch.
    try {
      const backup = `${filePath}.backup`;
      if (fs.existsSync(backup)) {
        data = deepMerge(defaultConfig(), JSON.parse(fs.readFileSync(backup, 'utf8')));
        console.error('Recovered configuration from backup.');
      }
    } catch {
      console.error('Backup was unreadable too; starting fresh.');
    }
  }

  let writeTimer = null;
  function persist() {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        // Write-then-rename so a crash mid-write can't truncate the config.
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, filePath);
      } catch (err) {
        console.error('Could not write config:', err.message);
      }
    }, 150);
  }

  return {
    all: () => data,
    get(keyPath) {
      return keyPath
        .split('.')
        .reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
    },
    set(keyPath, value) {
      const keys = keyPath.split('.');
      const last = keys.pop();
      let target = data;
      for (const key of keys) {
        if (!isPlainObject(target[key])) target[key] = {};
        target = target[key];
      }
      target[last] = value;
      persist();
      return data;
    },
    merge(patch) {
      data = deepMerge(data, patch);
      persist();
      return data;
    },
    replace(next) {
      data = deepMerge(defaultConfig(), next);
      persist();
      return data;
    },
    path: filePath,
  };
}

module.exports = { createStore, defaultConfig };
