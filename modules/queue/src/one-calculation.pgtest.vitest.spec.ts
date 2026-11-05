// one-calculation.pgtest — ONE-PAY (Oct 13 2026) on the REAL schema (PGlite, all migrations), queue module readers:
//   F10 the POS Tech Queue's per-technician "tips today" = the compensation snapshot's tip split (ticket_tip_allocations
//       via the snapshot), not the whole ticket tip credited to the ticket's primary technician;
//   F13 a queue visit's service lines are priced by THE rate precedence (authored rule → the service's own rate →
//       tenant default — pickLineCommission), never "service row as-is" (a 'none' service type kept its value and was
//       later read as a percent).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CompensationService, KyselyCompensationPorts, RULE_SOURCE_TENANT_DEFAULT } from '@aipowersalon/workforce';
import { KyselyTechQueueRepository } from './tech-queue/tech-queue.kysely.repository';
import { ensureVisitTicket } from './queue/visit-ticket';

const P = 'c0ee0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), CAT = id('ca1'), CUST = id('c0'), TECH = id('c1'), TECH2 = id('c2'), SVC = id('d1'), SVC_NONE = id('d2'), TICKET = id('e1'), QI = id('f9');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'One Pay Q LLC','One Pay Q','one-pay-q','ONEPQ1','active',45)`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$3,$4,'Mia','Chen','Mia Chen','active',true), ($2,$3,$4,'Ava','Li','Ava Li','active',true)`, [TECH, TECH2, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) values ($1,$2,$3,$4,'Gel',45,5000,'percent',50), ($5,$2,$3,$4,'Polish',20,2000,'none',40)`, [SVC, T, B, CAT, SVC_NONE]);
  // paid today: Mia (primary) $50.00 + Ava $50.00, a $10.00 card tip → the snapshot splits it 50/50
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, tip_cents, paid_at, service_done_at, chosen_payment_method, primary_technician_id) values ($1,$2,$3,$4,'paid','Q1',10000,11000,1000, now(), now(), 'card', $5)`, [TICKET, T, B, CUST, TECH]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$3,$4,$5,$6,$7,'Gel',5000,45,5000,'percent',50), ($2,$3,$4,$5,$6,$8,'Gel',5000,45,5000,'percent',50)`, [id('11'), id('12'), T, B, TICKET, SVC, TECH, TECH2]);
  const r = await new CompensationService(new KyselyCompensationPorts(db), { warn: () => undefined, error: () => undefined }).snapshotPaidTicket({ tenantId: T, branchId: B }, TICKET);
  expect(r.ok).toBe(true);
}, 180_000);

describe('F10 POS Tech Queue tips today = the snapshot tip split', () => {
  it('each technician shows HER allocated tip ($5.00 / $5.00) — not $10.00 for the primary and nothing for the other', async () => {
    const st: any = await new KyselyTechQueueRepository(db).query({ tenantId: T, branchId: B } as any, {} as any);
    const rowOf = (tid: string) => st.technicianRows.find((r: any) => r.technicianId === tid);
    expect(rowOf(TECH).tipsTodayCents).toBe(500);
    expect(rowOf(TECH2).tipsTodayCents).toBe(500);
    const perf = (tid: string) => st.techPerformanceToday.find((p: any) => p.technicianId === tid);
    expect(perf(TECH)?.tipCents).toBe(500);
  });
});

describe('F13 a queue visit line is priced by the ONE precedence (pickLineCommission)', () => {
  it("a service whose type is 'none' gets the TENANT default (45 %), with provenance — not its stray value read as a percent", async () => {
    await q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, status, assigned_technician_id, requested_services) values ($1,$2,$3,$6,'Walk In','waiting',$4,$5)`, [QI, T, B, TECH, JSON.stringify([{ serviceId: SVC_NONE, serviceName: 'Polish', priceCents: 2000, estimatedDurationMinutes: 20 }]), CUST]);
    const { ticketId } = await db.transaction().execute((trx: any) => ensureVisitTicket(trx, { tenantId: T, branchId: B }, QI));
    const [line] = await q(`select commission_type_snapshot, commission_value_snapshot, rule_source from ticket_service_lines where ticket_id = $1`, [ticketId]);
    expect(line.commission_type_snapshot).toBe('percent');
    expect(Number(line.commission_value_snapshot)).toBe(45);
    expect(line.rule_source).toBe(RULE_SOURCE_TENANT_DEFAULT);
  });
});
