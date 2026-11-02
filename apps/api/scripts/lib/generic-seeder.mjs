// generic-seeder.mjs — one row of a salon in ANY table, its required columns filled from the live schema.
//
// Extracted from live-phase14-idor.mjs (the IDOR suite's seeder) so the route sweep (live-route-sweep.mjs) can reuse it.
// It is schema-driven: NOT NULL columns without a default get a typed value, foreign keys are followed (recursively
// seeding the parent), CHECK / NOT NULL / UNIQUE violations are retried with a value read from the constraint.
//
//   const seeder = makeSeeder({ query: (sql, params) => client.query(sql, params), mark: 'SWEEP123', fixed: { tenants: id, … },
//                              overrides: { tickets: { … } } });
//   const id = await seeder.rowOf('tickets', { pin: { status: 'paid' } });
//
// Every text value it writes carries `mark`, so a proof can recognise the seeded salon's data in a response.
import { randomUUID } from 'node:crypto';

export function makeSeeder({ query, mark, fixed, overrides = {}, tokens = {}, log = [] }) {
  const q = async (s, p = []) => (await query(s, p)).rows;
  const colCache = new Map(), fkCache = new Map(), seeded = new Map();
  const columns = async (t) => colCache.get(t) ?? colCache.set(t, await q(`select column_name as n, data_type as dt, udt_name as udt, is_nullable = 'YES' as nullable,
      column_default is not null as hasdef, is_generated <> 'NEVER' or is_identity = 'YES' as gen from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).get(t);
  const fks = async (t) => fkCache.get(t) ?? fkCache.set(t, Object.fromEntries((await q(`select a.attname as col, cf.relname as ref from pg_constraint c join pg_class cl on cl.oid = c.conrelid
      join pg_class cf on cf.oid = c.confrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and cl.relname = $1 and array_length(c.conkey, 1) = 1`, [t])).map((r) => [r.col, r.ref]))).get(t);
  const token = (v) => (typeof v === 'string' && v in tokens ? tokens[v] : v);
  const userId = fixed.users;

  async function valueFor(table, c, fk, depth) {
    if (fk) return fixed[fk] ?? (fk === table ? null : await rowOf(fk, { depth: depth + 1 }));
    if (/tenant_id$/.test(c.n)) return fixed.tenants;
    if (/branch_id$/.test(c.n)) return fixed.branches;
    if (/(user_id|_by)$/.test(c.n) && c.udt === 'uuid') return userId;
    if (c.dt === 'ARRAY') return '{}';
    switch (c.udt) {
      case 'uuid': return randomUUID();
      case 'text': case 'varchar': case 'citext': case 'bpchar': return `${mark}-${randomUUID().slice(0, 8)}`;
      case 'int2': case 'int4': case 'int8': case 'numeric': case 'float4': case 'float8': return 1;
      case 'bool': return false;
      case 'date': return '2026-01-15';
      case 'timestamptz': case 'timestamp': return '2026-01-15T15:00:00Z';
      case 'time': case 'timetz': return '10:00';
      case 'interval': return '1 hour';
      case 'json': case 'jsonb': return '{}';
      case 'inet': case 'cidr': return '10.0.0.1';
      case 'bytea': return Buffer.from('00', 'hex');
      case 'tsvector': return '';
      default: {
        const lab = (await q(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder limit 1`, [c.udt]))[0]?.enumlabel;
        return lab ?? `${mark}`;
      }
    }
  }

  /** The salon's row in `table`: a fixed one, one seeded earlier (same pin), else a freshly seeded one. */
  async function rowOf(table, { depth = 0, pin = null } = {}) {
    const cacheKey = `${table}${pin ? ':' + JSON.stringify(pin) : ''}`;
    if (!pin && fixed[table]) return fixed[table];
    if (seeded.has(cacheKey)) return seeded.get(cacheKey);
    if (depth > 6) throw new Error(`seed depth exceeded at ${table}`);
    const cols = await columns(table); const fk = await fks(table);
    if (!cols.length) throw new Error(`${table}: no such table`);
    const row = {};
    const over = { ...(overrides[table] ?? {}), ...Object.fromEntries(Object.entries(pin ?? {}).map(([k, v]) => [k, token(v)])) };
    const fill = async (c) => { row[c.n] = await valueFor(table, c, fk[c.n], depth); };
    for (const c of cols) {
      if (c.gen) continue;
      if (c.n in over) { row[c.n] = token(over[c.n]); continue; }
      if (/tenant_id$/.test(c.n) || /^branch_id$/.test(c.n)) { await fill(c); continue; }
      if (!c.nullable && !c.hasdef) await fill(c);
      else if (c.udt === 'text' && /(^|_)(name|title|full_name|first_name|last_name|label|description|notes?|subject|body|message)$/.test(c.n)) row[c.n] = `${mark} ${c.n}`;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      const sqlText = `insert into "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
      await query('savepoint seed');
      try {
        const r = (await query(sqlText, keys.map((k) => row[k]))).rows[0];
        await query('release savepoint seed');
        const id = r.id ?? Object.values(r)[0];
        seeded.set(cacheKey, id); log.push(cacheKey);
        return id;
      } catch (e) {
        await query('rollback to savepoint seed');
        const cdef = e.constraint ? (await q(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1 limit 1`, [e.constraint]))[0]?.d ?? '' : '';
        if (e.code === '23502' && e.column) { const c = cols.find((x) => x.n === e.column); if (c) { await fill(c); continue; } }
        if (e.code === '23514' && cdef) {
          let changed = false;
          for (const c of cols) {
            if (!new RegExp(`\\b${c.n}\\b`).test(cdef)) continue;
            const lit = new RegExp(`\\b${c.n}\\b[^']*?'([^']*)'`).exec(cdef)?.[1];
            if (lit !== undefined && row[c.n] !== lit && !/^\d/.test(lit) && !/::(date|timestamp)/.test(cdef)) { row[c.n] = lit; changed = true; }
            else if (row[c.n] === undefined || row[c.n] === null) { await fill(c); changed = true; }
            else if (typeof row[c.n] === 'number' && /(>|<|between)/i.test(cdef)) { const n = /(?:>=?|between)\s*\(?(\d+)/i.exec(cdef)?.[1]; if (n) { row[c.n] = Number(n) + 1; changed = true; } }
          }
          if (changed) continue;
        }
        if (e.code === '23505') { for (const c of cols) if (typeof row[c.n] === 'string' && row[c.n].startsWith(mark)) row[c.n] = `${mark}-${randomUUID().slice(0, 8)}`; continue; }
        throw new Error(`${table}: ${e.code} ${String(e.message).slice(0, 160)}${cdef ? ' [' + cdef.slice(0, 160) + ']' : ''}`);
      }
    }
    throw new Error(`${table}: could not satisfy the constraints`);
  }

  return { rowOf, columns, seeded, log };
}
