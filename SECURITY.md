# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private reporting instead: go to the Security tab → "Report a vulnerability". That opens a private thread visible only to the maintainers.

Please include what the issue is, how to reproduce it, and what an attacker could achieve. A proof of concept helps enormously.

You'll get an acknowledgement within a few days. This is a volunteer project, so please be patient — but if you've had no response in two weeks, feel free to nudge publicly without disclosing details.

## Supported versions

Only the latest release gets fixes. There are no long-term support branches.

## What Panebox's security model actually is

Panebox loads arbitrary third-party websites, so the boundaries matter. What's in place:

- The UI window runs with `contextIsolation: true` and `nodeIntegration: false`. There is no `require` and no `ipcRenderer` in the renderer — only the fixed allowlist in `preload.js`.
- Every `<webview>` is re-hardened in the main process via `will-attach-webview`, so a compromised renderer cannot attach a privileged one.
- All user-controlled strings render through `textContent`, never `innerHTML`.
- The page carries a strict CSP: no inline scripts, `connect-src 'none'`.
- Permissions are default-deny. Only what a web-app container needs is granted.
- Each service gets its own persistent session partition, so one service cannot read another's cookies or storage.

### Known limitations — please don't report these as vulnerabilities

**Custom JavaScript per service.** Panebox lets you paste JavaScript that runs inside a service, with full access to that service and your logged-in session. This is intentional, opt-in, off by default, and warned about in the UI. Only paste code you understand.

**Builds are unsigned and un-notarized.** Releases carry only an ad-hoc signature — enough for macOS to run them at all, but not a Developer ID. macOS will say it "could not verify Panebox is free of malware", and Windows will show SmartScreen. Both are accurate: nobody has vouched for these binaries. Verify what you download, or build from source.

Practically, this also means auto-update cannot install itself on macOS: Squirrel refuses to update an app without a valid signature, so macOS gets a notification and a download link instead.

**No sandboxing of service content beyond Chromium's own.** Panebox is a container around real websites. If a site is malicious, Chromium's sandbox and the session isolation above are what stand between it and you — the same as any browser.

**The update check contacts GitHub.** Once a day, Panebox asks the GitHub releases API whether a newer version exists. It sends no identifiers, and it can be turned off in Settings.

**Updates are verified by checksum, not signature.** On Windows and Linux, `electron-updater` downloads the new build and checks its SHA-512 against the value published in the release metadata, which is served over HTTPS from GitHub. That protects against corruption and tampering in transit, but it is not the same as a code signature: anyone who could publish to the GitHub release could publish a matching checksum. macOS does not auto-install at all, for the signing reason above.
