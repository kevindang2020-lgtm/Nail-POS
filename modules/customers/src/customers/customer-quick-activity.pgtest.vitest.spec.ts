// customer-quick-activity.pgtest — extras Customer 03 "Customer Profile 360 overlay": the Quick View's receipts + activity from one
// read-only staff read, against the REAL schema. Receipts come through the customer's tickets (newest first, with the true total),
// activity merges those receipts with the customer's own audit_events trail; another salon's receipts / events never appear; a
// customer of another salon answers not-found; the read writes nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const P = 'c0372000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), C = id('c1'), C2 = id('c2');
const viewer = { tenantId: T, branchId: B, userId: id('ee1'), role: 'FRONT_DESK', permissions: ['pos.customers.view'] } as any;
let pg: any; let svc: CustomersService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Qa LLC','Qa','cust-qa','CQA001','active'), ($2,'Qb LLC','Qb','cust-qb','CQA002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Else','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Ann','Guest','Ann Guest','+12155550111'), ($4,$5,$6,'Zed','Other','Zed Other','+12155550112')`, [C, T, B, C2, T2, B2]);
  for (let i = 1; i <= 12; i++) {
    const tk = id('d' + i);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, created_at) values ($1,$2,$3,$4,'paid',$5, now() - ($6 || ' days')::interval)`, [tk, T, B, C, 1000 * i, String(i)]);
    await q(`insert into receipts (id, tenant_id, branch_id, ticket_id, receipt_number, total_cents, emailed_to, created_at) values ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' days')::interval)`,
      [id('f' + i), T, B, tk, 'R-' + i, 1000 * i, i === 1 ? 'ann@example.com' : null, String(i)]);
  }
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values ($1,$2,$3,$4,'paid',9900)`, [id('d99'), T2, B2, C2]);
  await q(`insert into receipts (id, tenant_id, branch_id, ticket_id, receipt_number, total_cents) values ($1,$2,$3,$4,'X-1',9900)`, [id('f99'), T2, B2, id('d99')]);
  await q(`insert into audit_events (tenant_id, branch_id, occurred_at, actor_name, module, action, resource_type, resource_id, status, severity, metadata) values
    ($1,$2, now() - interval '1 hour', 'Owner Kim', 'customers', 'pos_customer_notes_updated', 'pos_customer_notes', $3, 'success', 'info', '{}'),
    ($1,$2, now() - interval '30 days', 'Owner Kim', 'customers', 'pos_customer_tags_updated', 'pos_customer_tags', $3, 'success', 'info', '{}'),
    ($4,$5, now(), 'Other', 'customers', 'pos_customer_notes_updated', 'pos_customer_notes', $3, 'success', 'info', '{}')`, [T, B, C, T2, B2]);
  svc = new CustomersService(new KyselyCustomersRepository(kyselyFor(pg) as never));
}, 180_000);

describe('Customer 03 — Quick View receipts + activity (read-only)', () => {
  it('returns the newest 10 receipts with their real totals and the full count', async () => {
    const out = await svc.quickActivity(viewer, C);
    expect(out.receiptsTotal).toBe(12);
    expect(out.receipts).toHaveLength(10);
    expect(out.receipts[0]).toMatchObject({ receiptNumber: 'R-1', totalCents: 1000, channel: 'email' });
    expect(out.receipts[1]).toMatchObject({ receiptNumber: 'R-2', totalCents: 2000, channel: 'issued' });
    expect(out.receipts.map((r) => r.receiptNumber)).not.toContain('X-1');
  });
  it('activity merges the receipts with the customer\'s own audit trail, newest first, only this salon', async () => {
    const out = await svc.quickActivity(viewer, C);
    expect(out.activity[0]).toMatchObject({ kind: 'profile', code: 'pos_customer_notes_updated', actorName: 'Owner Kim' });
    expect(out.activity[1]).toMatchObject({ kind: 'receipt', code: 'receipt_issued', amountCents: 1000 });
    expect(out.activity.filter((a) => a.actorName === 'Other')).toHaveLength(0);
    expect(out.activity.length).toBeLessThanOrEqual(15);
    const ats = out.activity.map((a) => a.at); expect([...ats].sort().reverse()).toEqual(ats);
  });
  it('the old receipts() read now carries the real total (the alias bug)', async () => {
    const rs = await svc.receipts(viewer, C);
    expect(rs.find((r) => r.receiptId === id('f3'))?.totalCents).toBe(3000);
  });
  it('another salon\'s customer is not found; reading writes nothing', async () => {
    const before = (await q(`select count(*)::int n from audit_events`)).rows[0].n;
    await expect(svc.quickActivity(viewer, C2)).rejects.toThrow(/not found/i);
    await svc.quickActivity(viewer, C);
    expect((await q(`select count(*)::int n from audit_events`)).rows[0].n).toBe(before);
  });
  it('needs pos.customers.view', async () => {
    await expect(svc.quickActivity({ ...viewer, permissions: [] }, C)).rejects.toThrow();
  });
});
