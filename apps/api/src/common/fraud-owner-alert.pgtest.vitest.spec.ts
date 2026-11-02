// fraud-owner-alert.pgtest — the salon owner hears about fraud in their own salon; the employee named cannot see it.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { FraudDetector } from './fraud-detector';
import { KyselyOwnerRepository } from '@aipowersalon/analytics';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';

let pg: any; let db: any;
const T = 'c7c7c7c7-0000-4000-8000-00000000000a', B = 'c8c8c8c8-0000-4000-8000-00000000000a', MGR = 'c9c9c9c9-0000-4000-8000-00000000000a';
const C = 'cacacaca-0000-4000-8000-00000000000a', K = 'cbcbcbcb-0000-4000-8000-00000000000a';
const NOW = new Date('2026-09-22T12:00:00Z');
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'O', 'O', 'foa-t', 'FOAT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${MGR}', '${T}', 'Dana Manager', 'dana@foa.test', 'x', 'active', 'MANAGER') ON CONFLICT DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'C', 'C', 'C C') ON CONFLICT DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${K}', '${T}', '${B}', '${C}') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM owner_alerts WHERE tenant_id = '${T}'; DELETE FROM payment_refunds WHERE tenant_id = '${T}'; DELETE FROM payments WHERE tenant_id = '${T}'; DELETE FROM security_incidents WHERE detection_source = 'fraud_detector'`); });
const detector = () => { const d = new FraudDetector(db); d.now = () => NOW; return d; };
async function refundByManager(amount: number) {
  const p = (await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, $3, 'cash', 10000, 'approved', $4) RETURNING id`, [T, B, K, new Date(NOW.getTime() - 3_600_000)])).rows[0].id;
  await pg.query(`INSERT INTO payment_refunds (tenant_id, branch_id, payment_id, amount_cents, reason, status, created_by_user_id, created_at) VALUES ($1, $2, $3, $4, 'x', 'refunded', $5, $6)`, [T, B, p, amount, MGR, new Date(NOW.getTime() - 3_600_000)]);
}
// Phase 9: the owner audience follows the owner-level grant (owner.branches.compare), not the role name — so the context
// carries the role's real permissions ('*' is not a wildcard in hasPermission)
const ctxFor = (role: string) => ({ tenantId: T, branchId: B, userId: 'u', role, permissions: permissionsFor(role as any) }) as any;

describe('the owner is told — in the Owner app, naming the employee', () => {
  it('a refund_spread finding writes ONE owner alert, category fraud, naming the employee, owner-only', async () => {
    for (let i = 0; i < 4; i++) await refundByManager(4_500);
    await detector().run(); await detector().run();                 // a second run adds nothing
    const rows = (await pg.query(`SELECT category, severity, title, body, audience FROM owner_alerts WHERE tenant_id = $1`, [T])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'fraud', severity: 'high', audience: 'owner' });
    expect(rows[0].body).toMatch(/^Dana Manager made cash refunds against 4 different payments/);
    expect(rows[0].body).toMatch(/may be legitimate/);
  });
});

describe('migration 457 — the employee named cannot read it, count it, open it, or dismiss it', () => {
  beforeEach(async () => { for (let i = 0; i < 4; i++) await refundByManager(4_500); await detector().run(); });
  const repo = () => new KyselyOwnerRepository(db);
  it('the OWNER sees it in the list and counts', async () => {
    expect((await repo().listAlerts(ctxFor('OWNER'), null, {})).some((a: any) => a.category === 'fraud')).toBe(true);
    expect((await repo().alertCounts(ctxFor('OWNER'), null)).total).toBe(1);
  });
  it('a MANAGER does not see it in the list, and it is not in their counts', async () => {
    expect((await repo().listAlerts(ctxFor('MANAGER'), null, {})).some((a: any) => a.category === 'fraud')).toBe(false);
    expect((await repo().alertCounts(ctxFor('MANAGER'), null)).total).toBe(0);
  });
  it('a MANAGER cannot open it by id, and cannot acknowledge or resolve it away', async () => {
    const id = (await pg.query(`SELECT id FROM owner_alerts WHERE tenant_id = $1`, [T])).rows[0].id;
    expect(await repo().getAlert(ctxFor('MANAGER'), id)).toBeNull();
    expect(await repo().updateAlertStatus(ctxFor('MANAGER'), id, 'dismissed', 'u', false)).toBeNull();
    expect((await pg.query(`SELECT status FROM owner_alerts WHERE id = $1`, [id])).rows[0].status).toBe('new');
  });
  it('an ordinary alert (audience all) is still visible to a manager — nothing existing changed', async () => {
    await pg.query(`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title) VALUES ($1, $2, 'cash_drawer', 'warning', 'new', 'Drawer short')`, [T, B]);
    expect((await repo().listAlerts(ctxFor('MANAGER'), null, {})).map((a: any) => a.category)).toEqual(['cash_drawer']);
  });
});

describe('card testing is about outsiders — managers see it too', () => {
  it('a card_testing finding writes an owner alert with audience all, on the branch', async () => {
    for (let i = 0; i < 12; i++) await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, $3, 'card', 100, 'declined', $4)`, [T, B, K, new Date(NOW.getTime() - 5 * 60_000)]);
    await detector().run();
    const r = (await pg.query(`SELECT audience, branch_id, title FROM owner_alerts WHERE tenant_id = $1 AND category = 'fraud'`, [T])).rows[0];
    expect(r).toMatchObject({ audience: 'all', branch_id: B }); expect(r.title).toMatch(/card testing/i);
  });
});
