#!/usr/bin/env node
// install-hooks.mjs — Security Deep Scan §144: install the local pre-commit hook (opt-in: `npm run hooks:install`).
// Writes <git dir>/hooks/pre-commit that runs tooling/security/pre-commit.mjs. An existing hook that is not ours is never
// overwritten (it is reported); `--uninstall` removes ours. Nothing runs at `npm install` (no lifecycle script — §10).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARK = '# aipowersalon-pre-commit (tooling/security/install-hooks.mjs)';
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const hooksDir = resolve(repo, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repo, encoding: 'utf8' }).trim());
const hook = join(hooksDir, 'pre-commit');
const body = `#!/bin/sh\n${MARK}\nexec node "$(git rev-parse --show-toplevel)/tooling/security/pre-commit.mjs"\n`;

if (process.argv.includes('--uninstall')) {
  if (existsSync(hook) && readFileSync(hook, 'utf8').includes(MARK)) { unlinkSync(hook); console.log(`removed ${hook}`); } else console.log('no aipowersalon pre-commit hook installed');
  process.exit(0);
}
if (existsSync(hook) && !readFileSync(hook, 'utf8').includes(MARK)) {
  console.error(`✖ ${hook} exists and is not ours — not overwritten. Add this line to it instead:\n  node tooling/security/pre-commit.mjs || exit 1`);
  process.exit(1);
}
mkdirSync(hooksDir, { recursive: true });
writeFileSync(hook, body); chmodSync(hook, 0o755);
console.log(`✔ installed ${hook} → tooling/security/pre-commit.mjs (remove: npm run hooks:install -- --uninstall)`);
