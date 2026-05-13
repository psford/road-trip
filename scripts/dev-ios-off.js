#!/usr/bin/env node
/**
 * Revert the iOS shell back to prod fetches. Strips the meta override and
 * removes server.url from capacitor.config.js. Idempotent.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SHELL_INDEX = path.join(REPO, 'src/bootstrap/index.html');
const CAP_CONFIG = path.join(REPO, 'capacitor.config.js');

let changed = false;

// --- 1. Strip the meta override line (preserve surrounding lines) ---
let html = fs.readFileSync(SHELL_INDEX, 'utf8');
// Match only space/tab whitespace inside the line, then require exactly one
// trailing newline. \s* would eat the next line's indent — don't use it here.
const metaLinePattern = /^[ \t]*<meta name="app-base-override"[^>]*>[ \t]*\n/m;
if (metaLinePattern.test(html)) {
  html = html.replace(metaLinePattern, '');
  fs.writeFileSync(SHELL_INDEX, html);
  changed = true;
  console.log('✓ Stripped <meta name="app-base-override"> from src/bootstrap/index.html');
}

// --- 2. Remove server.url and restore cleartext: false ---
let cfg = fs.readFileSync(CAP_CONFIG, 'utf8');
const urlLinePattern = /^[ \t]*url\s*:\s*['"][^'"]*['"]\s*,?[ \t]*\n/m;
if (urlLinePattern.test(cfg)) {
  cfg = cfg.replace(urlLinePattern, '');
  changed = true;
  console.log('✓ Removed server.url from capacitor.config.js');
}
// Restore cleartext: false (prod default) if it's currently true.
if (/^([ \t]*)cleartext\s*:\s*true(\s*,?)/m.test(cfg)) {
  cfg = cfg.replace(/^([ \t]*)cleartext\s*:\s*true(\s*,?)/m, '$1cleartext: false$2');
  changed = true;
  console.log('✓ Restored cleartext: false in capacitor.config.js');
}
if (changed) {
  fs.writeFileSync(CAP_CONFIG, cfg);
  console.log('\nDev config reverted. Run `npx cap sync ios` to push the prod config to the iOS project.');
} else {
  console.log('Nothing to revert — already in prod config state.');
}
