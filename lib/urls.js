'use strict';

/**
 * Popup routing.
 *
 * Anything a service opens in a new window goes to the user's real browser —
 * except sign-in flows, which must stay inside the app because they depend on
 * the service's own session partition. Getting this wrong is the difference
 * between "Google login works" and an endless redirect loop.
 */

const AUTH_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.yahoo.com',
  'www.facebook.com',
  'm.facebook.com',
  'github.com',
  'gitlab.com',
  'api.twitter.com',
  'x.com',
  'twitter.com',
  'slack.com',
  'discord.com',
  'auth0.com',
  'okta.com',
  'duosecurity.com',
  'id.atlassian.com',
  'account.proton.me',
];

// Matched per path *segment*, not as a prefix: Microsoft puts the tenant first
// (/common/oauth2/authorize) and Google nests (/o/oauth2/v2/auth), so a
// startsWith check would miss both. Segment matching also avoids false
// positives like /someone/my-auth-library.
const AUTH_PATH_SEGMENTS = new Set([
  'oauth',
  'oauth2',
  'login',
  'signin',
  'sign-in',
  'sign_in',
  'auth',
  'authorize',
  'authorization',
  'sso',
  'session',
  'saml',
]);

function isAuthUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  const host = url.hostname.toLowerCase();
  const hostMatches = AUTH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!hostMatches) return false;

  // A bare github.com link in a README is not a login flow; require a hint in
  // the path (or an explicit OAuth query) before keeping it in-app.
  const pathMatches = url.pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some((segment) => AUTH_PATH_SEGMENTS.has(segment));
  const hasOauthParams =
    url.searchParams.has('client_id') ||
    url.searchParams.has('redirect_uri') ||
    url.searchParams.has('response_type');

  return pathMatches || hasOauthParams;
}

/**
 * Turns whatever a user typed into a URL we are willing to load, or null.
 *
 * Prefixing "https://" onto anything is too permissive on its own: "not a url"
 * becomes "https://not a url", which parses, gets percent-encoded, and lands a
 * permanently broken service in the sidebar named "Not%20a%20url". Likewise
 * "file:///etc/passwd" becomes "https://file:///etc/passwd" — harmless, but
 * still a dead entry the user has to work out how to remove.
 */
function normalizeServiceUrl(raw) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return null;

  // An explicit scheme that isn't http(s) is a refusal, not something to prefix.
  // "localhost:3000" is host:port, not a scheme, so a colon followed by digits
  // does not count — self-hosting a service is a legitimate thing to do here.
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  const isIpv6 = /^\[[0-9a-f:]+\]$/i.test(url.host);
  if (!isIpv6 && !/^[a-z0-9.-]+$/i.test(url.hostname)) return null; // spaces, %20, junk
  if (url.hostname.startsWith('.') || url.hostname.endsWith('.')) return null;

  // Bare words aren't hosts. localhost and IP literals are.
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
  if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !isIpv6) return null;
  if (!isIpv4 && !isIpv6 && url.hostname !== 'localhost' && !/\.[a-z]{2,}$/i.test(url.hostname)) {
    return null;
  }

  return url;
}

/** A readable default name from a URL: "https://www.notion.so/x" -> "Notion". */
function nameFromUrl(url) {
  const host = url.hostname.replace(/^www\./i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || url.host.startsWith('[')) return url.host;
  const label = host.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Google refuses sign-in from any browser it identifies as embedded, which
 * includes every Electron app. The user lands on a dead end that blames their
 * browser and offers nothing actionable, so we recognise it and say something
 * useful instead.
 *
 * This is detection, not circumvention — the block stands.
 */
function isEmbeddedBrowserRejection(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)google\.com$/.test(host) && !/(^|\.)accounts\.youtube\.com$/.test(host)) {
    return false;
  }
  return /\/signin\/rejected|\/deniedsigninrejected|\/InteractiveLogin\/rejected/i.test(
    parsed.pathname,
  );
}

/** Services that will never accept a sign-in from inside an app like this. */
const BLOCKS_EMBEDDED_SIGNIN = ['google.com', 'youtube.com', 'gmail.com'];

function blocksEmbeddedSignIn(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return false;
  }
  return BLOCKS_EMBEDDED_SIGNIN.some((d) => host === d || host.endsWith(`.${d}`));
}

const API = {
  isAuthUrl,
  AUTH_HOSTS,
  normalizeServiceUrl,
  nameFromUrl,
  isEmbeddedBrowserRejection,
  blocksEmbeddedSignIn,
};

if (typeof module === 'object' && module.exports) module.exports = API;
else if (typeof self !== 'undefined') self.URLS = API;
