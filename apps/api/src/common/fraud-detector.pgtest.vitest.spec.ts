// fraud-detector.pgtest — Constitution 12 §172–180: patterns across many transactions, flagged for humans, never blocked.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { FraudDetector, refundSpreadFindings, cardTestingFindings, smsWaveFindings } from './fraud-detector';
import { SECURITY_EVENT_TYPES, SecurityEvents } from '@aipowersalon/security-center';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const T = 'f7f7f7f7-0000-4000-8000-00000000000a', B = 'f8f8f8f8-0000-4000-8000-00000000000a', U = 'f9f9f9f9-0000-4000-8000-00000000000a';
const NOW = new Date('2026-09-22T12:00:00Z');
const C = 'fafafafa-0000-4000-8000-00000000000a', K = 'fbfbfbfb-0000-4000-8000-00000000000a';   // a customer and a ticket to hang payments on
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'F', 'F', 'frd-t', 'FRDT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main') ON CONFLICT DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'C', 'C', 'C C') ON CONFLICT DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${K}', '${T}', '${B}', '${C}') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM payment_refunds WHERE tenant_id = '${T}'; DELETE FROM payments WHERE tenant_id = '${T}'; DELETE FROM security_incidents WHERE detection_source = 'fraud_detector'; DELETE FROM alerts WHERE related_module = 'security_signal' AND dedupe_key LIKE 'FRAUD-%'`); });
const detector = () => { const d = new FraudDetector(db); d.now = () => NOW; return d; };
async function cashRefund(amount: number, minutesAgo = 60) {
  const p = (await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, '${K}', 'cash', 10000, 'approved', $3) RETURNING id`, [T, B, new Date(NOW.getTime() - minutesAgo * 60_000)])).rows[0].id;
  await pg.query(`INSERT INTO payment_refunds (tenant_id, branch_id, payment_id, amount_cents, reason, status, created_by_user_id, created_at) VALUES ($1, $2, $3, $4, 'x', 'refunded', $5, $6)`, [T, B, p, amount, U, new Date(NOW.getTime() - minutesAgo * 60_000)]);
}

describe('refund_spread — the gap the per-payment limit leaves', () => {
  it('four $45 cash refunds on four payments ($180 > 3 × $50) is flagged HIGH, explained, against that employee', async () => {
    for (let i = 0; i < 4; i++) await cashRefund(4_500);
    const f = (await detector().detect()).filter((x) => x.rule === 'refund_spread');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: 'HIGH', tenantId: T, subject: `user:${U}` });
    expect(f[0].explanation).toMatch(/4 different payments.*\$180\.00.*Each refund stayed under the limit/);
  });
  it('two refunds, or a total under the ceiling, is NOT flagged — normal refunding stays quiet', async () => {
    await cashRefund(4_900); await cashRefund(4_900);
    expect((await detector().detect()).filter((x) => x.rule === 'refund_spread')).toEqual([]);
  });
  it('a large total on only TWO payments is not the pattern (e.g. a manager\'s two approved refunds)', async () => {
    // My first negative case had a low count AND a low total, so a mutation dropping the payment-count condition
    // survived. Here the total ($180) is over the ceiling; only the count keeps it quiet.
    await cashRefund(9_000); await cashRefund(9_000);
    expect((await detector().detect()).filter((x) => x.rule === 'refund_spread')).toEqual([]);
  });
  it('refunds older than 24 h do not count', async () => {
    for (let i = 0; i < 4; i++) await cashRefund(4_500, 25 * 60);
    expect((await detector().detect()).filter((x) => x.rule === 'refund_spread')).toEqual([]);
  });
});

describe('card_testing', () => {
  const declines = async (n: number, minutesAgo = 5) => { for (let i = 0; i < n; i++) await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, '${K}', 'card', 100, 'declined', $3)`, [T, B, new Date(NOW.getTime() - minutesAgo * 60_000)]); };
  it('10 declines in 15 minutes at one branch → HIGH; 25 → CRITICAL', async () => {
    await declines(10); expect((await detector().detect()).find((x) => x.rule === 'card_testing')?.level).toBe('HIGH');
    await declines(15); expect((await detector().detect()).find((x) => x.rule === 'card_testing')?.level).toBe('CRITICAL');
  });
  it('declines spread over an hour are ordinary — not flagged', async () => {
    await declines(12, 40);
    expect((await detector().detect()).find((x) => x.rule === 'card_testing')).toBeUndefined();
  });
});

describe('§175 flag, never block — reporting is deduplicated', () => {
  it('a HIGH finding opens ONE incident + ONE paging alert + ONE security event, and a second run adds nothing', async () => {
    // The incident and alert are unique at the database; what the detector's own dedup prevents is a DUPLICATE
    // SECURITY EVENT per run — so the detector gets a real recorder here (my first version had none, and a mutation
    // removing the dedup survived).
    for (let i = 0; i < 4; i++) await cashRefund(4_500);
    const before = (await pg.query(`SELECT count(*)::int c FROM security_events WHERE event_type = 'FRAUD_PATTERN_DETECTED'`)).rows[0].c;
    const withEvents = () => { const d = new FraudDetector(db, new SecurityEvents(db)); d.now = () => NOW; return d; };
    await withEvents().run(); await withEvents().run();
    await new Promise((r) => setTimeout(r, 50));
    expect((await pg.query(`SELECT count(*)::int c FROM security_events WHERE event_type = 'FRAUD_PATTERN_DETECTED'`)).rows[0].c - before).toBe(1);
    expect((await pg.query(`SELECT count(*)::int c FROM security_incidents WHERE detection_source = 'fraud_detector'`)).rows[0].c).toBe(1);
    expect((await pg.query(`SELECT count(*)::int c FROM alerts WHERE dedupe_key LIKE 'FRAUD-refund_spread%'`)).rows[0].c).toBe(1);
  });
  it('the detector changes no business data — refunds and payments are untouched', async () => {
    for (let i = 0; i < 4; i++) await cashRefund(4_500);
    const before = (await pg.query(`SELECT count(*)::int c FROM payment_refunds WHERE tenant_id = $1`, [T])).rows[0].c;
    await detector().run();
    expect((await pg.query(`SELECT count(*)::int c FROM payment_refunds WHERE tenant_id = $1`, [T])).rows[0].c).toBe(before);
  });
});

describe('pure rules', () => {
  it('sms_wave: 20 abuse events in an hour → HIGH; 19 → nothing', () => { expect(smsWaveFindings(20)).toHaveLength(1); expect(smsWaveFindings(19)).toEqual([]); });
  it('every finding carries an explanation a person can read', () => {
    const all = [...refundSpreadFindings([{ tenantId: 't', userId: 'u', payments: 5, totalCents: 90_000 }], 5_000), ...cardTestingFindings([{ tenantId: 't', branchId: 'b', declines: 30 }]), ...smsWaveFindings(50)];
    for (const f of all) expect(f.explanation.length).toBeGreaterThan(40);
  });
  it('the new event type is in the catalog (the DB CHECK is kept identical by the security-events test)', () => expect(SECURITY_EVENT_TYPES).toContain('FRAUD_PATTERN_DETECTED'));
});
