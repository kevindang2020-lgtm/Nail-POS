// ai-calls-center.ts — AI Calls & Voice Intelligence Management Center (guide, Oct 31 2026): `/pos/ai/calls-center/*`.
//
// One source of truth: the canonical call record (voice_call_outcomes) + its provider events (voice_call_events) + the tool
// ledger (voice_tool_executions) + the existing follow-ups / handoffs / transcripts / consent rows. Call history, scoped
// search, the salon-local window and the priority list REUSE ReceptionistCenter (guide 21) — no second call database.
//
// What this adds for the AI Calls page:
//   • summary strip — Total, Completed, Failed / Missed, AI-reported bookings vs bookings VERIFIED in Booking, Handoffs
//     requested vs connected, Unresolved, Avg duration, In progress, Stale — each with its rule; "—" (unknown) whenever
//     there is no evidence, never 0 dressed up as a fact
//   • enriched rows — agent, last sync, tool requests / failures, verified booking flag
//   • the call overlay — Overview · Customer · Summary/Transcript · Recording · Tool Activity · Booking · Handoff &
//     Follow-Ups · Audit / Errors. Opening a call is audited (it shows customer-linked data); the transcript stays a
//     manager-only link (audited by ReceptionistCenter); a recording is never linked — no recording reference is stored
//   • Check AI Calls System — read-only: entitlement + voice readiness (ReceptionistCenter.checks) plus the webhook / event
//     path, history & reconciliation, actions, recording & privacy and errors. Recorded per run; places no call, changes
//     no routing, sends nothing
//   • reconciliation — events with no call record, calls with no provider event, calls still "in progress" after 2 hours
//   • missed-call / unresolved assistant — ReceptionistCenter.priority with the evidence behind each item; suggestions only
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { recordAuditStrict } from '@aipowersalon/audit';
import { ReceptionistCenter, ReceptionistCenterError, maskPhone, isUuid, type RcCtx, type RcCheck, type RcState } from './receptionist-center';

type Row = Record<string, any>;
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const nowIso = () => new Date().toISOString();
const trace = () => `aic-${randomUUID().slice(0, 8)}`;
export const AIC_STALE_HOURS = 2;
const RANK: Record<RcState, number> = { FAILED: 6, UNKNOWN: 5, BLOCKED_EXTERNAL: 4, NOT_CONFIGURED: 3, WARNING: 2, DISABLED: 1, READY: 0 };

/** '+12155550101' → '•••-•••-0101' (A10: the caller without contact permission) */
const maskNumber = (v: string) => { const d = v.replace(/\D/g, ''); return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : '•••'; };

export class AiCallsCenter {
  constructor(private readonly db: Kysely<any>, private readonly rc: ReceptionistCenter, private readonly env: NodeJS.ProcessEnv = process.env) {}
  private branch(ctx: RcCtx): string | null { return isUuid(ctx.branchId) ? ctx.branchId : null; }
  private check(id: string, group: string, label: string, state: RcState, detail: string, evidence: string, remedy: string | null = null, impact: string | null = null, roleRequired: string | null = null): RcCheck {
    return { id, group, label, state, detail, evidence, impact, remedy, roleRequired, checkedAt: nowIso(), traceId: trace() };
  }

