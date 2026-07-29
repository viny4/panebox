'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Ad-hoc signs the macOS app after packaging.
 *
 * Without this, the bundle keeps the signature Electron shipped with, which no
 * longer matches once electron-builder renames it and swaps in our app.asar.
 * macOS then reports:
 *
 *     "Panebox.app is damaged and can't be opened."
 *
 * which sounds like a corrupt download but is really Gatekeeper rejecting a
 * broken signature on a quarantined app. Apple Silicon requires every binary to
 * carry at least an ad-hoc signature, so an unsigned build cannot launch at all.
 *
 * An ad-hoc signature ("-") is not a Developer ID: users still see a warning on
 * first launch and still need to allow the app. But it turns an app that cannot
 * be opened at all into one that can be opened after a right-click, which is the
 * difference between a usable release and a broken one.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  try {
    // --deep is discouraged by Apple for real signing, but for an ad-hoc pass
    // over nested helpers and frameworks it is the pragmatic option.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'inherit',
    });
    console.log(`  • ad-hoc signed  ${appPath}`);
  } catch (err) {
    // Better a loud failure here than shipping a release nobody can open.
    throw new Error(`Ad-hoc signing failed for ${appPath}: ${err.message}`);
  }
};
