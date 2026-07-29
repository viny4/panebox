# Panebox

A small, private desktop deck for the web apps you keep open all day — ChatGPT, Claude, Gemini, Perplexity, WhatsApp, Gmail and ~50 more — each in its own isolated session, in one window.


<img width="1470" height="956" alt="image" src="https://github.com/user-attachments/assets/5f26ff31-b5ab-4632-bc7f-f693e3d04c88" />



## Why this exists

There are good multi-service containers already. [Ferdium](https://github.com/ferdium/ferdium-app) is the mature one — bigger service catalog, sync server, years of polish. If you want the most featureful open-source option, use Ferdium; it is genuinely better at being Ferdium.

Panebox is for two things Ferdium isn't aimed at:

1. **AI tools first.** The container category grew out of instant-messaging clients, so their defaults are Slack and Telegram. Panebox ships with ChatGPT, Claude, Gemini and Perplexity on the sidebar, and per-service session isolation means you can run two accounts of the same tool side by side without logging out.
2. **A codebase you can read in one sitting.** No framework, no bundler, no build step for development. Roughly 2,000 lines of plain JavaScript across eight files. If you want to change how it works, you can actually find the place.

If neither of those matters to you, Ferdium is the better tool. That's a real recommendation, not modesty.

## Features

**Services**
- ~50 built-in services across AI, messaging, mail, social, productivity, dev and media — plus any custom URL
- Isolated session per service by default, so two accounts of the same app coexist; switchable to a shared session
- Drag to reorder, per-service rename and URL editing
- Custom CSS and custom JavaScript per service

**Notifications**
- Native desktop notifications, forwarded from both the `Notification` API and service workers
- Clicking a notification focuses the app *and* replays the click into the service, so its own handler still opens the right thread
- Per-service disable, global Do Not Disturb, and a privacy mode that shows "New message" instead of the content
- Unread badges on the sidebar and the dock, from `navigator.setAppBadge` where the service supports it and title parsing where it doesn't

**Workspaces & performance**
- Group services into workspaces (Work / Personal) and switch between them
- Inactive services sleep after a configurable idle period to free memory; per-service opt-out for anything that must stay connected
- Built-in task manager showing per-service CPU and memory

**Window & editing**
- Light / dark / follow-system themes
- System tray, always-on-top, close-to-tray, custom window title
- Find in page, per-service mute, back/forward/reload
- Spellchecker with selectable dictionaries (macOS uses the system spellchecker)
- Screen and window sharing for Meet, Teams, Zoom and Discord
- Built-in todo panel

**Data**
- Everything is stored locally in one JSON file. No account, no server, no telemetry, no analytics, no crash reporting
- Export / import that config as a plain file to move between machines
- Update check asks GitHub once a day whether a newer release exists, sends no identifiers, and can be turned off

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl` + `1`–`9` | Jump to service |
| `Cmd/Ctrl` + `Tab` | Next service |
| `Cmd/Ctrl` + `Shift` + `Tab` | Previous service |
| `Cmd/Ctrl` + `R` | Reload service |
| `Cmd/Ctrl` + `Shift` + `R` | Restart Panebox |
| `Cmd/Ctrl` + `N` | Add a service |
| `Cmd/Ctrl` + `F` | Find in page |
| `Cmd/Ctrl` + `T` | Toggle todo panel |
| `Cmd/Ctrl` + `,` | Settings |
| `Cmd/Ctrl` + `Shift` + `M` | Task manager |

Right-click a sidebar icon to configure that service.

## Installing

Download the build for your platform from [Releases](https://github.com/viny4/panebox/releases).

Builds are **not code-signed**, because signing certificates cost money this project doesn't have. That means:

- **macOS** will say the app "cannot be opened because the developer cannot be verified". Right-click the app → Open → Open, or run `xattr -dr com.apple.quarantine /Applications/Panebox.app`.
- **Windows** will show a SmartScreen warning. Click "More info" → "Run anyway".

If that trade-off isn't acceptable to you, build from source — it takes two commands.

## Running from source

```bash
git clone https://github.com/viny4/panebox.git
cd panebox
npm install
npm start
```

Requires Node.js 20+. There is no build step for development — `npm start` runs the source directly.

```bash
npm test          # unit tests
npm run icons     # regenerate assets/ from tools/make-icons.js
npm run dist:mac  # package for the current platform (also dist:win, dist:linux)
```

## How it's put together

| File | Role |
| --- | --- |
| `main.js` | Main process: window, tray, menus, sessions, permissions, notifications, screen-share |
| `preload.js` | The only bridge the UI gets — a fixed allowlist of IPC calls |
| `webview-preload.js` | Runs inside each service; intercepts notifications and badge counts |
| `renderer.js` | All UI: tabs, webviews, sleeping, settings, workspaces, todo |
| `catalog.js` | The built-in service list |
| `lib/store.js` | Config file read/write with atomic replace |
| `lib/urls.js` | Decides whether a popup is a login flow (stays in-app) or a link (opens in your browser) |
| `lib/badge.js` | Unread-count parsing |
| `lib/activity.js` | Whether an unread-count change should raise a notification |
| `lib/version.js` | Version comparison for the update check |

### Security

This app loads arbitrary third-party web pages, so the boundaries matter:

- The UI window runs with `contextIsolation: true`, `nodeIntegration: false`. There is no `require` and no `ipcRenderer` in the renderer — only the allowlist in `preload.js`.
- Every `<webview>` is force-hardened in the main process via `will-attach-webview`, so a compromised renderer can't attach a privileged one.
- All user-controlled strings are rendered with `textContent`. The page has a strict CSP with no `unsafe-inline` for scripts and `connect-src 'none'`.
- Permissions are default-deny; only the set a web-app container actually needs is granted.
- Custom per-service JavaScript is opt-in, entered by you, and warned about in the UI.

Found a security problem? Please open an issue, or email the maintainer for anything sensitive.

### Privacy

No account. No server. No telemetry, analytics or crash reporting.

Panebox makes exactly one network request on its own behalf: once a day it asks the GitHub releases API whether a newer version exists. It sends no identifiers — GitHub sees an anonymous GET — and you can turn it off in Settings → General. Everything else on the network is the services you added, talking to their own servers. Icons are either bundled with the app or come from the service's own favicon — Panebox never calls a third-party favicon API, because doing so would leak the list of every service you use.

Your data lives in one file:

- macOS: `~/Library/Application Support/Panebox/config.json`
- Windows: `%APPDATA%\Panebox\config.json`
- Linux: `~/.config/Panebox/config.json`

Service logins live in Electron's per-partition storage next to it, never in that file.

## Updates

Panebox checks for updates once a day and on launch. What happens next depends on your platform:

| Platform | Behaviour |
| --- | --- |
| **Windows, Linux** | Downloads in the background, then shows "Restart to update". Same as VS Code. |
| **macOS** | Tells you a new version exists and opens the download page. |

macOS is the odd one out because Squirrel — the framework that applies updates — refuses to install over an app that isn't code-signed by a paid Apple Developer ID. Rather than ship something that silently works on two platforms and fails on the third, macOS gets an honest notification instead.

If you build Panebox yourself with a Developer ID, set `MAC_BUILD_IS_SIGNED = true` in `main.js` and macOS gets full auto-update with no other change.

Check manually any time with **Help → Check for Updates**, or turn the daily check off in Settings → General.

Releases are cut automatically when the version in `package.json` changes on `main`, so a new version reaches users without anyone running `git tag`.

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

Adding a service to the catalog is a one-line change in [`catalog.js`](catalog.js) and is the easiest first contribution. CI runs the full test suite on every pull request.

Please keep the codebase readable: no framework, no bundler, no dependencies beyond Electron itself.

## Prior art

Panebox exists because [Rambox](https://rambox.app) went closed-source and [Franz](https://meetfranz.com) went freemium. The projects that stayed free and open are worth your attention:

- **[Ferdium](https://github.com/ferdium/ferdium-app)** (Apache-2.0) — the most complete option
- **[ElectronIM](https://github.com/manusa/electronim)** (Apache-2.0) — minimal and privacy-focused
- **[Hamsket](https://github.com/TheGoddessInari/hamsket)** (GPL-3.0) — a fork of the last open-source Rambox

## License

[MIT](LICENSE)
