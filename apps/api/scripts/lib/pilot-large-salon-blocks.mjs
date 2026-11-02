// pilot-large-salon-blocks.mjs — PHASE 11 (blocks) of live-pilot-day.mjs: 200-technician mandate §48 / §49 / §76
// (Oct 26 2026). "Generate 200 technicians × 7 days of shifts / lunch / break / time-off … and measure availability."
// Runs after M5 on the same salon, on seven days nobody else books (d(10) … d(16)), so it never collides with the M5
// volume days. Everything goes through the real API — POST /pos/booking/blocked-times (the Booking board's Block Time) —
// and every assertion reads the API and cross-checks PostgreSQL:
//   • every active technician of the branch: a LUNCH block 12:00–12:30 and a BREAK 15:00–15:15 on each of the 7 days
//   • every 10th technician: one full TIME-OFF day (09:00–19:00) among the 7
//   • availability for #150 (her service) omits every start that would overlap her lunch / break; the time-off
//     technician has no open start that day; a booking into #150's lunch is refused; the 12-column day grid shows the
//     blocks; Find an Opening still answers; latency is measured with the blocks present
import { performance } from 'node:perf_hooks';
import { pool } from './pilot-large-salon.mjs';
import { pacer, pacedSession } from './pilot-large-salon-m5.mjs';

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const min = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
export const BLOCK_LUNCH = { startTime: '12:00', endTime: '12:30', reason: 'lunch' };
export const BLOCK_BREAK = { startTime: '15:00', endTime: '15:15', reason: 'break' };
export const BLOCK_TIME_OFF = { startTime: '09:00', endTime: '19:00', reason: 'time off' };

/** PURE (exported for the unit test): the blocks the pilot writes — lunch + break for every technician on every day, and
 *  one full time-off day for every 10th technician (rotating over the 7 days). */
export function planBlocks(technicianIds, days) {
  const out = [];
  technicianIds.forEach((technicianId, i) => {
    const offDay = i % 10 === 0 ? days[Math.floor(i / 10) % days.length] : null;
    for (const date of days) {
      if (date === offDay) { out.push({ technicianId, date, ...BLOCK_TIME_OFF }); continue; }
      out.push({ technicianId, date, ...BLOCK_LUNCH }, { technicianId, date, ...BLOCK_BREAK });
    }
  });
  return out;
}
/** PURE: does an open start `slot` (HH:MM) of `durationMin` overlap any of the blocks? */
export function overlapsBlock(slot, durationMin, blocks) {
  const a = min(slot), b = a + durationMin;
  return blocks.some((k) => min(k.startTime) < b && a < min(k.endTime));
}

