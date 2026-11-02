// pilot-large-salon-owner.mjs — PHASE 11 (owner) of live-pilot-day.mjs: 200-technician mandate §62 / §69 (Oct 26 2026).
// "The Owner App's Team, Performance, Payroll and Reports at 200 technicians — server-side paging / aggregates — weekly /
// monthly / YTD by technician, branch, service and payout method." Runs after the blocks step on the same salon:
//   11q-a  a PAID DAY across the floor: one walk-in per clocked-in technician (up to 120), sent through the POS the way the
//          front desk does it (queue → assign → start service → Service Done → checkout, cash; every third with a tip) —
//          so the reports carry real money for ~100+ technicians, not three
//   11q-b  the Owner App's reads through the API, for the week, the month and the year to date, each total checked
//          against PostgreSQL with an independent SQL aggregate:
//            Team / Staff Performance  — every page of GET /owner/staff/performance/technicians (20 a page for the week,
//                                         the maximum for month / YTD): every technician's services, sales and commission
//            by branch                 — GET /owner/branches/performance: each branch's paid revenue
//            by service                — GET /owner/finance/summary: revenue, tips, transactions, the top services
//            by payout method          — GET /owner/finance/payment-mix (the tender: cash / card / gift card) and the
//                                         200-technician payroll week's payouts by method (check / cash —
//                                         GET /owner/payroll/paychecks/periods/:id)
//            the Staff report export   — one CSV row per technician; its sales column sums to the database
//          and every call's latency and payload is recorded
//   11q-c  the same Owner App screens in Chromium at phone size (390 × 844): Team (staff tab: the server-paged list, page
//          1 = the API's page 1, Next → page 2), Reports (the month's revenue as the API said), Payroll (the 200-statement
//          week: payable / by check / in cash as the API said) — no page errors, no sideways scroll
import { performance } from 'node:perf_hooks';
import { pool } from './pilot-large-salon.mjs';
import { pacer, pacedSession } from './pilot-large-salon-m5.mjs';

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const bytes = (b) => Buffer.byteLength(typeof b === 'string' ? b : JSON.stringify(b ?? null));
const n = (v) => Number(v ?? 0) || 0;
export const OWNER_PERIODS = ['week', 'month', 'year'];
export const PAID_PAYMENT_STATUSES = ['completed', 'paid', 'captured', 'approved', 'settled', 'succeeded'];   // owner.kysely.repository paymentMix

/** PURE (unit-tested): compare the API's per-technician rows with the database's aggregates. Returns the mismatches. */
export function diffTechnicianRows(apiRows, dbByTech) {
  const out = [];
  for (const r of apiRows) {
    const d = dbByTech.get(r.technicianId) ?? { services: 0, sales: 0, commission: 0 };
    if (n(r.servicesCompleted) !== d.services || n(r.salesCents) !== d.sales || n(r.commissionCents) !== d.commission)
      out.push({ technicianId: r.technicianId, api: [r.servicesCompleted, r.salesCents, r.commissionCents], db: [d.services, d.sales, d.commission] });
  }
  return out;
}
/** PURE (unit-tested): the API's top services agree with the database's ranking — same revenue per name, the same set at
 *  every revenue strictly above the cut (ties at the cut may be ordered either way). */
