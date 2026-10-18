#!/usr/bin/env node
// Turns data/seed.json into data/processed.json, the file the board reads.
//
//   node scripts/process-seed.mjs                 runs the six Gemini steps on every email (needs GEMINI_API_KEY in .env)
//   node scripts/process-seed.mjs --placeholder   no AI: uses the hand-written expected labels
//
// The page never calls Gemini. It only reads the saved result.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './lib/assemble.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8'));
const placeholder = process.argv.includes('--placeholder');
const out = path.join(root, 'data/processed.json');

// Minimal .env reader so the key never has to be typed on the command line.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let result;
if (placeholder) {
  const track = Object.fromEntries(seed.mails.map((m) => [m.id, { ...m.expected }]));
  result = assemble(seed, track, seed.expected_plans);
  result.generator = 'placeholder';
  result.note = 'Placeholder built from hand-written labels. No AI was used. Replaced by the Gemini run.';
} else {
  const { runGemini } = await import('./lib/gemini-run.mjs');
  const { MODELS } = await import('./lib/gemini-steps.mjs');
  const started = Date.now();
  const r = await runGemini(seed);
  result = assemble(seed, r.track, r.plans);
  for (const g of result.goals) {
    const src = r.goals.get(g.id);
    g.runs = src?.runs || [];
    g.draft = r.extra[g.id]?.draft || null;
    const last = g.stage_history[g.stage_history.length - 1];
    g.moved_reason = r.track[last.mail_id]?.reason || null;
  }
  for (const p of result.people) {
    p.facts = r.facts[p.id] || [];
    p.stage_reason = r.stageReason[p.id] || null;
  }
  const { relativizeResult } = await import('./lib/relative-dates.mjs');
  relativizeResult(result, result.generated_at);
  const { tidyResult } = await import('./lib/tidy.mjs');
  tidyResult(result);
  result.generator = 'gemini';
  const { score } = await import('./lib/score.mjs');
  result.score = score(seed, result);
  result.models = MODELS;
  result.run_seconds = Math.round((Date.now() - started) / 1000);
}

fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`wrote ${path.relative(root, out)} (${result.generator}): ${result.goals.length} items, ${result.mails.length} emails, ${result.people.length} people`);
