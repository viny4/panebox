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
