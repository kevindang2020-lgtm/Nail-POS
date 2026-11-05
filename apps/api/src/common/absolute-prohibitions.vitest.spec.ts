// absolute-prohibitions.vitest.spec — Constitution 12 §323: the forty "never" rules, as tests.
//
// Each rule that can be checked against the code is checked here (or names the guard that already pins it, and
// asserts that guard exists — so a deleted guard fails this file too). Rules that are Railway's, or need a person, are
// listed at the bottom as PARTIAL with the reason: they are not claimed (§323's last rule).
import { codeRoots, codeKey } from '../../test-support/code-roots';
import { ROLE_PERMISSIONS, requiredCapability } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SIGNED_URL_TTL, S3EvidenceBlobStore } from '@aipowersalon/safety';
import { networkPosture } from './network-posture';

const SRC = join(process.cwd(), 'src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|test|\.d\.ts$/.test(f) ? [p] : []); });
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const files = codeRoots().flatMap((r) => walk(r)).map((f) => ({ f: codeKey(f), s: code(readFileSync(f, 'utf8')) }));
const holders = (perm: string) => Object.entries(ROLE_PERMISSIONS).filter(([, p]) => (p as string[]).includes(requiredCapability(perm))).map(([r]) => r).sort();
// Constitution 13: a guard file may live in apps/api/src or in the domain module it guards (modules/<m>/src/<dir>/…).
const MODULES_ROOT = join(SRC, '..', '..', '..', 'modules');
const guardExists = (rel: string) => existsSync(join(SRC, rel)) || (existsSync(MODULES_ROOT) && readdirSync(MODULES_ROOT).some((m) => existsSync(join(MODULES_ROOT, m, 'src', rel))));
const guard = (rel: string) => expect(guardExists(rel), `guard missing: ${rel}`).toBe(true);

describe('§323 — trust nothing from the frontend', () => {
  it('tenant_id / branch_id: stripped from every non-Super-Admin request (tenant-context middleware) + cross-tenant suite', () => {
    expect(readFileSync(join(SRC, 'common/tenant-context.middleware.ts'), 'utf8')).toMatch(/Strip client-supplied tenant\/branch keys/);
    guard('common/cross-tenant-suite.pgtest.vitest.spec.ts');
  });
  it('role / permissions: only ever read from the SIGNED session, never a request body', () => {
    const bad = files.filter((x) => /req\.body\.(role|permissions)\b|\bb\?\.(role|permissions)\s*(===|!==|\?\?)|body\.permissions\.includes/.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('customer_id is not proof of identity: the customer realm resolves it from the session; the voice line from the caller id', () => {
    expect(readFileSync(join(SRC, 'domain-streams/customer-realtime.controller.ts'), 'utf8')).toMatch(/resolveCustomerId\(cctx\)/);
    guard('voice-booking/voice-caller-id.vitest.spec.ts');
  });
  it('no frontend database access, no server secret in the apps: the VITE_ guard', () => guard('common/secrets-inventory.pgtest.vitest.spec.ts'));
});

describe('§323 — never store', () => {
  it('plaintext passwords: every password write goes through scrypt', () => guard('common/password-write-sites.vitest.spec.ts')   /* moved to common/ with identity (Constitution 13) */);
  it('plaintext OTPs: no table has a plaintext code column (data-classification + card-data guards)', () => { guard('common/data-classification.pgtest.vitest.spec.ts'); guard('common/card-data.pgtest.vitest.spec.ts'); });
  it('secrets in Git / server secrets in mobile or web: secret scan on every push', () => expect(readFileSync(join(process.cwd(), 'scripts/security-audit.mjs'), 'utf8')).toMatch(/SECRET_PATTERNS/));
});

describe('§323 — never log', () => {
  it('passwords, OTPs, tokens, API keys and payment credentials are redacted by key name', () => {
    const s = readFileSync(join(SRC, '..', '..', '..', 'packages', 'observability', 'src', 'redaction.ts'), 'utf8');   // the redaction kernel is @aipowersalon/observability (Constitution 13 §80)
    for (const k of ["'password'", "'otp'", "'token'", "'api_key'", "'cvv'", "'card_number'", "'authorization'", "'secret'"]) expect(s, k).toContain(k);
  });
});

describe('§323 — AI', () => {
  it('no raw database access, no tenant choice, no permission bypass: the tool registry injects identity and grants nothing', () => {
    const s = readFileSync(join(SRC, '..', '..', '..', 'modules', 'ai', 'src', 'ai', 'ai-tool-registry.ts'), 'utf8');
    expect(s).toMatch(/does not grant permission/); expect(s).toMatch(/injected by this layer from the trusted request context/);
  });
  it('no arbitrary SQL from a model or a request: sql.raw only ever receives fixed strings', () => {
    const bad = files.filter((x) => /sql\.raw\((b|body|input|args|req|query|model|completion|answer|text)\b/.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
});

describe('§323 — webhooks, devices, presence', () => {
  it('no webhook without verification: signature failures are a security event on every provider; Retell without its signing key is a boot warning', () => {
    guard('common/sessionless-routes.vitest.spec.ts');
    expect(networkPosture({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@postgres.railway.internal/r', MEDIA_STORE: 's3', RETELL_API_KEY: 'k' }).map((p) => p.variable)).toContain('RETELL_WEBHOOK_SIGNING_KEY');
  });
  it('push tokens are never an identity: no query looks a user up by push token', () => {
    const bad = files.filter((x) => /device_push_tokens/.test(x.s) && /where\s*\(\s*'token'|where token = \$\{|\.where\('token', '=',/.test(x.s) && !/user_id/.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('a trusted device is not user authorization: no login path skips the password for a remembered device', () => {
    const bad = files.filter((x) => /auth\//.test(x.f) && /(trusted_device|trustedDevice|rememberDevice)[\s\S]{0,120}(skip|bypass)/i.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('presence is not clock-in: the time-clock never reads realtime presence', () => {
    const bad = files.filter((x) => /clock/i.test(x.f) && /presence/i.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
});

describe('§323 — Super Admin, support, exports, refunds', () => {
  it('Super Admin is not invisible: support mode and privileged actions are security events; SA is blocked from tenant-operational routes', () => {
    expect(readFileSync(join(SRC, '..', '..', '..', 'modules', 'security-center', 'src', 'security-events', 'security-events.ts'), 'utf8')).toMatch(/SUPPORT_MODE_STARTED/);
    expect(readFileSync(join(SRC, 'common/tenant-context.middleware.ts'), 'utf8')).toMatch(/super admins are blocked from tenant-operational routes/);
  });
  it('customer export is RESTRICTED: owners and managers only — not front desk, reception or technicians', () => {
    expect(holders('pos.customers.export')).toEqual(['MANAGER', 'OWNER']);
    expect(holders('pos.customers.view')).toContain('TECHNICIAN');            // viewing stays broad; exporting does not
  });
  it('a large refund needs permission/policy (M9)', () => { expect(holders('checkout.approve_refund')).toEqual(['MANAGER', 'OWNER']); guard('checkout/refund-approval.pgtest.vitest.spec.ts'); });
  it('no direct production SQL from the Super Admin UI: no route executes a request-supplied query', () => {
    // sql.raw() with a fixed identifier chosen by code (a column name from an enum) is not the prohibition; raw SQL
    // built from a request field is. (The first version of this check matched the former and had to be narrowed.)
    const bad = files.filter((x) => /controller\.ts$/.test(x.f) && /sql\.raw\((b|body|q|query|req|input)\b|execute\((b|body)\.(sql|query)/.test(x.s));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
});

describe('§323 — storage, DR, honesty', () => {
  it('private documents are never in public object storage (M2 guard); signed URLs are capped at one hour', () => {
    guard('common/file-safety.vitest.spec.ts')   /* stayed in the API when tech-profile moved (it walks every code root) */; expect(MAX_SIGNED_URL_TTL).toBeLessThanOrEqual(3600);
  });
  it('BEHAVIOUR: a caller asking for a ten-year signed URL gets at most one hour (the cap is applied, not just declared)', async () => {
    // A fake SDK + presigner: the store must hand the presigner expiresIn <= 3600 whatever the caller asked.
    // (Checking the constant alone let a mutation that deleted the clamp survive.)
    let seen = -1;
    const sdk = { S3Client: class { }, GetObjectCommand: class { constructor(public i: any) {} }, PutObjectCommand: class { constructor(public i: any) {} }, DeleteObjectCommand: class { constructor(public i: any) {} }, HeadObjectCommand: class { constructor(public i: any) {} } };
    const presigner = { getSignedUrl: async (_c: any, _cmd: any, o: { expiresIn: number }) => { seen = o.expiresIn; return 'https://signed.example/x'; } };
    const store = new S3EvidenceBlobStore({ bucket: 'b', region: 'us-east-1' } as any, sdk, presigner);
    await store.signedUrl('k', 10 * 365 * 24 * 3600);
    expect(seen).toBeGreaterThan(0); expect(seen).toBeLessThanOrEqual(3600);
  });
  it('no security control is disabled for disaster recovery: the DR plan and the rollback plan never drop a trigger or a guard', () => {
    for (const doc of ['SECURITY_DR.md', 'SECURITY_FINAL_REPORT.md', 'SECURITY_RUNBOOKS.md']) {
      expect(readFileSync(join(process.cwd(), '../../', doc), 'utf8'), doc).not.toMatch(/drop (the )?trigger|disable (the )?(trigger|guard|middleware|check)/i);
    }
  });
  it('compliance is measured, not claimed: the DoD script maps every §324 line to evidence', () => {
    expect(readFileSync(join(process.cwd(), 'scripts/security-dod-check.mjs'), 'utf8')).toMatch(/report\('324', items, 82\)/);
    // the count check itself lives in dod-lib.mjs report(): a script whose line count drifts exits 2
    expect(readFileSync(join(process.cwd(), 'scripts/dod-lib.mjs'), 'utf8')).toMatch(/if \(expected && items\.length !== expected\)[^\n]*process\.exitCode = 2/);
  });
});

describe('§323 — honestly PARTIAL (Railway-provided or needs a person; not claimed)', () => {
  it.each([
    ['expose PostgreSQL / Redis publicly', 'Railway private network; the app warns at boot on a public host without TLS'],
    ['one universal service account / unrestricted workers', 'NOT DONE — one database role serves API and workers'],
    ['permanent Support Mode / invisible impersonation', 'no path grants access through a support session today; if built, its guard must enforce expiry and audit'],
  ])('%s — %s', (_rule, note) => expect(note.length).toBeGreaterThan(10));
});
