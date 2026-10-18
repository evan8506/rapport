#!/usr/bin/env node
// Prints how the saved result in data/processed.json compares with the answer key in data/seed.json.
//   node scripts/score.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, scoreLine } from './lib/score.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8'));
const processed = JSON.parse(fs.readFileSync(path.join(root, 'data/processed.json'), 'utf8'));
const s = score(seed, processed);
console.log(JSON.stringify(s, null, 2));
console.log(scoreLine(s));
if (processed.generator !== 'gemini') console.log('(This is the hand-labelled placeholder, so it matches by definition. Run the Gemini step first.)');
