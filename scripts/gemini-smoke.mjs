#!/usr/bin/env node
// One tiny structured call per model, to confirm the key and model names work before the full run.
//   node scripts/gemini-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { ask, MODELS } = await import('./lib/gemini-steps.mjs');
const schema = { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] };
for (const [tier, model] of Object.entries(MODELS)) {
  try {
    const { output, run } = await ask({ step: 'smoke', model, system: 'Answer in JSON.', prompt: 'Say ok=true and one word that means "connected".', schema, inputSummary: 'smoke' });
    console.log(`${tier} ${model}: OK ${JSON.stringify(output)} in ${run.ms} ms`);
  } catch (e) {
    console.log(`${tier} ${model}: FAILED ${String(e.message || e).slice(0, 300)}`);
    process.exitCode = 1;
  }
}
