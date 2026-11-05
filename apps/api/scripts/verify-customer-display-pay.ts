/* verify-customer-display-pay.ts — proves the customer_pays device flow: the Pay affordance is gated to the configured
 * mode, a payment request moves the session to 'payment_processing' WITHOUT charging or touching card data, completion is
 * mirrored from the ticket's real status (→ payment_success once the POS marks it paid), and non-customer_pays modes
 * reject a pay request. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService } from '../src/customer-display/customer-display.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5489;
  const T = '00000000-0000-0000-0000-0000000f1501', B1 = '00000000-0000-0000-0000-0000000fb501', B2 = '00000000-0000-0000-0000-0000000fb502';
  const C = '00000000-0000-0000-0000-0000000fc501', TK = '00000000-0000-0000-0000-0000000f7c01', TK2 = '00000000-0000-0000-0000-0000000f7c02';
  const DEV = '00000000-0000-0000-0000-0000000fde01';
  const SP = '00000000-0000-0000-0000-0000000f5e01', ST = '00000000-0000-0000-0000-0000000f5e02';
  const token = 'tok_pay_999'; const hash = createHash('sha256').update(token).digest('hex');

  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pay LLC','Pay Salon','pay','PAY')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active'),('${B2}','${T}','Second','active')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Robin','Cho','Robin Cho','active',false,false,false)`);
  const ts = (cat: string, json: string, branch: string | null) =>
    `INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}',${branch ? `'${branch}'` : 'NULL'},'${cat}','${json}'::jsonb)`;
  // tenant default: customer_pays; branch B2 overrides to review_only (pay disabled)
  await db.exec(ts('payments-checkout', JSON.stringify({ creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3.0, surchargeLabel: 'Card Surcharge', cashDiscountEnabled: false, customerDisplayMode: 'customer_pays' }), null));
  await db.exec(ts('payments-checkout', JSON.stringify({ creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3.0, surchargeLabel: 'Card Surcharge', cashDiscountEnabled: false, customerDisplayMode: 'review_only' }), B2));

  for (const tk of [TK, TK2]) {
    await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${tk}','${T}','${B1}','${C}','ready_checkout',10000,775,0,11098,0)`);
    await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${tk}',gen_random_uuid(),'Manicure',10000,45,'percent',0,10000,'completed',100)`);
  }
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) VALUES ('${DEV}','${T}','${B1}','iPad','ipad','paired')`);
  const cols = 'id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at';
  await db.exec(`INSERT INTO customer_display_sessions (${cols}) VALUES ('${SP}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '10 minutes')`);
  await db.exec(`INSERT INTO customer_display_sessions (${cols}) VALUES ('${ST}','${T}','${B2}','${DEV}','${TK2}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '10 minutes')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' }); await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k));

  try {
    const sp = await svc.getState(SP, token);
    ok('customer_pays session → payButtonEnabled true, state ticket_review', sp.payButtonEnabled === true && sp.state === 'ticket_review', `${sp.payButtonEnabled}/${sp.state}`);

    await throws('pay with wrong token → forbidden', () => svc.requestPayment(SP, 'nope'), 'forbidden');

    const req = await svc.requestPayment(SP, token);
    ok('requestPayment → state payment_processing', req.state === 'payment_processing', req.state);
    ok('payment_processing persisted on the session', (await svc.getState(SP, token)).state === 'payment_processing');

    const st = await svc.getState(ST, token);
    ok('review_only branch → payButtonEnabled false', st.payButtonEnabled === false, String(st.payButtonEnabled));
    await throws('pay on a non-customer_pays display → invalid', () => svc.requestPayment(ST, token), 'invalid');

    // the POS completes the sale on its normal path → ticket marked paid; the kiosk mirrors it
    await db.exec(`UPDATE tickets SET status = 'paid', paid_at = now() WHERE id = '${TK}'`);
    ok('after POS marks ticket paid → kiosk shows payment_success', (await svc.getState(SP, token)).state === 'payment_success');
    await throws('pay again after completion → invalid', () => svc.requestPayment(SP, token), 'invalid');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-customer-display-pay: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
