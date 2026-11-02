// aical-extra.mjs — AI Center → AI Calendar in the catalog harness (AI Calendar guide, Oct 31 2026, migration 758).
// The REAL AiCalendarCenterController → AiCalendarCenter → SQL on the seeded TEST database. Tooling only — never shipped.
// Harness stand-in, stated plainly: BookingService's two reads (dayGrid / technicianPage) need the Kysely query builder the
// stand-in lacks, so they are served here from the SAME pos_tech_appointments / technicians rows with Booking's own engine
// functions (pbTechDayWindows / pbComputeAvailabilityInWindows) and Booking's default settings (09:00–19:00, 15 / 45 / 5;
// technicians without a schedule row follow store hours — exactly the engine's rule). Moves proposed by the Scheduling
// Assistant run through the Reception Copilot routes served by rcc-extra.mjs. Nothing leaves the machine.
// Controls (GET /__aical?…): reset=1 · seed=1 (today: AI / online / cancelled / no-show appointments, an AI call link, a
// code-pending hold, 26 list rows; 2026-07-01: a legacy unapproved overlap) · state=1 (plain SQL truth for today).
import { randomUUID } from 'node:crypto';
import { AiCalendarCenter } from '../../modules/ai/src/ai-center/ai-calendar-center.ts';
import { AiCalendarCenterController } from '../../modules/ai/src/ai-center/ai-calendar-center.controller.ts';
import { pbTechDayWindows, pbComputeAvailabilityInWindows } from '../../modules/booking/src/booking/booking.dto.ts';

export const LEGACY_DAY = '2026-07-01';   // before the overlap constraint's 2026-07-30 cutoff: a legacy overlap can exist

