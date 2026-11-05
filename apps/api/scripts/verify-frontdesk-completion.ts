/* verify-frontdesk-completion.ts — proves the extended front-desk completion flow over real Postgres (PGlite): the
 * customer picks a payment method on the iPad (card vs cash, which changes the total via the card surcharge), it's
 * recorded on the session, and the front desk's session model now surfaces the confirmed total + method + state so they
 * can complete the sale on the POS. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService, DisplayError } from '../src/customer-display/customer-display.service';
import { KyselyCheckoutRepository } from '../../../modules/checkout/src/checkout/checkout.kysely.repository';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const threw = async (fn: () => Promise<any>, code: string): Promise<boolean> => { try { await fn(); return false; } catch (e) { return e instanceof DisplayError && e.code === code; } };

const T = '00000000-0000-0000-0000-00000fd11501', B1 = '00000000-0000-0000-0000-00000fd1b501';
const C = '00000000-0000-0000-0000-00000fd1c501', TK = '00000000-0000-0000-0000-00000fd17c01';
const DEV = '00000000-0000-0000-0000-00000fd1de01', S = '00000000-0000-0000-0000-00000fd15e01';
const tok = 'fd_tok'; const hash = createHash('sha256').update(tok).digest('hex');
const devTok = 'fd_dev'; const devHash = createHash('sha256').update(devTok).digest('hex');
const cctx: any = { tenantId: T, branchId: B1, userId: 'u1', role: 'owner', permissions: [] };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  const server = new PGLiteSocketServer({ db, port: 5496, host: '127.0.0.1' }); await server.start();
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5496/postgres' }) }) });

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','FD LLC','FD Salon','fd','FD')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active')`);
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'payments-checkout','{"creditCardSurchargeEnabled":true,"creditCardSurchargePercent":3,"surchargeLabel":"Card Surcharge","customerDisplayMode":"customer_pays"}')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Sam','Le','Sam Le','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout','021',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Gel Mani',10000,45,'percent',0,10000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) VALUES ('${DEV}','${T}','${B1}','Lobby iPad','ipad','paired','${devHash}')`);
  await db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${S}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,NULL, now() + interval '20 minutes')`);

  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k), undefined as any);
  const checkout = new KyselyCheckoutRepository(k);

  // 1) card vs cash recompute (card adds the 3% surcharge; cash does not)
  const card: any = await svc.submitMethod(S, tok, 'card');
  ok('card selected → total includes surcharge (11098) + method card', card?.totals?.totalDueCents === 11098 && card?.totals?.surchargeCents === 323 && card?.totals?.paymentMethod === 'card', `${card?.totals?.totalDueCents}/${card?.totals?.surchargeCents}/${card?.totals?.paymentMethod}`);
  const cash: any = await svc.submitMethod(S, tok, 'cash');
  ok('cash selected → no surcharge (10775) + method cash', cash?.totals?.totalDueCents === 10775 && cash?.totals?.surchargeCents === 0 && cash?.totals?.paymentMethod === 'cash', `${cash?.totals?.totalDueCents}/${cash?.totals?.surchargeCents}/${cash?.totals?.paymentMethod}`);

  // 2) recorded on the session row
  const row: any = await k.selectFrom('customer_display_sessions').selectAll().where('id', '=', S).executeTakeFirst();
  ok('session row records payment_method=cash + total_due_cents=10775', row?.payment_method === 'cash' && Number(row?.total_due_cents) === 10775, `${row?.payment_method}/${row?.total_due_cents}`);

  // 3) the FRONT DESK now sees the confirmed total + method on its session model
  const posView: any = await checkout.getSession(cctx, S);
  ok('front desk session model surfaces totalDueCents (10775) + paymentMethod (cash)', posView?.totalDueCents === 10775 && posView?.paymentMethod === 'cash', `${posView?.totalDueCents}/${posView?.paymentMethod}`);

  // 4) only card/cash are customer-selectable
  ok('gift_card is rejected (front-desk-only method)', await threw(() => svc.submitMethod(S, tok, 'gift_card'), 'invalid'));
  ok('a bogus method is rejected', await threw(() => svc.submitMethod(S, tok, 'crypto'), 'invalid'));

  // 5) device mode: method selection via the device token
  const dCard: any = await svc.submitMethodForDevice(devTok, 'card');
  ok('device-mode method selection works (card, 11098)', dCard?.totals?.paymentMethod === 'card' && dCard?.totals?.totalDueCents === 11098, `${dCard?.totals?.paymentMethod}/${dCard?.totals?.totalDueCents}`);

  // 6) the completion handoff: customer confirms → payment_processing, and the front desk sees state + total + method
  await svc.submitMethod(S, tok, 'cash');
  const paying: any = await svc.requestPayment(S, tok);
  ok('customer confirms → payment_processing', paying?.state === 'payment_processing', String(paying?.state));
  const posAfter: any = await checkout.getSession(cctx, S);
  ok('front desk prompt data complete: state=payment_processing, total=10775, method=cash', posAfter?.state === 'payment_processing' && posAfter?.totalDueCents === 10775 && posAfter?.paymentMethod === 'cash', `${posAfter?.state}/${posAfter?.totalDueCents}/${posAfter?.paymentMethod}`);

  // 7) failure path: a declined front-desk charge flips the kiosk off the spinner to "failed" (derived from the authoritative payment record — no checkout→display coupling)
  await db.exec(`INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}','card',10775,0,'declined')`);
  const failed: any = await svc.getState(S, tok);
  ok('declined charge while on the payment screen → kiosk shows payment_failed (no infinite spinner)', failed?.state === 'payment_failed', String(failed?.state));

  // guard: that same stale decline must NOT make the *review* screen look failed
  await db.exec(`UPDATE customer_display_sessions SET state='showing_ticket' WHERE id='${S}'`);
  const reviewing: any = await svc.getState(S, tok);
  ok('a stale decline during review does not falsely show failed (stays ticket_review)', reviewing?.state === 'ticket_review', String(reviewing?.state));
  await db.exec(`UPDATE customer_display_sessions SET state='payment_processing' WHERE id='${S}'`);

  // a later successful charge (ticket marked paid) wins over the prior decline
  await db.exec(`UPDATE tickets SET status='paid' WHERE id='${TK}'`);
  const success: any = await svc.getState(S, tok);
  ok('a later successful charge (ticket paid) → payment_success (paid wins over the decline)', success?.state === 'payment_success', String(success?.state));

  await k.destroy(); await server.stop(); await db.close();
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-frontdesk-completion: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
