/* db-money-integration.ts — exercises the REAL customer money path against a REAL Postgres engine (PGlite), using the
 * actual Kysely repositories + services (not the in-memory adapters). Proves the SQL that unit tests can't: payment-method
 * CRUD + default handling, ledger credit + balance SUM, and idempotency on the processor retref (the unique index).
 * The gateway is a deterministic stub here (the real CardPointe client over a mock is already covered by e2e-cardpointe).
 * Run: NODE_PATH=<pglite>/node_modules npx tsx scripts/db-money-integration.ts */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCustomerPaymentMethodsRepository } from '../../../modules/payments/src/customer-payments/customer-payments.repository';
import { CustomerPaymentMethodsService, WalletTopupService } from '../../../modules/payments/src/customer-payments/customer-payments.service';
import { WalletLedgerService } from '../../../modules/customers/src/wallet/wallet.service';
import { KyselyWalletLedgerRepository } from '../../../modules/customers/src/wallet/wallet.kysely.repository';

let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  const PORT = 5455;
  const T = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b1', U = '00000000-0000-0000-0000-0000000000c1';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot','PILOT01')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, role, status) VALUES ('${U}','${T}','${B}','customer@pilotsalon.com','CUSTOMER','active')`);
  const custRow = await db.query<{ id: string }>(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES (gen_random_uuid(),'${T}','${B}','Casey','Customer','Casey Customer','${U}') RETURNING id`);
  const customerId = custRow.rows[0].id;

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    const methodsRepo = new KyselyCustomerPaymentMethodsRepository(k);
    const methodsSvc = new CustomerPaymentMethodsService(methodsRepo);
    const ledger = new WalletLedgerService(new KyselyWalletLedgerRepository(k));
    const ctx = { tenantId: T, userId: U };

    ok('resolveCustomerId finds the linked customer', (await methodsRepo.resolveCustomerId(T, U)) === customerId);

    const m1 = await methodsSvc.add(ctx, { token: '4111111111111111', brand: 'Visa', expMonth: 12, expYear: 2030, isDefault: true });
    ok('add card stores token-only with last4', m1.last4 === '1111' && m1.isDefault === true);
    const tok = await methodsRepo.getToken(T, customerId, m1.id);
    ok('getToken returns the funding token (internal only)', tok?.token === '4111111111111111');

    const approver = { name: 'stub', authorizeAndCapture: async () => ({ approved: true, declined: false, retref: 'RT-CONST', respstat: 'A', respText: 'Approved' }), refund: async () => ({ ok: true, respstat: 'A', respText: '' }), voidTransaction: async () => ({ ok: true, respstat: 'A', respText: '' }) };
    const resolverApprove = { resolve: async () => ({ processor: approver, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'active', configured: true }) } as any;
    const topup = new WalletTopupService(resolverApprove, methodsRepo, ledger);

    const r1 = await topup.topUp(ctx, { amountCents: 5000, paymentMethodId: m1.id });
    ok('top-up #1 approved → ledger credited', r1.ok === true && r1.balanceCents === 5000, `balance=${r1.balanceCents}`);
    const r2 = await topup.topUp(ctx, { amountCents: 5000, paymentMethodId: m1.id });
    ok('top-up #2 same retref is idempotent (unique index)', r2.ok === true && r2.balanceCents === 5000, `balance=${r2.balanceCents}`);

    const decliner = { ...approver, authorizeAndCapture: async () => ({ approved: false, declined: true, retref: 'RT-DECL', respstat: 'C', respText: 'Declined' }) };
    const resolverDecline = { resolve: async () => ({ processor: decliner, configured: true, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'active' }) } as any;
    const rD = await new WalletTopupService(resolverDecline, methodsRepo, ledger).topUp(ctx, { amountCents: 9999, paymentMethodId: m1.id });
    const balAfterDecline = (await ledger.getWallet(T, customerId)).balanceCents;
    ok('declined charge posts nothing to the ledger', rD.ok === false && rD.declined === true && balAfterDecline === 5000, `balance=${balAfterDecline}`);

    const rNo = await new WalletTopupService({ resolve: async () => ({ processor: undefined, configured: false, processorType: 'none', environment: 'sandbox', merchantIdMasked: '', status: 'not_configured' }) } as any, methodsRepo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: m1.id });
    ok('unconfigured gateway → top-up refused', rNo.ok === false);

    const m2 = await methodsSvc.add(ctx, { token: '5555444433331111', brand: 'Mastercard', expMonth: 1, expYear: 2031 });
    ok('second card added', (await methodsSvc.list(ctx)).length === 2);
    await methodsSvc.setDefault(ctx, m2.id);
    const list1 = await methodsSvc.list(ctx);
    ok('setDefault moves the default to exactly one card', list1.find((x) => x.id === m2.id)?.isDefault === true && list1.find((x) => x.id === m1.id)?.isDefault === false);
    await methodsSvc.remove(ctx, m1.id);
    ok('remove deletes the card', (await methodsSvc.list(ctx)).length === 1);

    const w = await ledger.getWallet(T, customerId);
    ok('wallet shows the top-up transaction', w.balanceCents === 5000 && w.transactions.some((t) => t.type === 'top_up'), `txns=${w.transactions.length}`);

    console.log(`\n${fail === 0 ? '✅ DB MONEY-PATH INTEGRATION: ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) {
    console.error('THREW:', e?.message || e); fail++;
  } finally {
    await k.destroy().catch(() => {}); await pool.end().catch(() => {}); await server.stop().catch(() => {}); await db.close().catch(() => {});
  }
  process.exit(fail === 0 ? 0 : 1);
})();
