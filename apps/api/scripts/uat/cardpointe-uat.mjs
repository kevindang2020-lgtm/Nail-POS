#!/usr/bin/env node
// cardpointe-uat.mjs — the repeatable CardPointe (Fiserv) UAT check: "make sure you can communicate with our gateway",
// then a test-card sale, its void, and (optionally) an amount-driven decline from the RPCT emulator — the evidence for
// Fiserv's validation form. Reads the same variables the API's env fallback uses; NEVER put the values in the repo.
//
//   CARDPOINTE_BASE_URL=https://isv-uat.cardconnect.com/cardconnect/rest CARDPOINTE_MERCHID=… CARDPOINTE_USERNAME=… \
//   CARDPOINTE_PASSWORD=… node scripts/uat/cardpointe-uat.mjs [--decline-amount 1500.00]  (RPCT: $1000–$1999, last 3 whole-dollar digits = respcode)
//   + BOLT_BASE_URL=https://bolt-uat.cardpointe.com/api BOLT_AUTH_KEY=… to list the registered terminals and whether each is online [--card 4111111111111111 --expiry 1229]
//
// Prints one line per step and exits 1 on the first failure. Charges: one sale that is voided in the same run.
const env = process.env;
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const base = (env.CARDPOINTE_BASE_URL || '').replace(/\/+$/, '').replace(/\/cardconnect\/rest$/i, '');
const merchid = env.CARDPOINTE_MERCHID, user = env.CARDPOINTE_USERNAME, pass = env.CARDPOINTE_PASSWORD;
if (!base || !merchid || !user || !pass) { console.error('set CARDPOINTE_BASE_URL, CARDPOINTE_MERCHID, CARDPOINTE_USERNAME, CARDPOINTE_PASSWORD'); process.exit(2); }
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const card = arg('--card', '4111111111111111'), expiry = arg('--expiry', '1229'), declineAmount = arg('--decline-amount', null);

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const step = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) process.exit(1); };

// 1. reachability + credentials + MID, charge-free
const inq = await call('GET', `/cardconnect/rest/inquireMerchant/${encodeURIComponent(merchid)}`);
step('inquireMerchant', inq.status === 200 && inq.json?.enabled === true, inq.json ? `site ${inq.json.site}, processor ${inq.json.cardproc}, avs ${inq.json.avs}, cvv ${inq.json.cvv}` : `HTTP ${inq.status}`);

// 2. a card-not-present sale with the sandbox test card (ecomind 'E' — Fiserv's stated requirement for CNP)
const sale = await call('PUT', '/cardconnect/rest/auth', { merchid, account: card, expiry, amount: '1.00', currency: 'USD', capture: 'Y', ecomind: 'E', name: 'UAT Test', orderid: `APS-UAT-${Date.now()}` });
step('auth (sale $1.00, CNP)', sale.status === 200 && sale.json?.respstat === 'A', sale.json ? `respstat ${sale.json.respstat} ${sale.json.resptext}, retref ${sale.json.retref}, token ${sale.json.token ? 'issued' : 'none'}` : `HTTP ${sale.status}`);

// 3. its void (the gateway must reverse what it approved)
const v = await call('PUT', '/cardconnect/rest/void', { merchid, retref: sale.json.retref });
step('void', v.status === 200 && v.json?.respstat === 'A', v.json ? `${v.json.resptext}` : `HTTP ${v.status}`);

// 4. an amount-driven decline from the RPCT emulator (pick the amount from Fiserv's response-code table)
if (declineAmount) {
  const d = await call('PUT', '/cardconnect/rest/auth', { merchid, account: card, expiry, amount: declineAmount, currency: 'USD', capture: 'Y', ecomind: 'E', orderid: `APS-UAT-DECL-${Date.now()}` });
  step(`auth (expected decline at $${declineAmount})`, d.status === 200 && d.json?.respstat === 'C', d.json ? `respstat ${d.json.respstat}, respcode ${d.json.respcode}, ${d.json.resptext}` : `HTTP ${d.status}`);
}
// 5. the Bolt terminal service (optional): BOLT_BASE_URL + BOLT_AUTH_KEY -> the registered terminals, and whether each is online
if (env.BOLT_BASE_URL && env.BOLT_AUTH_KEY) {
  const bolt = env.BOLT_BASE_URL.replace(/\/+$/, '').replace(/\/api$/i, '');
  const bres = await fetch(bolt + '/api/v2/listTerminals', { method: 'POST', headers: { Authorization: env.BOLT_AUTH_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ merchantId: merchid }) });
  const bj = await bres.json().catch(() => null);
  step('bolt listTerminals', bres.status === 200 && Array.isArray(bj?.terminals), bj?.terminals ? `${bj.terminals.length} registered: ${bj.terminals.join(', ')}` : `HTTP ${bres.status}`);
  for (const hsn of bj?.terminals ?? []) {
    const c = await fetch(bolt + '/api/v2/connect', { method: 'POST', headers: { Authorization: env.BOLT_AUTH_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ merchantId: merchid, hsn, force: true }) });
    const t = await c.text();
    console.log(`INFO  terminal ${hsn}: ${c.status === 200 ? 'ONLINE (session opened)' : 'offline — ' + (JSON.parse(t)?.errorMessage ?? t).slice(0, 80)}`);
  }
}
console.log('\nUAT round trip complete.');
