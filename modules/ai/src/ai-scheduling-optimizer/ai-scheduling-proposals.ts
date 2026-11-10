// ai-scheduling-proposals.ts — BUILD_PLAN Phase 7 (agent B): customer approval of a schedule change (SchedProposalPort +
// the customer's own view).
//
// A recommendation that touches a booked customer's appointment is never applied on staff say-so alone. When staff accept
// it, the engine calls open(): ONE live proposal per recommendation (unique index uq_sched_proposal_live), the original
// appointment kept exactly as booked (original_preserved), a TTL of `proposalTtlHours`, and a text to the customer
// through the salon's messenger (TENANT_MESSENGER — the same one booking's reschedule notice uses) with a link to
// customer-web `/appointments/proposals`. The text says WHAT would change, never WHY in internal numbers.
//
// Every status change is a compare-and-swap on (tenant, id, version, from-status): two simultaneous customer taps record
// exactly one decision; the loser gets 409 VERSION_CONFLICT (stale version) or INVALID_STATE (already decided).
//   proposed ─notify→ customer_notified ─customer/staff→ customer_approved | customer_rejected
//   (live) ─TTL→ expired     (live) ─withdraw→ withdrawn     customer_approved ─apply→ applied
// A customer's decision is then handed to the engine (customerDecided) and the salon's managers are told.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { SCHEDULE_CHANGE_PROPOSAL } from '../ai-lifecycles';
import { localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import type { SchedProposalSummary, SchedProposalStatus, SchedRecommendation, SchedRecType } from '@aipowersalon/api-contracts/tenant';
import type { CustomerScheduleProposal, CustomerScheduleProposalList } from '@aipowersalon/api-contracts/customer';
import type { SchedCtx, SchedProposalPort } from './ai-scheduling.ports';
import { SchedOpsError, iso, isUuid, rowsOf, schedSystemCtx, uuidOrNull, unwrapRec, type SchedEngine } from './ai-scheduling-ops.common';

export const DEFAULT_TZ = 'America/New_York';
export const LIVE: SchedProposalStatus[] = ['proposed', 'customer_notified'];
export const DEFAULT_PROPOSAL_TTL_HOURS = 24;
export const clampTtlHours = (h: unknown): number => { const n = Number(h); return Number.isFinite(n) ? Math.max(1, Math.min(168, Math.round(n))) : DEFAULT_PROPOSAL_TTL_HOURS; };

export interface ProposalRow {
  id: string; tenantId: string; branchId: string | null; recommendationId: string; appointmentId: string; customerId: string | null;
  status: SchedProposalStatus; proposedStart: string | null; proposedEnd: string | null; proposedTechnicianId: string | null;
  originalStart: string | null; originalTechnicianId: string | null; expiresAt: string | null;
  notifiedAt: string | null; notificationAttempts: number; decidedAt: string | null; decisionChannel: string | null; decidedByUserId: string | null;
  version: number; createdAt: string; updatedAt: string;
}
export type ProposalInsert = Omit<ProposalRow, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'notifiedAt' | 'notificationAttempts' | 'decidedAt' | 'decisionChannel' | 'decidedByUserId'>;
export type ProposalPatch = Partial<Pick<ProposalRow, 'status' | 'notifiedAt' | 'decidedAt' | 'decisionChannel' | 'decidedByUserId'>> & { bumpAttempts?: boolean };
export interface ProposalContact { phone: string | null; salonName: string; branchName: string | null; services: string[]; technicianNames: Record<string, string>; /** customers.preferred_language (§54 / §119) */ language?: string | null }

export interface ProposalStore {
  branchTz(tenantId: string, branchId: string | null): Promise<string>;
  insert(row: ProposalInsert): Promise<ProposalRow | null>;          // null = a live proposal already exists (unique index)
  get(tenantId: string, id: string): Promise<ProposalRow | null>;
  live(tenantId: string, recommendationId: string): Promise<ProposalRow | null>;
  latestByRec(tenantId: string, recommendationIds: string[]): Promise<ProposalRow[]>;
  /** CAS: (tenant, id, version = expected, status ∈ from) → patch + version+1. null = nothing matched. */
  transition(tenantId: string, id: string, expectedVersion: number, from: SchedProposalStatus[], patch: ProposalPatch): Promise<ProposalRow | null>;
  forCustomer(tenantId: string, customerId: string): Promise<ProposalRow[]>;
  expireLive(tenantId: string, nowIso: string): Promise<ProposalRow[]>;
  resolveCustomerId(tenantId: string, userId: string): Promise<string | null>;
  contact(tenantId: string, branchId: string | null, appointmentId: string, technicianIds: string[]): Promise<ProposalContact>;
}

/** The salon's messenger (TENANT_MESSENGER — packages/notifications TenantMessenger.sendSms, declared narrowly here). */
export interface ProposalMessenger { sendSms(req: { tenantId: string | null; branchId?: string | null; to: string; body: string; purpose: 'notification'; customerId?: string | null }): Promise<{ sent: boolean; status: string; reason?: string }> }
export interface ProposalStaffNotifier { customerDecided(p: ProposalRow, approved: boolean, engineOk: boolean): Promise<void> }

// ── time: the wire speaks the branch's wall clock, the table stores instants ───────────────────────────────────────────
export function localToIso(date: string, time: string, tz: string): string | null {
  const ms = localDateTimeToEpochMs(date, time, tz);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function isoToLocal(v: string | null, tz: string): { date: string; startTime: string } | null {
  if (!v) return null;
  const p = zonedParts(new Date(v), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, startTime: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function toSummary(p: ProposalRow, tz: string, nowMs = Date.now()): SchedProposalSummary {
  const prop = isoToLocal(p.proposedStart, tz), orig = isoToLocal(p.originalStart, tz);
  return {
    id: p.id, status: effectiveStatus(p, nowMs), customerId: p.customerId,
    proposedDate: prop?.date ?? '', proposedStartTime: prop?.startTime ?? '', proposedTechnicianId: p.proposedTechnicianId,
    originalDate: orig?.date ?? '', originalStartTime: orig?.startTime ?? '', originalTechnicianId: p.originalTechnicianId,
    notifiedAt: p.notifiedAt, decidedAt: p.decidedAt, decisionChannel: p.decisionChannel, expiresAt: p.expiresAt,
  };
}
/** A live proposal past its TTL reads as expired even before the sweep marks it. */
export function effectiveStatus(p: Pick<ProposalRow, 'status' | 'expiresAt'>, nowMs = Date.now()): SchedProposalStatus {
  return LIVE.includes(p.status) && p.expiresAt && Date.parse(p.expiresAt) <= nowMs ? 'expired' : p.status;
}

const CUSTOMER_REASON: Partial<Record<SchedRecType, string>> = {
  move_appointment: 'We found a time that fits your visit better into the day.',
  change_technician: 'Another technician can take care of you at this time.',
  offer_alternate_time: 'We would like to offer you a different time.',
  resolve_overbooking: 'We need to adjust the schedule so your visit is not rushed.',
  fill_gap: 'We found a time that fits your visit better into the day.',
};
/** Customer-safe words for the change. Never metrics, never another guest. */
export function customerReason(type: SchedRecType | null | undefined): string { return (type && CUSTOMER_REASON[type]) || 'The salon would like to adjust your appointment time.'; }

export function proposalText(input: { salonName: string; original: { date: string; startTime: string }; proposed: { date: string; startTime: string }; technicianName: string | null; technicianChanges: boolean; link: string; language?: string | null }): string {
  // English only (Kevin, Nov 9 2026): the customer's language does not change the words; the salon's names stay as they are
  const when = (x: { date: string; startTime: string }) => `${x.date} at ${x.startTime}`;
  const tech = input.technicianChanges && input.technicianName ? ` with ${input.technicianName}` : '';
  return `${input.salonName}: we'd like to move your appointment on ${when(input.original)} to ${when(input.proposed)}${tech}. `
    + `Your original time stays booked until you approve. Review and approve or decline: ${input.link}`;
}
export function proposalLink(env: NodeJS.ProcessEnv = process.env): string {
  const base = String(env.PUBLIC_CUSTOMER_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/appointments/proposals`;
}

export class ScheduleProposalService implements SchedProposalPort {
  constructor(
    private readonly store: ProposalStore,
    private readonly engine: SchedEngine,
    private readonly messenger: ProposalMessenger | null,
    private readonly staff: ProposalStaffNotifier | null,
    private readonly now: () => number = Date.now,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async summary(p: ProposalRow): Promise<SchedProposalSummary> { return toSummary(p, await this.store.branchTz(p.tenantId, p.branchId), this.now()); }

  private async ttlHours(ctx: SchedCtx): Promise<number> {
    try { return clampTtlHours((await this.engine.effectiveConfig(ctx))?.config?.proposalTtlHours); } catch { return DEFAULT_PROPOSAL_TTL_HOURS; }
  }

  /** Idempotent per recommendation: the live proposal if there is one, else a new one + the customer's text. */
  async open(ctx: SchedCtx, rec: SchedRecommendation): Promise<SchedProposalSummary> {
    const existing = await this.store.live(ctx.tenantId, rec.id);
    if (existing) return this.summary(existing);
    const cur = rec.currentState, prop = rec.proposedState;
    if (!cur || !prop) throw new SchedOpsError('INVALID_STATE', 'This recommendation does not change an appointment — there is nothing for a customer to approve.');
    if (!cur.customerId) throw new SchedOpsError('INVALID_STATE', 'This appointment has no customer on file to ask.');
    const tz = await this.store.branchTz(ctx.tenantId, rec.branchId);
    const proposedStart = localToIso(prop.date, prop.startTime, tz), proposedEnd = localToIso(prop.date, prop.endTime, tz), originalStart = localToIso(cur.date, cur.startTime, tz);
    if (!proposedStart || !originalStart) throw new SchedOpsError('VALIDATION', 'The proposed or original time is not a valid date and time.');
    const expiresAt = new Date(this.now() + (await this.ttlHours(ctx)) * 3_600_000).toISOString();
    const row = await this.store.insert({
      tenantId: ctx.tenantId, branchId: rec.branchId, recommendationId: rec.id, appointmentId: prop.appointmentId || cur.appointmentId, customerId: cur.customerId,
      status: 'proposed', proposedStart, proposedEnd, proposedTechnicianId: prop.technicianId ?? null, originalStart, originalTechnicianId: cur.technicianId ?? null, expiresAt,
    }) ?? await this.store.live(ctx.tenantId, rec.id);            // lost the race to a concurrent open: use the winner
    if (!row) throw new SchedOpsError('VERSION_CONFLICT', 'The proposal changed while it was being opened — reload and try again.');
    return this.summary(await this.notify(row, rec.type));
  }

  /** Text the customer; on a handed-off text the proposal becomes customer_notified. Attempts are always counted. */
  private async notify(p: ProposalRow, type: SchedRecType | null): Promise<ProposalRow> {
    const tz = await this.store.branchTz(p.tenantId, p.branchId);
    const techIds = [p.proposedTechnicianId, p.originalTechnicianId].filter((x): x is string => !!x);
    const contact = await this.store.contact(p.tenantId, p.branchId, p.appointmentId, techIds).catch(() => null);
    let sent = false;
    const original = isoToLocal(p.originalStart, tz), proposed = isoToLocal(p.proposedStart, tz);
    if (this.messenger && contact?.phone && original && proposed) {
      const body = proposalText({ salonName: contact.branchName || contact.salonName, original, proposed,
        technicianName: p.proposedTechnicianId ? contact.technicianNames[p.proposedTechnicianId] ?? null : null,
        technicianChanges: (p.proposedTechnicianId ?? null) !== (p.originalTechnicianId ?? null), link: proposalLink(this.env), language: contact.language ?? null });
      try { sent = !!(await this.messenger.sendSms({ tenantId: p.tenantId, branchId: p.branchId, to: contact.phone, body, purpose: 'notification', customerId: p.customerId }))?.sent; }
      catch { sent = false; }
    }
    void type;
    const patch: ProposalPatch = sent ? { status: 'customer_notified', notifiedAt: new Date(this.now()).toISOString(), bumpAttempts: true } : { bumpAttempts: true };
    return (await this.store.transition(p.tenantId, p.id, p.version, LIVE, patch)) ?? p;
  }

  async resend(ctx: SchedCtx, recommendationId: string): Promise<SchedProposalSummary> {
    const live = await this.store.live(ctx.tenantId, recommendationId);
    if (live) {
      if (effectiveStatus(live, this.now()) === 'expired') throw new SchedOpsError('INVALID_STATE', 'This proposal has expired — generate a new recommendation.');
      return this.summary(await this.notify(live, null));
    }
    const rec = unwrapRec(await this.engine.get(ctx, recommendationId));
    if (!rec) throw new SchedOpsError('NOT_FOUND', 'Recommendation not found.');
    if (rec.status !== 'customer_approval_required') throw new SchedOpsError('INVALID_STATE', 'This recommendation is not waiting for the customer.');
    return this.open(ctx, rec);
  }

  /** Staff record the customer's answer given by phone / in person. The ENGINE then calls customerDecided itself. */
  async recordStaffDecision(ctx: SchedCtx, recommendationId: string, approved: boolean): Promise<SchedProposalSummary> {
    const live = await this.store.live(ctx.tenantId, recommendationId);
    if (!live) throw new SchedOpsError('INVALID_STATE', 'There is no open customer proposal for this recommendation.');
    if (effectiveStatus(live, this.now()) === 'expired') throw new SchedOpsError('INVALID_STATE', 'This proposal has expired.');
    const done = await this.store.transition(ctx.tenantId, live.id, live.version, LIVE, {
      status: approved ? 'customer_approved' : 'customer_rejected', decidedAt: new Date(this.now()).toISOString(), decisionChannel: 'staff_recorded', decidedByUserId: uuidOrNull(ctx.userId),
    });
    if (!done) throw new SchedOpsError('VERSION_CONFLICT', 'The customer\'s answer was just recorded elsewhere — reload.');
    return this.summary(done);
  }

  async withdraw(ctx: SchedCtx, recommendationId: string, reason: string): Promise<void> {
    const live = await this.store.live(ctx.tenantId, recommendationId);
    if (!live) return;
    await this.store.transition(ctx.tenantId, live.id, live.version, LIVE, { status: /expir/i.test(reason) ? 'expired' : 'withdrawn' });
  }

  async markApplied(ctx: SchedCtx, recommendationId: string): Promise<void> {
    const [latest] = await this.store.latestByRec(ctx.tenantId, [recommendationId]);
    if (latest && latest.status === 'customer_approved') await this.store.transition(ctx.tenantId, latest.id, latest.version, ['customer_approved'], { status: 'applied' });
  }

  async summaries(ctx: SchedCtx, recommendationIds: string[]): Promise<Record<string, SchedProposalSummary>> {
    const ids = [...new Set(recommendationIds.filter(isUuid))];
    if (!ids.length) return {};
    const out: Record<string, SchedProposalSummary> = {};
    for (const p of await this.store.latestByRec(ctx.tenantId, ids)) if (!out[p.recommendationId]) out[p.recommendationId] = await this.summary(p);
    return out;
  }

  /** Sweep: live proposals past their TTL → expired. */
  async expireDue(tenantId: string): Promise<number> { return (await this.store.expireLive(tenantId, new Date(this.now()).toISOString())).length; }

  // ── the customer's side (customer session) ────────────────────────────────────────────────────────────────────────
  private async customerId(ctx: { tenantId: string; userId: string }): Promise<string> {
    const id = isUuid(ctx.userId) && isUuid(ctx.tenantId) ? await this.store.resolveCustomerId(ctx.tenantId, ctx.userId) : null;
    if (!id) throw new SchedOpsError('FORBIDDEN', 'No customer profile is linked to this account.');
    return id;
  }

  private async customerView(p: ProposalRow): Promise<CustomerScheduleProposal> {
    const tz = await this.store.branchTz(p.tenantId, p.branchId);
    const techIds = [p.proposedTechnicianId, p.originalTechnicianId].filter((x): x is string => !!x);
    const c = await this.store.contact(p.tenantId, p.branchId, p.appointmentId, techIds);
    const orig = isoToLocal(p.originalStart, tz) ?? { date: '', startTime: '' }, prop = isoToLocal(p.proposedStart, tz) ?? { date: '', startTime: '' };
    const recType = await this.recType(p);
    return {
      id: p.id, salonName: c.salonName, branchName: c.branchName, appointmentId: p.appointmentId, services: c.services,
      original: { ...orig, technicianName: p.originalTechnicianId ? c.technicianNames[p.originalTechnicianId] ?? null : null },
      proposed: { ...prop, technicianName: p.proposedTechnicianId ? c.technicianNames[p.proposedTechnicianId] ?? null : null },
      reason: customerReason(recType), status: effectiveStatus(p, this.now()), expiresAt: p.expiresAt, version: p.version,
    };
  }
  private async recType(p: ProposalRow): Promise<SchedRecType | null> {
    try { return unwrapRec(await this.engine.get(schedSystemCtx(p.tenantId, p.branchId, 'customer_web', ['ai_scheduling.view']), p.recommendationId))?.type ?? null; } catch { return null; }
  }

  async listForCustomer(ctx: { tenantId: string; userId: string }): Promise<CustomerScheduleProposalList> {
    const customerId = await this.customerId(ctx);
    const rows = await this.store.forCustomer(ctx.tenantId, customerId);
    return { items: await Promise.all(rows.map((p) => this.customerView(p))) };
  }

  /** The signed-in customer approves / declines THEIR proposal. Exactly one decision wins (CAS on version + status). */
  async customerDecide(ctx: { tenantId: string; userId: string }, proposalId: string, approved: boolean, expectedVersion: unknown): Promise<CustomerScheduleProposal> {
    const customerId = await this.customerId(ctx);
    if (!isUuid(proposalId)) throw new SchedOpsError('NOT_FOUND', 'Proposal not found.');
    const p = await this.store.get(ctx.tenantId, proposalId);
    if (!p || p.customerId !== customerId) throw new SchedOpsError('NOT_FOUND', 'Proposal not found.');     // never confirm another customer's proposal exists
    const v = Number(expectedVersion);
    if (!Number.isInteger(v) || v < 1) throw new SchedOpsError('VALIDATION', 'expectedVersion is required.');
    if (effectiveStatus(p, this.now()) === 'expired') throw new SchedOpsError('INVALID_STATE', 'This proposal has expired — your original appointment is unchanged.');
    if (!LIVE.includes(p.status)) throw new SchedOpsError('INVALID_STATE', 'You have already answered this proposal.');
    const done = await this.store.transition(ctx.tenantId, p.id, v, LIVE, {
      status: approved ? 'customer_approved' : 'customer_rejected', decidedAt: new Date(this.now()).toISOString(), decisionChannel: 'customer_web', decidedByUserId: null,
    });
    if (!done) {
      const now = await this.store.get(ctx.tenantId, p.id);
      if (now && !LIVE.includes(now.status)) throw new SchedOpsError('INVALID_STATE', 'You have already answered this proposal.', { currentVersion: now.version });
      throw new SchedOpsError('VERSION_CONFLICT', 'This proposal changed — reload and try again.', { currentVersion: now?.version ?? null });
    }
    // the engine moves the recommendation (customer_approved → staff can apply; rejected → closed)
    let engineOk = true;
    try { await this.engine.customerDecided(schedSystemCtx(ctx.tenantId, done.branchId, 'customer_web', ['ai_scheduling.view']), done.recommendationId, approved); }
    catch { engineOk = false; /* the customer's answer is recorded; the managers are told it needs attention */ }
    await this.staff?.customerDecided(done, approved, engineOk).catch(() => undefined);
    return this.customerView(done);
  }
}

// ── stores ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const fromDb = (r: any): ProposalRow => ({
  id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ?? null, recommendationId: String(r.recommendation_id), appointmentId: String(r.appointment_id),
  customerId: r.customer_id ?? null, status: r.status, proposedStart: iso(r.proposed_start), proposedEnd: iso(r.proposed_end), proposedTechnicianId: r.proposed_technician_id ?? null,
  originalStart: iso(r.original_start), originalTechnicianId: r.original_technician_id ?? null, expiresAt: iso(r.expires_at), notifiedAt: iso(r.notified_at),
  notificationAttempts: Number(r.notification_attempts ?? 0), decidedAt: iso(r.decided_at), decisionChannel: r.decision_channel ?? null, decidedByUserId: r.decided_by_user_id ?? null,
  version: Number(r.version ?? 1), createdAt: iso(r.created_at) ?? '', updatedAt: iso(r.updated_at) ?? '',
});
const svcNames = (services: unknown): string[] => (Array.isArray(services) ? services : [])
  .map((s: any) => (typeof s === 'string' ? s : s?.name ?? s?.serviceName ?? s?.service_name ?? null)).filter((x: unknown): x is string => typeof x === 'string' && !!x).slice(0, 10);

export class KyselyProposalStore implements ProposalStore {
  constructor(private readonly db: Kysely<any>) {}
  async branchTz(tenantId: string, branchId: string | null): Promise<string> {
    if (!branchId) return DEFAULT_TZ;
    const r = rowsOf(await sql`select timezone from branches where id = ${branchId} and tenant_id = ${tenantId}`.execute(this.db))[0];
    return (r?.timezone && String(r.timezone)) || DEFAULT_TZ;
  }
  async insert(p: ProposalInsert): Promise<ProposalRow | null> {
    const r = rowsOf(await sql`
      insert into schedule_change_proposals (tenant_id, branch_id, recommendation_id, appointment_id, customer_id, status, proposed_start, proposed_end,
                                             proposed_technician_id, original_start, original_technician_id, original_preserved, expires_at)
      values (${p.tenantId}, ${p.branchId}, ${p.recommendationId}, ${p.appointmentId}, ${p.customerId}, ${p.status}, ${p.proposedStart}, ${p.proposedEnd},
              ${p.proposedTechnicianId}, ${p.originalStart}, ${p.originalTechnicianId}, true, ${p.expiresAt})
      on conflict (tenant_id, recommendation_id) where status in ('proposed','customer_notified') do nothing
      returning *`.execute(this.db))[0];
    return r ? fromDb(r) : null;
  }
  async get(tenantId: string, id: string) {
    const r = rowsOf(await sql`select * from schedule_change_proposals where tenant_id = ${tenantId} and id = ${id}`.execute(this.db))[0];
    return r ? fromDb(r) : null;
  }
  async live(tenantId: string, recommendationId: string) {
    const r = rowsOf(await sql`select * from schedule_change_proposals where tenant_id = ${tenantId} and recommendation_id = ${recommendationId}
                                 and status in ('proposed','customer_notified') limit 1`.execute(this.db))[0];
    return r ? fromDb(r) : null;
  }
  async latestByRec(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    return rowsOf(await sql`select distinct on (recommendation_id) * from schedule_change_proposals
                             where tenant_id = ${tenantId} and recommendation_id in (${sql.join(ids)})
                             order by recommendation_id, created_at desc`.execute(this.db)).map(fromDb);
  }
  async transition(tenantId: string, id: string, expectedVersion: number, from: SchedProposalStatus[], patch: ProposalPatch) {
    const set: any[] = [sql`version = version + 1`, sql`updated_at = now()`];
    if (patch.status !== undefined) set.push(sql`status = ${patch.status}`);
    if (patch.notifiedAt !== undefined) set.push(sql`notified_at = ${patch.notifiedAt}`);
    if (patch.decidedAt !== undefined) set.push(sql`decided_at = ${patch.decidedAt}`);
    if (patch.decisionChannel !== undefined) set.push(sql`decision_channel = ${patch.decisionChannel}`);
    if (patch.decidedByUserId !== undefined) set.push(sql`decided_by_user_id = ${patch.decidedByUserId}`);
    if (patch.bumpAttempts) set.push(sql`notification_attempts = notification_attempts + 1`);
    const r = rowsOf(await sql`update schedule_change_proposals set ${sql.join(set)}
                                where tenant_id = ${tenantId} and id = ${id} and version = ${expectedVersion} and status in (${sql.join(from)})
                                  and ${patch.status !== undefined ? canMoveToSql(SCHEDULE_CHANGE_PROPOSAL, patch.status) : sql`true`}
                                returning *`.execute(this.db))[0];
    return r ? fromDb(r) : null;
  }
  async forCustomer(tenantId: string, customerId: string) {
    return rowsOf(await sql`select * from schedule_change_proposals where tenant_id = ${tenantId} and customer_id = ${customerId}
                             and (status in ('proposed','customer_notified') or created_at > now() - interval '30 days')
                             order by created_at desc limit 50`.execute(this.db)).map(fromDb);
  }
  async expireLive(tenantId: string, nowIso: string) {
    return rowsOf(await sql`update schedule_change_proposals set status = 'expired', version = version + 1, updated_at = now()
                             where tenant_id = ${tenantId} and status in ('proposed','customer_notified') and ${canMoveToSql(SCHEDULE_CHANGE_PROPOSAL, 'expired')} and expires_at <= ${nowIso}
                             returning *`.execute(this.db)).map(fromDb);
  }
  async resolveCustomerId(tenantId: string, userId: string) {
    const r = rowsOf(await sql`select id from customers where tenant_id = ${tenantId} and user_id = ${userId} and archived_at is null limit 1`.execute(this.db))[0];
    return r ? String(r.id) : null;
  }
  async contact(tenantId: string, branchId: string | null, appointmentId: string, technicianIds: string[]): Promise<ProposalContact> {
    const a = rowsOf(await sql`select a.customer_phone, a.services, c.normalized_phone, c.phone_display, c.preferred_language
                                 from pos_tech_appointments a left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
                                where a.tenant_id = ${tenantId} and a.id = ${appointmentId}`.execute(this.db))[0];
    const t = rowsOf(await sql`select display_name from tenants where id = ${tenantId}`.execute(this.db))[0];
    const b = branchId ? rowsOf(await sql`select name, public_display_name from branches where id = ${branchId} and tenant_id = ${tenantId}`.execute(this.db))[0] : null;
    const ids = technicianIds.filter(isUuid);
    const techs = ids.length ? rowsOf(await sql`select id, first_name, full_name from technicians where tenant_id = ${tenantId} and id in (${sql.join(ids)})`.execute(this.db)) : [];
    const technicianNames: Record<string, string> = {};
    for (const x of techs) technicianNames[String(x.id)] = String(x.first_name || x.full_name || 'your technician');   // first name only: it is shown to the customer
    return {
      phone: (a?.normalized_phone || a?.customer_phone || a?.phone_display || null) as string | null,
      salonName: String(t?.display_name || 'Your salon'), branchName: (b?.public_display_name || b?.name || null) as string | null,
      services: svcNames(a?.services), technicianNames, language: (a?.preferred_language ?? null) as string | null,
    };
  }
}

export class InMemoryProposalStore implements ProposalStore {
  rows: ProposalRow[] = [];
  customers: { tenantId: string; userId: string; customerId: string }[] = [];
  contacts: Record<string, Partial<ProposalContact>> = {};
  private seq = 0;
  async branchTz() { return 'UTC'; }
  async insert(p: ProposalInsert) {
    if (this.rows.some((r) => r.tenantId === p.tenantId && r.recommendationId === p.recommendationId && LIVE.includes(r.status))) return null;
    const now = new Date().toISOString();
    const row: ProposalRow = { ...p, id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`, version: 1, createdAt: now, updatedAt: now, notifiedAt: null, notificationAttempts: 0, decidedAt: null, decisionChannel: null, decidedByUserId: null };
    this.rows.push(row);
    return { ...row };
  }
  async get(tenantId: string, id: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id); return r ? { ...r } : null; }
  async live(tenantId: string, recId: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.recommendationId === recId && LIVE.includes(x.status)); return r ? { ...r } : null; }
  async latestByRec(tenantId: string, ids: string[]) { return [...this.rows].reverse().filter((x) => x.tenantId === tenantId && ids.includes(x.recommendationId)).map((r) => ({ ...r })); }
  async transition(tenantId: string, id: string, v: number, from: SchedProposalStatus[], patch: ProposalPatch) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id && x.version === v && from.includes(x.status));
    if (!r) return null;
    const { bumpAttempts, ...rest } = patch;
    Object.assign(r, rest, { version: r.version + 1, updatedAt: new Date().toISOString() });
    if (bumpAttempts) r.notificationAttempts++;
    return { ...r };
  }
  async forCustomer(tenantId: string, customerId: string) { return this.rows.filter((x) => x.tenantId === tenantId && x.customerId === customerId).map((r) => ({ ...r })); }
  async expireLive(tenantId: string, nowIso: string) {
    const hit = this.rows.filter((x) => x.tenantId === tenantId && LIVE.includes(x.status) && x.expiresAt && x.expiresAt <= nowIso);
    for (const r of hit) { r.status = 'expired'; r.version++; }
    return hit.map((r) => ({ ...r }));
  }
  async resolveCustomerId(tenantId: string, userId: string) { return this.customers.find((c) => c.tenantId === tenantId && c.userId === userId)?.customerId ?? null; }
  async contact(_t: string, _b: string | null, appointmentId: string): Promise<ProposalContact> {
    return { phone: null, salonName: 'Salon', branchName: null, services: [], technicianNames: {}, ...(this.contacts[appointmentId] || {}) };
  }
}

