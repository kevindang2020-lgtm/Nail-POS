// ai-handoff.ts — the ONE path from "the AI call needs a human" to ONE durable follow-up task (AI Follow-Ups guide §11).
//
//   signed Retell event (ai-calls-ingest) ─┐
//   agent handoff tool (gateway)         ─┴─► recordHandoff(): ai_handoff_events row (unique per source key + kind)
//                                              └─ callback required → ai_receptionist_follow_ups row keyed
//                                                 source_event_key = handoff:<call>:<CALLBACK|COMPLAINT> (unique per tenant,
//                                                 FOREVER — a retry after the task was resolved cannot re-create it)
//
// Rules (guide §03/§11): a "handoff requested" is not a "transfer completed"; a completed transfer creates NO task; a failed
// transfer, an explicit callback request or a complaint does. Customer linkage only when exactly ONE profile in this tenant
// has the caller's number; several → 'ambiguous' (never merged, never guessed); none → 'unmatched' (call context kept).
import { sql, type Kysely } from 'kysely';

type Row = Record<string, any>;
export type HandoffKind = 'handoff_requested' | 'transfer_attempted' | 'transfer_completed' | 'transfer_failed' | 'callback_requested' | 'complaint';
export interface HandoffSignal { kind: HandoffKind; callbackRequired: boolean; reason: 'CALLBACK' | 'COMPLAINT' | null; priority: 'normal' | 'high'; detail: string }

/** default time to first contact for an AI-created callback (owner-configurable later; documented as an open decision) */
export const DEFAULT_CALLBACK_DUE_MINUTES = 120;

const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes' || v === 1 || v === '1';

/** what a Retell lifecycle event says about a human handoff — conservative: only provider-reported facts and the salon's
 *  configured post-call analysis fields (custom_analysis_data.callback_requested / handoff_requested / complaint) */
export function handoffSignalsFromRetell(body: any): HandoffSignal[] {
  const type = String(body?.event ?? ''); const c = body?.call ?? {};
  const out: HandoffSignal[] = [];
  if (type === 'call_ended' || type === 'call_analyzed') {
    const dr = String(c.disconnection_reason ?? '');
    if (dr === 'call_transfer') out.push({ kind: 'transfer_completed', callbackRequired: false, reason: null, priority: 'normal', detail: 'The provider reported a connected transfer.' });
    else if (/transfer/.test(dr)) out.push({ kind: 'transfer_failed', callbackRequired: true, reason: 'CALLBACK', priority: 'high', detail: `The transfer did not connect (${dr.slice(0, 60)}).` });
  }
  if (type === 'call_analyzed') {
    const d = c.call_analysis?.custom_analysis_data ?? {};
    if (truthy(d.complaint)) out.push({ kind: 'complaint', callbackRequired: true, reason: 'COMPLAINT', priority: 'high', detail: 'The call analysis flagged a complaint.' });
    if (truthy(d.callback_requested) || truthy(d.handoff_requested) || truthy(d.human_requested)) out.push({ kind: 'callback_requested', callbackRequired: true, reason: 'CALLBACK', priority: 'normal', detail: 'The caller asked for a person to call back.' });
  }
  return out;
}

const E164 = /^\+[1-9]\d{7,14}$/;
export function normalizeCaller(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (E164.test(s)) return s;
  if (/^\d{10}$/.test(s)) return null;   // no country code → never guessed (NOTIFICATIONS: +country required)
  return null;
}

/** tenant-scoped customer match on the caller's number: one profile → linked; several → ambiguous; none → unmatched */
export async function matchCaller(db: Kysely<any>, tenantId: string, phone: string | null): Promise<{ customerId: string | null; match: 'phone_single' | 'ambiguous' | 'unmatched' }> {
  if (!phone) return { customerId: null, match: 'unmatched' };
  const rows: Row[] = (await sql<Row>`select id from customers where tenant_id = ${tenantId} and normalized_phone = ${phone} and archived_at is null limit 3`.execute(db)).rows;
  if (rows.length === 1) return { customerId: String(rows[0].id), match: 'phone_single' };
  return { customerId: null, match: rows.length > 1 ? 'ambiguous' : 'unmatched' };
}

export interface RecordHandoffInput {
  tenantId: string; branchId: string | null; providerCallId: string; source: 'retell_webhook' | 'gateway_handoff'; sourceKey: string;
  signal: HandoffSignal; callerPhone?: string | null; summary?: string | null; tz?: string | null;
}

/** idempotent: the event row is unique per (tenant, source key, kind); the task per (tenant, handoff:<call>:<reason>).
 *  Returns the task id (existing or new) when a callback is required. Runs inside the caller's transaction. */
export async function recordHandoff(trx: Kysely<any>, h: RecordHandoffInput): Promise<{ followUpId: string | null; created: boolean; eventCreated: boolean }> {
  const ev: Row | undefined = (await sql<Row>`insert into ai_handoff_events (tenant_id, branch_id, provider_call_id, source, source_key, kind, callback_required, reason)
      values (${h.tenantId}, ${h.branchId}, ${h.providerCallId}, ${h.source}, ${h.sourceKey}, ${h.signal.kind}, ${h.signal.callbackRequired}, ${h.signal.detail})
      on conflict (tenant_id, source_key, kind) do nothing returning id`.execute(trx)).rows[0];
  if (!h.signal.callbackRequired || !h.signal.reason) return { followUpId: null, created: false, eventCreated: !!ev };
  const key = `handoff:${h.providerCallId}:${h.signal.reason}`;
  const phone = normalizeCaller(h.callerPhone);
  const who = await matchCaller(trx, h.tenantId, phone);
  const due = new Date(Date.now() + DEFAULT_CALLBACK_DUE_MINUTES * 60_000).toISOString();
  const ins: Row | undefined = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, customer_id, caller_phone, provider_call_id, notes, description,
        source, source_event_key, due_at, due_tz, customer_match)
      values (${h.tenantId}, ${h.branchId}, ${h.signal.reason}, ${h.signal.priority}, ${who.customerId}, ${phone ?? (h.callerPhone ? String(h.callerPhone).slice(0, 32) : null)}, ${h.providerCallId},
        ${h.summary ? String(h.summary).slice(0, 500) : null}, ${h.signal.detail}, 'ai_receptionist', ${key}, ${due}, ${h.tz ?? null}, ${who.match})
      on conflict do nothing returning id`.execute(trx)).rows[0];
  let id = ins?.id ? String(ins.id) : null;
  if (!id) {
    const ex: Row | undefined = (await sql<Row>`select id from ai_receptionist_follow_ups where tenant_id = ${h.tenantId}
        and (source_event_key = ${key} or (provider_call_id = ${h.providerCallId} and reason = ${h.signal.reason} and status not in ('resolved','closed'))) order by created_at limit 1`.execute(trx)).rows[0];
    id = ex?.id ? String(ex.id) : null;
  } else {
    await sql`insert into ai_follow_up_activity (tenant_id, follow_up_id, actor_user_id, event_type, to_value, note, metadata)
      values (${h.tenantId}, ${id}, null, 'created', 'open', ${h.signal.detail}, ${JSON.stringify({ source: h.source, providerCallId: h.providerCallId, kind: h.signal.kind, customerMatch: who.match })}::jsonb)`.execute(trx);
  }
  if (id && ev?.id) await sql`update ai_handoff_events set follow_up_id = ${id} where id = ${ev.id}`.execute(trx);
  return { followUpId: id, created: !!ins?.id, eventCreated: !!ev };
}
