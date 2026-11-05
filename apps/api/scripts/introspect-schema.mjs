// introspect-schema.mjs — kysely.types drift gate: apply all db/migrations to PGlite, introspect the live schema,
// and FAIL (exit 1) if packages/database/src/kysely.types.ts has missing/ghost tables or columns vs the schema.
// Also dumps the schema to /tmp/schema.json. Run via: npm run -s check:types-drift
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules

const { PGlite } = await import('@electric-sql/pglite');
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'db', 'migrations');
const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  try { await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { console.error(`FAILED ${f}: ${e.message}`); process.exit(1); }
}
console.error(`applied ${files.length} migrations`);

const tables = (await db.query(`
  select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'
  order by table_name`)).rows.map((r) => r.table_name);

const out = {};
for (const t of tables) {
  const cols = (await db.query(`
    select column_name, data_type, udt_name, is_nullable, column_default, is_identity
    from information_schema.columns
    where table_schema='public' and table_name=$1
    order by ordinal_position`, [t])).rows;
  out[t] = cols.map((c) => ({
    name: c.column_name,
    dataType: c.data_type,
    udt: c.udt_name,
    nullable: c.is_nullable === 'YES',
    hasDefault: c.column_default != null || c.is_identity === 'YES',
  }));
}
writeFileSync('/tmp/schema.json', JSON.stringify(out, null, 1));
console.error(`tables in live schema: ${tables.length}`);

// ---- diff vs current DB interface ----
const src = readFileSync(join(ROOT, '..', '..', 'packages', 'database', 'src', 'kysely.types.ts'), 'utf8');   // Constitution 13: the schema types live in packages/database
const dbBlock = src.match(/export interface DB \{([\s\S]*?)\n\}/);
const declared = new Map(); // table_name -> interface name
for (const m of dbBlock[1].matchAll(/^\s+([a-z0-9_]+):\s*(\w+);/gm)) declared.set(m[1], m[2]);

const missingTables = tables.filter((t) => !declared.has(t));
const ghostTables = [...declared.keys()].filter((t) => !tables.includes(t));

// per-table column diff for declared tables
const colGaps = [];
for (const [t, iface] of declared) {
  if (!out[t]) continue;
  const ifaceBlock = src.match(new RegExp(`export interface ${iface} \\{([^}]*)\\}`));
  if (!ifaceBlock) { colGaps.push({ table: t, error: 'interface body not found' }); continue; }
  const declaredCols = new Set([...ifaceBlock[1].matchAll(/(?:^|[\s{;])([a-z0-9_]+)\s*:/g)].map((m) => m[1]));
  const missing = out[t].filter((c) => !declaredCols.has(c.name)).map((c) => c.name);
  const ghost = [...declaredCols].filter((n) => !out[t].some((c) => c.name === n));
  if (missing.length || ghost.length) colGaps.push({ table: t, missing, ghost });
}

const drift = missingTables.length + ghostTables.length + colGaps.length;
if (drift) {
  console.log(JSON.stringify({ missingTables, ghostTables, colGaps }, null, 1));
  console.error(`❌ kysely.types drift: ${missingTables.length} missing tables, ${ghostTables.length} ghost tables, ${colGaps.length} tables with column gaps. Regenerate/patch packages/database/src/kysely.types.ts to match db/migrations.`);
  process.exit(1);
}
console.error(`✅ kysely.types matches the migrated schema (${tables.length} tables, all columns declared, no ghosts).`);
