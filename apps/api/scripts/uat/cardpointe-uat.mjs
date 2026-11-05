#!/usr/bin/env node
// cardpointe-uat.mjs — the repeatable CardPointe (Fiserv) UAT run: the scenarios on Fiserv's validation form, run against
// the UAT gateway with rotated UAT keys, and a sanitized evidence file to attach. Reads the same variables the API's env
// fallback uses; NEVER put the values in the repo, a Postman collection, a screenshot, or the evidence.
//
//   CARDPOINTE_BASE_URL=https://isv-uat.cardconnect.com CARDPOINTE_MERCHID=… CARDPOINTE_USERNAME=… CARDPOINTE_PASSWORD=… \
//   node scripts/uat/cardpointe-uat.mjs [--evidence uat-evidence.json] [--decline-amount 1500.00] [--card <UAT test card> --expiry 1229]
//   + BOLT_BASE_URL=https://bolt-uat.cardpointe.com BOLT_AUTH_KEY=… to check the registered terminals (online / offline)
//   + --terminal-sale <HSN> [--terminal-amount 1.00] to run one sale on the Clover Compact (someone must tap a UAT card)
//
// Refuses any host that is not a UAT host. One line per scenario; exit 1 if any required scenario fails.
// Evidence holds outcomes only: respstat/respcode/resptext, masked retref, amounts, fee fields. Never a PAN, token,
// CVV, password, merchant key or Authorization header.
import { writeFileSync } from 'node:fs';

const env = process.env;
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const base = (env.CARDPOINTE_BASE_URL || '').replace(/\/+$/, '').replace(/\/cardconnect\/rest$/i, '');
const merchid = env.CARDPOINTE_MERCHID, user = env.CARDPOINTE_USERNAME, pass = env.CARDPOINTE_PASSWORD;
if (!base || !merchid || !user || !pass) { console.error('set CARDPOINTE_BASE_URL, CARDPOINTE_MERCHID, CARDPOINTE_USERNAME, CARDPOINTE_PASSWORD'); process.exit(2); }
const isUat = (u) => /(^|\.|-)(uat|sandbox|test|cert)[.-]/i.test(new URL(u).hostname) || /-uat\./i.test(new URL(u).hostname);
if (!isUat(base)) { console.error(`refusing ${new URL(base).hostname}: not a UAT host. No live transactions until Fiserv certification.`); process.exit(2); }
if (env.BOLT_BASE_URL && !isUat(env.BOLT_BASE_URL)) { console.error('refusing BOLT_BASE_URL: not a UAT host'); process.exit(2); }

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const card = arg('--card', '4111111111111111'), expiry = arg('--expiry', '1229');
const declineAmount = arg('--decline-amount', null), evidencePath = arg('--evidence', null);
const terminalHsn = arg('--terminal-sale', null), terminalAmount = arg('--terminal-amount', '1.00');
const runId = `APS-UAT-${Date.now()}`;
const evidence = { runId, startedAt: new Date().toISOString(), gatewayHost: new URL(base).hostname, scenarios: [] };
let failed = 0;

const mask = (v) => (v ? String(v).replace(/.(?=.{4})/g, '•') : null);
const outcome = (j) => (j ? { respstat: j.respstat, respcode: j.respcode, resptext: j.resptext, retref: mask(j.retref), amount: j.amount, authcode: j.authcode ? 'present' : null, fee_amount: j.fee_amount ?? null, fee_type: j.fee_type ?? null, fee_value: j.fee_value ?? null } : null);

