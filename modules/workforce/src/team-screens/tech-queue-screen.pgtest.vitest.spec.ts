// tech-queue-screen.pgtest — the Tech Queue read model (Oct 30 2026) against the REAL schema: Live Queue vs History over the
// one ticket table (closed tickets never inflate the live queue; live order is first-assigned-first, history newest first),
// wait frozen at the terminal event, checkout pending from the linked ticket, the scoped search (phone any format, never
// another salon), a ticket's timeline, and Technician Assignment Details (on break is never assignable).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechQueueScreenRepository } from './tech-queue-screen.repository';

const P = 'fa7c0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), CU = id('e2');
const VISHAL = id('c1'), KEVIN = id('c2'), CD = id('c3'), OTHER = id('c9'), GEL = id('d1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['pos.tech_queue.view'] };
let pg: any; let repo: TechQueueScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tq-a','TQA001','active'), ($2,'Other LLC','Other','tq-b','TQB001','active')`, [T, T2]);
  // The fixture places tickets up to 2 h before now and asserts "today" — run in a zone where it is about noon right now,
  // so the test does not fail between local midnight and 2 AM (it did on Nov 8 at 00:30 New York time).
  const off = 12 - new Date().getUTCHours(); const NOON_TZ = off === 0 ? 'Etc/GMT' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active',$5), ($3,$4,'Elsewhere','active',$5)`, [B, T, BX, T2, NOON_TZ]);
  for (const [tid, n, tenant, br] of [[VISHAL, 'Vishal verma', T, B], [KEVIN, 'Kevin Dang', T, B], [CD, 'CD T6805', T, B], [OTHER, 'Other Tech', T2, BX]])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, tenant, br, n]);
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, clock_status, shift_status, queue_status) values ($1,$2,$3,'CLOCKED_IN','ON_SHIFT','AVAILABLE'), ($1,$2,$4,'ON_BREAK','ON_SHIFT','BREAK')`, [T, B, VISHAL, KEVIN]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,5500,'active')`, [GEL, T, B, id('d9')]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, VISHAL, GEL]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551234')`, [CU, T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number) values ($1,$2,$3,$4,'service_done','T-1001')`, [id('a91'), T, B, CU]);
  const tk = (tid: string, tech: string | null, status: string, cust: string, phone: string, assignedAgo: number, extra: Record<string, unknown> = {}, tenant = T, br = B) =>
    q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, customer_name, customer_phone, source, requested_services, priority, status, assigned_technician_id, assigned_at, started_at, created_at, updated_at, ticket_id)
      values ($1,$2,$3,$4,$5,'walk_in',$6::jsonb,'normal',$7,$8, now() - make_interval(mins => $9), $10, now() - make_interval(mins => $9 + 1), $11, $12)`,
      [tid, tenant, br, cust, phone, JSON.stringify([{ serviceId: GEL, serviceName: 'Gel Manicure', estimatedDurationMinutes: 45 }]), status, tech, assignedAgo, extra.started ?? null, extra.updated ?? new Date(), extra.ticket ?? null]);
  await tk(id('f1'), VISHAL, 'assigned', 'Mai Le', '+18565551234', 20);                       // first assigned
  await tk(id('f2'), VISHAL, 'waiting_for_acceptance', 'Ana Ho', '+18565553333', 5);           // assigned later
  await tk(id('f3'), CD, 'in_service', 'Kim Do', '+18565554444', 40, { started: new Date(Date.now() - 30 * 60_000) });
  // closed: done (with its unpaid checkout ticket), expired long ago (its wait must stop at expiry), cancelled
  await tk(id('f4'), VISHAL, 'service_done', 'Mai Le', '+18565551234', 120, { started: new Date(Date.now() - 100 * 60_000), updated: new Date(Date.now() - 50 * 60_000), ticket: id('a91') });
  await tk(id('f5'), KEVIN, 'expired', 'Lan Ng', '+18565556666', 60 * 24 * 3, { updated: new Date(Date.now() - (60 * 24 * 3 - 15) * 60_000) });
  await tk(id('f6'), KEVIN, 'cancelled', 'Tina Vo', '+18565552222', 30, { updated: new Date(Date.now() - 10 * 60_000) });
  await tk(id('f9'), OTHER, 'assigned', 'Mai Other', '+18565551234', 5, {}, T2, BX);
  repo = new TechQueueScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Tech Queue', () => {
  it('LIVE holds only open tickets, first assigned first; closed tickets never inflate it', async () => {
    const live = await repo.tickets(ctx, { tab: 'live' });
    expect(live.items.map((x) => x.customer)).toEqual(['Kim Do', 'Mai Le', 'Ana Ho']);
    expect(live.items.every((x) => x.live)).toBe(true);
    expect((await repo.tickets(ctx, { tab: 'waiting' })).items.map((x) => x.customer)).toEqual(['Mai Le', 'Ana Ho']);
    expect(await repo.tabCounts(ctx)).toMatchObject({ live: 3, waiting: 2, in_service: 1, done_today: 1, checkout_pending: 1 });
  });
  it('HISTORY is newest first; an expired ticket shows how long it waited, not how long ago that was', async () => {
    const h = await repo.tickets(ctx, { tab: 'history', preset: 'all' });
    expect(h.items.map((x) => x.status)).toEqual(['cancelled', 'service_done', 'expired']);
    const exp = h.items.find((x) => x.status === 'expired')!;
    expect(exp.waitMinutes).toBeGreaterThanOrEqual(14); expect(exp.waitMinutes).toBeLessThanOrEqual(16); expect(exp.waitFrozen).toBe(true);
    expect((await repo.tickets(ctx, { tab: 'history', preset: 'today' })).items.map((x) => x.status)).toEqual(['cancelled', 'service_done']);
    expect((await repo.tickets(ctx, { tab: 'checkout_pending' })).items.map((x) => [x.customer, x.ticketNumber, x.paid])).toEqual([['Mai Le', 'T-1001', false]]);
  });
  it('one search with scopes: phone in any format across live and history, masked without customer access; never another salon', async () => {
    for (const ph of ['8565551234', '(856) 555-1234', '+1 856 555 1234']) {
      const r = await repo.search(ctx, { q: ph });
      expect(r.live.items.map((x) => x.customer)).toEqual(['Mai Le']); expect(r.history.items.map((x) => x.customer)).toEqual(['Mai Le']);
      expect(r.live.items[0]!.phone).toBe('••• 1234');
    }
    const t = await repo.search(ctx, { q: 'gel' });
    expect(t.technicians.items.map((x) => x.name)).toEqual(['Vishal verma']);
    expect((await repo.tickets(ctx, { tab: 'live', q: id('f3') })).items.map((x) => x.customer)).toEqual(['Kim Do']);
  });
  it('a ticket shows its timeline and its linked checkout', async () => {
    const d = await repo.ticket(ctx, id('f4'));
    expect(d.timeline.map((x) => x.kind)).toEqual(['service_done', 'started', 'assigned', 'created']);
    expect(d.checkout).toMatchObject({ number: 'T-1001', paidAt: null });
    await expect(repo.ticket(ctx, id('f9'))).rejects.toBeTruthy();
  });
  it('Technician Assignment Details: current guest, next in order, qualified services; on break is never assignable', async () => {
    const v = await repo.technician(ctx, VISHAL, {});
    expect(v).toMatchObject({ name: 'Vishal verma', assignable: true, onBreak: false, qualifiedServices: ['Gel Manicure'], current: null });
    expect(v.next.map((x) => x.customer)).toEqual(['Mai Le', 'Ana Ho']);
    expect(v.recent.totalItems).toBe(3);
    const k = await repo.technician(ctx, KEVIN, {});
    expect(k.onBreak).toBe(true); expect(k.assignable).toBe(false);
    const c = await repo.technician(ctx, CD, {});
    expect(c.current?.customer).toBe('Kim Do'); expect(c.assignable).toBe(false);
    await expect(repo.technician(ctx, OTHER, {})).rejects.toBeTruthy();
  });
});
