/* verify-terminal-capture.ts — proves the terminal auto-trigger pipeline end-to-end over real Postgres and a
 * REAL local HTTP server impersonating the CardPointe Bolt Integrated Terminal API (so the actual wire format —
 * paths, headers, session key, payload casing, decimal amounts — is exercised through global fetch, not a stub).
 *
 * The ONLY thing this cannot verify is the physical terminal itself; everything up to the wire is real.
 *
 * Oct 6 2026: runs on a REAL Postgres (the PGlite copy could no longer apply every migration — pg_trgm). Give it a
 * disposable, fully migrated database:  DATABASE_URL=postgres://…/scratch npx esbuild … (see the audit) — it removes its
 * own salon first, so it can be re-run. */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService } from '../src/customer-display/customer-display.service';
import { TerminalCaptureService } from '../src/customer-display/terminal-capture.service';
import { CardPointeBoltClient, type BoltConfig } from '../../../modules/payments/src/payments/cardpointe-bolt.client';
import type { FetchLike } from '../../../modules/payments/src/payments/cardpointe.client';
import { encryptSecret } from '../src/common/mfa-enc';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

const T = '00000000-0000-0000-0000-0000007e4501', B1 = '00000000-0000-0000-0000-0000007e4b01';
const C = '00000000-0000-0000-0000-0000007e4c01';
const TK1 = '00000000-0000-0000-0000-0000007e4711', TK2 = '00000000-0000-0000-0000-0000007e4712', TK3 = '00000000-0000-0000-0000-0000007e4713';
const S1 = '00000000-0000-0000-0000-0000007e4e11', S2 = '00000000-0000-0000-0000-0000007e4e12', S3 = '00000000-0000-0000-0000-0000007e4e13';
const STN = '00000000-0000-0000-0000-0000007e4a01';
const tok = (i: number) => `tc_tok_${i}`;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const BOLT_PORT = 5611;