  // ── summary strip (guide §07 / §19) ─────────────────────────────────────────────────────────────────────────────────
  async kpis(ctx: RcCtx, f: { period?: string; from?: string; to?: string }) {
    const w = await this.rc.window(ctx, f); const b = this.branch(ctx); const T = ctx.tenantId;
    const inWin = (col: ReturnType<typeof sql>) => sql`${col} >= (${w.from}::date)::timestamp at time zone ${w.tz} and ${col} < ((${w.to}::date + 1))::timestamp at time zone ${w.tz}`;
    const r: Row = (await sql<Row>`select count(*)::int total,
        count(*) filter (where o.ended_at is not null and not o.abandoned and o.error_category is null)::int completed,
        count(*) filter (where o.error_category is not null)::int failed,
        count(*) filter (where o.abandoned)::int abandoned,
        count(*) filter (where o.ended_at is null and coalesce(o.started_at, o.created_at) > now() - make_interval(hours => ${AIC_STALE_HOURS}))::int in_progress,
        count(*) filter (where o.ended_at is null and coalesce(o.started_at, o.created_at) <= now() - make_interval(hours => ${AIC_STALE_HOURS}))::int stale,
        count(*) filter (where o.booking_outcome = 'booked')::int ai_booked,
        count(*) filter (where o.booking_outcome is not null and o.booking_outcome not in ('booked', 'none'))::int booking_requested,
        count(*) filter (where o.handoff_outcome is not null and o.handoff_outcome <> 'none')::int handoff_requested,
        count(*) filter (where o.handoff_outcome in ('transferred', 'completed', 'connected'))::int handoff_connected,
        count(*) filter (where o.follow_up_required and not exists (select 1 from ai_receptionist_follow_ups fu where fu.tenant_id = o.tenant_id
          and fu.provider_call_id = o.provider_call_id and fu.status in ('resolved', 'closed')))::int unresolved,
        avg(o.duration_seconds) filter (where o.duration_seconds > 0 and o.ended_at is not null) avg_dur,
        count(*) filter (where o.duration_seconds > 0 and o.ended_at is not null)::int dur_n,
        coalesce(sum(o.duration_seconds) filter (where o.duration_seconds > 0), 0)::int secs,
        max(coalesce(o.last_synced_at, o.updated_at)) last_sync
      from voice_call_outcomes o where o.tenant_id = ${T} and (${b}::uuid is null or o.branch_id = ${b}) and ${inWin(sql`coalesce(o.started_at, o.created_at)`)}`.execute(this.db)).rows[0];
    // a booking is "verified" only when Booking holds an AI appointment the call's tool ledger points at, still active
    const linksExist = !!(await sql<Row>`select 1 from voice_tool_executions where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and related_type = 'appointment' limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    const v: Row = !linksExist ? { n: null } : (await sql<Row>`select count(distinct a.id)::int n from voice_tool_executions x
        join pos_tech_appointments a on a.tenant_id = x.tenant_id and a.id::text = x.related_id
      where x.tenant_id = ${T} and (${b}::uuid is null or x.branch_id = ${b}) and x.related_type = 'appointment' and x.status = 'succeeded'
        and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show') and coalesce(a.phone_verification, 'verified') not in ('pending', 'sent', 'failed', 'expired')
        and ${inWin(sql`x.requested_at`)}`.execute(this.db).catch(() => ({ rows: [{ n: null }] }))).rows[0];
    const fu: Row = (await sql<Row>`select count(*)::int n from ai_receptionist_follow_ups where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and ${inWin(sql`created_at`)}`.execute(this.db)
      .catch(() => ({ rows: [{ n: null }] }))).rows[0];
    const total = N(r.total);
    return {
      window: w, lastSyncedAt: iso(r.last_sync),
      total, completed: N(r.completed), failed: N(r.failed), abandoned: N(r.abandoned), failedOrMissed: N(r.failed) + N(r.abandoned),
      inProgress: N(r.in_progress), stale: N(r.stale),
      bookings: { aiReported: N(r.ai_booked), requested: N(r.booking_requested), verified: v?.n == null ? null : N(v.n) },
      handoffs: { requested: N(r.handoff_requested), connected: N(r.handoff_connected) },
      followUpsCreated: fu?.n == null ? null : N(fu.n), unresolved: N(r.unresolved),
      avgDurationSeconds: N(r.dur_n) ? Math.round(Number(r.avg_dur)) : null, voiceMinutes: total ? Math.round(N(r.secs) / 6) / 10 : null,
      definitions: {
        total: 'Calls with a canonical record for this salon whose start (or first record) falls in the window, salon time. Each provider call id is counted once.',
        completed: 'Ended, not abandoned, no provider/tool error recorded.',
        failedOrMissed: 'A provider error was recorded, or the provider reported the caller hung up before the agent finished. Never inferred from a missing booking.',
        verifiedBookings: 'Appointments that Booking actually holds for this salon, linked to a call through a recorded tool result, not cancelled and not waiting for the six-digit code. "—" until the tool ledger has links.',
        aiReported: 'What the agent reported as "booked". Not proof — compare with Verified.',
        handoffs: 'Requested = the AI asked for a person. Connected = the provider reported the transfer connected.',
        unresolved: 'Calls the AI marked for follow-up that have no resolved follow-up yet.',
        stale: `Still "in progress" ${AIC_STALE_HOURS}+ hours after it started — the end event probably never arrived (shown as Unknown, not Completed).`,
      },
    };
  }

  // ── call history (reuses ReceptionistCenter.calls) + enrichment ────────────────────────────────────────────────────────
  async calls(ctx: RcCtx, f: Parameters<ReceptionistCenter['calls']>[1]) {
    const page = await this.rc.calls(ctx, f);
    const refs = page.items.map((i) => i.callRef);
    if (!refs.length) return page;
    const T = ctx.tenantId;
    const ex: Row[] = (await sql<Row>`select o.provider_call_id ref, o.agent_ref, coalesce(o.last_synced_at, o.updated_at) synced, o.ended_at, coalesce(o.started_at, o.created_at) st, o.caller_number, o.dialed_number,
        (select count(*)::int from voice_tool_executions x where x.tenant_id = o.tenant_id and x.provider_call_id = o.provider_call_id) tools,
        (select count(*)::int from voice_tool_executions x where x.tenant_id = o.tenant_id and x.provider_call_id = o.provider_call_id and x.status = 'failed') tool_failed,
        (select count(*)::int from voice_tool_executions x where x.tenant_id = o.tenant_id and x.provider_call_id = o.provider_call_id and x.related_type = 'appointment' and x.status = 'succeeded') appts
      from voice_call_outcomes o where o.tenant_id = ${T} and o.provider_call_id = any(${refs}::text[])`.execute(this.db)).rows;
    const by = new Map(ex.map((r) => [String(r.ref), r]));
    return {
      ...page,
      items: page.items.map((i) => {
        const e = by.get(i.callRef);
        const stale = !!e && !e.ended_at && Date.now() - new Date(e.st).getTime() > AIC_STALE_HOURS * 3_600_000;
        return { ...i, status: (stale && i.status === 'in_progress') || i.status === 'no_end_recorded' ? 'unknown' : i.status, agentRef: e?.agent_ref ?? null, lastSyncedAt: iso(e?.synced),
          tools: { requested: N(e?.tools), failed: N(e?.tool_failed) }, linkedAppointments: N(e?.appts),
          // A10: the salon number that was dialed (the caller is already shown, masked, from the call record)
          callerMasked: i.callerMasked ?? (e?.caller_number ? maskNumber(String(e.caller_number)) : null), dialedNumber: e?.dialed_number ?? null };
      }),
    };
  }

  // ── the call overlay (guide §12) ───────────────────────────────────────────────────────────────────────────────────────
  async detail(ctx: RcCtx, ref: string, canSeeTranscript: boolean) {
    const base = await this.rc.callDetail(ctx, ref, canSeeTranscript);
    const T = ctx.tenantId; const pc = base.call.callRef;
    await recordAuditStrict(this.db, { tenantId: T, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
      { module: 'ai_calls', action: 'ai_call.viewed', resourceType: 'voice_call', resourceId: String(base.call.id), summary: 'Opened an AI call record (customer-linked details) from AI Calls' });
    const o: Row = (await sql<Row>`select agent_ref, direction, disconnection_reason, last_event_at, coalesce(last_synced_at, updated_at) synced, created_at, ended_at, started_at
      from voice_call_outcomes where tenant_id = ${T} and provider_call_id = ${pc}`.execute(this.db)).rows[0] ?? {};
    const events: Row[] = (await sql<Row>`select event_type, occurred_at, received_at, last_received_at, deliveries, auth, disposition, failure_reason
      from voice_call_events where tenant_id = ${T} and provider_call_id = ${pc} order by coalesce(occurred_at, received_at) asc, received_at asc limit 100`.execute(this.db)).rows;
    const tools: Row[] = (await sql<Row>`select id, tool_name, tool_kind, status, business_result, related_type, related_id, error_category, requests, requested_at, finished_at
      from voice_tool_executions where tenant_id = ${T} and provider_call_id = ${pc} order by requested_at asc, id asc limit 200`.execute(this.db)).rows;
    const apptIds = tools.filter((t) => t.related_type === 'appointment' && t.related_id).map((t) => String(t.related_id));
    const linked: Row[] = apptIds.length ? (await sql<Row>`select id, appt_date::text appt_date, start_time::text start_time, status, phone_verification, customer_id
      from pos_tech_appointments where tenant_id = ${T} and id::text = any(${apptIds}::text[])`.execute(this.db)).rows : [];
    const consent: Row | undefined = (await sql<Row>`select consent_status, consent_method, recording_enabled, transcription_enabled, consent_at
      from call_consent_records where tenant_id = ${T} and provider_call_id = ${pc} limit 1`.execute(this.db)).rows[0];
    const stale = !o.ended_at && (o.started_at || o.created_at) && Date.now() - new Date(o.started_at ?? o.created_at).getTime() > AIC_STALE_HOURS * 3_600_000;
    return {
      ...base,
      overview: { agentRef: o.agent_ref ?? null, direction: o.direction ?? null, disconnectionReason: o.disconnection_reason ?? null, lastEventAt: iso(o.last_event_at), lastSyncedAt: iso(o.synced),
        eventAgeSeconds: o.last_event_at ? Math.max(0, Math.round((Date.now() - new Date(o.last_event_at).getTime()) / 1000)) : null,
        statusNote: stale ? `No end event arrived ${AIC_STALE_HOURS}+ hours after the call started — its status is Unknown, not Completed.` : null },
      events: events.map((e) => ({ type: e.event_type, occurredAt: iso(e.occurred_at), receivedAt: iso(e.received_at), lastReceivedAt: iso(e.last_received_at), deliveries: N(e.deliveries),
        auth: e.auth, disposition: e.disposition, failureReason: e.failure_reason ?? null })),
      toolActivity: tools.map((t) => ({ id: t.id, tool: t.tool_name, kind: t.tool_kind, status: t.status, businessResult: t.business_result ?? null, relatedType: t.related_type ?? null,
        relatedId: t.related_id ?? null, errorCategory: t.error_category ?? null, requests: N(t.requests), requestedAt: iso(t.requested_at), finishedAt: iso(t.finished_at) })),
      toolNote: tools.length ? 'Each row is a request the agent made and the result the system returned. A successful tool is not a confirmed booking — see Booking.'
        : 'No tool requests are recorded for this call (the ledger starts with this release; older calls show the agent-reported summary only).',
      booking: {
        aiReported: base.call.bookingOutcome ?? null,
        verified: linked.map((a) => ({ id: a.id, date: a.appt_date, startTime: String(a.start_time ?? '').slice(0, 5), status: a.status, verification: a.phone_verification ?? null,
          confirmed: !['cancelled', 'canceled', 'no_show'].includes(String(a.status)) && !['pending', 'sent', 'failed', 'expired'].includes(String(a.phone_verification ?? '')) })),
        note: linked.length ? null : base.call.bookingOutcome === 'booked' ? 'The agent reported "booked", but no appointment is linked to this call through a recorded tool result. Check Booking before telling the customer.' : null,
      },
      recording: {
        consent: consent ? { status: consent.consent_status, method: consent.consent_method ?? null, recordingEnabled: !!consent.recording_enabled, transcriptionEnabled: !!consent.transcription_enabled, at: iso(consent.consent_at) } : null,
        state: !consent ? 'consent_unknown' : !consent.recording_enabled || consent.consent_status === 'declined' ? 'not_permitted' : 'not_imported',
        note: !consent ? 'No consent record exists for this call, so no recording may be shown.'
          : !consent.recording_enabled || consent.consent_status === 'declined' ? 'Recording was not permitted for this call.'
          : 'A recording may exist at the voice provider, but AI PowerSalon does not import or link provider recordings. Nothing is guessed.',
      },
      customerPermissions: base.customer ? (await sql<Row>`select marketing_sms_opt_in sms, marketing_email_opt_in email from customers where tenant_id = ${T} and id = ${base.customer.id}`.execute(this.db)
        .then((x) => ({ smsMarketing: !!x.rows[0]?.sms, emailMarketing: !!x.rows[0]?.email }))) : null,
    };
  }

  // ── reconciliation (guide §14) ──────────────────────────────────────────────────────────────────────────────────────────
  async reconciliation(ctx: RcCtx) {
    const T = ctx.tenantId; const b = this.branch(ctx);
    const orphanEvents: Row[] = (await sql<Row>`select e.provider_call_id ref, min(e.received_at) first_at, count(*)::int n, string_agg(distinct coalesce(e.failure_reason, e.disposition), ', ') why
      from voice_call_events e where e.tenant_id = ${T} and (${b}::uuid is null or e.branch_id = ${b} or e.branch_id is null)
        and not exists (select 1 from voice_call_outcomes o where o.tenant_id = e.tenant_id and o.provider_call_id = e.provider_call_id)
      group by e.provider_call_id order by min(e.received_at) desc limit 50`.execute(this.db)).rows;
    const noEvents = N((await sql<Row>`select count(*)::int n from voice_call_outcomes o where o.tenant_id = ${T} and (${b}::uuid is null or o.branch_id = ${b})
        and o.created_at > now() - interval '30 days'
        and not exists (select 1 from voice_call_events e where e.tenant_id = o.tenant_id and e.provider_call_id = o.provider_call_id)`.execute(this.db)).rows[0]?.n);
    const stale: Row[] = (await sql<Row>`select provider_call_id ref, coalesce(started_at, created_at) st from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})
        and ended_at is null and coalesce(started_at, created_at) <= now() - make_interval(hours => ${AIC_STALE_HOURS}) order by coalesce(started_at, created_at) desc limit 50`.execute(this.db)).rows;
    return {
      eventsWithoutCall: orphanEvents.map((r) => ({ callRef: r.ref, firstReceivedAt: iso(r.first_at), events: N(r.n), reason: r.why ?? null })),
      callsWithoutProviderEvents30d: noEvents,
      staleInProgress: stale.map((r) => ({ callRef: r.ref, startedAt: iso(r.st) })),
      providerSideComparison: 'BLOCKED_EXTERNAL — listing the provider’s own call log needs an authorized Retell/Twilio API call, which this page never makes.',
      note: 'Read-only. Nothing is repaired automatically; an administrator decides.',
    };
  }

  // ── Check AI Calls System (guide §17 / §18A) — read-only, recorded ─────────────────────────────────────────────────────
  async checks(ctx: RcCtx): Promise<RcCheck[]> {
    const T = ctx.tenantId; const b = this.branch(ctx);
    // Nov 3 audit: if the receptionist checks fail, say so — dropping them let the overall result read READY
    let base: RcCheck[];
    try { base = await this.rc.checks(ctx); }
    catch (e) { base = [this.check('receptionist', 'Voice readiness', 'Receptionist readiness', 'UNKNOWN', 'The receptionist readiness checks could not run. Nothing was assumed.', `checks failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)]; }
    const out: RcCheck[] = base.map((c) => ({ ...c, group: c.group === 'Entitlements' ? 'Entitlement / permission' : 'Voice readiness' }));
    const key = !!String(this.env.RETELL_WEBHOOK_SIGNING_KEY ?? '').trim();
    try {
      const ev: Row = (await sql<Row>`select max(received_at) filter (where auth = 'provider_signature') last_signed, count(*) filter (where received_at > now() - interval '24 hours')::int n24,
          count(*) filter (where disposition = 'failed' and received_at > now() - interval '24 hours')::int failed24,
          coalesce(sum(deliveries - 1) filter (where received_at > now() - interval '24 hours'), 0)::int dup24
        from voice_call_events where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b} or branch_id is null)`.execute(this.db)).rows[0];
      const age = ev.last_signed ? (Date.now() - new Date(ev.last_signed).getTime()) / 3_600_000 : null;
      out.push(!key ? this.check('webhook_signing', 'Webhook / event path', 'Signed call events', 'NOT_CONFIGURED', 'The voice-event endpoint has no signing key, so every Retell call event is refused and no call history can arrive from the provider.', 'RETELL_WEBHOOK_SIGNING_KEY is not set (value never shown)', 'Platform operator sets the signing key and points the Retell agent’s webhook at /webhooks/voice/retell.', 'AI Calls stays empty except for agent-posted outcomes.', 'Platform operator')
        : ev.last_signed == null ? this.check('webhook_signing', 'Webhook / event path', 'Signed call events', 'WARNING', 'The signing key is set, but no signed call event has ever arrived for this salon.', 'voice_call_events: 0 provider-signed rows', 'Confirm the Retell agent’s webhook URL and that the agent id is linked to this salon (AI Receptionist).', 'New calls will not appear.', 'Owner / platform operator')
        : this.check('webhook_signing', 'Webhook / event path', 'Signed call events', age! > 72 ? 'WARNING' : 'READY', age! > 72 ? `The last signed event arrived ${Math.round(age!)} hours ago.` : 'Signed call events are arriving.', `last signed event ${iso(ev.last_signed)}`, age! > 72 ? 'If calls happened since then, check the webhook URL and agent link.' : null));
      out.push(this.check('event_failures', 'Webhook / event path', 'Event processing', N(ev.failed24) ? 'FAILED' : 'READY', N(ev.failed24) ? `${N(ev.failed24)} event(s) in 24 hours could not be applied.` : 'No failed events in the last 24 hours.',
        `24h: ${N(ev.n24)} events, ${N(ev.failed24)} failed, ${N(ev.dup24)} duplicate deliveries absorbed`, N(ev.failed24) ? 'Open Reconciliation; usually the agent is not linked to a branch.' : null));
    } catch (e) { out.push(this.check('webhook_signing', 'Webhook / event path', 'Signed call events', 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)); }
    try {
      const h: Row = (await sql<Row>`select count(*)::int n, max(coalesce(last_synced_at, updated_at)) last_write,
          count(*) filter (where ended_at is null and coalesce(started_at, created_at) <= now() - make_interval(hours => ${AIC_STALE_HOURS}))::int stale
        from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b})`.execute(this.db)).rows[0];
      const rec = await this.reconciliation(ctx);
      out.push(N(h.n) === 0 ? this.check('history', 'History / data', 'Call history', key ? 'WARNING' : 'NOT_CONFIGURED', 'No call records exist for this salon. That is honest only if no calls were answered by the AI.', 'voice_call_outcomes: 0 rows', 'Check the webhook and agent link above; then place an authorized test call (BLOCKED_EXTERNAL from here).')
        : this.check('history', 'History / data', 'Call history', N(h.stale) ? 'WARNING' : 'READY', N(h.stale) ? `${N(h.stale)} call(s) never received an end event.` : `${N(h.n)} call record(s); history is readable.`, `last write ${iso(h.last_write)}`, N(h.stale) ? 'Shown as Unknown; see Reconciliation.' : null));
      out.push(this.check('reconciliation', 'History / data', 'Reconciliation', rec.eventsWithoutCall.length ? 'WARNING' : 'READY',
        rec.eventsWithoutCall.length ? `${rec.eventsWithoutCall.length} provider call(s) have events but no call record.` : 'Every received event has a call record.',
        `${rec.callsWithoutProviderEvents30d} call record(s) in 30 days arrived only through the agent’s own outcome post; provider-side comparison is BLOCKED_EXTERNAL`, rec.eventsWithoutCall.length ? 'Open Reconciliation.' : null));
    } catch (e) { out.push(this.check('history', 'History / data', 'Call history', 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)); }
    try {
      const t: Row = (await sql<Row>`select count(*) filter (where status = 'failed')::int failed, count(*) filter (where status = 'refused')::int refused, count(*) filter (where status = 'requested' and requested_at < now() - interval '5 minutes')::int hanging, count(*)::int n
        from voice_tool_executions where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and requested_at > now() - interval '7 days'`.execute(this.db)).rows[0];
      const pendRow = (await sql<Row>`select count(*)::int n from booking_verification_sessions where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and channel = 'ai_receptionist' and status in ('pending', 'sent') and expires_at > now()`.execute(this.db)
        .catch(() => ({ rows: [] as Row[] }))).rows[0];
      const pend = pendRow ? String(N(pendRow.n)) : 'unknown';   // an unreadable count is "unknown", never 0
      out.push(this.check('actions', 'Actions', 'AI tool results', N(t.failed) || N(t.hanging) ? 'WARNING' : N(t.n) ? 'READY' : 'UNKNOWN',
        N(t.n) ? `${N(t.n)} tool request(s) in 7 days: ${N(t.failed)} failed, ${N(t.refused)} refused by policy, ${N(t.hanging)} never finished.` : 'No tool requests recorded in 7 days — tool behaviour cannot be judged yet.',
        `voice_tool_executions 7d; ${pend} AI booking(s) waiting for the six-digit code (never counted as confirmed)`, N(t.failed) ? 'Open a call with a failed tool and read its error category.' : null));
    } catch (e) { out.push(this.check('actions', 'Actions', 'AI tool results', 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)); }
    try {
      const c: Row = (await sql<Row>`select count(*)::int n, count(*) filter (where recording_enabled)::int rec from call_consent_records where tenant_id = ${T} and created_at > now() - interval '30 days'`.execute(this.db)).rows[0];
      out.push(this.check('recording', 'Recording / privacy', 'Recordings & transcripts', 'BLOCKED_EXTERNAL', 'Provider recordings are not imported or linked; transcripts open only for owners/managers and every view is audited.',
        `consent records 30d: ${N(c.n)} (${N(c.rec)} with recording permitted)`, 'Importing recordings needs an approved consent / retention policy and legal review.', null, 'Owner + legal'));
    } catch (e) { out.push(this.check('recording', 'Recording / privacy', 'Recordings & transcripts', 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)); }
    try {
      const er: Row = (await sql<Row>`select count(*)::int n from voice_call_outcomes where tenant_id = ${T} and (${b}::uuid is null or branch_id = ${b}) and error_category is not null and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0];
      out.push(this.check('errors', 'Errors', 'Provider errors', N(er.n) ? 'FAILED' : 'READY', N(er.n) ? `${N(er.n)} call(s) ended with a provider error in 24 hours.` : 'No provider errors in the last 24 hours.', 'voice_call_outcomes.error_category (24h)', N(er.n) ? 'Filter the history by Failed and open the calls.' : null));
    } catch (e) { out.push(this.check('errors', 'Errors', 'Provider errors', 'UNKNOWN', 'This could not be checked right now. Nothing was assumed.', `query failed (${(e as { code?: string })?.code ?? 'QUERY_FAILED'})`)); }
    return out;
  }

  async health(ctx: RcCtx) {
    const recent = (await sql<Row>`select created_at from ai_calls_health_runs where tenant_id = ${ctx.tenantId} and branch_id is not distinct from ${this.branch(ctx)} and created_at > now() - interval '30 seconds' order by created_at desc limit 1`.execute(this.db)).rows[0];
    if (recent) throw new ReceptionistCenterError('A check just ran. Wait a few seconds and try again.', 'AI_CALLS_CHECK_RATE_LIMITED', 429);
    const checks = await this.checks(ctx);
    const overall = checks.reduce<RcState>((a, c) => (RANK[c.state] > RANK[a] ? c.state : a), 'READY');
    const run: Row = (await sql<Row>`insert into ai_calls_health_runs (tenant_id, branch_id, overall, checks, run_by) values (${ctx.tenantId}, ${this.branch(ctx)}, ${overall}, ${JSON.stringify(checks)}::jsonb, ${ctx.userId})
      returning id, created_at`.execute(this.db)).rows[0];
    return { id: run.id, ranAt: iso(run.created_at), overall, checks, note: 'Read-only: no call was placed, no routing or provider setting was changed and nothing was sent.' };
  }

  async lastHealth(ctx: RcCtx) {
    const r: Row | undefined = (await sql<Row>`select id, overall, checks, created_at from ai_calls_health_runs where tenant_id = ${ctx.tenantId} and branch_id is not distinct from ${this.branch(ctx)} order by created_at desc limit 1`.execute(this.db)).rows[0];
    return r ? { id: r.id, ranAt: iso(r.created_at), overall: r.overall, checks: r.checks ?? [] } : null;
  }

  /** missed-call & unresolved assistant (§18C): the priority list + the evidence behind each item; suggestions only */
  async assistant(ctx: RcCtx, f: { page?: unknown; pageSize?: unknown }) {
    const p = await this.rc.priority(ctx, f);
    return { ...p, label: 'Suggestions ranked by urgency, then age. Nothing is sent, booked, rerouted or refunded from here — each action needs a person.' };
  }

  /** scoped search — the same server-side, masked search the AI Receptionist page uses */
  search(ctx: RcCtx, f: Parameters<ReceptionistCenter['search']>[1]) { return this.rc.search(ctx, f); }

  /** masked phone helper for callers of this module */
  static mask = maskPhone;
}
