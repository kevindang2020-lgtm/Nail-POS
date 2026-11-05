import { migratedPglite } from '../../../packages/testing/src/pgtest-schema.mjs';   // Constitution 13 §90
import { sensitivityOf } from '../db/ownership/heuristics.mjs';
const pg = await migratedPglite();
const cols = (await pg.query(`select table_name t, column_name c, data_type d from information_schema.columns where table_schema='public' order by 1,2`)).rows;
const tables = [...new Set(cols.map(r=>r.t))];
const tenantScoped = new Set(cols.filter(r=>r.c==='tenant_id').map(r=>r.t));
// Phase 10: one sensitivity implementation, shared with the ownership registry (db/ownership/heuristics.mjs).
const out = [];
for (const t of tables) {
  const { cls, enc, pii } = sensitivityOf(t, cols.filter((r) => r.t === t).map((r) => r.c));
  out.push({ t, cls, tenant: tenantScoped.has(t), enc, pii });
}
const counts = {}; for (const o of out) counts[o.cls]=(counts[o.cls]||0)+1;
console.log(JSON.stringify({ total: out.length, counts, tenantScoped: [...tenantScoped].length, encTables: out.filter(o=>o.enc.length).map(o=>`${o.t}:${o.enc.join('|')}`) }, null, 0).slice(0, 1800));
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../.classification.json', import.meta.url), JSON.stringify(out));
process.exit(0);
