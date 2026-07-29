/**
 * Version handling for the update check.
 *
 * Deliberately small: we only ever compare our own tags, which are plain
 * `vMAJOR.MINOR.PATCH`. Anything with a pre-release suffix is treated as older
 * than the same release version, so a `-beta` tag never prompts a stable user.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VERSION = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** "v2.1.0" / "2.1.0-beta.1" -> {parts: [2,1,0], prerelease: 'beta.1'|null} */
  function parse(input) {
    const raw = String(input == null ? '' : input).trim().replace(/^v/i, '');
    if (!raw) return null;

    const [core, ...rest] = raw.split('-');
    const parts = core.split('.').map((n) => parseInt(n, 10));
    if (!parts.length || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;

    while (parts.length < 3) parts.push(0);
    return { parts: parts.slice(0, 3), prerelease: rest.length ? rest.join('-') : null };
  }

  /** -1 if a < b, 0 if equal, 1 if a > b. Unparseable sorts lowest. */
  function compare(a, b) {
    const va = parse(a);
    const vb = parse(b);
    if (!va && !vb) return 0;
    if (!va) return -1;
    if (!vb) return 1;

    for (let i = 0; i < 3; i++) {
      if (va.parts[i] !== vb.parts[i]) return va.parts[i] > vb.parts[i] ? 1 : -1;
    }
    // 2.0.0 is newer than 2.0.0-beta.
    if (va.prerelease && !vb.prerelease) return -1;
    if (!va.prerelease && vb.prerelease) return 1;
    if (va.prerelease && vb.prerelease) {
      if (va.prerelease === vb.prerelease) return 0;
      return va.prerelease > vb.prerelease ? 1 : -1;
    }
    return 0;
  }

  function isNewer(candidate, current) {
    return compare(candidate, current) > 0;
  }

  /**
   * Pulls owner/repo out of a package.json repository URL. Returns null for the
   * placeholder so a freshly cloned, unconfigured checkout never fires requests
   * at a repository that doesn't exist.
   */
  function parseRepo(url) {
    const match = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (!match) return null;
    const [, owner, repo] = match;
    if (/^your[-_]?username$/i.test(owner)) return null;
    return { owner, repo };
  }

  return { parse, compare, isNewer, parseRepo };
});
