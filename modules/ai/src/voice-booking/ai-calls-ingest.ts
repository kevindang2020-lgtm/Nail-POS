// ai-calls-ingest.ts — AI Calls & Voice Intelligence guide (Oct 31 2026), §04 / §14 / §15.
//
// P0 root cause of the empty AI Calls page (guide §05, from code): no route received Retell's call lifecycle webhooks
// (call_started / call_ended / call_analyzed). voice_call_outcomes was written ONLY when the agent called the custom
// function POST /voice/calls/:id/outcome — so a salon whose agent never calls that function has no call history at all,
// however many calls the agent answered. This file is the missing path:
//
//   Retell event → POST /webhooks/voice/retell (signature over rawBody+timestamp, 5-minute replay window, constant-time)
//     → tenant/branch from the SALON's agent mapping (ai_receptionist_agents.provider_agent_id; ambiguous → refused)
//     → voice_call_events (one row per event key; a redelivery only bumps `deliveries`)
//     → merge into the canonical call record under a row lock: fills what is unknown, newer facts overwrite older ones,
//       a stale event never clears or rewinds a terminal fact (ended_at / started_at are kept once known)
//
// Tool ledger (§15): every /voice/tool request is written as `requested` BEFORE it runs, then its result (refused /
// succeeded / failed) and the verified business result (slot_held, slot_taken, no_availability …) separately. Nothing here
// is inferred from what the AI said. Raw payloads, phone numbers and transcripts are never stored — only a SHA-256.
import { sql, type Kysely } from 'kysely';
import { handoffSignalsFromRetell, recordHandoff } from './ai-handoff';
import { createHash } from 'node:crypto';
import { canMoveToSql, branchTimeZone } from '@aipowersalon/database';
import { VOICE_TOOL_EXECUTION } from '../ai-lifecycles';

type Row = Record<string, any>;
/** the tool ledger / event record must never break a live call: a failed write is LOGGED (category only) and the call goes on */
export function ledgerWarn(stage: string, e: unknown): null {
  console.warn(`[ai-calls] ledger ${stage} not recorded: ${(e as { code?: string })?.code ?? (e as Error)?.message ?? 'error'}`);
  return null;
}
export const VOICE_EVENT_TYPES = ['call_started', 'call_ended', 'call_analyzed'] as const;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ms = (v: unknown): string | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null; };
const txt = (v: unknown, max = 80): string | null => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

export interface IngestResult { accepted: boolean; duplicate?: boolean; disposition?: string; reason?: string; callRef?: string }

/** the facts a provider event carries, already sanitized (no numbers, no transcript) */
export interface CallFacts {
  startedAt?: string | null; endedAt?: string | null; durationSeconds?: number | null; direction?: string | null; agentRef?: string | null;
  disconnectionReason?: string | null; errorCategory?: string | null; handoffOutcome?: string | null; summary?: string | null; sentiment?: string | null;
}

/** Retell webhook body → event type, call id, occurred-at and sanitized facts (unknown fields ignored) */
export function parseRetellEvent(body: any): { type: typeof VOICE_EVENT_TYPES[number]; callId: string; agentId: string | null; occurredAt: string | null; facts: CallFacts } | null {
  const type = String(body?.event ?? '');
  const c = body?.call ?? {};
  const callId = txt(c.call_id, 128);
  if (!(VOICE_EVENT_TYPES as readonly string[]).includes(type) || !callId) return null;
  const facts: CallFacts = { agentRef: txt(c.agent_id, 128), direction: txt(c.direction, 16) };
  if (type === 'call_started') facts.startedAt = ms(c.start_timestamp);
  if (type === 'call_ended' || type === 'call_analyzed') {
    facts.startedAt = ms(c.start_timestamp); facts.endedAt = ms(c.end_timestamp);
    const d = Number(c.duration_ms); facts.durationSeconds = Number.isFinite(d) && d >= 0 ? Math.round(d / 1000)
      : facts.startedAt && facts.endedAt ? Math.max(0, Math.round((Date.parse(facts.endedAt) - Date.parse(facts.startedAt)) / 1000)) : null;
    const dr = txt(c.disconnection_reason, 60); facts.disconnectionReason = dr;
    if (dr && /^error|dial_failed|concurrency_limit|no_valid_payment/.test(dr)) facts.errorCategory = 'provider_error';
    if (dr === 'call_transfer') facts.handoffOutcome = 'transferred';   // a CONNECTED transfer is only what the provider reports
  }
  if (type === 'call_analyzed') {
    const a = c.call_analysis ?? {};
    facts.summary = txt(a.call_summary, 2000);
    const s = String(a.user_sentiment ?? '').toLowerCase(); facts.sentiment = ['positive', 'neutral', 'negative'].includes(s) ? s : null;
  }
  const occurredAt = type === 'call_started' ? facts.startedAt ?? null : facts.endedAt ?? facts.startedAt ?? null;
  return { type: type as typeof VOICE_EVENT_TYPES[number], callId, agentId: facts.agentRef ?? null, occurredAt, facts };
}

