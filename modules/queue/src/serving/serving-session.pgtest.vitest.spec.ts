// serving-session.pgtest — durable Serving state on the REAL schema (migration 586; merge Oct 12 2026).
// Pinned: status / pause clock / delay / notes / helper / the send key survive a NEW repository instance (nothing in
// process memory any more); ONE active session per technician (service-level 409 AND the partial unique index);
// the three Service Done entry points (tech app complete, Serving mark-done, Serving send) converge on ONE
// transition with ONE session row + ONE completion key; retries are idempotent; every line is commission-stamped at
// Service Done; the tech app never fabricates an unpriced ticket for a queue visit (ensureVisitTicket prices it).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyServingRepository } from './serving.kysely.repository';
import { ServingService, ConflictError, ValidationError } from './serving.service';
import { KyselyTechRepository } from '../tech/tech.kysely.repository';
import { completeServiceDone } from '../service-done/service-done-transition';

const P = 'c5e50000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), BA = id('b1'), CUST = id('c0'), MIA = id('e001'), AVA = id('e002'), CAT = id('c100'), SVC = id('d001'), UA = id('ee1');
let pg: any; let db: any; let repo: KyselyServingRepository; let svc: ServingService; let events: any[]; let transitions: { technicianId: string; ticketId: string }[];
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const count = async (s: string, p: unknown[] = []) => Number((await q(s, p))[0].n);
const ctx = () => ({ tenantId: TA, branchId: BA, userId: UA, role: 'OWNER', permissions: ['pos.serving.view', 'pos.serving.start', 'pos.serving.pause_resume', 'pos.serving.mark_done', 'pos.serving.send_to_service_done', 'pos.service_done.view', 'pos.serving.assign_technician', 'pos.serving.assign_helper', 'pos.serving.report_delay', 'pos.serving.update_notes'] } as any);

