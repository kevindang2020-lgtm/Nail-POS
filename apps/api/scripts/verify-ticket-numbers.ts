/* verify-ticket-numbers.ts — proves the friendly per-branch daily ticket numbering over real Postgres (PGlite):
 * sequential allocation, independence across branches, daily reset in the tenant's timezone, and that the kiosk
 * displays the real number (falling back to an id-derived ref when a ticket has none). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { nextTicketNumber, todayInTimeZone } from '../../../modules/queue/src/queue/ticket-number';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService } from '../src/customer-display/customer-display.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

const T = '00000000-0000-0000-0000-00000d7c1501', B1 = '00000000-0000-0000-0000-00000d7cb501', B2 = '00000000-0000-0000-0000-00000d7cb502', B3 = '00000000-0000-0000-0000-00000d7cb503';
const C = '00000000-0000-0000-0000-00000d7cc501', TK = '00000000-0000-0000-0000-00000d7c7c14', TK2 = '00000000-0000-0000-0000-00000d7c7c99', DEV = '00000000-0000-0000-0000-00000d7cde01';
const S = '00000000-0000-0000-0000-00000d7c5e14', S2 = '00000000-0000-0000-0000-00000d7c5e99';
const token = 'tok_tn'; const hash = createHash('sha256').update(token).digest('hex');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  const server = new PGLiteSocketServer({ db, port: 5493, host: '127.0.0.1' }); await server.start();
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5493/postgres' }) }) });

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','TN LLC','TN Salon','tn','TN')`);
  for (const [b, n] of [[B1, 'One'], [B2, 'Two'], [B3, 'Three']] as const) await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${b}','${T}','${n}','active')`);
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"America/New_York"}')`);

  // 1) sequential per branch
  const a1 = await nextTicketNumber(k, T, B1), a2 = await nextTicketNumber(k, T, B1), a3 = await nextTicketNumber(k, T, B1);
  ok('branch 1 allocates 001, 002, 003 in order', a1 === '001' && a2 === '002' && a3 === '003', `${a1},${a2},${a3}`);

  // 2) independent per branch
  const b1 = await nextTicketNumber(k, T, B2);
  ok('branch 2 starts its own sequence at 001', b1 === '001', b1);
  const a4 = await nextTicketNumber(k, T, B1);
  ok('branch 1 continues at 004 (unaffected by branch 2)', a4 === '004', a4);

  // 3) counter row carries the tenant-tz business date + correct last_seq
  const todayET = todayInTimeZone('America/New_York');
  const ctr: any = await k.selectFrom('ticket_number_counters').selectAll().where('tenant_id', '=', T).where('branch_id', '=', B1).executeTakeFirst();
  const bd = ctr?.business_date instanceof Date ? ctr.business_date.toISOString().slice(0, 10) : String(ctr?.business_date).slice(0, 10);
  ok('counter business_date = today in America/New_York', bd === todayET, `${bd} vs ${todayET}`);
  ok('counter last_seq reflects 4 allocations', Number(ctr?.last_seq) === 4, String(ctr?.last_seq));

  // 4) daily reset — a stale counter row from a prior day does not carry forward
  await db.exec(`INSERT INTO ticket_number_counters (tenant_id, branch_id, business_date, last_seq) VALUES ('${T}','${B3}', (DATE '${todayET}' - INTERVAL '1 day'), 50)`);
  const r1 = await nextTicketNumber(k, T, B3);
  ok('new day starts fresh at 001 despite yesterday ending at 050', r1 === '001', r1);
  const stale: any = await k.selectFrom('ticket_number_counters').selectAll().where('branch_id', '=', B3).where('last_seq', '=', 50).executeTakeFirst();
  ok("yesterday's counter row is left untouched", Number(stale?.last_seq) === 50, String(stale?.last_seq));

  // 5) kiosk displays the real ticket_number, and falls back to an id-derived ref when absent
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) VALUES ('${DEV}','${T}','${B1}','iPad','ipad','paired')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Mai','Tran','Mai Tran','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout','014',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Manicure',10000,45,'percent',0,10000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${S}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '20 minutes')`);
  // a second ticket with NO ticket_number → fallback
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK2}','${T}','${B1}','${C}','ready_checkout',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${S2}','${T}','${B1}','${DEV}','${TK2}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '20 minutes')`);

  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k), undefined as any);
  const st: any = await svc.getState(S, token);
  ok('kiosk shows the real friendly number as #014', st?.ticket?.ticketNumber === '#014', String(st?.ticket?.ticketNumber));
  const st2: any = await svc.getState(S2, token);
  ok('kiosk falls back to an id-derived # ref when a ticket has no number', typeof st2?.ticket?.ticketNumber === 'string' && st2.ticket.ticketNumber.startsWith('#') && st2.ticket.ticketNumber !== '#014', String(st2?.ticket?.ticketNumber));

  await k.destroy(); await server.stop(); await db.close();
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-ticket-numbers: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