export class AiCallsIngest {
  constructor(private readonly db: Kysely<any>) {}

  /** the SALON a Retell agent belongs to — never from the payload's metadata; two salons claiming one agent → refused */
  async resolveAgent(agentId: string | null): Promise<{ tenantId: string; branchId: string | null } | { refused: string }> {
    if (!agentId) return { refused: 'agent_missing' };
    const rows: Row[] = (await sql<Row>`select distinct tenant_id, branch_id from ai_receptionist_agents
      where provider = 'retell' and provider_agent_id = ${agentId} and archived_at is null`.execute(this.db)).rows;
    const tenants = new Set(rows.map((r) => String(r.tenant_id)));
    if (tenants.size === 0) return { refused: 'agent_not_linked' };
    if (tenants.size > 1) return { refused: 'agent_ambiguous' };
    const branches = [...new Set(rows.map((r) => r.branch_id).filter(Boolean).map(String))];
    let branchId: string | null = branches.length === 1 ? branches[0] : null;
    if (!branchId && branches.length === 0) {
      const only: Row[] = (await sql<Row>`select id from branches where tenant_id = ${rows[0].tenant_id} limit 2`.execute(this.db)).rows;
      if (only.length === 1) branchId = String(only[0].id);
    }
    return { tenantId: String(rows[0].tenant_id), branchId };
  }

  /** a verified Retell lifecycle event (the caller has ALREADY checked the signature) */
  async applyRetellEvent(rawBody: string, body: any): Promise<IngestResult> {
    const ev = parseRetellEvent(body);
    if (!ev) return { accepted: false, reason: 'unrecognized_event' };
    const who = await this.resolveAgent(ev.agentId);
    if ('refused' in who) return { accepted: false, reason: who.refused };
    const key = String(body?.event_id ?? '').trim().slice(0, 200) || sha(`${ev.type}|${ev.callId}|${sha(rawBody)}`);
    // AI Follow-Ups guide §11: the same transaction records what the event says about a human handoff and, when a callback
    // is required, ONE durable follow-up (idempotent per call + reason — duplicates and late retries create nothing)
    const signals = handoffSignalsFromRetell(body);
    const caller = body?.call?.direction === 'outbound' ? body?.call?.to_number : body?.call?.from_number;
    const after = signals.length ? async (trx: Kysely<any>, branchId: string) => {
      const tz = await branchTimeZone(trx, who.tenantId, branchId).catch((e) => ledgerWarn('handoff.branch_tz', e));
      for (const signal of signals) await recordHandoff(trx, { tenantId: who.tenantId, branchId, providerCallId: ev.callId, source: 'retell_webhook', sourceKey: key, signal, callerPhone: caller ?? null, summary: ev.facts.summary ?? null, tz });
    } : undefined;
    // A10 (Nov 5 2026): who called / which salon number — first value wins on the canonical record
    const outbound = body?.call?.direction === 'outbound';
    const num = (v: unknown) => (typeof v === 'string' && /^\+?[0-9]{7,15}$/.test(v.trim()) ? v.trim() : null);
    const numbers = { caller: num(outbound ? body?.call?.to_number : body?.call?.from_number), dialed: num(outbound ? body?.call?.from_number : body?.call?.to_number) };
    return this.apply({ tenantId: who.tenantId, branchId: who.branchId, provider: 'retell', key, type: ev.type, callId: ev.callId, occurredAt: ev.occurredAt,
      payloadSha: sha(rawBody), auth: 'provider_signature', facts: ev.facts, after, numbers });
  }

  /** the agent's own POST /voice/calls/:id/outcome — recorded as an event too (authenticated by the integration key) */
  async recordOutcomePosted(t: { tenantId: string; branchId: string | null }, callId: string, rawBody: string): Promise<IngestResult> {
    return this.apply({ tenantId: t.tenantId, branchId: t.branchId, provider: 'retell', key: sha(`outcome_posted|${callId}|${sha(rawBody)}`), type: 'outcome_posted',
      callId, occurredAt: null, payloadSha: sha(rawBody), auth: 'integration_key', facts: null, alreadyMerged: true });
  }

