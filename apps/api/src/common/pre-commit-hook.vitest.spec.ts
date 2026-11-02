// pre-commit-hook.vitest.spec — Security Deep Scan §144: the opt-in pre-commit hook stops a commit whose STAGED content
// carries a secret shape or a credential file, lets a clean commit through, scans the index (not the working tree), and
// the installer never overwrites a foreign hook. Driven in a throw-away git repository.
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const REPO = join(process.cwd(), '..', '..');
const HOOK = join(REPO, 'tooling/security/pre-commit.mjs');
const INSTALL = join(REPO, 'tooling/security/install-hooks.mjs');
const lib: any = await import(HOOK);
let dir = '';
const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
const run = () => spawnSync('node', [HOOK], { cwd: dir, encoding: 'utf8', env: { ...process.env, PRE_COMMIT_SKIP_SUPPLY_CHAIN: '1' } });
const AWS = 'AKIA' + 'Q'.repeat(16);   // built at run time: no key shape in this file
const OPENAI = 'sk-' + 'proj-' + 'a1B2'.repeat(8);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'precommit-'));
  git('init', '-q'); git('config', 'user.email', 't@t.test'); git('config', 'user.name', 't');
});

describe('§144 pre-commit hook', () => {
  it('a clean staged change passes', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n'); git('add', 'a.ts');
    const r = run(); expect(r.status, r.stderr).toBe(0); expect(r.stdout).toMatch(/clean/);
  });
  it('a staged secret stops the commit — the value is never printed', () => {
    writeFileSync(join(dir, 'b.ts'), `const k = '${AWS}';\nconst o = "${OPENAI}";\n`); git('add', 'b.ts');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/b\.ts:1 AWS access key/);
    expect(r.stderr).toMatch(/b\.ts:2 OpenAI \/ Anthropic key/);
    expect(r.stderr).not.toContain(AWS); expect(r.stderr).not.toContain(OPENAI);
    git('rm', '-q', '--cached', 'b.ts');
  });
  it('scans the INDEX: a secret only in the working tree does not block; one only in the index does', () => {
    writeFileSync(join(dir, 'c.ts'), 'clean\n'); git('add', 'c.ts');
    writeFileSync(join(dir, 'c.ts'), `dirty ${AWS}\n`);   // not staged
    expect(run().status).toBe(0);
    git('add', 'c.ts'); writeFileSync(join(dir, 'c.ts'), 'clean again\n');   // staged dirty, working tree clean
    expect(run().status).toBe(1);
    git('rm', '-q', '-f', '--cached', 'c.ts');
  });
  it('a credential file is refused; an .env.example is fine', () => {
    writeFileSync(join(dir, '.env'), 'X=1\n'); writeFileSync(join(dir, '.env.example'), 'X=\n'); writeFileSync(join(dir, 'upload.jks'), 'bin');
    git('add', '-f', '.env', '.env.example', 'upload.jks');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\.env credential file/); expect(r.stderr).toMatch(/upload\.jks credential file/);
    expect(r.stderr).not.toMatch(/\.env\.example/);
    git('rm', '-q', '--cached', '.env', 'upload.jks');
  });
  it('a reviewed false positive can be marked on its line', () => {
    expect(lib.scanContent('f.ts', `const doc = '${AWS}'; // pre-commit: allow-secret`)).toEqual([]);
    expect(lib.scanContent('f.ts', ['postgres://app:hunter2real', '@prod-rds.example.net:5432/x'].join(''))).toHaveLength(1);   // built at run time: the db-credentials audit reads this file too
    expect(lib.scanContent('f.ts', `postgres://postgres:postgres@localhost:5432/x`)).toEqual([]);
  });
  it('the installer writes our hook, refuses to overwrite a foreign one, and uninstalls only ours', () => {
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho mine\n');
    expect(spawnSync('node', [INSTALL], { cwd: dir, encoding: 'utf8' }).status).toBe(1);
    expect(readFileSync(hook, 'utf8')).toMatch(/echo mine/);
    execFileSync('rm', [hook]);
    expect(spawnSync('node', [INSTALL], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
    expect(readFileSync(hook, 'utf8')).toMatch(/tooling\/security\/pre-commit\.mjs/);
    expect(spawnSync('node', [INSTALL, '--uninstall'], { cwd: dir, encoding: 'utf8' }).status).toBe(0);
    expect(existsSync(hook)).toBe(false);
  });
  it('is opt-in: no npm lifecycle script installs it', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts['hooks:install']).toMatch(/install-hooks\.mjs/);
    for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg.scripts[k]).toBeUndefined();
  });
});
