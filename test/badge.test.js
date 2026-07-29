'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseBadgeFromTitle } = require('../lib/badge');

test('reads parenthesised counts', () => {
  assert.strictEqual(parseBadgeFromTitle('(3) WhatsApp'), 3);
  assert.strictEqual(parseBadgeFromTitle('(99+) X'), 99);
  assert.strictEqual(parseBadgeFromTitle('Inbox (1) - user@example.com - Gmail'), 1);
});

test('reads bracketed counts', () => {
  assert.strictEqual(parseBadgeFromTitle('[12] Slack'), 12);
});

test('reads leading counts followed by a word', () => {
  assert.strictEqual(parseBadgeFromTitle('5 new messages'), 5);
});

test('does not mistake a year or figure in a page title for a count', () => {
  assert.strictEqual(parseBadgeFromTitle('2024 Annual Report'), 0);
  assert.strictEqual(parseBadgeFromTitle('42 U.S. States'), 0);
});

test('treats a bullet prefix as unread-with-unknown-count', () => {
  assert.strictEqual(parseBadgeFromTitle('• Telegram'), -1);
  assert.strictEqual(parseBadgeFromTitle('* Discord'), -1);
});

test('returns zero for ordinary titles and empty input', () => {
  assert.strictEqual(parseBadgeFromTitle('Gmail'), 0);
  assert.strictEqual(parseBadgeFromTitle(''), 0);
  assert.strictEqual(parseBadgeFromTitle(null), 0);
  assert.strictEqual(parseBadgeFromTitle(undefined), 0);
});

test('ignores a zero count', () => {
  assert.strictEqual(parseBadgeFromTitle('(0) Messenger'), 0);
});