async function call(method, path, body, host = base, authz = auth) {
  const res = await fetch(host + path, { method, headers: { Authorization: authz, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
function record(id, name, ok, detail, data, { required = true } = {}) {
  const tag = ok ? 'PASS' : required ? 'FAIL' : 'NOTE';
  console.log(`${tag}  ${id} ${name}${detail ? ' — ' + detail : ''}`);
  evidence.scenarios.push({ id, name, result: tag, detail: detail ?? null, response: data ?? null });
  if (!ok && required) failed++;
  return ok;
}
const auth$ = (extra) => call('PUT', '/cardconnect/rest/auth', { merchid, account: card, expiry, currency: 'USD', ecomind: 'E', name: 'UAT Test', ...extra });

// S1 reachability + credentials + MID (charge-free)
const inq = await call('GET', `/cardconnect/rest/inquireMerchant/${encodeURIComponent(merchid)}`);
if (!record('S1', 'inquireMerchant', inq.status === 200 && inq.json?.enabled === true, inq.json ? `processor ${inq.json.cardproc}, avs ${inq.json.avs}, cvv ${inq.json.cvv}` : `HTTP ${inq.status}`)) finish();

// S2 CNP sale + S3 inquire by orderid (the app's verify-with-processor path) + S4 void
const s2 = await auth$({ amount: '1.00', capture: 'Y', orderid: `${runId}-S2` });
record('S2', 'sale $1.00 card-not-present (ecomind E)', s2.json?.respstat === 'A', s2.json ? `${s2.json.respstat} ${s2.json.resptext}` : `HTTP ${s2.status}`, outcome(s2.json));
const s3 = await call('GET', `/cardconnect/rest/inquireByOrderid/${encodeURIComponent(`${runId}-S2`)}/${encodeURIComponent(merchid)}/1`);
const s3row = Array.isArray(s3.json) ? s3.json[0] : s3.json;
record('S3', 'inquireByOrderid finds S2', s3.status === 200 && !!s3row?.retref, s3row ? `found, ${s3row.resptext ?? s3row.setlstat ?? ''}` : `HTTP ${s3.status}`, outcome(s3row));
if (s2.json?.retref) {
  const s4 = await call('PUT', '/cardconnect/rest/void', { merchid, retref: s2.json.retref });
  record('S4', 'void S2', s4.json?.respstat === 'A', s4.json?.resptext, outcome(s4.json));
}

// S5 auth then capture (two-step) + S6 refund of the capture (UAT may hold it unsettled; a "void instead" answer is acceptable)
const s5 = await auth$({ amount: '2.00', capture: 'N', orderid: `${runId}-S5` });
if (record('S5', 'auth $2.00 then capture', s5.json?.respstat === 'A', s5.json?.resptext, outcome(s5.json)) && s5.json.retref) {
  const cap = await call('PUT', '/cardconnect/rest/capture', { merchid, retref: s5.json.retref, amount: '2.00' });
  record('S5b', 'capture', cap.status === 200 && !!cap.json?.setlstat, cap.json ? `setlstat ${cap.json.setlstat}` : `HTTP ${cap.status}`, outcome(cap.json));
  const ref = await call('PUT', '/cardconnect/rest/refund', { merchid, retref: s5.json.retref, amount: '2.00' });
  const refOk = ref.json?.respstat === 'A';
  record('S6', 'refund of S5', refOk, ref.json?.resptext, outcome(ref.json), { required: false });
  if (!refOk) { const v = await call('PUT', '/cardconnect/rest/void', { merchid, retref: s5.json.retref }); record('S6b', 'void S5 (unsettled, so refund not allowed yet)', v.json?.respstat === 'A', v.json?.resptext, outcome(v.json)); }
}

// S7 decline from the RPCT emulator (amount picks the response code)
if (declineAmount) {
  const d = await auth$({ amount: declineAmount, capture: 'Y', orderid: `${runId}-S7` });
  record('S7', `expected decline at $${declineAmount}`, d.json?.respstat === 'C', d.json ? `respcode ${d.json.respcode} ${d.json.resptext}` : `HTTP ${d.status}`, outcome(d.json));
}

// S8 saved card with consent: create profile (cof C, cofscheduled N) → MIT charge on the profile (cof M) → delete profile
const prof = await call('PUT', '/cardconnect/rest/profile', { merchid, account: card, expiry, name: 'UAT Test', profileupdate: 'Y' });
const profileid = prof.json?.profileid, acctid = prof.json?.acctid;
if (record('S8', 'create stored profile', prof.status === 200 && !!profileid, prof.json ? `${prof.json.resptext ?? 'created'}` : `HTTP ${prof.status}`, prof.json ? { respstat: prof.json.respstat, resptext: prof.json.resptext } : null)) {
  const cit = await call('PUT', '/cardconnect/rest/auth', { merchid, profile: `${profileid}/${acctid ?? 1}`, amount: '1.00', currency: 'USD', capture: 'Y', ecomind: 'E', cof: 'C', cofscheduled: 'N', orderid: `${runId}-S8a` });
  record('S8a', 'customer-initiated charge on profile (cof C)', cit.json?.respstat === 'A', cit.json?.resptext, outcome(cit.json));
  const mit = await call('PUT', '/cardconnect/rest/auth', { merchid, profile: `${profileid}/${acctid ?? 1}`, amount: '1.00', currency: 'USD', capture: 'Y', ecomind: 'R', cof: 'M', cofscheduled: 'Y', orderid: `${runId}-S8b` });
  record('S8b', 'scheduled merchant-initiated charge (cof M, membership renewal)', mit.json?.respstat === 'A', mit.json?.resptext, outcome(mit.json));
  for (const r of [cit.json?.retref, mit.json?.retref].filter(Boolean)) await call('PUT', '/cardconnect/rest/void', { merchid, retref: r });
  const del = await call('DELETE', `/cardconnect/rest/profile/${encodeURIComponent(profileid)}/${acctid ?? ''}/${encodeURIComponent(merchid)}`);
  record('S8c', 'delete stored profile', del.status === 200, del.json?.resptext ?? `HTTP ${del.status}`);
}

// S9 surcharge: the gateway, not the app, decides the fee. Reports what UAT returns; not a pass/fail until Ryan confirms enrollment.
const sur = await auth$({ amount: '10.00', capture: 'Y', orderid: `${runId}-S9` });
const fee = sur.json?.fee_amount;
record('S9', 'surcharge returned by gateway', !!fee && Number(fee) > 0, fee ? `fee_amount ${fee} (${sur.json.fee_type ?? '?'} ${sur.json.fee_value ?? ''})` : 'no fee fields — merchant not enrolled in surcharging on UAT', outcome(sur.json), { required: false });
if (sur.json?.retref) await call('PUT', '/cardconnect/rest/void', { merchid, retref: sur.json.retref });

// S10 Bolt / Clover Compact
if (env.BOLT_BASE_URL && env.BOLT_AUTH_KEY) {
  const bolt = env.BOLT_BASE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');
  const b = (path, body, session) => fetch(bolt + path, { method: 'POST', headers: { Authorization: env.BOLT_AUTH_KEY, 'Content-Type': 'application/json', ...(session ? { 'X-CardConnect-SessionKey': session } : {}) }, body: JSON.stringify({ merchantId: merchid, ...body }) });
  const lt = await b('/api/v2/listTerminals', {});
  const lj = await lt.json().catch(() => null);
  record('S10', 'bolt listTerminals', lt.status === 200 && Array.isArray(lj?.terminals), lj?.terminals ? `${lj.terminals.length} registered` : `HTTP ${lt.status}`, { terminals: (lj?.terminals ?? []).map(mask) });
  for (const hsn of lj?.terminals ?? []) {
    const c = await b('/api/v2/connect', { hsn, force: false }); // force:false — never kick a live checkout off the device
    const session = (c.headers.get('x-cardconnect-sessionkey') || '').split(';')[0];
    record('S10', `terminal ${mask(hsn)} online`, c.status === 200, c.status === 200 ? 'session opened' : `HTTP ${c.status}`, null, { required: false });
    if (c.status !== 200) continue;
    if (hsn === terminalHsn) {
      const wire = String(Math.round(Number(terminalAmount) * 100)); // Bolt amounts are implied decimals: "100" = $1.00
      console.log(`WAIT  tap a UAT card on ${mask(hsn)} for $${terminalAmount}…`);
      const ac = await b('/api/v3/authCard', { hsn, amount: wire, capture: true, includeSignature: false, orderId: `${runId}-S11` }, session);
      const aj = await ac.json().catch(() => null);
      const got = aj?.amount != null ? Math.round(Number(aj.amount) * (String(aj.amount).includes('.') ? 100 : 1)) : null;
      record('S11', `Compact sale $${terminalAmount}`, aj?.respstat === 'A' && got === Number(wire), aj ? `${aj.respstat} ${aj.resptext}; device charged ${got ?? '?'} cents (expected ${wire})` : `HTTP ${ac.status}`, outcome(aj));
      if (aj?.retref) await call('PUT', '/cardconnect/rest/void', { merchid, retref: aj.retref });
    }
    await b('/api/v2/disconnect', { hsn }, session);
  }
}
finish();

function finish() {
  evidence.finishedAt = new Date().toISOString();
  evidence.failed = failed;
  if (evidencePath) { writeFileSync(evidencePath, JSON.stringify(evidence, null, 2)); console.log(`\nevidence → ${evidencePath} (sanitized: no card, token, key or password)`); }
  console.log(failed ? `\n${failed} required scenario(s) failed.` : '\nAll required UAT scenarios passed.');
  process.exit(failed ? 1 : 0);
}
