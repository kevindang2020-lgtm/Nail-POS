// supply-chain-gates.vitest.spec — Security Deep Scan §13 (lockfile hygiene) and §12 (outbound hosts): the two gates in
// tooling/ci/run-gates.mjs refuse what they exist to refuse (not vacuous), and the tree passes them today.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(process.cwd(), '..', '..');
const lock: any = await import(join(REPO, 'tooling/security/check-lockfile.mjs'));
const out: any = await import(join(REPO, 'tooling/security/check-outbound-hosts.mjs'));

const entry = (over: Record<string, unknown> = {}) => ({ version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: 'sha512-abc', ...over });

describe('§13 lockfile hygiene', () => {
  const review = { installScripts: { esbuild: 'reviewed' }, typosquatReviewed: {}, baseline: ['lodash@1.0.0', 'esbuild@1.0.0'] };
  const run = (packages: Record<string, unknown>, direct = ['lodash', 'express']) => lock.lockfileProblems({ packages: { '': {}, ...packages } }, review, direct);

  it('a clean registry entry passes', () => {
    expect(run({ 'node_modules/lodash': entry() }).problems).toEqual([]);
  });
  it('refuses git / tarball / http sources and a missing integrity hash', () => {
    const r = run({
      'node_modules/a': entry({ resolved: 'git+ssh://git@github.com/evil/a.git#deadbeef' }),
      'node_modules/b': entry({ resolved: 'https://evil.example/b-1.0.0.tgz' }),
      'node_modules/c': entry({ integrity: undefined }),
      'node_modules/d': entry({ resolved: undefined }),
    }).problems.join('\n');
    expect(r).toMatch(/non-registry source: node_modules\/a/);
    expect(r).toMatch(/non-registry source: node_modules\/b/);
    expect(r).toMatch(/no integrity hash: node_modules\/c/);
    expect(r).toMatch(/unresolved: node_modules\/d/);
  });
  it('refuses a NEW install-script package; a reviewed one passes', () => {
    expect(run({ 'node_modules/esbuild': entry({ hasInstallScript: true }) }).problems).toEqual([]);
    expect(run({ 'node_modules/evil-postinstall': entry({ hasInstallScript: true }) }).problems.join()).toMatch(/install script: evil-postinstall@1\.0\.0/);
  });
  it('flags a name one edit from a direct dependency (typosquat heuristic), not the dependency itself', () => {
    expect(run({ 'node_modules/expres': entry() }).problems.join()).toMatch(/typosquat heuristic: "expres".*"express"/);
    expect(run({ 'node_modules/lodahs': entry() }).problems.join()).toMatch(/typosquat/);   // adjacent swap
    expect(run({ 'node_modules/express': entry() }).problems).toEqual([]);
    expect(lock.oneEditApart('react', 'react')).toBe(false);
    expect(lock.oneEditApart('pngjs', 'png-js')).toBe(true);
  });
  it('reports versions new since the reviewed baseline (the publish-age check runs on those)', () => {
    expect(run({ 'node_modules/lodash': entry({ version: '1.0.1' }) }).newVersions).toEqual(['lodash@1.0.1']);
  });
  it('the repository lockfile passes (offline: structure, install scripts, typosquats)', () => {
    const r = spawnSync('node', ['tooling/security/check-lockfile.mjs', '--offline'], { cwd: REPO, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe('§12 outbound hosts', () => {
  it('extracts hosts from code, never from comments', () => {
    const src = `// see https://docs.example.org/spec\nconst u = 'https://api.provider.test/v1'; /* https://blog.example.net */\nfetch(\`https://\${host}/x\`); const w = "wss://rt.provider.test:443/s";`;
    expect([...out.hostsIn(src)].sort()).toEqual(['api.provider.test', 'rt.provider.test']);
  });
  it('wildcard allowlist entries match subdomains only of that domain', () => {
    expect(out.allowed('a.twilio.com', { '*.twilio.com': 'x' })).toBe(true);
    expect(out.allowed('twilio.com.evil.test', { '*.twilio.com': 'x' })).toBe(false);
    expect(out.allowed('evil.test', { 'api.twilio.com': 'x' })).toBe(false);
  });
  it('the product code passes against the reviewed allowlist', () => {
    const r = spawnSync('node', ['tooling/security/check-outbound-hosts.mjs'], { cwd: REPO, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  it('both gates run in ci:gates', () => {
    const g = readFileSync(join(REPO, 'tooling/ci/run-gates.mjs'), 'utf8');
    expect(g).toMatch(/tooling\/security\/check-lockfile\.mjs/);
    expect(g).toMatch(/tooling\/security\/check-outbound-hosts\.mjs/);
  });
});
