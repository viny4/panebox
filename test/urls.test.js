'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isAuthUrl } = require('../lib/urls');

test('keeps real sign-in flows inside the app', () => {
  assert.ok(isAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc'));
  assert.ok(isAuthUrl('https://login.microsoftonline.com/common/oauth2/authorize'));
  assert.ok(isAuthUrl('https://github.com/login/oauth/authorize?client_id=x'));
  assert.ok(isAuthUrl('https://appleid.apple.com/auth/authorize?response_type=code'));
});

test('sends ordinary links on a known host to the browser', () => {
  // The classic bug: a README link opening in a cramped popup window.
  assert.ok(!isAuthUrl('https://github.com/someone/some-repo'));
  assert.ok(!isAuthUrl('https://x.com/someuser/status/12345'));
});

test('sends unrelated hosts to the browser', () => {
  assert.ok(!isAuthUrl('https://example.com/login'));
  assert.ok(!isAuthUrl('https://news.ycombinator.com'));
});

test('recognises OAuth by query parameters even without a path hint', () => {
  assert.ok(isAuthUrl('https://slack.com/anything?client_id=1&redirect_uri=2'));
});

test('matches subdomains of known auth hosts but not lookalikes', () => {
  assert.ok(isAuthUrl('https://id.atlassian.com/login'));
  assert.ok(!isAuthUrl('https://github.com.evil.example/login'));
});

test('rejects non-http schemes and malformed input', () => {
  assert.ok(!isAuthUrl('javascript:alert(1)'));
  assert.ok(!isAuthUrl('file:///etc/passwd'));
  assert.ok(!isAuthUrl('not a url'));
  assert.ok(!isAuthUrl(''));
});

// --- normalizeServiceUrl -----------------------------------------------------

const { normalizeServiceUrl, nameFromUrl } = require('../lib/urls');

test('accepts a bare hostname and assumes https', () => {
  assert.strictEqual(normalizeServiceUrl('notion.so').href, 'https://notion.so/');
});

test('keeps an explicit http url as http', () => {
  assert.strictEqual(normalizeServiceUrl('http://intranet.local/x').protocol, 'http:');
});

test('rejects input that is not a web address', () => {
  // "not a url" used to become https://not%20a%20url and land a dead service.
  for (const bad of ['not a url', 'foo', '', '   ', null, undefined]) {
    assert.strictEqual(normalizeServiceUrl(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('rejects non-http schemes', () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<h1>x', 'mailto:a@b.c']) {
    assert.strictEqual(normalizeServiceUrl(bad), null, `should reject ${bad}`);
  }
});

test('allows self-hosted services on localhost and IPs', () => {
  // "localhost:3000" must read as host:port, not as a scheme.
  assert.strictEqual(normalizeServiceUrl('localhost:3000').href, 'https://localhost:3000/');
  assert.strictEqual(normalizeServiceUrl('http://localhost:8080').port, '8080');
  assert.ok(normalizeServiceUrl('https://192.168.1.5:8080/wiki'));
});

test('trims surrounding whitespace', () => {
  assert.strictEqual(normalizeServiceUrl('  spaced.com  ').href, 'https://spaced.com/');
});

test('derives a readable name', () => {
  assert.strictEqual(nameFromUrl(normalizeServiceUrl('https://www.notion.so/x')), 'Notion');
  assert.strictEqual(nameFromUrl(normalizeServiceUrl('sub.domain.co.uk')), 'Sub');
  assert.strictEqual(nameFromUrl(normalizeServiceUrl('https://192.168.1.5:8080')), '192.168.1.5:8080');
});
