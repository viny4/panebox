'use strict';

const { ipcRenderer, webFrame } = require('electron');

/**
 * Runs inside every service, in an isolated world.
 *
 * Its job is to intercept the two things a web app does that a container has to
 * handle itself: raising notifications, and reporting unread counts. Because
 * context isolation is on, we can't patch page globals directly from here — we
 * expose a narrow bridge and then install the patch into the page's own world
 * with webFrame.executeJavaScript.
 */

let nextId = 1;
const liveNotifications = new Map();

// --- bridge (isolated world -> host) ---------------------------------------

const bridge = {
  notify(payload) {
    const id = nextId++;
    ipcRenderer.sendToHost('pb:notification', {
      id,
      title: String(payload && payload.title ? payload.title : '').slice(0, 200),
      body: String(payload && payload.body ? payload.body : '').slice(0, 500),
      silent: !!(payload && payload.silent),
      tag: payload && payload.tag ? String(payload.tag).slice(0, 100) : null,
    });
    return id;
  },
  badge(count) {
    ipcRenderer.sendToHost('pb:badge', { count: Number(count) || 0 });
  },
  register(id, instance) {
    liveNotifications.set(id, instance);
    // Don't let a chatty app leak instances forever.
    if (liveNotifications.size > 200) {
      liveNotifications.delete(liveNotifications.keys().next().value);
    }
  },
};

// contextBridge isn't available when the page world is already the same world,
// so guard for both configurations.
try {
  require('electron').contextBridge.exposeInMainWorld('__pbBridge', bridge);
} catch {
  // contextIsolation disabled — patch will find the bridge on window directly.
  window.__pbBridge = bridge;
}

// Host tells us a notification was clicked; replay it into the page so the
// app's own handler (open this chat, focus this thread) still runs.
ipcRenderer.on('pb:notification-clicked', (_event, id) => {
  webFrame.executeJavaScript(`window.__pbOnNotificationClick && window.__pbOnNotificationClick(${Number(id)})`).catch(() => {});
});

// --- page-world patch -------------------------------------------------------

const PATCH = `(() => {
  const bridge = window.__pbBridge;
  if (!bridge) return;

  const instances = new Map();
  window.__pbOnNotificationClick = (id) => {
    const n = instances.get(id);
    if (!n) return;
    window.focus();
    try { n.dispatchEvent(new Event('click')); } catch (e) {}
    if (typeof n.onclick === 'function') { try { n.onclick(new Event('click')); } catch (e) {} }
  };

  const NativeNotification = window.Notification;

  class OmniNotification extends EventTarget {
    constructor(title, options = {}) {
      super();
      this.title = title;
      this.body = options.body || '';
      this.tag = options.tag || '';
      this.data = options.data;
      this.icon = options.icon || '';
      this.silent = !!options.silent;
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;

      const id = bridge.notify({ title, body: this.body, silent: this.silent, tag: this.tag });
      this._id = id;
      instances.set(id, this);
      queueMicrotask(() => {
        if (typeof this.onshow === 'function') { try { this.onshow(new Event('show')); } catch (e) {} }
      });
    }
    close() {
      instances.delete(this._id);
      if (typeof this.onclose === 'function') { try { this.onclose(new Event('close')); } catch (e) {} }
    }
    static requestPermission(cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    }
  }
  Object.defineProperty(OmniNotification, 'permission', { get: () => 'granted' });
  Object.defineProperty(OmniNotification, 'maxActions', { get: () => 0 });

  try {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: OmniNotification,
    });
  } catch (e) {}

  // Service-worker notifications (WhatsApp, Slack, Teams) take a different path.
  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
    const original = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options = {}) {
      try {
        bridge.notify({ title, body: options.body || '', silent: !!options.silent, tag: options.tag });
      } catch (e) {}
      return Promise.resolve();
    };
    ServiceWorkerRegistration.prototype.__pbOriginalShowNotification = original;
  }

  // Modern apps report exact unread counts here — far more reliable than
  // scraping the document title.
  if (navigator.setAppBadge) {
    const setAppBadge = navigator.setAppBadge.bind(navigator);
    const clearAppBadge = navigator.clearAppBadge ? navigator.clearAppBadge.bind(navigator) : null;
    navigator.setAppBadge = (count) => { try { bridge.badge(count == null ? -1 : count); } catch (e) {} return setAppBadge(count); };
    if (clearAppBadge) navigator.clearAppBadge = () => { try { bridge.badge(0); } catch (e) {} return clearAppBadge(); };
  }

  // Keep a handle for debugging / opt-out.
  window.__pbNativeNotification = NativeNotification;
})();`;

function installPatch() {
  webFrame.executeJavaScript(PATCH).catch((err) => {
    console.warn('[Panebox] notification patch failed:', err && err.message);
  });
}

installPatch();
// Re-install after navigations that replace the page world.
window.addEventListener('DOMContentLoaded', installPatch);
