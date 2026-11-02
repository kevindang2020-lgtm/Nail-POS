// fu-extra.mjs — AI Center → AI Follow-Ups & Human Handoff Center in the catalog harness (AI Follow-Ups guide, Oct 31 2026,
// migration 759). The REAL AiFollowUpCenterController → AiFollowUpCenter → SQL on the seeded TEST database; texts go through
// the REAL ReceptionCopilotCenter (rcc-extra.mjs) and its test sender; the AI handoff is a REAL AiCallsIngest.applyRetellEvent
// (the signature check is the public controller's job and is covered by the AI Calls pgtest). Tooling only — never shipped.
// Controls (GET /__fu?…): reset=1 · seed=1 (one AI failed-transfer handoff + 26 staff tasks across every status, one urgent
// overdue) · state=1 (plain SQL truth for this branch).
import { randomUUID } from 'node:crypto';
import { AiFollowUpCenter } from '../../modules/ai/src/ai-center/ai-follow-up-center.ts';
import { AiFollowUpCenterController } from '../../modules/ai/src/ai-center/ai-follow-up-center.controller.ts';
import { AiCallsIngest } from '../../modules/ai/src/voice-booking/ai-calls-ingest.ts';

export function fuExtra(db, pg, copilotCenter) {
  const q = (s, p = []) => pg.query(s, p);
  const ctl = new AiFollowUpCenterController(new AiFollowUpCenter(db, copilotCenter ?? null));
  const ingest = new AiCallsIngest(db);
  return {
    routes: (routesOf) => routesOf('modules/ai/src/ai-center/ai-follow-up-center.controller.ts', '/pos/ai/follow-ups-center', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        const ids = (await q(`select id from ai_receptionist_follow_ups where tenant_id = $1 and (description like 'FUX %' or provider_call_id like 'fux_%' or caller_phone like '+1609555880%' or customer_id in (select id from customers where tenant_id = $1 and full_name like 'FUX %'))`, [T])).rows.map((r) => r.id);
        await q(`delete from ai_follow_up_contact_attempts where tenant_id = $1 and follow_up_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from ai_follow_up_escalations where tenant_id = $1 and follow_up_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from owner_alerts where tenant_id = $1 and category = 'ai_follow_up'`, [T]);
        await q(`delete from ai_receptionist_follow_ups where id = any($1::uuid[])`, [ids]);   // activity rows are append-only and stay (orphaned, harmless)
        await q(`delete from ai_handoff_events where tenant_id = $1 and provider_call_id like 'fux_%'`, [T]);
        await q(`delete from voice_call_events where tenant_id = $1 and provider_call_id like 'fux_%'`, [T]);
        await q(`delete from voice_call_outcomes where tenant_id = $1 and provider_call_id like 'fux_%'`, [T]);
        await q(`delete from ai_follow_up_health_runs where tenant_id = $1`, [T]);
        await q(`delete from ai_receptionist_agents where tenant_id = $1 and provider_agent_id = 'fux_agent'`, [T]);
        await q(`delete from customers where tenant_id = $1 and full_name like 'FUX %'`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const ava = randomUUID(), ben = randomUUID();
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values
          ($1, $3, $4, 'FUX', 'Ava', 'FUX Ava Kim', '+16095558801', 'fux.ava@example.com', 'active'), ($2, $3, $4, 'FUX', 'Ben', 'FUX Ben Lee', '+16095558802', 'fux.ben@example.com', 'active')`, [ava, ben, T, B]);
        await q(`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values ($1, $2, 'FUX agent', 'ready', 'retell', 'fux_agent')`, [T, B]);
        const call = { call_id: 'fux_call_1', agent_id: 'fux_agent', direction: 'inbound', from_number: '+16095558801', start_timestamp: Date.now() - 600_000, end_timestamp: Date.now() - 540_000, disconnection_reason: 'transfer_failed' };
        const raw = JSON.stringify({ event: 'call_ended', event_id: 'fux_ev_1', call });
        await ingest.applyRetellEvent(raw, JSON.parse(raw));
        const users = (await q(`select id, role from users where tenant_id = $1 and status = 'active' and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION') order by role, id`, [T])).rows;
        const statuses = ['open', 'open', 'assigned', 'in_progress', 'waiting', 'resolved'];
        for (let i = 0; i < 26; i++) {
          const st = statuses[i % statuses.length];
          const who = st === 'open' ? null : users[i % users.length]?.id ?? null;
          await q(`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, customer_id, caller_phone, description, source, created_by_user_id, assigned_user_id, due_at, due_tz, customer_match, resolution_category, resolved_at, created_at, updated_at)
            values ($1, $2, $3, 'normal', $4, $5, $6, $7, 'manual', $8, $9, now() + interval '2 days', 'America/New_York', $10, $11, $12, now() - make_interval(mins => $13), now() - make_interval(mins => $13))`,
            [T, B, i % 5 === 0 ? 'BOOKING_HELP' : 'CALLBACK', st, i === 0 ? ben : null, i === 0 ? null : `+1609555880${i % 10}`, `FUX task ${String(i).padStart(2, '0')}`, users[0]?.id ?? null, who,
              i === 0 ? 'linked' : 'unmatched', st === 'resolved' ? 'customer_reached' : null, st === 'resolved' ? new Date().toISOString() : null, 30 + i * 7]);
        }
        await q(`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, customer_id, description, source, due_at, due_tz, customer_match, created_at)
          values ($1, $2, 'COMPLAINT', 'urgent', 'open', $3, 'FUX urgent complaint', 'manual', now() - interval '3 hours', 'America/New_York', 'linked', now() - interval '5 hours')`, [T, B, ava]);
        return { ava, ben, call: 'fux_call_1' };
      }
      if (sp.get('state')) {
        return (await q(`select count(*) filter (where status = 'open')::int open, count(*) filter (where status = 'assigned')::int assigned, count(*) filter (where status = 'in_progress')::int in_progress,
            count(*) filter (where status = 'waiting')::int waiting, count(*) filter (where status in ('resolved','closed'))::int resolved,
            count(*) filter (where status in ('open','assigned','in_progress','waiting') and due_at < now())::int overdue, count(*)::int total
          from ai_receptionist_follow_ups where tenant_id = $1 and (branch_id = $2 or branch_id is null)`, [T, B])).rows[0];
      }
      if (sp.get('task')) return (await q(`select id, status, priority, assigned_user_id, resolution_category, contact_attempts, version from ai_receptionist_follow_ups where tenant_id = $1 and description = $2`, [T, sp.get('task')])).rows;
      if (sp.get('attempts')) return (await q(`select channel, outcome, notification_id from ai_follow_up_contact_attempts where tenant_id = $1 and follow_up_id = $2 order by created_at`, [T, sp.get('attempts')])).rows;
      return {};
    },
  };
}
