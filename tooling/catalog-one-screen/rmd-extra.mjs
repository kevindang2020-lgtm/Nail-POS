// rmd-extra.mjs — Communications → Appointment Reminders in the catalog harness (Appointment Reminders Complete Build &
// Repair Guide, Oct 30 2026, migration 747). REAL controllers + RemindersService + KyselyRemindersRepository (claim-before-
// send dispatch) + ReminderCenter on the seeded TEST database. The provider is a recording stand-in that behaves like the
// real SMS path for what matters here: a number without +country is refused (invalid_destination), an opted-out number is
// blocked, anything else gets a notifications row — nothing leaves the machine (no Twilio, no email).
// Controls (GET /__rmd?…): seed=1 → reminders on (24 h / 60 min / SMS), the salon's Twilio row (test, validated), due-now
// appointments (Ava ok · Ben no "+" · Cara opted out · 12 "Zed Remind") and upcoming ones (Eve 28 h · Dan 30 h);
// run=1 → one reminder run now (as the 5-minute scheduler would) · deliver=1 → a signed delivery report for Ava ·
// fix=1 → Ben's number gets its +1 · state=1 → DB truth · reset=1 → rows removed.
import { ReminderCenterController } from '../../modules/communications/src/reminders/reminder-center.controller.ts';
import { PosRemindersController } from '../../modules/communications/src/reminders/reminders.controller.ts';
import { RemindersService } from '../../modules/communications/src/reminders/reminders.service.ts';
import { KyselyRemindersRepository } from '../../modules/communications/src/reminders/reminders.kysely.repository.ts';

const P = 'e7470000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
const cust = (n) => pid(100 + n), tech = (n) => pid(300 + n), appt = (n) => pid(500 + n);
const OPTED = new Set(['+16095554003']);

