#!/usr/bin/env node
// Turns data/seed.json into data/processed.json, the file the board reads.
//
//   node scripts/process-seed.mjs --placeholder   no AI: uses the hand-written expected labels
//                                                 so the board can be built before a key exists
//   node scripts/process-seed.mjs                 (next step) runs the five Gemini steps on every email
//
// The page never calls Gemini. It only reads the saved result.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './lib/assemble.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8'));
const placeholder = process.argv.includes('--placeholder');

if (!placeholder) {
  console.error('Gemini processing is not wired up yet. Run with --placeholder for now.');
  process.exit(1);
}

// ---- per-mail "track" results (placeholder: copy the expected labels) ----
const track = Object.fromEntries(seed.mails.map((m) => [m.id, { ...m.expected }]));

const result = assemble(seed, track);
result.generator = 'placeholder';
result.note = 'Placeholder built from hand-written labels. No AI was used. Replaced by the Gemini run.';
const out = path.join(root, 'data/processed.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`wrote ${path.relative(root, out)}: ${result.goals.length} items, ${result.mails.length} emails, ${result.people.length} people`);
