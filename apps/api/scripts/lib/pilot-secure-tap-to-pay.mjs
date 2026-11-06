// pilot-secure-tap-to-pay.mjs — PHASE 12 of live-pilot-day.mjs: Secure Tap to Pay milestone M6-5 (Oct 23 2026).
//
// The first FULL HTTP round trip of payment-device signing: three payment phones, each with its own ECDSA P-256 key made
// with node:crypto (the private key never leaves this process; only the SPKI DER public key, base64, is registered),
// sign every /mobile-checkout request exactly as packages/mobile-sdk/src/device-proof.ts does:
//   AIPS-DEVICE-V1 \n METHOD \n PATH?QUERY (without /api/v1) \n DEVICE-ID \n TS-MS \n NONCE \n sha256-hex(exact body sent)
// with x-aps-device-{id,ts,nonce,sig} (sig = base64url of the 64-byte IEEE-P1363 r||s). Against the real API + PostgreSQL:
//   S1  the owner creates pairing codes on the POS (step-up): one SHARED (front desk phone), one PERSONAL (manager phone);
//       a third phone (mobile checkout) registers normally and the owner approves it (step-up)
//   S2  each phone registers its public key (pairing for two) → active; branches set through POST devices/:id/branches
//   S3  three phones, three tickets, AT THE SAME TIME: lock → proceed → intent → readiness → session → capture; amounts
//       are the server's (a client amount is ignored / refused), each payment attributed to the signed-in user + device
//   S4  the same ticket from two phones at once → exactly one claim, the other CHECKOUT_ALREADY_CLAIMED
//   S5  shift change on the SHARED phone (A out, B in → B's payment is B's); another user on the PERSONAL phone is refused
//   S6  tampering: altered body, replayed nonce, stale timestamp, unsigned request, a copied public key
//   S7  revoke one phone mid-day: DEVICE_REVOKED on every route, its sessions + refresh tokens revoked in the DB, the
//       other two phones keep working
//   S8  an unknown capture result → "verifying" (never declined) → reconcile → no double charge
//   S9  the POS sees the mobile payments (outbox + the canonical ticket) and the owner's history lists each one with the
//       device label and the employee
// Oct 26 2026 — the internal gaps of the Secure Tap audit (docs/mandates/status/SECURE_TAP_STATUS.md):
//   S10 §64 POS vs phone, both directions: a POS card whose answer is unknown blocks the phone's proceed / intent / cash;
//       a phone attempt left unknown (S8) blocks the POS cash and card — PAYMENT_STATUS_UNKNOWN, nothing charged
//   S11 §67 refund trio over HTTP: a receptionist is denied; a manager with a stale step-up gets STEP_UP_REQUIRED; after
//       POST /auth/step-up the same request is refused TAP_TO_PAY_REFUND_AT_PROCESSOR (Oct 28: never the branch gateway)
//   S12 §77 the Customer Display follows a mobile payment (the display's own credential reads the paid projection)
//   S13 §75 one payment's audit trace by its session: login → claim → intent → session mint → completed → receipt, in order
//   S14 §68 / §10 / §77 store switch on a shared phone: unauthorized location refused; authorized needs a fresh step-up; a
//       location whose merchant is disabled is refused MERCHANT_NOT_CONFIGURED; then the payment, its merchant account and
//       the owner's report all move to the new location
// Every check name starts with its step ("S3 …") so the report can count PASS / FAIL per step.
import { generateKeyPairSync, sign as cryptoSign, createHash, randomBytes } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256Hex = (s) => createHash('sha256').update(s ?? '').digest('hex');
/** the path the server's guard sees (packages/mobile-sdk signedPathFor): pathname + query, minus the /api/v1 alias */
const signedPathFor = (p) => (p.startsWith('/api/v1/') ? p.slice('/api/v1'.length) : p);