export function rmdExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const sent = [];
  const sender = {
    async send(c, req) {
      if (OPTED.has(req.to)) return { sent: false, status: 'blocked', reason: 'opted_out' };
      if (req.channel === 'sms' && !String(req.to).startsWith('+')) {
        await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, failure_reason, purpose, source_type, source_id) values ($1,'sms',$2,$3,$4,'failed','invalid_destination','reminder','appointment',$5)`, [c.tenantId, req.to, req.body, req.customerId ?? null, req.source?.id ?? null]);
        return { sent: false, status: 'failed', reason: 'invalid_destination' };
      }
      const r = await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, purpose, source_type, source_id) values ($1,$2,$3,$4,$5,'sent',$6,'reminder','appointment',$7) returning id`,
        [c.tenantId, req.channel, req.to, req.body, req.customerId ?? null, 'SMtest' + Math.random().toString(16).slice(2, 10), req.source?.id ?? null]);
      sent.push(req.source?.id); return { sent: true, status: 'sent', id: r.rows[0].id };
    },
  };
  const svc = new RemindersService(new KyselyRemindersRepository(db), sender);
  const pos = new PosRemindersController(svc);
  return {
    svc,
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/reminders/reminder-center.controller.ts', '/pos/reminder-center', new ReminderCenterController(svc, db)),
      // the settings routes use bare @Get() / @Patch() (no path), which routesOf does not read — declared here the same way
      { verb: 'GET', re: /^\/pos\/reminders$/, keys: [], perm: 'communications.view', method: 'config', params: ['req'], fn: pos.config.bind(pos) },
      { verb: 'PATCH', re: /^\/pos\/reminders$/, keys: [], perm: 'communications.manage', method: 'update', params: ['body', 'req'], fn: pos.update.bind(pos) },
    ],
    async control(sp, T, B) {
      const tz = 'America/New_York';
      const local = (ms) => {
        const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
        const g = (t) => f.find((x) => x.type === t).value; return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
      };
      const all = Array.from({ length: 20 }, (_, i) => i + 1);
      if (sp.get('reset')) {
        await q(`delete from appointment_reminder_attempts where tenant_id = $1 and appointment_id = any($2::uuid[])`, [T, all.map(appt)]);
        await q(`delete from appointment_reminders_sent where tenant_id = $1 and appointment_id = any($2::uuid[])`, [T, all.map(appt)]);
        await q(`delete from notification_delivery_events where tenant_id = $1 and provider_message_sid like 'SMrmd%'`, [T]);
        await q(`delete from notifications where tenant_id = $1 and source_type = 'appointment' and source_id = any($2::text[])`, [T, all.map(appt)]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and id = any($2::uuid[])`, [T, all.map(appt)]);
        await q(`delete from appointment_reminder_runs where tenant_id = $1`, [T]);
        sent.length = 0;
        return { reset: true };
      }
      if (sp.get('seed')) {
        await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) select $1, null, 'business-branch', $2::jsonb where not exists (select 1 from tenant_settings where tenant_id = $1 and category = 'business-branch')`, [T, JSON.stringify({ timezone: tz })]);
        await q(`insert into reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel) values ($1, true, 1440, 60, 'sms') on conflict (tenant_id) do update set enabled = true, lead_minutes = 1440, window_minutes = 60, channel = 'sms', ladder_minutes = null`, [T]);
        if (!(await q(`select 1 from tenant_messaging_credentials where tenant_id = $1 and provider = 'twilio'`, [T])).rows.length)
          await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, from_number, status, last_validated_at) values ($1,'twilio','AC_TEST_HARNESS','+16095550100','configured', now())`, [T]);
        const people = [[1, 'Ava', 'Remind', '+16095554001'], [2, 'Ben', 'NoPlus', '6095554002'], [3, 'Cara', 'Stop', '+16095554003'], [4, 'Dan', 'Later', '+16095554004'], [5, 'Eve', 'Soon', '+16095554005']];
        for (let i = 6; i <= 17; i++) people.push([i, 'Zed', `Remind ${i}`, `+1609555${4000 + i}`]);
        const now = Date.now();
        for (const [i, f, l, ph] of people) {
          await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status) values ($1,$2,$3,$4,$5,$6,$7,$7,'active')
            on conflict (id) do update set normalized_phone = excluded.normalized_phone`, [cust(i), T, B, f, l, `${f} ${l}`, ph]);
          await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,'Rina',$4,$5,true) on conflict (id) do nothing`, [tech(i), T, B, `Tech${i}`, `Rina Tech${i}`]);
          const start = i === 4 ? now + 30 * 3600_000 : i === 5 ? now + 28 * 3600_000 : now + 24 * 3600_000 + (10 + i * 2) * 60_000;
          const s = local(start); const [hh, mm] = s.time.split(':').map(Number); const e = Math.min(hh * 60 + mm + 45, 23 * 60 + 59);
          await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services, created_at)
            values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,'booked','[{"serviceName":"Gel Manicure"}]'::jsonb, now() - interval '3 days') on conflict (id) do nothing`,
            [appt(i), T, B, tech(i), cust(i), `${f} ${l}`, s.date, s.time, `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`]);
        }
        return { seeded: true };
      }
      if (sp.get('run')) { const r = await svc.runDueReminders(Date.now(), 'manual'); return { ran: true, sent: r.sent, failed: r.failed, blocked: r.blocked, skipped: r.skipped ?? 0 }; }
      if (sp.get('deliver')) {
        const n = (await q(`select notification_id from appointment_reminders_sent where tenant_id = $1 and appointment_id = $2 and notification_id is not null`, [T, appt(1)])).rows[0]?.notification_id;
        if (n) { await q(`update notifications set status = 'delivered', delivered_at = now() where id = $1`, [n]);
          await q(`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, applied, signature_verified) values ($1,$2,'SMrmd1','delivered',true,true)`, [T, n]); }
        return { delivered: !!n };
      }
      if (sp.get('fix')) { await q(`update customers set normalized_phone = '+16095554002' where id = $1`, [cust(2)]); return { fixed: true }; }
      if (sp.get('state')) {
        const rows = (await q(`select appointment_id, state, reason from appointment_reminders_sent where tenant_id = $1 and appointment_id = any($2::uuid[]) order by created_at`, [T, all.map(appt)])).rows;
        const by = (i) => rows.filter((r) => r.appointment_id === appt(i)).map((r) => `${r.state}${r.reason ? ':' + r.reason : ''}`);
        const settings = (await q(`select enabled, lead_minutes, window_minutes, channel from reminder_settings where tenant_id = $1`, [T])).rows[0];
        const today = (await q(`select count(*)::int as n from appointment_reminders_sent d left join notifications n on n.id = d.notification_id
            where d.tenant_id = $1 and d.state = 'submitted' and d.reason is distinct from 'legacy_ledger' and coalesce(n.created_at, d.updated_at) >= ((now() at time zone $2)::date::timestamp at time zone $2)`, [T, tz])).rows[0].n;
        return { ava: by(1), ben: by(2), cara: by(3), dan: by(4), eve: by(5), zed: all.slice(5, 17).map(by), sentToday: today, sends: sent.length, settings,
          sendsAva: sent.filter((x) => x === appt(1)).length, sendsBen: sent.filter((x) => x === appt(2)).length, sendsDan: sent.filter((x) => x === appt(4)).length, ids: { ava: cust(1), dan: appt(4), ben: appt(2) } };
      }
      return { ok: true };
    },
  };
}
