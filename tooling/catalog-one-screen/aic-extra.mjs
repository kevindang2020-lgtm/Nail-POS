// aic-extra.mjs — AI Center → AI Calls in the catalog harness (AI Calls guide, Oct 31 2026, migration 755).
// The REAL AiCallsCenterController → AiCallsCenter (+ ReceptionistCenter) → SQL on the seeded TEST database, and the REAL
// AiCallsIngest: seed=1 drives the calls in through the same provider-event merge production uses (call_started /
// call_ended / call_analyzed, including a duplicate delivery and an out-of-order end), plus tool-ledger rows.
// Tooling only — never shipped. Nothing leaves the machine: no call, no provider contact, no text.
// Harness stubs, stated plainly: the AI-package entitlement uses an "allowed" stub (the Kysely access repo needs the query
// builder the stand-in lacks); the env is a harness object (`env=none` = no signing key; `env=signed` = a signing key is
// configured — its value is never shown).
// Controls (GET /__aic?…): reset=1 · env=none|signed · seed=1 · state=1 (DB truth by INDEPENDENT SQL).
import { ReceptionistCenter } from '../../modules/ai/src/voice-booking/receptionist-center.ts';
import { AiCallsCenter } from '../../modules/ai/src/voice-booking/ai-calls-center.ts';
import { AiCallsIngest } from '../../modules/ai/src/voice-booking/ai-calls-ingest.ts';
import { AiCallsCenterController } from '../../modules/ai/src/voice-booking/ai-calls-center.controller.ts';

const ALLOWED = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) };
const AGENT = 'agent_harness_aic';