export async function largeSalonBlocksPhase(env) {
  const { check, info, q, T, B, d, ctx, short, ok2, numbers, tag } = env;
  // M7 regression (Oct 26 2026): ~2,800 writes from ONE front-desk session in ~15 s ran through that session's limiter
  // budget (2,000 / minute — TenantRateLimitGuard, M4): 881 writes were refused 429 and the session stayed refused into
  // phase 12. The phase now behaves like the M5 load generator — paced (PILOT_M5_RPS / PILOT_M5_CLIENT_RPS, default 30 / s)
  // and a 429 is honoured (Retry-After, then re-sent) and counted; assertions read the answer that finally came back.
  const stats = { rateLimited: 0 };
  const rec = pacedSession(env.rec, pacer(Number(process.env.PILOT_M5_RPS || 30), stats));
  const S = ctx.services;
  const L = (numbers.large ??= {}); const M = (L.blocks = { perf: {} });
  const days = Array.from({ length: 7 }, (_, k) => d(10 + k));

  // the roster as the board pages it (server data): every active technician of the branch, #1 … #N
  const roster = [];
  for (let p = 1; p <= 50; p++) {
    const r = await rec.get(`/pos/booking/technicians?date=${days[0]}&page=${p}&pageSize=48`);
    roster.push(...(r.body?.technicians ?? []));
    if (p >= (r.body?.totalPages ?? 1)) break;
  }
  const ids = roster.map((t) => t.technicianId);
  const plan = planBlocks(ids, days);
  const t0 = performance.now();
  const res = await pool(plan, 8, async (b) => (await rec.post('/pos/booking/blocked-times', b)).status);
  M.write = { technicians: ids.length, days: days.length, requested: plan.length, ok: res.filter(ok2).length, ms: Math.round(performance.now() - t0), failures: [...new Set(res.filter((s) => !ok2(s)))], rateLimitedRetried: stats.rateLimited };
  const dbRows = (await q(`select reason, count(*)::int n from technician_blocked_times where tenant_id = $1 and branch_id = $2 and block_date = any($3::date[]) group by reason`, [T, B, days]))
    .reduce((a, r) => ((a[r.reason] = r.n), a), {});
  M.db = dbRows;
  const want = { lunch: plan.filter((b) => b.reason === 'lunch').length, break: plan.filter((b) => b.reason === 'break').length, 'time off': plan.filter((b) => b.reason === 'time off').length };
  check(`BLOCKED-TIME DATASET (§48/§76): ${ids.length} technicians × ${days.length} days — ${want.lunch} lunches, ${want.break} breaks and ${want['time off']} time-off days written through POST /pos/booking/blocked-times (${M.write.ms} ms, paced ≤ ${Number(process.env.PILOT_M5_RPS || 30)} / s); the database holds exactly those`,
    ids.length >= 190 && M.write.ok === plan.length && dbRows.lunch === want.lunch && dbRows.break === want.break && dbRows['time off'] === want['time off'], short({ write: M.write, db: dbRows, want }));

  // #150: her service, her open starts on day 1 — none may overlap her lunch or break
  const t150 = roster.find((t) => t.rosterNumber === 150) ?? roster[149];
  const svcRow = (await q(`select ts.service_id, coalesce(s.duration_minutes, 30)::int dur from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = ts.tenant_id where ts.tenant_id = $1 and ts.technician_id = $2 order by s.duration_minutes nulls last limit 1`, [T, t150.technicianId]).catch(() => []))[0];
  const svc = svcRow?.service_id ?? S.gel; const dur = Number(svcRow?.dur ?? 30);
  const a0 = performance.now();
  const av = await rec.get(`/pos/booking/availability?date=${days[0]}&technicianId=${t150.technicianId}&serviceIds=${svc}`);
  M.perf.availabilityOne = Math.round(performance.now() - a0);
  const slots = (Array.isArray(av.body) ? av.body : []).find((r) => r.technicianId === t150.technicianId)?.slots ?? [];
  const bad = slots.filter((s) => overlapsBlock(s, dur, [BLOCK_LUNCH, BLOCK_BREAK]));
  M.t150 = { roster: t150.rosterNumber, service: svc, dur, open: slots.length, overlapping: bad, before: slots.filter((s) => min(s) + dur <= min('12:00')).length, after: slots.filter((s) => min(s) >= min('12:30')).length };
  check(`AVAILABILITY HONOURS THE BLOCKS (§48): #${t150.rosterNumber} has ${slots.length} open starts for a ${dur}-minute service on ${days[0]} — none overlaps her 12:00–12:30 lunch or 15:00–15:15 break, and she is open both before and after lunch`,
    ok2(av.status) && slots.length > 0 && bad.length === 0 && M.t150.before > 0 && M.t150.after > 0, short(M.t150));

  const lunchTry = await rec.post('/pos/booking/appointments', { customerName: `Lunch Larry ${tag}`, serviceIds: [svc], technicianId: t150.technicianId, date: days[0], startTime: '12:00', source: 'manual' }, { 'idempotency-key': `lunch-${tag}` });
  const lunchDb = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and appt_date = $3 and status not in ('cancelled','canceled','no_show')`, [T, t150.technicianId, days[0]]))[0].n;
  check(`A BOOKING INTO A LUNCH IS REFUSED (§48): booking #${t150.rosterNumber} at 12:00 on ${days[0]} answers ${lunchTry.status} and writes nothing`,
    (lunchTry.status === 400 || lunchTry.status === 409) && lunchDb === 0, `status ${lunchTry.status} ${short(lunchTry.body?.message ?? lunchTry.body)} db ${lunchDb}`);

  // a time-off technician: no open start on the day off
  const offIdx = 0, offTech = ids[offIdx], offDay = days[Math.floor(offIdx / 10) % days.length];
  const avOff = await rec.get(`/pos/booking/availability?date=${offDay}&technicianId=${offTech}&serviceIds=${S.gel}`);
  const offSlots = (Array.isArray(avOff.body) ? avOff.body : []).find((r) => r.technicianId === offTech)?.slots ?? [];
  M.timeOff = { roster: roster[offIdx]?.rosterNumber, date: offDay, open: offSlots.length };
  check(`TIME OFF (§76): #${M.timeOff.roster} is off on ${offDay} (a 09:00–19:00 block) — availability offers her no start that day`, ok2(avOff.status) && offSlots.length === 0, short(M.timeOff));

  // the board's day grid for #150's page shows her two blocks; whole-salon availability + openings with 2,800 blocks
  const page = Math.floor(roster.indexOf(t150) / 12) + 1;
  const pageIds = roster.slice((page - 1) * 12, page * 12).map((t) => t.technicianId);
  const g0 = performance.now();
  const grid = await rec.get(`/pos/booking/day-grid?date=${days[0]}&technicianIds=${pageIds.join(',')}`);
  M.perf.dayGrid12 = Math.round(performance.now() - g0);
  const col = (grid.body?.columns ?? []).find((c) => c.technicianId === t150.technicianId);
  const colBlocks = (col?.blocked ?? []).map((b) => `${String(b.startTime).slice(0, 5)}-${String(b.endTime).slice(0, 5)}`).sort();
  check(`BOARD SHOWS THE BLOCKS: the 12-column day grid (page ${page}) draws #${t150.rosterNumber}'s lunch and break (${M.perf.dayGrid12} ms)`,
    ok2(grid.status) && (grid.body?.columns ?? []).length <= 12 && colBlocks.includes('12:00-12:30') && colBlocks.includes('15:00-15:15'), short({ colBlocks, cols: (grid.body?.columns ?? []).length }));
  const lat = [];
  for (const date of days) { const t = performance.now(); await rec.get(`/pos/booking/availability?date=${date}&serviceIds=${S.gel}`); lat.push(performance.now() - t); }
  const o0 = performance.now(); const opn = await rec.get(`/pos/booking/openings?date=${days[0]}&serviceIds=${S.gel}&limit=5`); M.perf.openings = Math.round(performance.now() - o0);
  M.perf.availabilityAll = { p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), samples: lat.length };
  info(`BLOCKS LATENCY (§48): whole-salon availability over ${days.length} blocked days p50 ${M.perf.availabilityAll.p50} / p95 ${M.perf.availabilityAll.p95} ms; #150 availability ${M.perf.availabilityOne} ms; day grid ${M.perf.dayGrid12} ms; openings ${M.perf.openings} ms`);
  check('FIND AN OPENING WITH BLOCKS (§15/§48): the top 5 still answer on a fully blocked-out week, none at a lunch start',
    ok2(opn.status) && (opn.body?.openings ?? []).length === 5 && !(opn.body?.openings ?? []).some((o) => o.time >= '12:00' && o.time < '12:30'), short((opn.body?.openings ?? []).map((o) => `#${o.rosterNumber} ${o.time}`)));
  M.rateLimited = stats.rateLimited;
  // the bulk import used most of this session's per-minute budget; phase 12 signs in on the same front desk session — let
  // one limiter window (60 s) pass so the next phase is measured on a fresh budget, not on the tail of this one
  await new Promise((r) => setTimeout(r, Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000) + 1_000));
  info(`RATE LIMIT (blocks): the front desk session was answered 429 ${stats.rateLimited} time(s) in this phase; each was honoured (Retry-After) and re-sent`);
  return M;
}
