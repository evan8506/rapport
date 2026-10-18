#!/usr/bin/env node
// Applies the clean-ups in scripts/lib/tidy.mjs to the saved result without calling Gemini again.
import fs from 'node:fs';
import { tidyResult } from './lib/tidy.mjs';
const f = new URL('../data/processed.json', import.meta.url);
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
tidyResult(d);
fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
console.log('tidied');
