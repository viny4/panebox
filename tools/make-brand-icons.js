#!/usr/bin/env node
/**
 * Regenerates icons.js from the official brand paths in simple-icons.
 *
 * Brand marks are drawn from a maintained source rather than hand-written,
 * because approximated SVG paths look subtly wrong in a way that is hard to
 * spot in review and obvious on screen.
 *
 * simple-icons is a devDependency and is not shipped: this writes a plain
 * icons.js that is committed, so the app keeps zero runtime dependencies for
 * icons and never fetches one over the network. Run with `npm run brand-icons`.
 *
 * simple-icons artwork is CC0-1.0. A handful of brands (Slack, LinkedIn,
 * Microsoft, Google) were removed from it after trademark requests, so those
 * keep the hand-checked paths below.
 */

const fs = require('fs');
const path = require('path');
const si = require('simple-icons');
const CATALOG = require('../catalog');

/** catalog key -> simple-icons slug, where they differ. */
const SLUG = {
  chatgpt: 'openai',
  gemini: 'googlegemini',
  grok: 'x',
  mistral: 'mistralai',
  napkin: 'googlegemini',
  copilot: 'githubcopilot',
  gcalendar: 'googlecalendar',
  gdrive: 'googledrive',
  googlechat: 'googlechat',
  protonmail: 'proton',
  threads: 'threads',
  bluesky: 'bluesky',
  youtubemusic: 'youtubemusic',
};

/**
 * Brands simple-icons no longer carries. These paths were already in the
 * project and are left untouched; anything without an entry falls back to a
 * generated letter avatar, which is honest rather than approximate.
 */
const MANUAL = {
  chatgpt:
    '<svg viewBox="0 0 24 24" fill="#10a37f"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>',
  slack:
    '<svg viewBox="0 0 24 24"><path fill="#e01e5a" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522z"/><path fill="#36c5f0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521z"/><path fill="#2eb67d" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522z"/><path fill="#ecb22e" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523z"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" fill="#0a66c2"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.7a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z"/></svg>',
  gmail:
    '<svg viewBox="0 0 24 24"><path fill="#4285f4" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/><path fill="#ea4335" d="M5.455 11.73 0 7.64V5.457c0-2.023 2.309-3.178 3.927-1.964l1.528 1.146z"/><path fill="#34a853" d="m18.545 11.73 5.455-4.09V5.457c0-2.023-2.309-3.178-3.927-1.964l-1.528 1.146z"/></svg>',
};

function findIcon(key) {
  const slug = SLUG[key] || key;
  const camel = 'si' + slug.charAt(0).toUpperCase() + slug.slice(1);
  return si[camel] || Object.values(si).find((i) => i && i.slug === slug) || null;
}

const entries = [];
const generated = [];
const manual = [];
const fallback = [];

for (const service of CATALOG.SERVICES) {
  if (MANUAL[service.key]) {
    entries.push([service.key, MANUAL[service.key]]);
    manual.push(service.key);
    continue;
  }

  const icon = findIcon(service.key);
  if (!icon || !icon.path) {
    fallback.push(service.key);
    continue;
  }

  // Use the brand's own colour; white marks get currentColor so they stay
  // visible in light mode.
  const hex = `#${icon.hex}`.toLowerCase();
  const fill = hex === '#ffffff' || hex === '#000000' ? 'currentColor' : hex;
  entries.push([
    service.key,
    `<svg viewBox="0 0 24 24" fill="${fill}"><path d="${icon.path}"/></svg>`,
  ]);
  generated.push(service.key);
}

const body = entries
  .map(([key, svg]) => `    ${key}:\n      ${JSON.stringify(svg)},`)
  .join('\n');

const out = `/**
 * Brand marks for the service catalog.
 *
 * GENERATED FILE — do not edit by hand. Run \`npm run brand-icons\` to rebuild
 * from tools/make-brand-icons.js.
 *
 * Paths come from simple-icons (CC0-1.0), inlined at build time so the app
 * ships no icon dependency and never requests an icon over the network.
 * Services without an official mark fall back to a generated letter avatar,
 * and are upgraded to the site's own favicon once it loads.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ICONS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BRAND = {
${body}
  };

  /** Deterministic, network-free fallback: initials on the brand colour. */
  function letterAvatar(name, color) {
    const initials =
      String(name || '?')
        .replace(/[^\\p{L}\\p{N} ]/gu, '')
        .trim()
        .split(/\\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase() || '?';

    const bg = color && color !== '#ffffff' ? color : '#4b5563';
    return { initials, background: bg };
  }

  function has(key) {
    return Object.prototype.hasOwnProperty.call(BRAND, key);
  }

  return { BRAND, has, letterAvatar };
});
`;

fs.writeFileSync(path.join(__dirname, '..', 'icons.js'), out);

console.log(`official paths : ${generated.length}`);
console.log(`hand-checked   : ${manual.length}  (${manual.join(', ')})`);
console.log(`letter avatar  : ${fallback.length}  (${fallback.join(', ') || 'none'})`);
console.log(`total covered  : ${entries.length}/${CATALOG.SERVICES.length}`);
