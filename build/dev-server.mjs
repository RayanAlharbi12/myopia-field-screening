#!/usr/bin/env node
// Local development server: serves the source files directly (no build step).
//   npm run dev            -> http://localhost:5173
// vendor/supabase.js is served from node_modules (run `npm install` once).
// The service worker is disabled in development.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function supabaseUmd() {
  const dir = join(ROOT, 'node_modules', '@supabase', 'supabase-js');
  if (!existsSync(join(dir, 'package.json'))) return null;
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const c of [p.jsdelivr, p.unpkg, 'dist/umd/supabase.js'].filter(Boolean)) {
    const f = join(dir, c.replace(/^\.\//, ''));
    if (existsSync(f)) return f;
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  if (path === '/sw.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end('/* development: no offline cache */ self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", () => self.registration.unregister());');
    return;
  }
  if (path === '/vendor/supabase.js') {
    const f = supabaseUmd();
    if (!f) { res.writeHead(500, { 'Content-Type': TYPES['.js'] }); res.end('console.error("supabase-js missing: run npm install");'); return; }
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(readFileSync(f));
    return;
  }
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || /node_modules|\/supabase\/|\/tests\/|\/build\//.test(file.slice(ROOT.length)) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Myopia Field Screening (development) → http://localhost:${PORT}`));
