/* verify-device-mode.ts — proves the mounted-iPad device flow over real Postgres (PGlite): a paired device authenticated
 * by its per-device token resolves to its current active session; tip/pay work via the device token; an idle screen shows
 * when no session is attached; forged tokens are rejected. (Credentials are minted by the display's own pairing — see
 * display-devices.pgtest.vitest.spec.ts.) */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService, DisplayError } from '../src/customer-display/customer-display.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const threw = async (fn: () => Promise<any>, code: string): Promise<boolean> => { try { await fn(); return false; } catch (e) { return e instanceof DisplayError && e.code === code; } };

const T = '00000000-0000-0000-0000-0000d3711501', OTHER = '00000000-0000-0000-0000-0000d3710ff5', B1 = '00000000-0000-0000-0000-0000d371b501';
const C = '00000000-0000-0000-0000-0000d371c501', TK = '00000000-0000-0000-0000-0000d3717c01';
const DEV1 = '00000000-0000-0000-0000-0000d371de01', DEV2 = '00000000-0000-0000-0000-0000d371de02', S = '00000000-0000-0000-0000-0000d3715e01';
const dev1tok = 'dev1_tok'; const dev1hash = createHash('sha256').update(dev1tok).digest('hex');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  // as the pgtests do: PGlite lacks a few extensions (pg_trgm), so CREATE EXTENSION is stripped and the few statements
  // that need one are tolerated — the display tables do not
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* tolerated */ }
  }
  const server = new PGLiteSocketServer({ db, port: 5494, host: '127.0.0.1' }); await server.start();
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5494/postgres' }) }) });

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Dev LLC','Dev Salon','dev','DEV'),('${OTHER}','Other LLC','Other','oth','OTH')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active')`);
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'payments-checkout','{"creditCardSurchargeEnabled":true,"creditCardSurchargePercent":3,"surchargeLabel":"Card Surcharge","customerDisplayMode":"customer_pays"}')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Kim','Vo','Kim Vo','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout','007',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Gel Mani',10000,45,'percent',0,10000,'completed',100)`);
  // DEV1 has a token + an attached session; DEV2 is paired but token-less (issued later) and session-less
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) VALUES ('${DEV1}','${T}','${B1}','Lobby iPad','ipad','paired','${dev1hash}'),('${DEV2}','${T}','${B1}','Chair 2 iPad','ipad','paired',NULL)`);
  await db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${S}','${T}','${B1}','${DEV1}','${TK}','${C}','showing_ticket','x',0,10000,'card', now() + interval '20 minutes')`);

  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k), undefined as any);

  // 1) device resolves to its current session
  const cur: any = await svc.getDeviceState(dev1tok);
  ok('device token resolves to its active session (ticket_review)', cur?.state === 'ticket_review' && cur?.ticket?.ticketNumber === '#007', `${cur?.state}/${cur?.ticket?.ticketNumber}`);
  ok('session ticket services come through', Array.isArray(cur?.ticket?.services) && cur.ticket.services[0]?.serviceName === 'Gel Mani');

  // 2) tip via the device token
  const tipped: any = await svc.submitTipForDevice(dev1tok, { tipType: 'percent', percent: 20 });
  ok('tip via device token applies (tip_selected, 2000c)', tipped?.state === 'tip_selected' && tipped?.selectedTipCents === 2000, `${tipped?.state}/${tipped?.selectedTipCents}`);
  const after: any = await svc.getDeviceState(dev1tok);
  ok('re-reading device state reflects the tip', after?.selectedTipCents === 2000);

  // 3) pay via the device token (customer_pays enabled in settings)
  const paying: any = await svc.requestPaymentForDevice(dev1tok);
  ok('pay via device token → payment_processing', paying?.state === 'payment_processing', String(paying?.state));

  // 4) SSE room resolves to the session's room
  const r1 = await svc.deviceRooms(dev1tok);   // the device's own channel + the session room (+ its ticket's room)
  ok('deviceRooms include the device channel and the session room', r1.includes(`customer_display:device:${DEV1}`) && r1.includes(`customer_display:${S}`), r1.join(','));

  // 5) forged / missing device token rejected
  ok('forged device token → forbidden', await threw(() => svc.getDeviceState('nope'), 'forbidden'));
  ok('missing device token → forbidden', await threw(() => svc.getDeviceState(undefined), 'forbidden'));

  // 6) a second paired display with no checkout → idle screen. (Its credential comes from the display pairing itself now —
  //    POST /customer-display/pairing + the owner's claim, display-devices.pgtest — so the row is given one directly.)
  const tok2 = 'dev2_tok_' + 'x'.repeat(24);
  await k.updateTable('customer_display_devices').set({ device_token_hash: createHash('sha256').update(tok2).digest('hex'), pairing_status: 'paired' } as any).where('tenant_id', '=', T).where('id', '=', DEV2).execute();
  const idle: any = await svc.getDeviceState(tok2);
  ok('a paired device with no active session shows idle', idle?.state === 'idle' && typeof idle?.salonName === 'string', String(idle?.state));
  ok('tip on an idle device → invalid (no active checkout)', await threw(() => svc.submitTipForDevice(tok2, { tipType: 'none' }), 'invalid'));
  const r2 = await svc.deviceRooms(tok2);
  ok('an idle device still listens on its own channel (and nothing else)', r2.length === 1 && r2[0] === `customer_display:device:${DEV2}`, r2.join(','));

  await k.destroy(); await server.stop(); await db.close();
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-device-mode: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
