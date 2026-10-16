// Rapport web server. Serves the board and the pre-processed demo data.
// It never calls Gemini: the AI work was done once by scripts/process-seed.mjs
// and saved to data/processed.json. Opening or clicking the page costs nothing.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataFile = path.join(root, 'data', 'processed.json');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Counted and logged so anyone can confirm the page triggers no model calls.
const geminiCalls = 0;

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const started = Date.now();
    res.on('finish', () => {
      console.log(JSON.stringify({ method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, gemini_calls: geminiCalls }));
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (url.pathname === '/healthz') return send(res, 200, JSON.stringify({ ok: true, gemini_calls: geminiCalls }), TYPES['.json']);

    if (url.pathname === '/data/processed.json') {
      return fs.readFile(dataFile, (err, buf) => (err ? send(res, 500, 'Demo data missing') : send(res, 200, buf, TYPES['.json'], { 'cache-control': 'no-cache' })));
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) return send(res, 404, 'Not found');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream', { 'cache-control': 'no-cache' });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, () => console.log(`Rapport on http://localhost:${port}`));
}
