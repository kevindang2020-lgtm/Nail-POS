/* e2e-customer-payments.ts — end-to-end on the REAL customer payment stack over a REAL Postgres (PGlite) and the REAL
 * CardPointe client against a local mock gateway. Constructs the actual CustomerPaymentsController with the real services,
 * the real PaymentGatewayResolver (env-fallback → real CardPointeClient → mock), and the real Kysely repositories + wallet
 * ledger. Proves the customer add-card + wallet top-up money path through the real gateway client (only the live Fiserv
 * host is left). Run: npx tsx scripts/e2e-customer-payments.ts */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { CustomerPaymentsController } from '../../../modules/payments/src/customer-payments/customer-payments.controller';
import { CustomerPaymentMethodsService, WalletTopupService } from '../../../modules/payments/src/customer-payments/customer-payments.service';
import { KyselyCustomerPaymentMethodsRepository } from '../../../modules/payments/src/customer-payments/customer-payments.repository';
import { WalletLedgerService } from '../../../modules/customers/src/wallet/wallet.service';
import { KyselyWalletLedgerRepository } from '../../../modules/customers/src/wallet/wallet.kysely.repository';
import { PaymentGatewayResolver } from '../../../modules/payments/src/payments/payment-gateway.resolver';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5457, MOCK = 4601;
  const T = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b1', U = '00000000-0000-0000-0000-0000000000c1';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot','PILOT01')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, role, status) VALUES ('${U}','${T}','${B}','customer@pilotsalon.com','CUSTOMER','active')`);
  const customerId = (await db.query<{ id: string }>(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES (gen_random_uuid(),'${T}','${B}','Casey','Customer','Casey Customer','${U}') RETURNING id`)).rows[0].id;

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  // REAL CardPointe-shaped mock gateway + env so PaymentGatewayResolver builds the REAL CardPointeClient against it.
  const mock = spawn('node', ['scripts/cardpointe-mock-server.mjs'], { cwd: process.cwd(), env: { ...process.env, MOCK_PORT: String(MOCK) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await sleep(700);
  Object.assign(process.env, { PAYMENTS_ALLOW_ENV_FALLBACK: '1', CARDPOINTE_BASE_URL: `http://127.0.0.1:${MOCK}`, CARDPOINTE_MERCHID: '496160873888', CARDPOINTE_USERNAME: 'apiuser', CARDPOINTE_PASSWORD: 's3cret', CARDPOINTE_CURRENCY: 'USD' });

  const bal = async () => (await db.query<{ n: number }>(`select coalesce(sum(amount_cents),0)::int n from customer_wallet_ledger where customer_id=$1`, [customerId])).rows[0].n;
  try {
    // the REAL wiring, constructed exactly as the module provides it
    const methodsRepo = new KyselyCustomerPaymentMethodsRepository(k);
    const methodsSvc = new CustomerPaymentMethodsService(methodsRepo);
    const ledger = new WalletLedgerService(new KyselyWalletLedgerRepository(k));
    const resolver = new PaymentGatewayResolver(k);                       // real resolver → env fallback → real CardPointeClient
    const topup = new WalletTopupService(resolver, methodsRepo, ledger);
    const controller = new CustomerPaymentsController(methodsSvc, topup); // the REAL controller
    const req = { ctx: { tenantId: T, userId: U, branchId: B, role: 'CUSTOMER', permissions: [] } };

    // resolver actually builds the real CardPointe client from env
    const gw = await resolver.resolve(T);
    ok('PaymentGatewayResolver builds a real processor (CardPointe) from config', !!gw.processor && gw.configured === true, `type=${gw.processorType}`);

    ok('controller GET payment-methods (empty)', (await controller.list(req as any)).length === 0);

    const m1: any = await controller.add(req as any, { token: '9418594164541111', brand: 'Visa', last4: '1111', expMonth: 12, expYear: 2030, isDefault: true });
    ok('controller add card (token stored, last4 surfaced, no token echoed)', !!m1?.id && m1.last4 === '1111' && !('token' in m1));
    ok('controller list shows the card', (await controller.list(req as any)).length === 1);

    const r1: any = await controller.topUp(req as any, { amountCents: 5000, paymentMethodId: m1.id });
    ok('controller top-up APPROVED via REAL CardPointe client → mock, ledger credited', r1?.ok === true && r1?.balanceCents === 5000, JSON.stringify(r1));
    ok('ledger balance = 5000 after approved top-up', (await bal()) === 5000);

    const d1: any = await controller.add(req as any, { token: '4000000000000002', brand: 'Visa', last4: '0002', expMonth: 12, expYear: 2030 });
    const rD: any = await controller.topUp(req as any, { amountCents: 2500, paymentMethodId: d1.id });
    ok('controller top-up DECLINED (canonical decline PAN) via real client → no credit', rD?.ok === false && rD?.declined === true, JSON.stringify(rD));
    ok('ledger balance unchanged (5000) after decline', (await bal()) === 5000);

    const rZ: any = await controller.topUp(req as any, { amountCents: 0, paymentMethodId: m1.id });
    ok('controller rejects a zero amount', rZ?.ok === false);

    ok('controller setDefault', (await controller.setDefault(req as any, d1.id)).ok === true);
    ok('controller remove', (await controller.remove(req as any, m1.id)).ok === true);
    ok('one card remains after remove', (await controller.list(req as any)).length === 1);

    console.log(`\n${fail === 0 ? '✅ CUSTOMER-PAYMENTS E2E (real controller + real CardPointe client + real DB): ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) { console.error('THREW:', e?.message || e); fail++; }
  finally { try { await k.destroy(); } catch {} try { await pool.end(); } catch {} try { mock.kill('SIGKILL'); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
