#!/usr/bin/env node
// check-unassigned-terminals.mjs — paired card terminals with NO location (Nov 5 2026).
//
// Since migration 701 a terminal only takes card payments at its own location, so a paired terminal with branch_id NULL
// is refused ("no paired terminal") on the customer display and on POS Card. Migration 702 assigns these automatically for
// salons with exactly ONE location; a salon with several must choose in POS → Devices → Payment Terminals
// ("Assign to this location"). This lists what is still unassigned, per salon, so nobody finds out at the front desk.
//
//   DATABASE_URL=… node scripts/check-unassigned-terminals.mjs            warn only (exit 0) — runs after migrate on deploy
//   DATABASE_URL=… node scripts/check-unassigned-terminals.mjs --strict   exit 1 if any remain (manual pre-deploy check)
//
// Prints salon names, terminal labels and counts only — never an HSN, a key or a merchant id. Read-only.
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Rows: one per unassigned terminal, with its salon and how many active locations that salon has. */
export async function unassignedTerminals(query) {
  const r = await query(`
    select t.tenant_id, coalesce(tn.display_name, tn.legal_name, t.tenant_id) as salon, t.label,
           (select count(*)::int from branches b where b.tenant_id::text = t.tenant_id and b.deleted_at is null) as locations
      from pos_payment_terminals t
      left join tenants tn on tn.id::text = t.tenant_id
     where t.branch_id is null and t.status = 'paired'
     order by salon, t.label`);
  return r.rows;
}

export function report(rows) {
  if (!rows.length) return ['unassigned-terminals: none — every paired terminal belongs to a location'];
  const out = [`unassigned-terminals: WARN ${rows.length} paired terminal(s) have no location and take NO card payments until assigned:`];
  for (const r of rows) out.push(`  - ${r.salon} (${r.locations} location${r.locations === 1 ? '' : 's'}): "${r.label ?? 'Terminal'}"`);
  out.push('  Fix: POS → Devices → Payment Terminals → "Assign to this location", signed in at the location the terminal is in.');
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('unassigned-terminals: DATABASE_URL is not set'); process.exit(2); }
  const strict = process.argv.includes('--strict');
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, application_name: 'check-unassigned-terminals' });
  try {
    await c.connect();
    const rows = await unassignedTerminals((sql) => c.query(sql));
    for (const l of report(rows)) console.log(l);
    process.exitCode = strict && rows.length ? 1 : 0;
  } catch (e) {
    // never block a deploy on the check itself failing (e.g. the table is not there yet on a brand-new database)
    console.log(`unassigned-terminals: could not check (${String(e?.message ?? e).slice(0, 160)})`);
    process.exitCode = strict ? 1 : 0;
  } finally { await c.end().catch(() => undefined); }
}
