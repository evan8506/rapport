#!/usr/bin/env node
// Applies the date markers to an already processed result, without calling Gemini again.
import fs from 'node:fs';
import { relativizeResult } from './lib/relative-dates.mjs';
const f = new URL('../data/processed.json', import.meta.url);
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
relativizeResult(d, d.generated_at);
fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
const n = (JSON.stringify({ g: d.goals.map(({ runs, ...x }) => x), p: d.people }).match(/\{\{d:/g) || []).length;
console.log(`date markers in shown text: ${n}`);
