/* merchant-accounts-smoke.ts — exercises the REAL SuperAdminMerchantAccountsService against live Postgres. Seeds a
 * small multi-tenant fixture (tenant_payment_config + terminals), runs the exact service the controller serves, and
 * asserts the aggregates are real, reconcile, scope by tenant, mask/omit secrets, and honestly mark un-modelled
 * sections. Cleans up after itself. Run: DATABASE_URL=postgres://… npx tsx scripts/merchant-accounts-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { SuperAdminMerchantAccountsRepository } from '../../../modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.kysely.repository';
import { SuperAdminMerchantAccountsService } from '../../../modules/super-admin/src/super-admin-merchant-accounts/super-admin-merchant-accounts.service';
import { decryptFunding } from '../src/common/funding-crypto';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

const tA = 'ccdd1111-1111-1111-1111-111111111111';
const tB = 'ccdd2222-2222-2222-2222-222222222222';
const tC = 'ccdd3333-3333-3333-3333-333333333333';
const bA1 = 'ccddbb01-0000-0000-0000-000000000001';
const bA2 = 'ccddbb01-0000-0000-0000-000000000002';
const bB1 = 'ccddbb02-0000-0000-0000-000000000001';
const planPremium = 'ccddaa01-0000-0000-0000-0000000000a1';
const termA1 = 'ccddcc01-0000-0000-0000-000000000001';
const termA2 = 'ccddcc01-0000-0000-0000-000000000002';
const termB1 = 'ccddcc02-0000-0000-0000-000000000001';
const ids = [tA, tB, tC];

async function clean() {
  await sql`delete from merchant_account_alerts where tenant_id = any(${ids})`.execute(db);
  await sql`delete from merchant_funding_profiles where tenant_id = any(${ids})`.execute(db);
  await sql`delete from merchant_risk_reviews where tenant_id = any(${ids})`.execute(db);
  await sql`delete from merchant_rate_schedules where tenant_id = any(${ids})`.execute(db);
  await sql`delete from merchant_pricing_plans where key = 'premium-ma-smoke'`.execute(db);
  await sql`delete from pos_payment_terminals where tenant_id = any(${ids})`.execute(db);
  await sql`delete from tenant_payment_config where tenant_id = any(${ids})`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where tenant_id = any(${ids}) and module='merchant-accounts'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from branches where tenant_id = any(${ids})`.execute(db);
  await sql`delete from tenants where id = any(${ids})`.execute(db);
}

async function seed() {
  await clean();
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'gl-ma', 'GLMA'),
    (${tB}, 'Luxe Salon LLC', 'Luxe Salon', 'lx-ma', 'LXMA'),
    (${tC}, 'Radiant Beauty LLC', 'Radiant Beauty', 'rb-ma', 'RBMA')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values
    (${bA1}, ${tA}, 'Downtown'), (${bA2}, ${tA}, 'Uptown'), (${bB1}, ${tB}, 'Main St.')`.execute(db);
  // merchant accounts (per tenant). Encrypted-credential columns are set to prove they are NEVER surfaced.
  await sql`insert into tenant_payment_config (tenant_id, processor, merchant_id, status, onboarding_status, environment, api_password_enc, webhook_secret_enc) values
    (${tA}, 'fiserv', 'MID-202605-001', 'active', 'approved', 'production', 'SECRET_pw_enc', 'SECRET_wh_enc'),
    (${tB}, 'cardpointe', 'MID-202605-002', 'pending', 'submitted', 'sandbox', 'SECRET_pw2', 'SECRET_wh2'),
    (${tC}, 'clover', 'MID-202605-005', 'disabled', 'under_review', 'sandbox', 'SECRET_pw3', 'SECRET_wh3')`.execute(db);
  // terminals: tA ×2 active on a branch (assigned); tB ×1 with no branch (unassigned); tC none.
  await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status) values
    (${termA1}, ${tA}, ${bA1}, 'Clover Flex #2', 'active'), (${termA2}, ${tA}, ${bA1}, 'Front Desk iPad #1', 'active'),
    (${termB1}, ${tB}, null, 'Unassigned Term', 'active')`.execute(db);
  // Structured, decimal-safe rate schedules for tA: a superseded past rate, the in-force active rate (2.49% + $0.15,
  // Premium plan), and a future-dated rate. Only the in-force one must surface; history is preserved.
  await sql`insert into merchant_pricing_plans (id, key, name, sort) values (${planPremium}, 'premium-ma-smoke', 'Premium', 1)`.execute(db);
  await sql`insert into merchant_rate_schedules (tenant_id, pricing_plan_id, percentage_basis_points, per_txn_fee_minor, effective_at, status) values
    (${tA}, ${planPremium}, 260, 30, now() - interval '60 days', 'superseded'),
    (${tA}, ${planPremium}, 249, 15, now() - interval '10 days', 'approved'),
    (${tA}, ${planPremium}, 199, 10, now() + interval '30 days', 'approved')`.execute(db);
  // Risk reviews (append-only, latest-wins): tA older medium → latest low; tC latest high; tB older high → latest low.
  await sql`insert into merchant_risk_reviews (tenant_id, risk_level, reviewed_at, reviewer_name) values
    (${tA}, 'medium', now() - interval '20 days', 'Risk Bot'),
    (${tA}, 'low', now() - interval '2 days', 'Risk Bot'),
    (${tC}, 'high', now() - interval '1 days', 'Risk Bot'),
    (${tB}, 'high', now() - interval '30 days', 'Risk Bot'),
    (${tB}, 'low', now() - interval '3 days', 'Risk Bot')`.execute(db);
  // Funding profiles (append-only, current = superseded_at is null). Encrypted-vault columns are set to prove they are
  // NEVER surfaced. tA verified/next-day (Chase •••• 4342) with a superseded old profile; tB pending + issue; tC issue.
  await sql`insert into merchant_funding_profiles (tenant_id, funding_schedule, bank_verification_status, bank_name, account_type, account_last4, routing_last4, bank_account_enc, routing_number_enc, has_funding_issue, funding_issue_type, effective_at, superseded_at) values
    (${tA}, 'weekly', 'submitted', 'Old Bank', 'checking', '0000', '1111', 'SECRET_old_acct', 'SECRET_old_rt', false, null, now() - interval '90 days', now() - interval '30 days'),
    (${tA}, 'next_day', 'verified', 'Chase Bank', 'checking', '4342', '0021', 'SECRET_acct_enc', 'SECRET_routing_enc', false, null, now() - interval '30 days', null),
    (${tB}, 'weekly', 'pending', 'Wells Fargo', 'savings', '8899', '0044', 'SECRET_b_acct', 'SECRET_b_rt', true, 'bank_verification_pending', now() - interval '10 days', null),
    (${tC}, 'not_configured', 'not_started', null, null, null, null, null, null, true, 'document_expired', now() - interval '5 days', null)`.execute(db);
  // Alerts: two open (tA warning, tB critical) + one resolved (tC, excluded from the active module).
  await sql`insert into merchant_account_alerts (tenant_id, merchant_id, alert_type, severity, summary, status) values
    (${tA}, 'MID-202605-001', 'risk_review', 'warning', 'High-risk flag requires review', 'open'),
    (${tB}, 'MID-202605-002', 'underwriting_declined', 'critical', 'Underwriting declined — action required', 'investigating'),
    (${tC}, 'MID-202605-005', 'document_expired', 'warning', 'Document expired', 'resolved')`.execute(db);
}

async function main() {
  await seed();
  const svc = new SuperAdminMerchantAccountsService(new SuperAdminMerchantAccountsRepository(db as any));
  const ctx = { userId: 'u_super', email: 'super_admin' };

  const o: any = await svc.getOverview(ctx, {});
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);

  // ── KPIs (real) ──
  check('KPI total merchant accounts = 3', kpi('total').value === 3, String(kpi('total').value));
  check('KPI active = 1', kpi('active').value === 1, String(kpi('active').value));
  check('KPI pending underwriting = 2 (submitted + under_review)', kpi('pending_underwriting').value === 2, String(kpi('pending_underwriting').value));
  check('KPI inactive = 1 (disabled)', kpi('inactive').value === 1, String(kpi('inactive').value));
  check('KPI assigned terminals = 3', kpi('assigned_terminals').value === 3, String(kpi('assigned_terminals').value));
  check('KPI bank verification pending = 1 (tB) + available', kpi('bank_verification_pending').available === true && kpi('bank_verification_pending').value === 1, String(kpi('bank_verification_pending').value));
  check('KPI funding issues = 2 (tB + tC) + available', kpi('funding_issues').available === true && kpi('funding_issues').value === 2, String(kpi('funding_issues').value));

  // ── distributions (reconcile) ──
  const pd = o.processorDistribution;
  check('processor distribution total = 3 (fiserv/cardpointe/clover ×1)', pd.total === 3 && pd.segments.length === 3, `${pd.total}/${pd.segments.length}`);
  check('processor distribution surfaces only Fiserv/CardPointe/Clover', pd.segments.every((s: any) => ['fiserv', 'cardpointe', 'clover'].includes(s.key)));
  const sb = o.merchantStatusBreakdown;
  const seg = (b: any, k: string) => b.segments.find((s: any) => s.key === k)?.count ?? 0;
  check('status breakdown active 1 / pending 1 / inactive 1', seg(sb, 'active') === 1 && seg(sb, 'pending') === 1 && seg(sb, 'inactive') === 1, JSON.stringify(sb.segments));
  const uw = o.underwritingPipeline;
  const stg = (k: string) => uw.stages.find((s: any) => s.key === k)?.count ?? 0;
  check('underwriting pipeline submitted=3 in_review=1 approved=1', stg('submitted') === 3 && stg('under_review') === 1 && stg('approved') === 1, JSON.stringify(uw.stages));
  const to = o.terminalAssignmentOverview;
  check('terminal overview total 3, assigned 2, unassigned 1', to.total === 3 && seg(to, 'assigned') === 2 && seg(to, 'unassigned') === 1, JSON.stringify(to.segments));

  // ── directory rows (shaped, masked, no secrets) ──
  const rowA = o.merchants.find((m: any) => m.tenantId === tA);
  check('directory row A: MID + Fiserv + Active + 2 terminals', rowA && rowA.merchantId === 'MID-202605-001' && rowA.processorLabel === 'Fiserv' && rowA.processingStatusLabel === 'Active' && rowA.terminalAssignments === 2, JSON.stringify(rowA?.processingStatusLabel));
  check('directory row A: legal business name from tenant', rowA?.legalBusinessName === 'Glamour Studio LLC', rowA?.legalBusinessName);
  // rate schedules (Unit 3): the in-force rate surfaces decimal-safe; superseded + future rates do NOT.
  check('directory row A: active rate = 2.49% + $0.15 (in-force schedule)', rowA?.processingRatesAvailable === true && rowA?.processingRates === '2.49% + $0.15', rowA?.processingRates);
  check('directory row A: pricing plan = Premium (from active schedule)', rowA?.pricingPlanAvailable === true && rowA?.pricingPlan === 'Premium', rowA?.pricingPlan);
  const rowB = o.merchants.find((m: any) => m.tenantId === tB);
  check('directory row B: no rate configured → honest — (available:false)', rowB && rowB.processingRatesAvailable === false && rowB.processingRates === '—');
  // risk reviews (Unit 4): current risk = latest review (latest-wins); high-risk KPI + module surface real data.
  check('directory row A: current risk = Low (latest review, not older medium)', rowA?.riskStatusAvailable === true && rowA?.riskStatusLabel === 'Low', rowA?.riskStatusLabel);
  check('KPI high risk = 1 (only tC latest high) + available', kpi('high_risk').available === true && kpi('high_risk').value === 1, String(kpi('high_risk').value));
  check('high-risk module surfaces tC (MID-202605-005), latest-wins excludes tB', o.highRiskAccounts.available === true && o.highRiskAccounts.total === 1 && o.highRiskAccounts.items.length === 1 && o.highRiskAccounts.items[0].merchantId === 'MID-202605-005', JSON.stringify(o.highRiskAccounts.items));
  // funding profiles (Unit 5): bank verification + funding schedule surface; funding issues reconcile; masking enforced.
  check('directory row A: bank verification = Verified (current profile)', rowA?.bankVerificationAvailable === true && rowA?.bankVerificationLabel === 'Verified', rowA?.bankVerificationLabel);
  check('directory row A: funding schedule = Next Day (current, not superseded weekly)', rowA?.fundingScheduleAvailable === true && rowA?.fundingScheduleLabel === 'Next Day', rowA?.fundingScheduleLabel);
  check('directory row C: not_configured funding → honest — (available:false)', o.merchants.find((m: any) => m.tenantId === tC)?.fundingScheduleAvailable === false);
  const tfi = o.topFundingIssues;
  check('top funding issues available, total 2, reconciles by type', tfi.available === true && tfi.total === 2 && tfi.items.find((i: any) => i.key === 'bank_verification_pending')?.count === 1 && tfi.items.find((i: any) => i.key === 'document_expired')?.count === 1, JSON.stringify(tfi.items));
  // alerts (Unit 6): open/active alerts surface; resolved excluded; critical ranks first.
  check('alerts module available, total 2 (open), resolved excluded', o.alerts.available === true && o.alerts.total === 2 && o.alerts.items.length === 2, String(o.alerts.total));
  check('alerts: critical (tB) ranked first with safe summary', o.alerts.items[0].severity === 'critical' && o.alerts.items[0].merchantId === 'MID-202605-002' && /action required/i.test(o.alerts.items[0].summary), JSON.stringify(o.alerts.items[0]));
  const blob = JSON.stringify(o);
  check('NO secrets anywhere in overview (no *_enc / secret / password)', !/_enc|SECRET_|webhook_secret|api_password|"password"/i.test(blob));

  // ── selected merchant + honest funding ──
  const sel: any = await svc.getOverview(ctx, { selected: tA });
  const f = sel.selectedMerchant?.funding;
  check('selected merchant: secure funding masked (•••• 4342, Chase Bank, Checking), no full number', sel.selectedMerchant?.merchantId === 'MID-202605-001' && f?.available === true && f.bankAccount === '•••• 4342' && f.bankName === 'Chase Bank' && f.accountType === 'Checking' && /encrypted/i.test(f.note), JSON.stringify(f));
  check('selected merchant: no full account / routing / *_enc surfaces', !/SECRET_|_enc|routing_number|bank_account_enc/i.test(JSON.stringify(sel.selectedMerchant)));

  // ── list endpoint + filters ──
  const list: any = await svc.getList(ctx, { pageSize: 10 });
  check('directory list returns 3 rows', list.total === 3 && list.rows.length === 3, String(list.total));
  const listFiserv: any = await svc.getList(ctx, { processor: 'fiserv' });
  check('processor filter (fiserv) → 1', listFiserv.total === 1, String(listFiserv.total));
  const listActive: any = await svc.getList(ctx, { processingStatus: 'active' });
  check('processing-status filter (active) → 1', listActive.total === 1, String(listActive.total));
  const searchHit: any = await svc.getList(ctx, { search: 'MID-202605-002' });
  check('search by merchant id → 1 (tB)', searchHit.total === 1 && searchHit.rows[0].tenantId === tB, String(searchHit.total));
  const listHighRisk: any = await svc.getList(ctx, { riskStatus: 'high' });
  check('risk filter (high) → 1 (tC only, latest-wins)', listHighRisk.total === 1 && listHighRisk.rows[0].tenantId === tC, String(listHighRisk.total));
  const listNextDay: any = await svc.getList(ctx, { fundingSchedule: 'next_day' });
  check('funding-schedule filter (next_day) → 1 (tA)', listNextDay.total === 1 && listNextDay.rows[0].tenantId === tA, String(listNextDay.total));
  check('list rows carry no secrets', !/_enc|SECRET_|password/i.test(JSON.stringify(list.rows)));

  // ── tenant scope isolation ──
  const oa: any = await svc.getOverview(ctx, { tenantId: tA });
  check('tenant scope narrows to tA (total 1, active 1)', oa.kpis.find((x: any) => x.key === 'total').value === 1 && oa.kpis.find((x: any) => x.key === 'active').value === 1);
  const listB: any = await svc.getList(ctx, { tenantId: tB });
  check('tenant scope isolates directory (tB → 1 row, its own)', listB.total === 1 && listB.rows[0].tenantId === tB, String(listB.total));

  // ── audit ──
  const auditCount: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and tenant_id = any(${ids})`.execute(db);
  check('tenant-scoped reads write audit rows', auditCount.rows[0].c >= 2, String(auditCount.rows[0].c));

  // ── Server-side audited export (Unit 12) ──
  const ex: any = await svc.exportReport(ctx, {});
  check('export returns CSV with header + all rows', ex.ok && ex.mimeType === 'text/csv' && ex.rowCount === 3 && ex.csv.startsWith('Merchant ID,Processor,Tenant'), String(ex.rowCount));
  check('export honestly reports XLSX/PDF unavailable (CSV only)', ex.formats.csv === true && ex.formats.xlsx === false && ex.formats.pdf === false);
  check('export CSV contains NO secrets / full bank numbers / *_enc', !/SECRET_|_enc|api_password|webhook_secret|000123456789|021000021/i.test(ex.csv));
  const exFiltered: any = await svc.exportReport(ctx, { processor: 'fiserv' });
  check('export respects processor filter (fiserv → 1 row)', exFiltered.rowCount === 1, String(exFiltered.rowCount));
  const exScoped: any = await svc.exportReport(ctx, { tenantId: tA });
  const exAudit: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and action='export_generated' and tenant_id = ${tA}`.execute(db);
  check('tenant-scoped export writes an audit event', exScoped.ok && exAudit.rows[0].c >= 1, String(exAudit.rows[0].c));

  // ── Controlled write: Configure Processing Rates (Unit 7) ──
  const w1: any = await svc.configureRates(ctx, tB, { percentageBasisPoints: 310, perTxnFeeMinor: 20, changeReason: 'initial pricing' });
  check('configure rates: creates schedule for tB, before null, after 3.10% + $0.20', w1.ok && w1.idempotent === false && w1.before === null && w1.after.display === '3.10% + $0.20', JSON.stringify(w1.after));
  const oAfter: any = await svc.getOverview(ctx, {});
  const rowBAfter = oAfter.merchants.find((m: any) => m.tenantId === tB);
  check('directory reflects the newly configured tB rate', rowBAfter?.processingRatesAvailable === true && rowBAfter?.processingRates === '3.10% + $0.20', rowBAfter?.processingRates);
  const w2: any = await svc.configureRates(ctx, tB, { percentageBasisPoints: 310, perTxnFeeMinor: 20, changeReason: 'dup', effectiveAt: w1.effectiveAt });
  check('idempotent re-submit returns same schedule (no duplicate)', w2.idempotent === true && w2.scheduleId === w1.scheduleId);
  const cntB: any = await sql`select count(*)::int as c from merchant_rate_schedules where tenant_id = ${tB}`.execute(db);
  check('only one rate schedule row for tB after idempotent re-submit', cntB.rows[0].c === 1, String(cntB.rows[0].c));
  const cntBeforeA: any = await sql`select count(*)::int as c from merchant_rate_schedules where tenant_id = ${tA}`.execute(db);
  const w3: any = await svc.configureRates(ctx, tA, { percentageBasisPoints: 239, perTxnFeeMinor: 10, changeReason: 'promo', pricingPlanId: planPremium });
  const cntAfterA: any = await sql`select count(*)::int as c from merchant_rate_schedules where tenant_id = ${tA}`.execute(db);
  check('history preserved: tA schedule count += 1 (append, prior rows not overwritten)', cntAfterA.rows[0].c === cntBeforeA.rows[0].c + 1, `${cntBeforeA.rows[0].c}->${cntAfterA.rows[0].c}`);
  check('before/after captured: prior 2.49% → new in-force 2.39% + $0.10', w3.before?.display === '2.49% + $0.15' && w3.after.display === '2.39% + $0.10', JSON.stringify({ b: w3.before?.display, a: w3.after.display }));
  let threw = 0;
  for (const bad of [
    { percentageBasisPoints: -1, changeReason: 'x' },
    { percentageBasisPoints: 250 },
    { percentageBasisPoints: 250, changeReason: 'x', pricingPlanId: 'ccddaa01-0000-0000-0000-0000000000ff' },
  ]) { try { await svc.configureRates(ctx, tB, bad); } catch { threw++; } }
  try { await svc.configureRates(ctx, 'ccdd9999-9999-9999-9999-999999999999', { percentageBasisPoints: 250, changeReason: 'x' }); } catch { threw++; }
  check('validation rejects bad bps / missing reason / unknown plan / unknown merchant', threw === 4, String(threw));
  const auditRates: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and action='rates_configured' and tenant_id = any(${ids})`.execute(db);
  check('rates_configured audit events written (before/after recorded)', auditRates.rows[0].c >= 2, String(auditRates.rows[0].c));

  // ── Controlled write: Activate / Deactivate Processing (Unit 8) ──
  const d1: any = await svc.setProcessingStatus(ctx, tA, 'deactivate', { reason: 'compliance audit' });
  check('deactivate tA → status inactive', d1.ok && d1.status === 'inactive', d1.status);
  const oDeact: any = await svc.getOverview(ctx, {});
  check('directory reflects tA deactivated', oDeact.merchants.find((m: any) => m.tenantId === tA)?.processingStatus === 'inactive');
  const a1: any = await svc.setProcessingStatus(ctx, tA, 'activate', { reason: 'ready for production' });
  check('activate tA → passes all blocking checks, status active', a1.ok === true && a1.blocked === false && a1.status === 'active', JSON.stringify({ ok: a1.ok, blocked: a1.blocked }));
  const aBlocked: any = await svc.setProcessingStatus(ctx, tC, 'activate', { reason: 'attempt' });
  const blockerKeys = (aBlocked.blockers || []).map((b: any) => b.key);
  check('activate tC → BLOCKED listing unmet requirements (underwriting/bank/pricing)', aBlocked.ok === false && aBlocked.blocked === true && ['underwriting_approved', 'bank_verified', 'pricing_configured'].every((k) => blockerKeys.includes(k)), JSON.stringify(blockerKeys));
  const cStatus: any = await sql`select status from tenant_payment_config where tenant_id = ${tC}`.execute(db);
  check('blocked activation did NOT change tC status (still disabled)', cStatus.rows[0].status === 'disabled', cStatus.rows[0].status);
  let threw2 = 0;
  try { await svc.setProcessingStatus(ctx, tA, 'deactivate', {}); } catch { threw2++; }
  try { await svc.setProcessingStatus(ctx, 'ccdd9999-9999-9999-9999-999999999999', 'activate', { reason: 'x' }); } catch { threw2++; }
  check('status write rejects missing reason / unknown merchant', threw2 === 2, String(threw2));
  const auditStatus: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and action in ('processing_activated','processing_deactivated','processing_activation_blocked') and tenant_id = any(${ids})`.execute(db);
  check('processing lifecycle audit events written (transitions recorded)', auditStatus.rows[0].c >= 3, String(auditStatus.rows[0].c));

  // ── Controlled write: Secure Funding Update (Unit 9) ──
  let stepUpThrew = false;
  try { await svc.updateFunding(ctx, tA, { accountNumber: '000123456789', routingNumber: '021000021', bankName: 'New Bank', accountType: 'savings', reason: 'owner change' }); } catch (e: any) { stepUpThrew = /step_up/i.test(String(e?.message)); }
  check('funding update WITHOUT step-up is rejected (step_up_required)', stepUpThrew);
  const fu: any = await svc.updateFunding(ctx, tA, { stepUpConfirmed: true, accountNumber: '000123456789', routingNumber: '021000021', bankName: 'New Bank', accountType: 'savings', reason: 'owner change' });
  check('funding update: masked before (•••• 4342) → after (•••• 6789), verification reset to pending', fu.ok && fu.before?.bankAccount === '•••• 4342' && fu.after.bankAccount === '•••• 6789' && fu.verificationStatus === 'pending', JSON.stringify({ b: fu.before?.bankAccount, a: fu.after.bankAccount }));
  check('funding update response contains NO full account/routing number', !/000123456789|123456789|021000021/.test(JSON.stringify(fu)));
  const curFund: any = await sql`select account_last4, bank_verification_status, bank_account_enc, routing_number_enc from merchant_funding_profiles where tenant_id = ${tA} and superseded_at is null`.execute(db);
  check('exactly one current funding profile after update (old superseded)', curFund.rows.length === 1 && curFund.rows[0].account_last4 === '6789' && curFund.rows[0].bank_verification_status === 'pending', JSON.stringify(curFund.rows.length));
  check('full account/routing stored encrypted in vault columns (round-trips)', !!curFund.rows[0].bank_account_enc && decryptFunding(curFund.rows[0].bank_account_enc) === '000123456789' && decryptFunding(curFund.rows[0].routing_number_enc) === '021000021');
  check('vault columns hold ciphertext, not the raw number', !/000123456789/.test(curFund.rows[0].bank_account_enc));
  const oldFund: any = await sql`select count(*)::int as c from merchant_funding_profiles where tenant_id = ${tA} and superseded_at is not null`.execute(db);
  check('prior funding profile preserved (superseded, history kept)', oldFund.rows[0].c >= 1, String(oldFund.rows[0].c));
  const fundAudit: any = await sql`select metadata::text as m from audit_events where module='merchant-accounts' and action='funding_updated' and tenant_id = ${tA} order by occurred_at desc limit 1`.execute(db);
  check('funding_updated audit written with masked values only (no full number)', fundAudit.rows.length === 1 && !/000123456789|021000021/.test(fundAudit.rows[0].m) && /4342|6789/.test(fundAudit.rows[0].m));
  let fundThrew = 0;
  try { await svc.updateFunding(ctx, tA, { stepUpConfirmed: true, accountNumber: '000123456789', routingNumber: '123', reason: 'x' }); } catch { fundThrew++; }
  try { await svc.updateFunding(ctx, tA, { stepUpConfirmed: true, accountNumber: '000123456789', routingNumber: '021000021' }); } catch { fundThrew++; }
  check('funding update rejects bad routing / missing reason', fundThrew === 2, String(fundThrew));

  // ── Controlled write: MID Assignment (Unit 10) ──
  const m1: any = await svc.assignMid(ctx, tC, { merchantId: 'MID-202605-999', reason: 'reissue' });
  check('assign MID to tC: previous MID-202605-005 → MID-202605-999', m1.ok && m1.idempotent === false && m1.previousMid === 'MID-202605-005' && m1.merchantId === 'MID-202605-999', JSON.stringify({ p: m1.previousMid, n: m1.merchantId }));
  const cMid: any = await sql`select merchant_id from tenant_payment_config where tenant_id = ${tC}`.execute(db);
  check('config MID updated for tC', cMid.rows[0].merchant_id === 'MID-202605-999');
  let conflictBlocked = false, branchBlocked = false;
  try { await svc.assignMid(ctx, tB, { merchantId: 'MID-202605-001', reason: 'x' }); } catch (e: any) { conflictBlocked = /already assigned/i.test(String(e?.message)); }
  check('MID conflict prevented (tA MID cannot be assigned to tB)', conflictBlocked);
  const bMidUnchanged: any = await sql`select merchant_id from tenant_payment_config where tenant_id = ${tB}`.execute(db);
  check('conflicted assignment left tB MID unchanged', bMidUnchanged.rows[0].merchant_id === 'MID-202605-002');
  try { await svc.assignMid(ctx, tB, { merchantId: 'MID-NEW-B', branchId: bA1, reason: 'x' }); } catch (e: any) { branchBlocked = /branch/i.test(String(e?.message)); }
  check('cross-tenant branch rejected (bA1 belongs to tA, not tB)', branchBlocked);
  const m2: any = await svc.assignMid(ctx, tB, { merchantId: 'MID-NEW-B', branchId: bB1, reason: 'valid' });
  check('assign MID to tB with owning branch bB1 → ok (prior MID-202605-002 preserved)', m2.ok && m2.previousMid === 'MID-202605-002' && m2.merchantId === 'MID-NEW-B');
  const m3: any = await svc.assignMid(ctx, tB, { merchantId: 'MID-NEW-B', reason: 'again' });
  check('idempotent MID re-assign (unchanged) → idempotent', m3.idempotent === true);
  let midThrew = 0;
  try { await svc.assignMid(ctx, tB, { merchantId: 'MID-X' }); } catch { midThrew++; }
  try { await svc.assignMid(ctx, 'ccdd9999-9999-9999-9999-999999999999', { merchantId: 'MID-X', reason: 'x' }); } catch { midThrew++; }
  check('MID write rejects missing reason / unknown merchant', midThrew === 2, String(midThrew));
  const midAudit: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and action='mid_assigned' and tenant_id = any(${ids})`.execute(db);
  check('mid_assigned audit events written (prior MID preserved)', midAudit.rows[0].c >= 2, String(midAudit.rows[0].c));

  // ── Controlled write: Terminal Assignment (Unit 11) ──
  const t1: any = await svc.assignTerminal(ctx, tA, { terminalId: termA1, branchId: bA2, reason: 'relocate' });
  check('assign terminal termA1: prior branch bA1 → bA2', t1.ok && t1.idempotent === false && t1.previousBranchId === bA1 && t1.branchId === bA2, JSON.stringify({ p: t1.previousBranchId, n: t1.branchId }));
  const tState: any = await sql`select branch_id, status from pos_payment_terminals where id = ${termA1}`.execute(db);
  check('terminal row reflects new branch + active', tState.rows[0].branch_id === bA2 && tState.rows[0].status === 'active');
  let termOwn = false, termBranch = false;
  try { await svc.assignTerminal(ctx, tA, { terminalId: termB1, branchId: bA2, reason: 'x' }); } catch (e: any) { termOwn = /does not belong/i.test(String(e?.message)); }
  check('cross-account terminal rejected (termB1 belongs to tB, not tA)', termOwn);
  try { await svc.assignTerminal(ctx, tA, { terminalId: termA2, branchId: bB1, reason: 'x' }); } catch (e: any) { termBranch = /branch/i.test(String(e?.message)); }
  check('cross-tenant branch rejected for terminal (bB1 belongs to tB)', termBranch);
  const tIdem: any = await svc.assignTerminal(ctx, tA, { terminalId: termA1, branchId: bA2, reason: 'again' });
  check('idempotent terminal re-assign (same branch, active) → idempotent', tIdem.idempotent === true);
  let termThrew = 0;
  try { await svc.assignTerminal(ctx, tA, { terminalId: termA2, branchId: bA1 }); } catch { termThrew++; }
  try { await svc.assignTerminal(ctx, tA, { terminalId: 'ccddcc09-0000-0000-0000-000000000009', branchId: bA1, reason: 'x' }); } catch { termThrew++; }
  check('terminal write rejects missing reason / unknown terminal', termThrew === 2, String(termThrew));
  const termAudit: any = await sql`select count(*)::int as c from audit_events where module='merchant-accounts' and action='terminal_assigned' and tenant_id = any(${ids})`.execute(db);
  check('terminal_assigned audit events written (prior branch preserved)', termAudit.rows[0].c >= 1, String(termAudit.rows[0].c));

  await clean();
  console.log(`──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await db.destroy(); process.exit(1); });
