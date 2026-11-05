/**
 * payment_isolation_check.ts — verifies tenant payment-gateway ISOLATION against a live Postgres.
 * Drives PaymentGatewayResolver directly (no Fiserv network call): provisions two tenants with their own gateway
 * credentials, then asserts each resolves to its OWN merchant, secrets are encrypted at rest + masked on read, and an
 * unprovisioned tenant is not_configured.
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/payment_isolation_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { PaymentGatewayResolver } from '../../../modules/payments/src/payments/payment-gateway.resolver';
import { decryptSecret } from '../src/common/mfa-enc';
import { maskSecret } from '../../../modules/tenants/src/settings/settings.dto';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails.push(label);
};

async function makeTenant(db: Kysely<DB>, code: string): Promise<string> {
  const r = await db.insertInto('tenants').values({
    legal_name: `${code} LLC`, display_name: code, tenant_slug: code.toLowerCase(),
    tenant_code: code, status: 'active',
  } as any).returning('id').executeTakeFirstOrThrow();
  return (r as any).id as string;
}

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const resolver = new PaymentGatewayResolver(db);
  const rid = Date.now().toString().slice(-6);

  console.log('== tenant payment gateway isolation ==');
  const tenantA = await makeTenant(db, `ISOA${rid}`);
  const tenantB = await makeTenant(db, `ISOB${rid}`);

  // Each tenant provisions its OWN gateway credentials.
  const MID_A = `MIDA${rid}A1X1`, MID_B = `MIDB${rid}B2X2`;
  const PW_A = 'superSecretPasswordA!';
  await resolver.upsertConfig(tenantA, { processorType: 'fiserv', environment: 'sandbox',
    baseUrl: 'https://tenantA.cardconnect.com', merchantId: MID_A, apiUsername: 'userA', apiPassword: PW_A,
    webhookSecret: 'whA', status: 'active' });
  await resolver.upsertConfig(tenantB, { processorType: 'fiserv', environment: 'production',
    baseUrl: 'https://tenantB.cardconnect.com', merchantId: MID_B, apiUsername: 'userB', apiPassword: 'pwB',
    status: 'active' });

  const a = await resolver.resolve(tenantA);
  const b = await resolver.resolve(tenantB);

  ok('tenant A resolves to a usable processor', a.configured && !!a.processor);
  ok('tenant B resolves to a usable processor', b.configured && !!b.processor);

  // Per-tenant PROCESSOR SELECTION (gateway abstraction §11): each tenant builds its OWN adapter of its OWN
  // processor type, never a shared one. The canonical processor set is Fiserv/CardPointe (with Bolt as CardPointe's
  // Integrated Terminal card-present leg) + Clover — Stripe/Square were permanently removed from the platform, so
  // this check exercises exactly the adapters the resolver can actually build.
  ok('Fiserv tenant resolves to the CardPointe client', a.processor?.name === 'cardpointe', a.processor?.name);

  const tenantCl = await makeTenant(db, `ISOL${rid}`);
  await resolver.upsertConfig(tenantCl, { processorType: 'clover', environment: 'sandbox', merchantId: `clacct${rid}`, apiPassword: 'clv_test_tenantL', status: 'active' });
  const clgw = await resolver.resolve(tenantCl);
  ok('Clover tenant resolves to a Clover adapter', clgw.configured && clgw.processor?.name === 'clover', clgw.processor?.name);
  ok('different processor types resolve to different adapters', clgw.processor?.name !== a.processor?.name,
    `${a.processor?.name}/${clgw.processor?.name}`);

  ok('both canonical processor types resolve to distinct adapters',
    new Set([a.processor?.name, clgw.processor?.name]).size === 2,
    `${a.processor?.name}/${clgw.processor?.name}`);
  ok('tenant A masked MID reflects A', a.merchantIdMasked.endsWith(MID_A.slice(-4)) && a.merchantIdMasked !== MID_A,
     a.merchantIdMasked);
  ok('tenant B masked MID reflects B', b.merchantIdMasked.endsWith(MID_B.slice(-4)) && b.merchantIdMasked !== MID_B,
     b.merchantIdMasked);
  ok('A and B resolve to DIFFERENT merchants (no sharing)', a.merchantIdMasked !== b.merchantIdMasked);
  ok('tenant B environment is its own (production)', b.environment === 'production' && a.environment === 'sandbox');

  // Encryption at rest: the stored password must be ciphertext, and decrypt back to the original.
  const rowA = await db.selectFrom('tenant_payment_config').selectAll().where('tenant_id', '=', tenantA).executeTakeFirstOrThrow();
  ok('api_password stored encrypted (v1: AES-GCM, not plaintext)',
     !!rowA.api_password_enc && rowA.api_password_enc.startsWith('v1:') && !rowA.api_password_enc.includes(PW_A));
  ok('encrypted password round-trips', rowA.api_password_enc ? decryptSecret(rowA.api_password_enc) === PW_A : false);
  ok('full MID is never exposed in masked form', !a.merchantIdMasked.includes(MID_A));

  // Masked view (what Super Admin/POS may see) carries no raw secret.
  const masked = await resolver.getMasked(tenantA);
  ok('masked view has no raw secret', !JSON.stringify(masked).includes(PW_A) && !JSON.stringify(masked).includes('userA'));

  // Unprovisioned tenant → not_configured, no processor (never falls back to another tenant's gateway).
  const tenantC = await makeTenant(db, `ISOC${rid}`);
  const c = await resolver.resolve(tenantC);
  ok('unprovisioned tenant is not_configured', !c.configured && c.processor === undefined && c.status === 'not_configured');

  // A 'pending' tenant (as provisioned at tenant creation) is also not usable.
  await resolver.upsertConfig(tenantC, { status: 'pending', merchantId: 'MIDPEND' });
  const cPending = await resolver.resolve(tenantC);
  ok('pending tenant is not usable until activated', !cPending.configured && cPending.processor === undefined);

  await db.destroy();
  console.log('\n== RESULT ==');
  if (fails.length) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  console.log('ALL ISOLATION CHECKS PASSED ✓');
}
main().catch((e) => { console.error(e); process.exit(1); });
