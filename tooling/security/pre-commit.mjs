#!/usr/bin/env node
// pre-commit.mjs — Security Deep Scan §144: the local pre-commit check (opt-in: `npm run hooks:install`).
//
// Blocks a commit when the STAGED content (the index, not the working tree — exactly what would be committed):
//   1. carries a secret shape (AWS / Stripe / GitHub / Slack / Google / Twilio keys, OpenAI / Anthropic / SendGrid keys,
//      private-key blocks, a Postgres URL with a real-looking password, a JWT assigned to a secret-named variable);
//   2. adds a credential FILE (.env, *.jks / *.keystore / *.p8 / *.p12 / *.pem, key.properties, google-services.json,
//      GoogleService-Info.plist, id_rsa …);
//   3. introduces a supply-chain injection pattern — the repository's own gate apps/api/scripts/check-supply-chain-injection.mjs
//      (install hooks, root-script runners, editor auto-run, obfuscated loaders) runs on the tree.
// When gitleaks is on PATH, `gitleaks protect --staged` runs as well. Values are never printed (file:line + kind only).
// Bypass for a reviewed false positive: put `pre-commit: allow-secret` on that line (reviewed in code review), or
// `git commit --no-verify` (CI's gitleaks job still runs).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const SECRET_PATTERNS = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Stripe live key', /\b[sr]k_live_[0-9a-zA-Z]{16,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['Twilio auth pair', /\b(?:AC|SK)[0-9a-f]{32}\b[^\n]{0,40}\b[0-9a-f]{32}\b/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}/],
  ['Slack token', /\bxox[abpr]-[0-9A-Za-z-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['OpenAI / Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['JWT assigned to a secret', /(?:secret|token|password|apikey|api_key)\s*[:=]\s*['"]eyJ[A-Za-z0-9_-]{20,}/i],
];
const CREDENTIAL_FILE = /(^|\/)(\.env(\.[a-z]+)?|key\.properties|google-services\.json|GoogleService-Info\.plist|id_(rsa|ed25519|ecdsa)|[^/]+\.(jks|keystore|p8|p12|pfx|pem|key))$/i;
const ALLOWED_FILE = /(^|\/)\.env\.(example|sample|template)$|\.pem\.example$/i;

/** Problems in one staged file's content (never the value — kind + line). */
export function scanContent(path, text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/pre-commit: allow-secret/.test(line)) return;
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) out.push(`${path}:${i + 1} ${kind}`);
    const pgm = /postgres(?:ql)?:\/\/[^:\s'"]+:([^@\s'"]+)@([^/:\s'"`]+)/.exec(line);
    if (pgm && !/^(localhost|127\.0\.0\.1|postgres|db|\$\{|<)($|[:/])/i.test(pgm[2]) && !/^(pass|password|postgres|example|x+|<.*|\$\{|\[)/i.test(pgm[1])) out.push(`${path}:${i + 1} Postgres URL with a password`);
  });
  return out;
}
export const credentialFile = (path) => CREDENTIAL_FILE.test(path) && !ALLOWED_FILE.test(path);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = (...a) => execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
  const problems = [];
  for (const f of staged) {
    if (credentialFile(f)) { problems.push(`${f} credential file (keep it out of git; use the secret store)`); continue; }
    if (/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|jar|aar|so|dylib)$/i.test(f)) continue;
    let text = '';
    try { text = git('show', `:${f}`); } catch { continue; }
    if (text.length > 3_000_000) continue;
    problems.push(...scanContent(f, text));
  }
  const repoRoot = git('rev-parse', '--show-toplevel').trim();
  const gate = join(repoRoot, 'apps/api/scripts/check-supply-chain-injection.mjs');
  if (existsSync(gate) && !process.env.PRE_COMMIT_SKIP_SUPPLY_CHAIN) {
    const r = spawnSync('node', [gate], { cwd: repoRoot, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`supply-chain injection gate failed:\n${(r.stdout + r.stderr).split('\n').filter(Boolean).slice(-8).join('\n')}`);
  }
  const gl = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (gl.status === 0) {
    const r = spawnSync('gitleaks', ['protect', '--staged', '--redact', '--no-banner'], { cwd: repoRoot, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`gitleaks protect --staged found leaks:\n${(r.stdout + r.stderr).split('\n').filter(Boolean).slice(-8).join('\n')}`);
  }
  if (problems.length) {
    console.error(`✖ pre-commit (${basename(fileURLToPath(import.meta.url))}): ${problems.length} problem(s) in the staged changes — the commit was stopped`);
    for (const p of problems) console.error('  ' + p);
    console.error('A reviewed false positive: mark the line `pre-commit: allow-secret`. Never commit a real credential — rotate it if it was ever staged.');
    process.exit(1);
  }
  console.log(`✔ pre-commit: ${staged.length} staged file(s) clean (secrets, credential files, supply-chain gate${gl.status === 0 ? ', gitleaks' : ''})`);
}