export function aicalExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const S = { openTime: '09:00', closeTime: '19:00', slotIntervalMinutes: 15, bufferMinutes: 5, defaultServiceDurationMinutes: 45 };
  const techs = async (c) => (await q(`select id, full_name, is_active from technicians where tenant_id = $1 and ($2::uuid is null or branch_id = $2) and archived_at is null order by full_name, id`, [c.tenantId, c.branchId || null])).rows;
  const booking = {
    async dayGrid(c, date, ids) {
      const all = (await techs(c)).filter((t) => !ids || ids.includes(t.id));
      const appts = (await q(`select a.id, a.technician_id, a.start_time, a.end_time, a.status, a.source, a.customer_name, a.services, a.created_at, t.full_name tech
        from pos_tech_appointments a left join technicians t on t.id = a.technician_id where a.tenant_id = $1 and ($2::uuid is null or a.branch_id = $2 or a.branch_id is null) and a.appt_date = $3::date`, [c.tenantId, c.branchId || null, date])).rows;
      const columns = all.map((t) => {
        const windows = t.is_active ? pbTechDayWindows(S.openTime, S.closeTime, null, []) : [];
        const mine = appts.filter((a) => a.technician_id === t.id).map((a) => ({ startTime: a.start_time, endTime: a.end_time, status: a.status }));
        return { technicianId: t.id, name: t.full_name, available: t.is_active, windows, blocked: [], openSlotCount: pbComputeAvailabilityInWindows(windows, S.slotIntervalMinutes, S.defaultServiceDurationMinutes, S.bufferMinutes, mine).length };
      });
      return { date, ...S, columns, totalOpenSlots: columns.reduce((s, x) => s + x.openSlotCount, 0),
        appointments: appts.map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, technicianName: a.tech, startTime: a.start_time, endTime: a.end_time, status: a.status, source: a.source, customerName: a.customer_name, services: a.services, createdAt: a.created_at })) };
    },
    async technicianPage(c, qy) {
      const list = (await techs(c)).filter((t) => t.is_active);
      const size = qy.pageSize ?? 12, page = Math.min(qy.page ?? 1, Math.max(1, Math.ceil(list.length / size)));
      return { date: qy.date, technicians: list.slice((page - 1) * size, page * size).map((t, i) => ({ technicianId: t.id, name: t.full_name, rosterNumber: (page - 1) * size + i + 1, workingToday: true })),
        total: list.length, totalAll: list.length, workingCount: list.length, page, pageSize: size, totalPages: Math.max(1, Math.ceil(list.length / size)) };
    },
  };
  const ctl = new AiCalendarCenterController(new AiCalendarCenter(db, booking));
  return {
    routes: (routesOf) => routesOf('modules/ai/src/ai-center/ai-calendar-center.controller.ts', '/pos/ai/calendar-center', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from booking_holds where tenant_id = $1 and channel = 'aical_test'`, [T]);
        await q(`delete from voice_tool_executions where tenant_id = $1 and provider_call_id like 'aical_%'`, [T]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and customer_name like 'AICAL %'`, [T]);
        await q(`delete from ai_calendar_health_runs where tenant_id = $1`, [T]);
        await q(`delete from customers where tenant_id = $1 and full_name like 'AICAL %'`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const tz = (await q(`select coalesce(timezone, 'America/New_York') tz from branches where id = $1`, [B])).rows[0].tz;
        const today = (await q(`select (now() at time zone $1)::date::text d`, [tz])).rows[0].d;
        const tc = (await q(`select id from technicians where tenant_id = $1 and branch_id = $2 and is_active and archived_at is null order by full_name, id limit 3`, [T, B])).rows.map((r) => r.id);
        const cust = randomUUID();
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1, $2, $3, 'AICAL', 'Ava', 'AICAL Ava Kim', '+16095550142', 'aical.ava@example.com', 'active')`, [cust, T, B]);
        const ins = async (o) => { const id = randomUUID(); await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status, overbook_ok, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::date, $11, $12, $13, $14, false, coalesce($15::timestamptz, now()), coalesce($15::timestamptz, now()))`,
          [id, T, B, o.tech, o.cust ?? null, o.name, o.phone ?? null, o.source ?? 'manual', JSON.stringify([{ serviceName: o.service ?? 'Gel Manicure', durationMinutes: 45 }]), o.date ?? today, o.s, o.e, o.min ?? 45, o.status ?? 'booked', o.created ?? null]); return id; };
        const ai = await ins({ tech: tc[0], name: 'AICAL Ava Kim', cust, phone: '+16095550142', source: 'ai', s: '20:00', e: '20:45', service: 'Pedicure Deluxe' });
        await ins({ tech: tc[1] ?? tc[0], name: 'AICAL Online Olivia', source: 'online', s: '20:30', e: '21:15' });
        await ins({ tech: tc[2] ?? tc[0], name: 'AICAL Cancelled Cara', source: 'ai', s: '21:00', e: '21:45', status: 'cancelled' });
        await ins({ tech: tc[2] ?? tc[0], name: 'AICAL NoShow Nina', s: '21:45', e: '22:30', status: 'no_show' });
        await q(`insert into voice_tool_executions (tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status, related_type, related_id) values ($1, $2, 'aical_call_77', $3, 'book_appointment', 'write', 'succeeded', 'appointment', $4)`, [T, B, randomUUID(), ai]);
        await q(`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel) values ($1, $2, $3, ($4::date + time '22:00') at time zone $5, ($4::date + time '22:45') at time zone $5, now() + interval '20 minutes', 'held', $6, 'aical_test')`, [T, B, tc[1] ?? tc[0], today, tz, randomUUID()]);
        // 26 list rows on a future month so the List view pages (newest created first)
        for (let i = 0; i < 26; i++) await ins({ tech: tc[i % tc.length], name: `AICAL List ${String(i).padStart(2, '0')}`, date: '2027-01-' + String(4 + (i % 20)).padStart(2, '0'), s: `${String(9 + Math.floor(i / 3) % 9).padStart(2, '0')}:00`, e: `${String(9 + Math.floor(i / 3) % 9).padStart(2, '0')}:45`, created: new Date(Date.UTC(2026, 9, 1, 12, i)).toISOString() });
        // a legacy unapproved overlap (before the 2026-07-30 constraint cutoff) for the Scheduling Assistant
        const ov1 = await ins({ tech: tc[0], name: 'AICAL Legacy A', date: LEGACY_DAY, s: '10:00', e: '11:00', min: 60 });
        const ov2 = await ins({ tech: tc[0], name: 'AICAL Legacy B', date: LEGACY_DAY, s: '10:30', e: '11:30', min: 60 });
        return { today, tz, ai, customer: cust, overlap: [ov1, ov2] };
      }
      if (sp.get('state')) {
        const tz = (await q(`select coalesce(timezone, 'America/New_York') tz from branches where id = $1`, [B])).rows[0].tz;
        return (await q(`with d as (select (now() at time zone $3)::date dd)
          select (select count(*) from pos_tech_appointments, d where tenant_id = $1 and (branch_id = $2 or branch_id is null) and appt_date = d.dd and status not in ('cancelled', 'no_show'))::int as appointments,
            (select count(*) from pos_tech_appointments, d where tenant_id = $1 and (branch_id = $2 or branch_id is null) and appt_date = d.dd and status not in ('cancelled', 'no_show') and source = 'ai')::int as ai,
            (select count(*) from technicians where tenant_id = $1 and branch_id = $2 and is_active and archived_at is null)::int as active_techs,
            (select count(*) from ai_calendar_health_runs where tenant_id = $1)::int as health_runs,
            (select count(*) from audit_events where tenant_id = $1 and module = 'ai_calendar')::int as overlay_views,
            (select max(updated_at) from pos_tech_appointments where tenant_id = $1)::text as last_change,
            (select json_object_agg(customer_name, appt_date || ' ' || start_time || '-' || end_time || ' ' || status) from pos_tech_appointments where tenant_id = $1 and customer_name like 'AICAL Legacy %') as legacy`, [T, B, tz])).rows[0];
      }
      return { ok: true };
    },
  };
}
