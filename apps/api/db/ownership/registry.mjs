// registry.mjs — BUILD_PLAN Phase 10 (Constitution 1 §3 "every table must explicitly belong to one ownership class",
// §7 domains, §105 source of truth): build the machine-readable ownership registry from the REAL migrated schema and
// check it. Pure functions here; apps/api/scripts/db-ownership.mjs does the I/O (--write / --check).
import { OWNERSHIP, DOMAINS, domainOf, ownershipOf, sensitivityOf } from './heuristics.mjs';

/** Read the facts the registry needs from a migrated database (PGlite or pg — anything with query(sql) → {rows}). */
export async function introspect(db) {
  const q = async (s) => (await db.query(s)).rows;
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);
  const cols = await q(`SELECT table_name t, column_name c, is_nullable n FROM information_schema.columns WHERE table_schema='public'`);
  // A trigger that RAISEs on UPDATE (append-only / immutable) or a DO INSTEAD NOTHING rule on UPDATE. tgtype bits:
  // 4 INSERT, 8 DELETE, 16 UPDATE. A trigger that also refuses INSERT marks a FROZEN (retired, read-only) table.
  const trg = await q(`SELECT c.relname t, tg.tgtype::int ty, p.proname f, pg_get_functiondef(p.oid) def
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal`);
  const rules = await q(`SELECT tablename t, definition d FROM pg_rules WHERE schemaname = 'public'`);
  const byTable = new Map(tables.map((t) => [t, { table: t, columns: new Map(), append_only: false, frozen: false }]));
  for (const c of cols) byTable.get(c.t)?.columns.set(c.c, { nullable: c.n === 'YES' });
  for (const r of trg) {
    const t = byTable.get(r.t); if (!t) continue;
    const refuses = /RAISE\s+EXCEPTION/i.test(r.def) && /(append_only|immutable|no_change|no_update|frozen)/i.test(r.f);
    if (!refuses || !(r.ty & 16)) continue;
    if (r.ty & 4) t.frozen = true; else t.append_only = true;
  }
  for (const r of rules) if (/ON UPDATE[\s\S]*DO INSTEAD\s+NOTHING/i.test(r.d)) { const t = byTable.get(r.t); if (t) t.append_only = true; }
  return [...byTable.values()];
}

/** Registry entry per table: heuristics, then overrides.json, then the retention policy (D's file). */
export function buildRegistry(facts, overrides = {}, retention = {}) {
  const ov = overrides.tables ?? {};
  const pol = retention.tables ?? {};
  const out = {};
  for (const f of facts) {
    const o = ov[f.table] ?? {};
    const tenant = f.columns.get('tenant_id');
    const branch = f.columns.get('branch_id');
    const letter = o.ownership ?? ownershipOf(f);
    const domain = o.domain ?? domainOf(f.table);
    const p = pol[f.table];
    out[f.table] = {
      ownership: letter ? OWNERSHIP[letter] ?? `invalid:${letter}` : null,
      class: letter ?? null,
      domain: domain ?? null,
      sensitivity: o.sensitivity ?? sensitivityOf(f.table, [...f.columns.keys()]).cls,
      retention_class: p?.retention_class ?? 'indefinite',
      delete_policy: p?.delete_policy ?? 'none',
      has_tenant_id: !!tenant,
      ...(tenant?.nullable ? { platform_rows: true } : {}),   // tenant_id NULL rows exist by design (platform-level rows)
      has_branch_id: !!branch,
      append_only: f.append_only,
      ...(f.frozen ? { frozen: true } : {}),
      source: o.ownership || o.domain ? 'override' : 'heuristic',
      ...(o.reason ? { reason: o.reason } : {}),
    };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The rules the gate enforces on a freshly built registry. Returns human-readable failures (empty = ok). */
export function ruleViolations(registry, overrides = {}) {
  const errs = [];
  for (const [t, e] of Object.entries(registry)) {
    if (!e.ownership || String(e.ownership).startsWith('invalid:')) errs.push(`${t}: no ownership class (add it to apps/api/db/ownership/overrides.json with a reason)`);
    if (!e.domain) errs.push(`${t}: no domain (add it to overrides.json)`);
    else if (!DOMAINS.includes(e.domain)) errs.push(`${t}: unknown domain ${e.domain}`);
    if ((e.class === 'B' || e.class === 'C') && !e.has_tenant_id) errs.push(`${t}: ${e.ownership} but has no tenant_id`);
    if (e.class === 'C' && !e.has_branch_id) errs.push(`${t}: tenant_branch_owned but has no branch_id`);
    if (e.class === 'A' && e.has_tenant_id) errs.push(`${t}: platform_global but has tenant_id`);
  }
  for (const [t, o] of Object.entries(overrides.tables ?? {})) {
    if (!registry[t]) errs.push(`overrides.json: ${t} is not a table any more — remove the override`);
    if (!o.reason || String(o.reason).trim().length < 8) errs.push(`overrides.json: ${t} needs a reason`);
  }
  return errs;
}

/** Committed registry vs a fresh build: every difference is a failure (a new table, a dropped one, a changed field). */
export function registryDrift(committed, fresh) {
  const errs = [];
  const a = committed ?? {}; const b = fresh;
  for (const t of Object.keys(b)) if (!a[t]) errs.push(`${t}: new table not in the registry`);
  for (const t of Object.keys(a)) if (!b[t]) errs.push(`${t}: in the registry but no longer a table`);
  for (const t of Object.keys(b)) {
    if (!a[t]) continue;
    for (const k of new Set([...Object.keys(a[t]), ...Object.keys(b[t])])) {
      if (JSON.stringify(a[t][k]) !== JSON.stringify(b[t][k])) errs.push(`${t}.${k}: registry says ${JSON.stringify(a[t][k])}, schema says ${JSON.stringify(b[t][k])}`);
    }
  }
  return errs;
}

export function summarise(registry) {
  const count = (k) => Object.values(registry).reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {});
  return { tables: Object.keys(registry).length, ownership: count('ownership'), domain: count('domain'), sensitivity: count('sensitivity'),
    append_only: Object.values(registry).filter((e) => e.append_only).length, platform_rows: Object.values(registry).filter((e) => e.platform_rows).length };
}
