'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards the contract between renderer.js and index.html.
 *
 * `$('some-id')` returns null when the element is missing, and calling
 * `.addEventListener` on null throws — which aborts the rest of the
 * DOMContentLoaded handler and silently kills every listener registered after
 * it. That shipped once: index.html dropped a button while renderer.js kept
 * wiring it, and the workspace dropdown, settings, task manager, modals and
 * keyboard shortcuts all stopped working with no visible error.
 *
 * It is a one-line mistake with an enormous blast radius, so it gets a test.
 */

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/** Every id="..." declared in index.html. */
function declaredIds() {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/** Every literal $('...') lookup in renderer.js, with its line number. */
function referencedIds() {
  const refs = [];
  renderer.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\$\('([^']+)'\)/g)) {
      refs.push({ id: m[1], line: i + 1 });
    }
  });
  return refs;
}

test('index.html declares every element renderer.js looks up', () => {
  const declared = declaredIds();
  const missing = referencedIds().filter((r) => !declared.has(r.id));

  assert.deepStrictEqual(
    missing,
    [],
    `renderer.js references ids that index.html does not define:\n` +
      missing.map((m) => `  line ${m.line}: $('${m.id}')`).join('\n') +
      `\n\nThis throws at runtime and silently disables every listener wired after it.`,
  );
});

test('renderer.js does not reference the removed footer add button', () => {
  // Specific regression: the button moved into the service list.
  assert.ok(
    !renderer.includes('btn-add-app'),
    'btn-add-app was replaced by the inline .app-add-tile',
  );
});

test('the inline add tile is wired up', () => {
  assert.ok(renderer.includes('app-add-tile'), 'renderer.js must create the add tile');
  assert.ok(
    fs.readFileSync(path.join(root, 'styles.css'), 'utf8').includes('.app-add-tile'),
    'styles.css must style the add tile',
  );
});

test('every script index.html loads actually exists', () => {
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    const file = path.join(root, m[1]);
    assert.ok(fs.existsSync(file), `index.html loads ${m[1]}, which is missing`);
  }
});

test('every file index.html loads is included in the packaged build', () => {
  const files = require(path.join(root, 'package.json')).build.files;
  const covered = (rel) =>
    files.some(
      (pattern) =>
        pattern === rel ||
        (pattern.endsWith('/**/*') && rel.startsWith(pattern.slice(0, -5))),
    );

  const assets = [
    ...[...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  ];

  for (const rel of assets) {
    assert.ok(covered(rel), `${rel} is loaded by index.html but not in build.files`);
  }
});
