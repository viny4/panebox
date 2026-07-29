/**
 * Decides whether a change in a service's unread count should raise a
 * notification.
 *
 * This exists because LinkedIn, Instagram, X and friends deliver their
 * notifications through Google's push service, which no Electron app can
 * receive. What they *do* update is their page title — "(2) LinkedIn" — so when
 * that number climbs while you're looking at something else, we raise the alert
 * ourselves.
 *
 * Kept as a pure function so the rules are testable without a running window.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ACTIVITY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_COOLDOWN_MS = 60_000;

  /**
   * @param {object} input
   * @param {number|null} input.previous  previous count, null on first reading
   * @param {number}      input.value     new count (-1 means "unread, no number")
   * @param {boolean}     input.isActive  is this the service on screen right now
   * @param {boolean}     input.notificationsEnabled
   * @param {boolean}     input.activityAlertsEnabled
   * @param {boolean}     input.dnd
   * @param {number}      input.lastAlertAt  epoch ms of the last alert, 0 if none
   * @param {number}      input.now
   * @param {number}     [input.cooldownMs]
   * @returns {{alert: boolean, body: string|null, reason: string}}
   */
  function evaluateActivity({
    previous,
    value,
    isActive,
    notificationsEnabled,
    activityAlertsEnabled,
    dnd,
    lastAlertAt,
    now,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  }) {
    const no = (reason) => ({ alert: false, body: null, reason });

    // A page that loads already showing 5 unread has not just received 5.
    if (previous === null || previous === undefined) return no('first-reading');
    if (dnd) return no('dnd');
    if (notificationsEnabled === false) return no('notifications-off');
    if (activityAlertsEnabled === false) return no('activity-alerts-off');
    if (isActive) return no('service-on-screen');

    const rose = (value > previous && value > 0) || (value === -1 && previous === 0);
    if (!rose) return no('count-did-not-rise');

    // A service that reshuffles its title must not be able to spam you.
    if (now - lastAlertAt < cooldownMs) return no('cooldown');

    if (value === -1) return { alert: true, body: 'New activity', reason: 'unread-marker' };

    // previous < 0 means we were on a dot and now have a real number; treat the
    // whole count as new rather than reporting a negative delta.
    const delta = previous > 0 ? value - previous : value;
    return {
      alert: true,
      body: delta === 1 ? '1 new notification' : `${delta} new notifications`,
      reason: 'count-rose',
    };
  }

  return { evaluateActivity, DEFAULT_COOLDOWN_MS };
});
