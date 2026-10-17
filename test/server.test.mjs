import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('page carries a link preview with an absolute image address', async () => {
  const html = await (await fetch(`${base}/`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'rapport.example.run.app' } })).text();
  assert.match(html, /<meta property="og:image" content="https:\/\/rapport\.example\.run\.app\/og\.png">/);
  assert.doesNotMatch(html, /__ORIGIN__/);
});

test('a strange host header does not end up in the page', async () => {
  const html = await (await fetch(`${base}/`, { headers: { 'x-forwarded-host': 'evil.example"><script>' } })).text();
  assert.match(html, /content="\/og\.png"/);
  assert.doesNotMatch(html, /<script>/);
});

test('preview image is served as a png', async () => {
  const res = await fetch(`${base}/og.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
});

test('server reports zero Gemini calls', async () => {
  const body = await (await fetch(`${base}/healthz`)).json();
  assert.deepEqual(body, { ok: true, gemini_calls: 0 });
});

test('files outside the public folder are not served', async () => {
  const res = await fetch(`${base}/..%2Fserver.mjs`);
  assert.equal(res.status, 404);
});
