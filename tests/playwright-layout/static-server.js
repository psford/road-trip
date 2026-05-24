#!/usr/bin/env node
/**
 * Tiny static server for layout tests.
 *
 * Serves files from src/RoadTripMap/wwwroot, with route rewrites that mirror
 * production:
 *   /                  → wwwroot/index.html
 *   /create            → wwwroot/create.html
 *   /post/<token>      → wwwroot/post.html
 *   /trips/<viewToken> → wwwroot/trips.html
 *   /css/*, /js/*, /ios.css, etc. → wwwroot/<path>
 *
 * API endpoints (/api/*) are NOT handled here — the Playwright tests stub
 * them via page.route(). This keeps the server pure file delivery, no SQL,
 * no .NET runtime required.
 *
 * Listens on PORT (default 4123). Logs every request unless QUIET=1.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const REPO = path.resolve(__dirname, '..', '..');
const WWWROOT = path.join(REPO, 'src', 'RoadTripMap', 'wwwroot');
const PORT = Number(process.env.PORT || 4123);
const QUIET = process.env.QUIET === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function resolvePath(pathname) {
  // Route rewrites mirroring ASP.NET endpoint mapping.
  if (pathname === '/' || pathname === '') return path.join(WWWROOT, 'index.html');
  if (pathname === '/create' || pathname === '/create/') return path.join(WWWROOT, 'create.html');
  if (/^\/post\/[^/]+\/?$/.test(pathname)) return path.join(WWWROOT, 'post.html');
  if (/^\/trips\/[^/]+\/?$/.test(pathname)) return path.join(WWWROOT, 'trips.html');
  // Direct file access. Strip leading slash; reject path traversal.
  const safe = pathname.replace(/^\/+/, '');
  if (safe.includes('..')) return null;
  return path.join(WWWROOT, safe);
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);
  const filePath = resolvePath(pathname);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad path');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!QUIET) console.error(`[static] 404 ${pathname} -> ${filePath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
    if (!QUIET) console.log(`[static] 200 ${pathname}`);
  });
});

server.listen(PORT, () => {
  console.log(`Layout-test static server: http://127.0.0.1:${PORT} (serving ${WWWROOT})`);
});
