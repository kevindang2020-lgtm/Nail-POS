// realtime-drive.mjs — the POS live-update client in REAL Chromium against a REAL SSE endpoint (Smooth Refresh spec §3,
// §17, §42–§44, §59–§61, §110–§113). Run: npm run perf:realtime -w apps/pos-web (after the harness build; perf:realtime
// builds it). Exits NON-ZERO on any failed expectation, printing which.
//
// The server below speaks the gateway's frame format: `data: {event, seq, stream?, payload:{eventId, resourceType,
// resourceId, version, sentAt}}` — hello = {event:'connected', seqs:{r0:N}}. Each scenario writes frames and checks what
// the page's real useRealtime('booking') did.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = `${base}/${d}/${sub}`; if (existsSync(p)) return p; }
  }
  return undefined;
}
const root = process.env.PERF_DIST || '/tmp/booking-perf-dist';
let stream = null;                 // the current SSE response
const connects = [];               // { at, lastEventId }
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/realtime/stream')) {
    connects.push({ at: Date.now(), lastEventId: req.headers['last-event-id'] ?? null });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ event: 'connected', seqs: { r0: 0 } })}\n\n`);
    stream = res; req.on('close', () => { if (stream === res) stream = null; });
    return;
  }
  if (req.url.startsWith('/realtime/presence')) { res.writeHead(204); return res.end(); }
  const p = path.join(root, req.url === '/' ? 'realtime-harness.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const port = srv.address().port;
const send = (seq, event, payload = {}, extra = {}) => stream?.write(`id: r0:${seq}\ndata: ${JSON.stringify({ event, seq, payload: { sentAt: Date.now(), ...payload }, ...extra })}\n\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));
const rt = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rt)));
const results = []; const expect = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

await page.goto(`http://127.0.0.1:${port}/`);
for (let i = 0; i < 50 && !stream; i++) await wait(100);
expect('browser opened the SSE stream', !!stream, `${connects.length} connect(s)`);
await wait(300);
let s = await rt(); const base = s.refetches;

// 1. a live event → exactly one refetch (coalesced), delivered well under a second
send(1, 'appointment_updated', { eventId: 'e1', resourceType: 'appointment', resourceId: 'a1', version: 2 });
await wait(600); s = await rt();
expect('§3/§17 live event → one refetch', s.refetches === base + 1, `refetches +${s.refetches - base}`);
expect('§3 delivery < 1 s (server write → browser dispatch)', s.deliveries.length >= 1 && s.deliveries[0] < 1000, `${s.deliveries[0]} ms`);

// 2. the same frame again (same seq + eventId) → ignored
send(1, 'appointment_updated', { eventId: 'e1', resourceType: 'appointment', resourceId: 'a1', version: 2 });
await wait(600); let s2 = await rt();
expect('§59 duplicate frame ignored', s2.refetches === s.refetches, `refetches +${s2.refetches - s.refetches}`);

// 3. an OLDER version of the same resource (new seq) → ignored
send(2, 'appointment_updated', { eventId: 'e2', resourceType: 'appointment', resourceId: 'a1', version: 1 });
await wait(600); let s3 = await rt();
expect('§60 older version ignored', s3.refetches === s2.refetches, `refetches +${s3.refetches - s2.refetches}`);

// 4. sequence gap (3 missing, 4 arrives) → reconcile ('sequence_gap') → refetch, no reload
send(4, 'appointment_updated', { eventId: 'e4', resourceType: 'appointment', resourceId: 'a2', version: 5 });
await wait(600); let s4 = await rt();
expect('§61 sequence gap → background resync', s4.reconciles.includes('sequence_gap') && s4.refetches > s3.refetches, `reconciles=${s4.reconciles.join(',')}`);

// 5. server-requested resync → refetch
send(5, 'resync_required', {}, { reason: 'sequence_gap', seqs: { r0: 5 } });
await wait(400); let s5 = await rt();
expect('§26/§27 resync_required → snapshot refetch', s5.refetches > s4.refetches, `refetches +${s5.refetches - s4.refetches}`);

// 6. the server drops the connection → the client reconnects on its own and reconciles (spec §42/§43)
const connectsBefore = connects.length; const dropAt = Date.now(); stream?.destroy(); stream = null;
for (let i = 0; i < 80 && connects.length === connectsBefore; i++) await wait(100);
await wait(800); let s6 = await rt();
const reconnectMs = connects.length > connectsBefore ? connects[connectsBefore].at - dropAt : Infinity;
expect('§43 reconnects after a dropped stream', connects.length > connectsBefore, `reconnected ${reconnectMs} ms after the drop`);
expect('§43 first retry within the ~1 s first backoff step (0.5–1 s + connect)', reconnectMs <= 1500, `${reconnectMs} ms`);
expect('§42 reconnect → immediate refetch (never assumes nothing was missed)', s6.reconciles.includes('reconnected') && s6.refetches > s5.refetches, `reconciles=${s6.reconciles.join(',')}`);
expect('status went RECONNECTING → CONNECTED', s6.statuses.includes('RECONNECTING') && s6.statuses[s6.statuses.length - 1] === 'CONNECTED', s6.statuses.join('→'));

// 7. live again after the reconnect (new hello baselined the sequence)
const before7 = s6.refetches;
send(1, 'appointment_created', { eventId: 'e7', resourceType: 'appointment', resourceId: 'a9', version: 1 });
await wait(600); const s7 = await rt();
expect('live after reconnect', s7.refetches === before7 + 1, `refetches +${s7.refetches - before7}`);

expect('no page errors', pageErrors.length === 0 && s7.errors.length === 0, [...pageErrors, ...s7.errors].join(' | ') || 'none');
await browser.close(); srv.close();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ chromium: browser.version(), deliveriesMs: s7.deliveries, connects: connects.length }));
if (failed.length) { console.error(`REALTIME BROWSER CHECK FAILED: ${failed.length} expectation(s)`); process.exit(1); }
console.log('realtime browser check: OK');
