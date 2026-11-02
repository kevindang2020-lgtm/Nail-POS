// front-desk-center.ts — AI Front Desk Complete Build Guide (Oct 31 2026): `/pos/ai/front-desk/*`.
//
// P0 (guide §2.1, from code): the photographed "No agents yet" is honest when the salon has no ai_receptionist_agents row —
// the old screen read GET /tenant/ai/receptionist/agents (tenant-scoped, unpaged, LIMIT 500) and filtered client-side, so an
// API failure surfaced as "Failed to load" and an agent hidden by the filter as "No agents". The real defect was elsewhere:
//   • the plain status route (POST /tenant/ai/receptionist/agents/:id/status) let any ai.manage holder move ready → LIVE with
//     no routing evidence, no owner approval, no salon activation and no record of the previous live agent (§7 invariant);
//   • a live agent could be paused/archived there while the salon stayed "activated" with booking armed;
//   • nothing stopped two agents being live on the same salon route.
// That route now refuses every move into or out of `live` and out of `archived`; those happen only here.
//
// Model (reuses the canonical registry + guide-21 salon control; no parallel agent or routing store):
//   canonical status   draft · ready · live · paused · error · archived   (ai_receptionist_agents.status, AI_RECEPTIONIST_AGENT)
//   effective state    draft · setup_required · ready · active · degraded · paused · archived   (computed, never stored)
//     active = status live AND the salon receptionist stage is `live` (every guide-21 gate + verified test call + activated)
//              AND the most recent recorded call on this route was answered by THIS agent's provider id.
//     Anything less on a live agent is `degraded` — never a green "Live".
//   activation (owner)  preflight → per-route advisory lock + one-live partial unique index → demote the prior live agent
//                       (recorded as the rollback destination) → agent live → salon control activated → events + audit, ONE
//                       transaction. Nothing external is called (no Twilio/Retell mutation from here): a failure leaves the
//                       previous route untouched. Provider-side re-routing is BLOCKED_EXTERNAL and stated as such.
//   pause (ai.manage)   live agent → paused, salon deactivated AND booking disarmed (AI booking actions stop at once).
//   rollback (owner)    re-activates the agent recorded as `prior_agent_id` on this agent's last activation — same gates.
// Drafts are rows only: create / save / duplicate never call a provider, place a call or change a route.
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { randomUUID } from 'node:crypto';
import { canMoveToSql } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { AI_RECEPTIONIST_AGENT } from '../ai-lifecycles';
import { normalizeAgentConfig, DEFAULT_BEHAVIOR, DEFAULT_GREETING } from './ai-agent-core';
import { RC_PERIODS, isUuid, type ReceptionistCenter, type RcCtx, type RcCheck, type RcState, type RcBusinessReadiness } from './receptionist-center';

type Row = Record<string, any>;
export type FdCtx = RcCtx;

export const FRONT_DESK_CENTER = 'FrontDeskCenter';
export const FD_FILTERS = ['all', 'draft', 'setup_required', 'ready', 'active', 'degraded', 'paused', 'archived'] as const;
export const FD_EFFECTIVE = ['draft', 'setup_required', 'ready', 'active', 'degraded', 'paused', 'archived'] as const;
export type FdEffective = typeof FD_EFFECTIVE[number];
export const FD_DATE_BASES = ['created', 'updated', 'activated'] as const;
export const FD_SORTS = ['newest', 'oldest', 'name_az', 'name_za', 'updated'] as const;
export const FD_EVENT_ACTIONS = ['created', 'saved', 'duplicated', 'activated', 'paused', 'resumed', 'archived', 'restored', 'rolled_back', 'health_checked', 'demoted'] as const;
export const FD_BOOKING_MODES = ['handoff_only', 'eligible'] as const;
export const FD_WIZARD_STEPS = 8;
/** steps the salon completes in the wizard; 5–8 are evidence steps (provider, route, test, activation) read from checks */
export const FD_INPUT_STEPS = [1, 2, 3, 4] as const;
export const FD_PAGE_SIZES = [10, 20, 50] as const;
/** the salon gates every activation re-checks (guide-21 check ids) */
export const FD_ACTIVATION_GATES = ['ent.package', 'tw.account', 'tw.route', 'rt.agent', 'key.active', 'biz.setup', 'rd.test_call'] as const;
const HANDOFF = /^(\+[1-9]\d{7,14}|voicemail|front_desk)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** a real calendar day (rejects 2026-13-01, 2026-02-30) */
const realDay = (v: string) => { if (!DATE.test(v)) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && utcDate(d) === v; };
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const nowIso = () => new Date().toISOString();
const trace = () => 'fd_' + randomUUID().slice(0, 8);
const pageOf = (p: unknown) => Math.max(1, Math.trunc(Number(p) || 1));
const sizeOf = (s: unknown) => ((FD_PAGE_SIZES as readonly number[]).includes(Number(s)) ? Number(s) : 20);
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const ZERO = '00000000-0000-0000-0000-000000000000';
/** every agent column this center reads or returns (no whole-row reads — response-exposure) */
const AG = sql.raw('id, tenant_id, branch_id, name, description, status, call_type, language, use_case, greeting, behavior, provider, provider_agent_id, knowledge_version, config_version, wizard_step, wizard_state, booking_mode, handoff_destination, after_hours_message, activated_at, activated_by, paused_at, last_verified_at, archived_at, created_by_user_id, created_at, updated_at');
const AG_A = sql.raw('a.id, a.tenant_id, a.branch_id, a.name, a.description, a.status, a.call_type, a.language, a.use_case, a.greeting, a.behavior, a.provider, a.provider_agent_id, a.knowledge_version, a.config_version, a.wizard_step, a.wizard_state, a.booking_mode, a.handoff_destination, a.after_hours_message, a.activated_at, a.activated_by, a.paused_at, a.last_verified_at, a.archived_at, a.created_by_user_id, a.created_at, a.updated_at');
/** provider references are shown as a suffix only — never the full id in a list */
export const refSuffix = (v: unknown) => { const s = String(v ?? ''); return s ? '…' + s.slice(-6) : null; };

export class FrontDeskError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}

/** the state the salon sees — never higher than the evidence (guide §7 core invariant) */
export function effectiveState(a: { status: string; providerAgentId: string | null; wizardComplete: boolean },
  route: { salonLive: boolean; routedAgentRef: string | null }): FdEffective {
  switch (a.status) {
    case 'archived': return 'archived';
    case 'paused': return 'paused';
    case 'error': return 'degraded';
    case 'ready': return 'ready';
    case 'live': return route.salonLive && !!a.providerAgentId && route.routedAgentRef === a.providerAgentId ? 'active' : 'degraded';
    default: return a.wizardComplete ? 'setup_required' : 'draft';
  }
}

interface Route { salonLive: boolean; stage: string; routedAgentRef: string | null; routedAt: string | null; routedCallRef: string | null; testAgentRef: string | null; control: Row | null }

export class FrontDeskCenter {
  constructor(private readonly db: Kysely<any>, private readonly rc: ReceptionistCenter, private readonly business: RcBusinessReadiness | null = null) {}

  private branch(ctx: FdCtx): string | null { return isUuid(ctx.branchId) ? ctx.branchId : null; }
  private owner(ctx: FdCtx) { if (String(ctx.role ?? '').toUpperCase() !== 'OWNER') throw new FrontDeskError('Only the salon owner can approve this change to live call routing.', 'AI_FD_OWNER_REQUIRED', 403); }
  private reason(r: unknown, min = 5) { const s = String(r ?? '').trim(); if (s.length < min) throw new FrontDeskError(`Give a short reason (at least ${min} characters).`, 'AI_FD_REASON_REQUIRED'); return s.slice(0, 500); }

  /** what the salon's phone route actually reaches, from recorded calls (guide §10.2 provider route) */
  async route(ctx: FdCtx, readiness?: { stage: string; control: Row | null }): Promise<Route> {
    const T = ctx.tenantId; const b = this.branch(ctx);
    const r = readiness ?? await this.rc.readiness(ctx);
    const ctl = await this.rc.control(ctx);
    const test: Row | undefined = ctl?.test_call_provider_call_id ? (await sql<Row>`select agent_ref from voice_call_outcomes where tenant_id = ${T}
      and provider_call_id = ${ctl.test_call_provider_call_id} limit 1`.execute(this.db)).rows[0] : undefined;
    const last: Row | undefined = (await sql<Row>`select provider_call_id, agent_ref, coalesce(started_at, created_at) at_ from voice_call_outcomes where tenant_id = ${T}
      and (${b}::uuid is null or branch_id = ${b}) and agent_ref is not null and coalesce(started_at, created_at) > now() - interval '7 days'
      order by coalesce(started_at, created_at) desc, id desc limit 1`.execute(this.db)).rows[0];
    return { salonLive: r.stage === 'live', stage: r.stage, routedAgentRef: last?.agent_ref ?? test?.agent_ref ?? null, routedAt: iso(last?.at_ ?? null),
      routedCallRef: last?.provider_call_id ? String(last.provider_call_id).slice(0, 12) + '…' : null, testAgentRef: test?.agent_ref ?? null, control: ctl };
  }

