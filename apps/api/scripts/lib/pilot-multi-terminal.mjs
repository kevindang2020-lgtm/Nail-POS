// pilot-multi-terminal.mjs — pilot day phase 15 (Nov 6 2026; Kevin: "testing several terminals at once — pick best").
// Several front-desk terminals on ONE location at the same time, over the real API, the real PostgreSQL and the real built
// POS in Chromium (two separate browser contexts = two iPads):
//   15a LIVE: terminal A (receptionist) and terminal B (manager) both have the POS Queue open; a walk-in checked in at A
//       appears on B's screen by itself (realtime) — no reload, no navigation on B.
//   15b ASSIGN RACE: both terminals assign the same waiting guest at the same moment, each to a different technician, from
//       the same version → exactly one wins, the other is told it changed (409); the guest has ONE technician.
//   15c PAY RACE: both terminals take cash on the same ticket at the same moment (different idempotency keys, as two
//       separate taps) → ONE payment row, the ticket paid once, the other terminal refused.
//   15d SAME TAP TWICE: one terminal's retried request (same idempotency key) records nothing new.
//   15e B's Queue page made no full reload during the whole phase and threw no page errors.
// A real 27-inch touchscreen and physical iPads are not here (Kevin's side); this proves the server and the app under two
// simultaneous terminals. PILOT_SKIP=15 skips the phase.

