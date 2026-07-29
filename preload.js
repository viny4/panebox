'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only surface the renderer gets. No `require`, no `ipcRenderer`, no
 * filesystem — just this allowlist of typed calls, each of which is validated
 * on the main-process side.
 */

const on = (channel) => (handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('panebox', {
  platform: process.platform,

  config: {
    get: () => ipcRenderer.invoke('pb:config:get'),
    merge: (patch) => ipcRenderer.invoke('pb:config:set', patch),
    setKey: (key, value) => ipcRenderer.invoke('pb:config:setKey', { key, value }),
    export: () => ipcRenderer.invoke('pb:config:export'),
    import: () => ipcRenderer.invoke('pb:config:import'),
    onReplaced: on('pb:config-replaced'),
  },

  notifications: {
    show: (payload) => ipcRenderer.invoke('pb:notify', payload),
    setBadge: (count) => ipcRenderer.invoke('pb:badge:set', count),
    onActivateApp: on('pb:activate-app'),
  },

  window: {
    setAlwaysOnTop: (value) => ipcRenderer.invoke('pb:window:setAlwaysOnTop', value),
    setTitle: (title) => ipcRenderer.invoke('pb:window:setTitle', title),
    relaunch: () => ipcRenderer.send('pb:relaunch'),
  },

  theme: {
    set: (theme) => ipcRenderer.invoke('pb:theme:set', theme),
    isDark: () => ipcRenderer.invoke('pb:theme:isDark'),
    onChanged: on('pb:theme-changed'),
  },

  updates: {
    check: (opts) => ipcRenderer.invoke('pb:updates:check', opts || {}),
    onAvailable: on('pb:update-available'),
    onResult: on('pb:update-result'),
    onStatus: on('pb:update-status'),
    install: () => ipcRenderer.invoke('pb:updates:install'),
  },

  system: {
    metrics: (entries) => ipcRenderer.invoke('pb:metrics', entries),
    clearSession: (partition) => ipcRenderer.invoke('pb:session:clear', partition),
    openExternal: (url) => ipcRenderer.send('pb:open-external', url),
  },

  spellcheck: {
    languages: () => ipcRenderer.invoke('pb:spellcheck:languages'),
    set: (languages) => ipcRenderer.invoke('pb:spellcheck:set', languages),
  },

  screenShare: {
    onRequest: on('pb:pick-screen-source'),
    respond: (id, sourceId) => ipcRenderer.send('pb:screen-source-picked', { id, sourceId }),
  },

  // Menu-driven commands.
  menu: {
    onOpenSettings: on('pb:open-settings'),
    onOpenAdd: on('pb:open-add'),
    onOpenFind: on('pb:open-find'),
    onOpenTaskManager: on('pb:open-taskmanager'),
    onToggleSidebar: on('pb:toggle-sidebar'),
    onToggleSplit: on('pb:toggle-split'),
    onToggleTodo: on('pb:toggle-todo'),
    onReloadActive: on('pb:reload-active'),
    onCycle: on('pb:cycle'),
    onSettingsChanged: on('pb:settings-changed'),
  },
});
