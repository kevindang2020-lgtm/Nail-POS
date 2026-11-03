// receptionist-center.ts — AI Receptionist Complete Build & Repair Guide (Oct 31 2026): `/pos/ai/receptionist-center/*`.
//
// P0 root cause (guide §03) for the photographed "Twilio Connected · Retell Not connected · Integration key Not issued ·
// Booking Handoff-only" (TenantReceptionistService.overview, kept for compatibility):
//   • Twilio "Connected" = resolveTelephonyProvider(process.env) found the PLATFORM's TWILIO_ACCOUNT_SID/AUTH_TOKEN. It was
//     never the salon's own account (tenant_messaging_credentials), never a number, never a voice route to an agent.
//   • Retell "Not connected" = RETELL_API_KEY absent. When present, RetellVoiceProvider.status() said "connected" from key
//     PRESENCE alone — no API call, no agent, no tenant link.
//   • "Integration key: Not issued" = no un-revoked voice_integration_keys row for the tenant (the agent cannot call tools).
//   • "Handoff-only" = the process-wide env switch VOICE_WRITE_TOOLS_ENABLED off; there was no per-salon control at all.
//   • Checklist steps 4, 5, 7, 8 were hard-coded (action_needed / pending), step 2 was hard-coded pending → 1 of 8 = 13%.
// This center replaces those claims with evidence. Every dependency reports one of
//   READY · WARNING · FAILED · NOT_CONFIGURED · DISABLED · UNKNOWN · BLOCKED_EXTERNAL
// and the receptionist as a whole reports a STAGE that is never higher than its evidence:
//   not_configured → configured → ready_for_test → test_call_verified → live (or degraded when live but a gate fails).
// No provider is called from here (no network, no paid call): "connected" is never inferred from a saved setting.
//
// Per-salon control (ai_receptionist_control): booking actions armed, verified test call, activation. Arming / activation
// are refused unless every prerequisite gate passes; each change is version-checked, idempotent and recorded append-only
// (ai_receptionist_control_events) with before/after + an audit row in the same transaction. Booking write tools now
// require BOTH the platform master switch AND the salon's armed flag (enforced in the voice tool dispatch + gateway).
//
// Priority worklist (§12): missed/abandoned calls, failed transfers, unresolved requests, bookings waiting for the six-digit
// code, follow-ups due. Recommendations only; the one executable action is creating a staff follow-up task, which Front
// Desk may prepare and only an owner/manager may confirm (AI_RECEPTIONIST_ACTION). Texts and booking changes are never
// executed from here — they open the SMS Inbox / Booking where a person does them.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { canMoveToSql, branchTimeZone } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { evaluateAiAccess, type AiAccessSnapshot } from '../ai/ai-access-gate';
import { AI_RECEPTIONIST_ACTION } from '../ai-lifecycles';
import { voiceWriteToolsEnabled } from './voice-tools';

type Row = Record<string, any>;
export interface RcCtx { tenantId: string; branchId: string | null; userId: string; role?: string; permissions?: string[] }
export interface RcAccessRepo { loadSnapshot(tenantId: string, packageCode: string, userId: string | null, opts?: { branchId?: string | null }): Promise<AiAccessSnapshot> }
export interface RcBusinessReadiness { readiness(ctx: RcCtx): Promise<{ core: { key: string; status: string; detail: string }[] }> }

export const RC_STATES = ['READY', 'WARNING', 'FAILED', 'NOT_CONFIGURED', 'DISABLED', 'UNKNOWN', 'BLOCKED_EXTERNAL'] as const;
export type RcState = typeof RC_STATES[number];
export const RC_STAGES = ['not_configured', 'configured', 'ready_for_test', 'test_call_verified', 'live', 'degraded'] as const;
export const RC_PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
export const RC_CALL_STATUSES = ['completed', 'abandoned', 'failed', 'handed_off'] as const;
export const RC_OUTCOMES = ['booked', 'booking_requested', 'question', 'handoff', 'follow_up'] as const;
export const RC_DATE_BASES = ['call_started', 'recorded'] as const;
export const RC_SORTS = ['newest', 'oldest', 'longest'] as const;
export const RC_SCOPES = ['calls', 'customers', 'appointments', 'activity'] as const;
export const RC_CONTROL_ACTIONS = ['arm_booking', 'disarm_booking', 'verify_test_call', 'clear_test_call', 'activate', 'deactivate'] as const;
export const RC_ACTION_DECISIONS = ['confirm', 'cancel'] as const;
export const RC_PAGE_SIZES = [10, 20, 50] as const;
export const RC_PACKAGE = 'ai_phone_call_assistant';
/** handoff outcome vocabulary (documented rule, guide §14): requested = any value but none; completed / failed below */
export const HANDOFF_COMPLETED = ['transferred', 'completed', 'connected'];
export const HANDOFF_FAILED = ['failed', 'no_answer', 'busy', 'transfer_failed'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const trace = () => 'rc_' + randomUUID().slice(0, 8);
const nowIso = () => new Date().toISOString();
const pageOf = (p: unknown) => Math.max(1, Math.trunc(Number(p) || 1));
const sizeOf = (s: unknown) => ((RC_PAGE_SIZES as readonly number[]).includes(Number(s)) ? Number(s) : 20);
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
/** masked phone: last four only ("•••• 0142"); never the full number in a list */
export const maskPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `•••• ${d.slice(-4)}` : null; };
const digits = (q: string) => q.replace(/\D/g, '');

/** DI token for the center (provided in VoiceBookingModule; injected optionally by the voice write paths + legacy overview) */
export const RECEPTIONIST_CENTER = 'ReceptionistCenter';

const CTL_COLS = sql.raw('id, tenant_id, branch_id, booking_armed, booking_armed_at, booking_arm_reason, test_call_provider_call_id, test_call_verified_at, activated, activated_at, version');
const ACTION_COLS = sql.raw('id, branch_id, kind, status, source_type, source_ref, payload, result_ref, version');

export class ReceptionistCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}

export interface RcCheck { id: string; group: string; label: string; state: RcState; detail: string; evidence: string; impact: string | null; remedy: string | null; roleRequired: string | null; checkedAt: string; traceId: string }

/** the stage a salon's receptionist is in — never higher than the weakest required gate (guide §04) */
export function stageOf(c: { configuredAll: boolean; readyAll: boolean; testVerified: boolean; activated: boolean }): typeof RC_STAGES[number] {
  if (c.activated) return c.readyAll && c.testVerified ? 'live' : 'degraded';
  if (!c.configuredAll) return 'not_configured';
  if (!c.readyAll) return 'configured';
  return c.testVerified ? 'test_call_verified' : 'ready_for_test';
}

export class ReceptionistCenter {
  constructor(private readonly db: Kysely<any>, private readonly access: RcAccessRepo | null = null, private readonly business: RcBusinessReadiness | null = null,
    private readonly env: NodeJS.ProcessEnv = process.env) {}

