# Contributing to Panebox

Thanks for being here. Panebox is deliberately small — two runtime dependencies — and the goal is to keep it that way: a codebase someone can read in one sitting.

## Getting set up

```bash
git clone https://github.com/viny4/panebox.git
cd panebox
npm install
npm start
```

Requires Node.js 20+. There is no build step — `npm start` runs the source directly. Edit a file, restart, see the change.

```bash
npm test              # unit tests
npm run icons         # regenerate assets/ from tools/make-icons.js
npm run icons:check   # verify committed icons match their source
npm run dist:mac      # package for your platform (also dist:win, dist:linux)
```

## The easiest first contribution: add a service

Adding a service to the catalog is a one-line change in [`catalog.js`](catalog.js):

```js
{ key: 'linear', name: 'Linear', url: 'https://linear.app', category: 'Productivity', color: '#5e6ad2' },
```

- `key` must be unique and lowercase
- `url` must be `https://`
- `category` must be one of the values in `CATEGORIES`
- `color` is only used for the generated letter avatar shown before the service reports its own favicon

`npm test` enforces all four of those. No icon file is needed: run `npm run brand-icons` and, if simple-icons carries that brand, its official mark is inlined into `icons.js` automatically. Otherwise the service gets a letter avatar until the site reports its own favicon.

`icons.js` is generated — edit `tools/make-brand-icons.js`, never `icons.js` itself.

## Project layout

| File | Role |
| --- | --- |
| `main.js` | Main process: window, tray, menus, sessions, permissions, notifications, screen share, update check |
| `preload.js` | The only bridge the UI gets — a fixed allowlist of IPC calls |
| `webview-preload.js` | Runs inside each service; intercepts notifications and badge counts |
| `renderer.js` | All UI: tabs, webviews, sleeping, settings, workspaces, todo |
| `catalog.js` | The built-in service list |
| `lib/store.js` | Config file read/write, atomic replace |
| `lib/urls.js` | Whether a popup is a login flow (stays in-app) or a link (opens in your browser) |
| `lib/badge.js` | Unread-count parsing from page titles |
| `lib/activity.js` | Whether a count change should raise a notification |
| `lib/version.js` | Version comparison for the update check |
| `tools/make-icons.js` | Generates `assets/` from code; `--check` verifies they still match |

Anything in `lib/` is a pure function with no Electron imports — that's what makes it testable. If you're adding logic with real rules in it, put the decision in `lib/` and let `main.js` or `renderer.js` call it.

## Ground rules

**No new runtime dependencies.** There are exactly two — Electron, and `electron-updater` for in-app updates — and adding a third needs a very good reason. If you need a utility, write the twenty lines.

**No framework, no bundler.** Plain JavaScript, plain DOM.

**Never use `innerHTML` with user-controlled data.** Service names and URLs come from the user and go through `textContent` or element properties. The only `innerHTML` in the codebase is for the static brand SVGs bundled in `icons.js`. This isn't style preference — it's the difference between a bug and a remote code execution, because the renderer sits next to `<webview>` elements loading arbitrary sites.

**Don't loosen the security model.** `contextIsolation: true` and `nodeIntegration: false` stay on. New privileged capability goes through an explicit channel in `preload.js`, never a general-purpose escape hatch.

**No telemetry, ever.** No analytics, no crash reporting, no phone-home. The one network request Panebox makes on its own behalf is the update check, it sends no identifiers, and it can be turned off. Adding a third-party favicon service also counts as a leak — it would expose the list of every service a user has added.

## Style

Two-space indent, single quotes, semicolons, trailing commas. Prettier defaults.

Comments should explain *why*, not *what*. `// increment counter` is noise; `// Loopback audio capture is Windows-only` is worth a reader's time.

## Pull requests

1. Fork, then branch off **`dev`** — not `main`
2. Make the change, add tests if there's logic to test
3. Run `npm test`
4. Open the PR **against `dev`**, with a description of what changed and why

`main` is the release line and only ever moves via a reviewed merge from `dev`. PRs opened against `main` will be asked to retarget.

CI runs the full test suite and the icon check on every PR. Green before review, please.

Keep PRs focused. One change per PR is much easier to review than five.

## Releasing (maintainers)

Releases are automatic. Bump the version, merge to `main`, and CI does the rest:

```bash
npm version minor      # or patch / major — commits the bump
git push
# then merge dev -> main
```

CI notices the version changed, builds all three platforms, uploads them to a
draft release along with the update metadata, and publishes it once every
platform succeeds. No manual tagging.

Pushing to `main` *without* a version bump only runs the tests and a packaging
smoke test — it does not release.

## Reporting bugs

Please include your OS and version, your Panebox version (Help → About), which service it happened on, and the steps to reproduce. Screenshots help.

For **security issues**, please don't open a public issue — see [SECURITY.md](SECURITY.md).

## What Panebox is not

It helps to know where the line is:

- Not a browser. There's no address bar you can type into, no tab management, no extensions.
- Not a scraper. Panebox reads a page title for unread counts and nothing else.
- Not a sync service. Config is a local JSON file; export and import move it between machines.

Features that require a server are out of scope. That constraint is what keeps the project free and private.
