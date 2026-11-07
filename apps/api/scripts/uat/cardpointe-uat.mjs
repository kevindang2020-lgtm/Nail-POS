#!/usr/bin/env node
// cardpointe-uat.mjs — Fiserv CardPointe UAT validation runner (Fiserv master build §13). Runs the scenarios of Fiserv's
// Integration Validation form (https://form.jotform.com/232564140390046) against the UAT gateway / Bolt with ROTATED UAT
// keys, and writes the evidence in the PDF's certification schema (JSON + CSV). Re-check the form's amounts on submission
// day — Fiserv may change them — and only submit scenarios that actually passed.
//
//   CARDPOINTE_BASE_URL=https://isv-uat.cardconnect.com  CARDPOINTE_MERCHID=…  CARDPOINTE_USERNAME=…  CARDPOINTE_PASSWORD=…
//   node scripts/uat/cardpointe-uat.mjs --evidence uat-evidence [--lanes cnp,surcharge,tip,void,refund,cp]
//
//   Card not present (CNP): use tokens from the REAL hosted iFrame (Customer App → Add card in UAT, or the tokenizer page)
//     --visa-token <token> --amex-token <token> [--expiry MMYY]
//     Without them the runner falls back to Fiserv's public UAT test cards and records frontend_flow_confirmed = false:
//     that proves the gateway, NOT the hosted iFrame flow (§19) — rerun with tokens before submitting.
//   Card present (CP, Clover Compact): BOLT_BASE_URL=https://bolt-uat.cardpointe.com BOLT_AUTH_KEY=… --terminal <HSN>
//     [--bolt-version v3|v4]   (v3 until Ryan confirms v4; his Postman starter uses v4 for surcharge). Someone taps a UAT
//     test card for each CP scenario.
//   Refund: UAT transactions settle overnight — pass --refund-retref <retref of a SETTLED UAT sale> (else NOT_RUN).
//   --reviewer "Rahul" --tenant-id … --branch-id …   (labels written into the evidence)
//
// Statuses (PDF §18): PASS_WITH_RETREF / EXPECTED_DECLINE / FAIL / SKIPPED / NOT_RUN. Refuses any non-UAT host.
// Evidence holds outcomes, amounts and retrefs (the form asks for retrefs). Never a card number, token, CVV, password,
// Authorization key or session key; the MID and HSN are masked.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const env = process.env;
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const base = (env.CARDPOINTE_BASE_URL || '').replace(/\/+$/, '').replace(/\/cardconnect\/rest$/i, '');
const merchid = env.CARDPOINTE_MERCHID, user = env.CARDPOINTE_USERNAME, pass = env.CARDPOINTE_PASSWORD;
if (!base || !merchid || !user || !pass) { console.error('set CARDPOINTE_BASE_URL, CARDPOINTE_MERCHID, CARDPOINTE_USERNAME, CARDPOINTE_PASSWORD'); process.exit(2); }
export const isUatHost = (u) => { const h = new URL(u).hostname.toLowerCase(); return /(^|[.-])(uat|sandbox|test|cert)([.-])/.test(h); };
if (!isUatHost(base)) { console.error(`refusing ${new URL(base).hostname}: not a UAT host. No live transactions until Fiserv certification.`); process.exit(2); }
if (env.BOLT_BASE_URL && !isUatHost(env.BOLT_BASE_URL)) { console.error('refusing BOLT_BASE_URL: not a UAT host'); process.exit(2); }