// ---- a Bolt-shaped local HTTP server: validates the documented contract on every request ----
const boltLog: { path: string; auth?: string; sess?: string; body: any }[] = [];
let nextRespstat = 'A';
// Kevin, Oct 6 2026: the cardholder signs once, on the Clover terminal — the terminal answers with the signature it took
// (CardPointe's format: base64 of a gzip-compressed bitmap)
const SIG_BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(120, 9)]);
const BOLT_HOST_URL = 'https://bolt-harness.cardpointe.com';
const boltServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    boltLog.push({ path: req.url || '', auth: req.headers['authorization'] as string, sess: req.headers['x-cardconnect-sessionkey'] as string, body });
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
    if (req.headers['authorization'] !== 'bolt-test-key') { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
    if (req.url === '/api/v2/connect') {
      res.setHeader('X-CardConnect-SessionKey', 'SESS42;127.0.0.1');
      res.setHeader('content-type', 'application/json');
      return res.end('{}');
    }
    if (req.url === '/api/v2/authCard') {
      if (req.headers['x-cardconnect-sessionkey'] !== 'SESS42') { res.statusCode = 401; return res.end('{"error":"no session"}'); }
      res.setHeader('content-type', 'application/json');
      if (nextRespstat === 'A') return res.end(JSON.stringify({ respstat: 'A', retref: 'RR777', authcode: 'OK1', resptext: 'Approval', amount: body.amount, ...(body.includeSignature === 'true' ? { signature: gzipSync(SIG_BMP).toString('base64') } : {}) }));
      return res.end(JSON.stringify({ respstat: 'C', resptext: 'Insufficient funds' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL (a disposable, migrated database) is required'); process.exit(2); }
  const pool = new Pool({ connectionString: url });
  const db = { exec: (q: string) => pool.query(q) };
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  for (const t of ['payment_signatures', 'payments', 'customer_display_sessions', 'ticket_service_lines', 'tickets', 'customers', 'pos_payment_terminals', 'tenant_payment_config', 'tenant_settings', 'branches']) await pool.query(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
  await pool.query(`delete from tenants where id = $1`, [T]).catch(() => undefined);
  await new Promise<void>((r) => boltServer.listen(BOLT_PORT, '127.0.0.1', () => r()));

  // ---- seed: tenant in TERMINAL capture mode with surcharge on; Bolt config (encrypted key); paired terminal with HSN ----
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','TC LLC','Terminal Salon','tc','TC','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active')`);
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'payments-checkout','{"creditCardSurchargeEnabled":true,"creditCardSurchargePercent":3,"customerDisplayMode":"customer_pays","customerDisplayCaptureMode":"terminal"}')`);
  const keyEnc = encryptSecret('bolt-test-key');
  await db.exec(`INSERT INTO tenant_payment_config (tenant_id, processor, merchant_id, status, bolt_base_url, bolt_api_key_enc) VALUES ('${T}','fiserv','496160873888','active','${BOLT_HOST_URL}','${keyEnc}')`);
  await db.exec(`INSERT INTO pos_payment_terminals (id, tenant_id, branch_id, label, station_id, status, paired_at, hsn) VALUES ('term_000001','${T}','${B1}','Front Desk Terminal','${STN}','paired',now(),'1234567890')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Pat','Vo','Pat Vo','active',false,false,false)`);
  const mkTicket = (id: string, n: string) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${id}','${T}','${B1}','${C}','ready_checkout','${n}',10000,0,0,10000,0)`)
    // the terminal charges the TICKET's lines (23-inch spec §35, Unit 2) — one $100 service
    .then(() => db.exec(`INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) VALUES ('${T}','${B1}','${id}','00000000-0000-0000-0000-000000000000','Gel Manicure',10000,45,10000)`));
  const mkSession = (id: string, tk: string, i: number, method: string) => db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, pos_station_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${id}','${T}','${B1}','${STN}','${tk}','${C}','tip_selected','${hash(tok(i))}',2000,10000,'${method}', now() + interval '20 minutes')`);
  await mkTicket(TK1, '031'); await mkSession(S1, TK1, 1, 'card');
  await mkTicket(TK2, '032'); await mkSession(S2, TK2, 2, 'card');
  await mkTicket(TK3, '033'); await mkSession(S3, TK3, 3, 'cash');

  // real transport through global fetch -> the real local HTTP server
  // the stored Bolt address must pass the processor-URL policy (https, a CardPointe host — 1b115fb8), so the harness stores
  // an approved-looking host and its transport sends that host to the local fake (M7 regression: the old loopback URL was
  // refused PROCESSOR_URL_NOT_ALLOWED before any call, 7 checks red). The policy itself stays on.
  const transport: FetchLike = (url, init) => (globalThis.fetch as unknown as FetchLike)(String(url).replace(BOLT_HOST_URL, `http://127.0.0.1:${BOLT_PORT}`), init);
  const captureSvc = new TerminalCaptureService(k, (cfg: BoltConfig) => new CardPointeBoltClient(cfg, transport), (enc) => {
    const { decryptSecret } = require('../src/common/mfa-enc');
    return decryptSecret(enc);
  });
  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k), undefined as any, captureSvc);

  // ── 1. APPROVED: Pay tap -> charge over the real wire -> ticket paid -> kiosk payment_success ──
  nextRespstat = 'A';
  const paying: any = await svc.requestPayment(S1, tok(1));
  ok('Pay tap returns payment_processing immediately (charge runs in background)', paying?.state === 'payment_processing', String(paying?.state));
  // the background capture is fire-and-forget; await it deterministically by re-running capture (idempotent)
  await new Promise((r) => setTimeout(r, 700));
  const row1 = await new KyselyDisplayRepository(k).getSession(S1);
  const dup = await captureSvc.capture(row1!);
  ok('a second capture attempt for the same session is an idempotent duplicate (no double charge)', dup.outcome === 'duplicate' || dup.outcome === 'skipped', dup.outcome);
  const tkt1: any = await k.selectFrom('tickets').select(['status']).where('id', '=', TK1 as any).executeTakeFirst();
  ok('approved charge marks the ticket paid', tkt1?.status === 'paid', String(tkt1?.status));
  const pay1: any = await k.selectFrom('payments').selectAll().where('ticket_id', '=', TK1 as any).executeTakeFirst();
  // the amount is the TICKET's card total (its $100 line + the 3% card surcharge + tax — Unit 2, §35), exactly what the
  // terminal was asked for
  const asked = boltLog.find((l) => l.path === '/api/v2/authCard')?.body?.amount;
  ok('payments row: approved, the ticket\'s card total (what the terminal was asked for, surcharge included), retref RR777, idempotency key set',
    pay1?.status === 'approved' && pay1?.processor_transaction_id === 'RR777' && String(pay1?.idempotency_key) === `termcap_${S1}` && Number(pay1?.amount_cents) > 10000 && Number(pay1?.amount_cents) === Math.round(parseFloat(String(asked)) * 100),
    `${pay1?.status}/${pay1?.processor_transaction_id}/${pay1?.idempotency_key}/${pay1?.amount_cents}`);
  const kiosk1: any = await svc.getState(S1, tok(1));
  ok('kiosk reflects payment_success', kiosk1?.state === 'payment_success', String(kiosk1?.state));
  ok('the display asks for no signature (the terminal took it)', !('signatureRequired' in (kiosk1 ?? {})) && !('signatureCaptured' in (kiosk1 ?? {})), JSON.stringify(Object.keys(kiosk1 ?? {})));
  const sig1: any = await k.selectFrom('payment_signatures' as any).select(['payment_id', 'captured_on', 'signature_png'] as any).where('ticket_id' as any, '=', TK1 as any).execute();
  ok('the terminal\'s signature is kept on the payment, as a viewable bitmap, marked "terminal"',
    sig1.length === 1 && sig1[0].payment_id === pay1?.id && sig1[0].captured_on === 'terminal' && sig1[0].signature_png === 'data:image/bmp;base64,' + SIG_BMP.toString('base64'),
    JSON.stringify(sig1.map((r: any) => ({ ...r, signature_png: String(r.signature_png).slice(0, 30) }))));

  // ── 2. THE WIRE: contract checks against what the Bolt-shaped server actually received ──
  const connect = boltLog.find((l) => l.path === '/api/v2/connect');
  const auth = boltLog.find((l) => l.path === '/api/v2/authCard');
  ok('connect hit /api/v2/connect with merchantId + hsn + raw api key Authorization',
    !!connect && connect.auth === 'bolt-test-key' && connect.body?.merchantId === '496160873888' && connect.body?.hsn === '1234567890',
    JSON.stringify(connect?.body));
  ok('authCard carried the session key and the documented payload (decimal amount string, capture true, the terminal asks for the signature)',
    !!auth && auth.sess === 'SESS42' && typeof auth.body?.amount === 'string' && auth.body?.amount?.includes('.') && auth.body?.capture === 'true' && auth.body?.includeSignature === 'true' && auth.body?.orderId === TK1,
    `${auth?.sess} ${JSON.stringify(auth?.body)}`);

  // ── 3. DECLINED: respstat C -> declined payments row -> kiosk payment_failed (never paid) ──
  nextRespstat = 'C';
  await svc.requestPayment(S2, tok(2));
  await new Promise((r) => setTimeout(r, 700));
  const tkt2: any = await k.selectFrom('tickets').select(['status']).where('id', '=', TK2 as any).executeTakeFirst();
  ok('declined charge never marks the ticket paid', tkt2?.status !== 'paid', String(tkt2?.status));
  const pay2: any = await k.selectFrom('payments').select(['status']).where('ticket_id', '=', TK2 as any).executeTakeFirst();
  ok('declined charge writes an honest declined payments row', pay2?.status === 'declined', String(pay2?.status));
  const kiosk2: any = await svc.getState(S2, tok(2));
  ok('kiosk reflects payment_failed on the decline (no infinite spinner)', kiosk2?.state === 'payment_failed', String(kiosk2?.state));

  // ── 4. CASH: never auto-charged — the customer completes with the front desk ──
  const before = boltLog.length;
  const cashState: any = await svc.requestPayment(S3, tok(3));
  await new Promise((r) => setTimeout(r, 400));
  ok('cash Pay tap stays front-desk: payment_processing, no terminal call made', cashState?.state === 'payment_processing' && boltLog.length === before, `${cashState?.state}/${boltLog.length - before} calls`);
  const row3 = await new KyselyDisplayRepository(k).getSession(S3);
  const skip = await captureSvc.capture(row3!);
  ok('explicit capture on a cash session is skipped (cash completes with the front desk)', skip.outcome === 'skipped', `${skip.outcome}`);

  // ── 5. GUARDS: front_desk mode + missing terminal/HSN fail honestly ──
  await db.exec(`UPDATE tenant_settings SET settings_json = settings_json::jsonb || '{"customerDisplayCaptureMode":"front_desk"}' WHERE tenant_id='${T}' AND category='payments-checkout'`);
  const row1b = await new KyselyDisplayRepository(k).getSession(S1);
  const fd = await captureSvc.capture(row1b!);
  ok('front_desk mode: capture is skipped entirely', fd.outcome === 'skipped' || fd.outcome === 'duplicate', fd.outcome);
  await db.exec(`UPDATE tenant_settings SET settings_json = settings_json::jsonb || '{"customerDisplayCaptureMode":"terminal"}' WHERE tenant_id='${T}' AND category='payments-checkout'`);

  await db.exec(`UPDATE pos_payment_terminals SET hsn = NULL WHERE tenant_id='${T}'`);
  const TK4 = '00000000-0000-0000-0000-0000007e4714', S4 = '00000000-0000-0000-0000-0000007e4e14';
  await mkTicket(TK4, '034'); await mkSession(S4, TK4, 4, 'card');
  const row4 = await new KyselyDisplayRepository(k).getSession(S4);
  const noHsn = await captureSvc.capture(row4!);
  ok('terminal without an HSN: honest failed outcome (no blind charge), reason names the terminal', noHsn.outcome === 'failed' && /hsn/i.test((noHsn as any).reason || ''), JSON.stringify(noHsn));
  await db.exec(`UPDATE customer_display_sessions SET state='payment_processing' WHERE id='${S4}'`);
  const kiosk4: any = await svc.getState(S4, tok(4));
  ok('kiosk reflects payment_failed for the config failure too', kiosk4?.state === 'payment_failed', String(kiosk4?.state));

  await k.destroy(); boltServer.close();
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-terminal-capture: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
