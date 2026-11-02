// pilot-large-salon-m5.mjs — PHASE 11 (continued) of live-pilot-day.mjs: what the 200-Technician mandate still asked for
// after lib/pilot-large-salon.mjs (M5, Oct 24 2026). Same salon, same running API, same PostgreSQL; bulk fixtures only
// where the mandate allows them (the payroll week's sales / time-clock facts), every ASSERTION through the real API and,
// where a screen is required, the real built app in Chromium:
//   11h  pagination edge totals 0 · 1 · 11 · 12 · 13 · 24 · 25 · 200 (exact page counts, last-page sizes, clamping)
//   11i  500 / 1,000 / 2,000-record days booked through the API — every one of 17 pages' day grids summed against the DB,
//        latency + payload per volume
//   11j  realtime fan-out to 50+ live streams (technician phones + POS screens): one copy each, latency; targeted rooms
//   11k  the Booking board in Chromium: 17 pages × 3 rounds (heap / DOM nodes / listeners / ≤ 12 columns), then #150's
//        schedule change + a noisy #150 while page 1 is on screen (no grid refetch), a visible change (grid refetch)
//   11l  #193 assigned while the board is on page 1 → #193's phone app updates live; a phone that missed it reconnects
//   11m  #150's schedule change reaches availability (others unchanged) · #120's break leaves Fair Turn and comes back
//   11n  the Technician App at phone size for #1/#25/#100/#193/#200 — nine screens each, every API answer 2xx, #100's
//        screens never carry #101's data
//   11o  200-technician weekly payroll through the API: commission / tips / hourly / salary / bonus / guarantee /
//        deductions, 50 % check + 50 % cash → 400 payout instructions, every cent; exceptions-only filter; approve
//        selected (hold the exceptions) → approve each held one
//   11p  roster changes: #201 hired (201 → 17 pages, last 9), #50 deactivated (history kept, assignment refused),
//        a technician TRANSFERRED to a new branch (old branch history private, new branch eligible) → 199
//   11q  the 200-Tech Pilot Matrix + the Technician App Login Matrix (numbers.large.m5.matrix*)
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const bytes = (b) => Buffer.byteLength(typeof b === 'string' ? b : JSON.stringify(b ?? null));
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

/** A Server-Sent-Events client over fetch (what a phone / POS tab holds open): frames with their arrival time. */
function sseClient(API, path, cookie, { lastEventId = null, label = '' } = {}) {
  const ac = new AbortController(); const frames = []; const dec = new TextDecoder(); let buf = ''; let status = 0; let lastId = null; let ended = false;
  const done = fetch(API + path, { headers: { cookie, accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) }, signal: ac.signal }).then(async (r) => {
    status = r.status;
    if (!r.body) return;
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, k); buf = buf.slice(k + 2);
        let id = null; const data = [];
        for (const line of raw.split('\n')) { if (line.startsWith('id:')) id = line.slice(3).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trim()); }
        if (!data.length) continue;
        let d = null; try { d = JSON.parse(data.join('\n')); } catch { d = { raw: data.join('\n') }; }
        if (id) lastId = id;
        frames.push({ t: Date.now(), id, d });
      }
    }
  }).catch(() => undefined).finally(() => { ended = true; });
  return { label, frames, done, status: () => status, lastId: () => lastId, ended: () => ended, close: () => { ac.abort(); } };
}
const waitFor = async (fn, ms, every = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, every)); } return !!(await fn()); };

/** The salon's API is rate limited (TenantRateLimitGuard, since M4: 24,000 requests / minute per location and 2,000 per
 *  signed-in session). This phase is a LOAD GENERATOR as well as a test: its requests are paced — ≤ `perSec` overall
 *  (PILOT_M5_RPS, default 30) and ≤ PILOT_M5_CLIENT_RPS per session (default 30 = 1,800 / minute, under one client's
 *  budget) — and a 429 is honoured — it waits the Retry-After and sends again, as a well-behaved client does — and every
 *  429 is counted for the report. The bulk-booking days spread over four front-desk sessions (four desks booking at once).
 *  Assertions read the answer that finally came back; a 429 is never mistaken for a pass. */
export function pacer(perSec, stats, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let next = 0;
  const slot = async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / perSec; if (at > now) await sleep(at - now); };
  return async (fn) => {
    for (let k = 0; k < 20; k++) {
      await slot();
      const r = await fn();
      if (r?.status !== 429) return r;
      stats.rateLimited++;
      await sleep(((Number(r.body?.retryAfterSeconds) || 1) * 1000) + 250);
    }
    return fn();
  };
}
const CLIENT_RPS = Number(process.env.PILOT_M5_CLIENT_RPS || 30);
export const pacedSession = (s, run, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) => {
  let next = 0;   // this session's own pace (one client's budget), then the phase-wide pacer
  const mine = (fn) => async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / CLIENT_RPS; if (at > now) await sleep(at - now); return fn(); };
  return { ...s, get: (p) => run(mine(() => s.get(p))), post: (p, b, x) => run(mine(() => s.post(p, b, x))), patch: (p, b, x) => run(mine(() => s.patch(p, b, x))), put: (p, b, x) => run(mine(() => s.put(p, b, x))) };
};

