// Runs scripts/leak-guard.mjs inside a throwaway git repo with a made-up term list,
// so the check can be proven without the private list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = new URL('../scripts/leak-guard.mjs', import.meta.url);
const FAKE = 'Zebraquokka Holdings';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-guard-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(script, path.join(repo, 'scripts', 'leak-guard.mjs'));
  fs.writeFileSync(path.join(dir, 'terms.txt'), `# test list\n${FAKE}\nQZX\n`);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  const run = (extra = [], env = {}) => spawnSync(process.execPath, ['scripts/leak-guard.mjs', ...extra], { cwd: repo, encoding: 'utf8', env: { ...process.env, LEAK_GUARD_FILE: path.join(dir, 'terms.txt'), ...env } });
  return { dir, repo, git, run };
}

test('passes a clean repo', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'nothing private here');
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
});

test('fails when a file contains a listed term, and prints only the line number', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'a.txt'), `hello ${FAKE.toLowerCase()}`);
  const r = s.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /term #2 found in a\.txt/);
  assert.doesNotMatch(r.stderr + r.stdout, /zebraquokka/i);
});

test('short terms only match as whole words', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'QZXY is fine');
  assert.equal(s.run().status, 0);
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'see QZX.');
  assert.equal(s.run().status, 1);
});

test('fails on a term in an earlier commit message', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'x');
  s.git('add', '.');
  s.git('commit', '-q', '-m', `about ${FAKE}`);
  const r = s.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /commit [0-9a-f]{8} message/);
});

test('--history finds a term removed from the working tree but still in history', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'a.txt'), FAKE);
  s.git('add', '.');
  s.git('commit', '-q', '--no-verify', '-m', 'one');
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'clean');
  s.git('commit', '-q', '-am', 'two');
  assert.equal(s.run().status, 0);
  assert.equal(s.run(['--history']).status, 1);
});

test('fails on an API-key-shaped string', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, 'cfg.txt'), `KEY=${'AIza' + 'x'.repeat(35)}`);
  const r = s.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Google API key pattern/);
});

test('fails when .env is tracked', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.repo, '.env'), 'A=1');
  s.git('add', '-f', '.env');
  assert.equal(s.run().status, 1);
});

test('fails, not skips, when the term list is missing', () => {
  const s = sandbox();
  const r = s.run([], { LEAK_GUARD_FILE: path.join(s.dir, 'nope.txt') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /term list not found/);
});

test('commit-msg mode checks the message file', () => {
  const s = sandbox();
  const msg = path.join(s.dir, 'MSG');
  fs.writeFileSync(msg, `fix: ${FAKE}`);
  assert.equal(s.run(['--msg', msg]).status, 1);
  fs.writeFileSync(msg, 'fix: clean');
  assert.equal(s.run(['--msg', msg]).status, 0);
});
