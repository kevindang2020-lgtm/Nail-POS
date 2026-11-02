// security-events.pgtest — Constitution 12 §186–194: the security event store, against the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { SecurityEvents, SECURITY_EVENT_TYPES, DEFAULT_SEVERITY, scrubReason } from './security-events';
import { runWithContext, newRequestId, newTraceId } from '@aipowersalon/observability';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
// No per-test clearing: the table refuses DELETE by design. Each test filters on its own unique marker instead
// (resource_type, actor_id, correlation_id). An earlier draft had a "clear" here that did nothing while claiming to.

describe('§187 append-only AT THE DATABASE', () => {
  it('UPDATE is refused — history cannot be rewritten, even with the application\'s own credentials', async () => {
    await new SecurityEvents(db).record({ type: 'MFA_DISABLED', actorId: 'u1' });
    await expect(pg.exec(`UPDATE security_events SET severity = 'LOW'`)).rejects.toThrow(/append-only/);
  });
  it('DELETE is refused', async () => {
    await new SecurityEvents(db).record({ type: 'MFA_DISABLED', actorId: 'u2' });
    await expect(pg.exec(`DELETE FROM security_events`)).rejects.toThrow(/append-only/);
  });
  it('the retention flag deletes ONLY rows past retention — a recent row survives even the sanctioned path', async () => {
    await new SecurityEvents(db).record({ type: 'SESSION_REVOKED', actorId: 'recent' });
    await expect(pg.exec(`BEGIN; SET LOCAL aps.security_retention = 'on'; DELETE FROM security_events WHERE actor_id = 'recent'; COMMIT;`)).rejects.toThrow(/append-only/);
    await pg.exec(`ROLLBACK`).catch(() => undefined);
  });
  it('…and the sanctioned path DOES delete a row past retention — retention can actually run', async () => {
    await pg.exec(`INSERT INTO security_events (event_type, severity, actor_id, occurred_at) VALUES ('SESSION_REVOKED', 'LOW', 'ancient', now() - interval '401 days')`);
    await pg.exec(`BEGIN; SET LOCAL aps.security_retention = 'on'; DELETE FROM security_events WHERE actor_id = 'ancient'; COMMIT;`);
    expect((await pg.query(`SELECT count(*)::int c FROM security_events WHERE actor_id = 'ancient'`)).rows[0].c).toBe(0);
  });
  it('a TRUNCATE-shaped shortcut through a plain DELETE with the flag unset is refused too', async () => {
    await expect(pg.exec(`SET aps.security_retention = 'off'; DELETE FROM security_events WHERE true`)).rejects.toThrow(/append-only/);
  });
});

describe('recording', () => {
  it('stamps the ambient request, correlation, actor and tenant (C11 context)', async () => {
    const ctx = { requestId: newRequestId(), correlationId: 'corr-sec-1', traceId: newTraceId(), service: 'api' as const, tenantId: 'a1a1a1a1-0000-4000-8000-00000000000a', actorId: 'u-ctx', actorType: 'user' as any };
    await runWithContext(ctx, () => new SecurityEvents(db).record({ type: 'SESSIONS_REVOKED_ALL' }));
    const r = (await pg.query(`SELECT * FROM security_events WHERE correlation_id = 'corr-sec-1'`)).rows[0];
    expect(r).toMatchObject({ event_type: 'SESSIONS_REVOKED_ALL', severity: 'MEDIUM', tenant_id: ctx.tenantId, actor_id: 'u-ctx', request_id: ctx.requestId });
  });
  it('a platform event with NO tenant is recordable — the reason audit_events could not hold these', async () => {
    expect(await new SecurityEvents(db).record({ type: 'WEBHOOK_SIGNATURE_FAILED', actorType: 'provider', resourceType: 'bank_webhook' })).toBe(true);
    expect((await pg.query(`SELECT tenant_id FROM security_events WHERE resource_type = 'bank_webhook'`)).rows[0].tenant_id).toBeNull();
  });
  it('default severity comes from the catalog; a caller may raise it', async () => {
    await new SecurityEvents(db).record({ type: 'WEBHOOK_SIGNATURE_FAILED', severity: 'HIGH', resourceType: 'sev-test' });
    expect((await pg.query(`SELECT severity FROM security_events WHERE resource_type = 'sev-test'`)).rows[0].severity).toBe('HIGH');
  });
  it('§188 a reason carrying a token, a card, an email or a phone is scrubbed BEFORE it reaches the permanent record', async () => {
    await new SecurityEvents(db).record({ type: 'SMS_ABUSE_DETECTED', resourceType: 'scrub', reason: 'user a.person@example.com +1 (856) 555-0142 card 4111 1111 1111 1111 Bearer abc.def.ghi' });
    const reason = (await pg.query(`SELECT reason FROM security_events WHERE resource_type = 'scrub'`)).rows[0].reason as string;
    expect(reason).not.toMatch(/a\.person@|555-0142|4111 1111 1111 1111|abc\.def\.ghi/);
    expect(reason).toMatch(/a\*\*\*@example\.com/);
    expect(reason).toMatch(/\*\*\*0142/);
  });
  it('never throws into the caller: with the database unavailable it returns false and the request goes on', async () => {
    const broken = { getExecutor: () => ({ executeQuery: async () => { throw new Error('db down'); }, transformQuery: (q: any) => q, compileQuery: (q: any) => q, adapter: { supportsReturning: true } }) };
    await expect(new SecurityEvents(broken).record({ type: 'MFA_RESET' })).resolves.toBe(false);
  });
  it('§191 countRecent groups: several events for one actor are counted, another actor\'s are not', async () => {
    const s = new SecurityEvents(db);
    for (let i = 0; i < 3; i++) await s.record({ type: 'CROSS_TENANT_ACCESS_ATTEMPT', actorId: 'probe-a' });
    await s.record({ type: 'CROSS_TENANT_ACCESS_ATTEMPT', actorId: 'probe-b' });
    expect(await s.countRecent('CROSS_TENANT_ACCESS_ATTEMPT', 10, { actorId: 'probe-a' })).toBe(3);
  });
});

describe('the catalog and the database agree', () => {
  it('every type in code is accepted by the CHECK constraint, and the constraint allows nothing else', async () => {
    const def = (await pg.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = 'security_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%'`)).rows[0].d as string;
    const inDb = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...SECURITY_EVENT_TYPES].sort());
    for (const t of SECURITY_EVENT_TYPES) expect(DEFAULT_SEVERITY[t]).toMatch(/^(LOW|MEDIUM|HIGH|CRITICAL)$/);
  });
});

describe('scrubReason', () => {
  it('leaves an ordinary reason alone', () => expect(scrubReason('POST /pos/customers named another tenant')).toBe('POST /pos/customers named another tenant'));
  it('does not mask short numbers (a count, a year)', () => expect(scrubReason('5 attempts in 2026')).toBe('5 attempts in 2026'));
});