export function topServicesAgree(api, db) {
  if (api.length !== Math.min(db.length, api.length) || api.length !== db.slice(0, api.length).length) return false;
  const dbRev = new Map(db.map((x) => [x.name, x.revenueCents]));
  if (!api.every((x) => dbRev.get(x.name) === x.revenueCents)) return false;
  const cut = api.length ? api[api.length - 1].revenueCents : Infinity;
  const mustHave = db.filter((x) => x.revenueCents > cut).map((x) => x.name);
  return mustHave.every((nm) => api.some((x) => x.name === nm)) && api.every((x, i) => i === 0 || api[i - 1].revenueCents >= x.revenueCents);
}
/** PURE (unit-tested): a CSV export → its rows (the owner exports quote fields that hold commas). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export async function largeSalonOwnerPhase(env) {
  const { check, info, q, T, B, short, ok2, numbers, tag, openLive, SCREENS, sleep } = env;
  const stats = { rateLimited: 0 };
  const run = pacer(Number(process.env.PILOT_M5_RPS || 30), stats, sleep);
  const rec = pacedSession(env.rec, run, sleep), own = pacedSession(env.own, run, sleep);
  const L = (numbers.large ??= {}); const M = (L.owner = { perf: {}, periods: {} });
  const timed = async (key, fn) => { const t0 = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - t0); (M.perf[key] ??= []).push(ms); return { ...r, ms }; };
  const sec = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran to the end`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); } };

  // ── 11q-a. a paid day across the floor ──────────────────────────────────────────────────────────────────────────────
  await sec('11q-a paid day', async () => {
    // technicians clocked in at this location right now (the phase's clock-in burst), each with a service she is approved for
    const techs = await q(`select t.id, t.full_name, (select ts.service_id from technician_services ts join services s on s.id = ts.service_id
                             where ts.technician_id = t.id and ts.tenant_id = t.tenant_id and s.status = 'active' and s.archived_at is null and s.price_cents > 0 order by s.price_cents desc, s.id limit 1) as service_id
                           from technicians t join technician_workforce_state w on w.technician_id = t.id and w.tenant_id = t.tenant_id
                           where t.tenant_id = $1 and t.branch_id = $2 and t.status = 'active' and w.branch_id = $2 and w.clock_status in ('CLOCKED_IN', 'ON_BREAK')
                           order by t.full_name, t.id limit 120`, [T, B]);
    const floor = techs.filter((t) => t.service_id);
    const t0 = performance.now();
    const served = await pool(floor, 4, async (t, i) => {
      const steps = [];
      const qi = await rec.post('/pos/queue/items', { customerName: `Owner Report ${tag} ${i + 1}`, serviceIds: [t.service_id], source: 'walk_in', requestedTechnicianId: t.id }); steps.push(qi.status);
      const G = qi.body?.queueItemId ?? qi.body?.id; if (!G) return { ok: false, steps, err: qi.body };
      const as = await rec.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: t.id, source: 'staff', reason: 'The guest asked for her' }); steps.push(as.status);
      const st = await rec.post(`/pos/queue/items/${G}/start-service`, {}); steps.push(st.status);
      const TK = st.body?.servingTicketId; if (!TK) return { ok: false, steps, err: st.body ?? as.body };
      const dn = await rec.post(`/pos/serving/tickets/${TK}/mark-service-done`, {}); steps.push(dn.status);
      const sd = await rec.post(`/pos/serving/tickets/${TK}/send-to-service-done`, {}); steps.push(sd.status);
      if (i % 3 === 0) { const tp = await rec.post(`/pos/checkout/tickets/${TK}/apply-tip`, { tipType: 'custom', tipAmountCents: 500 + (i % 7) * 100, source: 'pos' }); steps.push(tp.status); }
      const det = await rec.get(`/pos/checkout/tickets/${TK}`);
      const due = det.body?.totals?.totalDueCents ?? det.body?.totalDueCents;
      const pay = await rec.post(`/pos/checkout/tickets/${TK}/pay/cash`, { amountReceivedCents: due }, { 'idempotency-key': `owner-day-${tag}-${i}` }); steps.push(pay.status);
      return { ok: steps.every(ok2), steps, ticketId: TK, technicianId: t.id, err: steps.every(ok2) ? null : (pay.body ?? det.body) };
    });
    const ms = Math.round(performance.now() - t0);
    const ids = served.map((s) => s.ticketId).filter(Boolean);
    const paidTickets = ids.length ? (await q(`select count(*)::int n from tickets where id = any($1::uuid[]) and status = 'paid'`, [ids]))[0].n : 0;
    const paidTechs = ids.length ? (await q(`select count(distinct l.technician_id)::int n from ticket_service_lines l join tickets t on t.id = l.ticket_id where t.id = any($1::uuid[]) and t.status = 'paid' and l.removed_at is null`, [ids]))[0].n : 0;
    const paid = [{ techs: paidTechs }];
    M.day = { technicians: floor.length, served: served.filter((s) => s.ok).length, paidTickets, techniciansPaid: paid[0].techs, ms, failures: served.filter((s) => !s.ok).slice(0, 3).map((s) => [s.steps, short(s.err)]), rateLimited: stats.rateLimited };
    check(`A PAID DAY ACROSS THE FLOOR (§69 data): ${floor.length} clocked-in technicians each served one walk-in through the POS (queue → assign → start → Service Done → cash; every third tipped) — ${paidTickets} tickets paid for ${paid[0].techs} technicians in ${ms} ms`,
      floor.length >= 50 && paidTickets === floor.length && paid[0].techs === floor.length, short(M.day));
  });

  // ── 11q-b. the Owner App's reads at 200, against the database ───────────────────────────────────────────────────────
  // the owner's branch scope as the API applies it (user_branch_access; none = the whole salon)
  const ownerId = (await q(`select id from users where tenant_id = $1 and role = 'OWNER' order by created_at limit 1`, [T]))[0]?.id;
  const allowed = (await q(`select branch_id from user_branch_access where tenant_id = $1 and user_id = $2`, [T, ownerId])).map((r) => r.branch_id);
  const scope = (col) => (allowed.length ? `and ${col} = any($4::uuid[])` : 'and $4::uuid[] is not null');
  const args = (from, to) => [T, from, to, allowed];
  const roster = (await q(`select count(*)::int n from technicians where tenant_id = $1 ${allowed.length ? 'and branch_id = any($2::uuid[])' : 'and $2::uuid[] is not null'}`, [T, allowed]))[0].n;

  for (const P of OWNER_PERIODS) await sec(`11q-b owner ${P}`, async () => {
    const R = (M.periods[P] = {});
    // Team / Staff Performance — every page
    const pageSize = P === 'week' ? 20 : 100;
    const rows = []; let first = null, pages = 0;
    for (let p = 1; p <= 60; p++) {
      const r = await timed(`staffPage_${P}`, () => own.get(`/owner/staff/performance/technicians?period=${P}&page=${p}&pageSize=${pageSize}`));
      if (!ok2(r.status)) { R.staffError = [r.status, short(r.body)]; break; }
      first ??= r; pages++; rows.push(...(r.body?.items ?? []));
      if (p === 1) R.staffPage1 = { ms: r.ms, bytes: bytes(r.body) };
      if (p >= (r.body?.totalPages ?? 1)) break;
    }
    const win = first?.body?.period ?? {};
    const [from, to] = [win.from, win.to];
    const dbLines = await q(`select l.technician_id tid, count(*)::int services, coalesce(sum(l.line_total_cents),0)::bigint sales
                             from ticket_service_lines l join tickets t on t.id = l.ticket_id
                             where t.tenant_id = $1 and t.status = 'paid' and t.paid_at >= $2 and t.paid_at < $3 and l.technician_id is not null ${scope('t.branch_id')}
                             group by 1`, args(from, to));
    const dbComm = await q(`select tid, sum(c)::bigint commission from (
                              select s.technician_id tid, coalesce(sum(s.tech_service_earnings_cents + s.retail_commission_cents),0) c from ticket_compensation_snapshots s
                               where s.tenant_id = $1 and s.snapshot_at >= $2 and s.snapshot_at < $3 ${scope('s.branch_id')} group by 1
                              union all
                              select a.technician_id tid, coalesce(sum(a.amount_cents),0) c from compensation_adjustments a
                               where a.tenant_id = $1 and a.status in ('posted','approved','applied') and a.category <> 'tip_correction' and a.created_at >= $2 and a.created_at < $3 ${scope('a.branch_id')} group by 1
                            ) u group by tid`, args(from, to));
    const db = new Map();
    for (const x of dbLines) db.set(x.tid, { services: n(x.services), sales: n(x.sales), commission: 0 });
    for (const x of dbComm) { const e = db.get(x.tid) ?? { services: 0, sales: 0, commission: 0 }; e.commission = n(x.commission); db.set(x.tid, e); }
    const diffs = diffTechnicianRows(rows, db);
    const ids = new Set(rows.map((r) => r.technicianId));
    const sum = (k) => rows.reduce((s, r) => s + n(r[k]), 0);
    const dbSales = [...db.values()].reduce((s, x) => s + x.sales, 0), dbServices = [...db.values()].reduce((s, x) => s + x.services, 0);
    const ranked = rows.every((r, i) => i === 0 || n(rows[i - 1].salesCents) >= n(r.salesCents));
    R.staff = { pages, rows: rows.length, distinct: ids.size, totalAll: first?.body?.totalAll, roster, withSales: rows.filter((r) => n(r.salesCents) > 0).length, sales: sum('salesCents'), dbSales, services: sum('servicesCompleted'), dbServices, commission: sum('commissionCents'), diffs: diffs.length, sample: diffs.slice(0, 2), page1: R.staffPage1 };
    check(`OWNER APP TEAM / STAFF PERFORMANCE (${P}) (§62/§69/§71): ${pages} server pages of ${pageSize} carry all ${rows.length} technicians once each (roster ${roster}), ranked by sales; every technician's services / sales / commission equals PostgreSQL (${R.staff.withSales} with sales, Σ sales ${sum('salesCents')} = ${dbSales}, Σ services ${sum('servicesCompleted')} = ${dbServices}); page 1 in ${R.staffPage1?.ms} ms, ${R.staffPage1?.bytes} B`,
      rows.length === roster && ids.size === roster && first?.body?.totalAll === roster && diffs.length === 0 && sum('salesCents') === dbSales && sum('servicesCompleted') === dbServices && ranked && R.staff.withSales >= 50,
      short(R.staff));

    // by branch
    const br = await timed(`branches_${P}`, () => own.get(`/owner/branches/performance?period=${P}`));
    const bw = br.body?.period ?? {};
    const dbBr = await q(`select branch_id, coalesce(sum(total_cents),0)::bigint rev, count(*)::int n from tickets where tenant_id = $1 and status = 'paid' and paid_at >= $2 and paid_at < $3 ${scope('branch_id')} group by 1`, args(bw.from, bw.to));
    const dbBrMap = new Map(dbBr.map((x) => [x.branch_id, n(x.rev)]));
    const brDiffs = (br.body?.branches ?? []).filter((b) => n(b.revenueCents) !== (dbBrMap.get(b.branchId) ?? 0)).map((b) => [b.branchName, b.revenueCents, dbBrMap.get(b.branchId) ?? 0]);
    const brTotalDb = [...dbBrMap.values()].reduce((s, x) => s + x, 0);
    R.branches = { status: br.status, ms: br.ms, branches: (br.body?.branches ?? []).length, total: br.body?.totalRevenueCents, dbTotal: brTotalDb, diffs: brDiffs };
    check(`OWNER APP BY BRANCH (${P}): every branch's paid revenue equals PostgreSQL (${R.branches.branches} branches, total ${br.body?.totalRevenueCents} = ${brTotalDb}) in ${br.ms} ms`,
      ok2(br.status) && brDiffs.length === 0 && n(br.body?.totalRevenueCents) === brTotalDb && R.branches.branches >= 1, short(R.branches));

    // by service (+ the period's totals)
    const fs = await timed(`finance_${P}`, () => own.get(`/owner/finance/summary?period=${P}`));
    const fw = fs.body?.period ?? {};
    const tot = (await q(`select coalesce(sum(total_cents),0)::bigint rev, coalesce(sum(tip_cents),0)::bigint tips, count(*)::int n from tickets where tenant_id = $1 and status = 'paid' and paid_at >= $2 and paid_at < $3 ${scope('branch_id')}`, args(fw.from, fw.to)))[0];
    const svc = await q(`select l.service_name_snapshot as name, coalesce(sum(l.line_total_cents),0)::bigint rev from ticket_service_lines l join tickets t on t.id = l.ticket_id
                         where l.tenant_id = $1 and t.status = 'paid' and t.paid_at >= $2 and t.paid_at < $3 ${scope('t.branch_id')} group by 1 order by 2 desc`, args(fw.from, fw.to));
    const dbSvc = svc.map((x) => ({ name: x.name ?? 'Service', revenueCents: n(x.rev) }));
    const top = fs.body?.topServices ?? [];
    R.services = { status: fs.status, ms: fs.ms, revenue: [fs.body?.totalRevenueCents, n(tot.rev)], tips: [fs.body?.tipsCents, n(tot.tips)], transactions: [fs.body?.totalTransactions, tot.n], top: top.map((x) => `${x.name}:${x.revenueCents}`), dbTop: dbSvc.slice(0, top.length + 1).map((x) => `${x.name}:${x.revenueCents}`), services: dbSvc.length };
    check(`OWNER APP BY SERVICE (${P}): revenue ${fs.body?.totalRevenueCents}, tips ${fs.body?.tipsCents}, ${fs.body?.totalTransactions} paid tickets and the top ${top.length} services (of ${dbSvc.length}) equal PostgreSQL, in ${fs.ms} ms`,
      ok2(fs.status) && n(fs.body?.totalRevenueCents) === n(tot.rev) && n(fs.body?.tipsCents) === n(tot.tips) && n(fs.body?.totalTransactions) === tot.n && top.length > 0 && topServicesAgree(top, dbSvc), short(R.services));

    // by payout method — the tender
    const pm = await timed(`paymentMix_${P}`, () => own.get(`/owner/finance/payment-mix?period=${P}`));
    const pw = pm.body?.period ?? {};
    const dbPm = await q(`select coalesce(method,'other') m, coalesce(sum(amount_cents),0)::bigint amt, count(*)::int c from payments where tenant_id = $1 and status = any($5::text[]) and created_at >= $2 and created_at < $3 ${scope('branch_id')} group by 1`, [...args(pw.from, pw.to), PAID_PAYMENT_STATUSES]);
    const dbPmMap = new Map(dbPm.map((x) => [x.m, [n(x.amt), x.c]]));
    const pmDiffs = (pm.body?.methods ?? []).filter((m) => { const d = dbPmMap.get(m.method); return !d || d[0] !== n(m.amountCents) || d[1] !== m.count; }).map((m) => [m.method, m.amountCents, m.count, dbPmMap.get(m.method)]);
    R.tender = { status: pm.status, ms: pm.ms, methods: (pm.body?.methods ?? []).map((m) => `${m.method}:${m.amountCents}/${m.count}`), db: dbPm.map((x) => `${x.m}:${x.amt}/${x.c}`), diffs: pmDiffs };
    check(`OWNER APP BY PAYMENT METHOD (${P}): ${R.tender.methods.join(' · ')} — each method's amount and count equal PostgreSQL, in ${pm.ms} ms`,
      ok2(pm.status) && pmDiffs.length === 0 && (pm.body?.methods ?? []).length === dbPm.length && (pm.body?.methods ?? []).some((m) => m.method === 'cash'), short(R.tender));

    // the Staff report export: one row per technician, its sales column = the database
    const ex = await timed(`staffExport_${P}`, () => own.get(`/owner/reports/staff/export?period=${P}`));
    const csv = parseCsv(String(ex.body?.content ?? ''));
    const salesCol = csv[0]?.findIndex((h) => /^Sales/.test(h)) ?? -1;
    const exportSales = Math.round(csv.slice(1).reduce((s, r) => s + Number(r[salesCol] || 0) * 100, 0));
    R.export = { status: ex.status, ms: ex.ms, rows: csv.length - 1, sales: exportSales, dbSales };
    check(`OWNER APP STAFF REPORT EXPORT (${P}): ${csv.length - 1} rows (one per technician), sales column Σ ${exportSales} = PostgreSQL ${dbSales}, in ${ex.ms} ms`,
      ok2(ex.status) && csv.length - 1 === roster && exportSales === dbSales, short(R.export));
  });

  // by payout method — the payroll week (check / cash), the 200-technician week of M5
  await sec('11q-b payroll week', async () => {
    const per = (await q(`select id, label from payroll_periods where tenant_id = $1 and label like '200-technician week%' order by created_at desc limit 1`, [T]))[0];
    if (!per) { check('OWNER APP PAYROLL WEEK (§62/§66): the 200-technician week exists', false, 'no 200-technician payroll period (M5 skipped?)'); return; }
    M.payrollPeriodId = per.id;
    const wk = await timed('payrollWeek', () => own.get(`/owner/payroll/paychecks/periods/${per.id}`));
    const t = wk.body?.totals ?? {};
    const dbSt = (await q(`select count(*)::int n, coalesce(sum(line_payable_cents),0)::bigint payable, coalesce(sum(gross_earnings_cents),0)::bigint gross from payroll_statements where tenant_id = $1 and period_id = $2 and status <> 'voided'`, [T, per.id]))[0];
    const dbPo = await q(`select method, coalesce(sum(amount_cents),0)::bigint amt, count(*)::int c from payroll_payouts where tenant_id = $1 and period_id = $2 and status not in ('voided','cancelled','failed') group by 1`, [T, per.id]);
    const po = Object.fromEntries(dbPo.map((x) => [x.method, n(x.amt)]));
    const summary = await timed('payrollSummary', () => own.get('/owner/payroll/paychecks/summary'));
    M.payroll = { status: wk.status, ms: wk.ms, bytes: bytes(wk.body), statements: (wk.body?.statements ?? []).length, technicians: t.technicians, dbStatements: dbSt.n, payable: [t.payableCents, n(dbSt.payable)], gross: [t.grossEarningsCents, n(dbSt.gross)], check: [t.checkCents, po.check ?? 0], cash: [t.cashCents, po.cash ?? 0], other: t.otherCents, summaryMs: summary.ms };
    check(`OWNER APP PAYROLL WEEK BY PAYOUT METHOD (§62/§63/§69): the 200-technician week opens with ${M.payroll.statements} statements in ${wk.ms} ms (${M.payroll.bytes} B); payable ${t.payableCents} / gross ${t.grossEarningsCents} equal the statements in PostgreSQL; by check ${t.checkCents} and in cash ${t.cashCents} equal the week's payouts by method`,
      ok2(wk.status) && M.payroll.statements === dbSt.n && dbSt.n >= 200 && n(t.payableCents) === n(dbSt.payable) && n(t.grossEarningsCents) === n(dbSt.gross) && n(t.checkCents) === (po.check ?? 0) && n(t.cashCents) === (po.cash ?? 0) && n(t.checkCents) + n(t.cashCents) + n(t.otherCents) === n(t.payableCents),
      short(M.payroll));
  });

  const lat = Object.fromEntries(Object.entries(M.perf).map(([k, xs]) => [k, xs.length > 1 ? `p50 ${pct(xs, 50)} / p95 ${pct(xs, 95)} ms (${xs.length})` : `${xs[0]} ms`]));
  M.latency = lat;
  info(`OWNER APP LATENCY (§62/§69, 200+ technicians): ${Object.entries(lat).map(([k, v]) => `${k} ${v}`).join('; ')}`);

  // ── 11q-c. the Owner App screens in Chromium at phone size ──────────────────────────────────────────────────────────
  await sec('11q-c owner screens', async () => {
    if (!SCREENS || !openLive) { info('SKIP Owner App screens (PILOT_SCREENS=0)'); return; }
    const phone = { width: 390, height: 844 };
    const opened = new WeakMap();
    const open = async (init) => { const o = await openLive('owner-web', '/', env.own, { viewport: phone, init: [init] }); if (o) opened.set(o, Date.now()); return o; };
    // the app's animated splash (2.6 s) overlays the screen — the screenshot waits it out, as the pilot's shoot() does
    const snap = async (o, name) => { const left = 3200 - (Date.now() - (opened.get(o) ?? 0)); if (left > 0) await sleep(left); return o.shot(name); };
    const settle = async (page, re, ms = 20_000) => { const t0 = Date.now(); let text = ''; while (Date.now() - t0 < ms) { text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' '); if (re.test(text)) break; await sleep(250); } return { text, ms: Date.now() - t0 }; };
    const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => -1);
    const out = (M.screens = {});
    // Team (staff tab): the server-paged list — page 1 = the API's page 1 for the screen's period (week), Next → page 2
    const api1 = (await own.get('/owner/staff/performance/technicians?period=week&page=1')).body;
    const team = await open(() => { try { sessionStorage.setItem('aps_owner_target_tab', 'staff'); } catch { /* */ } });
    if (team) {
      const want = new RegExp(`Page 1 of ${api1?.totalPages}`);
      const s1 = await settle(team.page, want);
      const rowsOnPage = await team.page.locator('[data-tech-row]').count();
      const firstName = (await team.page.locator('[data-tech-row] .nm').first().innerText().catch(() => '')).trim();
      await team.page.locator('[data-testid="all-technicians"]').scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);   // the server-paged list, not the top-10 card
      await snap(team, 'owner-app-team-200');
      await team.page.getByRole('button', { name: /next/i }).last().click({ timeout: 8000 }).catch(() => undefined);
      const s2 = await settle(team.page, new RegExp(`Page 2 of ${api1?.totalPages}`));
      out.team = { matched: want.test(s1.text), ms: s1.ms, rowsOnPage, firstName, apiFirst: api1?.items?.[0]?.fullName, page2: new RegExp(`Page 2 of ${api1?.totalPages}`).test(s2.text), sideways: await sideways(team.page), pageErrors: team.pageErrors.slice(0, 3) };
      await team.close();
      check(`OWNER APP TEAM AT PHONE SIZE (390×844, Chromium): the staff tab draws ${rowsOnPage} technicians of page 1 of ${api1?.totalPages} (the server's page 1 — "${firstName}" first, as the API), Next goes to page 2, in ${s1.ms} ms; no page errors, no sideways scroll`,
        out.team.matched && rowsOnPage === (api1?.items?.length ?? -1) && firstName === api1?.items?.[0]?.fullName && out.team.page2 && out.team.pageErrors.length === 0 && out.team.sideways <= 0, short(out.team));
    }
    // Reports: the month's revenue as the API said
    const fsM = (await own.get('/owner/finance/summary?period=month')).body;
    const dollars = (c) => `$${Math.round(n(c) / 100).toLocaleString('en-US')}`;
    const rep = await open(() => { try { sessionStorage.setItem('aps_owner_target_tab', 'reports'); } catch { /* */ } });
    if (rep) {
      const want = dollars(fsM?.totalRevenueCents);
      const s = await settle(rep.page, new RegExp(want.replace(/[$]/g, '\\$')));
      await snap(rep, 'owner-app-reports-200');
      out.reports = { want, matched: s.text.includes(want), ms: s.ms, sideways: await sideways(rep.page), pageErrors: rep.pageErrors.slice(0, 3) };
      await rep.close();
      check(`OWNER APP REPORTS AT PHONE SIZE: the month's revenue ${want} (the API's, = PostgreSQL above) on screen in ${s.ms} ms; no page errors, no sideways scroll`,
        out.reports.matched && out.reports.pageErrors.length === 0 && out.reports.sideways <= 0, short(out.reports));
    }
    // Payroll: the 200-statement week — payable / by check / in cash as the API said
    if (M.payrollPeriodId) {
      const wk = (await own.get(`/owner/payroll/paychecks/periods/${M.payrollPeriodId}`)).body?.totals ?? {};
      const cents2 = (c) => `$${(n(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const pid = M.payrollPeriodId;
      const pay = await open(`try { sessionStorage.setItem('aps_owner_target_tab', 'more'); sessionStorage.setItem('aps_owner_target_pushed', JSON.stringify({ kind: 'payroll', periodId: '${pid}' })); } catch (e) {}`);
      if (pay) {
        const wants = [cents2(wk.payableCents), cents2(wk.checkCents), cents2(wk.cashCents)];
        const s = await settle(pay.page, new RegExp(wants.map((w) => w.replace(/[$.]/g, (c) => `\\${c}`)).join('[\\s\\S]*')), 25_000);
        await pay.page.getByText('By check').first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
        await snap(pay, 'owner-app-payroll-200');
        out.payroll = { wants, matched: wants.every((w) => s.text.includes(w)), ms: s.ms, sideways: await sideways(pay.page), pageErrors: pay.pageErrors.slice(0, 3) };
        await pay.close();
        check(`OWNER APP PAYROLL WEEK AT PHONE SIZE: the 200-technician week shows payable ${wants[0]}, by check ${wants[1]}, in cash ${wants[2]} (the API's = PostgreSQL above) in ${s.ms} ms; no page errors, no sideways scroll`,
          out.payroll.matched && out.payroll.pageErrors.length === 0 && out.payroll.sideways <= 0, short(out.payroll));
      }
    }
  });
  if (stats.rateLimited) info(`RATE LIMIT (owner): ${stats.rateLimited} request(s) were answered 429 and re-sent after Retry-After`);
  return M;
}
