// ai-plans-billing.pgtest.ts — THROWAWAY end-to-end behavior test for the AI-plan assign / MRR / trial→paid /
// yearly-period path, run against a REAL Postgres (not a unit harness, not part of CI). Wires the actual services
// (AiPlansAdminService + KyselyAiAdminRepo as the per-package writer; TenantAiService + KyselyTenantAiRepo for the
// owner trial) to a live DB and asserts the rows they write. Prints "X passed, Y failed". Build+run with esbuild:
//   node_modules/.bin/esbuild apps/api/src/super-admin-ai/ai-plans-billing.pgtest.ts --bundle --platform=node \
//     --format=cjs --outfile=/tmp/pgtest.cjs --log-level=error && node /tmp/pgtest.cjs
// Requires a Postgres reachable at the conn below with all migrations applied.
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { KyselyAiAdminRepo } from './ai-admin.repository';
import { AiPlansAdminService } from './ai-plans-admin.service';
import { KyselyTenantAiRepo } from '../tenant-ai/tenant-ai.repository';
import { TenantAiService } from '../tenant-ai/tenant-ai.service';

const CONN = { host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 5433), database: process.env.PGDATABASE || 'aipos_test', user: process.env.PGUSER || 'postgres' };

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: any) => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → got ' + JSON.stringify(extra) : '')); } };

