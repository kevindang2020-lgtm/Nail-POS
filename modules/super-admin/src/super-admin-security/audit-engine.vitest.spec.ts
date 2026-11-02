// audit-engine.vitest.spec.ts — the Security Audit Engine lifecycle (Jul 26, 2026).
// Pins Kevin's flow end-to-end at the unit level: findings dedupe by fingerprint across runs (occurrence bump, no
// spam), auto-RESOLVE when a finding stops appearing (re-verify), REOPEN when it returns, critical/high findings
// escalate ONCE into the incidents workflow, the advisory lock makes concurrent runs skip, a crashed check becomes
// a finding instead of killing the run, and the 1am scheduler window fires exactly when it should.
import { describe, it, expect } from 'vitest';
import { AuditEngineService, shouldFireScheduled } from './audit-engine.service';
import { InMemoryAuditEngineRepository } from './audit-engine.repository';
import { envHygieneFindings, webhookCorsFindings, reconcile } from './audit-engine-core';

const prodEnvBad = { NODE_ENV: 'production', AUTH_SESSION_SECRET: 'local-dev-secret', MFA_ENC_KEY: '0123456789abcdef0123456789abcdef', PAYMENTS_SANDBOX: '1' };   // also: no WEB_CORS_ORIGINS → +1 medium
const prodEnvGood = { NODE_ENV: 'production', AUTH_SESSION_SECRET: 'x'.repeat(48), MFA_ENC_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', PAYMENTS_SANDBOX: '0', APP_DATA_ENCRYPTION_KEY: 'k'.repeat(32), WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com' };

class FakeIncidents { created: any[] = []; async create(input: any) { this.created.push(input); return { id: `inc_${this.created.length}` }; } }

describe('security audit engine', () => {
  it('bad production env → findings open + ONE incident per new critical/high; second run bumps, never re-escalates', async () => {
    const repo = new InMemoryAuditEngineRepository();
    const incidents = new FakeIncidents();
    const svc = new AuditEngineService(repo, incidents as any, undefined, prodEnvBad);
    const r1 = await svc.runAudit('manual', 'sa1');
    expect(r1.ran).toBe(true);
    expect(r1.open).toBe(5);                                     // weak secret, dev MFA key, sandbox, no APP_DATA key, no CORS allowlist
    const criticalOrHigh = repo.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
    expect(incidents.created.length).toBe(criticalOrHigh.length); // escalated once each
    expect(repo.findings.every((f) => f.occurrences === 1)).toBe(true);

    const r2 = await svc.runAudit('manual', 'sa1');
    expect(r2.open).toBe(5);
    expect(incidents.created.length).toBe(criticalOrHigh.length); // DEDUPED: no incident spam on recurrence
    expect(repo.findings.every((f) => f.occurrences === 2)).toBe(true);
  });

  it('re-verify: fixing the environment auto-RESOLVES findings; regressing REOPENS them without a new incident', async () => {
    const repo = new InMemoryAuditEngineRepository();
    const incidents = new FakeIncidents();
    let env: Record<string, string | undefined> = prodEnvBad;
    const svc = new AuditEngineService(repo, incidents as any, undefined, env);
    await svc.runAudit('manual');
    const escalated = incidents.created.length;

    (svc as any).env = prodEnvGood;                              // the developer fixed it
    const r2 = await svc.runAudit('manual');
    expect(r2.resolved).toBe(5);
    expect(repo.findings.every((f) => f.status === 'resolved')).toBe(true);

    (svc as any).env = prodEnvBad;                               // regression!
    const r3 = await svc.runAudit('manual');
    expect(repo.findings.every((f) => f.status === 'reopened')).toBe(true);
    expect(incidents.created.length).toBe(escalated);            // reopen bumps the finding, not the incident count
    expect(r3.open).toBe(5);
  });

  it('advisory lock: a concurrent run skips honestly instead of double-running', async () => {
    const repo = new InMemoryAuditEngineRepository();
    repo.locked = true;                                          // someone else holds the lock
    const svc = new AuditEngineService(repo, undefined, undefined, prodEnvGood);
    const r = await svc.runAudit('scheduled');
    expect(r.ran).toBe(false);
    expect(r.skippedReason).toMatch(/advisory lock/);
    expect(repo.runs.length).toBe(0);                            // no phantom run row
  });

  it('failure detection: a >26h gap since the last completed run becomes a finding on the next run', async () => {
    const repo = new InMemoryAuditEngineRepository();
    const svc = new AuditEngineService(repo, undefined, undefined, prodEnvGood);
    await svc.runAudit('manual');                                // healthy baseline (0 findings)
    repo.runs[0].finishedAt = new Date(Date.now() - 30 * 3_600_000).toISOString();   // pretend it was 30h ago
    const r2 = await svc.runAudit('manual');
    expect(r2.open).toBe(1);
    expect(repo.findings.some((f) => f.title.includes('schedule gap'))).toBe(true);
  });

  it('a crashed check becomes a HIGH finding; the run still completes', async () => {
    const repo = new InMemoryAuditEngineRepository();
    const svc = new AuditEngineService(repo, undefined, undefined, prodEnvGood);
    (svc as any).collectFindings = async () => { throw new Error('boom'); };          // whole collection dies
    await expect(svc.runAudit('manual')).rejects.toThrow('boom');
    expect(repo.runs[0].status).toBe('failed');                  // honest failed run row, never fake-completed
    expect(repo.runs[0].error).toContain('boom');
  });

  it('env hygiene is quiet outside production and the scheduler fires only in the 1am window after ~a day', () => {
    expect(envHygieneFindings({ NODE_ENV: 'development', AUTH_SESSION_SECRET: 'local-dev-secret' })).toEqual([]);
    const oneAm = new Date('2026-07-26T01:10:00');
    const tenAm = new Date('2026-07-26T10:00:00');
    expect(shouldFireScheduled(oneAm, null)).toBe(true);
    expect(shouldFireScheduled(tenAm, null)).toBe(false);
    expect(shouldFireScheduled(oneAm, new Date(oneAm.getTime() - 23 * 3_600_000).toISOString())).toBe(true);
    expect(shouldFireScheduled(oneAm, new Date(oneAm.getTime() - 2 * 3_600_000).toISOString())).toBe(false);  // already ran tonight
  });

  it('reconcile emits one row per fingerprint even when two checks report the same issue', () => {
    const dup = { area: 'config', title: 'Same Thing', severity: 'low' as const, detail: 'a' };
    const plan = reconcile([], [dup, { ...dup, detail: 'b' }]);
    expect(plan.toInsert.length).toBe(1);
  });
});