  private async apply(e: { tenantId: string; branchId: string | null; provider: string; key: string; type: string; callId: string; occurredAt: string | null;
    payloadSha: string; auth: string; facts: CallFacts | null; alreadyMerged?: boolean; after?: (trx: Kysely<any>, branchId: string) => Promise<void>; numbers?: { caller: string | null; dialed: string | null } }): Promise<IngestResult> {
    return this.db.transaction().execute(async (trx) => {
      const ins: Row | undefined = (await sql<Row>`insert into voice_call_events (tenant_id, branch_id, provider, provider_event_key, event_type, provider_call_id, occurred_at,
          payload_sha256, auth, disposition, failure_reason)
        values (${e.tenantId}, ${e.branchId}, ${e.provider}, ${e.key}, ${e.type}, ${e.callId}, ${e.occurredAt}, ${e.payloadSha}, ${e.auth},
          ${e.branchId || e.alreadyMerged ? 'applied' : 'failed'}, ${e.branchId || e.alreadyMerged ? null : 'branch_unresolved'})
        on conflict (tenant_id, provider, provider_event_key) do update set deliveries = voice_call_events.deliveries + 1, last_received_at = now()
        returning id, disposition, (xmax = 0) inserted`.execute(trx)).rows[0];
      if (!ins?.inserted) return { accepted: true, duplicate: true, disposition: String(ins?.disposition ?? 'applied'), callRef: e.callId };
      if (e.alreadyMerged) {
        await sql`update voice_call_outcomes set last_synced_at = now() where tenant_id = ${e.tenantId} and provider_call_id = ${e.callId}`.execute(trx);
        return { accepted: true, disposition: 'applied', callRef: e.callId };
      }
      if (!e.branchId || !e.facts) return { accepted: true, disposition: 'failed', reason: 'branch_unresolved', callRef: e.callId };
      const disposition = await this.merge(trx, { tenantId: e.tenantId, branchId: e.branchId, provider: e.provider, callId: e.callId, occurredAt: e.occurredAt, facts: e.facts });
      if (disposition !== 'applied') await sql`update voice_call_events set disposition = ${disposition} where id = ${ins.id}`.execute(trx);
      if (e.numbers && (e.numbers.caller || e.numbers.dialed)) await sql`update voice_call_outcomes set caller_number = coalesce(caller_number, ${e.numbers.caller}), dialed_number = coalesce(dialed_number, ${e.numbers.dialed})
        where tenant_id = ${e.tenantId} and provider_call_id = ${e.callId}`.execute(trx);
      if (e.after) await e.after(trx, e.branchId);
      return { accepted: true, disposition, callRef: e.callId };
    });
  }

