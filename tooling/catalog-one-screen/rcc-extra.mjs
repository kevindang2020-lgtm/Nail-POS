// rcc-extra.mjs — AI Center → Reception Copilot in the catalog harness (Reception Copilot guide, Oct 31 2026, migration 757).
// The REAL ReceptionCopilotCenterController → ReceptionCopilotCenter → the REAL ReceptionCopilotActionService (claim-before-
// run ledger) and the REAL CopilotSettingsService → SQL on the seeded TEST database. Tooling only — never shipped. Nothing
// leaves the machine: no text, no call, no provider. Harness stubs, stated plainly:
//   • booking: create / reschedule / cancel write pos_tech_appointments with raw SQL exactly as BookingService would (the
//     real service needs the Kysely query builder the stand-in lacks); the database's own overlap exclusion still applies
//   • messaging: a test sender that records a notifications row with an SM-MOCK- id (never a provider)
//   • queue: counted from today's pos_tech_appointments (waiting / in service) — the real QueueService needs the builder
//   • the old /tenant/ai/center copilot panels: settings are REAL; queue / duplicates / phone activity / waitlist read SQL
// Controls (GET /__rcc?…): reset=1 · seed=1 (today: a due-soon booking, an overbooked overlap, a callback call, a failed
// Copilot action, two profiles sharing one phone, 23 search customers) · state=1 (plain SQL truth).
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { ReceptionCopilotActionService, KyselyActionLedgerRepo } from '../../modules/ai/src/ai-center/reception-copilot-action.service.ts';
import { ReceptionCopilotCenter } from '../../modules/ai/src/ai-center/reception-copilot-center.ts';
import { ReceptionCopilotCenterController } from '../../modules/ai/src/ai-center/reception-copilot-center.controller.ts';
import { CopilotSettingsService } from '../../modules/ai/src/ai-center/copilot-settings.service.ts';
import { AiCenterController } from '../../modules/ai/src/ai-center/ai-center.controller.ts';