/** Managers hear about a customer's answer: an owner alert (the Owner app's feed) + a push to the location's managers.
 *  Text built from the decision only — no customer name or phone (it lands on lock screens). */
export class KyselyProposalStaffNotifier implements ProposalStaffNotifier {
  constructor(private readonly db: Kysely<any>, private readonly push: { dispatchToUser(tenantId: string, userId: string, msg: any): Promise<{ sent: number } | any> } | null = null) {}
  async customerDecided(p: ProposalRow, approved: boolean, engineOk: boolean): Promise<void> {
    const title = approved ? 'Customer approved a new appointment time' : 'Customer declined a new appointment time';
    const body = !engineOk ? 'The answer is recorded but the recommendation needs attention in the AI Scheduling Optimizer.'
      : approved ? 'The change is ready to apply in the AI Scheduling Optimizer.' : 'The original appointment stays as booked.';
    await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
              values (${p.tenantId}, ${p.branchId}, 'schedule_proposal', ${engineOk ? 'info' : 'warning'}, 'new', ${title}, ${body},
                      ${JSON.stringify({ proposalId: p.id, recommendationId: p.recommendationId, appointmentId: p.appointmentId, approved })}::jsonb, 'all')`.execute(this.db).catch(() => undefined);
    if (!this.push) return;
    const managers = rowsOf(await sql`select id from users where tenant_id = ${p.tenantId} and role = 'MANAGER' and status = 'active'
                                        and (branch_id = ${p.branchId} or branch_id is null)`.execute(this.db).catch(() => ({ rows: [] })));
    for (const m of managers) await this.push.dispatchToUser(p.tenantId, String(m.id), { title, body, reference: 'schedule_proposal', category: 'APPROVAL_REQUIRED', data: { kind: 'schedule_proposal', proposalId: p.id, recommendationId: p.recommendationId, approved } }).catch(() => null);
  }
}
