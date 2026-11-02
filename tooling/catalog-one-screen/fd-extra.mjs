// fd-extra.mjs — AI Center → AI Front Desk in the catalog harness (AI Front Desk guide, Oct 31 2026, migration 756).
// The REAL FrontDeskCenterController → FrontDeskCenter (+ the REAL ReceptionistCenter / BusinessSetupCenter it reuses) → SQL
// on the seeded TEST database. Tooling only — never shipped. Nothing leaves the machine: no call, no provider, no text.
// Harness stubs, stated plainly: the AI-package entitlement is an "allowed" stub (the Kysely access repo needs the query
// builder the stand-in lacks) and the provider env is a harness object (Retell key present, platform booking switch on).
// Controls (GET /__fd?…): reset=1 · bulk=1 (23 draft agents) · gates=1 (salon Twilio row checked, integration key, a
// provider-linked READY agent "Desk Retell" + a recorded call it answered, verified as the salon's test call) · state=1.
import { ReceptionistCenter } from '../../modules/ai/src/voice-booking/receptionist-center.ts';
import { BusinessSetupCenter } from '../../modules/ai/src/voice-booking/business-setup-center.ts';
import { FrontDeskCenter } from '../../modules/ai/src/voice-booking/front-desk-center.ts';
import { FrontDeskCenterController } from '../../modules/ai/src/voice-booking/front-desk-center.controller.ts';

const ALLOWED = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) };

export function fdExtra(db, pg) {
  const env = { TWILIO_ACCOUNT_SID: 'ACplatformharness', TWILIO_AUTH_TOKEN: 'harness', RETELL_API_KEY: 'harness-not-a-key', VOICE_WRITE_TOOLS_ENABLED: 'true' };
  const bs = new BusinessSetupCenter(db);
  const rc = new ReceptionistCenter(db, ALLOWED, bs, env);
  const fd = new FrontDeskCenter(db, rc, bs);
  const ctl = new FrontDeskCenterController(fd);
  const q = (s, p = []) => pg.query(s, p);
  let savedCreds = null;
  return {
    routes: (routesOf) => routesOf('modules/ai/src/voice-booking/front-desk-center.controller.ts', '/pos/ai/front-desk', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`set session_replication_role = replica`);   // agent + control events are append-only by trigger — harness reset only
        try {
          await q(`delete from ai_receptionist_agent_events where tenant_id = $1`, [T]);
          await q(`delete from ai_receptionist_control_events where tenant_id = $1`, [T]);
        } finally { await q(`set session_replication_role = origin`); }
        for (const t of ['ai_receptionist_control', 'ai_receptionist_health_runs', 'ai_receptionist_agent_versions', 'ai_receptionist_agents', 'voice_integration_keys'])
          await q(`delete from ${t} where tenant_id = $1`, [T]);
        await q(`delete from voice_call_outcomes where tenant_id = $1 and provider_call_id like 'fd_%'`, [T]);
        if (savedCreds) { for (const r of savedCreds) await q(`update tenant_messaging_credentials set last_validated_at = $2, last_validation_error = $3 where id = $1`, [r.id, r.last_validated_at, r.last_validation_error]); savedCreds = null; }
        return { reset: true };
      }
      if (sp.get('bulk')) {
        for (let i = 0; i < 23; i++) await q(`insert into ai_receptionist_agents (tenant_id, branch_id, name, description, status, created_at) values ($1, $2, $3, $4, 'draft', now() - make_interval(hours => $5))`,
          [T, B, `Bulk Desk ${String(i).padStart(2, '0')}`, i === 17 ? 'Spanish-speaking evening line (draft idea)' : 'Draft', i + 2]);
        return { bulk: 23 };
      }
      if (sp.get('gates')) {
        savedCreds = savedCreds ?? (await q(`select id, last_validated_at, last_validation_error from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio'`, [T])).rows;
        await q(`update tenant_messaging_credentials set last_validated_at = now(), last_validation_error = null where tenant_id = $1 and provider = 'twilio'`, [T]);
        await q(`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values ($1, $2, 'Retell tools', 'retell', 'vk_fdh', 'not-a-secret')`, [T, B]);
        const a = (await q(`insert into ai_receptionist_agents (tenant_id, branch_id, name, description, status, provider, provider_agent_id, handoff_destination, booking_mode, config_version, wizard_step, wizard_state, created_by_user_id)
          values ($1, $2, 'Desk Retell', 'Main line, linked to its voice agent', 'ready', 'retell', 'agent_fd_harness_desk', 'front_desk', 'handoff_only', 1, 8, '{"steps":{"1":true,"2":true,"3":true,"4":true},"complete":true}'::jsonb, null) returning id`, [T, B])).rows[0];
        for (let i = 0; i < 4; i++) {
          const at = new Date(Date.now() - (i + 1) * 40 * 60_000).toISOString();
          await q(`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds, intents, booking_outcome, handoff_outcome, abandoned, follow_up_required, agent_ref, error_category, created_at)
            values ($1, $2, 'retell', $3, $4, $4, $5, '["booking"]'::jsonb, $6, $7, false, false, 'agent_fd_harness_desk', $8, $4)`, [T, B, `fd_call_${i}`, at, 60 + i * 15, i === 1 ? 'booked' : null, i === 2 ? 'transferred' : null, i === 3 ? 'tool_timeout' : null]);
        }
        const c = (await q(`select version from ai_receptionist_control where tenant_id = $1 and branch_id = $2`, [T, B])).rows[0];
        await rc.controlAction({ tenantId: T, branchId: B, userId: '00000000-0000-4000-8000-00000000f0d1', role: 'OWNER', permissions: ['ai.use', 'ai.manage'] },
          { action: 'verify_test_call', expectedVersion: Number(c?.version ?? 0), reason: 'harness: owner placed the authorized test call', providerCallRef: 'fd_call_0', idempotencyKey: 'fd-harness-verify-' + Date.now() });
        return { gates: true, agentId: a.id };
      }
      if (sp.get('state')) {
        // independent of FrontDeskCenter: plain SQL truth
        return (await q(`select
            (select count(*) from ai_receptionist_agents where tenant_id = $1)::int as agents,
            (select count(*) from ai_receptionist_agents where tenant_id = $1 and provider_agent_id is not null)::int as linked,
            (select json_agg(json_build_object('name', name, 'status', status, 'version', config_version) order by created_at desc) from (select * from ai_receptionist_agents where tenant_id = $1 order by created_at desc limit 3) x) as newest,
            (select count(*) from ai_receptionist_agents where tenant_id = $1 and status = 'live')::int as live,
            (select row_to_json(c) from (select activated, booking_armed, version from ai_receptionist_control where tenant_id = $1 limit 1) c) as control,
            (select count(*) from ai_receptionist_agent_events where tenant_id = $1)::int as events,
            (select count(*) from ai_receptionist_health_runs where tenant_id = $1 and scope in ('front_desk', 'agent'))::int as runs`, [T])).rows[0];
      }
      return { ok: true };
    },
  };
}