export function rccExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const audit = { record: async () => undefined };
  const settings = new CopilotSettingsService(db, audit);
  const booking = {
    create: async (c, p) => {
      const id = randomUUID();
      const dur = Number((await q(`select coalesce(sum(duration_minutes), 30)::int d from services where tenant_id = $1 and id = any($2::uuid[])`, [c.tenantId, p.serviceIds])).rows[0]?.d ?? 30);
      const tech = p.technicianId ?? (await q(`select id from technicians where tenant_id = $1 and branch_id = $2 and is_active order by created_at limit 1`, [c.tenantId, c.branchId])).rows[0]?.id;
      await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services, created_by)
        values ($1, $2, $3, $4, $5, $6::date, $7::text, to_char($7::text::time + make_interval(mins => $8::int), 'HH24:MI'), $8::int, 'booked', '[]'::jsonb, $9)`, [id, c.tenantId, c.branchId, tech, p.customerName, p.date, p.startTime, dur, c.userId]);
      return { appointmentId: id };
    },
    reschedule: async (c, id, p) => {
      const r = await q(`update pos_tech_appointments set start_time = $3::text, end_time = to_char($3::text::time + make_interval(mins => coalesce(duration_minutes, 30)), 'HH24:MI'), appt_date = coalesce($4::date, appt_date)
        where tenant_id = $1 and id = $2 returning id`, [c.tenantId, id, p.startTime, p.date ?? null]);
      if (!r.rows.length) throw new Error('Appointment not found'); return { appointmentId: id };
    },
    cancel: async (c, id) => {
      const r = await q(`update pos_tech_appointments set status = 'cancelled' where tenant_id = $1 and id = $2 returning id`, [c.tenantId, id]);
      if (!r.rows.length) throw new Error('Appointment not found'); return { appointmentId: id };
    },
  };
  const notifications = { send: async (c, m) => {
    const id = randomUUID(); const pid = 'SM-MOCK-' + id.slice(0, 8);
    await q(`insert into notifications (id, tenant_id, branch_id, channel, to_address, body, status, provider_id, customer_id) values ($1, $2, $3, 'sms', $4, $5, 'sent', $6, $7)`, [id, c.tenantId, c.branchId, m.to, m.body, pid, m.customerId ?? null]);
    return { sent: true, id, providerId: pid };
  } };
  const spine = new ReceptionCopilotActionService(booking, audit, new KyselyActionLedgerRepo(db), notifications, settings);
  const queueSummary = async (c) => {
    if (!c.branchId) return { available: false, waiting: 0, inService: 0, unassigned: 0, vipWaiting: 0, longestWaitMinutes: null };
    const r = (await q(`select count(*) filter (where status in ('waiting', 'arrived', 'checked_in'))::int w, count(*) filter (where status = 'in_service')::int s
      from pos_tech_appointments where tenant_id = $1 and branch_id = $2 and appt_date = current_date`, [c.tenantId, c.branchId])).rows[0];
    return { available: true, waiting: r.w, inService: r.s, unassigned: 0, vipWaiting: 0, longestWaitMinutes: null };
  };
  const center = new ReceptionCopilotCenter(db, spine, { queueSummary }, { get: (c) => settings.get(c) }, null, { AUTH_SESSION_SECRET: 'harness-rcc' });
  const ctl = new ReceptionCopilotCenterController(center);
  // the original page's panels (Queue Now, duplicates, AI phone activity, waitlist, settings) — settings are the real service
  const copilotContext = { queueSummary, duplicateCandidates: async () => ({ groups: [] }) };
  const copilotAssist = { recentAiPhoneActivity: async () => ({ available: true, calls: [] }), recommendWaitlist: async () => ({ available: false }), explainService: async () => ({ found: false }) };
  const old = new AiCenterController({}, {}, copilotContext, settings, copilotAssist, {}, {}, {}, {});
  let seeded = [];
  return {
    center,   // the AI Follow-Ups harness (fu-extra.mjs) texts through the same prepare → confirm path
    routes: (routesOf) => [
      ...routesOf('modules/ai/src/ai-center/reception-copilot-center.controller.ts', '/pos/ai/copilot-center', ctl),
      ...routesOf('modules/ai/src/ai-center/ai-center.controller.ts', '/tenant/ai/center', old).filter((r) => ['copilotQueue', 'copilotDuplicates', 'copilotAiPhone', 'copilotWaitlist', 'copilotGetSettings', 'copilotPatchSettings'].includes(r.method)),
    ],
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from reception_copilot_action_ledger where tenant_id = $1`, [T]);
        await q(`delete from reception_copilot_health_runs where tenant_id = $1`, [T]);
        await q(`delete from tenant_settings where tenant_id = $1 and category = 'reception_copilot'`, [T]);
        await q(`delete from notifications where tenant_id = $1 and provider_id like 'SM-MOCK-%' and to_address like '+1609444%'`, [T]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and customer_name like 'RCC %'`, [T]);
        await q(`delete from voice_call_outcomes where tenant_id = $1 and provider_call_id like 'rcc_%'`, [T]);
        await q(`delete from customers where tenant_id = $1 and full_name like 'RCC %'`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const techs = (await q(`select id from technicians where tenant_id = $1 and branch_id = $2 and is_active and archived_at is null order by created_at limit 2`, [T, B])).rows.map((r) => r.id);
        const tz = (await q(`select coalesce(timezone, 'America/New_York') tz from branches where id = $1`, [B])).rows[0].tz;
        const now = (await q(`select (now() at time zone $1)::date::text d, to_char((now() at time zone $1) + interval '15 minutes', 'HH24:MI') soon, to_char(now() at time zone $1, 'HH24:MI') hm`, [tz])).rows[0];
        const ins = async (o) => { const id = randomUUID(); await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, appt_date, start_time, end_time, duration_minutes, status, services, overbook_ok, customer_id)
          values ($1, $2, $3, $4, $5, $6, $7::date, $8::text, to_char($8::text::time + make_interval(mins => 30), 'HH24:MI'), 30, 'booked', '[]'::jsonb, $9::boolean, $10::uuid)`, [id, T, B, o.tech, o.name, o.phone ?? '+16094440142', o.date ?? now.d, o.start, !!o.overbook, o.customer ?? null]); return id; };
        const out = {};
        if (now.soon > now.hm) out.soon = await ins({ tech: techs[0], name: 'RCC Due Soon', start: now.soon });   // skipped in the last 15 min of the day
        out.cancelMe = await ins({ tech: techs[0], name: 'RCC Cancel Me', start: '23:00', date: '2027-01-15' });
        out.moveMe = await ins({ tech: techs[0], name: 'RCC Move Me', start: '09:00', date: '2027-01-16' });
        out.blocker = await ins({ tech: techs[0], name: 'RCC Blocker', start: '10:00', date: '2027-01-16' });
        await ins({ tech: techs[1] ?? techs[0], name: 'RCC Overbook A', start: '06:00' }); await ins({ tech: techs[1] ?? techs[0], name: 'RCC Overbook B', start: '06:15', overbook: true });
        await q(`insert into voice_call_outcomes (tenant_id, branch_id, provider_call_id, started_at, follow_up_required) values ($1, $2, 'rcc_call_1', now() - interval '25 minutes', true)`, [T, B]);
        await q(`insert into reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, ok, state, summary, error_code, created_at) values ($1, $2, $3, 'send_message', false, 'failed', 'Text message (24 characters)', 'MESSAGE_SEND_FAILED', now() - interval '2 hours')`, [T, B, 'cc:seed-' + randomUUID()]);
        const shared = randomUUID();
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'RCC', 'Mai', 'RCC Mai Family', '+16094440199', 'mai@rcc.test', 'active'), ($4, $2, $3, 'RCC', 'Bao', 'RCC Bao Family', '+16094440199', null, 'active')`, [shared, T, B, randomUUID()]);
        await ins({ tech: techs[0], name: 'RCC Mai Family', start: '11:00', date: '2027-02-01', customer: shared });
        for (let i = 0; i < 23; i++) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'RCC', $4, $5, $6, $7, 'active')`,
          [randomUUID(), T, B, `Pat${i}`, `RCC Pat Lee ${String(i).padStart(2, '0')}`, '+1609444' + String(3000 + i), `rccpat${i}@ex.test`]);
        seeded = Object.values(out);
        return { ...out, sharedCustomer: shared };
      }
      if (sp.get('state')) {
        return (await q(`select
            (select count(*) from reception_copilot_action_ledger where tenant_id = $1)::int as actions,
            (select json_agg(json_build_object('type', action_type, 'state', state) order by created_at desc) from reception_copilot_action_ledger where tenant_id = $1) as ledger,
            (select count(*) from reception_copilot_health_runs where tenant_id = $1)::int as health_runs,
            (select count(*) from notifications where tenant_id = $1 and provider_id like 'SM-MOCK-%' and to_address like '+1609444%')::int as texts,
            (select json_object_agg(customer_name, status || ' ' || appt_date || ' ' || start_time) from pos_tech_appointments where tenant_id = $1 and customer_name like 'RCC %') as appts,
            (select count(*) from audit_events where tenant_id = $1 and action = 'customer_overlay.viewed')::int as overlay_views,
            (select count(*) from voice_call_outcomes where tenant_id = $1 and branch_id = $2 and coalesce(started_at, created_at) > now() - interval '24 hours' and (abandoned or follow_up_required))::int as missed24,
            (select count(*) from reception_copilot_action_ledger where tenant_id = $1 and state = 'failed' and created_at > now() - interval '24 hours')::int as failed24`, [T, B])).rows[0];
      }
      return { ok: true };
    },
  };
}
