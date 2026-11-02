// demo-revenue-layered.ts — LIVE DEMO of the Schedule A layered/net-first revenue math.
// Runs the REAL repository (KyselyRevenueResidualsRepo) against a REAL Postgres (PGlite) with the REAL
// migrations, seeds Kevin's exact example, and prints what actually lands on the books. Nothing is mocked.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { readFileSync } from 'node:fs';
import { KyselyRevenueResidualsRepo } from './src/super-admin-revenue-residuals/super-admin-revenue-residuals.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const $ = (c: number) => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

async function main() {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('create extension if not exists pgcrypto');
  for (const m of ['221_revenue_residuals', '222_residual_statements', '224_partner_payouts', '225_tenant_incentives', '415_residual_applicable_costs']) {
    const sqlText = readFileSync(`db/migrations/${m}.sql`, 'utf8');
    for (const stmt of sqlText.split(/;\s*\n/)) { const s = stmt.trim(); if (s) await pg.exec(s); }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const repo = new KyselyRevenueResidualsRepo(db as any);

  const TENANT = 'ec000000-0000-0000-0000-0000000000t1'.replace('t1', 'a1');
  // ── Seed: the agreement (economic 40/35/25 — layered 65/35 contractual with 25 carved) ──────────────
  const ag: any = await pg.query(`insert into revenue_agreements (code, name, status, tenant_id, processor) values ('AGR-2026-0010','The Hair Lounge — Processing Residuals','active',$1,'fiserv') returning id`, [TENANT]);
  const agreementId = ag.rows[0].id;
  const ver: any = await pg.query(`insert into revenue_agreement_versions (agreement_id, version_number, ai_powersalon_pct, processor_pct, salon_pct, effective_date) values ($1,1,40,35,25,'2026-05-01') returning id`, [agreementId]);
  await pg.query(`update revenue_agreements set current_version_id = $1 where id = $2`, [ver.rows[0].id, agreementId]);

  // ── Seed: one Fiserv residual statement — $1,000.00 reported residual, $100.00 applicable costs ─────
  await pg.query(`insert into residual_statements (processor, statement_ref, tenant_id, period_start, period_end, processing_residual_cents, applicable_costs_cents, processor_calculated_cents, import_hash)
    values ('fiserv','FSV-2026-05-THL',$1,'2026-05-01','2026-05-31',100000,10000,100000,'demo-hash-1')`, [TENANT]);

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' AI POWERSALON — Revenue & Residuals LIVE DEMO (real repo, real Postgres)');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(` Agreement AGR-2026-0010 · fiserv · configured split 40 / 35 / 25 (layered: 65% contractual, 25 carved)`);
  console.log(` Statement FSV-2026-05-THL · May 2026 · reported residual ${$(100000)} · applicable costs ${$(10000)}`);
  console.log('');

  // ── 1) What Fiserv's side of the books looks like ───────────────────────────────────────────────────
  const p: any = await repo.calculatePartnerPayout({ id: null as any, role: 'SUPER_ADMIN' }, { agreementId, periodStart: '2026-05-01', periodEnd: '2026-05-31' });
  if (!p.ok) throw new Error('partner payout failed: ' + p.error);
  console.log(' 1) PARTNER (Fiserv) — calculatePartnerPayout()');
  console.log(`    Net Revenue pool   ${$(p.eligibleRevenueCents)} − costs ${$(p.applicableCostsCents)}  =  ${$(p.netPoolCents)}`);
  console.log(`    Fiserv retains     ${$(p.partnerGrossShareCents)}   (35% of the NET pool — never of the raw gross)`);
  console.log(`    Fiserv owes AI PowerSalon ${$(p.processorOwesPlatformCents)}   (the contractual 65%)`);
  console.log(`    …of which tenant payable  ${$(p.platformOwesTenantCents)}   (AI PowerSalon-managed, carved out)`);
  console.log(`    AI PowerSalon retains     ${$(p.platformRetainedCents)}   (65 − 25 → 40%)`);
  console.log(`    → payout record ${p.payoutId.slice(0, 8)}… status '${p.status}', amount due ${$(p.amountDueCents)}`);
  console.log('');

  // ── 2) What the salon's side of the books looks like ────────────────────────────────────────────────
  const t: any = await repo.calculateTenantIncentive({ id: null as any, role: 'SUPER_ADMIN' }, { agreementId, tenantId: TENANT, periodStart: '2026-05-01', periodEnd: '2026-05-31' });
  if (!t.ok) throw new Error('tenant incentive failed: ' + t.error);
  console.log(' 2) TENANT (The Hair Lounge) — calculateTenantIncentive()');
  console.log(`    Net Revenue pool   ${$(t.eligibleGrossRevenueCents)} − costs ${$(t.applicableCostsCents)}  =  ${$(t.netPoolCents)}`);
  console.log(`    Incentive earned   ${$(t.incentiveEarnedCents)}   (25% of the NET pool)`);
  console.log(`    → incentive record ${t.incentiveId.slice(0, 8)}… status '${t.status}', amount due ${$(t.currentAmountDueCents)}`);
  console.log('');

  // ── 3) Idempotency: run it again — no double-pay, the SAME record comes back ────────────────────────
  const p2: any = await repo.calculatePartnerPayout({ id: null as any, role: 'SUPER_ADMIN' }, { agreementId, periodStart: '2026-05-01', periodEnd: '2026-05-31' });
  console.log(` 3) IDEMPOTENCY — recalculating the same period: duplicate=${p2.duplicate}, same payout ${p2.payoutId === p.payoutId}`);
  console.log('');

  // ── 4) The audit trail that actually landed ─────────────────────────────────────────────────────────
  const audit: any = await pg.query(`select action, field, new_value from revenue_audit_log order by created_at`);
  console.log(' 4) APPEND-ONLY AUDIT LOG (revenue_audit_log)');
  for (const r of audit.rows) console.log(`    · ${r.action}  ${r.field}=${r.new_value}`);
  console.log('');

  const check = p.partnerGrossShareCents + p.platformRetainedCents + p.platformOwesTenantCents;
  console.log(` RECONCILIATION  ${$(p.partnerGrossShareCents)} + ${$(p.platformRetainedCents)} + ${$(p.platformOwesTenantCents)} = ${$(check)}  (= net pool: ${check === p.netPoolCents})`);
  console.log('══════════════════════════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch((e) => { console.error('DEMO FAILED:', e?.message || e); process.exit(1); });
