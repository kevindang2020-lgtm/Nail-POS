// api-load-test.mjs — Constitution 5 §231 "Load tests pass" / §232.40 "actual measured results": the HTTP API itself,
// end to end (Express → guards → interceptors → service → Postgres → serializer), under concurrent load.
//
// The three older harnesses (copilot, ai-booking, booking-verification) drive SERVICES directly; none measured the API
// a client actually calls. This one signs in as a real user and drives the hot read paths of a salon's day with a fixed
// number of concurrent clients for a fixed time, then reports throughput, p50/p95/p99 per endpoint and EVERY non-2xx
// (a 429 from the rate limiter is reported, not hidden — under real load it is the limiter doing its job).
//
// Usage: API_URL=http://127.0.0.1:3031 node scripts/api-load-test.mjs [concurrency=10] [seconds=15]
//        LOGIN='{"portal":"tenant","salonCode":"PALACE","identifier":"owner@palace.test","password":"…"}'
// Exit 1 when any 5xx occurs or p95 exceeds P95_BUDGET_MS (default 500).
const BASE = process.env.API_URL || 'http://127.0.0.1:3031';
const C = Number(process.argv[2] || 10), SECONDS = Number(process.argv[3] || 15);
const BUDGET = Number(process.env.P95_BUDGET_MS || 500);
const LOGIN = process.env.LOGIN || JSON.stringify({ portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });

// A browser sign-in answers with session cookies (the bearer token is only returned to native clients), so the harness
// takes either: the token when present, else the cookies. SELECT_BRANCH=<branch uuid> selects a branch for POS reads.
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: LOGIN });
const cookiesOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
let jar = cookiesOf(login);
const token = (await login.json().catch(() => ({}))).accessToken;
if (!token && !jar.length) { console.error(`login failed (${login.status}) — set LOGIN to a valid account`); process.exit(2); }
if (process.env.SELECT_BRANCH) {
  const sel = await fetch(`${BASE}/auth/select-branch`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { cookie: jar.join('; ') }) }, body: JSON.stringify({ branchId: process.env.SELECT_BRANCH }) });
  const more = cookiesOf(sel); const keys = new Set(more.map((c) => c.split('=')[0]));
  jar = [...jar.filter((c) => !keys.has(c.split('=')[0])), ...more];
  if (sel.status !== 200) { console.error(`select-branch failed (${sel.status})`); process.exit(2); }
}
const auth = token ? { Authorization: `Bearer ${token}` } : { cookie: jar.join('; ') };

const list = await (await fetch(`${BASE}/api/v1/pos/customers?pageSize=20`, { headers: auth })).json();
const customerId = list?.items?.[0]?.customerId;
const ENDPOINTS = [
  ['GET /api/v1/pos/customers (page)', '/api/v1/pos/customers?pageSize=20'],
  ['GET /api/v1/pos/customers/:id (ETag)', customerId ? `/api/v1/pos/customers/${customerId}` : null],
  ['GET /api/v1/pos/checkout/state', '/api/v1/pos/checkout/state'],
  ['GET /api/v1/pos/booking/appointments', '/api/v1/pos/booking/appointments'],
  ['GET /health/ready (no auth)', '/health/ready'],
].filter(([, p]) => p);

const stats = new Map(ENDPOINTS.map(([n]) => [n, { ms: [], codes: {} }]));
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const deadline = Date.now() + SECONDS * 1000;
let i = 0;
async function client() {
  while (Date.now() < deadline) {
    const [name, path] = ENDPOINTS[i++ % ENDPOINTS.length]; const s = stats.get(name);
    const t = performance.now();
    try {
      const r = await fetch(BASE + path, { headers: path.startsWith('/health') ? {} : auth }); await r.arrayBuffer();
      s.ms.push(performance.now() - t); s.codes[r.status] = (s.codes[r.status] || 0) + 1;
    } catch (e) { s.codes.NETWORK = (s.codes.NETWORK || 0) + 1; }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: C }, client));
const elapsed = (Date.now() - started) / 1000;

let total = 0, fivexx = 0, worstP95 = 0; const all = [];
console.log(`\nHTTP load — ${C} concurrent clients × ${SECONDS}s against ${BASE}\n`);
console.log('endpoint'.padEnd(40), 'reqs'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), '  status codes');
for (const [name, s] of stats) {
  const a = s.ms.sort((x, y) => x - y); all.push(...a); total += a.length;
  const p95 = pct(a, 0.95); worstP95 = Math.max(worstP95, p95);
  for (const [k, v] of Object.entries(s.codes)) if (String(k).startsWith('5') || k === 'NETWORK') fivexx += v;
  console.log(name.padEnd(40), String(a.length).padStart(6), `${pct(a, 0.5).toFixed(0)}ms`.padStart(7), `${p95.toFixed(0)}ms`.padStart(7), `${pct(a, 0.99).toFixed(0)}ms`.padStart(7), ' ', JSON.stringify(s.codes));
}
all.sort((x, y) => x - y);
console.log(`\nRESULT: requests=${total} throughput=${(total / elapsed).toFixed(1)} req/s p50=${pct(all, 0.5).toFixed(0)}ms p95=${pct(all, 0.95).toFixed(0)}ms p99=${pct(all, 0.99).toFixed(0)}ms 5xx/network=${fivexx} worst-endpoint-p95=${worstP95.toFixed(0)}ms (budget ${BUDGET}ms)`);
const ok = fivexx === 0 && worstP95 <= BUDGET;
console.log(ok ? 'API_LOAD_OK' : 'API_LOAD_FAIL');
process.exit(ok ? 0 : 1);