export async function multiTerminalPhase(env) {
  const { rec, mgr, check, info, q, ctx, tag, ok2, short, openLive, SCREENS, sleep, serve, LISA, MARY, numbers } = env;
  const M = numbers.multiTerminal = {};
  const phone = () => `+1609556${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;

  // ── 15a two terminals, one queue, live ─────────────────────────────────────────────────────────────────────
  let A = null, B = null, bLoads = 0;
  if (SCREENS) {
    A = await openLive('pos-web', '/queue', rec, { viewport: { width: 1920, height: 1080 } });
    B = await openLive('pos-web', '/queue', mgr, { viewport: { width: 1920, height: 1080 } });
    if (B) B.page.on('load', () => { bLoads++; });
    await sleep(3000);   // both screens loaded and subscribed
  }
  const name = `Tara Terminal ${tag.slice(-4)}`;
  const t0 = Date.now();
  const w = await rec.post('/pos/queue/items', { customerName: name, customerPhone: phone(), serviceIds: [ctx.services.gel], source: 'walk_in' });
  const G = w.body?.queueItemId ?? w.body?.id;
  let seenOnB = null, seenOnA = null;
  if (A && B) {
    for (let i = 0; i < 60 && (seenOnB == null || seenOnA == null); i++) {
      const [tb, ta] = await Promise.all([B.page.locator('body').innerText().catch(() => ''), A.page.locator('body').innerText().catch(() => '')]);
      if (seenOnB == null && tb.includes(name)) seenOnB = Date.now() - t0;
      if (seenOnA == null && ta.includes(name)) seenOnA = Date.now() - t0;
      await sleep(250);
    }
    M.walkInSeenOnOtherTerminalMs = seenOnB;
    check(`MULTI-TERMINAL LIVE: a walk-in checked in at terminal A appears on terminal B's open Queue by itself (${seenOnB ?? '—'} ms; A ${seenOnA ?? '—'} ms) — no reload on B`,
      ok2(w.status) && seenOnB != null && seenOnB < 15_000 && bLoads === 0, `create ${w.status} ${short(w.status >= 300 ? w.body : null)} B ${seenOnB} A ${seenOnA} B reloads ${bLoads}`);
  } else info('15a skipped: no screens (PILOT_SCREENS off or pos-web not built)');

  // ── 15b the same guest assigned from two terminals at once ─────────────────────────────────────────────────
  // each terminal sends its own idempotency key (two separate taps) — the version check, not the key, decides the race
  const plan = (sess, tech, k) => sess.post('/pos/queue/plans/assign', { items: [{ queueItemId: G, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: ctx.services.gel, technicianId: tech, expectedTechnicianId: null }] }], idempotencyKey: `mt-assign-${k}-${tag}`, source: 'staff' });
  const [ra, rb] = await Promise.all([plan(rec, LISA, 'a'), plan(mgr, MARY, 'b')]);
  const winners = [ra, rb].filter((r) => ok2(r.status));
  const loser = [ra, rb].find((r) => !ok2(r.status));
  const assigned = (await q(`select assigned_technician_id as t from pos_queue_items where id = $1`, [G]))[0]?.t ?? null;
  M.assignRace = { a: ra.status, b: rb.status, assigned };
  check('MULTI-TERMINAL ASSIGN RACE: two terminals assign the same guest at the same moment → exactly one wins, the other is told it changed (409); the guest has one technician',
    winners.length === 1 && loser?.status === 409 && [LISA, MARY].includes(assigned) && assigned === (ra === winners[0] ? LISA : MARY),
    `A ${ra.status} ${short(ra.status >= 300 ? ra.body : null)} B ${rb.status} ${short(rb.status >= 300 ? rb.body : null)} assigned ${assigned}`);

  // ── 15c / 15d the same ticket paid from two terminals at once ──────────────────────────────────────────────
  const s = await serve(G);
  const T = s.ticketId;
  const det = T ? await rec.get(`/pos/checkout/tickets/${T}`) : null;
  const due = Number(det?.body?.totals?.totalDueCents ?? det?.body?.totalDueCents ?? det?.body?.totals?.totalCents ?? 0);
  const cash = Math.max(due, 1) + 2000;
  const [pa, pb] = T ? await Promise.all([
    rec.post(`/pos/checkout/tickets/${T}/pay/cash`, { amountReceivedCents: cash }, { 'idempotency-key': `mt-a-${tag}` }),
    mgr.post(`/pos/checkout/tickets/${T}/pay/cash`, { amountReceivedCents: cash }, { 'idempotency-key': `mt-b-${tag}` }),
  ]) : [{ status: 0 }, { status: 0 }];
  const pays = T ? await q(`select method, amount_cents::int as amt, status from payments where ticket_id = $1 and status in ('approved','partial','captured','completed','succeeded')`, [T]) : [];
  const tk = T ? (await q(`select status, payment_status from tickets where id = $1`, [T]))[0] ?? {} : {};
  M.payRace = { a: pa.status, b: pb.status, payments: pays.length, ticket: tk };
  check('MULTI-TERMINAL PAY RACE: two terminals take cash on the same ticket at the same moment → ONE payment, the ticket paid once, the other terminal refused',
    !!T && [pa, pb].filter((r) => ok2(r.status)).length === 1 && [pa, pb].some((r) => r.status >= 400) && pays.length === 1,
    `serve ${short(s.steps)} ticket ${T} due ${due} A ${pa.status} ${short(pa.status >= 300 ? pa.body : null)} B ${pb.status} ${short(pb.status >= 300 ? pb.body : null)} payments ${short(pays)} ticket ${short(tk)}`);
  const winner = ok2(pa.status) ? { sess: rec, key: `mt-a-${tag}` } : { sess: mgr, key: `mt-b-${tag}` };
  const again = T ? await winner.sess.post(`/pos/checkout/tickets/${T}/pay/cash`, { amountReceivedCents: cash }, { 'idempotency-key': winner.key }) : { status: 0 };
  const pays2 = T ? Number((await q(`select count(*)::int as n from payments where ticket_id = $1`, [T]))[0]?.n ?? 0) : -1;
  check('MULTI-TERMINAL SAME TAP TWICE: the winning terminal\'s retried request (same idempotency key) records nothing new',
    pays2 === pays.length && (ok2(again.status) || again.status === 409), `retry ${again.status} ${short(again.status >= 300 ? again.body : null)} payments ${pays2}`);

  // ── 15e the second terminal stayed on one page load, without page errors ───────────────────────────────────
  if (A && B) {
    await sleep(1500);
    check('MULTI-TERMINAL: terminal B never reloaded during the phase and neither terminal threw a page error',
      bLoads === 0 && !A.pageErrors.length && !B.pageErrors.length, `B reloads ${bLoads} A errors ${short(A.pageErrors)} B errors ${short(B.pageErrors)}`);
    await A.close(); await B.close();
  }
}