async function main() {
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool(CONN) }) });
  const ctx: any = { userId: null };
  const memberCtx: any = { tenantId: '', permissions: ['ai.manage'] };

  try {
    // ---- clean slate (plan tables only) + seed one tenant ----
    await sql`DELETE FROM tenant_ai_plan_subscriptions`.execute(db);
    await sql`DELETE FROM tenant_ai_subscriptions`.execute(db);
    await sql`DELETE FROM ai_plan_settings`.execute(db);
    await sql`DELETE FROM tenants WHERE tenant_code = 'PLANTEST'`.execute(db);
    const t = await sql<any>`INSERT INTO tenants (legal_name, display_name, tenant_slug, tenant_code, status)
      VALUES ('Plan Test LLC', 'Plan Test', 'plan-test', 'PLANTEST', 'active') RETURNING id`.execute(db);
    const tenantId = String(t.rows[0].id);
    memberCtx.tenantId = tenantId;

    const repo = new KyselyAiAdminRepo(db);
    const plans = new AiPlansAdminService(db, repo);
    const tenantAi = new TenantAiService(new KyselyTenantAiRepo(db), db);

    const subsFor = async (codes: string[]) =>
      (await sql<any>`SELECT package_code, status, billing_period, price_cents FROM tenant_ai_subscriptions WHERE tenant_id=${tenantId} AND package_code = ANY(${codes}) ORDER BY package_code`.execute(db)).rows;
    const planSub = async (code: string) =>
      (await sql<any>`SELECT status, billing_period, price_cents, trial_ends_at FROM tenant_ai_plan_subscriptions WHERE tenant_id=${tenantId} AND plan_code=${code}`.execute(db)).rows[0];
    const BC = ['ai_booking_assistant', 'ai_phone_call_assistant'];        // plan_booking_calls members
    const CQ = ['ai_queue_technician_assignment', 'ai_reception_copilot']; // plan_checkin_queue members
    const CG = ['ai_checkout_upsell_assistant', 'ai_customer_profile_assistant', 'ai_marketing_assistant', 'ai_review_reputation_assistant']; // plan_client_growth

    // ===== 1. 25% discount, assign paid MONTHLY =====
    await plans.updatePlan(ctx, 'plan_booking_calls', { discountType: 'percent', discountValue: 25 });
    const a1 = await plans.assignPlanToTenant(ctx, 'plan_booking_calls', tenantId, { billingPeriod: 'monthly' });
    check('assign monthly activates 2 members', a1.activated === 2, a1.activated);
    let m = await subsFor(BC);
    check('both member subs active+monthly', m.length === 2 && m.every((r) => r.status === 'active' && r.billing_period === 'monthly'), m.map((r) => r.status + '/' + r.billing_period));
    check('member prices sum to effective 11100', m.reduce((s, r) => s + Number(r.price_cents), 0) === 11100, m.map((r) => Number(r.price_cents)));
    let ps = await planSub('plan_booking_calls');
    check('plan sub active/monthly/11100', ps.status === 'active' && ps.billing_period === 'monthly' && Number(ps.price_cents) === 11100, ps);

    // ===== 2. MRR rollup reflects the discounted bundle =====
    let bc = (await plans.listPlans()).plans.find((p: any) => p.code === 'plan_booking_calls')!;
    check('listPlans MRR=11100, 1 active subscriber', bc.mrrCents === 11100 && bc.activeSubscribers === 1, { mrr: bc.mrrCents, active: bc.activeSubscribers });

    // ===== 3. assign YEARLY (annual_months default 12) — yearly = 12× monthly, MRR unchanged =====
    await plans.assignPlanToTenant(ctx, 'plan_booking_calls', tenantId, { billingPeriod: 'yearly' });
    m = await subsFor(BC);
    check('member subs flipped to yearly', m.every((r) => r.billing_period === 'yearly'), m.map((r) => r.billing_period));
    check('yearly member prices sum to 133200 (11100×12)', m.reduce((s, r) => s + Number(r.price_cents), 0) === 133200, m.reduce((s, r) => s + Number(r.price_cents), 0));
    ps = await planSub('plan_booking_calls');
    check('plan sub yearly price 133200', Number(ps.price_cents) === 133200, Number(ps.price_cents));
    bc = (await plans.listPlans()).plans.find((p: any) => p.code === 'plan_booking_calls')!;
    check('yearly MRR still 11100 (133200/12)', bc.mrrCents === 11100, bc.mrrCents);

    // ===== 4. annual_months=10 (2 months free) — discounts the year and lowers recognized MRR =====
    await plans.updatePlan(ctx, 'plan_booking_calls', { discountType: 'percent', discountValue: 25, annualMonths: 10 });
    await plans.assignPlanToTenant(ctx, 'plan_booking_calls', tenantId, { billingPeriod: 'yearly' });
    ps = await planSub('plan_booking_calls');
    check('yearly@10mo plan price 111000 (11100×10)', Number(ps.price_cents) === 111000, Number(ps.price_cents));
    bc = (await plans.listPlans()).plans.find((p: any) => p.code === 'plan_booking_calls')!;
    check('yearly@10mo MRR 9250 (111000/12)', bc.mrrCents === 9250, bc.mrrCents);

    // ===== 5. owner self-serve TRIAL → super-admin CONVERT to paid =====
    await tenantAi.startPlanTrial(memberCtx, 'plan_checkin_queue');
    let tr = await planSub('plan_checkin_queue');
    check('owner trial: plan sub trialing with trial_ends_at', tr.status === 'trialing' && tr.trial_ends_at != null, { status: tr.status, ends: tr.trial_ends_at });
    let cm = await subsFor(CQ);
    check('owner trial: 2 members trialing', cm.length === 2 && cm.every((r) => r.status === 'trialing'), cm.map((r) => r.status));
    await plans.convertPlanToPaid(ctx, 'plan_checkin_queue', tenantId, { billingPeriod: 'monthly' });
    tr = await planSub('plan_checkin_queue');
    check('convert: plan sub active, trial_ends_at cleared', tr.status === 'active' && tr.trial_ends_at == null, { status: tr.status, ends: tr.trial_ends_at });
    cm = await subsFor(CQ);
    check('convert: members now active', cm.every((r) => r.status === 'active'), cm.map((r) => r.status));

    // ===== 6. convertExpiredTrials picks up a lapsed trial =====
    await tenantAi.startPlanTrial(memberCtx, 'plan_client_growth');
    await sql`UPDATE tenant_ai_plan_subscriptions SET trial_ends_at = now() - interval '1 day' WHERE tenant_id=${tenantId} AND plan_code='plan_client_growth'`.execute(db);
    const exp = await plans.convertExpiredTrials(ctx);
    check('convertExpiredTrials converted >= 1', exp.converted >= 1, exp.converted);
    const cg = await planSub('plan_client_growth');
    check('lapsed trial now active', cg.status === 'active', cg.status);
    const cgm = await subsFor(CG);
    check('lapsed trial: 4 members active', cgm.length === 4 && cgm.every((r) => r.status === 'active'), cgm.map((r) => r.status));

    console.log(`\n${pass} passed, ${fail} failed`);
  } finally {
    await db.destroy();
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
