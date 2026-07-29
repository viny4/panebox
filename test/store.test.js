'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, defaultConfig } = require('../lib/store');
const CATALOG = require('../catalog');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panebox-test-'));
  return path.join(dir, 'config.json');
}

// The store debounces writes by 150ms; give it room before reading back.
const flushed = () => new Promise((r) => setTimeout(r, 250));

test('seeds a usable default config', () => {
  const store = createStore(tempFile());
  assert.ok(store.get('apps').length > 0);
  assert.strictEqual(store.get('settings.theme'), 'system');
  assert.strictEqual(store.get('activeWorkspace'), 'ws-all');
});

test('defaults reference real catalog entries', () => {
  for (const key of CATALOG.DEFAULT_KEYS) {
    assert.ok(CATALOG.byKey(key), `default key "${key}" is missing from the catalog`);
  }
});

test('every catalog service has a unique key and a valid https url', () => {
  const seen = new Set();
  for (const service of CATALOG.SERVICES) {
    assert.ok(!seen.has(service.key), `duplicate catalog key: ${service.key}`);
    seen.add(service.key);
    assert.match(service.url, /^https:\/\//, `${service.key} must use https`);
    assert.ok(CATALOG.CATEGORIES.includes(service.category), `${service.key} has an unknown category`);
  }
});

test('sets and reads nested keys', () => {
  const store = createStore(tempFile());
  store.set('settings.hibernateAfterMinutes', 42);
  assert.strictEqual(store.get('settings.hibernateAfterMinutes'), 42);
});

test('persists to disk and reloads', async () => {
  const file = tempFile();
  const store = createStore(file);
  store.set('settings.windowTitle', 'Custom Title');
  await flushed();

  const reloaded = createStore(file);
  assert.strictEqual(reloaded.get('settings.windowTitle'), 'Custom Title');
});

test('merging keeps unrelated settings intact', () => {
  const store = createStore(tempFile());
  store.merge({ settings: { dnd: true } });
  assert.strictEqual(store.get('settings.dnd'), true);
  assert.strictEqual(store.get('settings.theme'), 'system');
});

test('arrays are replaced, not concatenated', () => {
  const store = createStore(tempFile());
  store.merge({ apps: [{ id: 'only', name: 'Only', url: 'https://a.test' }] });
  assert.strictEqual(store.get('apps').length, 1);
});

test('an older config gains newly added settings keys', async () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ version: 1, apps: [], settings: { theme: 'dark' } }));

  const store = createStore(file);
  assert.strictEqual(store.get('settings.theme'), 'dark', 'existing value is kept');
  assert.strictEqual(
    store.get('settings.hibernateAfterMinutes'),
    defaultConfig().settings.hibernateAfterMinutes,
    'missing key is filled from defaults',
  );
});

test('a corrupt config falls back to defaults instead of crashing', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{ this is not json');
  const store = createStore(file);
  assert.ok(store.get('apps').length > 0);
});

test('replace() swaps the config wholesale', () => {
  const store = createStore(tempFile());
  store.replace({ apps: [{ id: 'x', name: 'X', url: 'https://x.test' }], settings: { theme: 'light' } });
  assert.strictEqual(store.get('apps').length, 1);
  assert.strictEqual(store.get('settings.theme'), 'light');
});

test('a corrupt config is preserved, not silently overwritten', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ apps: [{ id: 'mine', name: 'Mine', url: 'https://a.test' }] }));

  // Load once so a backup exists, then corrupt the live file.
  createStore(file);
  fs.writeFileSync(file, '{ truncated wri');

  const store = createStore(file);

  const dir = path.dirname(file);
  const quarantined = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(quarantined.length, 1, 'the unreadable file must be kept, not discarded');

  // And the last good state comes back rather than defaults.
  assert.strictEqual(store.get('apps').length, 1);
  assert.strictEqual(store.get('apps')[0].name, 'Mine');
});

test('a good load leaves a backup behind', async () => {
  const file = tempFile();
  const store = createStore(file);
  store.set('settings.windowTitle', 'Keep me');
  await flushed();

  createStore(file); // second load writes the backup
  assert.ok(fs.existsSync(`${file}.backup`), 'expected a .backup alongside the config');
});
