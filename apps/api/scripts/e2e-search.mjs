import { signSession } from '../dist/auth/auth-session-token.js';
const SECRET = 'e2esecret';
const BASE = 'http://127.0.0.1:4599';
const A = { tenantId:'aaaaaaaa-0000-0000-0000-000000000001', branchId:'aaaaaaaa-0000-0000-0000-0000000000b1', userId:'aaaaaaaa-0000-0000-0000-0000000000c1' };
const B = { tenantId:'bbbbbbbb-0000-0000-0000-000000000002', branchId:'bbbbbbbb-0000-0000-0000-0000000000b2', userId:'bbbbbbbb-0000-0000-0000-0000000000c2' };
const cookie = (t) => 'aps_session=' + signSession({ userId:t.userId, tenantId:t.tenantId, branchId:t.branchId, role:'OWNER', permissions:['global_search.use'], subscriptionStatus:'active' }, { secret: SECRET });
const search = async (c) => { const r = await fetch(BASE+'/pos/search?q=ZephyrE2E', { headers: c ? { Cookie: c } : {} }); let b=null; try{b=await r.json();}catch{} return { status:r.status, body:b }; };
const names = (res) => (res.body?.groups?.customers || []).map(x => x.full_name || x.name || x.title || JSON.stringify(x));

let fail = 0;
// 1) unauthenticated -> must be rejected by the guard
const noauth = await search(null);
const rejected = noauth.status === 401 || noauth.status === 403;
console.log(`1) no session        -> HTTP ${noauth.status}  ${rejected ? '✓ rejected by guard' : '✗ NOT rejected'}`);
if (!rejected) fail++;

// 2) tenant A session -> only tenant A's customer
const ra = await search(cookie(A));
const aNames = names(ra);
const aOk = ra.status === 200 && aNames.some(n => /ZephyrE2E A/.test(n)) && !aNames.some(n => /ZephyrE2E B/.test(n));
console.log(`2) tenant A session  -> HTTP ${ra.status}  customers: [${aNames.join(', ')}]  ${aOk ? '✓ sees only A' : '✗'}`);
if (!aOk) fail++;

// 3) tenant B session -> only tenant B's customer (isolation through the real HTTP path)
const rb = await search(cookie(B));
const bNames = names(rb);
const bOk = rb.status === 200 && bNames.some(n => /ZephyrE2E B/.test(n)) && !bNames.some(n => /ZephyrE2E A/.test(n));
console.log(`3) tenant B session  -> HTTP ${rb.status}  customers: [${bNames.join(', ')}]  ${bOk ? '✓ sees only B' : '✗'}`);
if (!bOk) fail++;

console.log('\n' + (fail === 0 ? 'E2E_SEARCH_OK — guards enforce auth; each tenant sees only its own data through the live HTTP path.' : `E2E_SEARCH_FAIL (${fail})`));
process.exit(fail ? 1 : 0);
