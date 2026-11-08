// pilot-vietnamese.mjs — PHASE 13 of live-pilot-day.mjs: the English + Vietnamese POS mandate (Oct 26 2026) on the pilot's
// own 200-technician salon, through the REAL API on PostgreSQL and the BUILT POS in Chromium (mandate §8–§13, §35, §39,
// §41, §56, §66–§80, §102–§115, §118). Nothing is written with SQL; the database is only READ to cross-check.
//   13a  the salon default becomes Vietnamese (owner); the manager (no own choice) gets vi, the receptionist (chose English)
//        keeps en; a choice survives logout / sign-in and a NEW device (a fresh browser) — both directions
//   13b  Vietnamese text: a customer "Nguyễn Thị Hương" with the note "Khách muốn sơn màu đỏ và thêm thiết kế hoa." and two
//        technicians renamed "Trần Mỹ Linh" / "Đặng Minh Tuấn" — byte-identical through API and PostgreSQL; accent-free
//        searches ("nguyen", "tran", "dang") find them in customers, global search, the 200-technician picker and the Live
//        Technician Schedule
//   13c  a busy floor at 200 technicians: 30 waiting (Vietnamese names), 25 in service, 12 ready for checkout and one card
//        payment whose answer never came back (UNKNOWN)
//   13d  Vietnamese screens in Chromium at 200 technicians: Booking (17 pages, search "nguyen"), Tech Queue, Customer
//        Queue (the assign picker pages on the server), Serving, Service Done, Checkout with the UNKNOWN banner in the
//        mandate's exact words (§35)
//   13e  the one-screen matrix (tooling/e2e/pos-vi-one-screen.mjs) on the busy floor: 9 modules × EN / VI × 6 viewports (primary: a 1920×1080 screen with browser chrome + taskbar = a 1920×945 page)
//   13f  20 language switches on a live Booking board (technician page 3 + a service filter + a date): one EventSource, the
//        realtime listener counts flat, JS heap flat, switch-to-paint time; the board state kept; then Customer Queue (an
//        open Manage drawer) and Checkout (the UNKNOWN banner, tender blocked, Verify available) across switches — and not
//        one pay / verify request
//   13g  a platform announcement with a reviewed Vietnamese version: Vietnamese for the Vietnamese user, English for the
//        English user, in the POS bar
//   13h  receipts in the CUSTOMER's language: a Vietnamese customer gets the Vietnamese SMS receipt, an English one the
//        English receipt — whatever the cashier's language
//   13i  Super Admin stays English (admin-web in Chromium while the salon's default is Vietnamese)
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pacer, pacedSession } from './pilot-large-salon-m5.mjs';
import { runOneScreenMatrix, fontCache, routeFonts, VIEWPORTS, PRIMARY } from '../../../../tooling/e2e/pos-vi-one-screen.mjs';

const VI_NAMES = ['Nguyễn Thị Hương', 'Trần Mỹ Linh', 'Lê Thu Trang', 'Phạm Ngọc Ánh', 'Hoàng Bảo Châu', 'Huỳnh Gia Hân', 'Võ Thị Kim Ngân', 'Đặng Thu Hà', 'Bùi Phương Thảo', 'Đỗ Mai Anh',
  'Hồ Thanh Tâm', 'Ngô Diễm My', 'Dương Khánh Linh', 'Lý Tuyết Nhi', 'Phan Quỳnh Như', 'Vũ Hồng Nhung', 'Trịnh Thùy Dương', 'Mai Thảo Vy', 'Tô Hải Yến', 'Cao Minh Thư'];
const NOTE = 'Khách muốn sơn màu đỏ và thêm thiết kế hoa.';
const UNKNOWN_EN = 'Payment status is uncertain. Do not pay again. Verify the transaction first.';
const UNKNOWN_VI = 'Trạng thái thanh toán chưa xác định. Không thanh toán lại. Hãy kiểm tra giao dịch trước.';
const VI_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const hex = (s) => Buffer.from(String(s), 'utf8').toString('hex');