  private rowOut(a: Row, route: Route) {
    const ws = (a.wizard_state ?? {}) as Row;
    const eff = effectiveState({ status: a.status, providerAgentId: a.provider_agent_id ?? null, wizardComplete: ws.complete === true }, route);
    return { id: a.id, name: a.name, description: a.description ?? null, status: a.status, effective: eff, branchId: a.branch_id ?? null, branchName: a.branch_name ?? null,
      providerRef: refSuffix(a.provider_agent_id), providerLinked: !!a.provider_agent_id, bookingMode: a.booking_mode, configVersion: N(a.config_version),
      wizardStep: N(a.wizard_step), wizardComplete: ws.complete === true, createdBy: a.creator_name ?? null, createdAt: iso(a.created_at), updatedAt: iso(a.updated_at),
      activatedAt: iso(a.activated_at), pausedAt: iso(a.paused_at), lastVerifiedAt: iso(a.last_verified_at), archivedAt: iso(a.archived_at) };
  }

  private async zone(ctx: FdCtx) { return (await this.rc.window(ctx, { period: 'today' })).tz; }

  // ── directory (guide §3.2, §4, §4.3) ───────────────────────────────────────────────────────────────────────────────────
  async list(ctx: FdCtx, f: { status?: string; q?: string; branchId?: string; dateBasis?: string; period?: string; from?: string; to?: string; sort?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const status = (FD_FILTERS as readonly string[]).includes(String(f.status)) ? String(f.status) : 'all';
    const sort = (FD_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'newest';
    const basis = (FD_DATE_BASES as readonly string[]).includes(String(f.dateBasis)) ? String(f.dateBasis) : 'created';
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (f.branchId && f.branchId !== 'tenant' && !isUuid(f.branchId)) throw new FrontDeskError('Choose a valid branch.', 'AI_FD_INVALID_FILTER');
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    const route = await this.route(ctx);
    const live = sql`a.status = 'live' and a.provider_agent_id is not null and a.provider_agent_id = ${route.routedAgentRef ?? ''} and ${route.salonLive}::boolean`;
    const complete = sql`coalesce((a.wizard_state->>'complete')::boolean, false)`;
    const byStatus = status === 'all' ? sql`a.status <> 'archived'`
      : status === 'draft' ? sql`a.status = 'draft' and not ${complete}`
      : status === 'setup_required' ? sql`a.status = 'draft' and ${complete}`
      : status === 'active' ? live
      : status === 'degraded' ? sql`(a.status = 'error' or (a.status = 'live' and not (${live})))`
      : sql`a.status = ${status}`;
    const byBranch = !f.branchId ? sql`true` : f.branchId === 'tenant' ? sql`a.branch_id is null` : sql`a.branch_id = ${f.branchId}`;
    const byQ = !q ? sql`true` : sql`(a.name ilike ${like(q)} or coalesce(a.description, '') ilike ${like(q)} or a.id::text ilike ${like(q.toLowerCase())}
      or coalesce(a.provider_agent_id, '') ilike ${like(q)} or coalesce(br.name, '') ilike ${like(q)})`;
    let byDate = sql`true`; let window: { from: string; to: string; tz: string; basis: string } | null = null;
    if (f.period || f.from || f.to) {
      if ((f.from && !realDay(f.from)) || (f.to && !realDay(f.to))) throw new FrontDeskError('Choose valid dates.', 'AI_FD_INVALID_FILTER');
      if (f.from && f.to && f.to < f.from) throw new FrontDeskError('The To date is before the From date.', 'AI_FD_INVALID_FILTER');
      if (f.period && !(RC_PERIODS as readonly string[]).includes(f.period)) throw new FrontDeskError('Choose a valid period.', 'AI_FD_INVALID_FILTER');
      const w = await this.rc.window(ctx, { period: f.period, from: f.from, to: f.to });
      const col = basis === 'updated' ? sql`a.updated_at` : basis === 'activated' ? sql`a.activated_at` : sql`a.created_at`;
      byDate = sql`${col} >= (${w.from}::date::timestamp at time zone ${w.tz}) and ${col} < ((${w.to}::date + 1)::timestamp at time zone ${w.tz})`;
      window = { from: w.from, to: w.to, tz: w.tz, basis };
    }
    const order = sort === 'oldest' ? sql`a.created_at asc, a.id asc` : sort === 'name_az' ? sql`lower(a.name) asc, a.id asc`
      : sort === 'name_za' ? sql`lower(a.name) desc, a.id desc` : sort === 'updated' ? sql`a.updated_at desc, a.id desc` : sql`a.created_at desc, a.id desc`;
    const where = sql`${byStatus} and ${byBranch} and ${byQ} and ${byDate}`;
    const total = N((await sql<Row>`select count(*)::int n from ai_receptionist_agents a left join branches br on br.id = a.branch_id and br.tenant_id = a.tenant_id where a.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select a.id, a.name, a.description, a.status, a.branch_id, br.name branch_name, a.provider_agent_id, a.booking_mode, a.config_version, a.wizard_step,
      a.wizard_state, a.created_at, a.updated_at, a.activated_at, a.paused_at, a.last_verified_at, a.archived_at, u.full_name creator_name
      from ai_receptionist_agents a left join branches br on br.id = a.branch_id and br.tenant_id = a.tenant_id
      left join users u on u.id = a.created_by_user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and ${where} order by ${order} limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.rowOut(r, route)), pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) },
      filters: { status, q, branchId: f.branchId ?? null, sort, window }, route: this.routeOut(route) };
  }

  private routeOut(r: Route) {
    return { stage: r.stage, salonLive: r.salonLive, routedAgentRef: refSuffix(r.routedAgentRef), routedAt: r.routedAt, routedCallRef: r.routedCallRef,
      testCallAgentRef: refSuffix(r.testAgentRef), bookingArmed: !!r.control?.booking_armed, salonActivated: !!r.control?.activated };
  }

  /** summary strip — every number from the same predicates the filters use (guide §3.2) */
  async summary(ctx: FdCtx) {
    const T = ctx.tenantId; const route = await this.route(ctx);
    const live = sql`status = 'live' and provider_agent_id is not null and provider_agent_id = ${route.routedAgentRef ?? ''} and ${route.salonLive}::boolean`;
    const complete = sql`coalesce((wizard_state->>'complete')::boolean, false)`;
    const r: Row = (await sql<Row>`select count(*) filter (where status <> 'archived')::int total,
        count(*) filter (where status = 'draft' and not ${complete})::int draft, count(*) filter (where status = 'draft' and ${complete})::int setup_required,
        count(*) filter (where status = 'ready')::int ready, count(*) filter (where ${live})::int active,
        count(*) filter (where status = 'error' or (status = 'live' and not (${live})))::int degraded,
        count(*) filter (where status = 'paused')::int paused, count(*) filter (where status = 'archived')::int archived
      from ai_receptionist_agents where tenant_id = ${T}`.execute(this.db)).rows[0];
    return { counts: { total: N(r.total), draft: N(r.draft), setupRequired: N(r.setup_required), ready: N(r.ready), active: N(r.active), degraded: N(r.degraded), paused: N(r.paused), archived: N(r.archived) },
      route: this.routeOut(route), checkedAt: nowIso() };
  }

  private async agentRow(ctx: FdCtx, id: string, db: Kysely<any> = this.db, lock = false): Promise<Row> {
    if (!isUuid(id)) throw new FrontDeskError('Agent not found.', 'AI_FD_NOT_FOUND', 404);
    const a: Row | undefined = (await sql<Row>`select ${AG_A}, br.name branch_name, u.full_name creator_name from ai_receptionist_agents a
      left join branches br on br.id = a.branch_id and br.tenant_id = a.tenant_id left join users u on u.id = a.created_by_user_id and u.tenant_id = a.tenant_id
      where a.tenant_id = ${ctx.tenantId} and a.id = ${id} ${lock ? sql`for update of a` : sql``}`.execute(db)).rows[0];
    if (!a) throw new FrontDeskError('Agent not found.', 'AI_FD_NOT_FOUND', 404);
    return a;
  }

  // ── agent profile overlay (guide §6) ───────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: FdCtx, id: string) {
    const T = ctx.tenantId;
    const a = await this.agentRow(ctx, id);
    const r = await this.rc.readiness(ctx);
    const route = await this.route(ctx, r);
    const st = (cid: string) => r.checks.find((c) => c.id === cid);
    const biz = this.business ? await this.business.readiness(ctx).catch((e: unknown) => ({ core: [{ key: 'error', status: 'UNKNOWN', detail: `Business setup could not be read (${(e as { code?: string })?.code ?? 'QUERY_FAILED'}).` }] })) : null;
    const tz = await this.zone(ctx);
    const usage: Row = a.provider_agent_id ? (await sql<Row>`select count(*)::int calls, coalesce(sum(duration_seconds), 0)::int seconds,
        count(*) filter (where error_category is not null)::int failed
      from voice_call_outcomes where tenant_id = ${T} and agent_ref = ${a.provider_agent_id}
        and coalesce(started_at, created_at) >= (date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`.execute(this.db)).rows[0] : { calls: 0, seconds: 0, failed: 0 };
    const lastBooking: Row | undefined = a.provider_agent_id ? (await sql<Row>`select x.finished_at from voice_tool_executions x join voice_call_outcomes o
        on o.tenant_id = x.tenant_id and o.provider_call_id = x.provider_call_id
      where x.tenant_id = ${T} and o.agent_ref = ${a.provider_agent_id} and x.tool_kind = 'write' and x.status = 'succeeded' and x.related_type = 'appointment'
      order by x.finished_at desc nulls last limit 1`.execute(this.db)).rows[0] : undefined;
    const versions = N((await sql<Row>`select count(*)::int n from ai_receptionist_agent_versions where tenant_id = ${T} and agent_id = ${a.id}`.execute(this.db)).rows[0]?.n);
    const lastHealth: Row | undefined = (await sql<Row>`select overall, checks, created_at from ai_receptionist_health_runs where tenant_id = ${T} and scope = 'agent' and agent_id = ${a.id}
      order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    const recentErrors: Row[] = a.provider_agent_id ? (await sql<Row>`select provider_call_id, error_category, coalesce(started_at, created_at) at_ from voice_call_outcomes
      where tenant_id = ${T} and agent_ref = ${a.provider_agent_id} and error_category is not null order by coalesce(started_at, created_at) desc, id desc limit 5`.execute(this.db)).rows : [];
    const shared = a.provider_agent_id ? N((await sql<Row>`select count(*)::int n from ai_receptionist_agents where provider_agent_id = ${a.provider_agent_id} and tenant_id <> ${T}`.execute(this.db)).rows[0]?.n) : 0;
    const liveOnRoute: Row | undefined = (await sql<Row>`select id, name from ai_receptionist_agents where tenant_id = ${T} and status = 'live'
      and coalesce(branch_id, ${ZERO}::uuid) = coalesce(${a.branch_id ?? null}::uuid, ${ZERO}::uuid) limit 1`.execute(this.db)).rows[0];
    const lastActivation: Row | undefined = (await sql<Row>`select prior_agent_id, created_at, actor_user_id from ai_receptionist_agent_events where tenant_id = ${T} and agent_id = ${a.id}
      and action in ('activated', 'rolled_back') order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    const ent = st('ent.package');
    return {
      overview: { ...this.rowOut(a, route), creatorName: a.creator_name ?? null },
      business: { versions, knowledgeVersion: N(a.knowledge_version), core: biz?.core ?? null },
      voice: { callType: a.call_type, language: a.language, greeting: a.greeting, behavior: a.behavior, useCase: a.use_case, afterHoursMessage: a.after_hours_message ?? null,
        providerRef: refSuffix(a.provider_agent_id), provider: a.provider ?? null, sharedWithOtherSalon: shared > 0 },
      routing: { current: liveOnRoute ? { agentId: liveOnRoute.id, name: liveOnRoute.name } : null, thisAgentIsLive: liveOnRoute?.id === a.id, ...this.routeOut(route),
        twilioAccount: st('tw.account')?.state ?? 'UNKNOWN', twilioRoute: st('tw.route')?.state ?? 'UNKNOWN', lastVerifiedAt: iso(a.last_verified_at),
        rollbackTo: lastActivation?.prior_agent_id ?? null, lastActivatedAt: iso(lastActivation?.created_at ?? null),
        externalNote: 'Changing which agent the phone number reaches inside Twilio / Retell is done in the provider console (BLOCKED_EXTERNAL here); this page records the owner-approved change and verifies it from recorded calls.' },
      booking: { mode: a.booking_mode, salonArmed: !!route.control?.booking_armed, lastBookingSuccessAt: iso(lastBooking?.finished_at ?? null),
        handoffDestination: a.handoff_destination ? (String(a.handoff_destination).startsWith('+') ? '•••• ' + String(a.handoff_destination).slice(-4) : a.handoff_destination) : null,
        verificationRule: 'A booking that still needs the six-digit code is a pending booking session, never a confirmed appointment.' },
      usage: { entitlement: ent?.state ?? 'UNKNOWN', entitlementDetail: ent?.detail ?? null, callsThisMonth: N(usage.calls), voiceMinutesThisMonth: Math.round(N(usage.seconds) / 6) / 10,
        failedThisMonth: N(usage.failed), charges: 'UNKNOWN', chargesNote: 'No verified provider charge record exists here; costs are not inferred from usage.', quotaWarnings: 'NOT_AVAILABLE' },
      health: { last: lastHealth ? { overall: lastHealth.overall, checkedAt: iso(lastHealth.created_at), checks: lastHealth.checks } : null,
        recentErrors: recentErrors.map((e) => ({ callRef: String(e.provider_call_id).slice(0, 12) + '…', error: e.error_category, at: iso(e.at_) })) },
    };
  }

  /** the agent's calls (paged, newest first) — summaries/transcripts stay in AI Calls behind its role + audit (guide §6.2) */
  async calls(ctx: FdCtx, id: string, f: { q?: string; period?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const a = await this.agentRow(ctx, id);
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if (!a.provider_agent_id) return { items: [], pagination: { page, pageSize: size, totalItems: 0, totalPages: 1 }, note: 'This agent is not linked to a voice provider agent, so it has answered no calls.' };
    const q = String(f.q ?? '').trim().slice(0, 100);
    let byDate = sql`true`;
    if (f.period || f.from || f.to) {
      const w = await this.rc.window(ctx, { period: f.period, from: f.from, to: f.to });
      byDate = sql`coalesce(started_at, created_at) >= (${w.from}::date::timestamp at time zone ${w.tz}) and coalesce(started_at, created_at) < ((${w.to}::date + 1)::timestamp at time zone ${w.tz})`;
    }
    const byQ = q ? sql`(provider_call_id ilike ${like(q)} or coalesce(booking_outcome, '') ilike ${like(q)} or coalesce(handoff_outcome, '') ilike ${like(q)} or coalesce(error_category, '') ilike ${like(q)})` : sql`true`;
    const where = sql`agent_ref = ${a.provider_agent_id} and ${byQ} and ${byDate}`;
    const total = N((await sql<Row>`select count(*)::int n from voice_call_outcomes where tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select provider_call_id, coalesce(started_at, created_at) at_, duration_seconds, booking_outcome, handoff_outcome, error_category, abandoned
      from voice_call_outcomes where tenant_id = ${T} and ${where} order by coalesce(started_at, created_at) desc, id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((c) => ({ callRef: String(c.provider_call_id).slice(0, 12) + '…', providerCallId: c.provider_call_id, at: iso(c.at_),
      durationSeconds: c.duration_seconds == null ? null : N(c.duration_seconds), booking: c.booking_outcome ?? null, handoff: c.handoff_outcome ?? null,
      error: c.error_category ?? null, abandoned: !!c.abandoned })),
      pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) } };
  }

  /** activity history: agent changes, activations, pauses, rollbacks, checks — newest first (guide §3.2, §4.3) */
  async events(ctx: FdCtx, f: { agentId?: string; action?: string; period?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if (f.agentId && !isUuid(f.agentId)) throw new FrontDeskError('Choose a valid agent.', 'AI_FD_INVALID_FILTER');
    const byAction = (FD_EVENT_ACTIONS as readonly string[]).includes(String(f.action)) ? sql`e.action = ${f.action}` : sql`true`;
    let byDate = sql`true`;
    if (f.period || f.from || f.to) {
      const w = await this.rc.window(ctx, { period: f.period, from: f.from, to: f.to });
      byDate = sql`e.created_at >= (${w.from}::date::timestamp at time zone ${w.tz}) and e.created_at < ((${w.to}::date + 1)::timestamp at time zone ${w.tz})`;
    }
    const where = sql`${f.agentId ? sql`e.agent_id = ${f.agentId}` : sql`true`} and ${byAction} and ${byDate}`;
    const total = N((await sql<Row>`select count(*)::int n from ai_receptionist_agent_events e where e.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select e.id, e.agent_id, a.name agent_name, e.action, e.reason, e.config_version, e.prior_agent_id, e.operation_id, e.created_at, u.full_name actor_name
      from ai_receptionist_agent_events e left join ai_receptionist_agents a on a.id = e.agent_id and a.tenant_id = e.tenant_id
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id
      where e.tenant_id = ${T} and ${where} order by e.created_at desc, e.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((e) => ({ id: e.id, agentId: e.agent_id, agentName: e.agent_name ?? null, action: e.action, reason: e.reason ?? null, configVersion: e.config_version == null ? null : N(e.config_version),
      priorAgentId: e.prior_agent_id ?? null, operationId: e.operation_id ?? null, actor: e.actor_name ?? null, at: iso(e.created_at) })),
      pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) } };
  }

  private async event(trx: Kysely<any>, ctx: FdCtx, a: Row, action: typeof FD_EVENT_ACTIONS[number], before: unknown, after: unknown,
    extra: { reason?: string | null; key?: string | null; prior?: string | null; op?: string | null } = {}) {
    await sql`insert into ai_receptionist_agent_events (tenant_id, branch_id, agent_id, action, before_state, after_state, reason, config_version, prior_agent_id, operation_id, actor_user_id, idempotency_key)
      values (${ctx.tenantId}, ${a.branch_id ?? null}, ${a.id}, ${action}, ${JSON.stringify(before ?? {})}::jsonb, ${JSON.stringify(after ?? {})}::jsonb, ${extra.reason ?? null},
        ${N(a.config_version) || null}, ${extra.prior ?? null}, ${extra.op ?? null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${extra.key ?? null})`.execute(trx);
    await recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: a.branch_id ?? null, userId: ctx.userId, role: ctx.role ?? null },
      { module: 'ai_front_desk', action: `agent.${action}`, resourceType: 'ai_receptionist_agent', resourceId: String(a.id), summary: `AI Front Desk agent "${a.name}": ${action.replace(/_/g, ' ')}`,
        reason: extra.reason ?? undefined, metadata: { before, after, priorAgentId: extra.prior ?? null, operationId: extra.op ?? null } });
  }
  private async replay(trx: Kysely<any>, ctx: FdCtx, key: string): Promise<Row | null> {
    return (await sql<Row>`select agent_id from ai_receptionist_agent_events where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0] ?? null;
  }
  private snap(a: Row) { return { status: a.status, configVersion: N(a.config_version), wizardStep: N(a.wizard_step), bookingMode: a.booking_mode, providerLinked: !!a.provider_agent_id, branchId: a.branch_id ?? null }; }
  private async branchOk(ctx: FdCtx, branchId: string | null, trx: Kysely<any> = this.db) {
    if (branchId == null) return;
    if (!isUuid(branchId)) throw new FrontDeskError('Choose a valid branch.', 'AI_FD_INVALID_INPUT');
    const ok = (await sql<Row>`select 1 from branches where tenant_id = ${ctx.tenantId} and id = ${branchId}`.execute(trx)).rows[0];
    if (!ok) throw new FrontDeskError('That branch is not part of this salon.', 'AI_FD_INVALID_INPUT', 404);
  }

  // ── Create Agent wizard (guide §5): a draft is a database row; nothing external is called ──────────────────────────────
  async create(ctx: FdCtx, input: { name: string; description?: string | null; branchId?: string | null; idempotencyKey: string }) {
    const cfg = this.cfg({ name: input.name, branchId: input.branchId ?? null }, null);
    await this.branchOk(ctx, cfg.branchId);
    const desc = String(input.description ?? '').trim().slice(0, 500) || null;
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const a: Row = (await sql<Row>`insert into ai_receptionist_agents (tenant_id, branch_id, name, description, status, call_type, language, greeting, behavior, knowledge_version,
          config_version, wizard_step, wizard_state, created_by_user_id, updated_by_user_id)
        values (${ctx.tenantId}, ${cfg.branchId}, ${cfg.name}, ${desc}, 'draft', 'inbound', 'en', ${DEFAULT_GREETING}, ${DEFAULT_BEHAVIOR}, 1, 1, 2,
          ${JSON.stringify({ steps: { 1: true }, complete: false })}::jsonb, ${ctx.userId}, ${ctx.userId}) returning ${AG}`.execute(trx)).rows[0];
      await sql`insert into ai_receptionist_agent_versions (tenant_id, agent_id, version, configuration, created_by_user_id)
        values (${ctx.tenantId}, ${a.id}, 1, ${JSON.stringify(this.config(a))}::jsonb, ${ctx.userId}) on conflict (tenant_id, agent_id, version) do nothing`.execute(trx);
      await this.event(trx, ctx, a, 'created', {}, this.snap(a), { key: input.idempotencyKey });
      return { agent: this.rowOut(a, await this.route(ctx)), replayed: false };
    });
  }
  private cfg(input: { name?: string; branchId?: string | null; greeting?: string; behavior?: string; useCase?: string; callType?: string }, cur: Row | null) {
    try {
      return normalizeAgentConfig(input, cur ? { name: cur.name, branchId: cur.branch_id ?? null, callType: cur.call_type, language: cur.language, useCase: cur.use_case ?? null, greeting: cur.greeting ?? null, behavior: cur.behavior ?? null } : undefined);
    } catch (e) { throw new FrontDeskError((e as Error).message, (e as { code?: string }).code ?? 'AI_FD_INVALID_INPUT'); }
  }
  private config(a: Row) {
    return { name: a.name, description: a.description ?? null, branchId: a.branch_id ?? null, callType: a.call_type, language: a.language, greeting: a.greeting, behavior: a.behavior,
      useCase: a.use_case ?? null, bookingMode: a.booking_mode, handoffDestination: a.handoff_destination ?? null, afterHoursMessage: a.after_hours_message ?? null };
  }

  /** Save Draft: version-checked; persists the step + its inputs; a live agent is locked (pause or duplicate to change it) */
  async save(ctx: FdCtx, id: string, input: { expectedVersion: number; step: number; markDone?: boolean; name?: string; description?: string | null; branchId?: string | null;
    greeting?: string; behavior?: string; useCase?: string; callType?: string; bookingMode?: string; handoffDestination?: string | null; afterHoursMessage?: string | null }) {
    const step = Math.trunc(Number(input.step));
    if (!(step >= 1 && step <= FD_WIZARD_STEPS)) throw new FrontDeskError('Unknown wizard step.', 'AI_FD_INVALID_INPUT');
    if (input.bookingMode != null && !(FD_BOOKING_MODES as readonly string[]).includes(input.bookingMode)) throw new FrontDeskError('Choose handoff-only or eligible booking.', 'AI_FD_INVALID_INPUT');
    const hd = input.handoffDestination === undefined ? undefined : (String(input.handoffDestination ?? '').trim() || null);
    if (hd != null && !HANDOFF.test(hd)) throw new FrontDeskError('The handoff destination must be a phone number in +1… format, "voicemail" or "front_desk".', 'AI_FD_INVALID_INPUT');
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.agentRow(ctx, id, trx, true);
      if (cur.status === 'archived') throw new FrontDeskError('Archived agents cannot be edited. Restore it first.', 'AI_FD_ARCHIVED', 409);
      if (cur.status === 'live') throw new FrontDeskError('A live agent cannot be edited in place. Pause it, or duplicate it and change the copy.', 'AI_FD_LIVE_LOCKED', 409);
      if (N(cur.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('Someone else saved this agent. Reload to see their changes before saving yours.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(cur.config_version) });
      const cfg = this.cfg({ name: input.name, branchId: input.branchId, greeting: input.greeting, behavior: input.behavior, useCase: input.useCase, callType: input.callType }, cur);
      if (input.branchId !== undefined) await this.branchOk(ctx, cfg.branchId, trx);
      const ws = { steps: { ...((cur.wizard_state ?? {}).steps ?? {}) } as Record<string, boolean>, complete: false };
      if (input.markDone !== false && (FD_INPUT_STEPS as readonly number[]).includes(step)) ws.steps[String(step)] = true;
      ws.complete = FD_INPUT_STEPS.every((s) => ws.steps[String(s)] === true);
      const nextStep = Math.min(FD_WIZARD_STEPS, Math.max(N(cur.wizard_step), step + (input.markDone === false ? 0 : 1)));
      const desc = input.description === undefined ? cur.description : (String(input.description ?? '').trim().slice(0, 500) || null);
      const after = String(input.afterHoursMessage ?? '').trim().slice(0, 500);
      const up: Row = (await sql<Row>`update ai_receptionist_agents set name = ${cfg.name}, branch_id = ${cfg.branchId}, call_type = ${cfg.callType}, language = ${cfg.language}, use_case = ${cfg.useCase},
          greeting = ${cfg.greeting}, behavior = ${cfg.behavior}, description = ${desc}, booking_mode = ${input.bookingMode ?? cur.booking_mode},
          handoff_destination = ${hd === undefined ? cur.handoff_destination ?? null : hd}, after_hours_message = ${input.afterHoursMessage === undefined ? cur.after_hours_message ?? null : (after || null)},
          wizard_step = ${nextStep}, wizard_state = ${JSON.stringify(ws)}::jsonb, config_version = config_version + 1, knowledge_version = knowledge_version + 1,
          updated_by_user_id = ${ctx.userId}, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${id} returning ${AG}`.execute(trx)).rows[0];
      await sql`insert into ai_receptionist_agent_versions (tenant_id, agent_id, version, configuration, created_by_user_id)
        values (${ctx.tenantId}, ${id}, ${N(up.knowledge_version)}, ${JSON.stringify(this.config(up))}::jsonb, ${ctx.userId}) on conflict (tenant_id, agent_id, version) do nothing`.execute(trx);
      await this.event(trx, ctx, up, 'saved', this.snap(cur), this.snap(up), { reason: `Wizard step ${step}` });
      return { agent: this.rowOut({ ...up, branch_name: cur.branch_name, creator_name: cur.creator_name }, await this.route(ctx)), config: this.config(up) };
    });
  }

  /** the wizard's view of an agent: saved inputs + the evidence steps (5–8) read live from checks */
  async wizard(ctx: FdCtx, id: string) {
    const a = await this.agentRow(ctx, id);
    const r = await this.rc.readiness(ctx);
    const st = (cid: string) => r.checks.find((c) => c.id === cid);
    const pre = await this.preflight(ctx, a, r);
    const biz = this.business ? await this.business.readiness(ctx).catch((e: unknown) => ({ core: [{ key: 'error', status: 'UNKNOWN', detail: `Business setup could not be read (${(e as { code?: string })?.code ?? 'QUERY_FAILED'}).` }] })) : null;
    const ws = (a.wizard_state ?? {}) as Row;
    const done = (s: number) => ws.steps?.[String(s)] === true;
    const ev = (c: RcCheck | undefined) => c ? { state: c.state, detail: c.detail, remedy: c.remedy } : { state: 'UNKNOWN' as RcState, detail: 'Not checked.', remedy: null };
    return {
      agent: this.rowOut(a, await this.route(ctx, r)), config: this.config(a),
      steps: [
        { step: 1, key: 'identity', done: done(1) },
        { step: 2, key: 'knowledge', done: done(2), business: biz?.core ?? null },
        { step: 3, key: 'conversation', done: done(3) },
        { step: 4, key: 'booking', done: done(4), salonArmed: !!r.control?.bookingArmed },
        { step: 5, key: 'retell', done: !!a.provider_agent_id && st('rt.agent')?.state === 'READY', evidence: [ev(st('rt.key')), ev(st('rt.agent'))], providerRef: refSuffix(a.provider_agent_id) },
        { step: 6, key: 'twilio', done: st('tw.route')?.state === 'READY', evidence: [ev(st('tw.account')), ev(st('tw.route'))] },
        { step: 7, key: 'review', done: st('rd.test_call')?.state === 'READY', evidence: [ev(st('biz.setup')), ev(st('rd.test_call'))] },
        { step: 8, key: 'activate', done: a.status === 'live', preflight: pre },
      ],
    };
  }

  /** Duplicate: new id, provider binding + routing cleared, back to draft (guide §5.1) */
  async duplicate(ctx: FdCtx, id: string, input: { idempotencyKey: string }) {
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const src = await this.agentRow(ctx, id, trx);
      const steps = Object.fromEntries(Object.entries(((src.wizard_state ?? {}).steps ?? {}) as Record<string, boolean>).filter(([k]) => Number(k) <= 4));
      const ws = { steps, complete: FD_INPUT_STEPS.every((s) => steps[String(s)] === true) };
      const name = (String(src.name) + ' (copy)').slice(0, 80);
      const a: Row = (await sql<Row>`insert into ai_receptionist_agents (tenant_id, branch_id, name, description, status, call_type, language, use_case, greeting, behavior, knowledge_version,
          config_version, wizard_step, wizard_state, booking_mode, handoff_destination, after_hours_message, created_by_user_id, updated_by_user_id)
        values (${ctx.tenantId}, ${src.branch_id ?? null}, ${name}, ${src.description ?? null}, 'draft', ${src.call_type}, 'en', ${src.use_case ?? null}, ${src.greeting ?? null}, ${src.behavior ?? null}, 1,
          1, ${Math.min(5, Math.max(1, N(src.wizard_step)))}, ${JSON.stringify(ws)}::jsonb, ${src.booking_mode}, ${src.handoff_destination ?? null}, ${src.after_hours_message ?? null}, ${ctx.userId}, ${ctx.userId})
        returning ${AG}`.execute(trx)).rows[0];
      await sql`insert into ai_receptionist_agent_versions (tenant_id, agent_id, version, configuration, created_by_user_id)
        values (${ctx.tenantId}, ${a.id}, 1, ${JSON.stringify(this.config(a))}::jsonb, ${ctx.userId}) on conflict (tenant_id, agent_id, version) do nothing`.execute(trx);
      await this.event(trx, ctx, a, 'duplicated', { sourceAgentId: src.id }, this.snap(a), { key: input.idempotencyKey, reason: `Copied from "${src.name}" (provider link and routing not copied)` });
      return { agent: this.rowOut(a, await this.route(ctx)), replayed: false };
    });
  }

  // ── activation preflight + owner-approved activation (guide §10.1) ────────────────────────────────────────────────────
  private async preflight(ctx: FdCtx, a: Row, readiness?: Awaited<ReturnType<ReceptionistCenter['readiness']>>) {
    const r = readiness ?? await this.rc.readiness(ctx);
    const route = await this.route(ctx, r);
    const blockers: { id: string; label: string; detail: string; remedy: string | null }[] = [];
    const add = (id: string, label: string, detail: string, remedy: string | null = null) => blockers.push({ id, label, detail, remedy });
    if (!['ready', 'paused', 'live'].includes(String(a.status))) add('agent.status', 'Agent status', a.status === 'draft' ? 'This agent is still a draft: it has no voice provider agent yet.' : `An agent that is ${a.status} cannot be activated.`, 'Finish the wizard and link the voice provider agent.');
    if (!a.provider_agent_id) add('agent.provider', 'Voice provider agent', 'No voice provider agent is linked to this agent.', 'Link or provision the Retell agent (step 5).');
    if (a.provider_agent_id) {
      const shared = N((await sql<Row>`select count(*)::int n from ai_receptionist_agents where provider_agent_id = ${a.provider_agent_id} and tenant_id <> ${ctx.tenantId}`.execute(this.db)).rows[0]?.n);
      if (shared > 0) add('agent.shared', 'Voice provider agent', 'This provider agent is also linked to another salon. Calls could reach the wrong business.', 'Contact support to provision a dedicated agent.');
    }
    if (!a.handoff_destination) add('agent.handoff', 'Human handoff', 'No human handoff destination is set.', 'Set where the AI hands calls to a person (step 3).');
    for (const gid of FD_ACTIVATION_GATES) {
      const c = r.checks.find((x) => x.id === gid);
      if (!c || c.state !== 'READY') add(gid, c?.label ?? gid, c?.detail ?? 'Not checked.', c?.remedy ?? null);
    }
    if (a.provider_agent_id && route.testAgentRef && route.testAgentRef !== a.provider_agent_id) add('route.test_agent', 'Route proof', 'The verified test call was answered by a different provider agent, so this phone route is not proven to reach this agent.', 'Place an authorized test call that this agent answers, then verify it in AI Receptionist.');
    if (a.booking_mode === 'eligible' && !route.control?.booking_armed) add('booking.armed', 'Booking actions', 'This agent is set to book, but booking actions are not armed for the salon.', 'Arm booking actions in AI Receptionist, or set the agent to handoff-only.');
    const liveOnRoute: Row | undefined = (await sql<Row>`select id, name, provider_agent_id from ai_receptionist_agents where tenant_id = ${ctx.tenantId} and status = 'live'
      and coalesce(branch_id, ${ZERO}::uuid) = coalesce(${a.branch_id ?? null}::uuid, ${ZERO}::uuid) limit 1`.execute(this.db)).rows[0];
    return {
      ready: blockers.length === 0, blockers,
      current: liveOnRoute ? { agentId: liveOnRoute.id, name: liveOnRoute.name, providerRef: refSuffix(liveOnRoute.provider_agent_id) } : null,
      proposed: { agentId: a.id, name: a.name, providerRef: refSuffix(a.provider_agent_id) },
      scope: { branchId: a.branch_id ?? null, branchName: a.branch_name ?? null },
      bookingMode: a.booking_mode, handoff: !!a.handoff_destination,
      billing: 'Activation itself creates no charge. Calls the agent answers use voice minutes under the salon’s AI plan; the provider’s own charges are not shown here (no verified charge record).',
      customerBehavior: a.booking_mode === 'eligible' ? 'Callers to this route reach this agent, which can book after the six-digit check and hands off to a person when needed.'
        : 'Callers to this route reach this agent, which answers questions and hands every booking request to a person.',
      rollback: liveOnRoute && liveOnRoute.id !== a.id ? { agentId: liveOnRoute.id, name: liveOnRoute.name } : { agentId: null, name: 'AI off — calls go to the human line' },
      route: this.routeOut(route),
      external: 'Pointing the Twilio number at this Retell agent is done in the provider console and verified here from the next recorded call.',
    };
  }
  async activationPreview(ctx: FdCtx, id: string) { return this.preflight(ctx, await this.agentRow(ctx, id)); }

  async activate(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string; confirm?: boolean }, mode: 'activated' | 'resumed' | 'rolled_back' = 'activated') {
    this.owner(ctx);
    if (input.confirm !== true) throw new FrontDeskError('Confirm the change to live call routing.', 'AI_FD_CONFIRM_REQUIRED');
    const reason = this.reason(input.reason);
    const a0 = await this.agentRow(ctx, id);
    const pre = await this.preflight(ctx, a0);
    if (!pre.ready) throw new FrontDeskError('This agent cannot go live yet.', 'AI_FD_ACTIVATION_BLOCKED', 409, { blockers: pre.blockers.map((b) => b.id) });
    const op = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      // per-route lock: two owners activating two agents on one route serialize here; the partial unique index backs it up
      await sql`select pg_advisory_xact_lock(hashtextextended(${'ai_fd_route:' + ctx.tenantId + ':' + String(a0.branch_id ?? 'tenant')}, 0))`.execute(trx);
      const a = await this.agentRow(ctx, id, trx, true);
      if (N(a.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('This agent changed since you reviewed it. Review the preflight again.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(a.config_version) });
      if (a.status === 'live') throw new FrontDeskError('This agent is already live.', 'AI_FD_ALREADY_LIVE', 409);
      const cur: Row | undefined = (await sql<Row>`select ${AG} from ai_receptionist_agents where tenant_id = ${ctx.tenantId} and status = 'live' and id <> ${a.id}
        and coalesce(branch_id, ${ZERO}::uuid) = coalesce(${a.branch_id ?? null}::uuid, ${ZERO}::uuid) for update`.execute(trx)).rows[0];
      if (cur) {
        const d: Row = (await sql<Row>`update ai_receptionist_agents set status = 'ready', updated_at = now(), updated_by_user_id = ${ctx.userId}
          where tenant_id = ${ctx.tenantId} and id = ${cur.id} and ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'ready')} returning ${AG}`.execute(trx)).rows[0];
        await this.event(trx, ctx, d, 'demoted', this.snap(cur), this.snap(d), { reason: `Replaced on this route by "${a.name}"`, op });
      }
      const up: Row | undefined = (await sql<Row>`update ai_receptionist_agents set status = 'live', activated_at = now(), activated_by = ${ctx.userId}, last_verified_at = now(), paused_at = null,
          updated_at = now(), updated_by_user_id = ${ctx.userId}
        where tenant_id = ${ctx.tenantId} and id = ${a.id} and ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'live')} returning ${AG}`.execute(trx)).rows[0];
      if (!up) throw new FrontDeskError(`An agent that is ${a.status} cannot be activated.`, 'AI_FD_STATE_INVALID', 409);
      await this.salonActivation(trx, ctx, a.branch_id ?? null, true, `${mode.replace('_', ' ')}: agent "${a.name}" — ${reason}`, `${input.idempotencyKey}:salon`);
      await this.event(trx, ctx, { ...up, branch_name: a.branch_name }, mode, this.snap(a), this.snap(up), { reason, key: input.idempotencyKey, prior: cur?.id ?? null, op });
      return { agent: this.rowOut({ ...up, branch_name: a.branch_name, creator_name: a.creator_name }, await this.route(ctx)), operationId: op, priorAgentId: cur?.id ?? null, replayed: false };
    });
  }

  /** the salon control row (guide 21): activation turns it on; a pause turns it off AND disarms booking — one transaction */
  private async salonActivation(trx: Kysely<any>, ctx: FdCtx, branchId: string | null, on: boolean, reason: string, key: string) {
    const T = ctx.tenantId;
    await sql`insert into ai_receptionist_control (tenant_id, branch_id, updated_by) values (${T}, ${branchId}, ${ctx.userId})
      on conflict (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing`.execute(trx);
    const c: Row = (await sql<Row>`select id, booking_armed, activated, version from ai_receptionist_control where tenant_id = ${T} and branch_id is not distinct from ${branchId} for update`.execute(trx)).rows[0];
    const before = { activated: !!c.activated, bookingArmed: !!c.booking_armed, version: N(c.version) };
    if (on && c.activated) return;
    if (!on && !c.activated && !c.booking_armed) return;
    const up: Row = (await sql<Row>`update ai_receptionist_control set ${on ? sql`activated = true, activated_at = now(), activated_by = ${ctx.userId}`
        : sql`activated = false, activated_at = null, activated_by = null, booking_armed = false, booking_armed_at = null, booking_armed_by = null`},
        version = version + 1, updated_at = now(), updated_by = ${ctx.userId} where id = ${c.id} returning booking_armed, activated, version`.execute(trx)).rows[0];
    const after = { activated: !!up.activated, bookingArmed: !!up.booking_armed, version: N(up.version) };
    const actions = on ? ['activate'] : [...(c.activated ? ['deactivate'] : []), ...(c.booking_armed ? ['disarm_booking'] : [])];
    for (const act of actions) {
      await sql`insert into ai_receptionist_control_events (tenant_id, branch_id, action, before_state, after_state, reason, actor_user_id, idempotency_key)
        values (${T}, ${branchId}, ${act}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${reason}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${key + ':' + act})`.execute(trx);
    }
    await recordAuditStrict(trx, { tenantId: T, branchId, userId: ctx.userId, role: ctx.role ?? null },
      { module: 'ai_receptionist', action: `control.${actions.join('+')}`, resourceType: 'ai_receptionist_control', resourceId: String(c.id), summary: `AI Receptionist: ${actions.join(' + ').replace(/_/g, ' ')} (from AI Front Desk)`, reason, metadata: { before, after } });
  }

  /** Pause: stops the AI on this route at once (salon deactivated + booking disarmed); history kept (guide §7, ACT-05) */
  async pause(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string }) {
    const reason = this.reason(input.reason);
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const a = await this.agentRow(ctx, id, trx, true);
      if (N(a.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('This agent changed. Reload and try again.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(a.config_version) });
      if (a.status === 'paused') throw new FrontDeskError('This agent is already paused.', 'AI_FD_STATE_INVALID', 409);
      const up: Row | undefined = (await sql<Row>`update ai_receptionist_agents set status = 'paused', paused_at = now(), updated_at = now(), updated_by_user_id = ${ctx.userId}
        where tenant_id = ${ctx.tenantId} and id = ${a.id} and ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'paused')} returning ${AG}`.execute(trx)).rows[0];
      if (!up) throw new FrontDeskError(`An agent that is ${a.status} cannot be paused.`, 'AI_FD_STATE_INVALID', 409);
      if (a.status === 'live') await this.salonActivation(trx, ctx, a.branch_id ?? null, false, `Paused live agent "${a.name}": ${reason}`, `${input.idempotencyKey}:salon`);
      await this.event(trx, ctx, up, 'paused', this.snap(a), this.snap(up), { reason, key: input.idempotencyKey });
      return { agent: this.rowOut({ ...up, branch_name: a.branch_name, creator_name: a.creator_name }, await this.route(ctx)), salonStopped: a.status === 'live', replayed: false };
    });
  }

  /** Resume: a previously-live agent goes back through the full owner activation; one that never went live returns to draft/ready */
  async resume(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string; confirm?: boolean }) {
    const a = await this.agentRow(ctx, id);
    if (a.status !== 'paused') throw new FrontDeskError('Only a paused agent can be resumed.', 'AI_FD_STATE_INVALID', 409);
    if (a.activated_at) return this.activate(ctx, id, input, 'resumed');
    const reason = this.reason(input.reason);
    const to = a.provider_agent_id ? 'ready' : 'draft';
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const cur = await this.agentRow(ctx, id, trx, true);
      if (N(cur.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('This agent changed. Reload and try again.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(cur.config_version) });
      const up: Row | undefined = (await sql<Row>`update ai_receptionist_agents set status = ${to}, paused_at = null, updated_at = now(), updated_by_user_id = ${ctx.userId}
        where tenant_id = ${ctx.tenantId} and id = ${id} and ${to === 'ready' ? canMoveToSql(AI_RECEPTIONIST_AGENT, 'ready') : canMoveToSql(AI_RECEPTIONIST_AGENT, 'draft')} returning ${AG}`.execute(trx)).rows[0];
      if (!up) throw new FrontDeskError('This agent cannot be resumed.', 'AI_FD_STATE_INVALID', 409);
      await this.event(trx, ctx, up, 'resumed', this.snap(cur), this.snap(up), { reason, key: input.idempotencyKey });
      return { agent: this.rowOut({ ...up, branch_name: cur.branch_name, creator_name: cur.creator_name }, await this.route(ctx)), replayed: false };
    });
  }

  /** Archive (explicit confirmation; a live agent must be paused first) / Restore (back to draft) — history always kept */
  async archive(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string; confirm?: boolean }) {
    if (input.confirm !== true) throw new FrontDeskError('Confirm that you want to archive this agent.', 'AI_FD_CONFIRM_REQUIRED');
    const reason = this.reason(input.reason);
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const a = await this.agentRow(ctx, id, trx, true);
      if (N(a.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('This agent changed. Reload and try again.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(a.config_version) });
      if (a.status === 'live') throw new FrontDeskError('Pause this live agent first, so the phone route stops reaching it, then archive it.', 'AI_FD_PAUSE_FIRST', 409);
      const up: Row | undefined = (await sql<Row>`update ai_receptionist_agents set status = 'archived', archived_at = now(), updated_at = now(), updated_by_user_id = ${ctx.userId}
        where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'archived')} returning ${AG}`.execute(trx)).rows[0];
      if (!up) throw new FrontDeskError('This agent is already archived.', 'AI_FD_STATE_INVALID', 409);
      await this.event(trx, ctx, up, 'archived', this.snap(a), this.snap(up), { reason, key: input.idempotencyKey });
      return { agent: this.rowOut({ ...up, branch_name: a.branch_name, creator_name: a.creator_name }, await this.route(ctx)), replayed: false };
    });
  }
  async restore(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string }) {
    const reason = this.reason(input.reason);
    return this.db.transaction().execute(async (trx) => {
      const prior = await this.replay(trx, ctx, input.idempotencyKey);
      if (prior) return { agent: this.rowOut(await this.agentRow(ctx, prior.agent_id, trx), await this.route(ctx)), replayed: true };
      const a = await this.agentRow(ctx, id, trx, true);
      if (N(a.config_version) !== Number(input.expectedVersion)) throw new FrontDeskError('This agent changed. Reload and try again.', 'AI_FD_VERSION_CONFLICT', 409, { currentVersion: N(a.config_version) });
      if (a.status !== 'archived') throw new FrontDeskError('Only an archived agent can be restored.', 'AI_FD_STATE_INVALID', 409);
      const up: Row = (await sql<Row>`update ai_receptionist_agents set status = 'draft', archived_at = null, updated_at = now(), updated_by_user_id = ${ctx.userId}
        where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'draft')} returning ${AG}`.execute(trx)).rows[0];
      await this.event(trx, ctx, up, 'restored', this.snap(a), this.snap(up), { reason, key: input.idempotencyKey });
      return { agent: this.rowOut({ ...up, branch_name: a.branch_name, creator_name: a.creator_name }, await this.route(ctx)), replayed: false };
    });
  }

  /** Rollback: re-activate the agent this one replaced (recorded on its last activation) — same owner gates */
  async rollback(ctx: FdCtx, id: string, input: { expectedVersion: number; reason?: string | null; idempotencyKey: string; confirm?: boolean }) {
    this.owner(ctx);
    const last: Row | undefined = (await sql<Row>`select prior_agent_id from ai_receptionist_agent_events where tenant_id = ${ctx.tenantId} and agent_id = ${id}
      and action in ('activated', 'resumed', 'rolled_back') order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    if (!last?.prior_agent_id) throw new FrontDeskError('There is no earlier agent recorded for this route. Pause this agent to send calls to the human line instead.', 'AI_FD_NO_ROLLBACK', 409);
    const target = await this.agentRow(ctx, last.prior_agent_id);
    return this.activate(ctx, target.id, { ...input, expectedVersion: N(target.config_version) }, 'rolled_back');
  }

  // ── health (guide §11): read-only, recorded, rate-limited; never calls a provider or changes anything ──────────────────
  async agentHealth(ctx: FdCtx, id: string) {
    const a = await this.agentRow(ctx, id);
    const recent = (await sql<Row>`select 1 from ai_receptionist_health_runs where tenant_id = ${ctx.tenantId} and scope = 'agent' and agent_id = ${a.id}
      and created_at > clock_timestamp() - interval '10 seconds' limit 1`.execute(this.db)).rows[0];
    if (recent) throw new FrontDeskError('A check just ran for this agent. Wait a few seconds and try again.', 'AI_FD_HEALTH_RATE_LIMITED', 429);
    const r = await this.rc.readiness(ctx);
    const pre = await this.preflight(ctx, a, r);
    const route = await this.route(ctx, r);
    const chk = (cid: string, label: string, state: RcState, detail: string, remedy: string | null = null) => ({ id: cid, group: 'Agent', label, state, detail, evidence: '', impact: null, remedy, roleRequired: null, checkedAt: nowIso(), traceId: trace() });
    const failedCalls = a.provider_agent_id ? N((await sql<Row>`select count(*)::int n from voice_call_outcomes where tenant_id = ${ctx.tenantId} and agent_ref = ${a.provider_agent_id}
      and error_category is not null and coalesce(started_at, created_at) > now() - interval '24 hours'`.execute(this.db)).rows[0]?.n) : 0;
    const own = [
      chk('ag.config', 'Configuration', (a.wizard_state ?? {}).complete === true ? 'READY' : 'NOT_CONFIGURED', (a.wizard_state ?? {}).complete === true ? `Wizard steps 1–4 saved (version ${N(a.config_version)}).` : 'The wizard’s identity, knowledge, conversation and booking steps are not all saved.', 'Open the wizard and save each step.'),
      chk('ag.provider', 'Voice provider agent', a.provider_agent_id ? (pre.blockers.some((b) => b.id === 'agent.shared') ? 'FAILED' : 'READY') : 'NOT_CONFIGURED', a.provider_agent_id ? `Linked (${refSuffix(a.provider_agent_id)}).` : 'No provider agent is linked.'),
      chk('ag.handoff', 'Human handoff', a.handoff_destination ? 'READY' : 'NOT_CONFIGURED', a.handoff_destination ? 'A handoff destination is set.' : 'No handoff destination is set.'),
      chk('ag.route', 'Live route', a.status !== 'live' ? 'DISABLED' : route.salonLive && route.routedAgentRef === a.provider_agent_id ? 'READY' : 'FAILED',
        a.status !== 'live' ? 'This agent is not live.' : route.routedAgentRef === a.provider_agent_id ? `The latest recorded call on this route reached this agent${route.routedAt ? ' at ' + route.routedAt : ''}.` : 'The latest recorded call on this route reached a different agent, or the salon is not live — the route has drifted.',
        a.status === 'live' ? 'Check the number’s voice route in Twilio / Retell, or pause this agent.' : null),
      chk('ag.errors', 'Recent call errors', failedCalls === 0 ? 'READY' : 'WARNING', failedCalls === 0 ? 'No failed calls for this agent in the last 24 hours.' : `${failedCalls} call(s) for this agent recorded an error in the last 24 hours.`),
    ];
    const checks = [...own, ...r.checks];
    const order: RcState[] = ['FAILED', 'UNKNOWN', 'NOT_CONFIGURED', 'BLOCKED_EXTERNAL', 'WARNING', 'DISABLED', 'READY'];
    const overall = order.find((s) => checks.some((c) => c.state === s && c.id !== 'op.provider_live' && c.state !== 'DISABLED')) ?? 'READY';
    return this.db.transaction().execute(async (trx) => {
      const ins: Row = (await sql<Row>`insert into ai_receptionist_health_runs (tenant_id, branch_id, scope, agent_id, overall, checks, checked_by)
        values (${ctx.tenantId}, ${a.branch_id ?? null}, 'agent', ${a.id}, ${overall}, ${JSON.stringify(checks)}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id, created_at`.execute(trx)).rows[0];
      await sql`insert into ai_receptionist_agent_events (tenant_id, branch_id, agent_id, action, after_state, actor_user_id)
        values (${ctx.tenantId}, ${a.branch_id ?? null}, ${a.id}, 'health_checked', ${JSON.stringify({ overall, runId: ins.id })}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null})`.execute(trx);
      return { runId: ins.id, overall, checks, preflight: { ready: pre.ready, blockers: pre.blockers }, checkedAt: iso(ins.created_at), note: 'Read-only: no call was placed, no route or provider setting changed, nothing was purchased.' };
    });
  }

  /** "Check AI Front Desk System" — the salon checks plus agent-registry integrity (mapping, duplicates, drift, orphans) */
  async systemHealth(ctx: FdCtx) {
    const T = ctx.tenantId;
    const recent = (await sql<Row>`select 1 from ai_receptionist_health_runs where tenant_id = ${T} and scope = 'front_desk' and branch_id is not distinct from ${this.branch(ctx)}
      and created_at > clock_timestamp() - interval '10 seconds' limit 1`.execute(this.db)).rows[0];
    if (recent) throw new FrontDeskError('A check just ran. Wait a few seconds and try again.', 'AI_FD_HEALTH_RATE_LIMITED', 429);
    const r = await this.rc.readiness(ctx);
    const route = await this.route(ctx, r);
    const chk = (cid: string, label: string, state: RcState, detail: string, evidence: string, remedy: string | null = null, role: string | null = null): RcCheck =>
      ({ id: cid, group: 'Core data', label, state, detail, evidence, impact: null, remedy, roleRequired: role, checkedAt: nowIso(), traceId: trace() });
    const reg: Row = (await sql<Row>`select count(*) filter (where status <> 'archived')::int agents, count(*) filter (where status = 'live')::int live,
        count(*) filter (where status in ('ready', 'live', 'paused') and provider_agent_id is null)::int unmapped
      from ai_receptionist_agents where tenant_id = ${T}`.execute(this.db)).rows[0];
    const dupLive = N((await sql<Row>`select count(*)::int n from (select 1 from ai_receptionist_agents where tenant_id = ${T} and status = 'live'
      group by coalesce(branch_id, ${ZERO}::uuid) having count(*) > 1) x`.execute(this.db)).rows[0]?.n);
    const dupRef = N((await sql<Row>`select count(*)::int n from (select provider_agent_id from ai_receptionist_agents where tenant_id = ${T} and provider_agent_id is not null and status <> 'archived'
      group by provider_agent_id having count(*) > 1) x`.execute(this.db)).rows[0]?.n);
    const orphan = N((await sql<Row>`select count(distinct o.agent_ref)::int n from voice_call_outcomes o where o.tenant_id = ${T} and o.agent_ref is not null
      and coalesce(o.started_at, o.created_at) > now() - interval '7 days'
      and not exists (select 1 from ai_receptionist_agents a where a.tenant_id = o.tenant_id and a.provider_agent_id = o.agent_ref)`.execute(this.db)).rows[0]?.n);
    const liveAgent: Row | undefined = (await sql<Row>`select id, name, provider_agent_id from ai_receptionist_agents where tenant_id = ${T} and status = 'live'
      and (${this.branch(ctx)}::uuid is null or branch_id = ${this.branch(ctx)} or branch_id is null) order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
    const own: RcCheck[] = [
      chk('fd.registry', 'Agent registry', 'READY', `${N(reg.agents)} agent(s) on file, ${N(reg.live)} live.`, 'ai_receptionist_agents (this salon)'),
      chk('fd.one_live', 'One live agent per route', dupLive ? 'FAILED' : 'READY', dupLive ? `${dupLive} route(s) have more than one live agent.` : 'Each route has at most one live agent.', 'status = live grouped by branch scope', dupLive ? 'Pause the extra agent(s); only one may answer a route.' : null, 'Owner'),
      chk('fd.mapping', 'Provider mapping', dupRef || N(reg.unmapped) ? 'WARNING' : 'READY',
        dupRef ? `${dupRef} provider agent(s) are linked to more than one local agent.` : N(reg.unmapped) ? `${N(reg.unmapped)} ready/live/paused agent(s) have no provider agent linked.` : 'Every non-draft agent maps to exactly one provider agent.', 'provider_agent_id per agent', null, 'Owner or manager'),
      chk('fd.orphans', 'Calls from unknown agents', orphan ? 'WARNING' : 'READY', orphan ? `Calls in the last 7 days came from ${orphan} provider agent(s) not linked to any agent here.` : 'Every recorded call in the last 7 days maps to an agent here.',
        'voice_call_outcomes.agent_ref vs ai_receptionist_agents.provider_agent_id', orphan ? 'An unlinked agent is answering this salon’s calls: check the number’s route in the provider console.' : null, 'Owner'),
      chk('fd.drift', 'Live route', !liveAgent ? 'DISABLED' : route.salonLive && route.routedAgentRef === liveAgent.provider_agent_id ? 'READY' : 'FAILED',
        !liveAgent ? 'No agent is live; calls are not routed to the AI from here.' : route.routedAgentRef === liveAgent.provider_agent_id ? `"${liveAgent.name}" answered the latest recorded call.` : `"${liveAgent.name}" is live here, but the latest recorded call reached a different agent or the salon is not live.`,
        'latest recorded call agent vs live agent', liveAgent && route.routedAgentRef !== liveAgent.provider_agent_id ? 'Pause the agent (calls go to the human line) and fix the route in the provider console.' : null, 'Owner'),
    ];
    const checks = [...own, ...r.checks];
    const order: RcState[] = ['FAILED', 'UNKNOWN', 'NOT_CONFIGURED', 'BLOCKED_EXTERNAL', 'WARNING', 'DISABLED', 'READY'];
    const overall = order.find((s) => checks.some((c) => c.state === s && c.id !== 'op.provider_live' && c.state !== 'DISABLED')) ?? 'READY';
    const ins: Row = (await sql<Row>`insert into ai_receptionist_health_runs (tenant_id, branch_id, scope, overall, checks, checked_by)
      values (${T}, ${this.branch(ctx)}, 'front_desk', ${overall}, ${JSON.stringify(checks)}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id, created_at`.execute(this.db)).rows[0];
    return { runId: ins.id, overall, checks, checkedAt: iso(ins.created_at), note: 'Read-only: no call was placed, no route, provider setting or subscription changed.' };
  }

  /** Live routing monitor (guide §10.2) — signals only; nothing here changes a route */
  async monitor(ctx: FdCtx) {
    const T = ctx.tenantId; const b = this.branch(ctx);
    const r = await this.rc.readiness(ctx);
    const route = await this.route(ctx, r);
    const live: Row | undefined = (await sql<Row>`select id, name, provider_agent_id, activated_at, last_verified_at, handoff_destination, after_hours_message, booking_mode
      from ai_receptionist_agents where tenant_id = ${T} and status = 'live' and (${b}::uuid is null or branch_id = ${b} or branch_id is null) order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
    const calls: Row = (await sql<Row>`select count(*)::int total, count(*) filter (where error_category is not null)::int failed, count(*) filter (where abandoned)::int abandoned,
        count(*) filter (where coalesce(interruption_count, 0) > 0)::int interrupted, count(*) filter (where handoff_outcome is not null)::int handoffs
      from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and coalesce(started_at, created_at) > now() - interval '24 hours'`.execute(this.db)).rows[0];
    const tools: Row = (await sql<Row>`select count(*) filter (where tool_kind = 'write' and status = 'succeeded')::int writes_ok, count(*) filter (where tool_kind = 'write' and status in ('refused', 'failed'))::int writes_bad,
        count(*) filter (where business_result = 'slot_held')::int holds
      from voice_tool_executions where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and requested_at > now() - interval '24 hours'`.execute(this.db)).rows[0];
    const ent = r.checks.find((c) => c.id === 'ent.package');
    const drift = !!live && route.routedAgentRef != null && route.routedAgentRef !== live.provider_agent_id;
    return {
      providerRoute: { liveAgent: live ? { id: live.id, name: live.name, providerRef: refSuffix(live.provider_agent_id) } : null, routedAgentRef: refSuffix(route.routedAgentRef),
        routedAt: route.routedAt, drift, verifiedAt: iso(live?.last_verified_at ?? null), state: !live ? 'DISABLED' : drift || !route.salonLive ? 'FAILED' : 'READY' },
      agentHealth: { calls24h: N(calls.total), failed24h: N(calls.failed), interrupted24h: N(calls.interrupted), state: N(calls.failed) > 0 ? 'WARNING' : N(calls.total) ? 'READY' : 'UNKNOWN' },
      callSuccess: { answered24h: N(calls.total) - N(calls.abandoned), abandoned24h: N(calls.abandoned), handoffs24h: N(calls.handoffs) },
      bookingActions: { succeeded24h: N(tools.writes_ok), refusedOrFailed24h: N(tools.writes_bad), slotHolds24h: N(tools.holds), armed: !!route.control?.booking_armed,
        note: 'A booking still waiting for the six-digit code is not a confirmed appointment.' },
      fallback: { handoffConfigured: !!live?.handoff_destination, afterHoursMessage: !!live?.after_hours_message,
        state: !live ? 'DISABLED' : live.handoff_destination ? 'READY' : 'WARNING', note: 'Restoring a human route in Twilio is a provider-console step; it is not claimed here without a recorded call.' },
      subscription: { state: ent?.state ?? 'UNKNOWN', detail: ent?.detail ?? null, quotaWarnings: 'NOT_AVAILABLE', quotaNote: 'Voice-minute 80 / 90 / 100% warnings come from Plans & Usage counters, not shown here.' },
      stage: route.stage, checkedAt: nowIso(),
    };
  }
}
