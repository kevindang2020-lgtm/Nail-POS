// pilot-large-salon.mjs — PHASE 11 of live-pilot-day.mjs: the 200-Technician Large Salon mandate (Oct 23 2026, §73–§105).
//
// The same salon the pilot just ran grows to 200 technicians THROUGH THE REAL API (POST /pos/technicians → services →
// weekly schedule; no SQL inserts): mixed skills (§75 — generalists, pedicure-only, acrylic and nail-art specialists,
// manicure-only), some off today (§76). Then, every number measured on the running API against the real PostgreSQL:
//   11a  the roster: 200 technicians, 17 pages of 12, page 1 / 8 / 17, search "#200", skill + exact-service filters
//   11b  a busy tomorrow: 1,000 more appointments booked through the API (§49/§50), the board's day grid for ONE page of
//        12 technicians (§52), Find an Opening / Best Matches over 200 (§85/§86), latency + payload size (§24/§93)
//   11c  booking concurrency: 20 front desks book the same technician + minute → exactly one wins (§87)
//   11d  Technician App for #1, #25, #100, #193, #200 (§77–§80): invite → accept → app access → login → my schedule →
//        refresh → logout (the old cookie is dead) → relogin; wrong password refused; #100 cannot read #101's pay
//   11e  Clock-In burst (§89): 100 technicians clock in on the kiosk by PIN at once — 100 shifts, 100 rotation joins, no
//        duplicates; a replay writes nothing
//   11f  Walk-in burst (§88): 30 guests check in on the kiosk at once — 30 queue items, none lost or doubled
//   11g  database evidence (§25/§92): EXPLAIN (ANALYZE, BUFFERS) of the large-salon reads, written into the numbers
// Bulk creation runs a few requests at a time (pool); every assertion reads the API's answer and cross-checks the DB.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const LARGE_TARGET = 200;
export const REPRESENTATIVE = [1, 25, 100, 193, 200];

/** run `fn` over `items`, `n` at a time, keeping order */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const bytes = (b) => Buffer.byteLength(typeof b === 'string' ? b : JSON.stringify(b ?? null));
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
/** 4-digit PINs that are distinct, not on the weak list and not any of `avoid` (7919 is coprime with 9000 → distinct) */
export function pinsFor(count, avoid = []) {
  const weak = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '2345', '3456', '4567', '5678', '6789', '0123', '4321', '9876']);
  const out = []; const seen = new Set(avoid);
  for (let i = 1; out.length < count && i < 9000; i++) { const p = String(1000 + ((i * 7919) % 9000)); if (!weak.has(p) && !seen.has(p)) { seen.add(p); out.push(p); } }
  return out;
}

