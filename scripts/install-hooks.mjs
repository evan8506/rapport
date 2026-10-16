#!/usr/bin/env node
// Installs git hooks that run scripts/leak-guard.mjs before every commit and push.
// Runs automatically on `npm install` (prepare script). Safe to re-run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
const dir = path.resolve(root, hooksDir);
fs.mkdirSync(dir, { recursive: true });

const hooks = {
  'pre-commit': 'node scripts/leak-guard.mjs',
  'commit-msg': 'node scripts/leak-guard.mjs --msg "$1"',
  'pre-push': 'node scripts/leak-guard.mjs --history',
};
for (const [name, cmd] of Object.entries(hooks)) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n# installed by scripts/install-hooks.mjs\ncd "$(git rev-parse --show-toplevel)" || exit 1\nexec ${cmd}\n`);
  fs.chmodSync(file, 0o755);
  console.log(`installed ${name}`);
}
