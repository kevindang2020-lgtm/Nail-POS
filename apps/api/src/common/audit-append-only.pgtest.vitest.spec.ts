// audit-append-only.pgtest — Constitution 12 §187 (finding H3, migration 452), against the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

let pg: any;
const T = 'a7a7a7a7-0000-4000-8000-00000000000a', U = 'a8a8a8a8-0000-4000-8000-00000000000a';
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'A', 'A', 'aud-a', 'AUDA1', 'active') ON CONFLICT DO NOTHING`);
});
let n = 0;
const ev = async (ageDays: number, over: { action?: string; actor?: string } = {}) => (await pg.query(
  `INSERT INTO audit_events (tenant_id, module, action, actor_user_id, occurred_at) VALUES ($1, 'test', $2, $3, now() - ($4 || ' days')::interval) RETURNING id`,
  [T, over.action ?? `act-${++n}`, over.actor ?? null, String(ageDays)])).rows[0].id;
const purge = (id: string) => pg.exec(`BEGIN; SET LOCAL aps.audit_retention = 'on'; DELETE FROM audit_events WHERE id = '${id}'; COMMIT;`).finally(() => pg.exec('ROLLBACK').catch(() => undefined));
const exists = async (id: string) => (await pg.query(`SELECT count(*)::int c FROM audit_events WHERE id = $1`, [id])).rows[0].c === 1;

describe('§187 the audit trail cannot be rewritten', () => {
  it('UPDATE is refused — even on a row years old, even with the retention flag', async () => {
    const id = await ev(1000);
    await expect(pg.exec(`BEGIN; SET LOCAL aps.audit_retention = 'on'; UPDATE audit_events SET summary = 'edited' WHERE id = '${id}'; COMMIT;`)).rejects.toThrow(/append-only \(UPDATE refused\)/);
    await pg.exec('ROLLBACK').catch(() => undefined);
  });
  it('a plain DELETE is refused', async () => {
    const id = await ev(1000);
    await expect(pg.exec(`DELETE FROM audit_events WHERE id = '${id}'`)).rejects.toThrow(/append-only/);
  });
  it('the retention flag cannot delete a row INSIDE retention', async () => {
    const id = await ev(30);
    await expect(purge(id)).rejects.toThrow(/inside retention/); expect(await exists(id)).toBe(true);
  });
  it('the retention job CAN delete a row past retention with no hold — retention remains possible', async () => {
    const id = await ev(400);
    await purge(id); expect(await exists(id)).toBe(false);
  });
});

describe('legal holds are enforced BY THE DATABASE, with the retention preview\'s own semantics', () => {
  const hold = async (scope: string, value: string | null) => { await pg.exec(`UPDATE audit_legal_holds SET status = 'released' WHERE status = 'active'`); await pg.query(`INSERT INTO audit_legal_holds (hold_ref, scope_type, scope_value, reason, status) VALUES ($1, $2, $3, 'litigation', 'active')`, [`H-${++n}`, scope, value]); };
  it.each([
    ['tenant', () => T, {}],
    ['user', () => U, { actor: U }],
    ['action', () => 'refund', { action: 'payment.refund.approved' }],
    ['date_range', () => `${new Date(Date.now() - 500 * 864e5).toISOString().slice(0, 10)}|${new Date(Date.now() - 300 * 864e5).toISOString().slice(0, 10)}`, {}],
    ['global', () => null, {}],
  ] as const)('a %s hold protects an otherwise purgeable row', async (scope, value, over) => {
    await hold(scope, value());
    const id = await ev(400, over as any);
    await expect(purge(id)).rejects.toThrow(/legal hold/); expect(await exists(id)).toBe(true);
  });
  it('a RELEASED hold no longer protects', async () => {
    await hold('tenant', T); await pg.exec(`UPDATE audit_legal_holds SET status = 'released'`);
    const id = await ev(400); await purge(id); expect(await exists(id)).toBe(false);
  });
});

describe('audit_logs too', () => {
  it('UPDATE and a plain DELETE are refused', async () => {
    const id = (await pg.query(`INSERT INTO audit_logs (tenant_id, action_type, entity_type) VALUES ($1, 'x', 'y') RETURNING id`, [T])).rows[0].id;
    await expect(pg.exec(`UPDATE audit_logs SET action_type = 'z' WHERE id = '${id}'`)).rejects.toThrow(/append-only/);
    await expect(pg.exec(`DELETE FROM audit_logs WHERE id = '${id}'`)).rejects.toThrow(/append-only/);
  });
});

// Security Deep Scan §137 (Oct 28 2026 re-audit): row triggers never fire on TRUNCATE — 703 adds a statement trigger
describe('TRUNCATE of an audit table is refused (703)', () => {
  for (const table of ['audit_events', 'audit_logs', 'security_events', 'authorization_audit_events']) {
    it(`${table}`, async () => {
      await expect(pg.exec(`TRUNCATE ${table}`)).rejects.toThrow(/append-only \(TRUNCATE refused\)/);
    });
  }
  it('the rows are still there after the refused attempt', async () => {
    const id = (await pg.query(`INSERT INTO audit_logs (tenant_id, action_type, entity_type) VALUES ($1, 'kept', 'y') RETURNING id`, [T])).rows[0].id;
    await expect(pg.exec(`TRUNCATE audit_logs`)).rejects.toThrow(/TRUNCATE refused/);
    expect((await pg.query(`SELECT count(*)::int AS c FROM audit_logs WHERE id = $1`, [id])).rows[0].c).toBe(1);
  });
});