const lanes = new Set((arg('--lanes', 'cnp,surcharge,tip,void,refund,cp')).split(','));
const evidencePath = arg('--evidence');
const expiry = arg('--expiry', '1229');
const visaToken = arg('--visa-token'), amexToken = arg('--amex-token');
// Fiserv's published UAT test cards (fallback only — never a real card)
const VISA_TEST = '4111111111111111', AMEX_TEST = '371449635398431';
const terminal = arg('--terminal'), boltVersion = arg('--bolt-version', 'v3') === 'v4' ? 'v4' : 'v3';
const refundRetref = arg('--refund-retref');
const runId = `APS-UAT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const mask = (v) => (v ? String(v).replace(/.(?=.{4})/g, '•') : '');
const cents = (d) => (d == null || d === '' ? null : Math.round(Number(String(d).replace(/,/g, '')) * 100));
let sha = ''; try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }

const COLUMNS = ['test_case_id', 'integration_lane', 'environment', 'build_commit_sha', 'uat_mid_masked', 'tenant_id', 'branch_id', 'terminal_hsn_masked',
  'expected_amount_cents', 'actual_amount_cents', 'expected_result', 'actual_result', 'status', 'provider_retref', 'fee_amount_cents', 'fee_type', 'respcode', 'resptext',
  'timestamp_utc', 'screenshot_ref', 'frontend_flow_confirmed', 'approval_or_decline_verified', 'reviewer', 'notes', 'blocker', 'remediation_commit'];
const rows = [];
function record(r) {
  const row = Object.fromEntries(COLUMNS.map((c) => [c, '']));
  Object.assign(row, { environment: 'uat', build_commit_sha: sha, uat_mid_masked: mask(merchid), tenant_id: arg('--tenant-id', ''), branch_id: arg('--branch-id', ''),
    timestamp_utc: new Date().toISOString(), reviewer: arg('--reviewer', ''), screenshot_ref: '', remediation_commit: '' }, r);
  rows.push(row);
  console.log(`${row.status.padEnd(16)} ${row.test_case_id.padEnd(22)} ${row.integration_lane.padEnd(9)} $${((row.expected_amount_cents || 0) / 100).toFixed(2).padStart(9)}  ${row.provider_retref ? 'retref ' + row.provider_retref : ''} ${row.blocker ? '⚠ ' + row.blocker : row.notes || ''}`.trimEnd());
  return row;
}

async function gw(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
/** approval_or_decline_verified: the gateway's own record of this retref agrees with what the authorization said */
async function verify(retref, expectApproved, expectCents) {
  if (!retref) return false;
  const r = await gw('GET', `/cardconnect/rest/inquire/${encodeURIComponent(retref)}/${encodeURIComponent(merchid)}`);
  const j = r.json; if (!j) return false;
  const approved = j.respstat === 'A';
  return approved === expectApproved && (expectCents == null || cents(j.amount) === expectCents);
}

/** One gateway scenario. expect = 'approve' | 'decline' */
async function cnp(id, lane, dollars, expect, { account, viaFrame, postal, capture = 'Y', notes = '', requireFee = false } = {}) {
  const expectedCents = cents(dollars);
  const r = await gw('PUT', '/cardconnect/rest/auth', { merchid, account, expiry, amount: dollars, currency: 'USD', capture, ecomind: 'E', orderid: `${runId}-${id}`, ...(postal ? { postal } : {}) });
  const j = r.json || {};
  const approved = j.respstat === 'A', declined = j.respstat === 'C';
  const noFee = requireFee && approved && !j.fee_type;   // surcharge scenario approved WITHOUT a provider-assessed fee
  const ok = (expect === 'approve' ? approved : declined) && !noFee;
  const verified = j.retref ? await verify(j.retref, approved, approved ? cents(j.amount) : null) : false;
  return record({ test_case_id: id, integration_lane: lane, expected_amount_cents: expectedCents, actual_amount_cents: cents(j.amount),
    expected_result: expect === 'approve' ? 'APPROVED' : 'DECLINED', actual_result: approved ? 'APPROVED' : declined ? 'DECLINED' : (j.respstat ? `RETRY(${j.respstat})` : `HTTP ${r.status}`),
    status: ok ? (expect === 'approve' ? (j.retref ? 'PASS_WITH_RETREF' : 'FAIL') : 'EXPECTED_DECLINE') : 'FAIL',
    provider_retref: j.retref || '', fee_amount_cents: j.fee_amount != null ? cents(j.fee_amount) : '', fee_type: j.fee_type || '', respcode: j.respcode || '', resptext: j.resptext || '',
    frontend_flow_confirmed: String(!!viaFrame), approval_or_decline_verified: String(verified),
    notes: [notes, !viaFrame && lane !== 'tip' && lane !== 'void' ? 'gateway only — rerun with a hosted-iFrame token before submitting' : ''].filter(Boolean).join('; '),
    blocker: noFee ? 'approved but no fee_amount/fee_type returned — MID not enrolled in the Merchant Surcharge Program on UAT? (ask Ryan, §9.8)'
      : !ok && expect === 'decline' && !j.retref ? 'no retref on the decline — ask Ryan how to document it (§13)' : '', _json: j });
}

// ── 0. reachability: credentials + MID, charge-free ──
const inq = await gw('GET', `/cardconnect/rest/inquireMerchant/${encodeURIComponent(merchid)}`);
if (!(inq.status === 200 && inq.json?.enabled === true)) {
  console.error(`inquireMerchant failed (HTTP ${inq.status}) — check the UAT credentials / MID with Ryan. Nothing was charged.`); process.exit(1);
}
console.log(`gateway OK (${new URL(base).hostname}), MID ${mask(merchid)}, build ${sha || '?'}, run ${runId}\n`);

const visa = { account: visaToken || VISA_TEST, viaFrame: !!visaToken };
const amex = { account: amexToken || AMEX_TEST, viaFrame: !!amexToken };

// ── card not present (§13) ──
if (lanes.has('cnp')) {
  await cnp('CNP-VISA-932', 'cnp', '9.32', 'approve', visa);
  await cnp('CNP-VISA-110035', 'cnp', '1100.35', 'decline', visa);
  await cnp('CNP-AMEX-932', 'cnp', '9.32', 'approve', amex);
}
// ── surcharge, card not present (needs the MID enrolled; the gateway returns fee_amount / fee_type) ──
if (lanes.has('surcharge')) {
  for (const [id, dollars, postal] of [['SUR-CNP-900-19406', '9.00', '19406'], ['SUR-CNP-5000-06856', '50.00', '06856']]) await cnp(id, 'surcharge', dollars, 'approve', { ...visa, postal, requireFee: true });
}
// ── tip adjustment $125.56 + $10 against the SAME retref (§10). Method pending Ryan's confirmation: auth-only, then
//    capture at the higher amount. A rejection is recorded as FAIL with the gateway's answer, never retried blindly. ──
if (lanes.has('tip')) {
  const a = await cnp('TIP-12556-AUTH', 'tip', '125.56', 'approve', { ...visa, capture: 'N', notes: 'authorization only (step 1 of 2)' });
  if (a.provider_retref) {
    const c = await gw('PUT', '/cardconnect/rest/capture', { merchid, retref: a.provider_retref, amount: '135.56' });
    const j = c.json || {};
    const sameRef = j.retref === a.provider_retref;
    const okCap = c.status === 200 && sameRef && cents(j.amount) === 13556;
    record({ test_case_id: 'TIP-12556-PLUS-1000', integration_lane: 'tip', expected_amount_cents: 13556, actual_amount_cents: cents(j.amount),
      expected_result: 'CAPTURED_WITH_TIP_SAME_RETREF', actual_result: c.status === 200 ? `setlstat ${j.setlstat || '?'}${sameRef ? '' : ' (different retref)'}` : `HTTP ${c.status}`,
      status: okCap ? 'PASS_WITH_RETREF' : 'FAIL', provider_retref: j.retref || a.provider_retref, respcode: j.respcode || '', resptext: j.resptext || '',
      frontend_flow_confirmed: 'false', approval_or_decline_verified: String(okCap && await verify(a.provider_retref, true, 13556)),
      notes: 'tip-adjust method (capture at higher amount) must be confirmed by Ryan', blocker: okCap ? '' : 'WAITING_FOR_FISERV: tip-adjustment endpoint / rules (§10)' });
  }
}
// ── void: a fresh sale, then void it by retref ──
if (lanes.has('void')) {
  const s = await cnp('VOID-SALE', 'void', '9.32', 'approve', { ...visa, notes: 'the sale that is voided next' });
  if (s.provider_retref) {
    const v = await gw('PUT', '/cardconnect/rest/void', { merchid, retref: s.provider_retref });
    const j = v.json || {};
    const ok = j.respstat === 'A';
    record({ test_case_id: 'VOID', integration_lane: 'void', expected_amount_cents: 932, actual_amount_cents: cents(j.amount), expected_result: 'VOIDED', actual_result: ok ? 'VOIDED' : (j.resptext || `HTTP ${v.status}`),
      status: ok ? 'PASS_WITH_RETREF' : 'FAIL', provider_retref: s.provider_retref, respcode: j.respcode || '', resptext: j.resptext || '', frontend_flow_confirmed: 'false', approval_or_decline_verified: String(ok) });
  }
}
// ── refund: of a SETTLED transaction (UAT settles overnight) ──
if (lanes.has('refund')) {
  if (!refundRetref) record({ test_case_id: 'REFUND', integration_lane: 'refund', expected_result: 'REFUNDED', status: 'NOT_RUN', notes: 'pass --refund-retref <retref of a settled UAT sale> (run the day after a sale)' });
  else {
    const rf = await gw('PUT', '/cardconnect/rest/refund', { merchid, retref: refundRetref });
    const j = rf.json || {};
    record({ test_case_id: 'REFUND', integration_lane: 'refund', actual_amount_cents: cents(j.amount), expected_result: 'REFUNDED', actual_result: j.respstat === 'A' ? 'REFUNDED' : (j.resptext || `HTTP ${rf.status}`),
      status: j.respstat === 'A' ? 'PASS_WITH_RETREF' : 'FAIL', provider_retref: j.retref || '', respcode: j.respcode || '', resptext: j.resptext || '', frontend_flow_confirmed: 'false',
      approval_or_decline_verified: String(j.respstat === 'A'), notes: `refund of ${refundRetref}` });
  }
}
// ── card present on the Clover Compact (§6 / §13): a person taps a UAT test card for each ──
if (lanes.has('cp')) {
  const CP = [['CP-100012', '1000.12', 'approve'], ['CP-110025', '1100.25', 'decline'], ['SUR-CP-900', '9.00', 'approve']];
  if (!env.BOLT_BASE_URL || !env.BOLT_AUTH_KEY || !terminal) {
    for (const [id, d] of CP) record({ test_case_id: id, integration_lane: id.startsWith('SUR') ? 'surcharge' : 'cp', expected_amount_cents: cents(d), status: 'NOT_RUN', blocker: 'needs BOLT_BASE_URL, BOLT_AUTH_KEY and --terminal <HSN from listTerminals>' });
  } else {
    const bolt = env.BOLT_BASE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');
    const b = (path, body, session) => fetch(bolt + path, { method: 'POST', headers: { Authorization: env.BOLT_AUTH_KEY, 'Content-Type': 'application/json', ...(session ? { 'X-CardConnect-SessionKey': session } : {}) }, body: JSON.stringify({ merchantId: merchid, ...body }) });
    const lt = await (await b('/api/v2/listTerminals', {})).json().catch(() => null);
    if (!lt?.terminals?.includes(terminal)) {
      for (const [id, d] of CP) record({ test_case_id: id, integration_lane: 'cp', expected_amount_cents: cents(d), status: 'NOT_RUN', terminal_hsn_masked: mask(terminal), blocker: `HSN not in Bolt listTerminals (${(lt?.terminals || []).length} registered) — WAITING_FOR_FISERV provisioning` });
    } else {
      const c = await b('/api/v2/connect', { hsn: terminal, force: false });   // never kick another session off the device
      const session = (c.headers.get('x-cardconnect-sessionkey') || '').split(';')[0];
      if (c.status !== 200 || !session) {
        for (const [id, d] of CP) record({ test_case_id: id, integration_lane: 'cp', expected_amount_cents: cents(d), status: 'FAIL', terminal_hsn_masked: mask(terminal), blocker: `connect failed (HTTP ${c.status}) — terminal offline or busy` });
      } else {
        try {
          for (const [id, d, expect] of CP) {
            console.log(`WAIT   tap a UAT test card on the Compact for $${d} (${id})…`);
            const res = await b(`/api/${boltVersion}/authCard`, { hsn: terminal, amount: String(cents(d)), capture: true, includeSignature: false, orderId: `${runId}-${id}` }, session);
            const j = await res.json().catch(() => ({}));
            const approved = j.respstat === 'A', declined = j.respstat === 'C';
            // Bolt answers in dollars ("1000.12") or implied cents depending on version — normalise like the app does
            const got = j.amount == null ? null : (String(j.amount).includes('.') ? cents(j.amount) : Number(j.amount));
            const lane = id.startsWith('SUR') ? 'surcharge' : 'cp';
            const noFee = lane === 'surcharge' && approved && !j.fee_type;
            const ok = (expect === 'approve' ? approved && got === cents(d) : declined) && !noFee;
            record({ test_case_id: id, integration_lane: lane, terminal_hsn_masked: mask(terminal), expected_amount_cents: cents(d), actual_amount_cents: got,
              expected_result: expect === 'approve' ? 'APPROVED' : 'DECLINED', actual_result: approved ? 'APPROVED' : declined ? 'DECLINED' : (j.errorMessage || `HTTP ${res.status}`),
              status: ok ? (expect === 'approve' ? 'PASS_WITH_RETREF' : 'EXPECTED_DECLINE') : 'FAIL', provider_retref: j.retref || '', respcode: j.respcode || '', resptext: j.resptext || '',
              fee_amount_cents: j.fee_amount != null ? cents(j.fee_amount) : '', fee_type: j.fee_type || '',
              frontend_flow_confirmed: 'false', approval_or_decline_verified: String(j.retref ? await verify(j.retref, approved, approved ? got : null) : false),
              notes: `Bolt ${boltVersion} authCard; the app's own POS Card → Compact path must also be shown (screenshot) before submitting`,
              blocker: noFee ? 'no fee returned by the terminal — Compact surcharge UX/fields unconfirmed (§9.8 Q3)' : '' });
          }
        } finally { await b('/api/v2/disconnect', { hsn: terminal }, session).catch(() => undefined); }
      }
    }
  }
}

// ── evidence ──
const clean = rows.map(({ _json, ...r }) => r);
const summary = clean.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log('\n' + Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join('  '));
if (evidencePath) {
  writeFileSync(`${evidencePath}.json`, JSON.stringify({ runId, gatewayHost: new URL(base).hostname, buildCommitSha: sha, summary, rows: clean }, null, 2));
  const esc = (v) => { const s = String(v ?? ''); const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  writeFileSync(`${evidencePath}.csv`, [COLUMNS.join(','), ...clean.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
  console.log(`evidence → ${evidencePath}.json / ${evidencePath}.csv (no card number, token, key or password; MID/HSN masked)`);
}
console.log('Submit to Fiserv only rows marked PASS_WITH_RETREF or EXPECTED_DECLINE, after Rahul checks each retref in UAT Reporting.');
process.exit(clean.some((r) => r.status === 'FAIL') ? 1 : 0);
