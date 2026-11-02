// rcp-extra.mjs — AI Center → AI Receptionist in the catalog harness (AI Receptionist guide, Oct 31 2026, migration 754).
// The REAL ReceptionistCenterController → ReceptionistCenter → SQL on the seeded TEST database. Tooling only — never shipped.
// Nothing leaves the machine: no call is placed, no provider is contacted, no text is sent.
// Harness stubs, stated plainly: the AI-package entitlement uses an "allowed" stub (the Kysely access repo needs the query
// builder the stand-in lacks), and the provider env is a harness object (`env=none` = only the PLATFORM's Twilio env, the
// photographed situation; `env=full` = a saved Retell key + the platform booking switch on). Business Setup readiness is the
// REAL BusinessSetupCenter (guide 20).
// Controls (GET /__rcp?…): reset=1 · env=none|full · seed=1 (marks the pilot's own Twilio row checked, agent, key, 25 recorded calls, a missed
// call, a person-requested handoff, a booking waiting for its code, a transcript) · state=1 (DB truth by INDEPENDENT SQL).
import { ReceptionistCenter } from '../../modules/ai/src/voice-booking/receptionist-center.ts';
import { ReceptionistCenterController } from '../../modules/ai/src/voice-booking/receptionist-center.controller.ts';
import { BusinessSetupCenter } from '../../modules/ai/src/voice-booking/business-setup-center.ts';

const ALLOWED = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) };

