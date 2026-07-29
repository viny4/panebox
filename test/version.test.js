'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parse, compare, isNewer, parseRepo } = require('../lib/version');

test('parses tags with and without a leading v', () => {
  assert.deepStrictEqual(parse('v2.1.0').parts, [2, 1, 0]);
  assert.deepStrictEqual(parse('2.1.0').parts, [2, 1, 0]);
});

test('pads short versions', () => {
  assert.deepStrictEqual(parse('v3').parts, [3, 0, 0]);
  assert.deepStrictEqual(parse('v3.2').parts, [3, 2, 0]);
});

test('rejects nonsense', () => {
  assert.strictEqual(parse(''), null);
  assert.strictEqual(parse('latest'), null);
  assert.strictEqual(parse(null), null);
});

test('orders by major, then minor, then patch', () => {
  assert.strictEqual(compare('2.0.0', '1.9.9'), 1);
  assert.strictEqual(compare('2.1.0', '2.0.9'), 1);
  assert.strictEqual(compare('2.0.1', '2.0.0'), 1);
  assert.strictEqual(compare('2.0.0', '2.0.0'), 0);
});

test('compares numerically, not as strings', () => {
  // The classic bug: "10" < "9" alphabetically.
  assert.strictEqual(compare('2.10.0', '2.9.0'), 1);
  assert.strictEqual(isNewer('v2.10.0', 'v2.9.0'), true);
});

test('a stable release beats its own pre-release', () => {
  assert.strictEqual(compare('2.0.0', '2.0.0-beta.1'), 1);
  assert.strictEqual(isNewer('2.0.0-beta.1', '2.0.0'), false);
});

test('only prompts when the release is genuinely newer', () => {
  assert.strictEqual(isNewer('v2.1.0', 'v2.0.0'), true);
  assert.strictEqual(isNewer('v2.0.0', 'v2.0.0'), false);
  assert.strictEqual(isNewer('v1.9.0', 'v2.0.0'), false);
});

test('a malformed remote tag never triggers an update prompt', () => {
  assert.strictEqual(isNewer('garbage', '2.0.0'), false);
  assert.strictEqual(isNewer(undefined, '2.0.0'), false);
});

test('extracts owner and repo from a github url', () => {
  assert.deepStrictEqual(parseRepo('git+https://github.com/someone/panebox.git'), {
    owner: 'someone',
    repo: 'panebox',
  });
  assert.deepStrictEqual(parseRepo('https://github.com/someone/panebox'), {
    owner: 'someone',
    repo: 'panebox',
  });
});

test('refuses to resolve the placeholder repository', () => {
  // Guards against a fresh clone pinging a repo that does not exist.
  assert.strictEqual(parseRepo('git+https://github.com/YOUR-USERNAME/panebox.git'), null);
  assert.strictEqual(parseRepo('https://example.com/not/github'), null);
  assert.strictEqual(parseRepo(''), null);
});
