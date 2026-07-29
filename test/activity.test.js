'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { evaluateActivity } = require('../lib/activity');

const NOW = 1_700_000_000_000;

/** Sensible defaults: a background service, everything enabled, no recent alert. */
function input(overrides = {}) {
  return {
    previous: 0,
    value: 1,
    isActive: false,
    notificationsEnabled: true,
    activityAlertsEnabled: true,
    dnd: false,
    lastAlertAt: 0,
    now: NOW,
    ...overrides,
  };
}

test('alerts when the unread count rises', () => {
  const r = evaluateActivity(input({ previous: 0, value: 1 }));
  assert.strictEqual(r.alert, true);
  assert.strictEqual(r.body, '1 new notification');
});

test('reports how many arrived, not the total', () => {
  const r = evaluateActivity(input({ previous: 2, value: 5 }));
  assert.strictEqual(r.alert, true);
  assert.strictEqual(r.body, '3 new notifications');
});

test('stays silent on the first reading', () => {
  // Opening LinkedIn with 5 unread is not 5 things arriving right now.
  const r = evaluateActivity(input({ previous: null, value: 5 }));
  assert.strictEqual(r.alert, false);
  assert.strictEqual(r.reason, 'first-reading');
});

test('stays silent when the count falls or holds', () => {
  assert.strictEqual(evaluateActivity(input({ previous: 5, value: 2 })).alert, false);
  assert.strictEqual(evaluateActivity(input({ previous: 3, value: 3 })).alert, false);
  assert.strictEqual(evaluateActivity(input({ previous: 4, value: 0 })).alert, false);
});

test('stays silent for the service you are looking at', () => {
  const r = evaluateActivity(input({ previous: 0, value: 3, isActive: true }));
  assert.strictEqual(r.alert, false);
  assert.strictEqual(r.reason, 'service-on-screen');
});

test('respects Do Not Disturb', () => {
  const r = evaluateActivity(input({ previous: 0, value: 9, dnd: true }));
  assert.strictEqual(r.alert, false);
  assert.strictEqual(r.reason, 'dnd');
});

test('respects the per-service notification and activity switches', () => {
  assert.strictEqual(
    evaluateActivity(input({ notificationsEnabled: false })).reason,
    'notifications-off',
  );
  assert.strictEqual(
    evaluateActivity(input({ activityAlertsEnabled: false })).reason,
    'activity-alerts-off',
  );
});

test('rate-limits a service that churns its title', () => {
  const recent = evaluateActivity(input({ previous: 1, value: 2, lastAlertAt: NOW - 5_000 }));
  assert.strictEqual(recent.alert, false);
  assert.strictEqual(recent.reason, 'cooldown');

  const later = evaluateActivity(input({ previous: 1, value: 2, lastAlertAt: NOW - 120_000 }));
  assert.strictEqual(later.alert, true);
});

test('handles the dot marker used by services with no number', () => {
  const r = evaluateActivity(input({ previous: 0, value: -1 }));
  assert.strictEqual(r.alert, true);
  assert.strictEqual(r.body, 'New activity');
});

test('a dot turning into a real count reports the whole count', () => {
  // previous is -1; a naive delta would be 3 - (-1) = 4.
  const r = evaluateActivity(input({ previous: -1, value: 3 }));
  assert.strictEqual(r.alert, true);
  assert.strictEqual(r.body, '3 new notifications');
});

test('a dot that stays a dot does not re-alert', () => {
  assert.strictEqual(evaluateActivity(input({ previous: -1, value: -1 })).alert, false);
});

test('clearing to zero never alerts', () => {
  assert.strictEqual(evaluateActivity(input({ previous: -1, value: 0 })).alert, false);
});
