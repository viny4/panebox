/**
 * Unread-count heuristics.
 *
 * Modern services report exact counts through navigator.setAppBadge, which the
 * webview preload forwards verbatim. This is the fallback for everything else:
 * scraping the document title, the way every app in this category has always
 * done it.
 *
 * Returns a count, 0 for "nothing unread", or -1 for "unread, count unknown"
 * (rendered as a dot).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BADGE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function parseBadgeFromTitle(title) {
    const text = String(title == null ? '' : title);

    // "(3) WhatsApp", "(99+) X"
    const paren = text.match(/\(\s*(\d+)\+?\s*\)/);
    if (paren) return parseInt(paren[1], 10) || 0;

    // "[12] Slack"
    const bracket = text.match(/\[\s*(\d+)\+?\s*\]/);
    if (bracket) return parseInt(bracket[1], 10) || 0;

    // "5 new messages" — but not "2024 Annual Report", which is a page title,
    // so require the number to be followed by a lowercase word.
    const leading = text.match(/^\s*(\d+)\s+[a-z]/);
    if (leading) return parseInt(leading[1], 10) || 0;

    // "• Telegram" — unread marker with no count.
    if (/^\s*[•·*]/.test(text)) return -1;

    return 0;
  }

  return { parseBadgeFromTitle };
});
