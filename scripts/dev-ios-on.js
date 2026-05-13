#!/usr/bin/env node
/**
 * Configure the iOS shell to load from the local Mac dev server.
 *
 *  1. Detect Mac's LAN IP (en0 first, falls back to en1).
 *  2. Patch `src/bootstrap/index.html` — add/refresh `<meta name="app-base-override">`.
 *  3. Patch `capacitor.config.js` — add `server.url` + set `server.cleartext: true`.
 *  4. Print next steps.
 *
 * Reverse with: `node scripts/dev-ios-off.js`. Idempotent.
 *
 * Safety: a pre-commit hook (scripts/dev-ios-precommit.sh) blocks commits
 * containing either marker. The dev state lives in your working tree only.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const SHELL_INDEX = path.join(REPO, 'src/bootstrap/index.html');
const CAP_CONFIG = path.join(REPO, 'capacitor.config.js');
const DEV_PORT = process.env.DEV_PORT || '5100';

function lanIp() {
  for (const iface of ['en0', 'en1']) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* try next */ }
  }
  console.error('Could not detect LAN IP via ipconfig getifaddr en0/en1.');
  console.error('Pass it explicitly: DEV_IP=192.168.x.x node scripts/dev-ios-on.js');
  process.exit(1);
}

const ip = process.env.DEV_IP || lanIp();
const baseUrl = `http://${ip}:${DEV_PORT}`;
const metaTag = `  <meta name="app-base-override" content="${baseUrl}">`;

// --- 1. Patch src/bootstrap/index.html ---
let html = fs.readFileSync(SHELL_INDEX, 'utf8');
const metaLinePattern = /^[ \t]*<meta name="app-base-override"[^>]*>[ \t]*\n/m;
if (metaLinePattern.test(html)) {
  // Replace just the line content; preserve the newline.
  html = html.replace(metaLinePattern, `${metaTag}\n`);
} else {
  // Insert as its own line before the first <script> line, preserving the
  // surrounding indentation context.
  html = html.replace(/^([ \t]*)<script\b/m, (_m, indent) => `${metaTag}\n${indent}<script`);
}
fs.writeFileSync(SHELL_INDEX, html);

// --- 2. Patch capacitor.config.js ---
let cfg = fs.readFileSync(CAP_CONFIG, 'utf8');

// 2a. Ensure server.url exists (or replace existing).
if (/^\s*url\s*:\s*['"][^'"]*['"]\s*,?\s*$/m.test(cfg)) {
  cfg = cfg.replace(/^(\s*)url\s*:\s*['"][^'"]*['"](\s*,?)\s*$/m, `$1url: '${baseUrl}'$2`);
} else {
  // Inject `url: '...'` as the first property inside the server block.
  cfg = cfg.replace(/(server\s*:\s*\{)([ \t]*\n)/, `$1$2    url: '${baseUrl}',\n`);
}

// 2b. Set cleartext to true (or insert it if missing).
if (/^\s*cleartext\s*:\s*(true|false)\s*,?\s*$/m.test(cfg)) {
  cfg = cfg.replace(/^(\s*)cleartext\s*:\s*(true|false)(\s*,?)\s*$/m, '$1cleartext: true$3');
} else {
  // Add cleartext after url
  cfg = cfg.replace(/(url\s*:\s*['"][^'"]*['"],)([ \t]*\n)/, `$1$2    cleartext: true,\n`);
}

fs.writeFileSync(CAP_CONFIG, cfg);

console.log(`✓ Dev mode enabled. iOS shell will fetch from ${baseUrl}\n`);
console.log('Next steps:');
console.log(`  1. In another terminal:   dotnet run --project src/RoadTripMap --urls "http://0.0.0.0:${DEV_PORT}"`);
console.log('  2. Sync to iOS project:   npx cap sync ios');
console.log('  3. Build/run in Xcode (real device must be on same Wi-Fi as Mac).');
console.log('  4. Edit wwwroot/* freely. Reload page in WKWebView to see changes.');
console.log('\nWhen done:                node scripts/dev-ios-off.js');
console.log('To commit:                run scripts/dev-ios-off.js first (a pre-commit hook will block otherwise).');
