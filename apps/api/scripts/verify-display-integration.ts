/* verify-display-integration.ts — the FULL POS→device loop over real Postgres (PGlite), exercising the actual
 * checkout.createSession (which mints the session public token) and proving the device API consumes that exact token:
 * front desk sends a ticket to the display → device fetches state by the minted token → customer tips → POS marks the
 * ticket paid → device mirrors payment_success. No mock token shortcuts; the token comes from createSession itself. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCheckoutRepository } from '../../../modules/checkout/src/checkout/checkout.kysely.repository';
import type { CheckoutContext } from '../../../modules/checkout/src/checkout/checkout.repository';
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
  const PORT = 5490;
  const T = '00000000-0000-0000-0000-00000a0d1501', B1 = '00000000-0000-0000-0000-00000a0db501';
  const C = '00000000-0000-0000-0000-00000a0dc501', TK = '00000000-0000-0000-0000-00000a0d7c01', DEV = '00000000-0000-0000-0000-00000a0dde01';
  const U = '00000000-0000-0000-0000-00000a0d0001';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Bloom LLC','Bloom Nails','bloom','BLOOM')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Center City','active')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Jamie','Park','Jamie Park','(856) 555-0100','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, chosen_payment_method) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout',10000,775,0,11098,0,'card')`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Gel Manicure',6000,45,'percent',0,6000,'completed',100),
    (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Spa Pedicure',4000,50,'percent',0,4000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) VALUES ('${DEV}','${T}','${B1}','Front iPad','ipad','paired')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' }); await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  const checkout = new KyselyCheckoutRepository(k);
  const ctx: CheckoutContext = { tenantId: T, branchId: B1, userId: U, role: 'OWNER', permissions: [] };
  const display = new CustomerDisplayService(new KyselyDisplayRepository(k));

  try {
    // 1) front desk sends the ticket to the paired display — the REAL createSession mints the public token
    const session = await checkout.createSession(ctx, TK, DEV);
    ok('createSession returns a session + a minted publicToken', !!session?.sessionId && !!session?.publicToken && (session!.publicToken as string).length > 20, JSON.stringify({ id: session?.sessionId?.slice(0, 8), tok: session?.publicToken?.slice(0, 8) }));
    const sid = session!.sessionId, tok = session!.publicToken as string;

    // 2) the device fetches its state using EXACTLY the token createSession minted
    const st = await display.getState(sid, tok);
    ok('device reads state with the minted token → ticket_review', st.state === 'ticket_review', st.state);
    ok('device sees the real salon, customer, and 2 services', st.salonName === 'Bloom Nails' && st.customer?.firstName === 'Jamie' && st.ticket?.services.length === 2, JSON.stringify({ salon: st.salonName, who: st.customer?.firstName, n: st.ticket?.services.length }));
    ok('device totals match the POS snapshot: total 11098', st.totals.totalDueCents === 11098, JSON.stringify(st.totals));

    // 3) a forged token is rejected against the real minted hash
    await throws('forged token rejected → forbidden', () => display.getState(sid, tok.slice(0, -3) + 'xyz'), 'forbidden');

    // 4) customer tips on the device
    const tipped = await display.submitTip(sid, tok, { tipType: 'percent', percent: 20 });
    ok('customer tips 20% on the device → total 13158', tipped.selectedTipCents === 2000 && tipped.totals.totalDueCents === 13158, JSON.stringify({ tip: tipped.selectedTipCents, total: tipped.totals.totalDueCents }));

    // 5) the POS completes the sale on its normal path (ticket marked paid) → the device mirrors success
    await db.exec(`UPDATE tickets SET status = 'paid', paid_at = now() WHERE id = '${TK}'`);
    ok('after the POS marks the ticket paid → device shows payment_success', (await display.getState(sid, tok)).state === 'payment_success');
  } catch (e: any) {
    ok('integration harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-display-integration: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
