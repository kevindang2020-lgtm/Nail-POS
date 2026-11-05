#!/usr/bin/env node
// generate-db-docs.mjs — Constitution 1 §104 (documentation) / §3 / §7 / §105: the ERD + domain + ownership document,
// GENERATED from the real schema (every migration replayed into PGlite through the shared migration rules, then
// introspected). Domains and ownership come from the SAME code as the ownership registry (db/ownership/*), so the doc and
// the `check:db-ownership` gate cannot disagree. Never hand-edit the output. Regenerate:
//   cd apps/api && node scripts/generate-db-docs.mjs > ../../DB_ERD_AND_DOMAINS.md
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migratedPglite } from '../../../packages/testing/src/pgtest-schema.mjs';
import { introspect, buildRegistry, summarise } from '../db/ownership/registry.mjs';
import { DOMAINS, OWNERSHIP } from '../db/ownership/heuristics.mjs';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const files = readdirSync(join(API, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const db = await migratedPglite();
const reg = buildRegistry(await introspect(db), readJson(join(API, 'db', 'ownership', 'overrides.json'), {}), readJson(join(API, 'db', 'retention-policy.json'), {}));
const sum = summarise(reg);
const tables = Object.keys(reg);
const colCount = Object.fromEntries((await db.query(`SELECT table_name, count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' GROUP BY 1`)).rows.map((r) => [r.table_name, r.n]));
const fks = (await db.query(`SELECT r.relname AS src, p.relname AS dst, a.attname AS col, k.convalidated AS valid
  FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
  WHERE k.contype = 'f' AND r.relnamespace = 'public'::regnamespace ORDER BY 1, 2, 3`)).rows;
const idxCount = Object.fromEntries((await db.query(`SELECT tablename, count(*)::int AS n FROM pg_indexes WHERE schemaname='public' GROUP BY 1`)).rows.map((r) => [r.tablename, r.n]));
await db.close?.();

const byDomain = new Map(DOMAINS.map((d) => [d, []]));
for (const t of tables) byDomain.get(reg[t].domain)?.push(t);
const letter = Object.fromEntries(Object.entries(OWNERSHIP).map(([k, v]) => [v, k]));

let out = `# DB_ERD_AND_DOMAINS.md\n\n**GENERATED FROM THE REAL SCHEMA — do not hand-edit.** All ${files.length} migrations replayed into PGlite (PG16) through\n\`apps/api/db/migration-sql.mjs\`, then introspected. Regenerate: \`cd apps/api && node scripts/generate-db-docs.mjs > ../../DB_ERD_AND_DOMAINS.md\`\n\n`;
out += `**${tables.length} tables · ${fks.length} foreign keys (${fks.filter((f) => !f.valid).length} NOT VALID) · ${Object.values(idxCount).reduce((a, n) => a + n, 0)} indexes · ${tables.filter((t) => reg[t].has_tenant_id).length} tables carry \`tenant_id\`.**\n\n`;
out += `Ownership class (Constitution 1 §3) and domain (§7) per table are the machine-readable registry\n\`apps/api/db/ownership/registry.generated.json\` (gate \`check:db-ownership\`): heuristics in \`db/ownership/heuristics.mjs\`,\nhand decisions with reasons in \`db/ownership/overrides.json\`. Sensitivity uses Constitution 12's classes; retention and delete\npolicy come from \`apps/api/db/retention-policy.json\` (absent = indefinite / none).\n\n`;
out += `## Ownership classes\n\n| Class | Meaning | Tables |\n| --- | --- | ---: |\n`;
const meaning = { A: 'platform-global — no tenant_id', B: 'tenant-owned — tenant_id required', C: 'tenant + branch owned — tenant_id and NOT NULL branch_id', D: 'platform identity / tenant relationship', E: 'intentionally cross-tenant — explicit visibility rules' };
for (const [k, v] of Object.entries(OWNERSHIP)) out += `| ${k} \`${v}\` | ${meaning[k]} | ${sum.ownership[v] ?? 0} |\n`;
out += `\n${sum.platform_rows} tables have a nullable tenant_id (rows with NULL are platform-level rows by design, flagged \`platform_rows\` in the registry;\nConstitution 1 §3 E: a nullable tenant_id never by itself makes data cross-tenant). ${sum.append_only} tables are append-only (a trigger or rule refuses UPDATE).\n`;

out += `\n## Domain overview\n\n| Domain | Tables | A | B | C | D | E | With tenant_id | FKs out |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const d of DOMAINS) {
  const ts = byDomain.get(d); const set = new Set(ts);
  const n = (k) => ts.filter((t) => reg[t].class === k).length;
  out += `| ${d} | ${ts.length} | ${n('A')} | ${n('B')} | ${n('C')} | ${n('D')} | ${n('E')} | ${ts.filter((t) => reg[t].has_tenant_id).length} | ${fks.filter((f) => set.has(f.src)).length} |\n`;
}

out += `\n## Source of truth (§105)\n\nOne authoritative table per business fact. Duplicates found by the Phase 10 audit and how each is resolved:\n\n| Fact | Authoritative | Not authoritative |\n| --- | --- | --- |\n`;
const SOT = [
  ['Tenant (salon)', 'tenants', '—'],
  ['Staff sign-in identity', 'users (one row per tenant membership)', '—'],
  ['Customer sign-in identity', 'customer_identities', 'global_customers (cross-salon customer root — which root wins is Kevin\'s decision)'],
  ['Salon customer relationship', 'customers', '—'],
  ['Appointment', 'pos_tech_appointments', '—'],
  ['Current queue state', 'pos_queue_items', '—'],
  ['Ticket / sale', 'tickets + ticket_service_lines', '—'],
  ['Payment', 'payments (+ payment_refunds)', 'payment_intents / payment_attempts (attempt history)'],
  ['Loyalty balance', 'loyalty_ledger (sum of delta)', 'customer_loyalty_profiles.points_balance (materialised, reconciled daily); loyalty_point_earnings (per-payment earn events)'],
  ['Gift card balance', 'gift_card_transactions', 'gift_cards.balance_cents (materialised)'],
  ['Inventory on hand', 'inventory_stock_movements + inventory_location_stock (projection)', '—'],
  ['Deal redemption', 'deal_redemptions', 'customer_deals / tenant_promotion_redemptions (frozen legacy stores)'],
  ['Audit trail', 'audit_events (platform) and audit_logs (tenant-facing log) — both append-only', '—'],
  ['Support access session', 'support_access_sessions', 'super_admin_support_sessions, membership_support_sessions (merged away in Phase 10)'],
  ['Idempotency key', 'api_idempotency (scope column)', 'ai_checkout_upsell_idempotency, voice_gateway_idempotency (merged away in Phase 10)'],
  ['Domain events', 'outbox_events (+ processed_events for consumers)', '—'],
];
for (const [f, a, n] of SOT) out += `| ${f} | ${a} | ${n} |\n`;

const CORE = ['BOOKING', 'CHECKOUT', 'PAYMENTS', 'CUSTOMERS', 'LOYALTY', 'WORKFORCE', 'INVENTORY', 'COMMUNICATIONS'];
for (const d of CORE) {
  const ts = new Set(byDomain.get(d));
  const seen = new Set();
  const edges = fks.filter((f) => ts.has(f.src) && ts.has(f.dst) && f.src !== f.dst).filter((e) => { const k = e.src + '>' + e.dst + '>' + e.col; if (seen.has(k)) return false; seen.add(k); return true; });
  out += `\n## ${d} — ERD (FK edges within the domain)\n\n`;
  if (!edges.length) out += '_No FK edges inside this domain (its tables reference parents in other domains)._\n';
  else { out += '```mermaid\nerDiagram\n'; for (const e of edges.slice(0, 80)) out += `  ${e.dst} ||--o{ ${e.src} : "${e.col}"\n`; out += '```\n'; }
  const cross = [...new Set(fks.filter((f) => ts.has(f.src) && !ts.has(f.dst)).map((c) => c.dst))].sort();
  if (cross.length) out += `Parents in other domains: ${cross.slice(0, 16).join(', ')}${cross.length > 16 ? ` (+${cross.length - 16})` : ''}.\n`;
}

out += `\n## Full table inventory\n\nClass: §3 letter. T/B: tenant_id / branch_id present. AO: append-only.\n\n| Table | Domain | Class | Sensitivity | Retention / delete | Cols | Idx | T | B | AO |\n| --- | --- | :-: | --- | --- | ---: | ---: | :-: | :-: | :-: |\n`;
for (const t of tables) {
  const e = reg[t];
  out += `| ${t} | ${e.domain} | ${letter[e.ownership] ?? '?'}${e.platform_rows ? '*' : ''} | ${e.sensitivity} | ${e.retention_class} / ${e.delete_policy} | ${colCount[t] ?? 0} | ${idxCount[t] ?? 0} | ${e.has_tenant_id ? '✓' : '—'} | ${e.has_branch_id ? '✓' : '—'} | ${e.append_only ? '✓' : e.frozen ? 'frozen' : ''} |\n`;
}
out += `\n\\* tenant_id nullable — NULL rows are platform-level rows.\n`;
process.stdout.write(out);
process.exit(0);
