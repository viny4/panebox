<!--
Thanks for the pull request. Keep it focused — one change per PR is much
easier to review than five.
-->

## What does this change?

<!-- A sentence or two. If it fixes an issue, write "Fixes #123". -->

## Why?

<!-- What problem does it solve? For a bug fix, what was going wrong? -->

## How was it tested?

<!--
Say what you actually did, not what should work. "Ran it on macOS and switched
between four services" is more useful than "should be fine".
-->

## Checklist

- [ ] `npm test` passes
- [ ] No new runtime dependencies (Electron is the only one)
- [ ] No `innerHTML` used with user-controlled data
- [ ] Security model unchanged (`contextIsolation` on, `nodeIntegration` off)
- [ ] No telemetry, analytics, or third-party requests added
- [ ] Logic with real rules in it lives in `lib/` with tests

<!--
Changed the icons? Run `npm run icons` and commit assets/ — CI verifies the
committed PNGs match tools/make-icons.js.
-->
