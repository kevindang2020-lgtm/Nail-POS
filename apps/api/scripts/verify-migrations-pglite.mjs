// verify-migrations-pglite.mjs — apply EVERY db/migrations/*.sql in order against a real Postgres engine (PGlite / PG16)
// with zero external infrastructure, then assert the customer-app schema (042–047). Catches SQL/ordering/constraint
// errors that type-checks and in-memory tests cannot. Same engine the e2e:live harness uses.
//   Install once (dev-only; intentionally NOT in package.json):
//     npm i -D @electric-sql/pglite@0.5.1 --legacy-peer-deps
//   Run:  node scripts/verify-migrations-pglite.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules

let PGlite, pgcrypto, pg_trgm, btree_gist;
try { ({ PGlite } = await import('@electric-sql/pglite')); ({ pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')); ({ pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')); ({ btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist')); }
catch { console.error('verify: missing dep. Install once:\n  npm i -D @electric-sql/pglite@0.5.1 --legacy-peer-deps'); process.exit(2); }

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } }); // pg_trgm: 107 trigram indexes; btree_gist: 372 booking-hold exclusion constraint
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
let applied = 0;
for (const f of files) {
  try { await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8')); applied++; }
  catch (e) { console.log(`\n❌ FAILED applying ${f}\n   ${e.message}`); process.exit(1); }
}
console.log(`✅ applied ${applied}/${files.length} migrations in order (… ${files[files.length - 1]})`);

const cols = async (t) => (await db.query(`select column_name from information_schema.columns where table_name=$1 order by ordinal_position`, [t])).rows.map((r) => r.column_name);
console.log('\n— customer-app tables (042–047) —');
for (const t of ['customer_wallet_ledger', 'customer_notifications', 'customer_addresses', 'customer_deals', 'customer_referrals', 'customer_payment_methods']) {
  const c = await cols(t);
  if (!c.length) { console.log(`❌ ${t} missing`); process.exit(1); }
  console.log(`  • ${t}: [${c.join(', ')}]`);
}
const pm = await cols('customer_payment_methods');
if (pm.some((n) => /pan|card_?number|ccnum/i.test(n)) || !pm.includes('token')) { console.log('❌ payment-method PAN-safety check failed'); process.exit(1); }
console.log('  ✓ payment methods: token present, no PAN/card_number column');
let checkOK = false;
try { await db.exec(`INSERT INTO customer_wallet_ledger (tenant_id, customer_id, amount_cents, entry_type) VALUES (gen_random_uuid(), gen_random_uuid(), 100, 'bogus')`); } catch { checkOK = true; }
if (!checkOK) { console.log('❌ entry_type CHECK not enforced'); process.exit(1); }
console.log('  ✓ wallet ledger entry_type CHECK rejects invalid types');
const T = '11111111-1111-1111-1111-111111111111', C = '22222222-2222-2222-2222-222222222222';
await db.exec(`INSERT INTO customer_wallet_ledger (tenant_id, customer_id, amount_cents, entry_type) VALUES ('${T}','${C}',5000,'top_up'),('${T}','${C}',-1500,'payment')`);
const bal = (await db.query(`select coalesce(sum(amount_cents),0)::int n from customer_wallet_ledger where tenant_id=$1 and customer_id=$2`, [T, C])).rows[0].n;
if (bal !== 3500) { console.log(`❌ ledger balance ${bal} != 3500`); process.exit(1); }
console.log(`  ✓ signed ledger balance sums correctly (${bal}¢)`);
await db.close();
console.log('\n✅ SCHEMA VERIFIED on real Postgres (PGlite/PG16).');