export async function vietnamesePhase(env) {
  const { check, info, q, T, B, short, ok2, numbers, tag, session, tenantLogin, STAFF_PW, OWNER_PW, SCREENS, sleep, openLive, ensureBrowser, ensureApp, CP_TOKENS, shotsDir, adminPort, saStepUp } = env;
  const stats = { rateLimited: 0 };
  const run = pacer(Number(process.env.PILOT_M5_RPS || 30), stats, sleep);
  const own = pacedSession(env.own, run, sleep), rec = pacedSession(env.rec, run, sleep), mgr = pacedSession(env.mgr, run, sleep), sa = env.sa;
  const V = (numbers.vietnamese = { perf: {} });
  const sec = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran to the end`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); } };
  const waitFor = async (fn, ms = 15000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(step); } return false; };
  const recEmail = `rec.${tag}@pilot-day.test`;
  const locale = async (s) => (await s.get('/pos/me/locale')).body?.language ?? null;

  // ── 13a. the salon default, the user's own choice, persistence ──────────────────────────────────────────────────────
  await sec('13a language authority', async () => {
    const r0 = await rec.put('/pos/me/language', { language: 'en' });   // the receptionist chose English
    const sd = await own.patch('/pos/settings/business-branch', { defaultLanguage: 'vi' });
    const authority = (await q(`select settings_json->>'defaultLanguage' as l from tenant_settings where tenant_id = $1 and category = 'business-branch' and branch_id is null`, [T]).catch(() => []))[0]?.l ?? null;
    const recPref = (await q(`select preferred_language from users where email = $1`, [recEmail]))[0]?.preferred_language;
    const mgrRow = (await q(`select preferred_language from users where tenant_id = $1 and role = 'MANAGER' order by created_at limit 1`, [T]))[0];
    V.authority = { setDefault: sd.status, authority, rec: await locale(rec), recStored: recPref, mgr: await locale(mgr), mgrStored: mgrRow?.preferred_language ?? null, own: await locale(own) };
    check(`SALON DEFAULT VIETNAMESE (§8–§12): the owner sets the salon's POS language to Tiếng Việt in Settings → Business; the MANAGER (no choice of her own) now gets vi, the RECEPTIONIST who chose English keeps en (her choice wins), the database keeps one authority`,
      ok2(r0.status) && ok2(sd.status) && authority === 'vi' && V.authority.rec === 'en' && recPref === 'en' && V.authority.mgr === 'vi' && mgrRow?.preferred_language == null, short(V.authority));
    // persistence: the receptionist switches to Vietnamese → signs out → signs in again → a brand-new device; and back
    const sw = await rec.put('/pos/me/language', { language: 'vi' });
    const out1 = await rec.post('/auth/logout', {});
    const fresh = session('rec-relogin'); const li = await tenantLogin(fresh, recEmail, STAFF_PW, B);
    const afterLogin = await locale(fresh);
    const device2 = session('rec-new-device'); const li2 = await tenantLogin(device2, recEmail, STAFF_PW, B);
    const onNewDevice = await locale(device2);
    let browserLang = null;
    if (SCREENS) { const p = await openLive('pos-web', '/overview', device2, { viewport: { width: 1920, height: 1080 } }); if (p) { await waitFor(async () => (await p.page.evaluate(() => document.documentElement.lang)) === 'vi', 15000); browserLang = { lang: await p.page.evaluate(() => document.documentElement.lang), nav: (await p.page.locator('nav, aside').first().innerText().catch(() => '')).slice(0, 200) }; await p.close(); } }
    const back = await device2.put('/pos/me/language', { language: 'en' });
    const out2 = await device2.post('/auth/logout', {});
    const third = session('rec-third'); const li3 = await tenantLogin(third, recEmail, STAFF_PW, B);
    const afterBack = await locale(third);
    env.rec = third;   // the receptionist's live session for the rest of the phase (English)
    V.persistence = { switch: sw.status, logout: out1.status, login: li.ok, afterLogin, newDevice: li2.ok, onNewDevice, browserLang, back: back.status, logout2: out2.status, relogin: li3.ok, afterBack };
    check(`LANGUAGE PERSISTS (§13, §102): the receptionist switches to Tiếng Việt → signs out → signs in: vi; a brand-new device (fresh session${SCREENS ? ', a new Chromium context: <html lang="vi">, Vietnamese navigation' : ''}): vi; she switches back to English → signs out → signs in: en`,
      ok2(sw.status) && li.ok && afterLogin === 'vi' && li2.ok && onNewDevice === 'vi' && (!SCREENS || (browserLang?.lang === 'vi' && VI_LETTER.test(browserLang?.nav ?? ''))) && ok2(back.status) && li3.ok && afterBack === 'en', short(V.persistence));
  });
  const recNow = () => pacedSession(env.rec, run, sleep);

  // ── 13b. Vietnamese text through API + PostgreSQL; accent-free search ───────────────────────────────────────────────
  let huong = null; const renamed = {};
  await sec('13b unicode + search', async () => {
    const phone = `+1609547${String(Number(tag) % 10000).padStart(4, '0')}`;   // 609547: no other phase uses it (609551 = phase 4's walk-in)
    const cr = await own.post('/pos/customers', { firstName: 'Nguyễn Thị', lastName: 'Hương', phone, notes: NOTE });
    huong = cr.body?.customerId ?? cr.body?.id ?? cr.body?.customer?.id ?? null;
    const lang = huong ? await own.patch(`/pos/customers/${huong}`, { preferredLanguage: 'Tiếng Việt' }) : { status: 0 };
    const got = huong ? await own.get(`/pos/customers/${huong}`) : { status: 0, body: null };
    const row = huong ? (await q(`select full_name, notes, preferred_language, encode(convert_to(full_name, 'UTF8'), 'hex') as h from customers where id = $1`, [huong]))[0] : null;
    const apiName = got.body?.displayName ?? got.body?.fullName ?? ([got.body?.firstName, got.body?.lastName].filter(Boolean).join(' ') || null);
    const apiNotes = JSON.stringify(got.body ?? {});
    V.unicode = { create: cr.status, createError: cr.status >= 300 ? cr.body : undefined, setLang: lang.status, read: got.status, apiName, dbName: row?.full_name, dbLang: row?.preferred_language, hexEqual: row?.h === hex('Nguyễn Thị Hương'), noteKept: row?.notes === NOTE || apiNotes.includes(NOTE) };
    check(`VIETNAMESE TEXT ROUND TRIP (§39, §109): the customer "Nguyễn Thị Hương" with the note "${NOTE}" is created through the POS API and read back byte-identical (API, PostgreSQL UTF-8 bytes); "Tiếng Việt" typed as her language is stored as the code vi`,
      ok2(cr.status) && ok2(lang.status) && apiName === 'Nguyễn Thị Hương' && row?.full_name === 'Nguyễn Thị Hương' && V.unicode.hexEqual && V.unicode.noteKept && row?.preferred_language === 'vi', short(V.unicode));
    // two roster technicians renamed (the 200 stay 200)
    const pick = await q(`select id, full_name from technicians where tenant_id = $1 and branch_id = $2 and is_active and full_name like 'Aa Roster%' order by full_name desc limit 2`, [T, B]);
    for (const [i, nm] of [[0, 'Trần Mỹ Linh'], [1, 'Đặng Minh Tuấn']]) { const t = pick[i]; if (!t) continue; const r = await own.patch(`/pos/technicians/${t.id}`, { fullName: nm }); renamed[nm] = { id: t.id, from: t.full_name, status: r.status }; }
    const techRows = await q(`select id, full_name from technicians where id = any($1::uuid[])`, [Object.values(renamed).map((x) => x.id)]);
    const s1 = await own.get('/pos/customers?search=nguyen&pageSize=20');
    const s2 = await own.get('/pos/search?q=nguyen');
    const pickTran = await recNow().get('/pos/booking/technicians?search=tran&pageSize=12');
    const pickDang = await recNow().get('/pos/booking/technicians?search=dang&pageSize=12');
    const lane = await recNow().get('/pos/technicians/live-schedule/state?lanePage=1&lanePageSize=12&laneSearch=tran&roster=none');
    const names = (x) => JSON.stringify(x ?? {});
    V.search = { renamed, db: techRows.map((r) => r.full_name), customers: s1.status, global: s2.status, pickTran: (pickTran.body?.technicians ?? []).map((t) => t.name), pickDang: (pickDang.body?.technicians ?? []).map((t) => t.name), lane: (lane.body?.schedule?.technicians ?? []).map((c) => c.fullName), laneTotal: lane.body?.schedule?.lanes?.total, rosterTotal: pickTran.body?.totalAll };
    check(`ACCENT-FREE SEARCH (§41, §110): "nguyen" finds "Nguyễn Thị Hương" in Customers and in the global search; two of the 200 technicians renamed "Trần Mỹ Linh" / "Đặng Minh Tuấn" (stored exactly) — "tran" / "dang" find them in the server-paged technician picker (of ${V.search.rosterTotal}) and "tran" in the Live Technician Schedule's column search`,
      ok2(s1.status) && names(s1.body).includes('Nguyễn Thị Hương') && ok2(s2.status) && names(s2.body).includes('Nguyễn Thị Hương') && techRows.some((r) => r.full_name === 'Trần Mỹ Linh') && techRows.some((r) => r.full_name === 'Đặng Minh Tuấn')
        && V.search.pickTran.includes('Trần Mỹ Linh') && V.search.pickDang.includes('Đặng Minh Tuấn') && V.search.lane.includes('Trần Mỹ Linh') && V.search.rosterTotal >= 200, short(V.search));
  });

  // ── 13c. a busy floor at 200 technicians ─────────────────────────────────────────────────────────────────────────────
  const floor = { waiting: [], serving: [], ready: [], unknown: null };
  await sec('13c busy floor', async () => {
    const R = recNow();
    const techs = await q(`select t.id, t.full_name, (select ts.service_id from technician_services ts join services s on s.id = ts.service_id
                             where ts.technician_id = t.id and ts.tenant_id = t.tenant_id and s.status = 'active' and s.archived_at is null and s.price_cents > 0 order by s.price_cents desc, s.id limit 1) as service_id
                           from technicians t join technician_workforce_state w on w.technician_id = t.id and w.tenant_id = t.tenant_id
                           where t.tenant_id = $1 and t.branch_id = $2 and t.status = 'active' and w.branch_id = $2 and w.clock_status in ('CLOCKED_IN')
                             and not exists (select 1 from pos_queue_items qi where qi.tenant_id = t.tenant_id and qi.assigned_technician_id = t.id and qi.status in ('assigned','in_service','called'))
                           order by t.full_name desc, t.id limit 60`, [T, B]);
    const free = techs.filter((t) => t.service_id);
    const svc = free[0]?.service_id; floor.serviceId = svc;
    const t0 = performance.now();
    // 30 waiting walk-ins with Vietnamese names (no technician yet)
    for (let i = 0; i < 30; i++) {
      const nm = `${VI_NAMES[i % VI_NAMES.length]}${i >= VI_NAMES.length ? ' ' + (i + 1) : ''}`;
      const r = await R.post('/pos/queue/items', { customerName: nm, customerPhone: `+1609554${String(i).padStart(2, '0')}${String(Number(tag) % 100).padStart(2, '0')}`, serviceIds: [svc], source: 'walk_in' });
      floor.waiting.push({ G: r.body?.queueItemId ?? r.body?.id, status: r.status });
    }
    // 25 in service + 13 done (12 ready for checkout + 1 for the UNKNOWN card), each on her own clocked-in technician
    const one = async (t, i, done) => {
      const steps = [];
      const qi = await R.post('/pos/queue/items', { customerName: `${VI_NAMES[(i + 7) % VI_NAMES.length]} ${done ? 'XC' : 'PV'}${i + 1}`, serviceIds: [t.service_id], source: 'walk_in', requestedTechnicianId: t.id }); steps.push(qi.status);
      const G = qi.body?.queueItemId ?? qi.body?.id; if (!G) return { ok: false, steps, err: qi.body };
      const as = await R.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: t.id, source: 'staff', reason: 'The guest asked for her' }); steps.push(as.status);
      const st = await R.post(`/pos/queue/items/${G}/start-service`, {}); steps.push(st.status);
      const TK = st.body?.servingTicketId; if (!TK) return { ok: false, steps, err: st.body ?? as.body };
      if (done) { const dn = await R.post(`/pos/serving/tickets/${TK}/mark-service-done`, {}); steps.push(dn.status); const sd = await R.post(`/pos/serving/tickets/${TK}/send-to-service-done`, {}); steps.push(sd.status); }
      return { ok: steps.every(ok2), steps, ticketId: TK, technicianId: t.id, G };
    };
    for (let i = 0; i < Math.min(25, free.length); i++) floor.serving.push(await one(free[i], i, false));
    for (let i = 25; i < Math.min(38, free.length); i++) floor.ready.push(await one(free[i], i, true));
    // one of the ready tickets: a card charge whose answer never comes back (the connection drops) → UNKNOWN, unresolved
    const UT = floor.ready.at(-1)?.ticketId;
    if (UT) {
      const det = await R.get(`/pos/checkout/tickets/${UT}`);
      const pay = await R.post(`/pos/checkout/tickets/${UT}/pay/card`, { idempotencyKey: `pilot-vi-unk-${tag}`, cardToken: CP_TOKENS.dropped, expiry: '1230' });
      const row = (await q(`select status from payments where ticket_id = $1 and method = 'card'`, [UT]))[0];
      floor.unknown = { ticketId: UT, due: det.body?.totals?.totalDueCents ?? det.body?.totalDueCents, pay: [pay.status, pay.body?.code], row: row?.status };
    }
    const ms = Math.round(performance.now() - t0);
    const inService = (await q(`select count(*)::int n from tickets where id = any($1::uuid[]) and status in ('serving','in_service','in_progress')`, [floor.serving.map((s) => s.ticketId).filter(Boolean)]).catch(() => [{ n: -1 }]))[0].n;
    V.floor = { freeTechs: free.length, waiting: floor.waiting.filter((x) => ok2(x.status)).length, serving: floor.serving.filter((x) => x.ok).length, servingInDb: inService, ready: floor.ready.filter((x) => x.ok).length, unknown: floor.unknown, ms, rateLimited: stats.rateLimited,
      failures: [...floor.serving, ...floor.ready].filter((x) => !x.ok).slice(0, 3).map((x) => [x.steps, short(x.err)]) };
    check(`BUSY FLOOR AT 200 TECHNICIANS (§112, §113): 30 guests waiting (Vietnamese names), 25 in service and 12 ready for checkout — each on her own clocked-in technician — plus one card charge whose answer never came back (409 PAYMENT_STATUS_UNKNOWN, the attempt stays processing)`,
      V.floor.waiting === 30 && V.floor.serving === 25 && V.floor.ready === 13 && floor.unknown?.pay?.[0] === 409 && floor.unknown?.pay?.[1] === 'PAYMENT_STATUS_UNKNOWN' && floor.unknown?.row === 'processing', short(V.floor));
  });

  if (!SCREENS) { info('NOT_TESTED 13d–13i browser proofs (PILOT_SCREENS=0)'); return; }
  const fonts = (() => { try { return fontCache(); } catch (e) { info(`font cache unavailable: ${String(e?.message || e).slice(0, 120)}`); return null; } })();
  const live = async (path, sess, opts = {}) => { const p = await openLive('pos-web', path, sess, { viewport: { width: 1920, height: 1080 }, ...opts }); if (p && fonts) await routeFonts(p.context, fonts); return p; };
  const mgrLang = async (l) => { const r = await mgr.put('/pos/me/language', { language: l }); if (!ok2(r.status)) throw new Error('language ' + r.status); };
  const bodyText = (page) => page.locator('.main').first().innerText().catch(() => '');

  // ── 13d. Vietnamese screens at 200 technicians ───────────────────────────────────────────────────────────────────
  await sec('13d vietnamese screens', async () => {
    await mgrLang('vi');
    const out = {};
    // Booking: 17 pages of 12, the technician search finds "Nguyễn"… (accent-free)
    const bk = await live('/booking', mgr);
    if (bk) {
      const label = () => bk.page.getByTestId('tech-page-label').innerText().catch(() => '');
      await waitFor(async () => /Trang 1 \/ 17/.test(await label()), 30000, 200);
      out.bookingLabel = await label();
      const searchBox = bk.page.getByRole('searchbox', { name: 'Tìm thợ', exact: true }).first();   // the board's technician search (pos.find_technician)
      await searchBox.fill('tran'); await sleep(1500);
      out.bookingSearch = (await bodyText(bk.page)).includes('Trần Mỹ Linh');
      out.bookingText = VI_LETTER.test(await bodyText(bk.page));
      await bk.shot('vi-booking-200'); await bk.close();
    }
    // Tech Queue + Customer Queue (assign picker on the server) + Serving + Service Done
    for (const [k, path, expect] of [['techQueue', '/tech-queue', /Hàng chờ thợ/], ['queue', '/queue', /Hàng chờ khách/], ['serving', '/serving', /Đang phục vụ/], ['serviceDone', '/service-done', /Hoàn tất dịch vụ/]]) {
      const p = await live(path, mgr); if (!p) continue;
      // the whole page, not its first 300 characters: on the Customer Queue the sidebar alone is longer than that, so the
      // board was read while it still said "Đang tải hàng chờ…" (Nov 6 2026 full run — the API answered in ~0.1 s)
      await waitFor(async () => { const tx = await bodyText(p.page); return expect.test(tx) && !/Đang tải/.test(tx); }, 30000, 250);
      const tx = await bodyText(p.page);
      out[k] = { ok: expect.test(tx), viNames: (tx.match(/Nguyễn|Trần|Lê |Phạm|Hoàng|Huỳnh|Võ |Đặng|Bùi|Đỗ /g) ?? []).length, errors: p.pageErrors.slice(0, 2) };
      if (k === 'queue') {
        // the Manage drawer's assign picker: 200 technicians on the server, 12 a page
        const manage = p.page.locator('table tbody').getByRole('button', { name: 'Quản lý', exact: true }).first();   // the row's button, not the sidebar's "Quản lý" group
        if (await manage.count()) {
          await manage.click(); await sleep(500);
          // the Manage drawer's technician field opens the picker from its button ("Phân công / đổi thợ" is the field's label)
          const btn = p.page.getByTestId('technician-picker-button').first();
          await btn.click().catch(() => undefined);
          out.queue.pickerPages = await waitFor(async () => /Trang 1 \/ 1[5-9]/.test(await p.page.getByTestId('technician-picker').innerText().catch(() => '')), 10000, 200)
            ? (await p.page.getByTestId('technician-picker').innerText()).match(/Trang 1 \/ \d+/)?.[0] : null;
          out.queue.pickerText = (await p.page.getByTestId('technician-picker').innerText().catch(() => '')).split('\n').slice(-4).join(' ');
          await p.page.keyboard.press('Escape').catch(() => undefined);
        }
      }
      await p.shot(`vi-${k}-200`); await p.close();
    }
    // realtime Vietnamese text (§109 "realtime"): Customer Queue open in Vietnamese, the receptionist checks in a walk-in with a
    // Vietnamese name through the API — the row appears on the open screen without a reload, spelled exactly
    {
      const p = await live('/queue', mgr);
      if (p) {
        await waitFor(async () => /Hàng chờ khách/.test(await bodyText(p.page)), 30000, 250);
        const nav0 = await p.page.evaluate(() => performance.getEntriesByType('navigation').length);
        const rtName = `Lý Thu Thảo ${tag}`;
        // the queue is long (30+ waiting) — filter it to the name first, as a front desk would, so the row is on screen
        const box = p.page.getByRole('searchbox', { name: 'Tìm hàng chờ', exact: true }).first();
        await box.fill('ly thu thao'); await sleep(1200);
        const t0 = Date.now();
        const add = await recNow().post('/pos/queue/items', { customerName: rtName, serviceIds: floor.serviceId ? [floor.serviceId] : [], source: 'walk_in' });
        const seen = await waitFor(async () => (await bodyText(p.page)).includes(rtName), 20000, 100);
        out.realtime = { add: add.status, seen, ms: seen ? Date.now() - t0 : null, reloads: (await p.page.evaluate(() => performance.getEntriesByType('navigation').length)) - nav0, errors: p.pageErrors.slice(0, 2) };
        await p.shot('vi-queue-realtime'); await p.close();
      }
    }
    // Checkout: the UNKNOWN payment's banner, in the mandate's exact words
    if (floor.unknown?.ticketId) {
      const p = await live(`/checkout?ticket=${floor.unknown.ticketId}`, mgr);
      if (p) {
        const banner = p.page.getByTestId('payment-unknown-banner');
        await waitFor(async () => (await banner.count()) > 0, 30000, 200);
        out.checkout = { banner: (await banner.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() };
        await p.shot('vi-checkout-unknown-200'); await p.close();
      }
    }
    V.screens = out;
    check(`REALTIME VIETNAMESE TEXT (§109): a walk-in checked in as "Lý Thu Thảo" through the API appears on the open Vietnamese Customer Queue without a reload, spelled exactly${out.realtime?.ms != null ? ` (${out.realtime.ms} ms)` : ''}`,
      ok2(out.realtime?.add) && out.realtime?.seen === true && out.realtime?.reloads === 0 && !(out.realtime?.errors ?? []).length, short(out.realtime ?? null));
    check(`VIETNAMESE SCREENS AT 200 TECHNICIANS (§113, §70–§75, §35): Booking reads "${out.bookingLabel ?? '—'}" and its technician search "tran" finds "Trần Mỹ Linh"; Tech Queue, Customer Queue (the assign picker: ${out.queue?.pickerPages ?? '—'} on the server), Serving and Service Done render in Vietnamese with the guests' Vietnamese names; Checkout shows the UNKNOWN banner in the mandate's exact words`,
      /Trang 1 \/ 17/.test(out.bookingLabel ?? '') && out.bookingSearch && out.techQueue?.ok && out.queue?.ok && /Trang 1 \/ 1[5-9]/.test(out.queue?.pickerPages ?? '') && out.serving?.ok && out.serviceDone?.ok && (out.queue?.viNames ?? 0) > 0
        && (out.checkout?.banner ?? '').startsWith(UNKNOWN_VI) && !Object.values(out).some((x) => x?.errors?.length), short(out));
  });

  // ── 13e. the one-screen matrix on the busy floor ─────────────────────────────────────────────────────────────────
  await sec('13e one-screen busy', async () => {
    await ensureBrowser(); const port = await ensureApp('pos-web');
    const browser = await ensureBrowser();
    const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx2.addCookies([...env.mgr.jar.values()].map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: `http://127.0.0.1:${port}` }; }));
    if (fonts) await routeFonts(ctx2, fonts);
    const verdicts = await runOneScreenMatrix({ newPage: () => ctx2.newPage(), setLanguage: mgrLang, base: `http://127.0.0.1:${port}`, shots: `${shotsDir}one-screen/`, state: 'busy200', viewports: VIEWPORTS,
      allow: VI_NAMES.flatMap((n) => n.split(' ')) });
    // the matrix runs for minutes: the page may have refreshed the manager's session (rotating its refresh token) — hand the
    // cookies back, or the proof's next refresh replays a used token and the platform revokes the session (Nov 6 2026)
    for (const c of await ctx2.cookies().catch(() => [])) env.mgr.jar.set(c.name, `${c.name}=${c.value}`);
    await ctx2.close();
    const prim = verdicts.filter((v) => v.primary);
    V.oneScreen = { primary: prim.map((v) => ({ m: v.label, lang: v.lang, pass: v.pass, reasons: v.reasons, v: v.vScroll, h: v.hScroll, minBtn: v.minButton, font: v.font.hanken })), responsive: verdicts.filter((v) => !v.primary).map((v) => ({ m: v.label, lang: v.lang, w: v.w, h: v.h, pass: v.pass, reasons: v.reasons, v: v.vScroll })),
      passed: prim.filter((v) => v.pass).length, total: prim.length, responsivePassed: verdicts.filter((v) => !v.primary && v.pass).length, responsiveTotal: verdicts.filter((v) => !v.primary).length };
    check(`ONE SCREEN, BUSY, 200 TECHNICIANS (§66–§78, §111–§112): the 9 primary modules × English / Vietnamese on a 1920×1080 screen with the browser chrome and taskbar (a ${PRIMARY[0]}×${PRIMARY[1]} page) with Hanken Grotesk — no page or module scroll, no clipped, cut-off or overlapping controls, Vietnamese targets not smaller than English, every compact control with a 44 × 44 px hit area (or the largest its neighbours allow) and the layout unchanged by it — ${V.oneScreen.passed}/${V.oneScreen.total}; 2560×1440, full-screen 1920×1080, 1600×900, 1366×768, 1280×800 (no horizontal scroll, no clipping / cut-off / overlap, hit areas): ${V.oneScreen.responsivePassed}/${V.oneScreen.responsiveTotal}`,
      V.oneScreen.passed === V.oneScreen.total && V.oneScreen.total === 18, short(V.oneScreen.primary.filter((x) => !x.pass)));
    if (V.oneScreen.responsivePassed < V.oneScreen.responsiveTotal) info(`one-screen responsive report issues: ${short(V.oneScreen.responsive.filter((x) => !x.pass).slice(0, 6))}`);
  });

  // ── 13f. 20 switches on a live board; state + subscriptions + memory; Customer Queue; Checkout UNKNOWN ──────────────
  await sec('13f switching', async () => {
    await mgrLang('en');
    const INSTRUMENT = `(() => {
      const ES = window.EventSource; window.__esCount = 0; window.__esOpen = 0;
      if (ES) window.EventSource = class extends ES { constructor(...a) { super(...a); window.__esCount++; window.__esOpen++; this.addEventListener('error', () => {}); const c = this.close.bind(this); this.close = () => { if (!this.__closed) { this.__closed = true; window.__esOpen--; } c(); }; } };
      const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener; window.__ls = {};
      EventTarget.prototype.addEventListener = function (t, f, o) { if (this === window || this === document) window.__ls[t] = (window.__ls[t] || 0) + 1; return add.call(this, t, f, o); };
      EventTarget.prototype.removeEventListener = function (t, f, o) { if (this === window || this === document) window.__ls[t] = (window.__ls[t] || 0) - 1; return rem.call(this, t, f, o); };
    })();`;
    const p = await live('/booking', mgr, { init: [INSTRUMENT] });
    if (!p) return;
    const pg = p.page;
    const label = () => pg.getByTestId('tech-page-label').innerText().catch(() => '');
    await waitFor(async () => /Page 1 of 17/.test(await label()), 30000, 200);
    // the board state a front desk would have: a date, technician page 3, a service filter
    const nextBtn = pg.getByLabel('Technician pages').getByRole('button', { name: /Next 12/ }).first();
    await nextBtn.click(); await waitFor(async () => /Page 2 of/.test(await label()), 8000, 50);
    await nextBtn.click(); await waitFor(async () => /Page 3 of/.test(await label()), 8000, 50);
    const svcSelect = pg.getByLabel('Calendar service filter').first();
    let svcValue = null; if (await svcSelect.count()) { const opts = await svcSelect.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean)); svcValue = opts[0] ?? null; if (svcValue) await svcSelect.selectOption(svcValue); }
    await sleep(1500);
    const dateVal = await pg.locator('input[type="date"]').first().inputValue().catch(() => null);
    const cdp = await p.context.newCDPSession(pg); await cdp.send('Performance.enable');
    const metrics = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined); await sleep(300); const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])); return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners }; };
    const inst = () => pg.evaluate(() => ({ es: window.__esCount, open: window.__esOpen, ls: { ...window.__ls } }));
    const m0 = await metrics(); const i0 = await inst();
    const reqStart = p.requests.length;
    const switchTimes = [];
    const switchTo = async (l) => {
      const t0 = Date.now();
      // Nov 6 2026 full run: the switch was missing here — say where the page was and what it showed, with a screenshot
      if (!(await pg.getByTestId('language-switch').count())) { await p.shot('13f-no-language-switch'); throw new Error(`no language switch at ${pg.url()} :: ${(await bodyText(pg)).replace(/\s+/g, ' ').slice(0, 300)}`); }
      try { await pg.getByTestId('language-switch').click({ timeout: 10000 }); }
      catch (e) {
        await p.shot('13f-language-switch-not-clickable');
        const why = await pg.evaluate(() => { const b = document.querySelector('[data-testid="language-switch"]'); if (!b) return 'gone'; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const cs = getComputedStyle(b); return { box: [r.left, r.top, r.width, r.height].map(Math.round), vis: cs.visibility, disp: cs.display, onTop: top === b || b.contains(top) ? 'self' : (top ? top.tagName + '.' + String(top.className).slice(0, 60) : 'none'), url: location.pathname }; }).catch((x) => String(x).slice(0, 80));
        throw new Error(`language switch not clickable: ${JSON.stringify(why)} :: ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`);
      }
      await pg.getByTestId(`language-option-${l}`).click();
      await waitFor(async () => (await pg.evaluate(() => document.documentElement.lang)) === l && (l === 'vi' ? /Trang 3 \//.test(await label()) : /Page 3 of/.test(await label())), 5000, 10);
      await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      switchTimes.push(Date.now() - t0);
    };
    for (let i = 0; i < 10; i++) { await switchTo('vi'); await switchTo('en'); }
    await sleep(1500);
    const m1 = await metrics(); const i1 = await inst();
    const during = p.requests.slice(reqStart);
    const lang = during.filter((r) => r.url.includes('/pos/me/language')).length;
    const reads = during.filter((r) => /\/pos\/booking\/(state|day-grid|technicians)/.test(r.url)).length;
    const payCalls = during.filter((r) => /\/pay(\/|$)|\/verify/.test(r.url)).length;
    const stateAfter = { label: await label(), svc: svcValue ? await svcSelect.inputValue().catch(() => null) : null, date: await pg.locator('input[type="date"]').first().inputValue().catch(() => null) };
    V.switching = { switches: switchTimes.length, p50: pct(switchTimes, 50), p95: pct(switchTimes, 95), max: Math.max(...switchTimes), es: [i0.es, i1.es], esOpen: [i0.open, i1.open], listeners: { before: i0.ls, after: i1.ls }, heap: [m0.heapMB, m1.heapMB], nodes: [m0.nodes, m1.nodes], cdpListeners: [m0.listeners, m1.listeners],
      requests: { languagePuts: lang, boardReads: reads, payOrVerify: payCalls, total: during.length }, state: { before: { page: 3, svc: svcValue, date: dateVal }, after: stateAfter }, pageErrors: p.pageErrors.slice(0, 3) };
    const lsSame = ['aps:realtime-event', 'aps:realtime-reconcile', 'visibilitychange', 'online', 'offline'].every((k) => (i1.ls[k] ?? 0) === (i0.ls[k] ?? 0));
    check(`20 LANGUAGE SWITCHES ON A LIVE BOARD (§81, §106, §114–§116): EN⇄VI ×10 through the topbar switch on the Booking board (technician page 3, a service filter, a date): switch-to-paint p50 ${V.switching.p50} / p95 ${V.switching.p95} ms; ONE EventSource (${i0.es} → ${i1.es} created, ${i1.open} open), window / document listeners unchanged, JS heap ${m0.heapMB} → ${m1.heapMB} MB, DOM nodes ${m0.nodes} → ${m1.nodes}; page 3, the filter and the date kept; ${lang} language saves, 0 pay / verify calls`,
      switchTimes.length === 20 && i1.es === i0.es && i1.open === i0.open && i0.open <= 1 && lsSame && m1.heapMB <= m0.heapMB * 1.2 + 3 && m1.nodes <= m0.nodes * 1.15 + 300 && /Page 3 of 17/.test(stateAfter.label) && stateAfter.svc === svcValue && stateAfter.date === dateVal && payCalls === 0 && lang === 20 && V.switching.p95 < 1500 && !p.pageErrors.length,
      short(V.switching));
    await cdp.detach().catch(() => undefined); await p.close();

    // Customer Queue: an open Manage drawer (the selected visit) and the queue order survive switches
    const cq = await live('/queue', mgr);
    if (cq) {
      const rows = () => cq.page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => (tr.querySelector('td:nth-child(2)')?.textContent || '').trim()).filter(Boolean));
      await waitFor(async () => (await rows()).length > 5, 30000, 200);
      const before = await rows();
      await cq.page.locator('table tbody').getByRole('button', { name: 'Manage', exact: true }).first().click();   // the row's button ("Management" in the sidebar also matches a loose name)
      await cq.page.getByLabel('Cancel reason').fill('khách đổi ý').catch(() => undefined);
      const drawerOpen = async () => (await cq.page.getByRole('button', { name: /Cancel from Queue|Hủy khỏi hàng chờ/ }).count()) > 0;
      const reqs0 = cq.requests.length;
      // the Manage view is a MODAL (aria-modal; its backdrop covers the topbar, and a click outside closes it) — a person
      // cannot reach the switch while it is open. What §107 protects is the open visit and the half-typed reason when the
      // language changes under them, so the clicks are delivered to the switch itself, not through the backdrop (Nov 6 2026)
      for (const l of ['vi', 'en', 'vi', 'en']) { await cq.page.getByTestId('language-switch').dispatchEvent('click'); await cq.page.getByTestId(`language-option-${l}`).dispatchEvent('click'); await sleep(400); }
      const after = await rows();
      const reasonKept = await cq.page.getByLabel(/Cancel reason|Lý do hủy/).inputValue().catch(() => null);
      V.queueSwitch = { open: await drawerOpen(), sameOrder: JSON.stringify(after.slice(0, 10)) === JSON.stringify(before.slice(0, 10)), reasonKept, requests: cq.requests.slice(reqs0).filter((r) => !r.url.includes('/pos/me/language')).map((r) => r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]).slice(0, 8) };
      check('CUSTOMER QUEUE ACROSS SWITCHES (§107): the open Manage drawer (the selected visit) with a half-typed reason, and the queue order, survive EN⇄VI ×2', V.queueSwitch.open && V.queueSwitch.sameOrder && V.queueSwitch.reasonKept === 'khách đổi ý', short(V.queueSwitch));
      await cq.close();
    }

    // Checkout: the UNKNOWN banner flips language, tender stays blocked, Verify stays available, nothing is charged
    if (floor.unknown?.ticketId) {
      const co = await live(`/checkout?ticket=${floor.unknown.ticketId}`, mgr);
      if (co) {
        const banner = co.page.getByTestId('payment-unknown-banner');
        await waitFor(async () => (await banner.count()) > 0, 30000, 200);
        const reqs0 = co.requests.length;
        const seen = [];
        for (const l of ['vi', 'en', 'vi', 'en']) {
          await co.page.getByTestId('language-switch').click(); await co.page.getByTestId(`language-option-${l}`).click();
          await waitFor(async () => (await co.page.evaluate(() => document.documentElement.lang)) === l, 5000, 20);
          await sleep(200);
          seen.push({ l, banner: (await banner.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), complete: await co.page.getByRole('button', { name: /Complete Checkout|Hoàn tất thanh toán/ }).first().isDisabled().catch(() => null), verify: await co.page.getByRole('button', { name: /Verify Payment|Xác minh thanh toán|Kiểm tra thanh toán/ }).first().isEnabled().catch(() => null) });
        }
        const calls = co.requests.slice(reqs0).filter((r) => /\/pay(\/|$)|\/verify/.test(r.url) && r.method !== 'GET').length;
        const payRows = (await q(`select status from payments where ticket_id = $1 order by created_at`, [floor.unknown.ticketId])).map((r) => r.status);
        V.checkoutSwitch = { seen, payOrVerifyCalls: calls, payRows, url: co.page.url().replace(/^https?:\/\/[^/]+/, '') };
        check(`UNKNOWN PAYMENT ACROSS SWITCHES (§35, §105, §108): the banner reads "${UNKNOWN_VI}" in Vietnamese and "${UNKNOWN_EN}" in English, switch after switch; the same ticket stays selected (?ticket=), Complete Checkout stays blocked, Verify Payment stays available; 0 pay / verify requests and the one payment still "processing"`,
          seen.every((x) => x.banner.startsWith(x.l === 'vi' ? UNKNOWN_VI : UNKNOWN_EN) && x.verify !== false && x.complete !== false) && calls === 0 && JSON.stringify(payRows) === JSON.stringify(['processing']) && V.checkoutSwitch.url.includes(floor.unknown.ticketId),
          short(V.checkoutSwitch));
        await co.close();
      }
    }
  });

  // ── 13g. a platform announcement with a reviewed Vietnamese version ────────────────────────────────────────────────
  await sec('13g announcement vi', async () => {
    const EN = `Card payments pause 11:00–11:15 PM tonight (${tag}).`, VI = `Thanh toán thẻ tạm dừng 23:00–23:15 tối nay (${tag}).`;
    // the Super Admin who started the day has been idle for most of it — the console has signed her out (idle timeout); sign in again
    let relogin = null;
    if (env.saRelogin && (await sa.get('/super-admin/communications/platform-announcements')).status === 401) relogin = await env.saRelogin();
    const cr = await sa.post('/super-admin/communications/platform-announcements', { title: `Maintenance ${tag}`, message: EN, titleVi: `Bảo trì ${tag}`, messageVi: VI, viReviewed: true, type: 'maintenance', priority: 'high', audience: 'selected_tenants', tenantIds: [T], dismissible: true,
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
    const su = saStepUp ? await saStepUp() : 0;   // publish / archive need a fresh Super Admin step-up (§137)
    // phase 10's English-only maintenance notice for this salon is still live — archive it so the bar shows this one
    for (const o of await q(`select id, version from platform_notices where title like $1 and lifecycle_status in ('published','scheduled','paused') and id <> $2::uuid`, [`%${tag}%`, cr.body?.id ?? '00000000-0000-0000-0000-000000000000']).catch(() => [])) {
      await sa.post(`/super-admin/communications/platform-announcements/${o.id}/archive`, { expectedVersion: Number(o.version) }).catch(() => undefined);
    }
    const pb = await sa.post(`/super-admin/communications/platform-announcements/${cr.body?.id}/publish`, { expectedVersion: cr.body?.version, confirm: true, publishNow: true });
    await mgrLang('vi');
    const snap = await mgr.get('/pos/platform-announcements/active');
    const item = (snap.body?.announcements ?? snap.body?.items ?? []).find?.((x) => x.id === cr.body?.id);
    // wait for the text in the user's language: the POS paints English first and applies the user's language when
    // GET /pos/me/locale answers, so "contains the tag" alone would read the bar before the switch
    const bar = async (sess, want) => { const p = await live('/overview', sess); if (!p) return null; await waitFor(async () => (await p.page.locator('[data-testid="platform-announcement-text"]').first().innerText().catch(() => '')).includes(want), 20000, 200); const t = await p.page.locator('[data-testid="platform-announcement-text"]').first().innerText().catch(() => ''); await p.shot(`announcement-${sess === env.mgr ? 'vi' : 'en'}`); await p.close(); return t; };
    const viBar = await bar(env.mgr, VI), enBar = await bar(env.rec, EN);
    V.announcement = { relogin, create: cr.status, stepUp: su, publish: pb.status, publishError: pb.status >= 300 ? pb.body : undefined, snapshotHasVi: item?.messageVi === VI, viBar, enBar };
    check('ANNOUNCEMENT EN / VI (§56–§57): a maintenance notice with a REVIEWED Vietnamese version, published to this salon: the Vietnamese manager\'s POS bar shows the Vietnamese text, the English receptionist\'s the English one (one snapshot carries both)',
      ok2(cr.status) && ok2(pb.status) && V.announcement.snapshotHasVi && (viBar ?? '').includes(VI) && (enBar ?? '').includes(EN), short(V.announcement));
    if (cr.body?.id) { const cur = (await q(`select version from platform_notices where id = $1`, [cr.body.id]))[0]; await sa.post(`/super-admin/communications/platform-announcements/${cr.body.id}/archive`, { expectedVersion: Number(cur?.version) }).catch(() => undefined); }
  });

  // ── 13h. receipts in the CUSTOMER's language ──────────────────────────────────────────────────────────────────────
  await sec('13h receipt language', async () => {
    const R = pacedSession(env.mgr, run, sleep);   // the Vietnamese manager is the cashier
    await mgrLang('vi');
    const freeTech = (await q(`select t.id, (select ts.service_id from technician_services ts where ts.technician_id = t.id limit 1) as s from technicians t join technician_workforce_state w on w.technician_id = t.id
                                where t.tenant_id = $1 and t.branch_id = $2 and w.clock_status = 'CLOCKED_IN' and not exists (select 1 from pos_queue_items qi where qi.assigned_technician_id = t.id and qi.status in ('assigned','in_service','called'))
                                order by t.full_name limit 2`, [T, B]));
    const serveAndPay = async (customerId, name, phone, t, i) => {
      const qi = await R.post('/pos/queue/items', { customerId, customerName: name, customerPhone: phone, serviceIds: [t.s], source: 'walk_in', requestedTechnicianId: t.id });
      const G = qi.body?.queueItemId ?? qi.body?.id;
      await R.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: t.id, source: 'staff', reason: 'The guest asked for her' });
      const st = await R.post(`/pos/queue/items/${G}/start-service`, {}); const TK = st.body?.servingTicketId;
      await R.post(`/pos/serving/tickets/${TK}/mark-service-done`, {}); await R.post(`/pos/serving/tickets/${TK}/send-to-service-done`, {});
      const det = await R.get(`/pos/checkout/tickets/${TK}`); const due = det.body?.totals?.totalDueCents ?? det.body?.totalDueCents;
      const pay = await R.post(`/pos/checkout/tickets/${TK}/pay/cash`, { amountReceivedCents: due }, { 'idempotency-key': `pilot-vi-rcpt-${tag}-${i}` });
      const rc = await R.post(`/pos/checkout/tickets/${TK}/receipt/sms`, {});
      const body = (await q(`select body from notifications where tenant_id = $1 and channel = 'sms' and to_address like $2 order by created_at desc limit 1`, [T, `%${phone.slice(-7)}`]))[0]?.body ?? null;
      return { TK, pay: pay.status, receipt: rc.status, delivery: rc.body?.delivery ?? rc.body?.configured, body };
    };
    const huongPhone = (await q(`select coalesce(phone_display, normalized_phone) as phone from customers where id = $1`, [huong]))[0]?.phone;
    const enPhone = `+1609548${String(Number(tag) % 10000).padStart(4, '0')}`;
    const enC = await own.post('/pos/customers', { firstName: 'Emily', lastName: `English ${tag}`, phone: enPhone });
    const enId = enC.body?.customerId ?? enC.body?.id ?? enC.body?.customer?.id;
    if (enId) await own.patch(`/pos/customers/${enId}`, { preferredLanguage: 'en' });
    const a = huong && freeTech[0] ? await serveAndPay(huong, 'Nguyễn Thị Hương', huongPhone, freeTech[0], 1) : null;
    const b = enId && freeTech[1] ? await serveAndPay(enId, `Emily English ${tag}`, enPhone, freeTech[1], 2) : null;
    V.receipts = { vi: a && { ...a, body: (a.body ?? '').slice(0, 120) }, en: b && { ...b, body: (b.body ?? '').slice(0, 120) } };
    // POSLanguage.pdf §17 / §18 (Oct 28 2026): customer receipts are ENGLISH for every customer, whatever the cashier's
    // POS language — the guest's own Vietnamese name may appear (business data); the system wording may not
    const sysText = (x) => (x?.body ?? '').replace(/Nguyễn Thị Hương|Hương/g, '');
    check('RECEIPT IN ENGLISH (POSLanguage.pdf §17–§18): the Vietnamese-speaking cashier sends SMS receipts — "Nguyễn Thị Hương" (language vi) and an English customer BOTH get the English receipt',
      ok2(a?.pay) && ok2(a?.receipt) && !!a?.body && !VI_LETTER.test(sysText(a)) && ok2(b?.pay) && ok2(b?.receipt) && !!b?.body && !VI_LETTER.test(b?.body ?? ''), short(V.receipts));
  });

  // ── 13i. Super Admin stays English ────────────────────────────────────────────────────────────────────────────────
  await sec('13i super admin english', async () => {
    if (!adminPort) { info('NOT_TESTED 13i: admin-web/dist missing'); return; }
    const out = [];
    for (const path of ['/dashboard', '/tenants', '/communications/platform-announcements']) {
      const p = await openLive('admin-web', path, sa, { viewport: { width: 1920, height: 1080 } });
      if (!p) { out.push({ path, missing: true }); continue; }
      await waitFor(async () => ((await p.page.locator('body').innerText().catch(() => '')).length > 200), 20000, 250);
      await sleep(1500);
      const text = await p.page.locator('body').innerText().catch(() => '');
      const lang = await p.page.evaluate(() => document.documentElement.lang);
      // allowed: the language NAME "Tiếng Việt", and the Vietnamese announcement text a Super Admin authored (13g)
      // also allowed: salon DATA a Super Admin legitimately sees (the guests' and technicians' own names) — the check is
      // about the console's own words, which must stay English
      const dataWords = new Set([...VI_NAMES, 'Trần Mỹ Linh', 'Đặng Minh Tuấn'].flatMap((n) => n.split(' ')));
      const viWords = (text.replace(/Tiếng Việt/g, '').replace(/Bảo trì \d+|Thanh toán thẻ tạm dừng[^\n]*/g, '').match(new RegExp(`\\S*${VI_LETTER.source}\\S*`, 'gi')) ?? [])
        .filter((w) => !dataWords.has(w.replace(/[^\p{L}]/gu, ''))).slice(0, 6);
      out.push({ path, lang, viWords, len: text.length, errors: p.pageErrors.slice(0, 2) });
      await p.shot(`super-admin-english${path.replace(/\//g, '-')}`); await p.close();
    }
    V.superAdmin = out;
    check('SUPER ADMIN STAYS ENGLISH (§3, §4, §103): with this salon\'s POS default Vietnamese, the Super Admin console (Dashboard, Tenants, Platform Announcements) renders <html lang="en"> with no Vietnamese words except the language name, the reviewed announcement text and the salon\'s own data (guest / technician names)',
      out.length === 3 && out.every((x) => !x.missing && x.lang === 'en' && x.viWords.length === 0 && x.len > 200), short(out));
  });
  // leave the salon as the earlier phases found it: English default, the manager without a choice of her own is not
  // restorable through the API (a choice is a choice) — she keeps English
  await own.patch('/pos/settings/business-branch', { defaultLanguage: 'en' }).catch(() => undefined);
  await mgr.put('/pos/me/language', { language: 'en' }).catch(() => undefined);
}