export async function secureTapToPayPhase(env) {
  const { own, mgr, sa, session, check: rawCheck, info, q, numbers, ctx, B, T, tag, STAFF_PW, OWNER_PW, short, ok2, API, SALON_CODE, serve, LISA, MARY, ANNA, rec, chCalls, chControl, sleep, CP_TOKENS, CARD, cpCalls, CP_HOST, TZ, saStepUp } = env;
  const out = numbers.secureTtp = { steps: {}, phones: {}, payments: [], refusals: {} };
  const check = (step, name, ok, detail = '') => { (out.steps[step] ??= { pass: 0, fail: 0 }); ok ? out.steps[step].pass++ : out.steps[step].fail++; return rawCheck(`${step} ${name}`, ok, detail); };
  const code = (r) => r?.body?.code ?? r?.body?.error ?? null;
  const ownerStepUp = async () => (await own.post('/auth/step-up', { password: OWNER_PW })).status;
  // the owner on a SECOND POS sign-in with no recent step-up — proves each trust decision needs a FRESH step-up
  const ownStale = session('owner-pos-2');
  await ownStale.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier: env.OWNER_EMAIL, password: OWNER_PW });
  await ownStale.post('/auth/select-branch', { branchId: B });

  // ── a payment phone: its key pair, its device id, a signed-in session (cookie jar), a signer ──────────────────────
  /** `identity` = another session on the SAME physical phone (same device id + key pair) */
  const makePhone = (key, label, viaApiV1 = false, identity = null) => {
    const kp = identity ? null : generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateKey = identity?.privateKey ?? kp.privateKey;
    const spki = identity?.spki ?? kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const id = identity?.id ?? `aps-${key}-${tag}-${randomBytes(6).toString('hex')}`;
    const ph = { key, label, id, spki, privateKey, viaApiV1, s: null, user: null, refreshToken: null };
    const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; ph.s.jar.set(kv.split('=')[0], kv); } };
    /** One request. opts.sign=false sends no proof; opts.signBody = the body string signed (default: the one sent);
     *  opts.ts / opts.nonce / opts.headers override (tamper probes); opts.privateKey signs with another key. */
    ph.req = async (method, path, body, opts = {}) => {
      const url = (ph.viaApiV1 ? '/api/v1' : '') + path;
      const raw = body === undefined ? '' : JSON.stringify(body);
      const headers = { 'content-type': 'application/json', cookie: [...ph.s.jar.values()].join('; ') };
      let proof = null;
      if (opts.sign !== false) {
        const ts = String(opts.ts ?? Date.now()); const nonce = opts.nonce ?? b64url(randomBytes(32));
        const signed = ['AIPS-DEVICE-V1', method.toUpperCase(), signedPathFor(url), opts.deviceId ?? ph.id, ts, nonce, sha256Hex(opts.signBody ?? raw)].join('\n');
        const sig = b64url(cryptoSign('sha256', Buffer.from(signed, 'utf8'), { key: opts.privateKey ?? ph.privateKey, dsaEncoding: 'ieee-p1363' }));
        proof = { 'x-aps-device-id': opts.deviceId ?? ph.id, 'x-aps-device-ts': ts, 'x-aps-device-nonce': nonce, 'x-aps-device-sig': sig };
        Object.assign(headers, proof);
      }
      Object.assign(headers, opts.headers ?? {});
      const r = await fetch(API + url, { method, headers, body: body === undefined ? undefined : (opts.sendRaw ?? raw) });
      keep(r);
      const t = await r.text(); let parsed; try { parsed = JSON.parse(t); } catch { parsed = t; }
      return { status: r.status, body: parsed, proof };
    };
    ph.get = (p, o) => ph.req('GET', p, undefined, o);
    ph.post = (p, b, o) => ph.req('POST', p, b ?? {}, o);
    /** sign in ON THIS PHONE (the session carries the payment device id), open the branch */
    ph.signIn = async (who) => {
      ph.s = session(`${key}:${who.name}`); ph.user = who;
      const l = await ph.s.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier: who.email, password: who.password, device: { id: ph.id, name: label, platform: 'ios' } });
      ph.refreshToken = l.body?.refreshToken ?? null;
      const sel = ok2(l.status) ? await ph.s.post('/auth/select-branch', { branchId: B, deviceId: ph.id }) : null;
      return { ok: ok2(l.status) && ok2(sel?.status), l: l.status, sel: sel?.status, lb: ok2(l.status) ? null : l.body };
    };
    if (!identity) out.phones[key] = { id, label };
    return ph;
  };

  // ── staff: Max (manager, already on staff) + two more managers the owner invites (Bea, Cal) ─────────────────────
  const staff = { max: { name: 'Max Floor', email: `mgr.${tag}@pilot-day.test`, password: STAFF_PW } };
  for (const [k, name] of [['bea', 'Bea Shift'], ['cal', 'Cal Runner']]) {
    const em = `${k}.${tag}@pilot-day.test`;
    await ownerStepUp();
    const inv = await own.post('/pos/access/invitations', { email: em, fullName: name, role: 'MANAGER', branchId: B, channel: 'email' });
    const acc = inv.body?.manualAcceptToken ? await session('pub').post('/public/website/invitations/accept', { token: inv.body.manualAcceptToken, password: STAFF_PW, fullName: name }) : { status: 0 };
    staff[k] = { name, email: em, password: STAFF_PW, ok: ok2(inv.status) && ok2(acc.status) };
    if (!staff[k].ok) info(`invite ${name}: ${inv.status} ${short(inv.body)} accept ${acc.status}`);
  }
  const ids = Object.fromEntries((await q(`select email, id from users where tenant_id = $1 and email = any($2)`, [T, Object.values(staff).map((s) => s.email)])).map((r) => [r.email, r.id]));
  for (const s of Object.values(staff)) s.id = ids[s.email];
  info(`managers for the three phones: Max ${!!staff.max.id}, Bea ${!!staff.bea.id}, Cal ${!!staff.cal.id}`);

  // ── tickets ready for checkout: a walk-in → a technician → accept / start / Service Done in the Tech App ───────────
  const techs = [LISA, MARY, ANNA];
  const ticketFor = async (name, i) => {
    const r = await rec.post('/pos/queue/items', { customerName: name, customerPhone: `+1609556${String((Number(tag) + i * 37) % 10000).padStart(4, '0')}`, serviceIds: [ctx.services.gel], source: 'walk_in' });
    const G = r.body?.queueItemId ?? r.body?.id;
    const a = G ? await rec.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: techs[i % 3], reason: 'Pilot M6-5: spread the checkouts over the three technicians' }) : { status: 0 };
    const s = G ? await serve(G) : { ok: false };
    if (!s.ticketId) info(`ticket for ${name}: queue ${r.status} ${short(r.status >= 300 ? r.body : null)} assign ${a.status} ${short(a.status >= 300 ? a.body : null)} serve ${short(s)}`);
    return s.ticketId ?? null;
  };
  const guests = ['Fay Front', 'Meg Manager', 'Cara Checkout', 'Rita Race', 'Bea Guest', 'Una Pending', 'Dora Dropped', 'Paula PosUnknown', 'Andy Annex'];
  const tk = [];
  for (let i = 0; i < guests.length; i++) tk.push(await ticketFor(guests[i], i));
  const [T1, T2, T3, T4, T5, T6, T7, T8, T9] = tk;
  check('S0', `${tk.length} gel tickets reach Service Done through the queue + Tech App (the checkouts the phones will take)`, tk.every(Boolean), short(tk));

  // ══ S1 pairing codes + a normal registration ══════════════════════════════════════════════════════════════════════
  const F = makePhone('front', 'Front Desk iPhone', true);    // signs /api/v1/... URLs (the SDK's signedPathFor strip)
  const M = makePhone('manager', "Bea's iPhone");
  const C = makePhone('checkout', 'Checkout iPhone 3');
  const pairNoStepUp = await ownStale.post('/mobile-checkout/devices/pairings', { label: 'Front Desk iPhone', shared: true });
  // a fresh step-up for each trust decision (the owner confirms her password)
  await ownerStepUp();
  const pShared = await own.post('/mobile-checkout/devices/pairings', { label: 'Front Desk iPhone', shared: true });
  const pPersonal = await own.post('/mobile-checkout/devices/pairings', { label: "Bea's iPhone", shared: false });
  const pairRows = await q(`select shared, branch_id, purpose, length(code_hash) as hl, used_at, expires_at - created_at as ttl from payment_device_pairings where tenant_id = $1 order by created_at`, [T]);
  const anyCodeInDb = (await q(`select count(*)::int as n from payment_device_pairings where tenant_id = $1 and (code_hash = $2 or code_hash = $3)`, [T, String(pShared.body?.pairingCode), String(pPersonal.body?.pairingCode)]))[0]?.n;
  check('S1', 'the POS pairing code needs a fresh owner step-up (403 STEP_UP_REQUIRED without); with it the owner creates a SHARED code (front desk) and a PERSONAL code (manager) — single-use, 5 minutes, this branch, only the sha256 stored',
    pairNoStepUp.status === 403 && code(pairNoStepUp) === 'STEP_UP_REQUIRED' && ok2(pShared.status) && pShared.body?.shared === true && ok2(pPersonal.status) && pPersonal.body?.shared === false
      && /^aipowersalon-pay:\/\/pair\?code=/.test(pShared.body?.qrPayload ?? '') && pShared.body?.branchId === B && pairRows.length === 2 && pairRows.every((r) => r.hl === 64 && r.branch_id === B && r.purpose === 'tap_to_pay_device') && anyCodeInDb === 0,
    `no-step-up ${pairNoStepUp.status} ${code(pairNoStepUp)} shared ${pShared.status} ${short({ ...pShared.body, pairingCode: '<code>', qrPayload: '<qr>' })} personal ${pPersonal.status} rows ${short(pairRows)} plain-in-db ${anyCodeInDb}`);

  // ══ S2 each phone registers its public key ════════════════════════════════════════════════════════════════════════
  const sF = await F.signIn(staff.max), sM = await M.signIn(staff.bea), sC = await C.signIn(staff.cal);
  check('S2', 'three managers sign in ON their phones (the session carries the payment device id) and open the branch', sF.ok && sM.ok && sC.ok, short({ sF, sM, sC }));
  const regBody = (ph, extra = {}) => ({ deviceId: ph.id, label: ph.label, platform: 'ios', osVersion: '18.1', appVersion: '1.0.0', tapToPayCapable: true, publicKey: ph.spki, ...extra });
  const rF = await F.post('/mobile-checkout/device/register', regBody(F, { pairingCode: pShared.body?.pairingCode }));
  const rM = await M.post('/mobile-checkout/device/register', regBody(M, { pairingCode: pPersonal.body?.pairingCode }));
  const rC = await C.post('/mobile-checkout/device/register', regBody(C));
  const X0 = makePhone('x0', 'Pairing replay');
  await X0.signIn(staff.max);
  const rX0 = await X0.post('/mobile-checkout/device/register', regBody(X0, { pairingCode: pShared.body?.pairingCode }));
  delete out.phones.x0;
  check('S2', 'the FRONT DESK phone registers with the shared code (signed by its own key — proof of possession) → ACTIVE at once, shared; the MANAGER phone with the personal code → ACTIVE, personal; the shared code used again on another phone → PAIRING_CODE_INVALID',
    ok2(rF.status) && rF.body?.status === 'active' && rF.body?.shared === true && rF.body?.pairedVia === 'pos_qr' && ok2(rM.status) && rM.body?.status === 'active' && rM.body?.shared === false && rM.body?.pairedVia === 'pos_qr'
      && rX0.status === 400 && code(rX0) === 'PAIRING_CODE_INVALID',
    `F ${rF.status} ${short({ s: rF.body?.status, sh: rF.body?.shared, via: rF.body?.pairedVia, e: rF.status >= 300 ? rF.body : null })} M ${rM.status} ${short({ s: rM.body?.status, sh: rM.body?.shared, e: rM.status >= 300 ? rM.body : null })} replay ${rX0.status} ${code(rX0)}`);
  const apprNo = await ownStale.post(`/mobile-checkout/devices/${C.id}/approve`, {});
  const capPending = await C.get(`/mobile-checkout/capability?deviceId=${C.id}`);
  await ownerStepUp();
  const appr = await own.post(`/mobile-checkout/devices/${C.id}/approve`, {});
  check('S1', 'the CHECKOUT phone registers normally (signed, with its key) → PENDING; approval without a fresh step-up is refused (403 STEP_UP_REQUIRED); with it the owner approves → ACTIVE',
    ok2(rC.status) && rC.body?.status === 'pending' && !!rC.body?.keyFingerprint && apprNo.status === 403 && code(apprNo) === 'STEP_UP_REQUIRED' && ok2(appr.status) && appr.body?.status === 'active',
    `register ${rC.status} ${short({ s: rC.body?.status, e: rC.status >= 300 ? rC.body : null })} approve-no-step-up ${apprNo.status} ${code(apprNo)} pending-capability ${capPending.status} approve ${appr.status} ${short(appr.status >= 300 ? appr.body : appr.body?.status)}`);
  await ownerStepUp();
  const br = {};
  for (const ph of [F, M, C]) br[ph.key] = await own.post(`/mobile-checkout/devices/${ph.id}/branches`, { branchIds: [B] });
  const devRows = await q(`select device_id, status, shared, bound_user_id, public_key is not null as has_key, key_alg, length(key_fingerprint) as fpl, paired_via,
      (select array_agg(branch_id::text) from mobile_pay_device_branches b where b.tenant_id = d.tenant_id and b.device_id = d.device_id) as branches
    from mobile_pay_devices d where tenant_id = $1 and device_id = any($2) order by device_id`, [T, [F.id, M.id, C.id]]);
  const dOf = (ph) => devRows.find((r) => r.device_id === ph.id);
  out.devices = devRows.map((r) => ({ ...r, device_id: Object.values(out.phones).find((p) => p.id === r.device_id)?.label }));
  check('S2', 'the owner (step-up) sets each phone\'s locations through POST devices/:id/branches; DB: three ACTIVE phones, each with its own ES256 key + fingerprint, the branch rows written, the front desk SHARED, the manager phone bound to Bea, the checkout phone bound to Cal',
    [F, M, C].every((ph) => ok2(br[ph.key].status) && (br[ph.key].body?.allowedBranchIds ?? []).includes(B)) && devRows.length === 3
      && devRows.every((r) => r.status === 'active' && r.has_key && r.key_alg === 'ES256' && r.fpl === 64 && (r.branches ?? []).includes(B))
      && dOf(F)?.shared === true && dOf(M)?.shared === false && dOf(M)?.bound_user_id === staff.bea.id && dOf(C)?.bound_user_id === staff.cal.id && dOf(C)?.paired_via === null,
    `branches ${short(Object.fromEntries(Object.entries(br).map(([k, v]) => [k, [v.status, v.status >= 300 ? v.body : v.body?.allowedBranchIds]])))} db ${short(out.devices)}`);

  // ── the checkout on a phone: lock → ticket → proceed → intent → readiness → provider session → capture ────────────
  const payOn = async (ph, ticketId, { beforeCapture, capturedAmountCents = 1, probeOversize = false } = {}) => {
    const SID = `sess-${ph.key}-${String(ticketId).slice(0, 8)}`;
    const r = { phone: ph.key, user: ph.user?.name, ticketId };
    const lock = await ph.post(`/mobile-checkout/tickets/${ticketId}/lock`, { deviceId: ph.id, sessionId: SID });
    r.lock = lock.status;
    if (!ok2(lock.status)) { r.lockBody = lock.body; return r; }
    const tkt = await ph.get(`/mobile-checkout/tickets/${ticketId}?sessionId=${encodeURIComponent(SID)}`);
    const bal = await ph.get(`/mobile-checkout/tickets/${ticketId}/balance`);
    r.serverRemaining = bal.body?.remainingCents ?? null;
    const pr = await ph.post(`/mobile-checkout/tickets/${ticketId}/proceed-to-payment`, { sessionId: SID, deviceId: ph.id, expectedVersion: tkt.body?.version });
    r.proceed = [pr.status, pr.body?.canProceed, pr.body?.reason ?? null];
    const KEY = pr.body?.idempotencyKey; r.key = KEY;
    if (probeOversize) { const ov = await ph.post(`/mobile-checkout/tickets/${ticketId}/payment-attempts`, { sessionId: SID, idempotencyKey: `${KEY}-probe`, amountCents: Number(r.serverRemaining) + 5000, deviceId: ph.id }); r.oversize = [ov.status, code(ov)]; }
    const att = await ph.post(`/mobile-checkout/tickets/${ticketId}/payment-attempts`, { sessionId: SID, idempotencyKey: KEY, deviceId: ph.id, expectedVersion: pr.body?.version });   // no client amount: the server's remaining
    r.attempt = [att.status, att.body?.amountCents ?? null, att.status >= 300 ? att.body : null];
    const ready = await ph.post(`/mobile-checkout/payment-attempts/${KEY}/readiness`, { deviceId: ph.id });
    r.ready = [ready.status, ready.body?.status];
    const ds = await ph.post(`/mobile-checkout/payment-attempts/${KEY}/device-session`, { deviceId: ph.id });
    r.session = ds.status;
    const sessionToken = ds.body?.sessionToken ?? ds.body?.session?.sessionToken;
    r.sessionToken = sessionToken;
    if (beforeCapture) await beforeCapture(sessionToken);
    // the phone's reader ran; it reports "approved" and (dishonestly) a 1-cent captured amount — the server must use its own
    const cap = await ph.post(`/mobile-checkout/payment-attempts/${KEY}/capture-result`, { outcome: 'approved', processorRef: sessionToken, brand: 'visa', last4: '4242', capturedAmountCents, deviceId: ph.id });
    r.capture = [cap.status, cap.body?.to ?? null, cap.body?.outcome ?? null, cap.status >= 300 ? cap.body : null];
    r.paymentId = cap.body?.paymentId ?? null;
    r.SID = SID;
    return r;
  };
  const release = (ph, r) => ph.post(`/mobile-checkout/tickets/${r.ticketId}/lock/release`, { sessionId: r.SID, reason: 'done' });
  const payRow = async (ticketId) => (await q(`select id, amount_cents::int as amt, method, status, payment_surface, device_id, created_by_user_id from payments where ticket_id = $1 and method = 'card' order by created_at`, [ticketId]));
  const chargesFor = (sessionToken) => chCalls.filter((c) => c.path === '/payments/v1/charges' && c.body?.source?.session === sessionToken);

  // ══ S3 three phones, three tickets, at the same moment ════════════════════════════════════════════════════════════
  const t3 = Date.now();
  const [pF, pM, pC] = await Promise.all([payOn(F, T1, { probeOversize: true }), payOn(M, T2), payOn(C, T3)]);
  out.concurrentMs = Date.now() - t3;
  const conc = [[F, pF, T1, staff.max], [M, pM, T2, staff.bea], [C, pC, T3, staff.cal]];
  const rows3 = {};
  for (const [ph, r, t] of conc) rows3[ph.key] = { rows: await payRow(t), ticket: (await q(`select status from tickets where id = $1`, [t]))[0]?.status, charges: chargesFor(r.sessionToken) };
  out.concurrent = conc.map(([ph, r]) => ({ ...r, sessionToken: undefined, db: rows3[ph.key] && { ...rows3[ph.key], charges: rows3[ph.key].charges.map((c) => c.body?.amount?.total) } }));
  check('S3', `three phones take three checkouts AT THE SAME TIME (${out.concurrentMs} ms for all three): each lock → proceed → intent → readiness → provider session → capture succeeds; each ticket is PAID with ONE approved Tap to Pay payment and ONE processor charge`,
    conc.every(([ph, r]) => ok2(r.lock) && ok2(r.attempt?.[0]) && r.ready?.[1] === 'ready' && ok2(r.session) && ok2(r.capture?.[0]) && r.capture?.[1] === 'confirmed' && !!r.paymentId
      && rows3[ph.key].ticket === 'paid' && rows3[ph.key].rows.length === 1 && rows3[ph.key].rows[0].status === 'approved' && rows3[ph.key].rows[0].payment_surface === 'tap_to_pay_iphone' && rows3[ph.key].charges.length === 1),
    short(out.concurrent.map((x) => [x.phone, x.lock, x.proceed, x.attempt?.slice(0, 2), x.ready, x.session, x.capture?.slice(0, 3), x.db?.ticket, x.db?.rows?.length, x.db?.charges])));
  check('S3', 'AMOUNTS ARE THE SERVER\'S: the intent carries the ticket\'s remaining balance (no client amount sent), the processor is charged exactly that, the payment row records exactly that although each phone reported capturedAmountCents = 1; a client amount above the balance is refused',
    conc.every(([ph, r]) => Number(r.serverRemaining) > 0 && r.attempt?.[1] === r.serverRemaining && rows3[ph.key].rows[0]?.amt === r.serverRemaining && Math.round(Number(rows3[ph.key].charges[0]?.body?.amount?.total) * 100) === r.serverRemaining)
      && pF.oversize?.[0] >= 400 && pF.oversize?.[0] < 500,
    short({ remaining: conc.map(([, r]) => r.serverRemaining), intent: conc.map(([, r]) => r.attempt?.[1]), rows: conc.map(([ph]) => rows3[ph.key].rows[0]?.amt), charged: conc.map(([ph]) => rows3[ph.key].charges[0]?.body?.amount?.total), oversize: pF.oversize }));
  check('S3', 'ATTRIBUTION: each payment row names the signed-in employee (created_by_user_id) and the phone (device_id) — Max on the front desk phone, Bea on hers, Cal on the checkout phone',
    conc.every(([ph, , , who]) => rows3[ph.key].rows[0]?.created_by_user_id === who.id && rows3[ph.key].rows[0]?.device_id === ph.id),
    short(conc.map(([ph, , , who]) => [ph.key, rows3[ph.key].rows[0]?.created_by_user_id === who.id, rows3[ph.key].rows[0]?.device_id === ph.id])));
  // S13 (§75): the front desk phone asks for the receipt of its payment — the last link of the audit trace
  out.trace = { receipt: (await F.post(`/mobile-checkout/tickets/${T1}/receipt`, { channel: 'sms' })).status };
  for (const [ph, r] of conc) { out.payments.push({ phone: ph.key, user: ph.user.name, ticketId: r.ticketId, paymentId: r.paymentId, amountCents: rows3[ph.key].rows[0]?.amt }); await release(ph, r); }

  // ══ S4 the same ticket from two phones at once ════════════════════════════════════════════════════════════════════
  const [l1, l2] = await Promise.all([
    M.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: `race-M-${tag}` }),
    C.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: C.id, sessionId: `race-C-${tag}` }),
  ]);
  const winners = [l1, l2].filter((x) => ok2(x.status)), losers = [l1, l2].filter((x) => !ok2(x.status));
  const claimRows = await q(`select count(*)::int as n from checkout_locks where ticket_id = $1 and released_at is null and expires_at > now()`, [T4]).catch(() => null);
  out.race = { M: [l1.status, code(l1)], C: [l2.status, code(l2)], openClaims: claimRows?.[0]?.n ?? 'n/a' };
  check('S4', 'the SAME ticket claimed from two phones at the same instant → exactly ONE claim wins; the other gets 409 CHECKOUT_ALREADY_CLAIMED (the friendly "being processed on another payment device")',
    winners.length === 1 && losers.length === 1 && losers[0].status === 409 && code(losers[0]) === 'CHECKOUT_ALREADY_CLAIMED', short(out.race));
  const raceWinner = ok2(l1.status) ? { ph: M, SID: `race-M-${tag}` } : { ph: C, SID: `race-C-${tag}` };
  const relRace = await raceWinner.ph.post(`/mobile-checkout/tickets/${T4}/lock/release`, { sessionId: raceWinner.SID, reason: 'race probe' });
  info(`race winner ${raceWinner.ph.key} released the claim → ${relRace.status}`);

  // ══ S6 tampering (on the checkout phone and the manager phone, before the revoke) ════════════════════════════════
  const capPath = `/mobile-checkout/capability?deviceId=${M.id}`;
  const okSigned = await M.get(capPath);
  // (a) the body altered after signing: the phone signed one lock request, a man in the middle sends another ticket
  const tampered = await M.req('POST', `/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: `tamper-${tag}` }, { signBody: JSON.stringify({ deviceId: M.id, sessionId: `orig-${tag}` }) });
  // (b) a replayed nonce: the exact same signed request twice
  const nonce = b64url(randomBytes(32)); const ts = Date.now();
  const first = await M.get(capPath, { nonce, ts });
  const replay = await M.get(capPath, { nonce, ts });
  // (c) a stale timestamp (10 minutes old, correctly signed)
  const stale = await M.get(capPath, { ts: Date.now() - 10 * 60_000 });
  // (d) an unsigned request from a keyed device: no proof headers at all (the cookie session alone) on the money routes,
  //     and the device id header with no signature
  const unsignedLock = await M.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: `unsigned-${tag}` }, { sign: false });
  // the phone (signed) holds the claim and has a READY intent — then the same session WITHOUT the phone's signature tries
  // to create an intent, to post a capture result ("declined") and to cancel the intent
  const SIDp = `probe-${tag}`;
  const pLock = await M.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: SIDp });
  const unsignedAttempt = await M.post(`/mobile-checkout/tickets/${T4}/payment-attempts`, { sessionId: SIDp, idempotencyKey: `unsigned-${tag}`, deviceId: M.id }, { sign: false });
  const pTk = await M.get(`/mobile-checkout/tickets/${T4}?sessionId=${SIDp}`);
  const pPr = await M.post(`/mobile-checkout/tickets/${T4}/proceed-to-payment`, { sessionId: SIDp, deviceId: M.id, expectedVersion: pTk.body?.version });
  const PK = pPr.body?.idempotencyKey;
  const pAtt = await M.post(`/mobile-checkout/tickets/${T4}/payment-attempts`, { sessionId: SIDp, idempotencyKey: PK, deviceId: M.id });
  const pRdy = await M.post(`/mobile-checkout/payment-attempts/${PK}/readiness`, { deviceId: M.id });
  const unsignedCapture = await M.post(`/mobile-checkout/payment-attempts/${PK}/capture-result`, { outcome: 'declined', deviceId: M.id }, { sign: false });
  const unsignedCancel = await M.post(`/mobile-checkout/payment-attempts/${PK}/cancel`, {}, { sign: false });
  const pAfter = await M.get(`/mobile-checkout/payment-attempts/${PK}`);
  const pCancel = await M.post(`/mobile-checkout/payment-attempts/${PK}/cancel`, {});
  const pRel = await M.post(`/mobile-checkout/tickets/${T4}/lock/release`, { sessionId: SIDp, reason: 'probe done' });
  info(`S6 probe set-up on the manager phone: claim ${pLock.status}, proceed ${pPr.status}, intent ${pAtt.status} ${short(pAtt.status >= 300 ? pAtt.body : null)}, readiness ${pRdy.status} ${pRdy.body?.status}, signed cancel ${pCancel.status} ${pCancel.body?.status}, release ${pRel.status}`);
  const noSig = await M.get(capPath, { sign: false, headers: { 'x-aps-device-id': M.id } });
  // (e) a stolen session used from another phone: the session + the device id, signed with a DIFFERENT key
  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const wrongKey = await M.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: `wrongkey-${tag}` }, { privateKey: otherKey });
  // (f) a second device registering the SAME public key: a copied phone that also holds the private key, and one that does not
  const X = makePhone('copy', 'Copied phone'); await X.signIn(staff.cal);
  const copyWithKey = await X.post('/mobile-checkout/device/register', { ...regBody(X), publicKey: C.spki }, { privateKey: C.privateKey });
  const copyNoKey = await X.post('/mobile-checkout/device/register', { ...regBody(X), publicKey: C.spki });
  const copyUnsigned = await X.post('/mobile-checkout/device/register', { ...regBody(X), publicKey: C.spki }, { sign: false });
  delete out.phones.copy;
  const xRow = (await q(`select count(*)::int as n from mobile_pay_devices where tenant_id = $1 and device_id = $2`, [T, X.id]))[0]?.n;
  out.refusals.tamper = { baseline: okSigned.status, alteredBody: [tampered.status, code(tampered)], replayFirst: first.status, replay: [replay.status, code(replay)], stale: [stale.status, code(stale)],
    unsignedLock: [unsignedLock.status, code(unsignedLock)], unsignedAttempt: [unsignedAttempt.status, code(unsignedAttempt)], unsignedCapture: [unsignedCapture.status, code(unsignedCapture)], unsignedCancel: [unsignedCancel.status, code(unsignedCancel)], attemptAfterUnsigned: pAfter.body?.status, deviceIdNoSig: [noSig.status, code(noSig)], wrongKey: [wrongKey.status, code(wrongKey)],
    copiedKeySigned: [copyWithKey.status, code(copyWithKey)], copiedKeyOtherSigner: [copyNoKey.status, code(copyNoKey)], copiedKeyUnsigned: [copyUnsigned.status, code(copyUnsigned)], copyRowCreated: xRow };
  const T6x = out.refusals.tamper;
  check('S6', 'ALTERED BODY after signing → 403 DEVICE_KEY_MISMATCH (the same signed request, untouched, is accepted)', okSigned.status === 200 && tampered.status === 403 && code(tampered) === 'DEVICE_KEY_MISMATCH', short(T6x));
  check('S6', 'REPLAYED NONCE → the first is accepted, the identical second 409 DEVICE_REQUEST_REPLAYED', first.status === 200 && replay.status === 409 && code(replay) === 'DEVICE_REQUEST_REPLAYED', short(T6x));
  check('S6', 'STALE TIMESTAMP (10 minutes old, validly signed) → 403 DEVICE_KEY_MISMATCH', stale.status === 403 && code(stale) === 'DEVICE_KEY_MISMATCH', short(T6x));
  check('S6', 'UNSIGNED requests from a keyed phone are refused: the claim and the intent with no proof → DEVICE_KEY_MISMATCH; the device header without a signature → DEVICE_KEY_MISMATCH; a stolen session signing with another key → DEVICE_KEY_MISMATCH',
    [unsignedLock, unsignedAttempt, noSig, wrongKey].every((r) => r.status === 403 && code(r) === 'DEVICE_KEY_MISMATCH'), short(T6x));
  check('S6', 'an UNSIGNED capture result ("declined") and an UNSIGNED cancel for the phone\'s READY intent → DEVICE_KEY_MISMATCH; the intent stays ready (only the phone that holds the key reports on its own payment)',
    ok2(pAtt.status) && pRdy.body?.status === 'ready' && [unsignedCapture, unsignedCancel].every((r) => r.status === 403 && code(r) === 'DEVICE_KEY_MISMATCH') && pAfter.body?.status === 'ready' && ok2(pCancel.status),
    short({ capture: T6x.unsignedCapture, cancel: T6x.unsignedCancel, after: T6x.attemptAfterUnsigned, signedCancel: pCancel.status }));
  check('S6', 'a SECOND DEVICE registering the SAME public key is refused — signed with the copied private key (DEVICE_KEY_MISMATCH "already belongs to another device"), signed by another key, or unsigned — and no device row is created',
    [copyWithKey, copyNoKey, copyUnsigned].every((r) => r.status === 403 && code(r) === 'DEVICE_KEY_MISMATCH') && xRow === 0, short(T6x));

  // ══ S7 revoke the checkout phone mid-day ══════════════════════════════════════════════════════════════════════════
  const calOld = C.s; const calRefresh = C.refreshToken;
  const sessBefore = await q(`select count(*)::int as n from sessions where tenant_id = $1 and device_id = $2 and revoked_at is null`, [T, C.id]);
  const revNo = await ownStale.post(`/mobile-checkout/devices/${C.id}/revoke`, { reason: 'Pilot: phone left in a cab' });
  await ownerStepUp();
  const rev = await own.post(`/mobile-checkout/devices/${C.id}/revoke`, { reason: 'Pilot: phone left in a cab' });
  const sessAfter = await q(`select s.status, s.revoked_at is not null as revoked, (select count(*)::int from refresh_tokens r where r.session_id = s.id) as rt, (select count(*)::int from refresh_tokens r where r.session_id = s.id and r.revoked_at is null) as rt_live from sessions s where s.tenant_id = $1 and s.device_id = $2`, [T, C.id]);
  const oldReq = await C.get(`/mobile-checkout/capability?deviceId=${C.id}`);
  const refreshTry = calRefresh ? await session('refresh').post('/auth/refresh', { refreshToken: calRefresh }) : { status: 0 };
  // Cal signs in again on the revoked phone (a new session): every route the phone signs is refused DEVICE_REVOKED
  const re = await C.signIn(staff.cal);
  const routes = {
    capability: await C.get(`/mobile-checkout/capability?deviceId=${C.id}`),
    readiness: await C.get(`/mobile-checkout/readiness?deviceId=${C.id}`),
    queue: await C.get('/mobile-checkout/queue'),
    ticket: await C.get(`/mobile-checkout/tickets/${T5}`),
    lock: await C.post(`/mobile-checkout/tickets/${T5}/lock`, { deviceId: C.id, sessionId: `revoked-${tag}` }),
    attempt: await C.post(`/mobile-checkout/tickets/${T5}/payment-attempts`, { sessionId: `revoked-${tag}`, idempotencyKey: `revoked-${tag}`, deviceId: C.id }),
    heartbeat: await C.post('/mobile-checkout/device/heartbeat', { deviceId: C.id, appVersion: '1.0.0' }),
    register: await C.post('/mobile-checkout/device/register', regBody(C)),
    history: await C.get('/mobile-checkout/payments'),
  };
  const unsignedAfter = await C.post(`/mobile-checkout/tickets/${T5}/payment-attempts`, { sessionId: `revoked-u-${tag}`, idempotencyKey: `revoked-u-${tag}`, deviceId: C.id }, { sign: false });
  const devC = (await q(`select status, revoke_reason, revoked_at is not null as at from mobile_pay_devices where tenant_id = $1 and device_id = $2`, [T, C.id]))[0];
  const othersF = await F.get(`/mobile-checkout/capability?deviceId=${F.id}`), othersM = await M.get(`/mobile-checkout/capability?deviceId=${M.id}`);
  out.revoke = { revokeWithoutStepUp: [revNo.status, code(revNo)], revoke: [rev.status, rev.body?.status], sessionsBefore: sessBefore[0]?.n, sessionsAfter: sessAfter, oldSession: [oldReq.status, code(oldReq)], refresh: [refreshTry.status, code(refreshTry)],
    resignIn: re, routes: Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, [v.status, code(v)]])), unsignedAfter: [unsignedAfter.status, code(unsignedAfter)], db: devC, others: { front: othersF.status, manager: othersM.status } };
  check('S7', 'the owner revokes the checkout phone mid-day (403 STEP_UP_REQUIRED without a fresh step-up; with it → revoked, the reason kept)',
    revNo.status === 403 && code(revNo) === 'STEP_UP_REQUIRED' && ok2(rev.status) && rev.body?.status === 'revoked' && devC?.status === 'revoked' && devC?.at === true && /cab/.test(devC?.revoke_reason ?? ''), short(out.revoke));
  check('S7', 'DB: every session opened on that phone is REVOKED and every refresh token of those sessions is revoked; the phone\'s old session is refused at once and its refresh token cannot mint a new one',
    (sessBefore[0]?.n ?? 0) >= 1 && sessAfter.length >= 1 && sessAfter.every((s) => s.revoked && s.status === 'revoked' && s.rt_live === 0) && sessAfter.some((s) => s.rt > 0) && oldReq.status === 401 && refreshTry.status === 401,
    short({ before: sessBefore, after: sessAfter, old: out.revoke.oldSession, refresh: out.revoke.refresh }));
  check('S7', 'signed in again on the revoked phone, EVERY route it signs answers 403 DEVICE_REVOKED (capability, readiness, queue, ticket, claim, intent, heartbeat, re-register, history); an unsigned intent naming it is refused too (no claim — the claim itself needs the phone)',
    re.ok && Object.values(routes).every((r) => r.status === 403 && code(r) === 'DEVICE_REVOKED') && unsignedAfter.status >= 400 && unsignedAfter.status < 500,
    short({ resignIn: re, routes: out.revoke.routes, unsigned: out.revoke.unsignedAfter }));
  check('S7', 'the other two phones keep working (signed capability 200 on the front desk and the manager phone)', othersF.status === 200 && othersM.status === 200, short(out.revoke.others));

  // ══ S5 shift change on the SHARED phone; another user on the PERSONAL phone ═══════════════════════════════════════
  const maxOldJar = new Map(F.s.jar);
  const lo = await F.s.post('/auth/logout', {});
  const maxOld = await (async () => { const r = await fetch(API + `/mobile-checkout/capability?deviceId=${F.id}`, { headers: { cookie: [...maxOldJar.values()].join('; ') } }); return r.status; })();
  const bOnF = await F.signIn(staff.bea);
  // S12 (§77): the front desk sends Bea's guest to the Customer Display before the phone takes the payment
  const devDisplay = (method, path, body) => fetch(API + '/customer-display/device' + path, { method, headers: { 'x-device-token': ctx.displayToken ?? '', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => { const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b }; });
  const disp = {};
  // the display is switched on at the front desk: its own heartbeat (no screen is open in this phase, so it would read offline)
  const hb = await devDisplay('POST', '/heartbeat', { mode: 'idle', appVersion: '1.0.0', profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE', screen: { width: 1920, height: 1080, pixelRatio: 1 } });
  disp.heartbeat = hb.status >= 300 ? [hb.status, code(hb) ?? hb.body?.message] : hb.status;
  disp.send = await rec.post(`/pos/checkout/tickets/${T5}/send-to-customer-display`, { stationId: ctx.stationId });
  if (disp.send.status === 409) {
    // the register's display still holds an earlier customer's session (phases 4–10) → the receptionist's "Clear Display"
    // (the POS closes that session), then the send — recorded, not hidden
    const cds = await rec.get('/pos/customer-displays');
    const open = (cds.body?.devices ?? cds.body?.items ?? cds.body ?? []).map?.((x) => x.session).filter((x) => x && x.sessionId) ?? [];
    disp.busy = { code: code(disp.send), cleared: [] };
    for (const o of open) disp.busy.cleared.push((await rec.post(`/pos/customer-display/sessions/${o.sessionId}/close`, {})).status);
    disp.send = await rec.post(`/pos/checkout/tickets/${T5}/send-to-customer-display`, { stationId: ctx.stationId });
  }
  await sleep(300);
  disp.before = await devDisplay('GET', '/current');
  const pB = await payOn(F, T5);
  const rowsB = await payRow(T5);
  // the display reads the ticket's own payment status (customer-display.service mapState: ticket paid → payment_success)
  for (let i = 0; i < 20; i++) { disp.after = await devDisplay('GET', '/current'); if (/success|completed|paid/i.test(String(disp.after?.body?.state ?? ''))) break; await sleep(500); }
  disp.release = await devDisplay('POST', '/release', { sessionId: disp.after?.body?.sessionId ?? undefined });
  disp.cleared = await devDisplay('GET', '/current');
  await release(F, pB);
  out.shift = { logout: lo.status, maxOldCookie: maxOld, beaSignIn: bOnF, pay: { ...pB, sessionToken: undefined }, rows: rowsB };
  check('S5', 'SHARED phone, shift change: Max signs out (his old cookie is dead), Bea signs in on the SAME front desk phone (same device id + key) and takes a payment → PAID, attributed to BEA on the front desk phone',
    ok2(lo.status) && maxOld === 401 && bOnF.ok && ok2(pB.capture?.[0]) && pB.capture?.[1] === 'confirmed' && rowsB.length === 1 && rowsB[0].created_by_user_id === staff.bea.id && rowsB[0].device_id === F.id && rowsB[0].status === 'approved',
    short({ logout: lo.status, old: maxOld, signIn: bOnF, pay: [pB.lock, pB.attempt?.[0], pB.capture?.slice(0, 2)], row: rowsB.map((r) => [r.created_by_user_id === staff.bea.id ? 'Bea' : r.created_by_user_id, r.device_id === F.id]) }));
  out.payments.push({ phone: 'front', user: 'Bea Shift', ticketId: T5, paymentId: pB.paymentId, amountCents: rowsB[0]?.amt });
  // Max on Bea's PERSONAL phone
  const Mmax = makePhone('manager', M.label, false, M);   // the same physical phone (same id + key), Max's session
  const maxOnM = await Mmax.signIn(staff.max);
  const mLock = await Mmax.post(`/mobile-checkout/tickets/${T4}/lock`, { deviceId: M.id, sessionId: `max-on-m-${tag}` });
  const mAttempt = await Mmax.post(`/mobile-checkout/tickets/${T4}/payment-attempts`, { sessionId: `max-on-m-${tag}`, idempotencyKey: `max-on-m-${tag}`, deviceId: M.id });
  const mBeat = await Mmax.post('/mobile-checkout/device/heartbeat', { deviceId: M.id, appVersion: '1.0.0' });
  const mCap = await Mmax.get(`/mobile-checkout/capability?deviceId=${M.id}`);
  const t4pays = await payRow(T4);
  out.refusals.personal = { signIn: maxOnM, lock: [mLock.status, code(mLock), mLock.body?.message], attempt: [mAttempt.status, code(mAttempt)], heartbeat: [mBeat.status, code(mBeat)], capability: [mCap.status, mCap.body?.deviceBlockReason ?? mCap.body?.blockReason ?? null], paymentsOnT4: t4pays.length };
  check('S5', `PERSONAL phone: Max signs in on Bea's phone (sign-in itself is allowed) — the claim is refused ${mLock.status} ${code(mLock)}, the intent ${mAttempt.status} ${code(mAttempt)} (no claim), the heartbeat ${mBeat.status} ${code(mBeat)}; no payment is taken`,
    maxOnM.ok && mLock.status === 403 && code(mLock) === 'DEVICE_NOT_AUTHORIZED' && mAttempt.status >= 400 && mBeat.status === 403 && code(mBeat) === 'DEVICE_NOT_AUTHORIZED' && t4pays.length === 0,
    short(out.refusals.personal));

  // ══ S8 an unknown capture → verifying → reconcile ════════════════════════════════════════════════════════════════
  // (a) the provider answers 200 but neither approved nor declined (transactionState PENDING) — (b) the connection drops
  const unk = {};
  for (const [label, t, mode] of [['pending', T6, 'pending'], ['dropped', T7, 'drop']]) {
    const before = chCalls.filter((c) => c.path === '/payments/v1/charges').length;
    const r = await payOn(M, t, { beforeCapture: (sess) => { chControl[mode].add(sess); } });
    const att = await M.get(`/mobile-checkout/payment-attempts/${r.key}`);
    const retry = await M.post(`/mobile-checkout/payment-attempts/${r.key}/capture-result`, { outcome: 'approved', processorRef: r.sessionToken, brand: 'visa', last4: '4242', deviceId: M.id });
    const newIntent = await M.post(`/mobile-checkout/tickets/${t}/payment-attempts`, { sessionId: r.SID, idempotencyKey: `${r.key}-again`, deviceId: M.id });
    const recon = await M.post(`/mobile-checkout/payment-attempts/${r.key}/reconcile`, { resolution: 'confirmed', processorRef: 'FORGED-BY-PHONE', capturedAmountCents: 1 });
    const after = await M.get(`/mobile-checkout/payment-attempts/${r.key}`);
    const charges = chCalls.filter((c) => c.path === '/payments/v1/charges').length - before;
    const dbAttempt = (await q(`select status, last_error_code from payment_attempts where tenant_id = $1 and idempotency_key = $2`, [T, r.key]).catch(() => []))[0] ?? null;
    unk[label] = { capture: r.capture, attemptView: [att.status, att.body?.status, att.body?.recoverable, att.body?.lastErrorCode ?? null], retry: [retry.status, code(retry)], newIntent: [newIntent.status, code(newIntent)],
      reconcile: [recon.status, recon.body?.status, recon.body?.decision?.action, recon.body?.decision?.reason], after: [after.status, after.body?.status], charges, payments: await payRow(t), ticket: (await q(`select status from tickets where id = $1`, [t]))[0]?.status, db: dbAttempt };
    await release(M, r);
  }
  out.unknown = unk;
  const verifying = (u) => ['unknown', 'timed_out', 'reconciliation_required'].includes(u.after?.[1]) && ['unknown', 'timed_out'].includes(u.capture?.[1]) && u.capture?.[2] === 'unknown';
  check('S8', 'a DROPPED connection on the capture → the attempt is UNKNOWN ("verifying", recoverable), never declined; the ticket stays open, no payment row',
    ok2(unk.dropped.capture?.[0]) && verifying(unk.dropped) && unk.dropped.attemptView?.[2] === true && unk.dropped.payments.length === 0 && unk.dropped.ticket !== 'paid', short(unk.dropped));
  check('S8', 'a provider answer that is neither approved nor declined (200, transactionState PENDING) → UNKNOWN / verifying — NOT declined (an unknown payment is never a decline)',
    ok2(unk.pending.capture?.[0]) && verifying(unk.pending) && unk.pending.payments.length === 0, short(unk.pending));
  check('S8', 'NO DOUBLE CHARGE: the phone re-sends its result and tries a NEW intent on the same ticket — both refused while the first is unresolved; the processor saw exactly ONE charge per ticket',
    ['pending', 'dropped'].every((k) => unk[k].retry[0] >= 400 && unk[k].newIntent[0] >= 400 && unk[k].charges === 1), short(Object.fromEntries(Object.entries(unk).map(([k, v]) => [k, { retry: v.retry, newIntent: v.newIntent, charges: v.charges }]))));
  check('S8', 'POST payment-attempts/:key/reconcile asks the PROVIDER (the phone\'s "confirmed" + forged reference + amount are ignored): the CommerceHub adapter has no transaction inquiry → decision "wait" (no_inquiry), the attempt stays UNKNOWN, nothing is recorded or charged',
    ['pending', 'dropped'].every((k) => ok2(unk[k].reconcile[0]) && unk[k].reconcile[2] === 'wait' && /no inquiry/i.test(unk[k].reconcile[3] ?? '') && unk[k].after[1] === 'unknown' && unk[k].payments.length === 0),
    short(Object.fromEntries(Object.entries(unk).map(([k, v]) => [k, v.reconcile]))));
  info('BLOCKED_EXTERNAL S8: reconcile → a VERIFIED FINAL state needs the CommerceHub transaction inquiry (inquireByOrderId), which is deliberately not implemented until it is verified against the CommerceHub sandbox (credentials) — fiserv-commercehub-ttp.adapter.ts lookupTransaction answers no_inquiry, so the attempt correctly stays "verifying" for a human / the recovery worker.');
  out.blockedExternal = ['S8 verified final state after reconcile: CommerceHub transaction inquiry (sandbox credentials) — the adapter answers no_inquiry'];

  // ══ S9 the POS sees the mobile payments; the owner's history ══════════════════════════════════════════════════════
  const mobilePays = out.payments.filter((p) => p.paymentId);
  // the outbox publisher runs on its own tick (after the large-salon phase it has a backlog): wait up to 60 s for these rows
  const t9 = Date.now(); let pendingLeft = -1;
  for (; Date.now() - t9 < 60_000; await sleep(1000)) {
    pendingLeft = (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type in ('payment.captured', 'checkout.completed') and publish_status <> 'published' and aggregate_id = any($2)`, [T, mobilePays.flatMap((p) => [p.ticketId, p.paymentId])]))[0]?.n ?? 0;
    if (pendingLeft === 0) break;
  }
  out.outboxPublishWaitMs = Date.now() - t9;
  const posView = {};
  const readyList = await rec.get('/pos/checkout/tickets');
  const listRows = readyList.body?.items ?? readyList.body?.tickets ?? [];
  for (const p of mobilePays) {
    const d = await rec.get(`/pos/checkout/tickets/${p.ticketId}`);
    const dbT = (await q(`select status from tickets where id = $1`, [p.ticketId]))[0]?.status;
    const ev = await q(`select event_type, publish_status as status from outbox_events where tenant_id = $1 and (aggregate_id = $2 or aggregate_id = $3 or payload_json::text like '%' || $2 || '%') and event_type in ('payment.captured', 'checkout.completed') order by created_at`, [T, p.ticketId, p.paymentId]).catch((e) => [{ err: String(e.message) }]);
    posView[p.ticketId] = { phone: p.phone, detail: d.status, commissionSource: d.body?.commission?.source ?? null, posListStatus: (listRows.find?.((x) => (x.ticketId ?? x.id) === p.ticketId) ?? {}).status ?? null, db: dbT, events: ev.map((x) => x.event_type ?? x.err), published: ev.map((x) => x.status) };
  }
  const claims = await rec.get('/mobile-checkout/claims');
  const phonesCard = await rec.get('/mobile-checkout/devices/status');
  out.pos = { tickets: posView, claims: [claims.status, Array.isArray(claims.body) ? claims.body.length : short(claims.body)], phones: [phonesCard.status, (Array.isArray(phonesCard.body) ? phonesCard.body : []).map((x) => [x.label ?? x.deviceLabel, x.status ?? null])] };
  check('S9', 'the POS sees every mobile payment on the ONE canonical ticket: the receptionist\'s checkout list shows it PAID, its checkout view now carries the paid ticket\'s immutable commission SNAPSHOT, the ticket is paid; each wrote payment.captured + checkout.completed to the outbox and both were PUBLISHED (the POS / display update path)',
    readyList.status === 200 && mobilePays.length === 4 && mobilePays.every((p) => { const v = posView[p.ticketId]; return v?.detail === 200 && v.posListStatus === 'paid' && v.commissionSource === 'snapshot' && v.db === 'paid' && v.events.includes('payment.captured') && v.events.includes('checkout.completed') && v.published.every((x) => x === 'published'); }),
    short(out.pos));
  check('S9', 'the POS "Mobile Payments" card lists the two working phones and not the revoked one; no claim is left open',
    phonesCard.status === 200 && JSON.stringify(phonesCard.body).includes(F.id) && JSON.stringify(phonesCard.body).includes(M.id) && !JSON.stringify(phonesCard.body).includes(C.id) && claims.status === 200,
    short(out.pos.phones));
  const hist = await own.get('/mobile-checkout/payments?surface=tap_to_pay_iphone&limit=200');
  const items = hist.body?.items ?? [];
  const histOf = (id) => items.find((x) => x.paymentId === id);
  out.history = mobilePays.map((p) => { const h = histOf(p.paymentId); return { phone: p.phone, user: p.user, amountCents: p.amountCents, history: h && { deviceLabel: h.deviceLabel, employeeName: h.employeeName, amountCents: h.amountCents, status: h.status } }; });
  const expectLabel = { front: F.label, manager: M.label, checkout: C.label };
  check('S9', 'the OWNER\'s payment history lists each mobile payment with its DEVICE LABEL and its EMPLOYEE (Front Desk iPhone · Max, Bea\'s iPhone · Bea, Checkout iPhone 3 · Cal, Front Desk iPhone · Bea) at the server\'s amount, PAID',
    hist.status === 200 && out.history.length === 4 && out.history.every((x) => x.history && x.history.deviceLabel === expectLabel[x.phone] && x.history.employeeName === x.user && x.history.amountCents === x.amountCents && x.history.status === 'PAID'),
    short(out.history));
  // the device registry as the owner sees it (health view)
  const devs = await own.get('/mobile-checkout/devices');
  out.ownerDevices = (Array.isArray(devs.body) ? devs.body : []).filter((d) => [F.id, M.id, C.id].includes(d.deviceId)).map((d) => ({ label: d.label, status: d.status, bound: d.boundUserName, lastPaymentAt: !!d.lastPaymentAt, lastErrorCode: d.lastErrorCode }));
  info(`owner device list: ${short(out.ownerDevices)}`);

  // ══ S10 §64 POS vs phone: an unsettled tender on one surface blocks money on the other (Oct 26 2026) ═════════════════
  const s10 = {};
  // (a) phone → POS: T6's Tap to Pay attempt is still UNKNOWN (S8) — the POS takes neither cash nor a card on that ticket
  const auths = () => (cpCalls ?? []).filter((c) => c.method === 'PUT' && String(c.path).endsWith('/auth')).length;
  const a0 = auths();
  const posCash6 = await rec.post(`/pos/checkout/tickets/${T6}/pay/cash`, { amountReceivedCents: 100000 });
  const posCard6 = await rec.post(`/pos/checkout/tickets/${T6}/pay/card`, { idempotencyKey: `s10-card6-${tag}`, ...(CARD ?? {}) });
  const t6pays = (await q(`select method, status from payments where ticket_id = $1`, [T6]));
  s10.phoneToPos = { attempt: unk.pending?.after, cash: [posCash6.status, code(posCash6)], card: [posCard6.status, code(posCard6)], gatewayCalls: auths() - a0, payments: t6pays };
  check('S10', 'PHONE → POS (§64): the phone\'s Tap to Pay attempt on a ticket is UNKNOWN (S8) — the POS cash and the POS card on that ticket are refused PAYMENT_STATUS_UNKNOWN; the card never reaches the gateway; no payment row',
    ['unknown', 'timed_out', 'reconciliation_required'].includes(unk.pending?.after?.[1]) && [posCash6, posCard6].every((r) => r.status === 409 && code(r) === 'PAYMENT_STATUS_UNKNOWN') && s10.phoneToPos.gatewayCalls === 0 && t6pays.length === 0,
    short(s10.phoneToPos));
  // (b) POS → phone: a POS card on T8 whose answer is unknown ('processing') — the phone's claim works, but proceed, a new
  //     intent and a phone cash tender are refused PAYMENT_STATUS_UNKNOWN; nothing reaches CommerceHub; Verify then settles it
  const posUnk = await rec.post(`/pos/checkout/tickets/${T8}/pay/card`, { idempotencyKey: `s10-unk-${tag}`, cardToken: CP_TOKENS?.unknown, expiry: '1230' });
  const ch0 = chCalls.filter((c) => c.path === '/payments/v1/charges').length;
  const SID8 = `s10-${tag}`;
  const l8 = await M.post(`/mobile-checkout/tickets/${T8}/lock`, { deviceId: M.id, sessionId: SID8 });
  const tk8 = await M.get(`/mobile-checkout/tickets/${T8}?sessionId=${SID8}`);
  const pr8 = await M.post(`/mobile-checkout/tickets/${T8}/proceed-to-payment`, { sessionId: SID8, deviceId: M.id, expectedVersion: tk8.body?.version });
  const at8 = await M.post(`/mobile-checkout/tickets/${T8}/payment-attempts`, { sessionId: SID8, idempotencyKey: `s10-intent-${tag}`, deviceId: M.id });
  const cash8 = await M.post(`/mobile-checkout/tickets/${T8}/cash-tender`, { sessionId: SID8, idempotencyKey: `s10-cash-${tag}`, amountCents: 100, deviceId: M.id });
  const rel8 = await M.post(`/mobile-checkout/tickets/${T8}/lock/release`, { sessionId: SID8, reason: 'S10 probe' });
  const blockedAudit = (await q(`select count(*)::int n from audit_events where tenant_id = $1 and action = 'mobile_payment_blocked_unsettled_tender' and resource_id = $2`, [T, T8]))[0]?.n ?? 0;
  const attempts8 = (await q(`select count(*)::int n from payment_attempts where tenant_id = $1 and ticket_id = $2 and method = 'tap_to_pay'`, [T, T8]))[0]?.n;
  const charges8 = chCalls.filter((c) => c.path === '/payments/v1/charges').length - ch0;
  const ver8 = await rec.post(`/pos/checkout/tickets/${T8}/pay/card/verify`, {});
  const t8 = (await q(`select t.status, (select string_agg(p.method || ':' || p.status, ',') from payments p where p.ticket_id = t.id) as pays from tickets t where t.id = $1`, [T8]))[0];
  s10.posToPhone = { posCard: [posUnk.status, code(posUnk)], claim: l8.status, proceed: [pr8.status, pr8.body?.canProceed, pr8.body?.reason], intent: [at8.status, code(at8)], cash: [cash8.status, code(cash8)], release: rel8.status, auditBlocked: blockedAudit, tapAttempts: attempts8, chCharges: charges8, verify: [ver8.status, ver8.body?.status], after: t8 };
  check('S10', 'POS → PHONE (§64): a POS card on the ticket answers UNKNOWN (409, still processing) — the phone may open the ticket, but Proceed says PAYMENT_STATUS_UNKNOWN, a new intent and a phone cash tender are refused PAYMENT_STATUS_UNKNOWN (audited), no Tap to Pay intent is created and CommerceHub is never called; Verify then settles the POS card (approved) → paid with ONE payment',
    posUnk.status === 409 && code(posUnk) === 'PAYMENT_STATUS_UNKNOWN' && ok2(l8.status) && pr8.body?.canProceed === false && pr8.body?.reason === 'PAYMENT_STATUS_UNKNOWN'
      && at8.status === 409 && code(at8) === 'PAYMENT_STATUS_UNKNOWN' && cash8.status === 409 && code(cash8) === 'PAYMENT_STATUS_UNKNOWN' && blockedAudit >= 3 && attempts8 === 0 && charges8 === 0
      && ok2(ver8.status) && t8?.status === 'paid' && t8?.pays === 'card:approved',
    short(s10.posToPhone));
  out.s10 = s10;

  // ══ S11 §67 refund trio over HTTP (Oct 26 2026) ══════════════════════════════════════════════════════════════════════
  const payBea = out.payments.find((p) => p.phone === 'manager');
  const refundBody = { reason: 'Pilot S11: one nail chipped — partial refund', amountCents: 500 };
  const recSu = await rec.post('/auth/step-up', { password: STAFF_PW });   // even with a fresh step-up the receptionist may not refund
  const rRec = await rec.post(`/mobile-checkout/payments/${payBea?.paymentId}/refund`, refundBody, { 'idempotency-key': `s11-rec-${tag}` });
  const KEY11 = `s11-bea-${tag}`;
  const rStale = await M.post(`/mobile-checkout/payments/${payBea?.paymentId}/refund`, refundBody, { headers: { 'idempotency-key': KEY11 } });
  const beaSu = await M.s.post('/auth/step-up', { password: STAFF_PW });
  const chRefundsBefore = chCalls.filter((c) => c.path === '/payments/v1/refunds').length, cpBefore = (cpCalls ?? []).length;
  const rFresh = await M.post(`/mobile-checkout/payments/${payBea?.paymentId}/refund`, refundBody, { headers: { 'idempotency-key': KEY11 } });
  const chRefunds = chCalls.filter((c) => c.path === '/payments/v1/refunds').slice(chRefundsBefore), cpDuring = (cpCalls ?? []).length - cpBefore;
  const rAgain = await M.post(`/mobile-checkout/payments/${payBea?.paymentId}/refund`, refundBody, { headers: { 'idempotency-key': KEY11 } });   // the retried request
  const chRefundsAfterRetry = chCalls.filter((c) => c.path === '/payments/v1/refunds').length - chRefundsBefore;
  const payAfter = (await q(`select p.status, (select coalesce(sum(r.amount_cents), 0)::int from payment_refunds r where r.payment_id = p.id) as refunded from payments p where p.id = $1`, [payBea?.paymentId]).catch((e) => [{ err: e.message }]))[0];
  const refundAudit = await q(`select action, actor_user_id from audit_events where tenant_id = $1 and resource_id = $2 and action = 'mobile_refund_requested' order by occurred_at`, [T, payBea?.paymentId]);
  out.refund = { receptionist: { stepUp: recSu.status, refund: [rRec.status, code(rRec)] }, staleManager: [rStale.status, code(rStale)], stepUp: beaSu.status, fresh: [rFresh.status, rFresh.status >= 300 ? rFresh.body : (rFresh.body?.status ?? rFresh.body?.refund?.status ?? 'ok')], commerceHub: { refunds: chRefunds.length, signed: chRefunds.every((c) => c.signed), afterRetry: chRefundsAfterRetry }, branchGatewayCalls: cpDuring, retry: rAgain.status, payment: payAfter, audit: refundAudit.map((r) => [r.action, r.actor_user_id === staff.bea.id ? 'Bea' : r.actor_user_id]) };
  // Oct 28 2026 (Secure Tap audit §41 / §43, then Kevin's decision the same day — ttp-refund-processor.ts): a Tap to Pay
  // payment is refunded on the CommerceHub rail it was captured on, NEVER through the branch's card gateway. Permissions and
  // step-up are unchanged; the retried request (same key) sends nothing twice.
  check('S11', 'REFUND TRIO (§67) over HTTP on Bea\'s Tap to Pay payment: the RECEPTIONIST (even after her own step-up) is denied 403; BEA (manager) with a stale step-up → 403 STEP_UP_REQUIRED; after POST /auth/step-up the $5.00 refund goes to the Tap to Pay rail (ONE signed CommerceHub refund, nothing to the branch card gateway) and is recorded once; the retried request refunds nothing twice',
    !!payBea?.paymentId && rRec.status === 403 && rStale.status === 403 && code(rStale) === 'STEP_UP_REQUIRED' && ok2(beaSu.status) && ok2(rFresh.status)
      && chRefunds.length === 1 && chRefunds.every((c) => c.signed) && cpDuring === 0 && chRefundsAfterRetry === 1 && ok2(rAgain.status) && (payAfter?.refunded ?? 0) === 500,
    short(out.refund));

  // ══ S12 §77 the Customer Display follows the mobile payment (data captured around S5) ═══════════════════════════════
  const dText = (r) => JSON.stringify(r?.body ?? {});
  const amtB = rowsB[0]?.amt;
  out.display = { heartbeat: disp.heartbeat, busyFirst: disp.busy ?? null, send: disp.send?.status, before: [disp.before?.status, disp.before?.body?.state ?? disp.before?.body?.mode ?? null, dText(disp.before).includes(String(amtB))], after: [disp.after?.status, disp.after?.body?.state ?? disp.after?.body?.mode ?? null, dText(disp.after).slice(0, 300)], release: disp.release?.status, cleared: [disp.cleared?.status, disp.cleared?.body?.state ?? disp.cleared?.body?.mode ?? null] };
  const paidShown = /payment_success|completed|paid/i.test(String(disp.after?.body?.state ?? disp.after?.body?.mode ?? ''));
  check('S12', 'CUSTOMER DISPLAY (§77): the front desk sends Bea\'s guest to the display (its own credential shows the ticket total); the PHONE takes the payment; the display\'s projection turns to payment complete without the POS doing anything; the display releases → idle (no customer left on screen)',
    ok2(disp.send?.status) && disp.before?.status === 200 && dText(disp.before).includes(String(amtB)) && disp.after?.status === 200 && paidShown && ok2(disp.release?.status) && !dText(disp.cleared).includes(String(amtB)),
    short(out.display));

  // ══ S13 §75 one payment's audit trace, joined by the session it was taken in ══════════════════════════════════════
  const maxSess = (await q(`select id from sessions where tenant_id = $1 and device_id = $2 and user_id = $3 order by created_at limit 1`, [T, F.id, staff.max.id]))[0]?.id;
  const authRows = maxSess ? await q(`select event_type as e, occurred_at as at from auth_events where session_id::text = $1::text and event_type = 'LOGIN_SUCCEEDED'`, [maxSess]) : [];
  const auditRows = maxSess ? await q(`select action as e, occurred_at as at, resource_id, correlation_id from audit_events where tenant_id = $1 and session_id::text = $2::text and action = any($3) order by occurred_at, created_at`, [T, maxSess, ['checkout_payment_claimed', 'mobile_payment_initiated', 'tap_to_pay_session_minted', 'mobile_payment_completed', 'mobile_receipt_requested']]) : [];
  const trace = [...authRows, ...auditRows.filter((r) => r.resource_id === T1)].sort((a, b) => new Date(a.at) - new Date(b.at)).map((r) => r.e);
  const want = ['LOGIN_SUCCEEDED', 'checkout_payment_claimed', 'mobile_payment_initiated', 'tap_to_pay_session_minted', 'mobile_payment_completed', 'mobile_receipt_requested'];
  const inOrder = want.every((w, i) => trace.indexOf(w) >= 0 && (i === 0 || trace.indexOf(w) > trace.indexOf(want[i - 1])));
  out.trace = { ...out.trace, session: maxSess ? String(maxSess).slice(0, 8) : null, trace, correlation: [...new Set(auditRows.filter((r) => r.resource_id === T1).map((r) => r.correlation_id).filter(Boolean))].length };
  check('S13', 'AUDIT TRACE (§75): Max\'s payment on the front desk phone, joined by the ONE session it was taken in (auth_events + audit_events.session_id) — sign-in → claim → intent → provider session mint → completed → receipt, all present and in that order',
    !!maxSess && ok2(out.trace.receipt) && inOrder, short(out.trace));

  // ══ S14 §68 / §10 / §77 store switch on the shared phone: merchant + report context move with it ═════════════════════
  const s14 = {};
  const saSu = saStepUp ? await saStepUp() : 0;
  const mkBranch = async (name, n) => { const r = await sa.post('/super-admin/platform/branches', { tenantId: T, name: `${name} ${tag}`, address: `${n} Pilot Avenue`, city: 'Merchantville', state: 'NJ', zip: '08109', timezone: TZ, openingStatus: 'active', reason: 'Secure Tap pilot S14: a second location for the store switch' }); return { status: r.status, id: r.body?.id ?? r.body?.branchId ?? null, body: r.status >= 300 ? r.body : null }; };
  // names of their own: phase 11 (M5 transfer) already opened "Pilot Annex <tag>" in this salon, and a salon may not hold two
  // branches with one name — with phase 11 skipped (the Oct 26 S10–S14 run) the collision never showed (M7 full run)
  const BA = await mkBranch('Tap to Pay Annex', 31), BZ = await mkBranch('Tap to Pay Closed Annex', 37);
  // migration 704 (Kevin, Oct 28 2026): a location with its OWN merchant account takes Tap to Pay through its OWN CommerceHub
  // MID (ttpMerchantId) — it never falls back to the salon default (another account's money); without one the phone is
  // refused MERCHANT_NOT_CONFIGURED, which the Nov 6 full run showed
  const mid = (n) => ({ processorType: 'cardpointe', environment: 'sandbox', baseUrl: `https://${CP_HOST}/cardconnect/rest`, merchantId: n, apiUsername: 'pilotuser', apiPassword: 'pilot-pass-' + tag, status: 'active', ttpMerchantId: `CHTTP${n.slice(-6)}` });
  const mA = BA.id ? await sa.post(`/super-admin/tenants/${T}/payment-gateway/branches/${BA.id}`, mid('496160873999')) : { status: 0 };
  const mZ = BZ.id ? await sa.post(`/super-admin/tenants/${T}/payment-gateway/branches/${BZ.id}`, mid('496160873777')) : { status: 0 };
  const zOff = BZ.id ? await sa.post(`/super-admin/tenants/${T}/payment-gateway/branches/${BZ.id}/status`, { action: 'disable', reason: 'S14: this location may not take cards' }) : { status: 0 };
  const merchRows = await q(`select branch_id::text as b, id::text as id, status, merchant_id from payment_merchant_accounts where tenant_id = $1 and branch_id = any($2::uuid[])`, [T, [BA.id, BZ.id].filter(Boolean)]).catch((e) => [{ err: e.message }]);
  s14.setup = { saStepUp: saSu, annex: [BA.status, BA.body], closed: [BZ.status, BZ.body], merchants: [mA.status, mZ.status, zOff.status, short(zOff.status >= 300 ? zOff.body : zOff.body?.status)], rows: merchRows.map((r) => ({ b: r.b === BA.id ? 'annex' : 'closed', status: r.status, mid: r.merchant_id ? 'set' : null, err: r.err })) };
  // the owner signs in on the SHARED front desk phone (same device id + key)
  const FO = makePhone('front', F.label, true, F);
  const owner = { name: 'Owner', email: env.OWNER_EMAIL, password: OWNER_PW };
  const foIn = await FO.signIn(owner);
  const sel = (b) => FO.s.post('/auth/select-branch', { branchId: b, deviceId: F.id });
  const selUnauth = await sel(BA.id);   // the phone is not authorized for the annex yet
  await ownerStepUp();
  const brSet = await own.post(`/mobile-checkout/devices/${F.id}/branches`, { branchIds: [B, BA.id, BZ.id].filter(Boolean) });
  const selStale = await sel(BA.id);    // authorized now — but no fresh step-up on THIS session
  const foSu = await FO.s.post('/auth/step-up', { password: OWNER_PW });
  const selClosed = await sel(BZ.id);   // fresh step-up, but that location's merchant is disabled
  const selOk = await sel(BA.id);
  const swAudit = await q(`select action, metadata from audit_events where tenant_id = $1 and action ilike '%branch_switch%' and (metadata->>'deviceId' = $2 or metadata::text like '%' || $2 || '%') order by occurred_at desc limit 3`, [T, F.id]).catch(() => []);
  const swAuth = await q(`select event_type from auth_events where tenant_id = $1 and event_type ilike '%BRANCH%' and occurred_at > now() - interval '5 minutes' order by occurred_at desc limit 3`, [T]).catch(() => []);
  s14.switch = { ownerSignIn: foIn.ok ? 200 : foIn, unauthorized: [selUnauth.status, code(selUnauth)], branches: [brSet.status, (brSet.body?.allowedBranchIds ?? []).length], stale: [selStale.status, code(selStale)], stepUp: foSu.status, closed: [selClosed.status, code(selClosed)], ok: selOk.status, audit: swAudit.map((r) => r.action), authEvents: swAuth.map((r) => r.event_type) };
  check('S14', 'STORE SWITCH (§10 / §68) on the shared front desk phone (the owner signed in): to a location the PHONE is not authorized for → 403 DEVICE_BRANCH_NOT_AUTHORIZED; authorized (owner, step-up) but no fresh step-up on this session → 403 STEP_UP_REQUIRED; after the step-up, a location whose merchant is DISABLED → 409 MERCHANT_NOT_CONFIGURED (checked before switching); the annex with its own merchant → switched, audited',
    ok2(BA.status) && ok2(BZ.status) && ok2(mA.status) && ok2(mZ.status) && ok2(zOff.status) && foIn.ok && selUnauth.status === 403 && code(selUnauth) === 'DEVICE_BRANCH_NOT_AUTHORIZED' && ok2(brSet.status)
      && selStale.status === 403 && code(selStale) === 'STEP_UP_REQUIRED' && ok2(foSu.status) && selClosed.status === 409 && code(selClosed) === 'MERCHANT_NOT_CONFIGURED' && ok2(selOk.status) && swAudit.length >= 1,
    short({ setup: s14.setup, switch: s14.switch }));
  // a ticket at the annex: FIXTURE — T9 went through the queue + Tech App at the main location and is MOVED to the annex here
  // (a second location's staff / menu / queue are proven in phase 11; this step proves where the PHONE's money goes)
  let moved = null;
  try {
    await q(`update tickets set branch_id = $2 where tenant_id = $1 and id = $3`, [T, BA.id, T9]);
    await q(`update ticket_service_lines set branch_id = $2 where tenant_id = $1 and ticket_id = $3`, [T, BA.id, T9]);
    moved = 'ok';
  } catch (e) { moved = String(e?.message ?? e).slice(0, 200); }
  const capA = await FO.get(`/mobile-checkout/capability?deviceId=${F.id}`);
  const pA = moved === 'ok' ? await payOn(FO, T9) : null;
  if (pA) await release(FO, pA);
  const rowA = (await q(`select p.branch_id::text as b, p.status, p.amount_cents::int as amt, p.created_by_user_id::text as u, p.device_id, a.merchant_account_id::text as mac from payments p left join payment_attempts a on a.tenant_id = p.tenant_id and a.idempotency_key = $2 where p.ticket_id = $1 and p.method = 'card'`, [T9, pA?.key ?? '']).catch((e) => [{ err: e.message }]))[0];
  const annexMerchant = merchRows.find((r) => r.b === BA.id)?.id ?? null;
  const histAnnex = await FO.get('/mobile-checkout/payments?surface=tap_to_pay_iphone&limit=200');
  const histMain = await own.get('/mobile-checkout/payments?surface=tap_to_pay_iphone&limit=200');
  const inList = (h) => (h.body?.items ?? []).find((x) => x.paymentId === pA?.paymentId);
  const chMid = chargesFor(pA?.sessionToken)[0]?.body?.merchantDetails ?? null;
  const mainMid = chCalls.find((c) => c.path === '/payments/v1/charges' && c.body?.source?.session && c.body.source.session !== pA?.sessionToken)?.body?.merchantDetails ?? null;
  const sameChMid = !!chMid && JSON.stringify(chMid) === JSON.stringify(mainMid);
  s14.payment = { moved, capability: [capA.status, capA.body?.state ?? capA.body?.status], pay: pA && [pA.lock, pA.proceed, pA.attempt?.slice(0, 2), pA.ready, pA.capture?.slice(0, 3)], payRefusal: pA?.attempt?.[2] ?? pA?.lockBody ?? null, row: rowA && { ...rowA, b: rowA.b === BA.id ? 'annex' : rowA.b === B ? 'MAIN' : rowA.b, mac: rowA.mac === annexMerchant ? 'annex merchant' : rowA.mac, u: rowA.u === env.OWNER_ID ? 'owner' : rowA.u ? 'set' : null },
    reportAnnex: inList(histAnnex) && { branchId: inList(histAnnex).branchId === BA.id ? 'annex' : inList(histAnnex).branchId, deviceLabel: inList(histAnnex).deviceLabel, employee: inList(histAnnex).employeeName }, reportMain: !!inList(histMain), commerceHubMerchantDetails: !chMid ? 'none sent' : sameChMid ? 'the SAME CommerceHub merchant as the main location (one MID from the environment)' : 'a different CommerceHub merchant' };
  check('S14', 'after the switch the phone\'s MONEY is the annex\'s: a payment taken there is PAID with its row in the ANNEX, the intent records the ANNEX\'s own merchant account (PaymentGatewayResolver for the new location), the owner\'s report in the annex lists it (device label, employee) and the main location\'s report does not',
    moved === 'ok' && ok2(pA?.capture?.[0]) && pA?.capture?.[1] === 'confirmed' && rowA?.b === BA.id && rowA?.status === 'approved' && !!annexMerchant && rowA?.mac === annexMerchant
      && !!inList(histAnnex) && inList(histAnnex).branchId === BA.id && !inList(histMain),
    short(s14.payment));
  if (!chMid || sameChMid) info('S14 NOTE (an external gap, not a failure here): the CommerceHub Tap to Pay charge itself carries no per-location merchant — the adapter uses ONE CommerceHub merchant from the environment (COMMERCEHUB_TTP_MERCHANT_ID); the per-location account is recorded on the intent and the payment. Per-location CommerceHub MIDs need Fiserv onboarding per location.');
  out.s14 = s14;
  void mgr;
}
