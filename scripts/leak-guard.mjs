#!/usr/bin/env node
// leak-guard: blocks commits and pushes that contain private terms or secrets.
//
// The term list lives OUTSIDE this repository (one term per line, lines starting
// with # are comments). Default location: ../.rapport-leak-terms.txt next to the
// repo folder. Override with LEAK_GUARD_FILE. A missing list is a failure, not a skip.
//
// Findings print the list's line number, never the term itself, because CI and
// hook logs may become public.
//
// Modes:
//   (default)        scan tracked + untracked (not ignored) files, staged blobs, all commit messages
//   --history        also scan every blob reachable from any ref (used by pre-push)
//   --msg <file>     scan a commit message file (used by commit-msg)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = {
  history: args.includes('--history'),
  msgFile: args.includes('--msg') ? args[args.indexOf('--msg') + 1] : null,
};

const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
const listPath = process.env.LEAK_GUARD_FILE || path.resolve(repoRoot, '..', '.rapport-leak-terms.txt');

const findings = [];
const fail = (msg) => findings.push(msg);

function git(argv, opts = {}) {
  return execFileSync('git', argv, { cwd: opts.cwd, encoding: opts.encoding ?? 'utf8', maxBuffer: 1 << 28, input: opts.input });
}

// ---------- term list ----------
if (!fs.existsSync(listPath)) {
  console.error(`leak-guard: FAIL — term list not found (set LEAK_GUARD_FILE). Refusing to pass without it.`);
  process.exit(1);
}
const terms = [];
fs.readFileSync(listPath, 'utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').split(/\r?\n/).forEach((raw, i) => {
  const t = raw.trim();
  if (!t || t.startsWith('#')) return;
  const ascii = /^[\x00-\x7F]+$/.test(t);
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Short ASCII terms (acronyms) must stand alone to avoid matching inside ordinary words.
  const re = ascii && t.length <= 4 ? new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'i') : new RegExp(esc, 'i');
  terms.push({ line: i + 1, re });
});
if (terms.length === 0) {
  console.error('leak-guard: FAIL — term list is empty.');
  process.exit(1);
}

// ---------- secrets ----------
const secretPatterns = [
  ['Google API key', /AIza[0-9A-Za-z_\-]{35}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['service account key', /"private_key"\s*:\s*"/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_\-]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

function scanText(text, where) {
  for (const t of terms) if (t.re.test(text)) fail(`term #${t.line} found in ${safeName(where)}`);
  for (const [name, re] of secretPatterns) if (re.test(text)) fail(`${name} pattern found in ${safeName(where)}`);
}

// A file name that itself contains a term must not be printed.
function safeName(where) {
  return terms.some((t) => t.re.test(where)) ? '<name withheld>' : where;
}

// ---------- commit message only (commit-msg hook) ----------
if (mode.msgFile) {
  scanText(fs.readFileSync(mode.msgFile, 'utf8'), 'commit message');
  report();
}

// ---------- files in working tree ----------
const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot }).split('\0').filter(Boolean);
const files = [...new Set(listed)];
for (const rel of files) {
  scanText(rel, `path ${rel}`);
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
  scanText(fs.readFileSync(abs).toString('utf8'), rel);
}

// .env must never be tracked or staged (only .env.example is allowed).
const tracked = git(['ls-files', '-z', '--cached'], { cwd: repoRoot }).split('\0').filter(Boolean);
for (const rel of tracked) {
  const base = path.basename(rel);
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') fail(`secret file is tracked: ${safeName(rel)}`);
}
// .env must be ignored.
try {
  git(['check-ignore', '-q', '--no-index', '.env'], { cwd: repoRoot });
} catch {
  fail('.env is not listed in .gitignore');
}

// ---------- staged blobs (what is actually about to be committed) ----------
const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { cwd: repoRoot }).split('\0').filter(Boolean);
for (const rel of staged) {
  try {
    scanText(git(['show', `:${rel}`], { cwd: repoRoot }), `staged ${rel}`);
  } catch { /* deleted or unreadable */ }
}

// ---------- commit messages and identities in history ----------
const hasCommits = (() => { try { git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repoRoot }); return true; } catch { return false; } })();
if (hasCommits) {
  const log = git(['log', '--all', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01'], { cwd: repoRoot });
  for (const entry of log.split('\x01')) {
    const [sha, author, committer, body] = entry.replace(/^\s+/, '').split('\0');
    if (!sha) continue;
    scanText(`${author}\n${committer}\n${body ?? ''}`, `commit ${sha.slice(0, 8)} message`);
  }
}

// ---------- every blob in history (pre-push) ----------
if (mode.history && hasCommits) {
  const objs = git(['rev-list', '--objects', '--all'], { cwd: repoRoot }).split('\n').filter(Boolean);
  const blobs = new Map();
  const ids = objs.map((l) => l.split(' ')[0]);
  const types = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: repoRoot, input: ids.join('\n') + '\n' }).split('\n');
  const isBlob = new Set(types.filter((l) => l.endsWith(' blob')).map((l) => l.split(' ')[0]));
  for (const l of objs) {
    const [id, ...rest] = l.split(' ');
    if (isBlob.has(id) && !blobs.has(id)) blobs.set(id, rest.join(' ') || id.slice(0, 8));
  }
  for (const [id, name] of blobs) {
    scanText(git(['cat-file', 'blob', id], { cwd: repoRoot }), `history ${name} (${id.slice(0, 8)})`);
  }
}

report();

function report() {
  const unique = [...new Set(findings)];
  if (unique.length) {
    console.error(`leak-guard: FAIL — ${unique.length} finding(s):`);
    for (const f of unique) console.error(`  - ${f}`);
    console.error('Remove the content above. Do not bypass this check.');
    process.exit(1);
  }
  console.log(`leak-guard: OK (${terms.length} terms, ${mode.msgFile ? 'commit message' : `${files.length} files`}${mode.history ? ', full history' : ''})`);
  process.exit(0);
}
