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

module.exports = { isAuthUrl, AUTH_HOSTS };
