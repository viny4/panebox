'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SHORTCUTS = require('../lib/shortcuts');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

/** "CmdOrCtrl+Shift+S" -> "mod+shift+s", so both sides compare the same way. */
function normalize(accelerator) {
  return accelerator
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === 'cmdorctrl' || p === 'cmd' || p === 'command' || p === 'mod') return 'mod';
      if (p === 'ctrl' || p === 'control') return 'ctrl';
      if (p === 'alt' || p === 'option') return 'alt';
      return p;
    })
    .sort()
    .join('+');
}

function documented() {
  const out = new Set();
  for (const section of SHORTCUTS.SECTIONS) {
    for (const item of section.items) {
      for (const combo of [item.keys, item.mac, item.win]) {
        if (Array.isArray(combo)) out.add(normalize(combo.join('+')));
      }
    }
  }
  return out;
}

test('every accelerator in the application menu is documented', () => {
  // Without this the Shortcuts tab drifts: a binding changes in main.js and the
  // list keeps advertising the old key, which is worse than no list at all.
  const listed = documented();
  const missing = [];

  // Only the value that follows `accelerator:` — a line-wide scan also picked
  // up labels and IPC channel names. Both branches of a ternary count, since
  // `accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I'` went undocumented
  // behind a simpler pattern.
  const accelerators = [];
  for (const m of mainJs.matchAll(/accelerator:\s*'([^']+)'/g)) accelerators.push(m[1]);
  for (const m of mainJs.matchAll(/accelerator:[^'\n]*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
    accelerators.push(m[1], m[2]);
  }

  for (const accel of accelerators) {
    // Roles GitHub/Electron provide for free and that users already know.
    if (/^(CmdOrCtrl\+(C|V|X|Z|A))$/i.test(accel)) continue;
    if (!listed.has(normalize(accel))) missing.push(accel);
  }

  assert.deepStrictEqual(
    missing,
    [],
    `menu accelerators missing from lib/shortcuts.js:\n  ${missing.join('\n  ')}`,
  );
});

test('the number-key shortcut is documented', () => {
  // Handled in the renderer rather than the menu, so the scan above misses it.
  assert.ok(rendererJs.includes("e.key >= '1' && e.key <= '9'"), 'renderer still binds 1-9');
  assert.ok(documented().has(normalize('mod+1')), 'Shortcuts tab must mention it');
});

test('both platforms are listed for every keyboard row', () => {
  for (const section of SHORTCUTS.rows()) {
    if (section.mouse) continue;
    for (const item of section.items) {
      assert.ok(
        item.mac !== undefined && item.win !== undefined,
        `${item.label} must state both platforms, even if one is null`,
      );
    }
  }
});

test('a binding that does not exist on a platform renders as unbound', () => {
  // Electron's quit role registers no accelerator on Windows or Linux, so
  // claiming Ctrl+Q there would be inventing one.
  const quit = SHORTCUTS.rows()
    .flatMap((s) => s.items)
    .find((i) => i.label === 'Quit');
  assert.deepStrictEqual(SHORTCUTS.render(quit.mac, true), ['⌘', 'Q']);
  assert.strictEqual(SHORTCUTS.render(quit.win, false), null);
});

test('platform-specific keys render differently where they differ', () => {
  const devtools = SHORTCUTS.rows()
    .flatMap((s) => s.items)
    .find((i) => i.label === 'Developer tools');
  assert.deepStrictEqual(SHORTCUTS.render(devtools.mac, true), ['⌥', '⌘', 'I']);
  assert.deepStrictEqual(SHORTCUTS.render(devtools.win, false), ['Ctrl', 'Shift', 'I']);
});

test('keys render with the right symbols per platform', () => {
  assert.strictEqual(SHORTCUTS.keyLabel('mod', true), '⌘');
  assert.strictEqual(SHORTCUTS.keyLabel('mod', false), 'Ctrl');
  assert.strictEqual(SHORTCUTS.keyLabel('shift', true), '⇧');
  assert.strictEqual(SHORTCUTS.keyLabel('shift', false), 'Shift');
  assert.strictEqual(SHORTCUTS.keyLabel('S', true), 'S');
});

test('every documented shortcut has a description', () => {
  for (const section of SHORTCUTS.SECTIONS) {
    for (const item of section.items) {
      assert.ok(item.label && item.label.length > 3, `missing label in ${section.title}`);
      const hasKeys = item.keys || item.mac || item.win;
      assert.ok(hasKeys || item.gesture, `${item.label} has neither keys nor a gesture`);
    }
  }
});