export async function largeSalonM5Phase(env, L) {
  const stats = { rateLimited: 0 };
  const run = pacer(Number(process.env.PILOT_M5_RPS || 30), stats, env.sleep);
  const own = pacedSession(env.own, run, env.sleep), rec = pacedSession(env.rec, run, env.sleep), mgr = pacedSession(env.mgr, run, env.sleep);
  const session = (label) => pacedSession(env.session(label), run, env.sleep);
  const { sa, pub, check, info, q, ctx, B, T, tag, TOMORROW, TODAY, week, STAFF_PW, OWNER_PW, TZ, extra, techDef, techSessions, short, ok2, API, openLive, SCREENS, sleep, d } = env;
  const tenantLogin = (s, ...a) => env.tenantLogin(s, ...a);
  const rt = L.rt; const S = ctx.services;
  const M = L.m5 = { edges: {}, volumes: {}, perf: {}, realtime: {}, board: {}, screens: {}, payroll: {}, roster: {}, matrix200: {}, loginMatrix: {} };
  const R = {};   // check outcomes by key → the matrices
  const ck = (key, name, ok, detail) => { const r = check(name, ok, detail); R[key] = R[key] === undefined ? !!r : R[key] && !!r; return r; };
  const sec = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran to the end`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); } };
  const byNumber = rt.byNumber; const idOf = (n) => byNumber.get(n)?.technicianId ?? null;
  /** wait until this salon's outbox is published (the realtime projection runs from it); ms waited, or null at the cap */
  const outboxDrained = async (capMs = 240_000) => { const t0 = Date.now(); for (;;) { const n = (await q(`select count(*)::int n from outbox_events where tenant_id = $1 and publish_status in ('pending','claimed')`, [T]))[0].n; if (n === 0) return Date.now() - t0; if (Date.now() - t0 > capMs) return null; await sleep(250); } };
  const step = async () => (await own.post('/auth/step-up', { password: OWNER_PW })).status;
  // every active technician's services (what the API was told at hire), and the one service a booking for them uses
  const svcsOf = new Map();
  for (const h of rt.hires) if (h.id) svcsOf.set(h.id, h.svcs);
  for (const x of extra ?? []) if (x.id) svcsOf.set(x.id, x.pediOnly ? [S.pedi] : [S.gel, S.pedi, S.addOn]);
  for (const t of techDef ?? []) if (t.id) svcsOf.set(t.id, t.svcs.map((k) => S[k]));
  const DUR = { [S.gel]: 45, [S.pedi]: 60, [S.acrylic]: 75, [S.addOn]: 15 };
  const rosterAll = []; for (let n = 1; n <= 200; n++) if (idOf(n)) rosterAll.push({ n, id: idOf(n) });

  // ── 11h. pagination edge totals ────────────────────────────────────────────────────────────────────────────────────
  const edge = async (label, query, n) => {
    const get = (p) => rec.get(`/pos/booking/technicians?date=${TOMORROW}&pageSize=12&page=${p}${query ? '&' + query : ''}`);
    const p1 = await get(1);
    const want = Math.max(1, Math.ceil(n / 12)); const lastSize = n === 0 ? 0 : n - 12 * (want - 1);
    const pages = [p1]; for (let p = 2; p <= (p1.body?.totalPages ?? 1) && p <= 40; p++) pages.push(await get(p));
    const over = await get(want + 3);
    const all = pages.flatMap((r) => r.body?.technicians ?? []);
    const row = { total: p1.body?.total, totalPages: p1.body?.totalPages, pageSizes: pages.map((r) => (r.body?.technicians ?? []).length), distinct: new Set(all.map((t) => t.technicianId)).size,
      beyondLast: { page: over.body?.page, size: (over.body?.technicians ?? []).length } };
    row.ok = p1.status === 200 && row.total === n && row.totalPages === want && row.pageSizes.every((x) => x <= 12) && row.pageSizes.reduce((a, b) => a + b, 0) === n && row.distinct === n
      && row.pageSizes[row.pageSizes.length - 1] === lastSize && row.pageSizes.slice(0, -1).every((x) => x === 12) && over.body?.page === want && row.beyondLast.size === lastSize;
    M.edges[label] = row;
    return row;
  };
  await sec('11h pagination edges', async () => {
    const pr = await own.post('/pos/services', { name: `Edge Probe ${tag}`, categoryId: S.category, priceCents: 1000, durationMinutes: 15, commissionType: 'percent', commissionValue: 50, status: 'active' });
    const PROBE = pr.body?.id ?? pr.body?.serviceId ?? pr.body?.service?.id;
    const order = rt.hires.filter((h) => h.id);   // roster #1…#176 in hire order
    let have = 0; const rows = {};
    for (const n of [0, 1, 11, 12, 13, 24, 25]) {
      while (have < n) { const h = order[have]; await own.patch(`/pos/technicians/${h.id}/services`, { serviceIds: [...h.svcs, PROBE] }); have++; }
      rows[n] = await edge(String(n), `serviceIds=${PROBE}`, n);
    }
    rows[200] = await edge('200', '', 200);
    // put the 25 back as they were (the probe service is only a counter)
    for (let i = 0; i < have; i++) await own.patch(`/pos/technicians/${order[i].id}/services`, { serviceIds: order[i].svcs });
    ck('edges', 'PAGINATION EDGES (§94): totals 0 · 1 · 11 · 12 · 13 · 24 · 25 · 200 through GET /pos/booking/technicians (an exact-service filter assigned to that many technicians; 200 = the whole roster) — totalPages = ⌈n/12⌉ (1 when empty), every page full but the last, last-page size n − 12·(pages−1), each technician once, a page past the end answers the last page',
      ok2(pr.status) && !!PROBE && Object.values(rows).every((r) => r.ok), short(Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, `${r.ok ? 'ok' : 'BAD'} ${r.total}/${r.totalPages}p last ${r.pageSizes.at(-1)} beyond ${r.beyondLast.page}:${r.beyondLast.size}`]))));
  });

  // ── 11i. 500 / 1,000 / 2,000-record days ───────────────────────────────────────────────────────────────────────────
  await sec('11i volumes', async () => {
    const g0 = await rec.get(`/pos/booking/day-grid?date=${d(2)}&technicianIds=${idOf(1)}`);
    const buffer = Number(g0.body?.bufferMinutes ?? 5), slot = Number(g0.body?.slotIntervalMinutes ?? 15);
    const next = (m) => Math.ceil(m / slot) * slot;
    // each technician's day, filled greedily with the services she is approved for (shortest pattern first)
    const plan = (techId) => {
      const sv = svcsOf.get(techId) ?? [];
      const pattern = sv.includes(S.gel) && sv.includes(S.addOn) ? [S.gel, S.addOn] : sv.includes(S.gel) ? [S.gel] : sv.includes(S.pedi) ? [S.pedi] : sv.slice(0, 1);
      const out = []; let at = 9 * 60, k = 0;
      while (pattern.length) {
        const svc = pattern[k % pattern.length]; const end = at + (DUR[svc] ?? 45);
        if (at < 13 * 60 + 30 && end > 13 * 60) { at = 13 * 60 + 30; continue; }   // lunch 13:00–13:30
        if (end > 19 * 60) break;
        out.push({ svc, start: hm(at) }); k++; at = next(end + buffer);
      }
      return out;
    };
    const plans = rosterAll.map((r) => ({ ...r, slots: plan(r.id) }));
    const rounds = Math.max(...plans.map((p) => p.slots.length));
    const candidates = []; for (let k = 0; k < rounds; k++) for (const p of plans) if (p.slots[k]) candidates.push({ techId: p.id, ...p.slots[k] });
    M.volumes.capacity = candidates.length;
    const sweep = async (date) => {
      const lat = [], sizes = []; let apptSum = 0; const seen = new Set(); let maxCols = 0; let dup = 0;
      for (let p = 1; p <= 17; p++) {
        const tp = await rec.get(`/pos/booking/technicians?date=${date}&page=${p}&pageSize=12`);
        const ids = (tp.body?.technicians ?? []).map((t) => t.technicianId);
        const t0 = performance.now(); const g = await rec.get(`/pos/booking/day-grid?date=${date}&technicianIds=${ids.join(',')}`); lat.push(performance.now() - t0);
        sizes.push(bytes(g.body)); maxCols = Math.max(maxCols, (g.body?.columns ?? []).length);
        for (const a of g.body?.appointments ?? []) { if (!a.technicianId || !ids.includes(a.technicianId) || ['cancelled', 'canceled', 'no_show'].includes(a.status)) continue; if (seen.has(a.appointmentId)) dup++; seen.add(a.appointmentId); apptSum++; }
      }
      const st0 = performance.now(); const st = await rec.get(`/pos/booking/state?date=${date}&page=1&pageSize=100`); const stMs = performance.now() - st0;
      const op0 = performance.now(); const op = await rec.get(`/pos/booking/openings?date=${date}&serviceIds=${S.gel}&limit=5`); const opMs = performance.now() - op0;
      const db = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and branch_id = $2 and appt_date = $3 and status not in ('cancelled','canceled','no_show')`, [T, B, date]))[0].n;
      return { date, db, gridSum: apptSum, duplicates: dup, maxColumns: maxCols, listTotal: st.body?.bookings?.pagination?.totalItems, listPages: st.body?.bookings?.pagination?.totalPages,
        gridP50: Math.round(pct(lat, 50)), gridP95: Math.round(pct(lat, 95)), gridMaxBytes: Math.max(...sizes), stateMs: Math.round(stMs), stateBytes: bytes(st.body), openingsMs: Math.round(opMs), openingsTop: (op.body?.openings ?? []).length, eligible: op.body?.eligibleCount };
    };
    // four front desks book at once (the receptionist signed in on four POS stations — four sessions, four client budgets)
    const recEmail = (await q(`select email from users where tenant_id = $1 and email like 'rec.%' and status = 'active' order by created_at limit 1`, [T]))[0]?.email;
    const desks = [rec];
    for (let k = 1; k < 4 && recEmail; k++) { const s2 = env.session(`desk${k}`); const li = await tenantLogin(s2, recEmail, STAFF_PW, B); if (li?.ok) desks.push(pacedSession(s2, run, sleep)); }
    info(`VOLUME: ${desks.length} front-desk session(s) book the volume days`);
    const day = async (label, date, n) => {
      let made = { requested: 0, booked: 0, ms: 0 };
      if (n != null) {
        const want = candidates.slice(0, n); const t0 = performance.now();
        const st = await pool(want, 8, async (c, i) => (await desks[i % desks.length].post('/pos/booking/appointments', { customerName: `Vol${label} ${i + 1}`, customerPhone: `+1609${label.length}${String(i).padStart(6, '0')}`, serviceIds: [c.svc], technicianId: c.techId, date, startTime: c.start, source: 'manual' }, { 'idempotency-key': `vol-${label}-${tag}-${i}` })).status);
        made = { requested: want.length, booked: st.filter(ok2).length, ms: Math.round(performance.now() - t0), statuses: [...new Set(st)] };
      }
      const sw = await sweep(date);
      M.volumes[label] = { ...made, ...sw };
      return M.volumes[label];
    };
    const v500 = await day('500', d(2), 500);
    const v1000 = await day('1000', d(3), 1000);
    const v2000 = await day('2000', d(4), 2000);
    const vBusy = await day('busy-tomorrow', TOMORROW, null);
    for (const [k, v] of [['500', v500], ['1000', v1000], ['2000', v2000]]) {
      ck('volume', `VOLUME ${k} (§50): ${v.requested} appointments booked through the API for ${v.date} (${v.ms} ms, 8 at a time; capacity ${M.volumes.capacity}) — the 17 pages of 12 day grids hold exactly the database's ${v.db} (no duplicate, ≤ 12 columns), the list says ${v.listTotal} in ${v.listPages} pages of 100; grid p50 ${v.gridP50} / p95 ${v.gridP95} ms, largest ${v.gridMaxBytes} B; state ${v.stateMs} ms; openings ${v.openingsMs} ms`,
        v.booked === Number(k) && v.db === Number(k) && v.gridSum === v.db && v.duplicates === 0 && v.maxColumns <= 12 && v.listTotal === v.db && v.listPages === Math.ceil(v.db / 100) && v.gridP95 < 2000 && v.openingsTop === 5, short(v));
    }
    ck('volume', `VOLUME — the busy tomorrow (${vBusy.db} records): 17 day grids sum to the database, grid p95 ${vBusy.gridP95} ms`, vBusy.gridSum === vBusy.db && vBusy.duplicates === 0 && vBusy.maxColumns <= 12 && vBusy.listTotal === vBusy.db, short(vBusy));
  });

  // ── technician phones for the realtime work: the five representative app accounts + 45 more invited and signed in ──
  const phones = [];   // { n, id, s }
  for (const n of [1, 25, 100, 193, 200]) if (rt.apps[n]) phones.push({ n, id: rt.apps[n].id, s: rt.apps[n].s });
  await sec('11j invite 45 more phones', async () => {
    const taken = new Set(phones.map((p) => p.id));
    const more = rt.hires.filter((h) => h.id && h.acceptUrl && !taken.has(h.id)).slice(0, 45);
    const made = await pool(more, 4, async (h) => {
      const token = new URL(h.acceptUrl).searchParams.get('token');
      const acc = await pub.post('/public/website/invitations/accept', { token, password: STAFF_PW, fullName: h.name });
      const aa = await own.patch(`/pos/technicians/${h.id}/app-access`, { enabled: true });
      const s = session(`phone-${h.i}`); const li = await tenantLogin(s, h.email, STAFF_PW, B);
      return { h, ok: ok2(acc.status) && ok2(aa.status) && li.ok, s, acc: acc.status, aa: aa.status, login: li.l?.status };
    });
    for (const m of made) if (m.ok) phones.push({ n: [...byNumber.values()].find((t) => t.technicianId === m.h.id)?.rosterNumber ?? null, id: m.h.id, s: m.s, hire: m.h });
    ck('fanout', `TECH APP AT SCALE: 45 more technicians invited → accepted → app access → signed in (${made.filter((m) => m.ok).length}/45) — ${phones.length} technician phones with their own session`, made.every((m) => m.ok), short(made.filter((m) => !m.ok).map((m) => [m.h.name, m.acc, m.aa, m.login]).slice(0, 4)));
  });

  // ── 11j. realtime fan-out to 50+ streams ───────────────────────────────────────────────────────────────────────────
  const cookieOf = (s) => [...s.jar.values()].join('; ');
  const streams = [];
  const closeAll = () => { for (const c of streams) c.close(); };
  const techStreamOf = new Map();
  await sec('11j fan-out', async () => {
    for (const p of phones) { const c = sseClient(API, '/tech/stream', cookieOf(p.s), { label: `tech#${p.n}` }); streams.push(c); techStreamOf.set(p.id, c); await sleep(40); }
    const posStreams = [];
    for (const [k, s] of [['rec-1', rec], ['rec-2', rec], ['rec-3', rec], ['mgr', mgr], ['owner', own]]) { const c = sseClient(API, '/realtime/stream', cookieOf(s), { label: `pos:${k}` }); streams.push(c); posStreams.push(c); }
    const connected = await waitFor(() => streams.every((c) => c.frames.some((f) => f.d?.event === 'connected')), 20_000, 200);
    M.realtime.clients = { total: streams.length, tech: phones.length, pos: posStreams.length, connected: streams.filter((c) => c.frames.some((f) => f.d?.event === 'connected')).length, statuses: [...new Set(streams.map((c) => c.status()))] };
    ck('realtime', `REALTIME FAN-OUT — ${streams.length} live streams (${phones.length} technician phones on /tech/stream + ${posStreams.length} POS screens on /realtime/stream), each its own authenticated session, all connected`, connected && streams.length >= 50, short(M.realtime.clients));
    // the outbox is still delivering the volume days' 3,500 appointment.created events (the realtime projection runs
    // from it): measure how long that backlog takes, then probe on a drained pipeline so the probe's frame is the only one
    const backlog = (await q(`select count(*)::int n from outbox_events where tenant_id = $1 and publish_status in ('pending','claimed')`, [T]))[0].n;
    M.realtime.backlogAfterVolumes = { pending: backlog, drainMs: await outboxDrained() };
    const lag = (await q(`select percentile_cont(0.5) within group (order by extract(epoch from published_at - occurred_at)) p50, percentile_cont(0.95) within group (order by extract(epoch from published_at - occurred_at)) p95, max(extract(epoch from published_at - occurred_at)) mx, count(*)::int n
      from outbox_events where tenant_id = $1 and event_type = 'appointment.created' and publish_status = 'published' and occurred_at > now() - interval '30 minutes'`, [T]))[0];
    M.realtime.outboxLagDuringVolumes = { events: lag.n, p50s: +Number(lag.p50).toFixed(1), p95s: +Number(lag.p95).toFixed(1), maxS: +Number(lag.mx).toFixed(1) };
    // §90 (Oct 26 2026, the realtime-first lane): the SSE frame leaves when the realtime projection has run — recorded in
    // processed_events (realtime.projection) — no longer when the row is marked published (after push / analytics / in-app)
    const fr = (await q(`select percentile_cont(0.5) within group (order by extract(epoch from p.processed_at - o.occurred_at)) p50, percentile_cont(0.95) within group (order by extract(epoch from p.processed_at - o.occurred_at)) p95, max(extract(epoch from p.processed_at - o.occurred_at)) mx, count(*)::int n
      from outbox_events o join processed_events p on p.event_id = o.id and p.consumer_name = 'realtime.projection'
      where o.tenant_id = $1 and o.event_type = 'appointment.created' and o.occurred_at > now() - interval '30 minutes'`, [T]))[0];
    M.realtime.frameLagDuringVolumes = { events: fr.n, p50s: +Number(fr.p50).toFixed(2), p95s: +Number(fr.p95).toFixed(2), maxS: +Number(fr.mx).toFixed(2) };
    info(`REALTIME BURST (§90): after the 3,500-booking volume burst the salon's outbox held ${backlog} undelivered events; drained in ${M.realtime.backlogAfterVolumes.drainMs ?? '>240000'} ms; appointment.created SSE frame (realtime projection) lag p50 ${M.realtime.frameLagDuringVolumes.p50s} s / p95 ${M.realtime.frameLagDuringVolumes.p95s} s / max ${M.realtime.frameLagDuringVolumes.maxS} s over ${fr.n} events; all consumers done (published) p50 ${M.realtime.outboxLagDuringVolumes.p50s} s / p95 ${M.realtime.outboxLagDuringVolumes.p95s} s / max ${M.realtime.outboxLagDuringVolumes.maxS} s over ${lag.n} events`);
    // one branch-wide change → every stream gets it exactly once
    const before = streams.map((c) => c.frames.length);
    const t0 = Date.now();
    const bk = await rec.post('/pos/booking/appointments', { customerName: `Fanout ${tag}`, serviceIds: [S.gel], technicianId: idOf(1), date: d(6), startTime: '09:00', source: 'manual' }, { 'idempotency-key': `fanout-${tag}` });
    const got = (c, i) => c.frames.slice(before[i]).filter((f) => f.d?.event === 'appointment_created' && f.t >= t0);
    await waitFor(() => streams.every((c, i) => got(c, i).length >= 1), 8000, 50);
    await sleep(800);   // anything extra would have arrived by now
    const lat = streams.map((c, i) => (got(c, i)[0]?.t ?? NaN) - t0).filter(Number.isFinite);
    const copies = streams.map((c, i) => got(c, i).length);
    M.realtime.fanout = { event: 'appointment_created', status: bk.status, delivered: lat.length, copies: [...new Set(copies)], p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), max: Math.round(Math.max(...lat)) };
    ck('realtime', `FAN-OUT LATENCY (§60/§90): one booking → appointment_created on all ${streams.length} streams exactly ONCE each (no N×N re-broadcast) — p50 ${M.realtime.fanout.p50} ms, p95 ${M.realtime.fanout.p95} ms, max ${M.realtime.fanout.max} ms`,
      ok2(bk.status) && lat.length === streams.length && copies.every((x) => x === 1) && M.realtime.fanout.p95 < 2000, short(M.realtime.fanout));
    // the technician frames are event-only (§22): no payload on a phone
    const techFrame = streams.find((c) => c.label.startsWith('tech#'))?.frames.find((f) => f.d?.event === 'appointment_created');
    ck('realtime', 'PHONE FRAMES ARE NAMES ONLY (§22): a technician\'s stream carries the event name and sequence, never the payload', !!techFrame && !('payload' in (techFrame.d ?? {})), short(techFrame?.d));
    if (ok2(bk.status) && (bk.body?.appointmentId ?? bk.body?.id)) await rec.post(`/pos/booking/appointments/${bk.body.appointmentId ?? bk.body.id}/cancel`, { reason: 'fan-out probe' }).catch(() => undefined);
  });

  // ── helpers for queue / ticket work ────────────────────────────────────────────────────────────────────────────────
  const svcFor = (techId) => { const sv = svcsOf.get(techId) ?? []; return sv.includes(S.gel) ? S.gel : sv.includes(S.pedi) ? S.pedi : sv[0]; };
  const clockIn = async (techId) => { const r = await own.post('/pos/time-clock/clock-in', { technicianId: techId }); return r.status; };
  const assignWalkIn = async (techId, name) => {
    // the guest asks for this technician at the desk (Fair Turn then recommends her — no override reason needed)
    const it = await rec.post('/pos/queue/items', { customerName: name, customerPhone: `+1609552${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`, serviceIds: [svcFor(techId)], source: 'walk_in', requestedTechnicianId: techId });
    const G = it.body?.queueItemId ?? it.body?.id;
    const as = G ? await rec.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: techId }) : { status: 0 };
    const mv = G ? await rec.post(`/pos/queue/items/${G}/move-to-tech-queue`, {}) : { status: 0 };
    const tk = G ? (await q(`select id from pos_tech_queue_tickets where tenant_id = $1 and queue_item_id = $2 order by visit_part limit 1`, [T, G]))[0]?.id ?? null : null;
    return { G, item: it.status, assign: as.status, move: mv.status, ticketId: tk, err: [it, as, mv].find((r) => r.status >= 300)?.body ?? null };
  };

  // ── 11k. the Booking board in Chromium: memory across 17 pages, off-screen invalidation, noisy #150 ─────────────────
  let board = null;
  await sec('11k booking board', async () => {
    if (!SCREENS) { info('NOT_TESTED 11k (PILOT_SCREENS=0): the board memory / off-screen invalidation proofs need Chromium'); return; }
    board = await openLive('pos-web', '/booking', rec, { viewport: { width: 1600, height: 1000 } });
    if (!board) { check('BOARD in Chromium opened', false, 'pos-web/dist missing'); return; }
    const pg = board.page;
    const label = () => pg.getByTestId('tech-page-label').innerText().catch(() => '');
    const cols = () => pg.locator('[data-technician-column]:not([data-technician-column="__none__"])').count();
    await waitFor(async () => /Page 1 of 17/.test(await label()), 30_000, 200);
    // the busy tomorrow: 1,100+ appointments
    await pg.getByRole('button', { name: 'Next day' }).first().click();
    await waitFor(async () => (await cols()) === 12, 20_000, 200);
    await sleep(1500);
    const cdp = await board.context.newCDPSession(pg);
    await cdp.send('Performance.enable');
    const metrics = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined); await sleep(300); const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])); return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents }; };
    const nextBtn = pg.getByLabel('Technician pages').getByRole('button', { name: 'Next 12 ›', exact: true });
    const first = pg.getByLabel('Technician pages').getByRole('button', { name: '« First', exact: true });
    const samples = []; const pageMs = []; const colCounts = []; const labels = [];
    const m0 = await metrics(); samples.push({ at: 'start', ...m0 });
    for (let round = 1; round <= 3; round++) {
      for (let p = 2; p <= 17; p++) {
        const t0 = Date.now(); const gridsBefore = board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length;
        await nextBtn.click();
        await waitFor(async () => (await label()).includes(`Page ${p} of 17`) && board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length > gridsBefore, 10_000, 25);
        await waitFor(async () => { const c = await cols(); return c === (p === 17 ? 8 : 12); }, 5000, 25);
        pageMs.push(Date.now() - t0); colCounts.push(await cols()); labels.push(await label());
      }
      await first.click(); await waitFor(async () => (await label()).includes('Page 1 of 17'), 10_000, 50);
      await sleep(800);
      samples.push({ at: `after round ${round}`, ...(await metrics()) });
    }
    const r1 = samples[1], r3 = samples[3];
    M.board.memory = { samples, pageChange: { p50: pct(pageMs, 50), p95: pct(pageMs, 95), max: Math.max(...pageMs), n: pageMs.length }, maxColumns: Math.max(...colCounts), lastPageColumns: colCounts[15], pageErrors: board.pageErrors.slice(0, 3) };
    ck('memory', `BROWSER MEMORY (§91): the POS Booking board (Chromium, the busy tomorrow) paged through all 17 pages 3 times (48 page changes): JS heap ${r1.heapMB} → ${r3.heapMB} MB, DOM nodes ${r1.nodes} → ${r3.nodes}, listeners ${r1.listeners} → ${r3.listeners} (round 1 → round 3 — no growth); never more than ${M.board.memory.maxColumns} columns in the DOM (page 17: ${colCounts[15]}); perceived page change p50 ${M.board.memory.pageChange.p50} / p95 ${M.board.memory.pageChange.p95} ms`,
      r3.heapMB <= r1.heapMB * 1.25 + 2 && r3.nodes <= r1.nodes * 1.15 + 200 && r3.listeners <= r1.listeners * 1.15 + 50 && M.board.memory.maxColumns === 12 && colCounts[15] === 8 && labels.every((l, i) => l.includes(`Page ${(i % 16) + 2} of 17`)) && M.board.memory.pageChange.p95 < 1500 && !board.pageErrors.length,
      short(M.board.memory));
    await cdp.detach().catch(() => undefined);
  });

  // ── 11m (a). #150's schedule change while page 1 is on screen ───────────────────────────────────────────────────────
  const T150 = idOf(150), T120 = idOf(120), T193 = idOf(193), T100 = idOf(100), T101 = idOf(101), T5 = idOf(5);
  const dowName = (ymd) => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${ymd}T12:00:00Z`).getUTCDay()];
  await sec('11m schedule change #150', async () => {
    const pos = streams.filter((c) => c.label.startsWith('pos:'));
    const availOf = async (tid) => (await rec.get(`/pos/booking/availability?date=${TOMORROW}&technicianId=${tid}&serviceIds=${svcFor(tid)}`)).body?.[0]?.slots ?? [];
    const before150 = await availOf(T150), before149 = await availOf(idOf(149));
    const gridBefore = board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length : 0;
    const stateBefore = board ? board.requests.filter((r) => r.url.includes('/pos/booking/state')).length : 0;
    const fBefore = pos.map((c) => c.frames.length);
    const tmr = dowName(TOMORROW);
    const sc = await own.patch(`/pos/technicians/${T150}/schedule`, { weekly: { ...week, [tmr]: { ...week[tmr], endTime: '17:00' } }, branchId: B });
    await sleep(2500);
    const after150 = await availOf(T150), after149 = await availOf(idOf(149));
    const heard = pos.map((c, i) => c.frames.slice(fBefore[i]).filter((f) => f.d?.event === 'technician_schedule_updated'));
    const payloadTech = heard[0]?.[0]?.d?.payload?.data?.technicianId ?? heard[0]?.[0]?.d?.payload?.technicianId ?? null;
    const gridAfter = board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length : 0;
    const stateAfter = board ? board.requests.filter((r) => r.url.includes('/pos/booking/state')).length : 0;
    M.board.schedule150 = { patch: sc.status, lastSlotBefore: before150.at(-1) ?? null, lastSlotAfter: after150.at(-1) ?? null, slots: [before150.length, after150.length], neighbourUnchanged: JSON.stringify(before149) === JSON.stringify(after149), heardOnPos: heard.map((h) => h.length), payloadTech: payloadTech === T150, boardGridRefetches: gridAfter - gridBefore, boardMetaRefetches: stateAfter - stateBefore };
    ck('schedule', `SCHEDULE CHANGE #150 (§97): tomorrow ends at 17:00 instead of 19:00 → #150's open times stop at ${after150.at(-1) ?? '—'} (were ${before150.at(-1) ?? '—'}), #149's are untouched; every POS stream hears technician_schedule_updated naming #150${board ? `; the board on page 1 (Chromium) refreshed only its metadata (${stateAfter - stateBefore} list read) and fetched NO day grid (${gridAfter - gridBefore})` : ''}`,
      ok2(sc.status) && after150.every((x) => mins(x) + 60 <= 17 * 60) && after150.length < before150.length && M.board.schedule150.neighbourUnchanged && heard.every((h) => h.length >= 1) && payloadTech === T150 && (!board || (gridAfter - gridBefore === 0 && stateAfter - stateBefore >= 1)),
      short(M.board.schedule150));
  });

  // ── 11k (b). a NOISY #150 while page 1 is on screen: nothing re-fetches the grid; a visible change does ─────────────
  await sec('11k noisy technician', async () => {
    const pos = streams.filter((c) => c.label.startsWith('pos:'));
    const techOthers = streams.filter((c) => c.label.startsWith('tech#'));
    const gb = board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length : 0;
    const fb = pos.map((c) => c.frames.length), tb = techOthers.map((c) => c.frames.length);
    const tmr = dowName(TOMORROW);
    const t0 = Date.now(); const noise = [];
    for (let k = 0; k < 8; k++) noise.push((await own.patch(`/pos/technicians/${T150}/schedule`, { weekly: { ...week, [tmr]: { ...week[tmr], endTime: k % 2 ? '17:00' : '17:15' } }, branchId: B })).status);
    // and #150's bookings on another day (the board shows tomorrow): six booked and cancelled in a burst
    const made = [];
    for (let k = 0; k < 6; k++) {
      const r = await rec.post('/pos/booking/appointments', { customerName: `Noisy ${k}`, serviceIds: [svcFor(T150)], technicianId: T150, date: d(7), startTime: ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00'][k], source: 'manual' }, { 'idempotency-key': `noisy-${tag}-${k}` });
      made.push(r.status); const id = r.body?.appointmentId ?? r.body?.id;
      if (id) noise.push((await rec.post(`/pos/booking/appointments/${id}/cancel`, { reason: 'noisy probe' })).status);
    }
    const burstMs = Date.now() - t0;
    await sleep(18_000);   // past one 15-second safety tick: the change feed has seen the noise too
    const ga = board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length : 0;
    const posEvents = pos.map((c, i) => c.frames.slice(fb[i]).filter((f) => f.d?.event && f.d.event !== 'heartbeat').length);
    const otherTechOwnRoom = techOthers.map((c, i) => c.frames.slice(tb[i]).filter((f) => f.d?.stream === 'r1')).flat().length;
    M.board.noisy = { changes: noise.length + made.length, statuses: [...new Set([...noise, ...made])], burstMs, boardGridRefetches: ga - gb, posFramesPerStream: [...new Set(posEvents)], otherPhonesOwnRoomFrames: otherTechOwnRoom };
    ck('noisy', `NOISY TECHNICIAN (§61): ${M.board.noisy.changes} changes for #150 in ${burstMs} ms (8 schedule edits, 6 bookings + cancels on another day) while the board shows page 1 of tomorrow — the board fetched ${M.board.noisy.boardGridRefetches} day grids in the next 18 s (incl. a safety tick); no other phone's own room heard a thing (${otherTechOwnRoom} frames)`,
      [...noise, ...made].every(ok2) && (!board || M.board.noisy.boardGridRefetches === 0) && otherTechOwnRoom === 0, short(M.board.noisy));
    if (board) {
      // positive control: a change for a VISIBLE technician (#5) does reload the grid and draws the guest
      const g1 = board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length;
      const free = (await rec.get(`/pos/booking/availability?date=${TOMORROW}&technicianId=${T5}&serviceIds=${svcFor(T5)}`)).body?.[0]?.slots ?? [];
      const at = free[free.length - 1];
      const vis = at ? await rec.post('/pos/booking/appointments', { customerName: `Visible Vera ${tag}`, serviceIds: [svcFor(T5)], technicianId: T5, date: TOMORROW, startTime: at, source: 'manual' }, { 'idempotency-key': `visible-${tag}` }) : { status: 0 };
      const drawn = await waitFor(async () => (await board.page.locator('body').innerText().catch(() => '')).includes(`Visible Vera ${tag}`), 8000, 100);
      const g2 = board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length;
      M.board.visible = { booked: vis.status, slot: at ?? null, gridRefetches: g2 - g1, drawn };
      ck('noisy', `TARGETED REFRESH (§21/§22): a booking for #5 (on page 1) at ${at ?? '—'} → the board re-fetched its grid (${g2 - g1}) and drew "Visible Vera" without a reload`, ok2(vis.status) && g2 - g1 >= 1 && drawn, short(M.board.visible));
      await board.shot('pos-booking-200-page1');
    }
  });

  // ── 11l. #193 assigned while the board is on page 1 → #193's phone updates live; reconnect after a missed change ────
  await sec('11l off-screen mobile realtime #193', async () => {
    const c193 = techStreamOf.get(T193), c100 = techStreamOf.get(T100);
    await clockIn(T193);
    const phone = SCREENS && rt.apps[193] ? await openLive('tech-web', '/', rt.apps[193].s, { viewport: { width: 390, height: 844 }, init: [() => { try { sessionStorage.setItem('aps_tech_target_tab', 'tickets'); } catch { /* */ } }] }) : null;
    if (phone) await sleep(3500);   // the splash
    let navs = 0; phone?.page.on('framenavigated', (f) => { if (f === phone.page.mainFrame()) navs++; });
    const b193 = c193?.frames.length ?? 0, b100 = c100?.frames.length ?? 0;
    const gb = board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length : 0;
    const t0 = Date.now();
    const name = `Offscreen Olga ${tag}`;
    const a = await assignWalkIn(T193, name);
    const own193 = () => (c193?.frames.slice(b193) ?? []).filter((f) => f.d?.stream === 'r1');
    await waitFor(() => own193().length > 0, 8000, 50);
    const shown = phone ? await waitFor(async () => (await phone.page.locator('body').innerText().catch(() => '')).includes('Offscreen'), 12_000, 150) : null;
    const shownMs = Date.now() - t0;
    const mine = await rt.apps[193].s.get('/tech/tickets');
    const listed = JSON.stringify(mine.body ?? {}).includes(a.ticketId ?? 'x');
    // #100's own room may hear her OWN rotation position move (turn_queue_updated) — never #193's guest
    const room100 = (c100?.frames.slice(b100) ?? []).filter((f) => f.d?.stream === 'r1').map((f) => f.d?.event);
    const leaked100 = room100.filter((e) => e !== 'turn_queue_updated').length;
    if (phone) await phone.shot('tech-app-193-live-assignment');
    M.realtime.offscreen193 = { assign: [a.item, a.assign, a.move], ticket: !!a.ticketId, ownRoomFrames: own193().map((f) => f.d?.event), firstFrameMs: own193()[0] ? own193()[0].t - t0 : null, phoneShowedGuest: shown, phoneMs: shownMs, phoneReloads: navs, listedInTechApi: listed, ownRoomFramesOn100: room100, ownRoomLeaksOn100: leaked100, boardGridRefetches: board ? board.requests.filter((r) => r.url.includes('/pos/booking/day-grid')).length - gb : null, pageErrors: phone?.pageErrors.slice(0, 3) ?? [] };
    ck('offscreen', `OFF-SCREEN MOBILE REALTIME (§99): with the board on page 1, a walk-in is assigned to #193 (page 17) → #193's OWN room delivers it in ${M.realtime.offscreen193.firstFrameMs ?? '—'} ms and #193's phone app (Chromium, 390×844) shows "Offscreen Olga" ${shown == null ? '(no screens)' : `in ${shownMs} ms without a reload`}; #100's own room hears nothing of it (only her own rotation position); /tech/tickets lists the ticket (identity is the technician id, never a page)`,
      ok2(a.item) && ok2(a.assign) && ok2(a.move) && !!a.ticketId && own193().length > 0 && leaked100 === 0 && listed && (shown == null || (shown && navs === 0 && !phone.pageErrors.length)), short(M.realtime.offscreen193));
    if (phone) await phone.close();
    // RECONNECT (§45): #100's phone drops; the salon assigns her a guest meanwhile; she reconnects with her Last-Event-ID →
    // resync_required, and the snapshot (/tech/tickets) has the new ticket
    if (c100) {
      const lastId = c100.lastId(); c100.close();
      await sleep(300);
      const a2 = await assignWalkIn(T100, `Missed Mia ${tag}`);
      const missedMs = await outboxDrained(60_000);   // she stays offline until the change has gone out to the phones
      const re = sseClient(API, '/tech/stream', cookieOf(rt.apps[100].s), { lastEventId: lastId, label: 'tech#100-again' }); streams.push(re); techStreamOf.set(T100, re);
      await waitFor(() => re.frames.length > 0, 8000, 50);
      const first = re.frames.find((f) => f.d?.event === 'resync_required' || f.d?.event === 'connected');
      const snap = await rt.apps[100].s.get('/tech/tickets');
      M.realtime.reconnect100 = { offlineWhileDeliveredMs: missedMs, lastId, firstFrame: first?.d?.event ?? null, reason: first?.d?.reason ?? null, assign: [a2.item, a2.assign, a2.move], snapshotHasTicket: JSON.stringify(snap.body ?? {}).includes(a2.ticketId ?? 'x') };
      ck('reconnect', `RECONNECT (§45): #100's phone drops; she is assigned "Missed Mia" meanwhile; reconnecting with her Last-Event-ID the stream answers ${M.realtime.reconnect100.firstFrame} (${M.realtime.reconnect100.reason ?? '—'}) and the snapshot /tech/tickets carries the new ticket`,
        !!lastId && first?.d?.event === 'resync_required' && M.realtime.reconnect100.snapshotHasTicket, short(M.realtime.reconnect100));
    }
  });

  // ── 11m (b). #120 starts a break: out of Fair Turn, history untouched, back after ──────────────────────────────────
  await sec('11m break #120', async () => {
    await clockIn(T120);
    const walk = async (nm) => { const r = await rec.post('/pos/queue/items', { customerName: nm, customerPhone: `+1609551${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`, serviceIds: [svcFor(T120)], source: 'walk_in' }); return r.body?.queueItemId ?? r.body?.id; };
    const recommend = async (G) => { const t0 = performance.now(); const r = await rec.post(`/pos/ai-queue-assignment/entries/${G}/recommend`, {}); const ms = performance.now() - t0; const ft = r.body?.envelope?.fairTurn ?? r.body?.fairTurn ?? {}; const inel = r.body?.ineligible ?? r.body?.envelope?.ineligible ?? []; return { status: r.status, ms: Math.round(ms), rec: r.body?.envelope?.recommendedTechnicianId ?? r.body?.recommendedTechnicianId ?? ft.recommendedTechnicianId ?? null, skip120: (ft.skips ?? []).find((x) => x.technicianId === T120)?.reason ?? null, inel120: inel.find((x) => x.technicianId === T120)?.reasons ?? null, candidates: ft.candidates?.length ?? ft.eligibleCount ?? null }; };
    const apptsBefore = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, T120]))[0].n;
    const g0 = await walk('Before Break'); const r0 = await recommend(g0);
    const br = await own.post('/pos/time-clock/break-start', { technicianId: T120, kind: 'break', reason: 'Lunch run' });
    const g1 = await walk('During Break'); const r1 = await recommend(g1);
    const sched = await own.get(`/pos/technicians/${T120}/schedule`);
    const apptsDuring = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, T120]))[0].n;
    const be = await own.post('/pos/time-clock/break-end', { technicianId: T120 });
    const g2 = await walk('After Break'); const r2 = await recommend(g2);
    M.roster.break120 = { before: { skip: r0.skip120, inel: r0.inel120 }, during: { status: br.status, skip: r1.skip120, inel: r1.inel120, rec: r1.rec === T120 }, after: { status: be.status, skip: r2.skip120, inel: r2.inel120 }, appointments: [apptsBefore, apptsDuring], schedule: sched.status, fairTurnMs: [r0.ms, r1.ms, r2.ms] };
    M.perf.fairTurn = { p50: pct([r0.ms, r1.ms, r2.ms], 50), max: Math.max(r0.ms, r1.ms, r2.ms), clockedIn: (await q(`select count(distinct technician_id)::int n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n };
    const onBreak = (x) => x.skip === 'ON_BREAK' || (x.inel ?? []).some((r) => /break/i.test(r));
    ck('break', `BREAK #120 (§98): #120 starts a break → Fair Turn (over ${M.perf.fairTurn.clockedIn} clocked-in technicians, ${r1.ms} ms) skips her ON_BREAK and never recommends her; her appointments (${apptsDuring}) and schedule are untouched; after the break she is a candidate again`,
      ok2(br.status) && ok2(be.status) && !onBreak(M.roster.break120.before) && onBreak(M.roster.break120.during) && r1.rec !== T120 && !onBreak(M.roster.break120.after) && apptsBefore === apptsDuring && sched.status === 200 && [r0, r1, r2].every((r) => ok2(r.status)),
      short(M.roster.break120));
    ck('fairturn', `FAIR TURN AT 200 (§30–§32): recommend answers in ${M.perf.fairTurn.p50} ms (max ${M.perf.fairTurn.max}) with ${M.perf.fairTurn.clockedIn} technicians clocked in; eligibility first (on break → out), the explanation names the skip`, [r0, r1, r2].every((r) => ok2(r.status) && r.rec) && M.perf.fairTurn.max < 2000, short(M.perf.fairTurn));
    for (const G of [g0, g1, g2]) if (G) await rec.post(`/pos/queue/items/${G}/cancel`, { reason: 'break probe' }).catch(() => undefined);
  });

  // ── 11o. 200-technician weekly payroll ─────────────────────────────────────────────────────────────────────────────
  await sec('11o payroll 200', async () => {
    const P0 = d(16), P1 = d(22);
    const per = await own.post('/pos/payroll/periods', { label: `200-technician week ${tag}`, periodStart: P0, periodEnd: P1 });
    const PID = per.body?.id;
    // the roster as payroll sees it: the 200 active technicians, by roster number (kind by roster index, as the pgtest)
    const techs = rosterAll.map((r, i) => ({ ...r, i, kind: i % 10 }));   // 0–5 commission · 6–7 hourly · 8 salary · 9 commission + weekly guarantee
    const days = [d(17), d(18), d(19), d(20), d(21)];
    // FIXTURES (§74 — bulk creation allowed): the week's sales (compensation snapshots, as paid tickets write them) and the
    // hourly technicians' completed time-clock shifts; one commission technician still clocked in (#160 — no clock-out)
    const snaps = [], shifts = [];
    for (const t of techs) {
      const tickets = t.kind === 9 ? 1 : 3 + (t.i % 4);
      for (let k = 0; k < tickets; k++) {
        const gross = 4000 + ((t.i * 37 + k * 101) % 6000), earn = Math.floor(gross * (t.kind === 9 ? 0.4 : 0.6));
        const card = (t.i + k) % 3 === 0 ? 0 : 500 + ((t.i * 13 + k) % 900), cash = (t.i + k) % 5 === 0 ? 300 + (t.i % 200) : 0;
        snaps.push([T, B, randomUUID(), randomUUID(), t.id, gross, earn, card, cash, k === 0 && t.i % 4 === 0 ? 250 : 0, `${days[k % 5]}T12:00:00Z`]);
      }
      if (t.kind === 6 || t.kind === 7) for (const dd of days.slice(0, 2)) shifts.push([T, B, t.id, dd, `${dd}T10:00:00Z`, `${dd}T18:00:00Z`, 'completed']);
    }
    const T160 = idOf(160);
    shifts.push([T, B, T160, days[2], `${days[2]}T10:00:00Z`, null, 'active']);
    const insertMany = async (head, rows, tail = '') => { for (let at = 0; at < rows.length; at += 200) { const chunk = rows.slice(at, at + 200); const params = []; const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')}${tail})`).join(','); await q(`${head} values ${values}`, params); } };
    await insertMany(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, gross_price_cents, tech_service_earnings_cents, card_tip_cents, cash_tip_cents, retail_commission_cents, snapshot_at, engine_version, rule_source, commissionable_cents)`, snaps, `,'v-pilot-fixture','Technician + Service',0`);
    await insertMany(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status)`, shifts);
    await insertMany(`insert into technician_guarantee_policies (tenant_id, technician_id, guaranteed_cents, period, effective_start, status)`, techs.filter((t) => t.kind === 9).map((t) => [T, t.id, 100000]), `,'week','2026-01-01T00:00:00Z','active'`);
    // THROUGH THE API: pay plans (hourly / salary — step-up), the deduction type, bonuses and deductions, one large bonus left pending
    await step();
    const plans = await pool(techs.filter((t) => t.kind >= 6 && t.kind <= 8), 4, async (t) => (await own.post('/pos/payroll/pay-plans', t.kind === 8
      ? { technicianId: t.id, payType: 'salary', salaryCentsPerPeriod: 80000 + (t.i % 3) * 5000, effectiveStart: '2026-01-01', note: 'pilot salary' }
      : { technicianId: t.id, payType: 'hourly', hourlyRateCents: 2000 + (t.i % 5) * 100, effectiveStart: '2026-01-01', note: 'pilot hourly' })).status);
    const dt = await own.post('/pos/payroll/deduction-types', { key: 'supplies', label: 'Supplies', enabled: true });
    const bonusT = techs.filter((t) => t.i % 25 === 3), dedT = techs.filter((t) => t.i % 40 === 5);
    const adj = [];
    for (const t of bonusT) adj.push((await own.post(`/pos/payroll/periods/${PID}/adjustments`, { technicianId: t.id, category: 'bonus', amountCents: 5000, reasonCode: 'performance_bonus', reason: '200-tech week bonus', idempotencyKey: `m5-bonus-${tag}-${t.i}` })).status);
    for (const t of dedT) adj.push((await own.post(`/pos/payroll/periods/${PID}/adjustments`, { technicianId: t.id, category: 'deduction', amountCents: 1000, deductionType: 'supplies', reasonCode: 'supply_charge', reason: 'Supplies', idempotencyKey: `m5-ded-${tag}-${t.i}` })).status);
    const pendT = techs.find((t) => t.i === 77);
    const big = await own.post(`/pos/payroll/periods/${PID}/adjustments`, { technicianId: pendT.id, category: 'bonus', amountCents: 25000, reasonCode: 'performance_bonus', reason: 'Large bonus — owner to decide', idempotencyKey: `m5-big-${tag}` });
    // CALCULATE (manager) — the ONE build from sales → 200 statements, each with the default 50 / 50 plan
    const t0 = performance.now(); const calc = await mgr.post(`/pos/payroll/paychecks/periods/${PID}/calculate`, {}); const calcMs = Math.round(performance.now() - t0);
    const val = await own.get(`/pos/payroll/periods/${PID}/validation`);
    const tw = performance.now(); const wk = await own.get(`/pos/payroll/paychecks/periods/${PID}`); const weekMs = Math.round(performance.now() - tw);
    const st = wk.body?.statements ?? [];
    const kinds = { hourly: st.filter((s) => s.hourlyPayCents > 0).length, salary: st.filter((s) => s.salaryPayCents > 0).length, guarantee: st.filter((s) => s.guaranteeTopUpCents > 0).length, commission: st.filter((s) => s.serviceCommissionCents > 0).length,
      tips: st.filter((s) => s.tipsCents > 0).length, bonus: st.filter((s) => s.bonusCents > 0).length, deductions: st.filter((s) => s.deductionsCents > 0).length };
    const planOk = st.every((s) => { const ins = (s.plan?.instructions ?? []).filter((i) => i.status !== 'canceled'); const c = ins.filter((i) => i.method === 'check').reduce((a, i) => a + i.amountCents, 0), k = ins.filter((i) => i.method === 'cash').reduce((a, i) => a + i.amountCents, 0); return ins.length === 2 && c + k === s.approvedPayableCents && Math.abs(c - k) <= 1; });
    const tot = wk.body?.totals ?? {};
    M.payroll = { period: PID, fixtures: { snapshots: snaps.length, shifts: shifts.length }, plans: [...new Set(plans)], deductionType: dt.status, adjustments: [...new Set(adj)], bigBonus: [big.status, big.body?.status], calc: calc.status, calcMs, weekMs, weekBytes: bytes(wk.body), statements: st.length, kinds,
      totals: tot, validation: (val.body?.issues ?? []).map((i) => `${i.code}:${i.severity}:${i.count}`) };
    ck('payroll', `200-TECH PAYROLL (§63/§64): calculate (manager) builds 200 statements in ${calcMs} ms — commission ${kinds.commission}, hourly ${kinds.hourly}, salary ${kinds.salary}, guarantee top-up ${kinds.guarantee}, tips ${kinds.tips}, bonus ${kinds.bonus}, deductions ${kinds.deductions} (pay plans, bonuses and deductions entered through the API); every statement's default plan is 50 % check / 50 % cash to the cent (Σ = payable, |check − cash| ≤ 1¢); week total ${tot.payableCents} = check ${tot.checkCents} + cash ${tot.cashCents}`,
      ok2(per.status) && plans.every(ok2) && ok2(dt.status) && adj.every(ok2) && ok2(calc.status) && st.length === 200 && kinds.hourly === 40 && kinds.salary === 20 && kinds.guarantee > 0 && kinds.bonus === bonusT.length && kinds.deductions === dedT.length && planOk && tot.checkCents + tot.cashCents === tot.payableCents && tot.payableCents === st.reduce((a, s) => a + s.approvedPayableCents, 0),
      short(M.payroll));
    // §66/§67: exceptions only · search · branch
    const expected = new Set([...bonusT, ...dedT].map((t) => t.id)); expected.add(T160); expected.add(pendT.id);
    const ex = await own.get(`/pos/payroll/paychecks/periods/${PID}?exceptionsOnly=1`);
    const exIds = new Set((ex.body?.statements ?? []).map((s) => s.technicianId));
    const s150 = await own.get(`/pos/payroll/paychecks/periods/${PID}?search=${encodeURIComponent(byNumber.get(150)?.name ?? 'x')}`);
    const brF = await own.get(`/pos/payroll/paychecks/periods/${PID}?branchId=${B}`);
    const ownerEx = await own.get(`/owner/payroll/paychecks/periods/${PID}?exceptionsOnly=true`);
    const codesOf = (id) => ((ex.body?.statements ?? []).find((s) => s.technicianId === id)?.exceptions ?? []).map((e) => e.code);
    M.payroll.exceptions = { expected: expected.size, got: exIds.size, view: ex.body?.view && { matched: ex.body.view.matched, total: ex.body.view.total, withExceptions: ex.body.view.withExceptions }, sample: { clockOut160: codesOf(T160), pending: codesOf(pendT.id), bonus: codesOf(bonusT[0]?.id) }, search150: (s150.body?.statements ?? []).map((s) => s.technicianName), branch: brF.body?.view?.matched, ownerApp: ownerEx.body?.view?.matched };
    ck('payrollEx', `EXCEPTIONS ONLY (§66/§67): ?exceptionsOnly=1 narrows the 200 statements to exactly the ${expected.size} that need a look — manual bonus / deduction, #160 still clocked in (MISSING_CLOCK_OUT), #78's $250 bonus waiting for the owner (PENDING_ADJUSTMENT); the totals stay the week's; search "${byNumber.get(150)?.name}" finds one statement; the branch filter keeps all 200; the Owner App's view says the same`,
      ex.status === 200 && exIds.size === expected.size && [...expected].every((id) => exIds.has(id)) && codesOf(T160).includes('MISSING_CLOCK_OUT') && codesOf(pendT.id).includes('PENDING_ADJUSTMENT') && codesOf(bonusT[0]?.id).includes('MANUAL_ADJUSTMENT')
        && ex.body?.totals?.payableCents === tot.payableCents && ex.body?.view?.total === 200 && (s150.body?.statements ?? []).length === 1 && brF.body?.view?.matched === 200 && ownerEx.status === 200 && ownerEx.body?.view?.matched === expected.size,
      short(M.payroll.exceptions));
    // SUBMIT (manager) → APPROVE SELECTED (owner, step-up): every clean statement approved, the exceptions held → each held one approved after review
    const sub = await mgr.post(`/pos/payroll/paychecks/periods/${PID}/submit`, { expectedVersion: wk.body?.period?.version });
    await step();
    const ta = performance.now();
    const ap = await own.post(`/pos/payroll/paychecks/periods/${PID}/approve`, { expectedVersion: sub.body?.period?.version, calculationHash: sub.body?.period?.previewHash ?? null, holdTechnicianIds: [...expected] });
    const approveMs = Math.round(performance.now() - ta);
    const mid = await own.get(`/pos/payroll/paychecks/periods/${PID}`);
    const held = (mid.body?.statements ?? []).filter((s) => s.status === 'held');
    const payoutsMid = (mid.body?.statements ?? []).reduce((a, s) => a + (s.payouts ?? []).length, 0);
    const heldOk = []; for (const s of held) { await step(); heldOk.push((await own.post(`/pos/payroll/paychecks/statements/${s.id}/approve`, {})).status); }
    const fin = await own.get(`/pos/payroll/paychecks/periods/${PID}`);
    const fst = fin.body?.statements ?? [];
    const payouts = fst.flatMap((s) => (s.payouts ?? []).map((x) => ({ ...x, payable: s.approvedPayableCents, sid: s.id })));
    const ins = await q(`select i.method, i.amount_cents::int amt, i.status, i.payout_id from payroll_payout_instructions i join payroll_payout_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id join payroll_statements s on s.id = p.statement_id where i.tenant_id = $1 and s.period_id = $2 and p.status = 'approved'`, [T, PID]);
    const perStmt = fst.every((s) => (s.payouts ?? []).filter((x) => x.status !== 'canceled').reduce((a, x) => a + x.amountCents, 0) === s.approvedPayableCents);
    const rep = await own.get(`/pos/payroll/paychecks/reports?range=custom&from=${P0}&to=${P1}`);
    M.payroll.approve = { submit: sub.status, approveSelected: ap.status, approveMs, heldAfterApprove: held.length, payoutsBeforeHeld: payoutsMid, approveHeld: [...new Set(heldOk)], statuses: [...new Set(fst.map((s) => s.status))], payouts: payouts.length, check: payouts.filter((x) => x.method === 'check').length, cash: payouts.filter((x) => x.method === 'cash').length,
      instructions: ins.length, materialized: ins.filter((i) => i.status === 'materialized' && i.payout_id).length, perStatementReconciles: perStmt, sumPayouts: payouts.reduce((a, x) => a + x.amountCents, 0), payable: fin.body?.totals?.payableCents, report: rep.body?.accounting && { reconciles: rep.body.accounting.reconciles, expense: rep.body.accounting.compensationExpenseCents } };
    ck('payroll', `APPROVE SELECTED → HELD (§66): the manager submits; the owner (fresh step-up) approves all ${200 - expected.size} clean statements in ${approveMs} ms and HOLDS the ${expected.size} exceptions (${held.length} held, ${payoutsMid} payouts so far); each held one is then approved on its own`,
      ok2(sub.status) && ok2(ap.status) && held.length === expected.size && payoutsMid === 2 * (200 - expected.size) && heldOk.every(ok2), short(M.payroll.approve));
    ck('payout400', `400 PAYOUT INSTRUCTIONS (§64/§68): 200 approved statements at 50 / 50 → ${M.payroll.approve.instructions} instructions, all materialised → ${payouts.length} payouts (${M.payroll.approve.check} check + ${M.payroll.approve.cash} cash); every statement's payouts add up to its payable; Σ payouts ${M.payroll.approve.sumPayouts} = week payable ${M.payroll.approve.payable}; the paycheck report reconciles`,
      ins.length === 400 && M.payroll.approve.materialized === 400 && payouts.length === 400 && M.payroll.approve.check === 200 && M.payroll.approve.cash === 200 && perStmt && M.payroll.approve.sumPayouts === M.payroll.approve.payable && fst.every((s) => ['locked', 'issued', 'partially_paid', 'paid'].includes(s.status)) && rep.status === 200 && rep.body?.accounting?.reconciles === true,
      short(M.payroll.approve));
    // the technician's own view: #100 sees her statement (the same payable), never #101's
    const mine100 = await rt.apps[100].s.get('/tech/payroll/statements');
    const myRow = (mine100.body?.statements ?? []).find((s) => s.periodId === PID) ?? (mine100.body?.current?.periodId === PID ? mine100.body.current : null);
    const st101 = fst.find((s) => s.technicianId === T101);
    const peek = st101 ? await rt.apps[100].s.get(`/tech/payroll/statements/${st101.id}`) : { status: 0 };
    const ownerPay = await rt.apps[100].s.get(`/pos/payroll/paychecks/periods/${PID}`);
    M.payroll.techView = { mine: mine100.status, myPayable: myRow?.amountCents ?? null, statement: fst.find((s) => s.technicianId === T100)?.approvedPayableCents ?? null, peek101: peek.status, salonWeek: ownerPay.status, mentions101: JSON.stringify(mine100.body ?? {}).includes(T101) };
    ck('privacy', `TECH APP PAYROLL PRIVACY (§40/§80): #100's /tech/payroll/statements shows her own statement (${M.payroll.techView.myPayable} = the owner's ${M.payroll.techView.statement}) and never #101; #101's statement by id → ${peek.status}; the salon's week → ${ownerPay.status}`,
      mine100.status === 200 && myRow && myRow.amountCents === M.payroll.techView.statement && [403, 404].includes(peek.status) && [401, 403].includes(ownerPay.status) && !M.payroll.techView.mentions101, short(M.payroll.techView));
    M.perf.payroll = { calculateMs: calcMs, weekViewMs: weekMs, approveMs, statements: st.length, payouts: payouts.length };
  });

  // ── 11n. the Technician App at phone size: nine screens × five accounts ─────────────────────────────────────────────
  await sec('11n phone screens', async () => {
    if (!SCREENS) { info('NOT_TESTED 11n (PILOT_SCREENS=0): the phone-size screens need Chromium'); return; }
    for (const n of [1, 25, 100, 193, 200]) {
      const a = rt.apps[n]; const tid = idOf(n); const name = byNumber.get(n)?.name ?? '';
      const row = { n }; M.screens[`#${n}`] = row;
      if (!a) { row.pass = false; row.error = 'no app session'; ck('screens', `TECH APP SCREENS #${n}`, false, 'no app session'); continue; }
      // a current ticket for each (assigned at the desk, accepted on the phone) — #193 already has Olga's
      if (n !== 193) { await clockIn(tid); const w = await assignWalkIn(tid, `Screen Guest ${n}`); if (w.ticketId) await a.s.post(`/tech/tickets/${w.ticketId}/accept`, {}); row.ticket = w.ticketId; }
      else row.ticket = (await q(`select id from pos_tech_queue_tickets where tenant_id = $1 and assigned_technician_id = $2 order by created_at desc limit 1`, [T, tid]))[0]?.id ?? null;
      const live = await openLive('tech-web', '/', a.s, { viewport: { width: 390, height: 844 } });
      const api = []; const bodies = [];
      live.page.on('response', async (r) => { const u = new URL(r.url()); if (!/\.(js|css|png|svg|woff2?|ico|webmanifest)$/.test(u.pathname) && u.pathname !== '/' && /json/.test(r.headers()['content-type'] ?? '')) { api.push({ path: u.pathname, status: r.status() }); bodies.push(await r.text().catch(() => '')); } });
      const first = name.split(/\s+/)[0];
      const SCREEN_LIST = [
        ['Home', { tab: 'home' }, new RegExp(first)], ['Schedule', { tab: 'schedule' }, /Schedule|Today|Appointments/i], ['Queue', { tab: 'home', pushed: { kind: 'queue' } }, /Queue|Waiting|Ready/i],
        ['Current Ticket', { tab: 'tickets', pushed: row.ticket ? { kind: 'ticket', ticketId: row.ticket } : null }, /Guest|Olga|Ticket|Service/i], ['Time Clock', { tab: 'more', pushed: { kind: 'timeClock' } }, /Time Clock|Clocked|Clock in|Clock out/i],
        ['Earnings', { tab: 'earnings' }, /Earnings|\$/], ['Payroll', { tab: 'more', pushed: { kind: 'payroll' } }, /Payroll/], ['Notifications', { tab: 'more', pushed: { kind: 'notifications' } }, /Notifications/], ['Profile', { tab: 'more', pushed: { kind: 'profile' } }, /Profile/],
      ];
      row.screens = {};
      for (const [label, target, expect] of SCREEN_LIST) {
        const apiFrom = api.length;
        await live.page.evaluate((tg) => { sessionStorage.setItem('aps_tech_target_tab', tg.tab); if (tg.pushed) sessionStorage.setItem('aps_tech_target_pushed', JSON.stringify(tg.pushed)); else sessionStorage.removeItem('aps_tech_target_pushed'); }, target);
        await live.page.reload({ waitUntil: 'load' });
        const ok = await waitFor(async () => expect.test((await live.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')), 10_000, 150);
        await sleep(400);
        const bad = api.slice(apiFrom).filter((x) => x.status >= 400);
        row.screens[label] = { ok, apiCalls: api.length - apiFrom, failedApi: bad.map((x) => `${x.status} ${x.path}`).slice(0, 4) };
        if (n === 100) { await sleep(2800); await live.shot(`tech-app-100-${label.toLowerCase().replace(/\s+/g, '-')}`); }
      }
      const all = bodies.join('\n');
      row.privacy = { mentions101: n === 100 ? (all.includes(T101) || all.includes(byNumber.get(101)?.name ?? '\u0000')) : null, ownerApis: api.filter((x) => /^\/(owner|pos\/payroll|pos\/technicians)\b/.test(x.path)).map((x) => x.path).slice(0, 4), apiCalls: api.length };
      row.pageErrors = live.pageErrors.slice(0, 3);
      row.pass = Object.values(row.screens).every((x) => x.ok && !x.failedApi.length) && !live.pageErrors.length && !row.privacy.ownerApis.length && row.privacy.mentions101 !== true;
      await live.close();
      ck('screens', `TECH APP AT PHONE SIZE #${n} (§39–§43, 390×844 Chromium): Home, Schedule, Queue, Current Ticket, Time Clock, Earnings, Payroll, Notifications, Profile all render with her data, every one of ${api.length} API answers 2xx, no page error, no salon / owner API${n === 100 ? '; nothing on any screen carries #101' : ''}`,
        row.pass, short({ screens: Object.fromEntries(Object.entries(row.screens).map(([k, v]) => [k, `${v.ok ? 'ok' : 'MISSING'}${v.failedApi.length ? ' ' + v.failedApi.join(',') : ''}`])), privacy: row.privacy, errors: row.pageErrors }));
    }
  });

  // ── 11p. roster changes: #201 · deactivate #50 · transfer → 201 / 200 / 199 ────────────────────────────────────────
  await sec('11p roster changes', async () => {
    // #201: one more hire, "Zz" sorts last
    const cr = await own.post('/pos/technicians', { firstName: 'Zz', lastName: `Edge 201 ${tag}`, email: `zz201.${tag}@pilot-day.test`, phone: `60958${String(Number(tag) % 100000).padStart(5, '0')}`, techAppEnabled: false, serviceIds: [S.gel] });
    const T201 = cr.body?.technicianId ?? cr.body?.id;
    if (T201) { await own.patch(`/pos/technicians/${T201}/services`, { serviceIds: [S.gel] }); await own.patch(`/pos/technicians/${T201}/schedule`, { weekly: week, branchId: B }); }
    const e201 = await edge('201', '', 201);
    const p17 = await rec.get(`/pos/booking/technicians?date=${TOMORROW}&page=17&pageSize=12`);
    ck('edges', `PAGINATION 201 (§94): technician #201 hired → 201 technicians = 17 pages, page 17 holds #193–#201 (9), every technician once`, ok2(cr.status) && e201.ok && (p17.body?.technicians ?? []).map((t) => t.rosterNumber).join() === Array.from({ length: 9 }, (_, i) => 193 + i).join(), short({ e201, p17: (p17.body?.technicians ?? []).map((t) => t.rosterNumber) }));
    // DEACTIVATE #50
    const T50 = idOf(50);
    const appts50 = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, T50]))[0].n;
    const pay50 = M.payroll.period ? (await own.get(`/pos/payroll/paychecks/periods/${M.payroll.period}?search=${encodeURIComponent(byNumber.get(50)?.name ?? 'x')}`)).body?.statements?.[0] ?? null : null;
    const de = await own.patch(`/pos/technicians/${T50}`, { status: 'inactive' });
    const e200 = await edge('200-after-deactivation', '', 200);
    const allPages = []; for (let p = 1; p <= 17; p++) allPages.push(...((await rec.get(`/pos/booking/technicians?date=${TOMORROW}&page=${p}&pageSize=12`)).body?.technicians ?? []));
    const inactive = await rec.get(`/pos/booking/technicians?date=${TOMORROW}&status=inactive&pageSize=12`);
    const book50 = await rec.post('/pos/booking/appointments', { customerName: 'After Deactivation', serviceIds: [svcFor(T50)], technicianId: T50, date: d(5), startTime: '11:00', source: 'manual' }, { 'idempotency-key': `deact-${tag}` });
    const qi = await rec.post('/pos/queue/items', { customerName: 'Assign Fifty', customerPhone: `+1609550${tag.slice(-4)}`, serviceIds: [svcFor(T50)], source: 'walk_in' });
    const as50 = await rec.post(`/pos/queue/items/${qi.body?.queueItemId ?? qi.body?.id}/assign-technician`, { technicianId: T50 });
    const appts50After = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, T50]))[0].n;
    const pay50After = pay50 ? (await own.get(`/pos/payroll/paychecks/statements/${pay50.id}`)).body : null;
    const hist = await own.get(`/pos/technicians/${T50}/employment-history`);
    M.roster.deactivate50 = { status: de.status, boardTotal: e200.total, onAnyPage: allPages.some((t) => t.technicianId === T50), inInactiveFilter: (inactive.body?.technicians ?? []).some((t) => t.technicianId === T50), rosterNumber51Kept: allPages.find((t) => t.technicianId === idOf(51))?.rosterNumber,
      bookRefused: [book50.status, book50.body?.code ?? null], assignRefused: [as50.status, as50.body?.code ?? null], appointments: [appts50, appts50After], payroll: pay50 && { before: pay50.approvedPayableCents, after: pay50After?.approvedPayableCents, status: pay50After?.status }, history: hist.status };
    ck('deactivate', `DEACTIVATE #50 (§95): the active roster drops 201 → 200 (#50 on no page, listed under Inactive; #51 keeps her number — identity is the id, never a page); a new booking with #50 → ${book50.status}, assigning a walk-in to #50 → ${as50.status}; her ${appts50} appointments and her approved paycheck (${pay50?.approvedPayableCents ?? '—'}) are untouched`,
      ok2(de.status) && e200.ok && !M.roster.deactivate50.onAnyPage && M.roster.deactivate50.inInactiveFilter && book50.status >= 400 && as50.status >= 400 && appts50 === appts50After && (!pay50 || (pay50After?.approvedPayableCents === pay50.approvedPayableCents)) && hist.status === 200,
      short(M.roster.deactivate50));
    if (qi.body?.queueItemId ?? qi.body?.id) await rec.post(`/pos/queue/items/${qi.body.queueItemId ?? qi.body.id}/cancel`, { reason: 'deactivation probe' }).catch(() => undefined);

    // TRANSFER: the Super Admin opens a second location and moves one technician there through the approved workflow
    const mover = phones.find((p) => p.hire && p.n && p.n !== 50 && p.n !== 120 && p.n !== 150 && p.n !== 100 && p.n !== 101);
    if (!mover) throw new Error('no signed-in technician to transfer (the 45 extra phones did not sign in)');
    const br2 = await sa.post('/super-admin/platform/branches', { tenantId: T, name: `Pilot Annex ${tag}`, address: '2 Pilot Avenue', city: 'Merchantville', state: 'NJ', zip: '08109', timezone: TZ, openingStatus: 'active', reason: '200-tech pilot: second location' });
    const B2 = br2.body?.id ?? br2.body?.branchId;
    const me = await mover.s.get('/auth/me');
    const userId = me.body?.userId ?? me.body?.user?.id ?? me.body?.id ?? null;
    const apptsMoverB1 = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and branch_id = $3`, [T, mover.id, B]))[0].n;
    const apptsMoverB1Tomorrow = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and branch_id = $3 and appt_date = $4 and status not in ('cancelled','canceled','no_show')`, [T, mover.id, B, TOMORROW]))[0].n;
    const tr = userId && B2 ? await sa.post(`/super-admin/staff/workforce/${userId}/transfer`, { toBranchId: B2, reason: 'Moving to the new annex' }) : { status: 0, body: null };
    const dec = tr.body?.id ? await sa.post(`/super-admin/staff/workforce-transfers/${tr.body.id}/decision`, { decision: 'approve', note: 'Approved for the annex opening' }) : { status: 0, body: null };
    const e199 = await edge('199-after-transfer', '', 199);
    const inB1 = await rec.get(`/pos/booking/technicians?date=${TOMORROW}&locate=${mover.id}&pageSize=12`);
    // the owner at the annex: the moved technician is on its board, the old branch's appointments are not
    const ownB2 = session('owner-annex'); const ol = await tenantLogin(ownB2, env.OWNER_EMAIL, OWNER_PW, B2);
    const b2Board = await ownB2.get(`/pos/booking/technicians?date=${TOMORROW}&pageSize=12`);
    const b2Grid = await ownB2.get(`/pos/booking/day-grid?date=${TOMORROW}&technicianIds=${mover.id}`);
    const b1Grid = await rec.get(`/pos/booking/day-grid?date=${TOMORROW}&technicianIds=${mover.id}`);
    // the moved technician signs in again: the annex is hers, the old branch is not
    const s2 = session('mover-again'); const l2 = (await tenantLogin(s2, mover.hire.email, STAFF_PW)).l;
    const selOld = await s2.post('/auth/select-branch', { branchId: B });
    const selNew = await s2.post('/auth/select-branch', { branchId: B2 });
    // #100's branch scope: the annex is not hers
    const sel100 = await rt.apps[100].s.post('/auth/select-branch', { branchId: B2 });
    M.roster.transfer = { branch: br2.status, request: tr.status, decision: [dec.status, dec.body?.status], boardB1: e199.total, locatedInB1: inB1.body?.located ?? null, ownerAnnexLogin: ol.ok, annexBoard: (b2Board.body?.technicians ?? []).map((t) => t.technicianId === mover.id ? 'MOVED' : t.name),
      annexGridOldAppointments: (b2Grid.body?.appointments ?? []).length, oldBranchKeepsHistory: { db: [apptsMoverB1, (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and branch_id = $3`, [T, mover.id, B]))[0].n], tomorrowOnMainGrid: [apptsMoverB1Tomorrow, (b1Grid.body?.appointments ?? []).filter((a) => a.technicianId === mover.id).length] }, moverLogin: l2?.status, selectOld: selOld.status, selectNew: selNew.status, select100Annex: sel100.status };
    // new-branch eligibility: the annex books her (its hours + her schedule there)
    const hrs = await ownB2.patch('/pos/settings/store-hours-auto-logout', { storeHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((x) => [x, { isOpen: true, openTime: '09:00', closeTime: '19:30' }])), timezone: TZ });
    const sch = await ownB2.patch(`/pos/technicians/${mover.id}/schedule`, { weekly: week, branchId: B2 });
    // the new location's menu: the owner sets up a service there and approves the moved technician for it
    const cat2 = await ownB2.post('/pos/services/categories', { name: 'Nails' });
    const svc2 = await ownB2.post('/pos/services', { name: 'Gel Manicure', categoryId: cat2.body?.id ?? cat2.body?.categoryId ?? cat2.body?.category?.id, priceCents: 4500, durationMinutes: 45, commissionType: 'percent', commissionValue: 60, status: 'active' });
    const SVC2 = svc2.body?.id ?? svc2.body?.serviceId ?? svc2.body?.service?.id;
    const ms2 = SVC2 ? await ownB2.patch(`/pos/technicians/${mover.id}/services`, { serviceIds: [SVC2] }) : { status: 0 };
    const bkB2 = await ownB2.post('/pos/booking/appointments', { customerName: 'Annex First Guest', serviceIds: [SVC2], technicianId: mover.id, date: d(8), startTime: '10:00', source: 'manual' }, { 'idempotency-key': `annex-${tag}` });
    Object.assign(M.roster.transfer, { annexMenu: [cat2.status, svc2.status, ms2.status], annexHours: hrs.status, annexSchedule: [sch.status, sch.status >= 300 ? short(sch.body) : null], annexBooking: [bkB2.status, bkB2.status >= 300 ? short(bkB2.body) : null], ownerAnnexSelect: ol.ok ? 200 : [ol.sel?.status, short(ol.sel?.body)] });
    ck('transfer', `TRANSFER (§96): the Super Admin opens "Pilot Annex" and moves #${mover.n} there (request → approve): the main board drops to 199 (17 pages, last 7) and no longer finds her; the annex board lists her and shows none of her ${apptsMoverB1} old-branch appointments (they stay at the main branch, all ${apptsMoverB1} kept); she can open the annex and not the main branch; the annex saves her week and, once its own menu is set up, books her; #100 cannot open the annex`,
      ok2(br2.status) && !!B2 && ok2(tr.status) && ok2(dec.status) && e199.ok && !inB1.body?.located && ol.ok && M.roster.transfer.annexBoard.includes('MOVED') && M.roster.transfer.annexGridOldAppointments === 0 && M.roster.transfer.oldBranchKeepsHistory.db[0] === M.roster.transfer.oldBranchKeepsHistory.db[1]
        && [401, 403, 404].includes(selOld.status) && ok2(selNew.status) && [401, 403, 404].includes(sel100.status) && ok2(sch.status) && ok2(bkB2.status),
      short(M.roster.transfer));
    ck('branch', `TECHNICIAN BRANCH SCOPE (§41/§79): #100 → select the annex ${sel100.status}; the moved technician → main branch ${selOld.status}, annex ${selNew.status}`, [401, 403, 404].includes(sel100.status) && [401, 403, 404].includes(selOld.status) && ok2(selNew.status), short({ sel100: sel100.status, selOld: selOld.status, selNew: selNew.status }));
  });

  closeAll();
  if (board) await board.close();
  M.rateLimited = stats.rateLimited;
  info(`RATE LIMIT: the salon's limiter (24,000 requests / minute per location, 2,000 per session) answered 429 to this phase's load generator ${stats.rateLimited} time(s); each was honoured (Retry-After) and re-sent`);

  // ── 11q. the matrices ──────────────────────────────────────────────────────────────────────────────────────────────
  const P = (x) => (x === undefined ? 'NOT_RUN' : x ? 'PASS' : 'FAIL');
  const c = numbers_checks(env);
  M.matrix200 = {
    'Technicians created': L.hire ? `${(L.hire.before ?? 0) + (L.hire.hired ?? 0)}` : '—', 'Booking page size': '12', 'Expected pages': '17',
    'Page 1 (1-12)': P(c.paging), 'Page 8 (85-96)': P(c.paging), 'Page 17 (193-200)': P(c.paging), 'Technician Search': P(c.search), 'Jump-to-Tech': P(c.search),
    'Find an Opening': P(c.openings), 'Best Matches': P(c.openings), 'Exact Service Eligibility': P(c.exact), 'Concurrent Booking': P(c.race),
    'Fair Turn': P(R.fairturn && R.break), 'Realtime': P(R.realtime && R.offscreen && R.reconnect && R.noisy && R.schedule), 'Technician App Login': P(c.login && R.screens),
    '200-Tech Payroll': P(R.payroll && R.payrollEx), '400 Payout Instructions': P(R.payout400), 'Performance': P(c.perf && c.db && R.volume && R.memory),
    'Pagination edges (0…201)': P(R.edges), 'Deactivation #50': P(R.deactivate), 'Transfer': P(R.transfer), 'Break #120': P(R.break), 'Schedule change #150': P(R.schedule), 'Off-screen mobile #193': P(R.offscreen),
  };
  for (const n of [1, 25, 100, 193, 200]) {
    const lr = L.matrix?.[`#${n}`] ?? {}; const sr = M.screens[`#${n}`] ?? {}; const scr = sr.screens ?? {};
    M.loginMatrix[`#${n}`] = { invite: P(lr.accept != null ? ok2(lr.accept) : undefined), login: P(lr.login != null ? ok2(lr.login) : undefined), refresh: P(lr.refresh != null ? ok2(lr.refresh) : undefined), logout: P(lr.oldCookieAfterLogout != null ? lr.oldCookieAfterLogout === 401 : undefined),
      tenantScope: P(lr.meScoped), branchScope: P(n === 100 ? R.branch : lr.select != null ? ok2(lr.select) : undefined), ownDataPrivacy: P(n === 100 ? (R.privacy && sr.privacy?.mentions101 === false) : lr.scheduleOnlyMine),
      Home: P(scr.Home?.ok), Schedule: P(scr.Schedule?.ok), Queue: P(scr.Queue?.ok), 'Current Ticket': P(scr['Current Ticket']?.ok), 'Time Clock': P(scr['Time Clock']?.ok), Earnings: P(scr.Earnings?.ok), Payroll: P(scr.Payroll?.ok), Notifications: P(scr.Notifications?.ok), Profile: P(scr.Profile?.ok),
      overall: P(!!lr.pass && sr.pass === true) };
  }
  info(`200-TECH PILOT MATRIX: ${Object.entries(M.matrix200).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  info(`TECHNICIAN APP LOGIN MATRIX: ${Object.entries(M.loginMatrix).map(([k, v]) => `${k} ${v.overall}`).join(' · ')}`);
  return M;
}

/** the outcome of the phase-11 checks lib/pilot-large-salon.mjs made (read from the run's results by name) */
function numbers_checks(env) {
  const pass = (re) => { const rows = env.results.filter((r) => /^(PASS|FAIL)/.test(r) && re.test(r)); return rows.length ? rows.every((r) => r.startsWith('PASS')) : undefined; };
  return { paging: pass(/\[11 large salon\] BOARD PAGING/), search: pass(/\[11 large salon\] SEARCH #200/), openings: pass(/\[11 large salon\] FIND AN OPENING/), exact: pass(/\[11 large salon\] EXACT-SERVICE FILTER/),
    race: pass(/\[11 large salon\] BOOKING CONCURRENCY/), login: pass(/\[11 large salon\] TECH APP LOGIN #/), perf: pass(/\[11 large salon\] PERFORMANCE TARGETS/), db: pass(/\[11 large salon\] DATABASE EVIDENCE/) };
}