  private branch(ctx: RcCtx): string | null { return isUuid(ctx.branchId) ? ctx.branchId : null; }
  private async zone(ctx: RcCtx) { return branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)).catch(() => 'America/New_York'); }
  private check(id: string, group: string, label: string, state: RcState, detail: string, evidence: string, remedy: string | null = null, impact: string | null = null, roleRequired: string | null = null): RcCheck {
    return { id, group, label, state, detail, evidence, impact, remedy, roleRequired, checkedAt: nowIso(), traceId: trace() };
  }
  private unknown(id: string, group: string, label: string, e: unknown): RcCheck {
    return this.check(id, group, label, 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`, 'Press Check again; if it keeps failing, contact support with the trace reference.');
  }

  /** the salon's control row (branch row over tenant row) */
  async control(ctx: RcCtx, db: Kysely<any> = this.db): Promise<Row | null> {
    const b = this.branch(ctx);
    return (await sql<Row>`select ${CTL_COLS} from ai_receptionist_control where tenant_id = ${ctx.tenantId} and (branch_id is not distinct from ${b} or branch_id is null)
      order by (branch_id is null) asc limit 1`.execute(db)).rows[0] ?? null;
  }
  /** booking write tools are allowed for a tenant/branch only when the platform switch AND the salon's armed flag are on */
  async bookingArmed(tenantId: string, branchId: string | null): Promise<boolean> {
    if (!voiceWriteToolsEnabled(this.env)) return false;
    // fail CLOSED: a read error means "not armed" (handoff-only), never "armed"; the error is logged, not hidden
    try { return !!(await this.control({ tenantId, branchId, userId: 'voice' }))?.booking_armed; }
    catch (e) { console.warn(`[receptionist-center] booking-armed read failed for tenant ${tenantId}; handoff-only: ${(e as Error)?.message ?? e}`); return false; }
  }

  // ── dependency checks (guide §09 groups) ───────────────────────────────────────────────────────────────────────────────
  async checks(ctx: RcCtx): Promise<RcCheck[]> {
    const b = this.branch(ctx); const T = ctx.tenantId; const out: RcCheck[] = [];
    // 1 Entitlements
    try {
      if (!this.access) out.push(this.check('ent.package', 'Entitlements', 'AI phone package', 'UNKNOWN', 'The subscription could not be read here.', 'no entitlement repository', 'Open Plans & Usage to confirm the AI phone package.'));
      else {
        const d = evaluateAiAccess(await this.access.loadSnapshot(T, RC_PACKAGE, ctx.userId, { branchId: b }));
        const mode = String(this.env.AI_ENTITLEMENT_ENFORCEMENT ?? 'observe').toLowerCase();
        out.push(d.allowed
          ? this.check('ent.package', 'Entitlements', 'AI phone package', 'READY', `Subscription ${d.subscriptionStatus}; the AI phone package is allowed.`, `entitlement decision: ${d.reason}`)
          : this.check('ent.package', 'Entitlements', 'AI phone package', 'FAILED', `Not allowed: ${d.reason.replace(/_/g, ' ')} (subscription ${d.subscriptionStatus}).${mode === 'enforce' ? '' : ' Enforcement is in observe mode, so calls are not blocked yet — but this salon is not entitled.'}`,
            `entitlement decision: ${d.reason}; enforcement ${mode}`, 'Open Plans & Usage — a valid AI phone subscription is required before going live.', 'Calls would be billed without an entitlement.', 'Owner'));
      }
    } catch (e) { out.push(this.unknown('ent.package', 'Entitlements', 'AI phone package', e)); }

    // 2 Twilio — the SALON's account, never the platform's
    let twilioReady = false; let fromNumber: string | null = null;
    try {
      const c: Row | undefined = (await sql<Row>`select status, from_number, last_validated_at, last_validation_error, branch_id from tenant_messaging_credentials
        where tenant_id = ${T} and provider = 'twilio' and (branch_id is not distinct from ${b} or branch_id is null) and offboarded_at is null
        order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
      const platformEnv = !!(String(this.env.TWILIO_ACCOUNT_SID ?? '').trim() && String(this.env.TWILIO_AUTH_TOKEN ?? '').trim());
      const note = platformEnv ? ' The platform also has its own Twilio credentials; the old screen showed "Connected" from those. They are not this salon’s account and are never used for it.' : '';
      fromNumber = c?.from_number ?? null;
      if (!c) out.push(this.check('tw.account', 'Twilio', 'Salon Twilio account', 'NOT_CONFIGURED', 'This salon has not connected its own Twilio account.' + note, 'tenant_messaging_credentials: none', 'Open Text Messaging Setup and connect the salon’s Twilio account.', null, 'Owner'));
      else if (c.last_validation_error) out.push(this.check('tw.account', 'Twilio', 'Salon Twilio account', 'FAILED', 'The last account check failed.' + note, 'a validation error is recorded on the account (text not shown)', 'Run Check SMS System in Text Messaging Setup and fix the account.', null, 'Owner'));
      else if (!c.last_validated_at) out.push(this.check('tw.account', 'Twilio', 'Salon Twilio account', 'WARNING', 'Saved but never checked.' + note, `status ${c.status}; never validated`, 'Run Check SMS System in Text Messaging Setup.', null, 'Owner'));
      else { twilioReady = true; out.push(this.check('tw.account', 'Twilio', 'Salon Twilio account', 'READY', 'The salon’s own account passed its last check.' + note, `status ${c.status}; validated ${iso(c.last_validated_at)}`)); }
    } catch (e) { out.push(this.unknown('tw.account', 'Twilio', 'Salon Twilio account', e)); }
    // inbound voice route: only real call events prove it (a saved number does not)
    let lastCall: string | null = null;
    try {
      const r: Row = (await sql<Row>`select max(coalesce(started_at, created_at)) last, count(*)::int n from voice_call_outcomes where tenant_id = ${T}
        and (${b}::uuid is null or branch_id = ${b}) and created_at > now() - interval '30 days'`.execute(this.db)).rows[0];
      lastCall = iso(r?.last);
      out.push(N(r?.n) > 0
        ? this.check('tw.route', 'Twilio', 'Inbound voice route', 'READY', `Calls are reaching the agent — ${N(r.n)} recorded in the last 30 days.`, `voice_call_outcomes: last ${lastCall}`)
        : this.check('tw.route', 'Twilio', 'Inbound voice route', fromNumber ? 'UNKNOWN' : 'NOT_CONFIGURED',
          fromNumber ? `Number ${maskPhone(fromNumber)} is saved, but no call has reached the agent — the route to the voice agent is not verified. A saved number is not proof of routing.` : 'No number is assigned to the receptionist.',
          'no call events in 30 days', 'Point the number’s voice webhook at the agent (provider account), then run an authorized test call.', 'The receptionist cannot answer calls until the route is proven.', 'Owner'));
    } catch (e) { out.push(this.unknown('tw.route', 'Twilio', 'Inbound voice route', e)); }

    // 3 Retell — configured ≠ connected
    const retellKey = !!String(this.env.RETELL_API_KEY ?? '').trim();
    out.push(retellKey
      ? this.check('rt.key', 'Retell', 'Retell API key', 'WARNING', 'A Retell key is configured, but it has not been tested from here. A saved key is not a connection.', 'RETELL_API_KEY present (value never shown)', 'Live provider check: run it from staging with the account owner.')
      : this.check('rt.key', 'Retell', 'Retell API key', 'FAILED', 'RETELL_API_KEY is not configured, so no voice agent can be created or reached.', 'RETELL_API_KEY absent', 'Set RETELL_API_KEY through the approved secrets process (deployment owner).', 'No AI can answer calls.', 'Platform owner'));
    // voice agent: real agent row linked to this tenant; an agent id also linked to another salon is forbidden (VO-03)
    let agentReady = false;
    try {
      const a: Row | undefined = (await sql<Row>`select id, name, status, provider_agent_id, updated_at from ai_receptionist_agents where tenant_id = ${T} and archived_at is null
        and (${b}::uuid is null or branch_id = ${b} or branch_id is null) order by (provider_agent_id is null) asc, updated_at desc limit 1`.execute(this.db)).rows[0];
      if (!a) out.push(this.check('rt.agent', 'Retell', 'Voice agent', 'NOT_CONFIGURED', 'No voice agent exists for this salon.', 'ai_receptionist_agents: none', 'Open Manage Agents and create the AI Front Desk agent.', null, 'Owner or manager'));
      else if (!a.provider_agent_id) {
        const job: Row | undefined = (await sql<Row>`select status, safe_error_message from ai_receptionist_provisioning_jobs where tenant_id = ${T} and agent_id = ${a.id} order by created_at desc limit 1`.execute(this.db)).rows[0];
        out.push(this.check('rt.agent', 'Retell', 'Voice agent', job?.status === 'failed' ? 'FAILED' : 'WARNING',
          job?.status === 'failed' ? `Creating the agent at the provider failed: ${job.safe_error_message ?? 'no reason recorded'}.` : `"${a.name}" is saved (${a.status}) but has not been created at the provider.`,
          `agent ${a.status}; provider agent id: none`, 'Provision the agent once the Retell key works.'));
      } else {
        const other = N((await sql<Row>`select count(*)::int n from ai_receptionist_agents where provider_agent_id = ${a.provider_agent_id} and tenant_id <> ${T}`.execute(this.db)).rows[0]?.n);
        if (other > 0) out.push(this.check('rt.agent', 'Retell', 'Voice agent', 'FAILED', 'This provider agent is also linked to another salon. That is forbidden: calls could reach the wrong business.', 'provider_agent_id shared across tenants', 'Contact support to re-provision a dedicated agent.', 'Calls may be answered with another salon’s data.', 'Support'));
        else { agentReady = true; out.push(this.check('rt.agent', 'Retell', 'Voice agent', 'READY', `"${a.name}" is created at the provider and linked only to this salon.`, `agent ${a.status}; provider agent linked`)); }
      }
    } catch (e) { out.push(this.unknown('rt.agent', 'Retell', 'Voice agent', e)); }

    // 4 Integration key — distinct from provider credentials
    let keyReady = false;
    try {
      const k: Row = (await sql<Row>`select count(*) filter (where revoked_at is null and (expires_at is null or expires_at > now()))::int active,
          count(*) filter (where revoked_at is not null)::int revoked, count(*) filter (where revoked_at is null and expires_at <= now())::int expired,
          max(last_used_at) filter (where revoked_at is null) last_used from voice_integration_keys where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b} or branch_id is null)`.execute(this.db)).rows[0];
      if (N(k.active) > 0) { keyReady = true; out.push(this.check('key.active', 'Integration key', 'Integration key', 'READY', `${N(k.active)} active key(s). The key lets the agent call this salon’s booking tools; it is not a provider password.`, `last used ${iso(k.last_used) ?? 'never'}; secrets never shown`)); }
      else if (N(k.expired) > 0) out.push(this.check('key.active', 'Integration key', 'Integration key', 'FAILED', 'The integration key has expired.', `${N(k.expired)} expired key(s)`, 'Issue a new key and update the agent’s tool configuration.', 'The agent cannot read services or availability.', 'Owner'));
      else if (N(k.revoked) > 0) out.push(this.check('key.active', 'Integration key', 'Integration key', 'FAILED', 'Every integration key was revoked.', `${N(k.revoked)} revoked key(s)`, 'Issue a new key and update the agent’s tool configuration.', 'The agent cannot read services or availability.', 'Owner'));
      else out.push(this.check('key.active', 'Integration key', 'Integration key', 'NOT_CONFIGURED', 'No integration key has been issued, so the agent cannot use any salon tool.', 'voice_integration_keys: none', 'An admin issues a vk_ key for the voice provider.', null, 'Owner'));
    } catch (e) { out.push(this.unknown('key.active', 'Integration key', 'Integration key', e)); }

    // 5 Business setup (guide 20 — the same rules the AI reads)
    let businessReady = false;
    try {
      if (!this.business) out.push(this.check('biz.setup', 'Business Setup', 'Hours, services, technicians', 'UNKNOWN', 'Business Setup readiness is not available here.', 'no business-setup service'));
      else {
        const r = await this.business.readiness(ctx); const bad = r.core.filter((c) => c.status !== 'READY');
        businessReady = bad.length === 0;
        out.push(businessReady ? this.check('biz.setup', 'Business Setup', 'Hours, services, technicians', 'READY', 'Hours, services and technicians are ready for the AI.', 'Business Setup readiness')
          : this.check('biz.setup', 'Business Setup', 'Hours, services, technicians', bad.some((c) => c.status === 'FAILED' || c.status === 'UNKNOWN') ? 'FAILED' : 'WARNING', bad.map((c) => `${c.key}: ${c.detail}`).join(' '), 'Business Setup readiness', 'Open Business Setup and finish the items listed.', null, 'Owner or manager'));
      }
    } catch (e) { out.push(this.unknown('biz.setup', 'Business Setup', 'Hours, services, technicians', e)); }

    // 6 Booking — handoff-only until the platform switch AND this salon armed it
    const ctl = await this.control(ctx);
    const master = voiceWriteToolsEnabled(this.env);
    if (!master) out.push(this.check('bk.actions', 'Booking', 'Booking actions', 'DISABLED', 'Handoff-only: the platform switch VOICE_WRITE_TOOLS_ENABLED is off, so the AI can answer and hand off but cannot hold or book.', 'VOICE_WRITE_TOOLS_ENABLED off', 'The platform owner turns the switch on after the booking tools are approved.', null, 'Platform owner'));
    else if (!ctl?.booking_armed) out.push(this.check('bk.actions', 'Booking', 'Booking actions', 'DISABLED', 'Handoff-only: this salon has not armed booking actions.', 'ai_receptionist_control.booking_armed = false', 'An owner or manager arms booking actions here once every gate passes.', null, 'Owner or manager'));
    else out.push(this.check('bk.actions', 'Booking', 'Booking actions', 'READY', 'Armed: the AI may hold and book through the canonical Booking engine (with the six-digit code where required).', `armed ${iso(ctl.booking_armed_at)}`));
    try {
      const v: Row | undefined = (await sql<Row>`select enabled, channel_ai_receptionist, hold_seconds from booking_verification_settings where tenant_id = ${T} and (branch_id is not distinct from ${b} or branch_id is null) order by (branch_id is null) asc limit 1`.execute(this.db)).rows[0];
      out.push(v ? this.check('bk.verify', 'Booking', 'Six-digit verification', v.enabled && v.channel_ai_receptionist ? 'READY' : 'WARNING', v.enabled && v.channel_ai_receptionist ? `Phone verification is on for AI calls; AI bookings stay pending until the six-digit code is entered (hold ${Math.round(N(v.hold_seconds) / 60)} min).` : 'Phone verification is off for AI receptionist bookings (a salon choice).', 'booking_verification_settings')
        : this.check('bk.verify', 'Booking', 'Six-digit verification', 'WARNING', 'No verification settings saved — the platform default applies.', 'booking_verification_settings: none', 'Review Booking Verification.'));
    } catch (e) { out.push(this.unknown('bk.verify', 'Booking', 'Six-digit verification', e)); }

    // 7 Communications (codes + confirmations ride the salon's messaging)
    out.push(twilioReady ? this.check('cm.sms', 'Communications', 'Texts for codes and confirmations', 'READY', 'The salon’s messaging account passed its last check.', 'tenant_messaging_credentials validated')
      : this.check('cm.sms', 'Communications', 'Texts for codes and confirmations', 'WARNING', 'Codes and confirmations cannot be texted until the salon’s messaging account passes its check.', 'see Twilio', 'Open Text Messaging Setup.'));

    // 8 Operations
    try {
      const o: Row = (await sql<Row>`select count(*) filter (where error_category is not null and created_at > now() - interval '24 hours')::int errors24,
          count(*) filter (where created_at > now() - interval '7 days')::int calls7 from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})`.execute(this.db)).rows[0];
      const h: Row = (await sql<Row>`select count(*)::int n from ai_receptionist_handoffs where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
          and connected_at is null and coalesce(status, '') not in ('completed', 'failed', 'cancelled') and requested_at < now() - interval '1 hour'`.execute(this.db)).rows[0];
      if (ctl?.activated && N(o.calls7) === 0) out.push(this.check('op.events', 'Operations', 'Call events', 'FAILED', 'The receptionist is activated but no call event has arrived for 7 days — the provider callback may be stale or broken.', 'voice_call_outcomes: none in 7 days', 'Check the provider’s webhook delivery and the integration key.', 'Calls may be unanswered or unrecorded.', 'Owner'));
      else if (N(o.errors24) > 0 || N(h.n) > 0) out.push(this.check('op.events', 'Operations', 'Call events', 'WARNING', `${N(o.errors24)} call(s) with errors in 24 hours; ${N(h.n)} handoff(s) requested over an hour ago and never connected.`, 'voice_call_outcomes.error_category; ai_receptionist_handoffs', 'Review the Priority list below.'));
      else out.push(this.check('op.events', 'Operations', 'Call events', 'READY', lastCall ? `No call errors in 24 hours; last call ${lastCall}.` : 'No errors recorded (no calls yet).', 'voice_call_outcomes'));
    } catch (e) { out.push(this.unknown('op.events', 'Operations', 'Call events', e)); }
    out.push(this.check('op.provider_live', 'Operations', 'Live provider check', 'BLOCKED_EXTERNAL', 'This check never calls Twilio or Retell (no network, no paid calls). Live reachability must be confirmed from staging with the account owner.', 'read-only check', 'Run the staging provider check.', null, 'Platform owner'));

    // 9 Readiness: test call + activation
    const gates = { entitlement: out.find((c) => c.id === 'ent.package')?.state === 'READY', twilio: twilioReady, retell: retellKey, agent: agentReady, key: keyReady, business: businessReady };
    out.push(ctl?.test_call_verified_at
      ? this.check('rd.test_call', 'Readiness', 'Test call', 'READY', `Test-call verified ${iso(ctl.test_call_verified_at)}.`, `call ${String(ctl.test_call_provider_call_id).slice(0, 12)}… recorded by the provider`)
      : this.check('rd.test_call', 'Readiness', 'Test call', Object.values(gates).every(Boolean) ? 'WARNING' : 'BLOCKED_EXTERNAL',
        Object.values(gates).every(Boolean) ? 'Ready for test — no authorized test call has been verified yet. This is not production verified.' : 'A test call needs the account, number route, agent and key first.',
        'ai_receptionist_control.test_call_verified_at: none', 'Place an authorized test call to the salon number, then mark that recorded call as the verified test.', null, 'Owner'));
    out.push(ctl?.activated ? this.check('rd.live', 'Readiness', 'Activation', 'READY', `Activated ${iso(ctl.activated_at)}.`, 'ai_receptionist_control.activated')
      : this.check('rd.live', 'Readiness', 'Activation', 'DISABLED', 'Not activated. Activation needs every gate plus a verified test call, by an owner or manager.', 'ai_receptionist_control.activated = false', null, null, 'Owner or manager'));
    return out;
  }

  /** readiness summary: stage + checks + the 8 original setup steps computed from evidence (not checkbox counts) */
  async readiness(ctx: RcCtx) {
    const checks = await this.checks(ctx);
    const st = (id: string) => checks.find((c) => c.id === id)?.state ?? 'UNKNOWN';
    const ctl = await this.control(ctx);
    // A saved Retell key is never READY (no live check from here) and the inbound route is proven only by a real call —
    // so "ready for test" needs every other gate READY and the key at least configured; the TEST CALL proves the rest.
    const req = ['ent.package', 'tw.account', 'rt.agent', 'key.active', 'biz.setup'];
    const configuredAll = req.every((id) => st(id) !== 'NOT_CONFIGURED') && st('rt.key') !== 'FAILED';
    const readyAll = req.every((id) => st(id) === 'READY') && st('rt.key') !== 'FAILED';
    const stage = stageOf({ configuredAll, readyAll, testVerified: !!ctl?.test_call_verified_at, activated: !!ctl?.activated });
    const step = (key: string, label: string, state: 'verified' | 'configured' | 'blocked' | 'incomplete', detail: string, route: string | null) => ({ key, label, state, detail, route });
    const steps = [
      step('business_setup', 'Confirm business hours & services', st('biz.setup') === 'READY' ? 'verified' : 'incomplete', checks.find((c) => c.id === 'biz.setup')!.detail, '/tenant/ai/receptionist/business-setup'),
      step('booking_rules', 'Confirm booking rules', st('bk.verify') === 'READY' ? 'verified' : 'configured', checks.find((c) => c.id === 'bk.verify')!.detail, '/tenant/communications/phone-verification'),
      step('integration_key', 'Issue an integration key', st('key.active') === 'READY' ? 'verified' : st('key.active') === 'FAILED' ? 'blocked' : 'incomplete', checks.find((c) => c.id === 'key.active')!.detail, null),
      step('voice_agent', 'Create the voice agent', st('rt.agent') === 'READY' ? 'verified' : st('rt.key') === 'FAILED' ? 'blocked' : st('rt.agent') === 'WARNING' ? 'configured' : 'incomplete', checks.find((c) => c.id === 'rt.agent')!.detail, '/tenant/ai/receptionist/front-desk'),
      step('phone_number', 'Connect a phone number', st('tw.route') === 'READY' ? 'verified' : st('tw.account') === 'READY' ? 'configured' : 'incomplete', checks.find((c) => c.id === 'tw.route')!.detail, '/tenant/communications/text-messaging-setup'),
      step('write_tools', 'Arm booking actions', st('bk.actions') === 'READY' ? 'verified' : 'incomplete', checks.find((c) => c.id === 'bk.actions')!.detail, null),
      step('test_call', 'Run a test call', st('rd.test_call') === 'READY' ? 'verified' : st('rd.test_call') === 'BLOCKED_EXTERNAL' ? 'blocked' : 'incomplete', checks.find((c) => c.id === 'rd.test_call')!.detail, null),
      step('go_live', 'Activate the receptionist', st('rd.live') === 'READY' ? 'verified' : 'incomplete', checks.find((c) => c.id === 'rd.live')!.detail, null),
    ];
    const verified = steps.filter((s) => s.state === 'verified').length;
    const connections = {
      twilio: st('tw.account') === 'READY' ? (st('tw.route') === 'READY' ? 'ready' : 'configured_route_unverified') : st('tw.account') === 'NOT_CONFIGURED' ? 'not_configured' : st('tw.account') === 'FAILED' ? 'failed' : 'configured_not_tested',
      retell: st('rt.key') === 'FAILED' ? 'not_configured' : st('rt.agent') === 'READY' ? 'agent_linked_not_live_tested' : 'configured_not_tested',
      integrationKey: st('key.active') === 'READY' ? 'issued' : st('key.active') === 'FAILED' ? 'revoked_or_expired' : 'not_issued',
      booking: st('bk.actions') === 'READY' ? 'armed' : 'handoff_only',
    };
    return { stage, steps, verifiedSteps: verified, progressPct: Math.round((verified / steps.length) * 100), connections, checks, control: ctl ? this.ctlOut(ctl) : null, checkedAt: nowIso() };
  }
  private ctlOut(c: Row) {
    return { bookingArmed: !!c.booking_armed, bookingArmedAt: iso(c.booking_armed_at), testCallVerifiedAt: iso(c.test_call_verified_at), testCallRef: c.test_call_provider_call_id ? String(c.test_call_provider_call_id).slice(0, 12) + '…' : null,
      activated: !!c.activated, activatedAt: iso(c.activated_at), version: N(c.version) };
  }

  /** "Check AI Receptionist System" — read-only; the run is recorded as evidence (no routing, provider or charge change) */
  async health(ctx: RcCtx) {
    const recent: Row | undefined = (await sql<Row>`select id from ai_receptionist_health_runs where tenant_id = ${ctx.tenantId} and scope = 'receptionist' and branch_id is not distinct from ${this.branch(ctx)}
      and created_at > clock_timestamp() - interval '10 seconds' limit 1`.execute(this.db)).rows[0];
    if (recent) throw new ReceptionistCenterError('A check just ran. Wait a few seconds and try again.', 'AI_RCPT_HEALTH_RATE_LIMITED', 429);
    const r = await this.readiness(ctx);
    const order: RcState[] = ['FAILED', 'UNKNOWN', 'NOT_CONFIGURED', 'BLOCKED_EXTERNAL', 'WARNING', 'DISABLED', 'READY'];
    const overall = order.find((s) => r.checks.some((c) => c.state === s && c.id !== 'op.provider_live')) ?? 'READY';
    const ins: Row = (await sql<Row>`insert into ai_receptionist_health_runs (tenant_id, branch_id, overall, checks, checked_by)
      values (${ctx.tenantId}, ${this.branch(ctx)}, ${overall}, ${JSON.stringify(r.checks)}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id, created_at`.execute(this.db)).rows[0];
    return { runId: ins.id, overall, stage: r.stage, checks: r.checks, checkedAt: iso(ins.created_at), note: 'Read-only: this check changed no routing, provider setting, subscription or customer record.' };
  }
  async lastHealth(ctx: RcCtx) {
    const r: Row | undefined = (await sql<Row>`select id, overall, created_at from ai_receptionist_health_runs where tenant_id = ${ctx.tenantId} and scope = 'receptionist' and branch_id is not distinct from ${this.branch(ctx)} order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    return r ? { runId: r.id, overall: r.overall, checkedAt: iso(r.created_at) } : null;
  }

  // ── period window in salon-local whole days (guide §07; inclusive To, next-day-exclusive end, DST-safe) ───────────────
  async window(ctx: RcCtx, f: { period?: string; from?: string; to?: string }) {
    const tz = await this.zone(ctx);
    const today = String((await sql<Row>`select (now() at time zone ${tz})::date::text d`.execute(this.db)).rows[0].d);
    let from = today, to = today;
    const p = (RC_PERIODS as readonly string[]).includes(String(f.period)) ? String(f.period) : (f.from || f.to ? 'custom' : 'month');
    if (p === 'week') from = String((await sql<Row>`select (date_trunc('week', ${today}::date))::date::text d`.execute(this.db)).rows[0].d);
    else if (p === 'month') from = today.slice(0, 8) + '01';
    else if (p === 'year') from = today.slice(0, 5) + '01-01';
    else if (p === 'custom') {
      if (f.from && !DATE.test(f.from)) throw new ReceptionistCenterError('Choose a valid From date.', 'AI_RCPT_INVALID_FILTER');
      if (f.to && !DATE.test(f.to)) throw new ReceptionistCenterError('Choose a valid To date.', 'AI_RCPT_INVALID_FILTER');
      from = f.from || today; to = f.to || today;
      if (to < from) throw new ReceptionistCenterError('The To date is before the From date.', 'AI_RCPT_INVALID_FILTER');
    }
    return { tz, period: p, from, to };
  }

  /** the five original cards, from authoritative rows (guide §14) */
  async kpis(ctx: RcCtx, f: { period?: string; from?: string; to?: string }) {
    const w = await this.window(ctx, f); const b = this.branch(ctx);
    const r: Row = (await sql<Row>`select count(*)::int calls,
        count(*) filter (where booking_outcome = 'booked')::int booked,
        count(*) filter (where booking_outcome is not null and booking_outcome not in ('booked', 'none'))::int booking_requested,
        count(*) filter (where handoff_outcome is not null and handoff_outcome <> 'none')::int handoff_requested,
        count(*) filter (where handoff_outcome = any(${HANDOFF_COMPLETED}::text[]))::int handoff_completed,
        count(*) filter (where handoff_outcome = any(${HANDOFF_FAILED}::text[]))::int handoff_failed,
        count(*) filter (where abandoned)::int abandoned,
        avg(duration_seconds) filter (where duration_seconds > 0 and ended_at is not null) avg_dur,
        count(*) filter (where duration_seconds > 0 and ended_at is not null)::int dur_n,
        coalesce(sum(duration_seconds) filter (where duration_seconds > 0), 0)::int minutes_s
      from voice_call_outcomes where tenant_id = ${ctx.tenantId} and (${b}::uuid is null or branch_id = ${b})
        and coalesce(started_at, created_at) >= (${w.from}::date)::timestamp at time zone ${w.tz}
        and coalesce(started_at, created_at) < ((${w.to}::date + 1))::timestamp at time zone ${w.tz}`.execute(this.db)).rows[0];
    const pend: Row = (await sql<Row>`select count(*)::int n from booking_verification_sessions where tenant_id = ${ctx.tenantId} and channel = 'ai_receptionist'
        and (${b}::uuid is null or branch_id = ${b}) and status in ('pending', 'sent') and expires_at > now()`.execute(this.db)).rows[0];
    const calls = N(r.calls);
    return {
      window: w,
      calls,
      booked: { confirmed: N(r.booked), requested: N(r.booking_requested), pendingVerification: pend?.n == null ? null : N(pend.n), ratePct: calls ? Math.round((1000 * N(r.booked)) / calls) / 10 : null },
      handoffs: { requested: N(r.handoff_requested), completed: N(r.handoff_completed), failed: N(r.handoff_failed), ratePct: calls ? Math.round((1000 * N(r.handoff_requested)) / calls) / 10 : null },
      abandoned: { count: N(r.abandoned), ratePct: calls ? Math.round((1000 * N(r.abandoned)) / calls) / 10 : null, rule: 'Counted only when the voice provider reports the caller hung up before the agent finished (abandoned = true). Never inferred from a missing booking.' },
      avgDurationSeconds: N(r.dur_n) ? Math.round(Number(r.avg_dur)) : null,
      voiceMinutes: calls ? Math.round(N(r.minutes_s) / 6) / 10 : 0,
      definitions: { calls: 'Calls the voice provider recorded for this salon in the window (by call start, salon time).', booked: 'Bookings the AI completed (booking outcome "booked"); requests and code-pending bookings are counted separately.', handoffs: 'Requested = the AI asked for a person; Completed = the transfer connected; Failed = the transfer did not connect.', avgDuration: 'Mean of ended calls with a recorded duration; — when there are none.' },
    };
  }

  // ── call history: server search, filters, salon-local From/To, numbered pages, newest first (guide §06–§08) ─────────────
  async calls(ctx: RcCtx, f: { q?: string; status?: string; outcome?: string; dateBasis?: string; period?: string; from?: string; to?: string; sort?: string; page?: unknown; pageSize?: unknown }) {
    const page = pageOf(f.page), size = sizeOf(f.pageSize); const b = this.branch(ctx);
    const w = (f.period || f.from || f.to) ? await this.window(ctx, f) : null;
    const col = f.dateBasis === 'recorded' ? sql`o.created_at` : sql`coalesce(o.started_at, o.created_at)`;
    const conds = [sql`o.tenant_id = ${ctx.tenantId}`, sql`(${b}::uuid is null or o.branch_id = ${b})`];
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) {
      const d = digits(q);
      conds.push(sql`(o.provider_call_id ilike ${like(q)} or coalesce(o.summary, '') ilike ${like(q)} or coalesce(o.error_category, '') ilike ${like(q)}
        or coalesce(o.booking_outcome, '') ilike ${like(q)} or coalesce(o.intents::text, '') ilike ${like(q)}
        or exists (select 1 from ai_receptionist_follow_ups fu where fu.tenant_id = o.tenant_id and fu.provider_call_id = o.provider_call_id
          and (${d.length >= 4 ? d : null}::text is not null and regexp_replace(coalesce(fu.caller_phone, ''), '\\D', '', 'g') like '%' || ${d.length >= 4 ? d : ''}::text)))`);
    }
    if (f.status === 'completed') conds.push(sql`o.ended_at is not null and not o.abandoned and o.error_category is null`);
    else if (f.status === 'abandoned') conds.push(sql`o.abandoned`);
    else if (f.status === 'failed') conds.push(sql`o.error_category is not null`);
    else if (f.status === 'handed_off') conds.push(sql`o.handoff_outcome is not null and o.handoff_outcome <> 'none'`);
    if (f.outcome === 'booked') conds.push(sql`o.booking_outcome = 'booked'`);
    else if (f.outcome === 'booking_requested') conds.push(sql`o.booking_outcome is not null and o.booking_outcome not in ('booked', 'none')`);
    else if (f.outcome === 'question') conds.push(sql`o.booking_outcome is null and (o.handoff_outcome is null or o.handoff_outcome = 'none')`);
    else if (f.outcome === 'handoff') conds.push(sql`o.handoff_outcome is not null and o.handoff_outcome <> 'none'`);
    else if (f.outcome === 'follow_up') conds.push(sql`o.follow_up_required`);
    if (w) { conds.push(sql`${col} >= (${w.from}::date)::timestamp at time zone ${w.tz}`); conds.push(sql`${col} < ((${w.to}::date + 1))::timestamp at time zone ${w.tz}`); }
    const where = sql.join(conds, sql` and `);
    const order = f.sort === 'oldest' ? sql`${col} asc, o.id asc` : f.sort === 'longest' ? sql`o.duration_seconds desc nulls last, o.id desc` : sql`${col} desc, o.id desc`;
    const total = N((await sql<Row>`select count(*)::int n from voice_call_outcomes o where o.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select o.id, o.provider_call_id, o.branch_id, o.started_at, o.ended_at, o.created_at, o.duration_seconds, o.intents, o.booking_outcome,
        o.handoff_outcome, o.abandoned, o.follow_up_required, o.error_category, o.language,
        (select fu.caller_phone from ai_receptionist_follow_ups fu where fu.tenant_id = o.tenant_id and fu.provider_call_id = o.provider_call_id order by fu.created_at desc limit 1) caller_phone,
        (select fu.customer_id from ai_receptionist_follow_ups fu where fu.tenant_id = o.tenant_id and fu.provider_call_id = o.provider_call_id and fu.customer_id is not null order by fu.created_at desc limit 1) customer_id
      from voice_call_outcomes o where o.tenant_id = ${ctx.tenantId} and ${where} order by ${order} limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({
        id: r.id, callRef: String(r.provider_call_id), startedAt: iso(r.started_at ?? r.created_at), endedAt: iso(r.ended_at), durationSeconds: r.duration_seconds == null ? null : N(r.duration_seconds),
        intents: Array.isArray(r.intents) ? r.intents : [], bookingOutcome: r.booking_outcome ?? null, handoffOutcome: r.handoff_outcome ?? null, abandoned: !!r.abandoned,
        followUpRequired: !!r.follow_up_required, errorCategory: r.error_category ?? null, language: r.language ?? null,
        callerMasked: maskPhone(r.caller_phone), identity: r.customer_id ? 'linked_customer' : r.caller_phone ? 'caller_only' : 'unknown',
        status: r.error_category ? 'failed' : r.abandoned ? 'abandoned' : r.handoff_outcome && r.handoff_outcome !== 'none' ? 'handed_off' : r.ended_at ? 'completed' : 'in_progress',
      })),
      pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) },
      window: w, dateBasis: f.dateBasis === 'recorded' ? 'recorded' : 'call_started',
    };
  }

  /** scoped smart search (guide §06): calls | customers | appointments | AI activity. Server-side, tenant/branch scoped, masked */
  async search(ctx: RcCtx, f: { scope?: string; q?: string; page?: unknown; pageSize?: unknown }) {
    const scope = (RC_SCOPES as readonly string[]).includes(String(f.scope)) ? String(f.scope) : 'calls';
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (scope === 'calls') return { scope, ...(await this.calls(ctx, { q, page: f.page, pageSize: f.pageSize })) };
    const page = pageOf(f.page), size = sizeOf(f.pageSize); const b = this.branch(ctx); const T = ctx.tenantId;
    if (!q) return { scope, items: [], pagination: { page, pageSize: size, totalItems: 0, totalPages: 1 } };
    const d = digits(q);
    if (scope === 'customers') {
      const where = sql`c.tenant_id = ${T} and (${b}::uuid is null or c.branch_id = ${b} or c.branch_id is null) and (c.full_name ilike ${like(q)} or coalesce(c.email, '') ilike ${like(q)}
        or c.id::text = ${q} or (${d.length >= 4}::boolean and regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like '%' || ${d || 'x'}::text || '%'))`;
      const total = N((await sql<Row>`select count(*)::int n from customers c where c.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
      const rows: Row[] = (await sql<Row>`select c.id, c.full_name, c.normalized_phone, c.email,
          (select count(*)::int from customers c2 where c2.tenant_id = c.tenant_id and c2.normalized_phone = c.normalized_phone and c2.id <> c.id) shared_phone,
          (select count(*)::int from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.source = 'ai') ai_bookings
        from customers c where c.tenant_id = ${T} and ${where} order by c.created_at desc, c.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
      return { scope, items: rows.map((r) => ({ id: r.id, name: r.full_name, phoneMasked: maskPhone(r.normalized_phone), emailMasked: r.email ? String(r.email).replace(/^(.).*(@.*)$/, '$1•••$2') : null,
        sharedPhone: N(r.shared_phone) > 0, aiBookings: N(r.ai_bookings) })), pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) } };
    }
    if (scope === 'appointments') {
      const where = sql`a.tenant_id = ${T} and a.source = 'ai' and (${b}::uuid is null or a.branch_id = ${b}) and (a.id::text = ${q} or coalesce(a.customer_name, '') ilike ${like(q)}
        or coalesce(a.status, '') ilike ${like(q)} or coalesce(a.phone_verification, '') ilike ${like(q)})`;
      const total = N((await sql<Row>`select count(*)::int n from pos_tech_appointments a where a.tenant_id = ${T} and ${where}`.execute(this.db)).rows[0]?.n);
      const rows: Row[] = (await sql<Row>`select a.id, a.customer_id, a.customer_name, a.appt_date::text appt_date, a.start_time::text start_time, a.status, a.phone_verification, a.technician_id, a.created_at
        from pos_tech_appointments a where a.tenant_id = ${T} and ${where} order by a.created_at desc, a.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
      return { scope, items: rows.map((r) => ({ id: r.id, customerId: r.customer_id, customerName: r.customer_name, date: r.appt_date, startTime: String(r.start_time ?? '').slice(0, 5), status: r.status,
        verification: r.phone_verification ?? null, createdAt: iso(r.created_at) })), pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) } };
    }
    // AI activity: control changes, health runs and worklist actions (tool executions live on each call's record)
    const rows: Row[] = (await sql<Row>`select x.id, x.kind, x.detail, x.created_at from (
        select id::text id, 'control' kind, action detail, created_at from ai_receptionist_control_events where tenant_id = ${T} and (id::text = ${q} or action ilike ${like(q)} or coalesce(reason, '') ilike ${like(q)})
        union all select id::text, 'health_check', overall, created_at from ai_receptionist_health_runs where tenant_id = ${T} and (id::text = ${q} or overall ilike ${like(q)})
        union all select id::text, 'action', kind || ':' || status, created_at from ai_receptionist_actions where tenant_id = ${T} and (id::text = ${q} or status ilike ${like(q)} or source_ref ilike ${like(q)})
      ) x order by created_at desc, id desc limit ${size + 1} offset ${(page - 1) * size}`.execute(this.db)).rows;
    const more = rows.length > size;
    return { scope, items: rows.slice(0, size).map((r) => ({ id: r.id, kind: r.kind, detail: r.detail, at: iso(r.created_at) })),
      pagination: { page, pageSize: size, totalItems: null, totalPages: more ? page + 1 : page } };
  }

  /** one call — summary, linked customer (masked), appointments, AI actions, handoffs, messages, transcript gate (guide §11) */
  async callDetail(ctx: RcCtx, ref: string, canSeeTranscript: boolean) {
    const T = ctx.tenantId; const b = this.branch(ctx);
    const o: Row | undefined = (await sql<Row>`select id, branch_id, provider, provider_call_id, prompt_version, started_at, ended_at, duration_seconds, language, intents, tool_calls,
      booking_outcome, handoff_outcome, abandoned, follow_up_required, error_category, summary, created_at from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
      and (provider_call_id = ${ref} or id::text = ${ref}) limit 1`.execute(this.db)).rows[0];
    if (!o) throw new ReceptionistCenterError('That call was not found for this salon.', 'AI_RCPT_CALL_NOT_FOUND', 404);
    const pc = String(o.provider_call_id);
    const fus: Row[] = (await sql<Row>`select id, reason, priority, status, customer_id, caller_phone, appointment_id, assigned_user_id, due_at, created_at, resolved_at
      from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id = ${pc} order by created_at desc`.execute(this.db)).rows;
    const customerId = fus.find((x) => x.customer_id)?.customer_id ?? null;
    const caller = fus.find((x) => x.caller_phone)?.caller_phone ?? null;
    let customer: Row | null = null; let shared = 0;
    if (customerId) {
      customer = (await sql<Row>`select id, full_name, normalized_phone from customers where tenant_id = ${T} and id = ${customerId}`.execute(this.db)).rows[0] ?? null;
      if (customer?.normalized_phone) shared = N((await sql<Row>`select count(*)::int n from customers where tenant_id = ${T} and normalized_phone = ${customer.normalized_phone} and id <> ${customerId}`.execute(this.db)).rows[0]?.n);
    }
    const appts: Row[] = customerId ? (await sql<Row>`select id, appt_date::text appt_date, start_time::text start_time, status, phone_verification, source, created_at from pos_tech_appointments
      where tenant_id = ${T} and customer_id = ${customerId} and source = 'ai' order by created_at desc limit 10`.execute(this.db)).rows : [];
    const handoffs: Row[] = (await sql<Row>`select id, status, reason, requested_at, connected_at, failure_reason, transferred_to from ai_receptionist_handoffs
      where tenant_id = ${T} and (ai_session_id::text = ${pc} or call_code = ${pc}) order by requested_at desc`.execute(this.db)).rows;
    const actions: Row[] = (await sql<Row>`select id, kind, status, prepared_by, decided_by, decided_at, result_ref, failure_reason, created_at from ai_receptionist_actions
      where tenant_id = ${T} and source_ref = ${pc} order by created_at desc`.execute(this.db)).rows;
    const tr: Row | undefined = (await sql<Row>`select id, status, redaction_status, raw_available, legal_hold, deleted_at from call_transcripts where tenant_id = ${T} and provider_call_id = ${pc} limit 1`.execute(this.db)).rows[0];
    let transcript: Row | null = null;
    if (tr && !tr.deleted_at) {
      if (canSeeTranscript) {
        await recordAuditStrict(this.db, { tenantId: T, branchId: b, userId: ctx.userId, role: ctx.role ?? null },
          { module: 'ai_receptionist', action: 'call.transcript_viewed', resourceType: 'call_transcript', resourceId: String(tr.id), summary: 'Opened a call transcript record from the AI Receptionist call overlay' });
        transcript = { available: true, id: tr.id, status: tr.status, redaction: tr.redaction_status, route: `/tenant/ai/voice-transcriptions/${tr.id}` };
      } else transcript = { available: true, restricted: true };
    }
    return {
      call: { id: o.id, callRef: pc, branchId: o.branch_id, startedAt: iso(o.started_at ?? o.created_at), endedAt: iso(o.ended_at), durationSeconds: o.duration_seconds == null ? null : N(o.duration_seconds),
        provider: o.provider, promptVersion: o.prompt_version, language: o.language, intents: o.intents ?? [], bookingOutcome: o.booking_outcome, handoffOutcome: o.handoff_outcome,
        abandoned: !!o.abandoned, followUpRequired: !!o.follow_up_required, errorCategory: o.error_category, toolCalls: Array.isArray(o.tool_calls) ? o.tool_calls : [],
        summary: o.summary ? { text: String(o.summary), generated: true } : null },
      caller: { masked: maskPhone(caller ?? customer?.normalized_phone), identity: customerId ? (shared > 0 ? 'candidate_shared_phone' : 'linked_customer') : caller ? 'caller_unverified' : 'unknown',
        explanation: customerId ? (shared > 0 ? `This number is shared by ${shared + 1} customer profiles — confirm who called before acting. Profiles are never merged.` : 'Linked through the follow-up the call created.')
          : 'No customer is linked to this call. Treat the caller as unverified.' },
      customer: customer ? { id: customer.id, name: customer.full_name, phoneMasked: maskPhone(customer.normalized_phone) } : null,
      appointments: appts.map((a) => ({ id: a.id, date: a.appt_date, startTime: String(a.start_time ?? '').slice(0, 5), status: a.status, verification: a.phone_verification ?? null, createdAt: iso(a.created_at) })),
      followUps: fus.map((x) => ({ id: x.id, reason: x.reason, priority: x.priority, status: x.status, dueAt: iso(x.due_at), createdAt: iso(x.created_at), resolvedAt: iso(x.resolved_at) })),
      handoffs: handoffs.map((h) => ({ id: h.id, status: h.status, reason: h.reason, requestedAt: iso(h.requested_at), connectedAt: iso(h.connected_at), failureReason: h.failure_reason ?? null,
        state: h.connected_at ? 'completed' : h.failure_reason || h.status === 'failed' ? 'failed' : h.status === 'transferring' ? 'attempted' : 'requested' })),
      actions: actions.map((a) => ({ id: a.id, kind: a.kind, status: a.status, decidedAt: iso(a.decided_at), resultRef: a.result_ref, failureReason: a.failure_reason, createdAt: iso(a.created_at) })),
      transcript,
      messages: { note: 'Texts linked to this call appear in the SMS Inbox with their provider status; nothing is shown here as delivered without a provider receipt.' },
    };
  }

  /** priority worklist (guide §12): urgent and oldest first; older urgent items are never buried by newer calls */
  async priority(ctx: RcCtx, f: { page?: unknown; pageSize?: unknown }) {
    const page = pageOf(f.page), size = sizeOf(f.pageSize); const T = ctx.tenantId; const b = this.branch(ctx);
    const base = sql`
      select 'call' source_type, o.provider_call_id source_ref, case when o.abandoned then 'missed_call' else 'unresolved_request' end kind,
        case when o.abandoned then 2 else 3 end urgency, coalesce(o.started_at, o.created_at) at_time, null::timestamptz expires_at,
        coalesce(o.summary, '') detail
      from voice_call_outcomes o where o.tenant_id = ${T} and (${b}::uuid is null or o.branch_id = ${b}) and (o.abandoned or o.follow_up_required)
        and o.created_at > now() - interval '14 days'
        and not exists (select 1 from ai_receptionist_follow_ups fu where fu.tenant_id = o.tenant_id and fu.provider_call_id = o.provider_call_id)
      union all
      select 'handoff', h.id::text, case when h.failure_reason is not null or h.status = 'failed' then 'failed_transfer' else 'person_requested' end,
        case when h.failure_reason is not null or h.status = 'failed' then 1 else 1 end, h.requested_at, null, coalesce(h.reason, '')
      from ai_receptionist_handoffs h where h.tenant_id = ${T} and (${b}::uuid is null or h.branch_id = ${b}) and h.connected_at is null
        and coalesce(h.status, '') not in ('completed', 'cancelled', 'resolved') and h.requested_at > now() - interval '14 days'
      union all
      select 'verification', v.id::text, 'pending_verification', 2, v.created_at, v.expires_at, coalesce(v.phone_mask, '')
      from booking_verification_sessions v where v.tenant_id = ${T} and v.channel = 'ai_receptionist' and (${b}::uuid is null or v.branch_id = ${b})
        and v.verified_at is null and v.consumed_at is null and v.expires_at > now()
      union all
      select 'follow_up', f.id::text, 'follow_up_due', case when f.priority in ('urgent', 'high') then 1 else 3 end, coalesce(f.due_at, f.created_at), null, f.reason
      from ai_receptionist_follow_ups f where f.tenant_id = ${T} and (${b}::uuid is null or f.branch_id = ${b}) and f.status in ('open', 'assigned', 'waiting')`;
    const total = N((await sql<Row>`select count(*)::int n from (${base}) w`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select w.*, (select a.status from ai_receptionist_actions a where a.tenant_id = ${T} and a.source_type = w.source_type and a.source_ref = w.source_ref
        order by a.created_at desc limit 1) action_status, (select a.id from ai_receptionist_actions a where a.tenant_id = ${T} and a.source_type = w.source_type and a.source_ref = w.source_ref
        order by a.created_at desc limit 1) action_id
      from (${base}) w order by w.urgency asc, w.at_time asc, w.source_ref asc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    const next: Record<string, string> = {
      missed_call: 'Call the customer back (create a callback task).', unresolved_request: 'Review the request and create a follow-up task.',
      failed_transfer: 'A person was asked for and the transfer did not connect — call back now.', person_requested: 'The caller asked for a person — make sure someone picks this up.',
      pending_verification: 'The booking is held for the six-digit code — it is NOT confirmed. Help the customer finish or let the hold expire.', follow_up_due: 'Work the open follow-up task.',
    };
    return {
      items: rows.map((r) => ({ sourceType: r.source_type, sourceRef: String(r.source_ref), kind: r.kind, urgency: N(r.urgency), at: iso(r.at_time), expiresAt: iso(r.expires_at),
        detail: String(r.detail ?? '').slice(0, 160), recommendation: next[r.kind] ?? 'Review.', recommendationState: 'recommended',
        action: r.action_id ? { id: r.action_id, status: r.action_status } : null,
        canPrepare: ['call', 'handoff'].includes(r.source_type) && !r.action_id,
        notExecutableHere: ['Customer texts are sent from the SMS Inbox by a person.', 'Booking changes are made in Booking by a person.'] })),
      pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) },
    };
  }

  // ── approval-gated action: prepare (Front Desk+) → confirm/cancel (owner/manager) ────────────────────────────────────────
  async prepareAction(ctx: RcCtx, input: { sourceType: string; sourceRef: string; kind: string; reason?: string | null; idempotencyKey: string }) {
    if (input.kind !== 'create_follow_up') throw new ReceptionistCenterError('Only a staff follow-up task can be prepared here. Customer texts and booking changes are done by a person in the SMS Inbox or Booking.', 'AI_RCPT_ACTION_NOT_EXECUTABLE', 422);
    if (!['call', 'handoff'].includes(input.sourceType)) throw new ReceptionistCenterError('That item cannot have an action prepared.', 'AI_RCPT_ACTION_NOT_EXECUTABLE', 422);
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const prior: Row | undefined = (await sql<Row>`select id, status from ai_receptionist_actions where tenant_id = ${T} and idempotency_key = ${input.idempotencyKey}`.execute(trx)).rows[0];
      if (prior) return { id: prior.id as string, status: String(prior.status), replayed: true };
      // the source must exist in THIS salon (no cross-tenant reference)
      const exists = input.sourceType === 'call'
        ? (await sql<Row>`select 1 from voice_call_outcomes where tenant_id = ${T} and provider_call_id = ${input.sourceRef}`.execute(trx)).rows.length > 0
        : isUuid(input.sourceRef) && (await sql<Row>`select 1 from ai_receptionist_handoffs where tenant_id = ${T} and id = ${input.sourceRef}`.execute(trx)).rows.length > 0;
      if (!exists) throw new ReceptionistCenterError('That item was not found for this salon.', 'AI_RCPT_SOURCE_NOT_FOUND', 404);
      const ins: Row | undefined = (await sql<Row>`insert into ai_receptionist_actions (tenant_id, branch_id, kind, status, source_type, source_ref, payload, prepared_by, prepared_reason, idempotency_key, policy_decision, updated_by)
        values (${T}, ${this.branch(ctx)}, 'create_follow_up', 'awaiting_confirmation', ${input.sourceType}, ${input.sourceRef}, ${JSON.stringify({ reason: input.sourceType === 'handoff' ? 'CUSTOMER_REQUESTED_HUMAN' : 'CALLBACK' })}::jsonb,
          ${ctx.userId}, ${input.reason ?? null}, ${input.idempotencyKey}, 'needs owner or manager confirmation', ${ctx.userId})
        on conflict do nothing returning id, status`.execute(trx)).rows[0];
      if (!ins) throw new ReceptionistCenterError('An action for this item is already waiting for confirmation.', 'AI_RCPT_ACTION_EXISTS', 409);
      await recordAuditStrict(trx, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
        { module: 'ai_receptionist', action: 'action.prepared', resourceType: 'ai_receptionist_action', resourceId: ins.id, summary: 'Prepared a follow-up task (awaiting confirmation; nothing executed)', reason: input.reason ?? undefined, metadata: { sourceType: input.sourceType } });
      return { id: ins.id as string, status: String(ins.status), replayed: false };
    });
  }

  async decideAction(ctx: RcCtx, id: string, input: { decision: string; expectedVersion: number; reason?: string | null }) {
    if (!isUuid(id)) throw new ReceptionistCenterError('That action was not found.', 'AI_RCPT_ACTION_NOT_FOUND', 404);
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const a: Row | undefined = (await sql<Row>`select ${ACTION_COLS} from ai_receptionist_actions where tenant_id = ${T} and id = ${id} for update`.execute(trx)).rows[0];
      if (!a) throw new ReceptionistCenterError('That action was not found.', 'AI_RCPT_ACTION_NOT_FOUND', 404);
      if (N(a.version) !== Number(input.expectedVersion)) {
        if (['confirmed', 'cancelled'].includes(a.status) && ((input.decision === 'confirm' && a.status === 'confirmed') || (input.decision === 'cancel' && a.status === 'cancelled'))) return { id, status: String(a.status), resultRef: a.result_ref, version: N(a.version), replayed: true };
        throw new ReceptionistCenterError('Someone else changed this action. Refresh and try again.', 'AI_RCPT_VERSION_CONFLICT', 409);
      }
      if (input.decision === 'cancel') {
        const up: Row | undefined = (await sql<Row>`update ai_receptionist_actions set status = 'cancelled', decided_by = ${ctx.userId}, decided_at = now(), decision_reason = ${input.reason ?? null},
          version = version + 1, updated_at = now(), updated_by = ${ctx.userId} where tenant_id = ${T} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_ACTION, 'cancelled')} returning version`.execute(trx)).rows[0];
        if (!up) throw new ReceptionistCenterError(`This action is already ${a.status}.`, 'AI_RCPT_ACTION_CLOSED', 409);
        await recordAuditStrict(trx, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
          { module: 'ai_receptionist', action: 'action.cancelled', resourceType: 'ai_receptionist_action', resourceId: id, summary: 'Cancelled a prepared action', reason: input.reason ?? undefined });
        return { id, status: 'cancelled', resultRef: null, version: N(up.version), replayed: false };
      }
      // confirm → executing → confirmed (the backend result is the evidence)
      const ex: Row | undefined = (await sql<Row>`update ai_receptionist_actions set status = 'executing', decided_by = ${ctx.userId}, decided_at = now(), decision_reason = ${input.reason ?? null},
        updated_at = now(), updated_by = ${ctx.userId} where tenant_id = ${T} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_ACTION, 'executing')} returning id`.execute(trx)).rows[0];
      if (!ex) throw new ReceptionistCenterError(`This action is already ${a.status}.`, 'AI_RCPT_ACTION_CLOSED', 409);
      let followUpId: string; let reused = false;
      const pc = a.source_type === 'call' ? String(a.source_ref) : null;
      const existing: Row | undefined = pc ? (await sql<Row>`select id from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id = ${pc} and status not in ('resolved', 'closed') limit 1`.execute(trx)).rows[0] : undefined;
      if (existing) { followUpId = existing.id; reused = true; }
      else {
        const fu: Row = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, provider_call_id, created_by_user_id, source, notes)
          values (${T}, ${a.branch_id}, ${String(a.payload?.reason ?? 'CALLBACK')}, ${a.source_type === 'handoff' ? 'high' : 'normal'}, 'open', ${pc}, ${ctx.userId}, 'manual',
            ${`From the AI Receptionist priority list (${a.source_type} ${String(a.source_ref).slice(0, 12)}).`}) returning id`.execute(trx)).rows[0];
        followUpId = fu.id;
      }
      const done: Row = (await sql<Row>`update ai_receptionist_actions set status = 'confirmed', result_ref = ${followUpId}, version = version + 1, updated_at = now(), updated_by = ${ctx.userId}
        where tenant_id = ${T} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_ACTION, 'confirmed')} returning version`.execute(trx)).rows[0];
      await recordAuditStrict(trx, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
        { module: 'ai_receptionist', action: 'action.confirmed', resourceType: 'ai_receptionist_action', resourceId: id, summary: reused ? 'Confirmed: linked the existing open follow-up task' : 'Confirmed: created a follow-up task', reason: input.reason ?? undefined, metadata: { followUpId } });
      return { id, status: 'confirmed', resultRef: followUpId, reused, version: N(done.version), replayed: false };
    });
  }

  // ── per-salon control: arm / test call / activate (each gated, version-checked, idempotent, append-only + audited) ─────────
  async controlAction(ctx: RcCtx, input: { action: string; expectedVersion: number; reason?: string | null; providerCallRef?: string | null; idempotencyKey: string }) {
    if (!(RC_CONTROL_ACTIONS as readonly string[]).includes(input.action)) throw new ReceptionistCenterError('Unknown action.', 'AI_RCPT_INVALID_ACTION');
    const reason = String(input.reason ?? '').trim();
    if (['arm_booking', 'verify_test_call', 'activate'].includes(input.action) && reason.length < 5) throw new ReceptionistCenterError('Give a short reason (at least 5 characters).', 'AI_RCPT_REASON_REQUIRED');
    const T = ctx.tenantId; const b = this.branch(ctx);
    // gate evidence is read before the transaction (read-only), then the write re-checks the version under the row lock
    const r = (['arm_booking', 'activate', 'verify_test_call'].includes(input.action)) ? await this.readiness(ctx) : null;
    const st = (id: string) => r?.checks.find((c) => c.id === id)?.state;
    if (input.action === 'arm_booking') {
      const failing = ['ent.package', 'rt.agent', 'key.active', 'biz.setup'].filter((id) => st(id) !== 'READY');
      if (!voiceWriteToolsEnabled(this.env)) failing.unshift('platform_switch');
      if (failing.length) throw new ReceptionistCenterError('Booking actions cannot be armed yet.', 'AI_RCPT_GATES_NOT_MET', 409, { failing });
    }
    let callRef: string | null = null;
    if (input.action === 'verify_test_call') {
      const ref = String(input.providerCallRef ?? '').trim();
      const o: Row | undefined = ref ? (await sql<Row>`select provider_call_id, created_at, error_category from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
        and provider_call_id = ${ref} and created_at > now() - interval '7 days'`.execute(this.db)).rows[0] : undefined;
      if (!o) throw new ReceptionistCenterError('Pick a call the provider recorded for this salon in the last 7 days. A test call is proven only by a real recorded call.', 'AI_RCPT_TEST_CALL_NOT_FOUND', 404);
      if (o.error_category) throw new ReceptionistCenterError('That call recorded an error, so it cannot be the verified test call.', 'AI_RCPT_TEST_CALL_FAILED', 409);
      const failing = ['rt.agent', 'key.active'].filter((id) => st(id) !== 'READY');
      if (failing.length) throw new ReceptionistCenterError('A test call can be verified only once the agent and key are ready.', 'AI_RCPT_GATES_NOT_MET', 409, { failing });
      callRef = String(o.provider_call_id);
    }
    if (input.action === 'activate') {
      const failing = ['ent.package', 'tw.account', 'tw.route', 'rt.agent', 'key.active', 'biz.setup', 'rd.test_call'].filter((id) => st(id) !== 'READY');
      if (failing.length) throw new ReceptionistCenterError('The receptionist cannot be activated until every gate passes, including a verified test call.', 'AI_RCPT_GATES_NOT_MET', 409, { failing });
    }
    return this.db.transaction().execute(async (trx) => {
      const prior: Row | undefined = (await sql<Row>`select id from ai_receptionist_control_events where tenant_id = ${T} and idempotency_key = ${input.idempotencyKey}`.execute(trx)).rows[0];
      if (prior) { const c = await this.control(ctx, trx); return { control: c ? this.ctlOut(c) : null, replayed: true }; }
      await sql`insert into ai_receptionist_control (tenant_id, branch_id, updated_by) values (${T}, ${b}, ${ctx.userId})
        on conflict (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing`.execute(trx);
      const cur: Row = (await sql<Row>`select ${CTL_COLS} from ai_receptionist_control where tenant_id = ${T} and branch_id is not distinct from ${b} for update`.execute(trx)).rows[0];
      if (N(cur.version) !== Number(input.expectedVersion) && !(Number(input.expectedVersion) === 0 && N(cur.version) === 1)) throw new ReceptionistCenterError('Someone else changed these settings. Refresh and try again.', 'AI_RCPT_VERSION_CONFLICT', 409);
      const before = this.ctlOut(cur);
      const set = input.action === 'arm_booking' ? sql`booking_armed = true, booking_armed_at = now(), booking_armed_by = ${ctx.userId}, booking_arm_reason = ${reason}`
        : input.action === 'disarm_booking' ? sql`booking_armed = false, booking_armed_at = null, booking_armed_by = null, booking_arm_reason = ${reason || null}, activated = false, activated_at = null, activated_by = null`
        : input.action === 'verify_test_call' ? sql`test_call_provider_call_id = ${callRef}, test_call_verified_at = now(), test_call_verified_by = ${ctx.userId}`
        : input.action === 'clear_test_call' ? sql`test_call_provider_call_id = null, test_call_verified_at = null, test_call_verified_by = null, activated = false, activated_at = null, activated_by = null`
        : input.action === 'activate' ? sql`activated = true, activated_at = now(), activated_by = ${ctx.userId}`
        : sql`activated = false, activated_at = null, activated_by = null`;
      const up: Row = (await sql<Row>`update ai_receptionist_control set ${set}, version = version + 1, updated_at = now(), updated_by = ${ctx.userId} where id = ${cur.id} returning ${CTL_COLS}`.execute(trx)).rows[0];
      const after = this.ctlOut(up);
      await sql`insert into ai_receptionist_control_events (tenant_id, branch_id, action, before_state, after_state, reason, actor_user_id, idempotency_key)
        values (${T}, ${b}, ${input.action}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${reason || null}, ${ctx.userId}, ${input.idempotencyKey})`.execute(trx);
      await recordAuditStrict(trx, { tenantId: T, branchId: b, userId: ctx.userId, role: ctx.role ?? null },
        { module: 'ai_receptionist', action: `control.${input.action}`, resourceType: 'ai_receptionist_control', resourceId: String(up.id), summary: `AI Receptionist: ${input.action.replace(/_/g, ' ')}`, reason: reason || undefined, metadata: { before, after } });
      return { control: after, replayed: false };
    });
  }

  /** protected-setting change history (append-only), newest first */
  async controlHistory(ctx: RcCtx, f: { page?: unknown; pageSize?: unknown }) {
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    const total = N((await sql<Row>`select count(*)::int n from ai_receptionist_control_events where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select id, action, before_state, after_state, reason, actor_user_id, created_at from ai_receptionist_control_events where tenant_id = ${ctx.tenantId}
      order by created_at desc, id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: r.id, action: r.action, before: r.before_state, after: r.after_state, reason: r.reason, actorUserId: r.actor_user_id, at: iso(r.created_at) })),
      pagination: { page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) } };
  }
}
