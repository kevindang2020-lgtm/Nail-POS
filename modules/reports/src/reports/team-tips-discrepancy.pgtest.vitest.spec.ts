// team-tips-discrepancy.pgtest — Team Tips spec (Nov 13 2026) P0: "Total / Card / Cash Tips $0.00, Avg Tip 0 %, while
// Tips by Technician lists Vishal verma $9.60" (This Month). Reproduced against the REAL schema on the endpoint the old
// Team → Tips page read (GET /pos/reports/tips = KyselyReportsRepository.query → state.tips).
//
// Root cause (traced, not patched): the four cards and the technician list came from TWO different populations.
//   · the cards counted each ticket's tip ONCE, on its "carrier" payment row — chosen by sorting created_at as a STRING
//     (String(Date) = "Sat Oct 31 …" / "Sun Nov 01 …": weekday-name order, not time order) over a window one day wider
//     than the period — and only when that carrier row fell inside the period;
//   · the technician list summed the compensation snapshot of EVERY ticket that had any in-period payment row.
//   A ticket whose legs straddle the period edge therefore put its tip on an out-of-period carrier ($0.00 cards) while its
//   in-period leg still pulled the snapshot tip into the technician list ($9.60). The fix: the carrier is the EARLIEST row
//   by time, and the technician list only covers tickets whose tip the cards count — so Σ technicians ≤ Total, always.
// Team → Tips itself now reads the one-grain canonical read model (/pos/payments/tips — tips-screen.repository), where the
// cards and the technician list come from the same CTE; this file pins the Reports endpoint so the two pages agree.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository } from './reports.kysely.repository';

const P = 'a9004000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), VISHAL = id('f1'), ANNA = id('f2'), C = id('c9');
const STRADDLE = id('e1'), INSIDE = id('e2'), DOUBLED = id('e3');
const ctx: any = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: [] };
let pg: any; let repo: KyselyReportsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'TT LLC','TT','tt-disc','TTDISC01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Jen','W','Jen W')`, [C, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$3,$4,'Vishal','Verma','Vishal verma','active'), ($2,$3,$4,'Anna','Lee','Anna Lee','active')`, [VISHAL, ANNA, T, B]);
  const ticket = (tid: string, tech: string, tip: number, total: number, paidAt: string) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at)
    values ($1,$2,$3,$4,'paid',$5,$6,0,$7,0,0,$8,$9::timestamptz)`, [tid, T, B, C, tech, total - tip, tip, total, paidAt]);
  const pay = (tid: string, method: string, amount: number, tip: number, at: string) => q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at) values ($1,$2,$3,$4,$5,$6,0,'approved',$7::timestamptz)`, [T, B, tid, method, amount, tip, at]);
  const snap = (tid: string, tech: string, card: number) => q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, engine_version, technician_id, card_tip_cents, cash_tip_cents) values ($1,$2,$3,gen_random_uuid(),'test',$4,$5,0)`, [T, B, tid, tech, card]);
  // THE PHOTO: a $9.60 card tip for Vishal on a ticket whose first leg (a $20 cash part) was taken Saturday Oct 31 (local)
  // and whose card leg — carrying the tip — on Sunday Nov 1. "This Month" = November.
  await ticket(STRADDLE, VISHAL, 960, 6960, '2026-11-01T15:00:00Z');
  await pay(STRADDLE, 'cash', 2000, 0, '2026-10-31T15:00:00Z');
  await pay(STRADDLE, 'card', 4960, 960, '2026-11-01T15:00:00Z');
  await snap(STRADDLE, VISHAL, 960);
  repo = new KyselyReportsRepository(kyselyFor(pg) as any);
}, 180_000);

const november = { preset: 'custom' as const, from: '2026-11-01', to: '2026-11-30' };
const october = { preset: 'custom' as const, from: '2026-10-01', to: '2026-10-31' };
const sumTech = (s: any) => s.tips.byTechnician.reduce((a: number, x: any) => a + x.tipsCents, 0);

describe('Team Tips P0 — $0.00 cards beside a $9.60 technician row', () => {
  it('the straddling ticket: the cards and the technician list now come from the SAME tickets (never $0 vs $9.60)', async () => {
    const nov = (await repo.query(ctx, november)).state;
    const oct = (await repo.query(ctx, october)).state;
    // the tip belongs to the period of the ticket's FIRST collected leg (Oct 31) — once, in exactly one period
    expect(oct.tips.totalCents + nov.tips.totalCents).toBe(960);
    for (const s of [nov, oct]) expect(sumTech(s)).toBeLessThanOrEqual(s.tips.totalCents);
    // November: no tip counted on the cards → no technician tip either (before the fix: $0.00 cards, Vishal $9.60)
    expect(nov.tips.totalCents).toBe(0);
    expect(nov.tips.byTechnician.find((x: any) => x.technicianId === VISHAL)?.tipsCents ?? 0).toBe(0);
    // October carries it: $9.60 on the cards AND $9.60 for Vishal
    expect(oct.tips.totalCents).toBe(960);
    expect(oct.tips.byTechnician.find((x: any) => x.technicianId === VISHAL)?.tipsCents).toBe(960);
  });

  it('a normal in-period ticket: one $9.60 tip for one technician is exactly $9.60 on the cards and in the list (never $19.20)', async () => {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at) values ($1,$2,$3,$4,'paid',$5,5000,0,960,0,0,5960,'2026-11-10T16:00:00Z')`, [INSIDE, T, B, C, ANNA]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at) values ($1,$2,$3,'card',5960,960,0,'approved','2026-11-10T16:00:00Z')`, [T, B, INSIDE]);
    await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, engine_version, technician_id, card_tip_cents, cash_tip_cents) values ($1,$2,$3,gen_random_uuid(),'test',$4,960,0)`, [T, B, INSIDE, ANNA]);
    const nov = (await repo.query(ctx, november)).state;
    expect(nov.tips.totalCents).toBe(960);
    expect(nov.tips.cardTipsCents).toBe(960);
    expect(nov.tips.byTechnician.find((x: any) => x.technicianId === ANNA)?.tipsCents).toBe(960);
    expect(sumTech(nov)).toBe(nov.tips.totalCents);
  });

  it('a historic doubled snapshot (two tip-bearing line rows) is capped at the collected tip, never shown as $19.20', async () => {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at) values ($1,$2,$3,$4,'paid',$5,5000,0,960,0,0,5960,'2026-11-12T16:00:00Z')`, [DOUBLED, T, B, C, VISHAL]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at) values ($1,$2,$3,'card',5960,960,0,'approved','2026-11-12T16:00:00Z')`, [T, B, DOUBLED]);
    for (let i = 0; i < 2; i++) await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, engine_version, technician_id, card_tip_cents, cash_tip_cents) values ($1,$2,$3,gen_random_uuid(),'test',$4,960,0)`, [T, B, DOUBLED, VISHAL]);
    const nov = (await repo.query(ctx, november)).state;
    expect(nov.tips.totalCents).toBe(1920);   // INSIDE ($9.60, Anna) + DOUBLED ($9.60, Vishal)
    expect(nov.tips.byTechnician.find((x: any) => x.technicianId === VISHAL)?.tipsCents).toBe(960);
    expect(sumTech(nov)).toBe(nov.tips.totalCents);
  });
});