export async function largeSalonPhase(env) {
  const { own, rec, pub, kiosk, session, tenantLogin, check, info, q, numbers, ctx, B, T, tag, TOMORROW, TODAY, week, STAFF_PW, TZ, extra, techDef, short, ok2 } = env;
  const L = numbers.large = { perf: {}, explain: {}, matrix: {} };
  const timed = async (label, fn) => { const t0 = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - t0); L.perf[label] = { ms, status: r?.status, bytes: bytes(r?.body) }; return r; };
  const S = ctx.services;
  const todayName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(new Date()).toLowerCase();

  // ── 11a. grow to 200 through the API ────────────────────────────────────────────────────────────────────────────
  const before = (await q(`select count(*)::int n from technicians where tenant_id = $1 and is_active`, [T]))[0].n;
  const toHire = Math.max(0, LARGE_TARGET - before);
  // §75 skills: 40 % generalists, 25 % pedicure-only, 15 % acrylic specialists, 10 % nail-art, 10 % manicure-only
  const kindOf = (i) => { const m = i % 20; return m < 8 ? 'generalist' : m < 13 ? 'pedicure' : m < 16 ? 'acrylic' : m < 18 ? 'nailart' : 'manicure'; };
  const svcsOf = { generalist: [S.gel, S.pedi, S.acrylic, S.addOn], pedicure: [S.pedi], acrylic: [S.acrylic, S.gel, S.addOn], nailart: [S.gel, S.addOn], manicure: [S.gel] };
  const t0 = performance.now();
  const hires = await pool(Array.from({ length: toHire }, (_, i) => i), 6, async (i) => {
    const n = String(i + 1).padStart(3, '0'), kind = kindOf(i), email = `r${n}.${tag}@pilot-day.test`;
    // "Aa Roster NNN" sorts ahead of the pilot's first 24 (Anna, Lisa, Mary, Pedi…, Tech…) → roster #1–#176 in hire order
    const cr = await own.post('/pos/technicians', { firstName: 'Aa', lastName: `Roster ${n}`, email, phone: `6094${String(Number(tag) % 1000).padStart(3, '0')}${n}`, techAppEnabled: false, serviceIds: svcsOf[kind] });
    const id = cr.body?.technicianId ?? cr.body?.id;
    let sv = { status: 0 }, sc = { status: 0 };
    if (id) {
      sv = await own.patch(`/pos/technicians/${id}/services`, { serviceIds: svcsOf[kind] });
      const offToday = i % 11 === 10;   // §76: some are off today (they still work tomorrow)
      const weekly = offToday ? { ...week, [todayName]: { ...week[todayName], isWorking: false } } : week;
      sc = await own.patch(`/pos/technicians/${id}/schedule`, { weekly, branchId: B });
    }
    return { i, id, kind, svcs: svcsOf[kind], email, name: `Aa Roster ${n}`, acceptUrl: cr.body?.invite?.acceptUrl ?? null, status: cr.status, sv: sv.status, sc: sc.status, offToday: i % 11 === 10 };
  });
  L.hire = { before, hired: hires.filter((h) => h.id).length, ms: Math.round(performance.now() - t0), byKind: hires.reduce((a, h) => ((a[h.kind] = (a[h.kind] ?? 0) + 1), a), {}) };
  const dbCount = (await q(`select count(*)::int n from technicians where tenant_id = $1 and is_active`, [T]))[0].n;
  check(`200 TECHNICIANS (§73/§75): ${toHire} more hired through the POS API (services + weekly schedule each; mixed skills ${short(L.hire.byKind)}; ${hires.filter((h) => h.offToday).length} off today) — the salon has exactly 200 active technicians`,
    hires.every((h) => ok2(h.status) && h.id && ok2(h.sv) && ok2(h.sc)) && dbCount === LARGE_TARGET, `hired ${L.hire.hired}/${toHire} in ${L.hire.ms} ms; db ${dbCount}; first failure ${short(hires.find((h) => !(ok2(h.status) && h.id && ok2(h.sv) && ok2(h.sc))))}`);

  // the roster as the board pages it: 12 a page → 17 pages; every technician exactly once, #1…#200 in order
  const p1 = await timed('technicians.page1', () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&page=1&pageSize=12`));
  const pages = [p1];
  for (let p = 2; p <= (p1.body?.totalPages ?? 1); p++) pages.push(await timed(`technicians.page${p}`, () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&page=${p}&pageSize=12`)));
  const roster = pages.flatMap((r) => r.body?.technicians ?? []);
  const byNumber = new Map(roster.map((t) => [t.rosterNumber, t]));
  const p8 = pages[7]?.body?.technicians ?? [], p17 = pages[16]?.body?.technicians ?? [];
  L.roster = { total: p1.body?.total, totalPages: p1.body?.totalPages, distinct: new Set(roster.map((t) => t.technicianId)).size, page1: (p1.body?.technicians ?? []).map((t) => t.rosterNumber), page8: p8.map((t) => t.rosterNumber), page17: p17.map((t) => t.rosterNumber), keys: Object.keys(roster[0] ?? {}).sort() };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  check('BOARD PAGING (§4/§7/§8/§94): GET /pos/booking/technicians answers 200 technicians as 17 pages of 12 — page 1 = #1–12, page 8 = #85–96, page 17 = #193–200 — every technician exactly once; never 200 columns in one answer',
    L.roster.total === 200 && L.roster.totalPages === 17 && L.roster.distinct === 200 && pages.every((r) => (r.body?.technicians ?? []).length <= 12)
      && JSON.stringify(L.roster.page1) === JSON.stringify(range(1, 12)) && JSON.stringify(L.roster.page8) === JSON.stringify(range(85, 96)) && JSON.stringify(L.roster.page17) === JSON.stringify(range(193, 200)), short(L.roster));
  check('LIGHT PROJECTION (§27): a board technician carries id, name, roster number, avatar, working/available, skills, rating — no pay, phone, e-mail or notes',
    roster.length > 0 && !roster.some((t) => 'phone' in t || 'email' in t || 'commission' in t || 'payRate' in t || 'notes' in t), short(L.roster.keys));
  const s200 = await timed('technicians.search#200', () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&search=${encodeURIComponent('#200')}&pageSize=12`));
  const loc = await timed('technicians.locate#200', () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&locate=${byNumber.get(200)?.technicianId}&pageSize=12`));
  check('SEARCH #200 + JUMP (§11/§12/§83): "#200" finds exactly technician #200; jump-to answers page 17 with #200 on it',
    s200.body?.total === 1 && s200.body?.technicians?.[0]?.rosterNumber === 200 && loc.body?.page === 17 && loc.body?.located?.technicianId === byNumber.get(200)?.technicianId,
    `search ${s200.status} ${short(s200.body?.technicians?.map((t) => t.rosterNumber))} locate ${loc.status} page ${loc.body?.page}`);
  const pediElig = await timed('technicians.serviceIds=pedi', () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&serviceIds=${S.pedi}&pageSize=12`));
  const acrElig = await timed('technicians.serviceIds=acrylic', () => rec.get(`/pos/booking/technicians?date=${TOMORROW}&serviceIds=${S.acrylic}&pageSize=12`));
  const dbPedi = (await q(`select count(distinct ts.technician_id)::int n from technician_services ts join technicians t on t.id = ts.technician_id and t.tenant_id = ts.tenant_id where ts.tenant_id = $1 and ts.service_id = $2 and t.is_active`, [T, S.pedi]).catch(() => [{ n: null }]))[0].n;
  L.eligibility = { pedi: pediElig.body?.total, acrylic: acrElig.body?.total, dbPedi };
  check('EXACT-SERVICE FILTER (§13/§14/§58/§84): only technicians approved for the exact service are offered — the pedicure filter matches the database count; acrylic is a smaller specialist pool',
    ok2(pediElig.status) && ok2(acrElig.status) && pediElig.body?.total > 0 && acrElig.body?.total > 0 && acrElig.body?.total < 200 && pediElig.body?.total < 200 && (dbPedi == null || dbPedi === pediElig.body?.total), short(L.eligibility));

  // ── 11b. a busy tomorrow: 1,000 more appointments, one page's day grid, openings over 200 ───────────────────────────
  const cohort = hires.filter((h) => h.id);
  const slots = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'];
  const want = Math.min(1000, cohort.length * slots.length);
  const tb = performance.now();
  const booked = await pool(Array.from({ length: want }, (_, i) => i), 8, async (i) => {
    const h = cohort[i % cohort.length], svc = h.kind === 'pedicure' ? S.pedi : S.gel;
    const r = await rec.post('/pos/booking/appointments', { customerName: `Large ${i + 1}`, customerPhone: `+1609554${String(i).padStart(4, '0')}`, serviceIds: [svc], technicianId: h.id, date: TOMORROW, startTime: slots[Math.floor(i / cohort.length)], source: 'manual' }, { 'idempotency-key': `pilot-large-${tag}-${i}` });
    return r.status;
  });
  L.busyDay = { requested: want, booked: booked.filter(ok2).length, ms: Math.round(performance.now() - tb) };
  const dayTotal = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and appt_date = $2 and status not in ('cancelled','canceled','no_show')`, [T, TOMORROW]).catch(() => [{ n: null }]))[0].n;
  L.busyDay.dayTotal = dayTotal;
  check(`A 200-TECHNICIAN BUSY DAY (§49/§50): ${want} more appointments booked tomorrow through the API (${L.busyDay.ms} ms, 8 at a time) — tomorrow now holds ${dayTotal} appointments`,
    L.busyDay.booked === want && dayTotal >= 1000, short(L.busyDay));
  const visible = (p1.body?.technicians ?? []).map((t) => t.technicianId);
  const grid = await timed('dayGrid.12ids', () => rec.get(`/pos/booking/day-grid?date=${TOMORROW}&technicianIds=${visible.join(',')}`));
  const gridAll = await timed('dayGrid.unscoped', () => rec.get(`/pos/booking/day-grid?date=${TOMORROW}`));
  const gridAppts = grid.body?.appointments ?? [];
  const dbVisible = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and appt_date = $2 and technician_id = any($3::uuid[]) and status not in ('cancelled','canceled','no_show')`, [T, TOMORROW, visible]).catch(() => [{ n: null }]))[0].n;
  check('DAY-BOARD REQUEST (§18/§52/§93): the board asks for its 12 visible technicians — 12 columns and exactly their appointments (matches the database), a fraction of the unscoped answer\'s size',
    ok2(grid.status) && (grid.body?.columns ?? []).length === 12 && gridAppts.every((a) => visible.includes(a.technicianId)) && (dbVisible == null || gridAppts.length === dbVisible) && L.perf['dayGrid.12ids'].bytes < L.perf['dayGrid.unscoped'].bytes,
    `cols ${(grid.body?.columns ?? []).length} appts ${gridAppts.length}/${dbVisible} bytes ${L.perf['dayGrid.12ids'].bytes} vs unscoped ${L.perf['dayGrid.unscoped'].bytes} (${(gridAll.body?.columns ?? []).length} columns)`);
  const st1 = await timed('state.page1', () => rec.get(`/pos/booking/state?date=${TOMORROW}&page=1&pageSize=50`));
  const opn = await timed('openings.pedi.top5', () => rec.get(`/pos/booking/openings?date=${TOMORROW}&serviceIds=${S.pedi}&limit=5`));
  const opnMore = await timed('openings.pedi.next5', () => rec.get(`/pos/booking/openings?date=${TOMORROW}&serviceIds=${S.pedi}&limit=5&offset=5`));
  const opnIds = [...(opn.body?.openings ?? []), ...(opnMore.body?.openings ?? [])].map((o) => o.technicianId);
  const pediIds = new Set((await q(`select technician_id from technician_services where tenant_id = $1 and service_id = $2`, [T, S.pedi]).catch(() => [])).map((r) => r.technician_id));
  check('FIND AN OPENING / BEST MATCHES OVER 200 (§15–§17/§85/§86): the top 5 and "View More" come from the server, only technicians approved for the exact service, no repeats, ranked by earliest time',
    ok2(opn.status) && (opn.body?.openings ?? []).length === 5 && new Set(opnIds).size === opnIds.length && (pediIds.size === 0 || opnIds.every((id) => pediIds.has(id)))
      && (opn.body?.openings ?? []).every((o, k, a) => k === 0 || a[k - 1].time <= o.time), `top ${short((opn.body?.openings ?? []).map((o) => `#${o.rosterNumber} ${o.time}`))} more ${short((opnMore.body?.openings ?? []).map((o) => `#${o.rosterNumber}`))} eligible ${opn.body?.eligibleCount}`);
  const lat = [];
  for (let k = 0; k < 10; k++) { const t = performance.now(); await rec.get(`/pos/booking/technicians?date=${TOMORROW}&page=${1 + (k % 17)}&pageSize=12`); lat.push(performance.now() - t); }
  L.perf.pageChange = { p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), samples: lat.length };
  info(`LATENCY (§24): technician page change p50 ${L.perf.pageChange.p50} ms / p95 ${L.perf.pageChange.p95} ms; day grid for 12 ${L.perf['dayGrid.12ids'].ms} ms (${L.perf['dayGrid.12ids'].bytes} B); board state ${L.perf['state.page1'].ms} ms (${L.perf['state.page1'].bytes} B); openings ${L.perf['openings.pedi.top5'].ms} ms`);
  check('PERFORMANCE TARGETS (§24): a technician page change answers in under 750 ms (p95) and the 12-column day grid in under 2 s on a 1,000-appointment day',
    L.perf.pageChange.p95 < 750 && L.perf['dayGrid.12ids'].ms < 2000, short({ pageChange: L.perf.pageChange, grid: L.perf['dayGrid.12ids'], state: L.perf['state.page1'] }));

  // ── 11c. booking concurrency: 20 desks, one technician, one minute ─────────────────────────────────────────────────
  // the slot comes from the SERVER's own open times for the service (store hours, the technician's schedule, lunch and
  // existing bookings already applied) — the race proves concurrency, not a store-hours / schedule / overlap refusal
  const gelOpen = await rec.get(`/pos/booking/openings?date=${TOMORROW}&serviceIds=${S.gel}&limit=10`);
  const slot = (gelOpen.body?.openings ?? []).find((o) => cohort.some((h) => h.id === o.technicianId)) ?? (gelOpen.body?.openings ?? [])[0] ?? null;
  const target = cohort.find((h) => h.id === slot?.technicianId) ?? { id: slot?.technicianId ?? cohort.find((h) => h.kind === 'generalist')?.id };
  const RACE_AT = String(slot?.time ?? '10:00').slice(0, 5);
  const race = await Promise.all(Array.from({ length: 20 }, (_, k) => rec.post('/pos/booking/appointments', { customerName: `Racer ${k}`, serviceIds: [S.gel], technicianId: target.id, date: TOMORROW, startTime: RACE_AT, source: 'manual' }, { 'idempotency-key': `pilot-race20-${tag}-${k}` })));
  const wins = race.filter((r) => ok2(r.status)), losses = race.filter((r) => r.status === 409);
  const dbAt = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and appt_date = $3 and start_time = $4 and status not in ('cancelled','canceled')`, [T, target.id, TOMORROW, RACE_AT]).catch(() => [{ n: null }]))[0].n;
  L.race = { wins: wins.length, conflicts: losses.length, other: race.filter((r) => !ok2(r.status) && r.status !== 409).map((r) => r.status), db: dbAt, freshAvailability: !!losses[0]?.body?.freshAvailability, firstOther: race.find((r) => !ok2(r.status) && r.status !== 409)?.body ?? null, slot: slot ? `${RACE_AT}` : `openings ${gelOpen.status}` };
  check('BOOKING CONCURRENCY (§59/§87): 20 front desks book the same technician at the same minute at once → exactly ONE appointment; the other 19 are 409 APPOINTMENT_CONFLICT (with fresh open times)',
    wins.length === 1 && losses.length === 19 && dbAt === 1 && losses.every((r) => r.body?.code === 'APPOINTMENT_CONFLICT'), short(L.race));

  // ── 11d. the Technician App for #1, #25, #100, #193, #200 ──────────────────────────────────────────────────────────
  const known = new Map([...hires.map((h) => [h.id, h]), ...(extra ?? []).filter((x) => x.id).map((x) => [x.id, x])]);
  const apps = {};
  for (const n of REPRESENTATIVE) {
    const t = byNumber.get(n); const h = t ? known.get(t.technicianId) : null; const row = { n, technicianId: t?.technicianId ?? null };
    try {
      const token = h?.acceptUrl ? new URL(h.acceptUrl).searchParams.get('token') : null;
      const acc = token ? await pub.post('/public/website/invitations/accept', { token, password: STAFF_PW, fullName: t.name }) : { status: 0 };
      const aa = await own.patch(`/pos/technicians/${t.technicianId}/app-access`, { enabled: true });
      const s = session(`tech-${n}`); const li = await tenantLogin(s, h?.email, STAFF_PW, B);
      const me = await s.get('/auth/me');
      const sched = await s.get(`/tech/schedule?date=${TOMORROW}`);
      const items = Array.isArray(sched.body) ? sched.body : (sched.body?.appointments ?? sched.body?.items ?? []);
      const mineDb = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and appt_date = $3 and status not in ('cancelled','canceled','no_show')`, [T, t.technicianId, TOMORROW]).catch(() => [{ n: null }]))[0].n;
      const ref = await s.post('/auth/refresh', {});
      const dash = await s.get('/tech');
      const cookies = [...s.jar.values()].join('; ');
      const out = await s.post('/auth/logout', {});
      const replay = await fetch(env.API + '/tech', { headers: { cookie: cookies } }).then((r) => r.status);
      const s2 = session(`tech-${n}-again`); const li2 = await tenantLogin(s2, h?.email, STAFF_PW, B);
      const bad = await session(`tech-${n}-bad`).post('/auth/login', { portal: 'tenant', salonCode: env.SALON_CODE, identifier: h?.email, password: STAFF_PW + 'x' });
      Object.assign(row, { accept: acc.status, appAccess: aa.status, login: li.l?.status, select: li.sel?.status, me: me.status, meScoped: JSON.stringify(me.body ?? {}).includes(T), schedule: sched.status, scheduleItems: items.length, scheduleDb: mineDb,
        scheduleOnlyMine: items.every((a) => !a.technicianId || a.technicianId === t.technicianId), refresh: ref.status, dashboard: dash.status, logout: out.status, oldCookieAfterLogout: replay, relogin: li2.l?.status, wrongPassword: bad.status });
      row.pass = !!token && ok2(acc.status) && ok2(aa.status) && li.ok && me.status === 200 && row.meScoped && sched.status === 200 && row.scheduleOnlyMine && (mineDb == null || items.length === mineDb)
        && ok2(ref.status) && dash.status === 200 && ok2(out.status) && replay === 401 && li2.ok && bad.status === 401;
      apps[n] = { s: s2, id: t.technicianId };
    } catch (e) { row.pass = false; row.error = String(e?.message || e).slice(0, 200); }
    L.matrix[`#${n}`] = row;
    check(`TECH APP LOGIN #${n} (§36–§38/§78/§79): invited → accepted → app access → signs in (tenant + branch from the server) → MY schedule only → refresh → logout kills the old cookie → signs in again; a wrong password is refused`, row.pass, short(row));
  }
  // §80: #100 cannot read #101's pay, the salon's payroll or the owner's numbers
  const a100 = apps[100];
  const t101 = byNumber.get(101)?.technicianId;
  if (a100 && t101) {
    const probes = {
      otherPaySummary: (await a100.s.get(`/pos/technicians/${t101}/payroll-summary`)).status,
      otherCommission: (await a100.s.get(`/pos/technicians/${t101}/commission`)).status,
      ownerPayroll: (await a100.s.get('/owner/payroll')).status,
      ownerPaychecks: (await a100.s.get('/owner/payroll/paychecks/summary')).status,
      salonTechList: (await a100.s.get('/pos/technicians?page=1&pageSize=50')).status,
    };
    const myPay = await a100.s.get('/tech/payroll');
    L.attack = { ...probes, myPayroll: myPay.status, myPayrollMentions101: JSON.stringify(myPay.body ?? {}).includes(t101) };
    check('PERMISSION ATTACKS (§40/§80): technician #100 is DENIED #101\'s pay summary and commission, the owner\'s payroll and paychecks, and the salon\'s technician list; her own payroll answers and never mentions #101',
      Object.values(probes).every((s) => s === 401 || s === 403) && myPay.status === 200 && !L.attack.myPayrollMentions101, short(L.attack));
  } else check('PERMISSION ATTACKS (§80): technician #100 signed in to probe', false, short({ a100: !!a100, t101 }));
  // §66 (Oct 27 2026): CROSS-TENANT — technician #100 of THIS salon against ANOTHER salon's technician, payroll and branch.
  // The other salon is salon B of phase 10f (its owner hired one technician there); its ids are read from
  // the database the way an attacker would have harvested them. Every route must answer 401/403/404, a tenant / branch
  // header or query naming the other salon must change nothing, and no answer may carry the other salon's ids.
  const other = (await q(`select t.id as tech, t.tenant_id as tenant, t.branch_id as branch from technicians t where t.tenant_id <> $1 and t.is_active order by t.created_at desc limit 1`, [T]))[0];
  if (a100 && other) {
    const h = { 'x-tenant-id': other.tenant, 'x-branch-id': other.branch ?? '' };
    const xt = {
      techProfile: await a100.s.get(`/pos/technicians/${other.tech}`),
      techPaySummary: await a100.s.get(`/pos/technicians/${other.tech}/payroll-summary`),
      techCommission: await a100.s.get(`/pos/technicians/${other.tech}/commission`),
      techSchedule: await a100.s.get(`/pos/technicians/${other.tech}/schedule`),
      selectOtherBranch: other.branch ? await a100.s.post('/auth/select-branch', { branchId: other.branch }) : { status: 403, body: null },
      myPayrollWithHeaders: await a100.s.call('GET', `/tech/payroll?tenantId=${other.tenant}`, undefined, h),
      myScheduleWithHeaders: await a100.s.call('GET', `/tech/schedule?date=${TOMORROW}&tenantId=${other.tenant}&technicianId=${other.tech}`, undefined, h),
    };
    // a leak = an ANSWER (2xx) carrying the other salon's ids (a refusal may echo the path the caller sent; that is not data)
    const leaks = Object.entries(xt).filter(([, r]) => ok2(r.status) && (JSON.stringify(r.body ?? {}).includes(other.tech) || JSON.stringify(r.body ?? {}).includes(other.tenant))).map(([k]) => k);
    const ownAnswers = ok2(xt.myPayrollWithHeaders.status) && ok2(xt.myScheduleWithHeaders.status);   // her own data still answers — the header / query was ignored, not obeyed
    const denied = ['techProfile', 'techPaySummary', 'techCommission', 'techSchedule', 'selectOtherBranch'].every((k) => [401, 403, 404].includes(xt[k].status));
    L.crossTenant = { ...Object.fromEntries(Object.entries(xt).map(([k, r]) => [k, r.status])), leaks };
    check('CROSS-TENANT (§66): technician #100 is refused another salon\'s technician profile, pay summary, commission and schedule and cannot select its branch (401/403/404); a tenant / branch header or query naming the other salon changes nothing (her own payroll and schedule still answer) — no answer carries the other salon\'s ids',
      denied && leaks.length === 0 && ownAnswers && ![200, 201].includes(xt.selectOtherBranch.status), short(L.crossTenant));
  } else info(`CROSS-TENANT (§66): no other salon in this database to probe against (fresh DB) — ${short({ a100: !!a100, other: !!other })}`);

  // ── 11e. Clock-In burst: 100 technicians at the opening ────────────────────────────────────────────────────────────
  const avoid = (techDef ?? []).map((t) => t.pin);
  const burst = cohort.filter((h) => !h.offToday).slice(0, 100);
  const pins = pinsFor(burst.length, avoid);
  const resets = await pool(burst, 6, async (h, k) => (await own.post(`/pos/technician-clock/technicians/${h.id}/clock-pin/reset`, { pin: pins[k] })).status);
  const dupPin = await own.post(`/pos/technician-clock/technicians/${burst[1].id}/clock-pin/reset`, { pin: pins[0] });
  check('PIN SAFETY (§47): 100 Clock PINs set by the manager, unique within this salon; giving a second technician a PIN already in use is refused (409 PIN_IN_USE)',
    resets.every(ok2) && dupPin.status === 409 && dupPin.body?.code === 'PIN_IN_USE', `resets ${resets.filter(ok2).length}/${resets.length} dup ${dupPin.status} ${short(dupPin.body)}`);
  const shiftsBefore = (await q(`select count(*)::int n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n;
  const joinsBefore = (await q(`select count(*)::int n from technician_turn_events where tenant_id = $1 and event_type = 'JOIN'`, [T]))[0].n;
  const tc = performance.now();
  const clk = await Promise.all(burst.map((h, k) => { const t = performance.now(); return kiosk('POST', '/technician/clock-in', { pin: pins[k], idempotencyKey: `large-clock-${tag}-${k}` }).then((r) => ({ status: r.status, ms: performance.now() - t, body: r.body })); }));
  const clkMs = Math.round(performance.now() - tc);
  const replayClk = await Promise.all(burst.slice(0, 20).map((h, k) => kiosk('POST', '/technician/clock-in', { pin: pins[k], idempotencyKey: `large-clock-${tag}-${k}` })));
  const shiftsAfter = (await q(`select count(*)::int n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n;
  const dupShifts = (await q(`select count(*)::int n from (select technician_id from technician_shifts where tenant_id = $1 and end_time is null and status = 'active' group by technician_id having count(*) > 1) x`, [T]))[0].n;
  const joinsAfter = (await q(`select count(*)::int n from technician_turn_events where tenant_id = $1 and event_type = 'JOIN'`, [T]))[0].n;
  L.clockBurst = { technicians: burst.length, ok: clk.filter((r) => ok2(r.status)).length, statuses: [...new Set(clk.map((r) => r.status))], wallMs: clkMs, p50: Math.round(pct(clk.map((r) => r.ms), 50)), p95: Math.round(pct(clk.map((r) => r.ms), 95)), newShifts: shiftsAfter - shiftsBefore, duplicateOpenShifts: dupShifts, newJoins: joinsAfter - joinsBefore, replayOk: replayClk.filter((r) => ok2(r.status)).length };
  check(`CLOCK-IN BURST (§46/§89): 100 technicians clock in on the kiosk by PIN at once (${clkMs} ms wall, p95 ${L.clockBurst.p95} ms) → 100 open shifts and 100 rotation joins, no technician with two open shifts; 20 replayed taps write nothing new`,
    L.clockBurst.ok === 100 && L.clockBurst.newShifts === 100 && dupShifts === 0 && L.clockBurst.newJoins === 100 && L.clockBurst.replayOk === 20
      && (await q(`select count(*)::int n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n === shiftsAfter, short(L.clockBurst));

  // ── 11f. Walk-in burst: 30 guests on the kiosk at once ─────────────────────────────────────────────────────────────
  const qBefore = (await q(`select count(*)::int n from pos_queue_items where tenant_id = $1`, [T]))[0].n;
  const wb = performance.now();
  const walks = await Promise.all(Array.from({ length: 30 }, (_, k) => kiosk('POST', '/check-in-walk-in', { customerName: `Burst Guest ${k + 1}`, phone: `+1609559${String(k).padStart(4, '0')}`, serviceIds: [k % 2 ? S.pedi : S.gel], addOnIds: [] })));
  const qAfter = (await q(`select count(*)::int n from pos_queue_items where tenant_id = $1`, [T]))[0].n;
  const qIds = walks.map((w) => w.body?.queueItemId).filter(Boolean);
  L.walkBurst = { ok: walks.filter((w) => ok2(w.status)).length, statuses: [...new Set(walks.map((w) => w.status))], distinctQueueItems: new Set(qIds).size, newRows: qAfter - qBefore, ms: Math.round(performance.now() - wb) };
  check('WALK-IN BURST (§88): 30 guests check in on the kiosk at the same moment → 30 distinct queue items, none lost or doubled',
    L.walkBurst.ok === 30 && L.walkBurst.distinctQueueItems === 30 && L.walkBurst.newRows === 30, short(L.walkBurst));
  // the Tech Queue / POS queue with 100 clocked in: paged / windowed, never an uncontrolled giant list (§33)
  const tq = await timed('posQueue.state', () => rec.get('/pos/queue/state'));
  info(`POS queue state with 100 technicians clocked in and ${qAfter} queue items: ${tq.status} in ${L.perf['posQueue.state'].ms} ms, ${L.perf['posQueue.state'].bytes} B`);
  for (const id of qIds) await rec.post(`/pos/queue/items/${id}/cancel`, { reason: 'pilot burst probe' }).catch(() => undefined);

  // ── 11g. database evidence: EXPLAIN ANALYZE of the large-salon reads (§25/§92) ─────────────────────────────────────
  const explain = async (label, sqlText, params) => {
    try {
      const rows = await q(`explain (analyze, buffers, format json) ${sqlText}`, params);
      const plan = rows[0]['QUERY PLAN'][0];
      const nodes = []; const walk = (n) => { nodes.push(`${n['Node Type']}${n['Relation Name'] ? ' on ' + n['Relation Name'] : ''}${n['Index Name'] ? ' using ' + n['Index Name'] : ''}`); (n.Plans ?? []).forEach(walk); }; walk(plan.Plan);
      L.explain[label] = { executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], seqScans: nodes.filter((x) => x.startsWith('Seq Scan')), nodes: nodes.slice(0, 12) };
    } catch (e) { L.explain[label] = { error: String(e?.message || e).slice(0, 200) }; }
  };
  await explain('appointments: one day, 12 technicians', `select id, technician_id, start_time, end_time, status from pos_tech_appointments where tenant_id = $1 and branch_id = $4 and appt_date = $2 and technician_id = any($3::uuid[])`, [T, TOMORROW, visible, B]);
  await explain('appointments: one day, whole salon', `select id, technician_id, start_time, end_time, status from pos_tech_appointments where tenant_id = $1 and branch_id = $3 and appt_date = $2`, [T, TOMORROW, B]);
  await explain('technician roster (board paging)', `select id, full_name, is_active from technicians where tenant_id = $1 and (branch_id = $2 or branch_id is null) order by full_name, id`, [T, B]);
  await explain('exact-service eligibility (one service)', `select technician_id from technician_services where tenant_id = $1 and service_id = $2`, [T, S.pedi]);
  await explain('weekly schedules (200)', `select technician_id, day_of_week, start_time, end_time from technician_schedules where tenant_id = $1 and branch_id = $2`, [T, B]);
  await explain('clock PIN identify (keyed digest)', `select technician_id from technician_clock_pins where tenant_id = $1 and pin_lookup = $2`, [T, 'x'.repeat(64)]);
  await explain('open shifts (time clock)', `select technician_id from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]);
  const slow = Object.entries(L.explain).filter(([, v]) => v.executionMs != null && v.executionMs > 50);
  info(`EXPLAIN ANALYZE: ${Object.entries(L.explain).map(([k, v]) => `${k} ${v.executionMs != null ? v.executionMs.toFixed(2) + ' ms' : v.error}${v.seqScans?.length ? ' [' + v.seqScans.join(', ') + ']' : ''}`).join(' | ')}`);
  check('DATABASE EVIDENCE (§25/§92): every large-salon read was EXPLAIN ANALYZEd on the real PostgreSQL; none takes over 50 ms at 200 technicians / 1,000+ appointments a day',
    Object.values(L.explain).every((v) => v.executionMs != null) && slow.length === 0, short(slow.length ? slow : Object.fromEntries(Object.entries(L.explain).map(([k, v]) => [k, v.executionMs]))));
  // the live objects the M5 continuation (lib/pilot-large-salon-m5.mjs) builds on — not part of the JSON evidence
  Object.defineProperty(L, 'rt', { enumerable: false, value: { apps, byNumber, hires, cohort, known, svcsOf, visible, burst, pins } });
  return L;
}