export function aicExtra(db, pg) {
  const env = {};
  const rc = new ReceptionistCenter(db, ALLOWED, null, env);
  const ac = new AiCallsCenter(db, rc, env);
  const ingest = new AiCallsIngest(db);
  const ctl = new AiCallsCenterController(ac);
  const q = (s, p = []) => pg.query(s, p);
  const send = (b) => { const raw = JSON.stringify(b); return ingest.applyRetellEvent(raw, JSON.parse(raw)); };
  return {
    routes: (routesOf) => routesOf('modules/ai/src/voice-booking/ai-calls-center.controller.ts', '/pos/ai/calls-center', ctl),
    async control(sp, T, B) {
      if (sp.get('env')) { delete env.RETELL_WEBHOOK_SIGNING_KEY; if (sp.get('env') === 'signed') env.RETELL_WEBHOOK_SIGNING_KEY = 'harness-signing-key'; return { env: sp.get('env') }; }
      if (sp.get('reset')) {
        for (const t of ['voice_call_events', 'voice_tool_executions', 'ai_calls_health_runs', 'call_consent_records']) await q(`delete from ${t} where tenant_id = $1`, [T]);
        await q(`delete from call_transcripts where tenant_id = $1 and provider_call_id like 'aic_%'`, [T]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and customer_name = 'AIC Harness Booking'`, [T]);
        await q(`delete from voice_call_outcomes where tenant_id = $1`, [T]);
        await q(`delete from ai_receptionist_agents where tenant_id = $1 and provider_agent_id = $2`, [T, AGENT]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        // one LIVE agent per salon route (migration 756): an earlier section's live agent on this route is replaced (moved to ready)
        await q(`update ai_receptionist_agents set status = 'ready' where tenant_id = $1 and status = 'live' and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`, [T, B]);
        await q(`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values ($1, $2, 'AI Front Desk', 'live', 'retell', $3)`, [T, B, AGENT]);
        const now = Date.now();
        for (let i = 0; i < 24; i++) {
          const st = now - (i + 1) * 2 * 3600_000; const ref = `aic_${String(i).padStart(2, '0')}`;
          const call = { call_id: ref, agent_id: AGENT, direction: 'inbound', start_timestamp: st, end_timestamp: st + (60 + i * 5) * 1000, duration_ms: (60 + i * 5) * 1000,
            disconnection_reason: i === 4 ? 'error_llm_websocket_open' : i === 6 ? 'call_transfer' : 'agent_hangup',
            call_analysis: { call_summary: i === 9 ? 'Caller asked about gel removal pricing' : `Harness call ${i}`, user_sentiment: 'Neutral' } };
          if (i === 3) { await send({ event: 'call_ended', call }); await send({ event: 'call_started', call: { ...call, end_timestamp: undefined } }); }   // out of order
          else { await send({ event: 'call_started', call }); await send({ event: 'call_ended', call }); }
          if (i === 2) await send({ event: 'call_ended', call });   // a duplicate delivery
          await send({ event: 'call_analyzed', call });
        }
        // the agent's own outcome posts (booked claims) — one later proven by Booking, one not
        await q(`update voice_call_outcomes set booking_outcome = 'booked', intents = '["booking"]'::jsonb where tenant_id = $1 and provider_call_id in ('aic_01', 'aic_05')`, [T]);
        // no end event 3 hours later → Unknown / stale
        await send({ event: 'call_started', call: { call_id: 'aic_stale', agent_id: AGENT, direction: 'inbound', start_timestamp: now - 3 * 3600_000 } });
        // tool ledger: aic_01 → appointment Booking holds; aic_05 → the tool failed (slot taken)
        const tech = (await q(`select id from technicians where tenant_id = $1 order by created_at limit 1`, [T])).rows[0];
        const cust = (await q(`select id from customers where tenant_id = $1 order by created_at limit 1`, [T])).rows[0];
        if (tech) {
          const a = (await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, source, status)
            values ($1, $2, $3, $4, 'AIC Harness Booking', current_date + 3, '10:00', '11:00', 'ai', 'booked') returning id`, [T, B, tech.id, cust?.id ?? null])).rows[0];
          const r1 = await ingest.toolRequested({ tenantId: T, branchId: B }, 'aic_01', 'create_appointment', 'write', '{"h":1}');
          await ingest.toolFinished(T, r1.id, { status: 'succeeded', businessResult: 'appointment_created', relatedType: 'appointment', relatedId: String(a.id) });
        }
        const r2 = await ingest.toolRequested({ tenantId: T, branchId: B }, 'aic_05', 'create_appointment', 'write', '{"h":2}');
        await ingest.toolFinished(T, r2.id, { status: 'failed', businessResult: 'slot_taken', errorCategory: 'SLOT_UNAVAILABLE' });
        const r3 = await ingest.toolRequested({ tenantId: T, branchId: B }, 'aic_05', 'get_availability', 'read', '{"h":3}');
        await ingest.toolFinished(T, r3.id, { status: 'succeeded', businessResult: 'availability_returned' });
        await q(`insert into call_transcripts (tenant_id, branch_id, provider, provider_call_id, status) values ($1, $2, 'retell', 'aic_09', 'completed')`, [T, B]);
        // an event whose branch could not be resolved — Reconciliation must list it
        await q(`insert into voice_call_events (tenant_id, branch_id, provider, provider_event_key, event_type, provider_call_id, payload_sha256, auth, disposition, failure_reason)
          values ($1, null, 'retell', 'aic-orphan-1', 'call_started', 'aic_orphan', 'x', 'provider_signature', 'failed', 'branch_unresolved')`, [T]);
        return { seeded: true };
      }
      if (sp.get('state')) {
        // independent of AiCallsCenter: the rules written out here (salon-local month by call start)
        const m = `coalesce(started_at, created_at) >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'`;
        return (await q(`select
            (select count(*) from voice_call_outcomes where tenant_id = $1 and ${m})::int as total,
            (select count(*) from voice_call_outcomes where tenant_id = $1 and ${m} and ended_at is not null and not abandoned and error_category is null)::int as completed,
            (select count(*) from voice_call_outcomes where tenant_id = $1 and ${m} and (error_category is not null or abandoned))::int as failed_missed,
            (select count(*) from voice_call_events where tenant_id = $1 and provider_call_id = 'aic_02' and event_type = 'call_ended')::int as dup_rows,
            (select max(deliveries) from voice_call_events where tenant_id = $1 and provider_call_id = 'aic_02' and event_type = 'call_ended')::int as dup_deliveries,
            (select count(*) from voice_call_outcomes where tenant_id = $1 and provider_call_id = 'aic_03' and ended_at is not null and started_at is not null)::int as ooo_ok,
            (select count(*) from audit_events where tenant_id = $1 and action = 'ai_call.viewed')::int as views,
            (select count(*) from ai_calls_health_runs where tenant_id = $1)::int as health_runs,
            (select max(updated_at)::text from voice_call_outcomes where tenant_id = $1) as last_write`, [T])).rows[0];
      }
      return { ok: true };
    },
  };
}
