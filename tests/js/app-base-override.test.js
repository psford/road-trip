import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FETCH_AND_SWAP_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../src/bootstrap/fetchAndSwap.js'),
  'utf8'
);
const INTERCEPT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../src/bootstrap/intercept.js'),
  'utf8'
);

const PROD = 'https://app-roadtripmap-prod.azurewebsites.net';

function freshDom() {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete globalThis.FetchAndSwap;
  delete globalThis.Intercept;
}

describe('APP_BASE override via <meta name="app-base-override">', () => {
  beforeEach(() => freshDom());

  it('fetchAndSwap defaults to prod when meta tag is absent', () => {
    eval(FETCH_AND_SWAP_SRC);
    expect(globalThis.FetchAndSwap._APP_BASE).toBe(PROD + '/');
  });

  it('fetchAndSwap honors the meta override when present', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'app-base-override');
    meta.setAttribute('content', 'http://192.168.1.50:5100');
    document.head.appendChild(meta);
    eval(FETCH_AND_SWAP_SRC);
    expect(globalThis.FetchAndSwap._APP_BASE).toBe('http://192.168.1.50:5100/');
  });

  it('fetchAndSwap rejects non-http(s) override values (defense-in-depth)', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'app-base-override');
    meta.setAttribute('content', 'javascript:alert(1)');
    document.head.appendChild(meta);
    eval(FETCH_AND_SWAP_SRC);
    expect(globalThis.FetchAndSwap._APP_BASE).toBe(PROD + '/');
  });

  it('intercept defaults to prod when meta tag is absent', () => {
    eval(INTERCEPT_SRC);
    expect(globalThis.Intercept.APP_BASE).toBe(PROD);
  });

  it('intercept honors the meta override when present', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'app-base-override');
    meta.setAttribute('content', 'http://192.168.1.50:5100');
    document.head.appendChild(meta);
    eval(INTERCEPT_SRC);
    expect(globalThis.Intercept.APP_BASE).toBe('http://192.168.1.50:5100');
  });

  it('intercept rejects non-http(s) override (defense-in-depth)', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'app-base-override');
    meta.setAttribute('content', 'file:///etc/passwd');
    document.head.appendChild(meta);
    eval(INTERCEPT_SRC);
    expect(globalThis.Intercept.APP_BASE).toBe(PROD);
  });
});