  /** out-of-order-safe merge into the canonical record (row lock). Returns 'applied' or 'stale_kept_newer'. */
  async merge(trx: Kysely<any>, m: { tenantId: string; branchId: string; provider: string; callId: string; occurredAt: string | null; facts: CallFacts }): Promise<'applied' | 'stale_kept_newer'> {
    await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id) values (${m.tenantId}, ${m.branchId}, ${m.provider}, ${m.callId})
      on conflict (tenant_id, provider_call_id) do nothing`.execute(trx);
    const cur: Row = (await sql<Row>`select id, last_event_at, started_at, ended_at, duration_seconds, direction, agent_ref, disconnection_reason, error_category, handoff_outcome, summary, sentiment
      from voice_call_outcomes where tenant_id = ${m.tenantId} and provider_call_id = ${m.callId} for update`.execute(trx)).rows[0];
    const last = cur.last_event_at ? new Date(cur.last_event_at).getTime() : null;
    const at = m.occurredAt ? Date.parse(m.occurredAt) : null;
    const newer = at == null || last == null || at >= last;
    const f = m.facts;
    const fills = (col: string, val: unknown) => val != null && cur[col] == null;
    const filled = fills('started_at', f.startedAt) || fills('ended_at', f.endedAt) || fills('duration_seconds', f.durationSeconds) || fills('direction', f.direction)
      || fills('agent_ref', f.agentRef) || fills('disconnection_reason', f.disconnectionReason) || fills('error_category', f.errorCategory)
      || fills('handoff_outcome', f.handoffOutcome) || fills('summary', f.summary) || fills('sentiment', f.sentiment);
    // first facts (start / end / direction / a reported transfer) are kept once known; the rest: newer overwrites, older only fills a gap
    await sql`update voice_call_outcomes set
        started_at = coalesce(started_at, ${f.startedAt ?? null}::timestamptz),
        ended_at = coalesce(ended_at, ${f.endedAt ?? null}::timestamptz),
        direction = coalesce(direction, ${f.direction ?? null}::text),
        handoff_outcome = coalesce(handoff_outcome, ${f.handoffOutcome ?? null}::text),
        duration_seconds = case when ${newer} then coalesce(${f.durationSeconds ?? null}::int, duration_seconds) else coalesce(duration_seconds, ${f.durationSeconds ?? null}::int) end,
        agent_ref = case when ${newer} then coalesce(${f.agentRef ?? null}::text, agent_ref) else coalesce(agent_ref, ${f.agentRef ?? null}::text) end,
        disconnection_reason = case when ${newer} then coalesce(${f.disconnectionReason ?? null}::text, disconnection_reason) else coalesce(disconnection_reason, ${f.disconnectionReason ?? null}::text) end,
        error_category = case when ${newer} then coalesce(${f.errorCategory ?? null}::text, error_category) else coalesce(error_category, ${f.errorCategory ?? null}::text) end,
        summary = case when ${newer} then coalesce(${f.summary ?? null}::text, summary) else coalesce(summary, ${f.summary ?? null}::text) end,
        sentiment = case when ${newer} then coalesce(${f.sentiment ?? null}::text, sentiment) else coalesce(sentiment, ${f.sentiment ?? null}::text) end,
        last_event_at = greatest(last_event_at, ${m.occurredAt}::timestamptz), last_synced_at = now(), updated_at = now()
      where id = ${cur.id}`.execute(trx);
    return newer || filled ? 'applied' : 'stale_kept_newer';
  }

  // ── tool ledger (§15) ──────────────────────────────────────────────────────────────────────────────────────────────
  /** write `requested` before the tool runs; a retried identical request is the same row (requests + 1) */
  async toolRequested(t: { tenantId: string; branchId: string }, callId: string, tool: string, kind: 'read' | 'write' | 'unknown', rawBody: string): Promise<{ id: string; repeat: boolean } | null> {
    const r: Row | undefined = (await sql<Row>`insert into voice_tool_executions (tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status)
      values (${t.tenantId}, ${t.branchId}, ${callId}, ${sha(rawBody)}, ${tool.slice(0, 60)}, ${kind}, 'requested')
      on conflict (tenant_id, provider_call_id, invocation_key) do update set requests = voice_tool_executions.requests + 1
      returning id, (xmax = 0) inserted`.execute(this.db)).rows[0];
    return r ? { id: String(r.id), repeat: !r.inserted } : null;
  }

  /** record the result. Only a `requested` row moves; a repeat of a finished request never rewrites its first result. */
  async toolFinished(tenantId: string, id: string, r: { status: 'refused' | 'succeeded' | 'failed'; businessResult?: string | null; relatedType?: string | null; relatedId?: string | null; errorCategory?: string | null }) {
    await sql`update voice_tool_executions set status = ${r.status}, business_result = ${r.businessResult ?? null}, related_type = ${r.relatedType ?? null},
        related_id = ${r.relatedId ?? null}, error_category = ${r.errorCategory ?? null}, finished_at = now()
      where tenant_id = ${tenantId} and id = ${id} and ${r.status === 'refused' ? canMoveToSql(VOICE_TOOL_EXECUTION, 'refused')
        : r.status === 'failed' ? canMoveToSql(VOICE_TOOL_EXECUTION, 'failed') : canMoveToSql(VOICE_TOOL_EXECUTION, 'succeeded')}`.execute(this.db);
  }
}

/** classify a dispatched tool result into the ledger's terms — never "booked" from a tool reply */
export function toolOutcome(name: string, result: { data?: any; error?: string | null }): { status: 'refused' | 'succeeded' | 'failed'; businessResult: string | null; relatedType?: string; relatedId?: string; errorCategory?: string } {
  const err = result?.error ? String(result.error) : '';
  const d = result?.data;
  if (/isn.?t available/i.test(err)) return { status: 'refused', businessResult: 'refused_by_policy', errorCategory: 'write_tools_off_or_tool_disabled' };
  if (name === 'hold_slot') {
    if (d?.held === true) return { status: 'succeeded', businessResult: 'slot_held', relatedType: 'slot_hold', relatedId: d.holdId ? String(d.holdId) : undefined };
    if (d?.slotUnavailable) return { status: 'succeeded', businessResult: 'slot_taken' };
  }
  if (err) return { status: 'failed', businessResult: null, errorCategory: /required|pick one/i.test(err) ? 'missing_or_invalid_input' : /unknown tool/i.test(err) ? 'unknown_tool' : 'tool_error' };
  if (name === 'get_availability') {
    const opts = Array.isArray(d) ? d : Array.isArray(d?.options) ? d.options : [];
    if (d?.hold?.holdId) return { status: 'succeeded', businessResult: 'slot_held', relatedType: 'slot_hold', relatedId: String(d.hold.holdId) };
    return { status: 'succeeded', businessResult: opts.length ? 'availability_returned' : 'no_availability' };
  }
  if (name === 'release_hold') return { status: 'succeeded', businessResult: Number(d?.released) > 0 ? 'hold_released' : 'nothing_to_release' };
  if (name === 'get_business_info') return { status: 'succeeded', businessResult: 'info_returned' };
  return { status: 'succeeded', businessResult: 'data_returned' };
}
