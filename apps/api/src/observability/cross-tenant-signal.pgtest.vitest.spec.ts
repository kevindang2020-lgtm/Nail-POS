// cross-tenant-signal.pgtest — Constitution 11 §118–121: notice cross-tenant attempts; still block them; escalate repeats.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CrossTenantSignal, namedForeignTenant, escalationRef, ESCALATION_COUNT, ESCALATION_WINDOW_MS, crossTenantAttempts } from './cross-tenant-signal';
import { TenantContextMiddleware } from '../common/tenant-context.middleware';
import { AlertNotifier } from './alert-notifier';
import { setLogSink, type LogRecord } from '@aipowersalon/observability';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM security_incidents WHERE detection_source = 'observability'; DELETE FROM alerts WHERE related_module = 'security_signal';`); });
afterEach(() => setLogSink(null));
const A = 'aaaaaaaa-0000-4000-8000-00000000000a', B = 'bbbbbbbb-0000-4000-8000-00000000000b';

describe('what counts as an attempt', () => {
  it('naming ANOTHER tenant in the body or the query', () => {
    expect(namedForeignTenant(A, { tenantId: B })).toBe(B);
    expect(namedForeignTenant(A, {}, { tenant_id: B })).toBe(B);
  });
  it('echoing your OWN tenant is not an attempt (clients do this harmlessly), case-insensitively', () => {
    expect(namedForeignTenant(A, { tenantId: A.toUpperCase() })).toBeNull();
  });
  it('a different BRANCH is not an attempt — routine for multi-branch staff', () => {
    expect(namedForeignTenant(A, { branchId: 'other-branch' })).toBeNull();
  });
  it('nothing named, or non-string values, is nothing', () => {
    expect(namedForeignTenant(A, { tenantId: '' }, { tenantId: 42 }, null)).toBeNull();
  });
});

describe('through the real middleware: noticed AND still blocked', () => {
  const run = async (mw: TenantContextMiddleware, body: any) => {
    const req: any = { method: 'POST', originalUrl: '/pos/customers?x=1', body, query: {}, session: { userId: 'u-1', tenantId: A, branchId: 'br', role: 'MANAGER', permissions: [] } };
    await mw.use(req, {}, () => undefined);
    return req;
  };
  it('the foreign tenant id is STRIPPED exactly as before — noticing never weakens the block', async () => {
    const mw = new TenantContextMiddleware(undefined, new CrossTenantSignal(db));
    const req = await run(mw, { tenantId: B, name: 'x' });
    expect(req.body).toEqual({ name: 'x' });
    expect(req.ctx.tenantId).toBe(A);
  });
  it('the attempt is logged as a security signal with who, whose tenant, and which tenant they named', async () => {
    const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    await run(new TenantContextMiddleware(undefined, new CrossTenantSignal(db)), { tenantId: B });
    const l: any = lines.find((x) => x.msg === 'security.cross_tenant_attempt');
    expect(l.actorId ?? l.fields?.actorId).toBe('u-1');
    expect(l.namedTenantId ?? l.fields?.namedTenantId).toBe(B);
    expect(l.path ?? l.fields?.path).toBe('/pos/customers');            // query string dropped
  });
  it('echoing your own tenant produces no signal', async () => {
    const before = crossTenantAttempts.snapshot().reduce((a, s) => a + (s.value as number), 0);
    await run(new TenantContextMiddleware(undefined, new CrossTenantSignal(db)), { tenantId: A });
    expect(crossTenantAttempts.snapshot().reduce((a, s) => a + (s.value as number), 0)).toBe(before);
  });
  it('a SUPER_ADMIN naming a tenant is the scope selector, not an attempt', async () => {
    const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    const req: any = { method: 'GET', originalUrl: '/super-admin/overview', body: {}, query: { tenantId: B }, session: { userId: 'sa', tenantId: null, role: 'SUPER_ADMIN', permissions: [] } };
    await new TenantContextMiddleware(undefined, new CrossTenantSignal(db)).use(req, {}, () => undefined);
    expect(lines.some((l) => l.msg === 'security.cross_tenant_attempt')).toBe(false);
  });
  it('without the signal wired, the middleware still blocks (the signal is observability, not enforcement)', async () => {
    const req = await run(new TenantContextMiddleware(undefined), { tenantId: B });
    expect(req.body).toEqual({});
  });
});

describe('§120 repeated attempts escalate — once', () => {
  it(`${ESCALATION_COUNT} attempts in the window open ONE security incident and ONE platform alert`, async () => {
    const s = new CrossTenantSignal(db); let t = Date.parse('2026-09-21T10:00:00Z'); s.now = () => t;
    let escalated = 0;
    for (let i = 0; i < ESCALATION_COUNT + 3; i++) { if (s.observe({ actorId: 'u-probe', actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B, method: 'GET', path: '/pos/x' })) escalated++; t += 1000; }
    await new Promise((r) => setTimeout(r, 50));
    expect(escalated).toBe(1);
    const inc = (await pg.query(`SELECT category, severity, status, tenant_id FROM security_incidents WHERE detection_source = 'observability'`)).rows;
    expect(inc).toEqual([{ category: 'cross_tenant_access', severity: 'high', status: 'detected', tenant_id: A }]);
    expect((await pg.query(`SELECT count(*)::int c FROM alerts WHERE related_module = 'security_signal' AND tenant_id IS NULL`)).rows[0].c).toBe(1);
  });
  it('attempts spread beyond the window do NOT escalate — a stray client bug is not a probe', async () => {
    const s = new CrossTenantSignal(db); let t = 0; s.now = () => t;
    let escalated = 0;
    for (let i = 0; i < ESCALATION_COUNT * 2; i++) { if (s.observe({ actorId: 'u-slow', actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B, method: 'GET', path: '/x' })) escalated++; t += ESCALATION_WINDOW_MS / 2; }
    expect(escalated).toBe(0);
  });
  it('two API instances escalating the same account in the same hour produce ONE incident', async () => {
    const at = new Date('2026-09-21T10:15:00Z');
    await Promise.all([new CrossTenantSignal(db).escalate('u-twice', { actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B }, null, at),
                       new CrossTenantSignal(db).escalate('u-twice', { actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B }, null, at)]);
    expect((await pg.query(`SELECT count(*)::int c FROM security_incidents WHERE detection_source = 'observability'`)).rows[0].c).toBe(1);
    expect(escalationRef('u-twice', at)).toBe(escalationRef('u-twice', new Date('2026-09-21T10:59:00Z')));
  });
  it('the second instance\'s duplicate is a quiet no-op, not a false "escalation failed" error', async () => {
    // The UNIQUE incident_ref already guarantees ONE row, so dropping ON CONFLICT changed no count and a mutation
    // survived. What the clause really buys is not logging an error for every duplicate — pinned here.
    const at = new Date('2026-09-21T12:15:00Z');
    await new CrossTenantSignal(db).escalate('u-quiet', { actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B }, null, at);
    const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    await new CrossTenantSignal(db).escalate('u-quiet', { actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B }, null, at);
    expect(lines.some((l) => l.msg === 'security.escalation_failed')).toBe(false);
  });
  it('§262 the security alert PAGES (email) through the same notifier', async () => {
    await new CrossTenantSignal(db).escalate('u-page', { actorType: 'MANAGER', sessionTenantId: A, namedTenantId: B }, null, new Date('2026-09-21T11:00:00Z'));
    await pg.exec(`DELETE FROM users WHERE email = 'sec@notify.test'; INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES (gen_random_uuid(), NULL, 'K', 'sec@notify.test', 'x', 'active', 'SUPER_ADMIN')`);
    const sent: string[] = []; const n = new AlertNotifier(db);
    n.email = { send: async (_to, subject) => { sent.push(subject); return { id: 'e' }; } }; n.sms = null; n.env = {};
    await n.dispatch(new Date('2026-09-21T11:00:30Z'));
    expect(sent.some((s) => /Repeated cross-tenant access attempts/.test(s))).toBe(true);
  });
});

describe('wiring', () => {
  it('ObservabilityModule EXPORTS the signal, so the AppModule-scoped middleware can inject it (else it would be silently off)', () => {
    expect(readFileSync(join(process.cwd(), 'src/observability/observability.module.ts'), 'utf8')).toMatch(/exports: \[[^\]]*CrossTenantSignal/);
  });
});