async function mkTicket(n: string, techId: string | null, status = 'accepted') {
  const t = id(n);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, total_cents) values ($1,$2,$3,$4,$5,$6,$7,4500,4500)`, [t, TA, BA, CUST, techId, status, 'T' + n]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$4,$5,'Manicure',4500,45,4500,'serving')`, [TA, BA, t, SVC, techId]);
  return t;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  clearBranchTimeZoneCache();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'Serve LLC','Serve','pay-serve','PAYS01','active',40)`, [TA]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [BA, TA]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, TA, BA]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, TA, BA]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) values ($1,$2,$3,$4,'Manicure',45,4500,'percent',55)`, [SVC, TA, BA, CAT]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$3,$4,'Mia','C','Mia C','active',true), ($2,$3,$4,'Ava','L','Ava L','active',true)`, [MIA, AVA, TA, BA]);
  events = []; transitions = [];
  const realtime = { toTenant: (_c: any, e: any, p: any) => events.push({ e, p }) } as any;
  repo = new KyselyServingRepository(db, null, { workforce: { serviceCompleted: async (_t: string, technicianId: string, m: { ticketId: string }) => { transitions.push({ technicianId, ticketId: m.ticketId }); } } });
  svc = new ServingService(repo, realtime);
}, 180_000);

describe('durable serving state (586)', () => {
  it('status, pause clock, delay, notes and helper survive a NEW repository instance', async () => {
    const t = await mkTicket('a001', MIA);
    expect((await repo.ticket(ctx(), t))!.status).toBe('not_started');
    await svc.start(ctx(), t);
    await svc.pause(ctx(), t);
    await svc.reportDelay(ctx(), t, { reason: 'polish drying', extraMinutes: 15 } as any);
    await svc.updateNotes(ctx(), t, { notes: 'allergic to acetone', customerVisibleNotes: 'Thanks for waiting' } as any);
    await svc.assignHelper(ctx(), t, { technicianId: AVA });
    const fresh = new KyselyServingRepository(db);
    const tk = (await fresh.ticket(ctx(), t))!;
    expect(tk.status).toBe('paused');
    expect(tk.pausedAtMs).toBeTruthy();
    expect(tk.delayStatus).toBe('late'); expect(tk.delayReason).toBe('polish drying');
    expect(tk.notes).toBe('allergic to acetone'); expect(tk.customerVisibleNotes).toBe('Thanks for waiting');
    expect(tk.helperTechId).toBe(AVA); expect(tk.helperTechName).toBe('Ava L');
    expect(await count(`select count(*)::int as n from ticket_service_sessions where ticket_id=$1 and status='PAUSED' and is_helper=false and technician_id=$2`, [t, MIA])).toBe(1);
    await svc.resume(ctx(), t);
    expect((await fresh.ticket(ctx(), t))!.status).toBe('delayed');   // delay still set → delayed, clock running
    await svc.clearDelay(ctx(), t, { note: 'done drying' } as any);
    expect((await fresh.ticket(ctx(), t))!.status).toBe('in_service');
    expect(await count(`select count(*)::int as n from ticket_service_sessions where ticket_id=$1 and status='STARTED'`, [t])).toBe(2);   // primary + helper
  });

  it('ONE active session per technician: a second guest is a 409 at the service AND at the index; a helper session is outside the rule', async () => {
    const second = await mkTicket('a002', MIA);
    await expect(svc.start(ctx(), second)).rejects.toMatchObject({ name: 'ConflictError', code: 'TECHNICIAN_ALREADY_SERVING' });
    expect((await repo.ticket(ctx(), second))!.status).toBe('not_started');   // nothing half-started
    await expect(q(`insert into ticket_service_sessions (tenant_id, branch_id, ticket_id, technician_id, status) values ($1,$2,$3,$4,'STARTED')`, [TA, BA, second, MIA])).rejects.toThrow(/duplicate|unique/i);
    const own = await mkTicket('a003', AVA);   // Ava helps on a001 AND takes her own guest
    await svc.start(ctx(), own);
    expect(await count(`select count(*)::int as n from ticket_service_sessions where technician_id=$1 and status in ('STARTED','PAUSED')`, [AVA])).toBe(2);
    expect(await repo.technicianActiveSession(ctx(), AVA)).toMatchObject({ ticketId: own });
    const none = await mkTicket('a004', null);
    await expect(svc.start(ctx(), none)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ONE Service Done transition — three entry points converge', () => {
  it('Serving mark-done completes every session with the key, stamps commission, flips the ticket + lines, records service.completed facts, projects workforce state', async () => {
    const t = id('a001');
    transitions.length = 0;
    const d: any = await svc.markDone(ctx(), t);
    expect(d.status).toBe('completed');
    const row = (await q(`select status, service_done_at, serving_paused_at from tickets where id=$1`, [t]))[0];
    expect(row.status).toBe('service_done'); expect(row.service_done_at).toBeTruthy(); expect(row.serving_paused_at).toBeNull();
    const sessions = await q(`select status, idempotency_key, completion_source, is_helper from ticket_service_sessions where ticket_id=$1 order by is_helper`, [t]);
    expect(sessions.map((s: any) => s.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(sessions[0].idempotency_key).toBe(`${t}:send_to_service_done:4500`); expect(sessions[0].completion_source).toBe('serving_mark_done');
    expect(sessions[1].idempotency_key).toBeNull();   // the helper row never carries the key
    const line = (await q(`select status, completed_at, commission_value_snapshot, rule_source from ticket_service_lines where ticket_id=$1`, [t]))[0];
    expect(line.status).toBe('completed'); expect(line.completed_at).toBeTruthy();
    expect(Number(line.commission_value_snapshot)).toBe(55); expect(line.rule_source).toBe('Service default');   // priced at Service Done, never $0
    expect(transitions.map((x) => x.technicianId).sort()).toEqual([AVA, MIA].sort());
    const next = await mkTicket('a006', MIA);   // Mia is free again: her next guest starts
    await svc.start(ctx(), next);
  });

  it('Serving send-to-Service-Done locks at the subtotal; a retry is a duplicate under the same key; a later status is refused', async () => {
    const t = id('a006');
    const r1 = await svc.sendToServiceDone(ctx(), t);
    expect(r1).toMatchObject({ sent: true, duplicate: false, idempotencyKey: `${t}:send_to_service_done:4500` });
    const row = (await q(`select status, service_done_locked_total_cents from tickets where id=$1`, [t]))[0];
    expect(row.status).toBe('service_done'); expect(Number(row.service_done_locked_total_cents)).toBe(4500);
    const r2 = await svc.sendToServiceDone(ctx(), t);
    expect(r2.duplicate).toBe(true);
    expect(await count(`select count(*)::int as n from ticket_service_sessions where ticket_id=$1`, [t])).toBe(1);
    expect((await repo.ticket(ctx(), t))!.status).toBe('sent_to_service_done');
    expect((await new KyselyServingRepository(db).ticket(ctx(), t))!.sentIdempotencyKey).toBe(`${t}:send_to_service_done:4500`);   // durable send key
    // a retry straight into THE transition (any entry point) finds the lock already set and never re-stamps it
    const lockedAt = (await q(`select service_done_locked_at::text as l from tickets where id=$1`, [t]))[0].l;
    const r3 = await completeServiceDone(db, {}, { tenantId: TA, ticketId: t, actor: { userId: UA }, source: 'serving_send', lock: true });
    expect(r3).toMatchObject({ duplicate: true, locked: true });
    expect((await q(`select service_done_locked_at::text as l from tickets where id=$1`, [t]))[0].l).toBe(lockedAt);
    await q(`update tickets set status='paid' where id=$1`, [t]);
    await expect(completeServiceDone(db, {}, { tenantId: TA, ticketId: t, actor: { userId: UA }, source: 'pos' })).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    await expect(completeServiceDone(db, {}, { tenantId: TA, ticketId: id('ffff'), actor: { userId: UA }, source: 'pos' })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });

  it('the tech app complete uses the SAME transition, is idempotent, refuses another technician\'s ticket, and prices a queue visit through ensureVisitTicket', async () => {
    const tech = new KyselyTechRepository(db);
    const tctx = { tenantId: TA, branchId: BA, userId: UA, role: 'TECHNICIAN' as any, permissions: [] as string[] };
    const ticket = await mkTicket('a007', AVA, 'serving');
    await q(`update ticket_service_lines set status='in_progress' where ticket_id=$1`, [ticket]);
    const tq = id('f007');
    await q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, ticket_id, customer_name, assigned_technician_id, status, requested_services) values ($1,$2,$3,$4,'Ann A',$5,'in_service','[]')`, [tq, TA, BA, ticket, AVA]);
    await tech.complete(tctx, tq, { notes: 'done' });
    expect((await q(`select status, service_done_notes from tickets where id=$1`, [ticket]))[0]).toMatchObject({ status: 'service_done', service_done_notes: 'done' });
    expect((await q(`select status from pos_tech_queue_tickets where id=$1`, [tq]))[0].status).toBe('service_done');
    const s1 = await q(`select idempotency_key, completion_source from ticket_service_sessions where ticket_id=$1`, [ticket]);
    expect(s1).toHaveLength(1); expect(s1[0].completion_source).toBe('tech_app'); expect(s1[0].idempotency_key).toBe(`${ticket}:send_to_service_done:4500`);
    await tech.complete(tctx, tq, {});   // retry → no second row, no error (service_done → service_done is a repeat)
    expect(await count(`select count(*)::int as n from ticket_service_sessions where ticket_id=$1`, [ticket])).toBe(1);
    // another technician cannot complete Ava's ticket
    const tq2 = id('f008'); const ticket2 = await mkTicket('a008', AVA, 'serving');
    await q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, ticket_id, customer_name, assigned_technician_id, status, requested_services) values ($1,$2,$3,$4,'Ann A',$5,'in_service','[]')`, [tq2, TA, BA, ticket2, MIA]);
    await expect(tech.complete(tctx, tq2, {})).rejects.toMatchObject({ code: 'forbidden' });
    // a queue VISIT with no ticket yet: the canonical ticket is created priced (per-line technician + commission), then completed
    const qi = id('e009'); const tq3 = id('f009');
    await q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, status, assigned_technician_id, requested_services) values ($1,$2,$3,$4,'Walk In','in_service',$5,$6::jsonb)`, [qi, TA, BA, CUST, AVA, JSON.stringify([{ serviceId: SVC, serviceName: 'Manicure', priceCents: 4500, estimatedDurationMinutes: 45 }])]);
    await q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, queue_item_id, customer_name, assigned_technician_id, status, requested_services) values ($1,$2,$3,$4,'Walk In',$5,'in_service',$6::jsonb)`, [tq3, TA, BA, qi, AVA, JSON.stringify([{ serviceId: SVC, serviceName: 'Manicure', priceCents: 4500 }])]);
    await tech.complete(tctx, tq3, {});
    const made = (await q(`select ticket_id from pos_tech_queue_tickets where id=$1`, [tq3]))[0].ticket_id;
    expect(made).toBeTruthy();
    const mline = (await q(`select service_id, technician_id, commission_value_snapshot, status from ticket_service_lines where ticket_id=$1`, [made]))[0];
    expect(mline.service_id).toBe(SVC); expect(mline.technician_id).toBe(AVA); expect(Number(mline.commission_value_snapshot)).toBe(55); expect(mline.status).toBe('completed');
    expect((await q(`select status from tickets where id=$1`, [made]))[0].status).toBe('service_done');
    expect((await q(`select status from pos_queue_items where id=$1`, [qi]))[0].status).toBe('completed');
    expect(await count(`select count(*)::int as n from ticket_service_lines where service_id='00000000-0000-0000-0000-000000000000'`)).toBe(0);
  });
});