// ---- webhook + CORS hygiene checks (spec §6/§9, Jul 26 2026) ----
describe('webhook and CORS hygiene checks', () => {
  const base = { NODE_ENV: 'production' };
  it('Twilio SID with a placeholder auth token → HIGH; a real token is quiet', () => {
    const bad = webhookCorsFindings({ ...base, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'replace-me-with-a-real-secret', WEB_CORS_ORIGINS: 'https://a.example' });
    expect(bad.some((f) => f.title.includes('Twilio configured without a real auth token') && f.severity === 'high')).toBe(true);
    const ok = webhookCorsFindings({ ...base, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'f'.repeat(32), WEB_CORS_ORIGINS: 'https://a.example' });
    expect(ok.some((f) => f.title.includes('Twilio'))).toBe(false);
  });
  it('AI billing scheme enabled without a real secret → HIGH', () => {
    const out = webhookCorsFindings({ ...base, AI_BILLING_WEBHOOK_SCHEME: 'hmac', AI_BILLING_WEBHOOK_SECRET: 'replace-me-with-a-real-secret', WEB_CORS_ORIGINS: 'https://a.example' });
    expect(out.some((f) => f.title.includes('AI billing webhook') && f.severity === 'high')).toBe(true);
  });
  it('CORS: wildcard → HIGH, non-TLS non-localhost → MEDIUM, unset → MEDIUM, clean https list quiet, dev env silent', () => {
    expect(webhookCorsFindings({ ...base, WEB_CORS_ORIGINS: 'https://a.example,*' }).some((f) => f.title.includes('wildcard') && f.severity === 'high')).toBe(true);
    expect(webhookCorsFindings({ ...base, WEB_CORS_ORIGINS: 'http://pos.example.com' }).some((f) => f.title.includes('non-TLS') && f.severity === 'medium')).toBe(true);
    expect(webhookCorsFindings({ ...base }).some((f) => f.title.includes('not set'))).toBe(true);
    expect(webhookCorsFindings({ ...base, WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com,https://admin.aipowersalon.com' })).toEqual([]);
    expect(webhookCorsFindings({ NODE_ENV: 'development', WEB_CORS_ORIGINS: '*' })).toEqual([]);
  });
});
