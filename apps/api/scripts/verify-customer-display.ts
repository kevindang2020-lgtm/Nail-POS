/* verify-customer-display.ts — proves the device-facing (kiosk) customer-display API over real Postgres (PGlite): the iPad
 * fetches its CustomerDisplayState by session public token, the tip selection validates + recomputes totals through the
 * same checkout helpers and persists, and bad/missing tokens, expired and closed sessions are handled. */
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
  const PORT = 5487;
  const T = '00000000-0000-0000-0000-0000000d1501';
  const B1 = '00000000-0000-0000-0000-0000000db501';
  const C = '00000000-0000-0000-0000-0000000dc501';
  const TK = '00000000-0000-0000-0000-0000000d7c01';
  const DEV = '00000000-0000-0000-0000-0000000dde01';
  const S = '00000000-0000-0000-0000-0000000d5e01', EXP = '00000000-0000-0000-0000-0000000d5e02', CL = '00000000-0000-0000-0000-0000000d5e03';
  const token = 'tok_kiosk_abc123';
  const hash = createHash('sha256').update(token).digest('hex');

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Glow Bar LLC','Glow Bar Nails','glow','GLOW')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Alex','Rivera','Alex Rivera','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES
    (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Gel Manicure',6000,45,'percent',0,6000,'completed',100),
    (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Classic Pedicure',4000,40,'percent',0,4000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) VALUES ('${DEV}','${T}','${B1}','Front Counter iPad','ipad','paired')`);
  const cols = 'id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method';
  await db.exec(`INSERT INTO customer_display_sessions (${cols}, expires_at) VALUES ('${S}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '10 minutes')`);
  await db.exec(`INSERT INTO customer_display_sessions (${cols}, expires_at) VALUES ('${EXP}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() - interval '5 minutes')`);
  await db.exec(`INSERT INTO customer_display_sessions (${cols}, closed_at) VALUES ('${CL}','${T}','${B1}','${DEV}','${TK}','${C}','disconnected','${hash}',0,10000,'card', now())`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k)); // no emitter in harness

  try {
    const st = await svc.getState(S, token);
    ok('state = ticket_review', st.state === 'ticket_review', st.state);
    ok('salon + customer first name surfaced', st.salonName === 'Glow Bar Nails' && st.customer?.firstName === 'Alex', `${st.salonName}/${st.customer?.firstName}`);
    ok('ticket services listed with names + prices', st.ticket?.services.length === 2 && st.ticket.services[0].serviceName === 'Gel Manicure' && st.ticket.services[0].priceCents === 6000, JSON.stringify(st.ticket?.services));
    ok('ticket reference derived from id (#XXXX)', !!st.ticket?.ticketNumber && st.ticket.ticketNumber.startsWith('#'), st.ticket?.ticketNumber);
    ok('tip options = 15/18/20 + No Tip with correct amounts', st.tipOptions.length === 4 && st.tipOptions[0].amountCents === 1500 && st.tipOptions[2].amountCents === 2000 && st.tipOptions[3].tipType === 'none', JSON.stringify(st.tipOptions.map((o) => o.amountCents)));
    ok('initial totals (card): subtotal 10000, tax 775, surcharge 323, total 11098', st.totals.subtotalCents === 10000 && st.totals.taxCents === 775 && st.totals.surchargeCents === 323 && st.totals.totalDueCents === 11098, JSON.stringify(st.totals));

    await throws('wrong token → forbidden', () => svc.getState(S, 'not-the-token'), 'forbidden');
    await throws('missing token → forbidden', () => svc.getState(S, undefined), 'forbidden');
    await throws('unknown session → not_found', () => svc.getState('00000000-0000-0000-0000-0000000d5eff', token), 'not_found');

    const tipped = await svc.submitTip(S, token, { tipType: 'percent', percent: 20 });
    ok('20% tip: state tip_selected, tip 2000, total recomputes to 13158 (surcharge 383)', tipped.state === 'tip_selected' && tipped.selectedTipCents === 2000 && tipped.totals.totalDueCents === 13158 && tipped.totals.surchargeCents === 383, JSON.stringify({ tip: tipped.selectedTipCents, total: tipped.totals.totalDueCents }));
    const reread = await svc.getState(S, token);
    ok('tip persisted across re-fetch', reread.selectedTipCents === 2000 && reread.state === 'tip_selected', JSON.stringify({ tip: reread.selectedTipCents, st: reread.state }));

    const noTip = await svc.submitTip(S, token, { tipType: 'none' });
    ok('No Tip → 0, total back to 11098', noTip.selectedTipCents === 0 && noTip.totals.totalDueCents === 11098, JSON.stringify(noTip.totals));
    const custom = await svc.submitTip(S, token, { tipType: 'custom', amountCents: 500 });
    ok('custom $5 tip → 500, total 11613', custom.selectedTipCents === 500 && custom.totals.totalDueCents === 11613, JSON.stringify(custom.totals));

    await throws('custom tip over max% → invalid', () => svc.submitTip(S, token, { tipType: 'custom', amountCents: 999999 }), 'invalid');
    await throws('percent tip without a percent → invalid', () => svc.submitTip(S, token, { tipType: 'percent' }), 'invalid');
    await throws('bad tipType → invalid', () => svc.submitTip(S, token, {} as any), 'invalid');

    ok('expired session → state expired', (await svc.getState(EXP, token)).state === 'expired');
    ok('closed session → state disconnected', (await svc.getState(CL, token)).state === 'disconnected');
    await throws('tip on a closed session → invalid', () => svc.submitTip(CL, token, { tipType: 'percent', percent: 18 }), 'invalid');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-customer-display: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
