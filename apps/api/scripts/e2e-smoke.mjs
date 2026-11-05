import { signSession } from '../dist/auth/auth-session-token.js';
const SECRET = 'e2esecret', BASE = 'http://127.0.0.1:4599';
const A = { tenantId:'aaaaaaaa-0000-0000-0000-000000000001', branchId:'aaaaaaaa-0000-0000-0000-0000000000b1', userId:'aaaaaaaa-0000-0000-0000-0000000000c1' };
const PERMS = ['global_search.use','pos.overview.view','pos.queue.view','pos.checkout.view','pos.technicians.view'];
const cookie = (t) => 'aps_session=' + signSession({ userId:t.userId, tenantId:t.tenantId, branchId:t.branchId, role:'OWNER', permissions:PERMS, subscriptionStatus:'active' }, { secret: SECRET });
const ENDPOINTS = [
  ['GET /pos/search',                          '/pos/search?q=ZephyrE2E'],
  ['GET /pos/overview/state',                  '/pos/overview/state'],
  ['GET /pos/overview/board',                  '/pos/overview/board'],
  ['GET /pos/queue/state',                     '/pos/queue/state'],
  ['GET /pos/checkout/state',                  '/pos/checkout/state'],
  ['GET /pos/technicians/live-schedule/state', '/pos/technicians/live-schedule/state'],
];
const hit = async (path, c) => { try { const r = await fetch(BASE+path, { headers: c ? { Cookie: c } : {} }); return r.status; } catch (e) { return 'ERR'; } };
let fail = 0;
console.log('endpoint                                      no-auth   authed   verdict');
for (const [label, path] of ENDPOINTS) {
  const noauth = await hit(path, null);
  const authed = await hit(path, cookie(A));
  const ok = (noauth === 401 || noauth === 403) && authed === 200;
  if (!ok) fail++;
  console.log(`${label.padEnd(44)} ${String(noauth).padEnd(9)} ${String(authed).padEnd(8)} ${ok ? '✓' : '✗'}`);
}
console.log('\n' + (fail === 0 ? 'E2E_SMOKE_OK — every endpoint rejects anonymous requests and serves an authenticated tenant (200) through the real guards.' : `E2E_SMOKE_FAIL (${fail})`));
process.exit(fail ? 1 : 0);