export function rcpExtra(db, pg) {
  const env = { TWILIO_ACCOUNT_SID: 'ACplatformharness', TWILIO_AUTH_TOKEN: 'harness' };
  const rc = new ReceptionistCenter(db, ALLOWED, new BusinessSetupCenter(db), env);
  const ctl = new ReceptionistCenterController(rc);
  const q = (s, p = []) => pg.query(s, p);
  let savedCreds = null;   // the pilot's own Twilio row is validated by seed=1 and restored by reset=1
  return {
    routes: (routesOf) => routesOf('modules/ai/src/voice-booking/receptionist-center.controller.ts', '/pos/ai/receptionist-center', ctl),
    async control(sp, T, B) {
      if (sp.get('env')) {
        for (const k of ['RETELL_API_KEY', 'VOICE_WRITE_TOOLS_ENABLED']) delete env[k];
        if (sp.get('env') === 'full') Object.assign(env, { RETELL_API_KEY: 'harness-not-a-key', VOICE_WRITE_TOOLS_ENABLED: 'true' });
        return { env: sp.get('env') };
      }
      if (sp.get('reset')) {
        await q(`set session_replication_role = replica`);   // control events are append-only by trigger — the harness reset only
        try { await q(`delete from ai_receptionist_control_events where tenant_id = $1`, [T]); } finally { await q(`set session_replication_role = origin`); }
        for (const t of ['ai_receptionist_control', 'ai_receptionist_health_runs', 'ai_receptionist_actions', 'call_transcripts', 'voice_call_outcomes', 'ai_receptionist_handoffs', 'voice_integration_keys', 'ai_receptionist_agents'])
          await q(`delete from ${t} where tenant_id = $1`, [T]);
        await q(`delete from ai_receptionist_follow_ups where tenant_id = $1 and (source = 'ai_receptionist' or notes like 'From the AI Receptionist priority list%')`, [T]);
        await q(`delete from booking_verification_sessions where tenant_id = $1 and channel = 'ai_receptionist'`, [T]);
        if (savedCreds) { for (const r of savedCreds) await q(`update tenant_messaging_credentials set last_validated_at = $2, last_validation_error = $3 where id = $1`, [r.id, r.last_validated_at, r.last_validation_error]); savedCreds = null; }
        return { reset: true };
      }
      if (sp.get('seed')) {
        const cust = (await q(`select id, normalized_phone from customers where tenant_id = $1 and normalized_phone is not null order by created_at limit 1`, [T])).rows[0];
        // the pilot salon already has its own Twilio row (comms harness), saved but never checked — mark it checked for this section
        savedCreds = savedCreds ?? (await q(`select id, last_validated_at, last_validation_error from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio'`, [T])).rows;
        await q(`update tenant_messaging_credentials set last_validated_at = now(), last_validation_error = null where tenant_id = $1 and provider = 'twilio'`, [T]);
        // one LIVE agent per salon route (migration 756): an earlier section's live agent on this route is replaced (moved to ready)
        await q(`update ai_receptionist_agents set status = 'ready' where tenant_id = $1 and status = 'live' and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`, [T, B]);
        await q(`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values ($1, $2, 'AI Front Desk', 'live', 'retell', 'agent_harness_pilot')`, [T, B]);
        await q(`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values ($1, $2, 'Retell tools', 'retell', 'vk_harn', 'not-a-secret')`, [T, B]);
        const now = Date.now();
        for (let i = 0; i < 25; i++) {
          const at = new Date(now - (i + 1) * 3 * 3600_000);
          await q(`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds, intents, booking_outcome, handoff_outcome, abandoned, follow_up_required, summary, created_at)
            values ($1, $2, 'retell', $3, $4, $5, $6, $7::jsonb, $8, $9, false, false, $10, $4)`,
            [T, B, `call_h_${String(i).padStart(2, '0')}`, at.toISOString(), new Date(at.getTime() + (60 + i * 7) * 1000).toISOString(), 60 + i * 7, JSON.stringify(['booking']),
              i % 3 === 0 ? 'booked' : i % 3 === 1 ? 'pending_verification' : null, i % 5 === 0 ? 'transferred' : 'none', i === 20 ? 'Caller asked about gel removal pricing' : null]);
        }
        await q(`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, provider_call_id, caller_phone, customer_id, source) values ($1, $2, 'CALLBACK', 'call_h_20', $3, $4, 'ai_receptionist')`, [T, B, cust?.normalized_phone ?? '+16095550142', cust?.id ?? null]);
        await q(`insert into call_transcripts (tenant_id, branch_id, provider, provider_call_id, status) values ($1, $2, 'retell', 'call_h_20', 'completed')`, [T, B]);
        await q(`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, abandoned, created_at) values ($1, $2, 'retell', 'missed_older', now() - interval '2 days', true, now() - interval '2 days'), ($1, $2, 'retell', 'missed_newer', now() - interval '1 hour', true, now() - interval '1 hour')`, [T, B]);
        await q(`insert into ai_receptionist_handoffs (tenant_id, branch_id, reason, status, requested_at) values ($1, $2, 'Caller asked for the manager', 'requested', now() - interval '3 hours')`, [T, B]);
        await q(`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, channel, provider, status, phone_hash, phone_mask, expires_at) values ($1, $2, gen_random_uuid(), 'ai_receptionist', 'twilio_verify', 'pending', 'h', '•••• 0142', now() + interval '8 minutes')`, [T, B]);
        return { seeded: true };
      }
      if (sp.get('state')) {
        // independent of ReceptionistCenter: the KPI rule written out here (calls by call start, salon-local month)
        const r = (await q(`select
            (select count(*) from voice_call_outcomes where tenant_id = $1 and coalesce(started_at, created_at) >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York')::int as calls_month,
            (select count(*) from voice_call_outcomes where tenant_id = $1 and booking_outcome = 'booked' and coalesce(started_at, created_at) >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York')::int as booked_month,
            (select count(*) from voice_call_outcomes where tenant_id = $1)::int as calls_all,
            (select count(*) from ai_receptionist_follow_ups where tenant_id = $1 and provider_call_id = 'missed_older')::int as fu_missed_older,
            (select count(*) from ai_receptionist_control_events where tenant_id = $1)::int as control_events,
            (select row_to_json(c) from (select booking_armed, test_call_provider_call_id, activated, version from ai_receptionist_control where tenant_id = $1 limit 1) c) as control,
            (select count(*) from ai_receptionist_health_runs where tenant_id = $1)::int as health_runs`, [T])).rows[0];
        return r;
      }
      return { ok: true };
    },
  };
}
