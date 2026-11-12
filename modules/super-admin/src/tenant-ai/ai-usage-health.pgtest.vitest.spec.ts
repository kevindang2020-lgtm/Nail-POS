// ai-usage-health.pgtest — AI Usage & Limits guide (Nov 1 2026; migration 771): Check AI Usage & Subscriptions on the REAL schema.
// It names the screenshot's contradictions with evidence (a stored "trialing" whose trial ended; calls let through after the
// trial ended or after cancelling), reports the cost basis honestly, and writes nothing but its own run.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiUsageScreenRepository } from './ai-usage-screen.repository';

const T = 'c7720000-0000-4000-8000-000000000001', U = 'c7720000-0000-4000-8000-000000000010';
const ctx = { tenantId: T, userId: U, role: 'OWNER', permissions: ['ai.use', 'ai.manage', 'subscription.manage'] };
let db: any; let repo: AiUsageScreenRepository;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const sub = (code: string, status: string, extra: { trialEnds?: string; cancelled?: string } = {}) => q(sql`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled,
  trial_starts_at, trial_ends_at, current_period_starts_at, cancelled_at) values (gen_random_uuid(), ${T}, ${code}, ${status}, 'monthly', 2900, 'usd', 500, false,
  now() - interval '20 days', ${extra.trialEnds ? sql`now() - ${extra.trialEnds}::interval` : null}, now() - interval '20 days', ${extra.cancelled ? sql`now() - ${extra.cancelled}::interval` : null})`);
const use = (code: string, ago: string) => q(sql`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at)
  values (${T}, ${code}, 'scans', 1, 'success', gen_random_uuid()::text, now() - ${ago}::interval)`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new AiUsageScreenRepository(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'aiu-772', 'AIU772', 'active')`);
});

describe('Check AI Usage & Subscriptions', () => {
  it('HL-01 a clean salon: catalog and states PASS; with nothing paying the cost basis is "not enough data", not a fake pass', async () => {
    const c: any = await repo.check(ctx);
    const by = (k: string) => c.checks.find((x: any) => x.key === k);
    expect(by('catalog')).toMatchObject({ state: 'PASSED', count: 15 });
    expect(by('states_readable').state).toBe('PASSED');
    expect(by('cost_basis').state).toBe('INSUFFICIENT_DATA');
    expect(by('no_side_effects').state).toBe('PASSED');
  });
  it('HL-02 names the screenshot contradictions: a stale "trialing" row, calls after the trial ended, calls after cancelling', async () => {
    await sub('ai_ocr_receipt_scanner', 'trialing', { trialEnds: '5 days' });
    await use('ai_ocr_receipt_scanner', '2 days');                 // after the trial ended
    await sub('ai_voice_transcription', 'cancelled', { cancelled: '3 days' });
    await use('ai_voice_transcription', '1 day');                  // after cancelling
    await q(sql`delete from ai_usage_health_runs where tenant_id = ${T}`);
    const before = (await q(sql`select count(*)::int as n from tenant_ai_subscriptions where tenant_id = ${T}`))[0].n;
    const c: any = await repo.check(ctx);
    const by = (k: string) => c.checks.find((x: any) => x.key === k);
    expect(by('trial_rows_current')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by('no_use_after_trial')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(by('no_use_after_cancel')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(c.overall).toBe('FAILED');
    expect((await repo.check(ctx)).reused).toBe(true);
    // read-only: no subscription row was touched
    expect((await q(sql`select count(*)::int as n from tenant_ai_subscriptions where tenant_id = ${T}`))[0].n).toBe(before);
    expect((await q(sql`select status from tenant_ai_subscriptions where tenant_id = ${T} and package_code = 'ai_ocr_receipt_scanner'`))[0].status).toBe('trialing');
  });
  it('Extras · AI Usage Limits 06: a usage spike, one request metered twice and stale ingestion are flagged — nothing is changed', async () => {
    const T3 = 'c7720000-0000-4000-8000-000000000003';
    const c3 = { ...ctx, tenantId: T3 };
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'S3', 'Spike', 'aiu-773', 'AIU773', 'active')`);
    const by = (c: any, k: string) => c.checks.find((x: any) => x.key === k);
    // nothing live, nothing counted: not enough data, never a fake pass
    let c: any = await repo.check(c3);
    expect(by(c, 'usage_spike').state).toBe('INSUFFICIENT_DATA');
    expect(by(c, 'metering_stale').state).toBe('INSUFFICIENT_DATA');
    expect(by(c, 'duplicate_usage_events')).toMatchObject({ state: 'PASSED', count: 0 });
    await q(sql`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled, current_period_starts_at)
      values (gen_random_uuid(), ${T3}, 'ai_business_assistant', 'active', 'monthly', 2900, 'usd', 5000, false, now() - interval '20 days')`);
    // last call 20 days ago: live package, the meter has been quiet for 14+ days
    await q(sql`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at) values (${T3}, 'ai_business_assistant', 'calls', 1, 'success', 'old-1', now() - interval '20 days')`);
    await q(sql`delete from ai_usage_health_runs where tenant_id = ${T3}`);
    c = await repo.check(c3);
    expect(by(c, 'metering_stale').state).toBe('WARNING');
    expect(by(c, 'metering_stale').count).toBeGreaterThanOrEqual(19);
    // a steady 1 call a day for 14 days, then 30 in the last day: a spike; the same request id twice: a duplicate
    await q(sql`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at)
      select ${T3}, 'ai_business_assistant', 'calls', 1, 'success', 'steady-' || g, now() - (g || ' days')::interval - interval '2 hours' from generate_series(1, 14) g`);
    await q(sql`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at)
      select ${T3}, 'ai_business_assistant', 'calls', 1, 'success', 'burst-' || g, now() - interval '1 hour' from generate_series(1, 30) g`);
    await q(sql`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, request_id, created_at) values (${T3}, 'ai_marketing_assistant', 'calls', 1, 'success', 'burst-1', now() - interval '1 hour')`);
    const rows = (await q(sql`select count(*)::int as n from ai_usage_logs where tenant_id = ${T3}`))[0].n;
    await q(sql`delete from ai_usage_health_runs where tenant_id = ${T3}`);
    c = await repo.check(c3);
    expect(by(c, 'usage_spike')).toMatchObject({ state: 'WARNING', count: 1, detail: { packages: ['ai_business_assistant'] } });
    expect(by(c, 'duplicate_usage_events')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by(c, 'metering_stale').state).toBe('PASSED');
    expect(c.overall).not.toBe('PASSED');
    expect((await q(sql`select count(*)::int as n from ai_usage_logs where tenant_id = ${T3}`))[0].n).toBe(rows);   // the records stand
    // another salon's spike is not this salon's
    await q(sql`delete from ai_usage_health_runs where tenant_id = ${T}`);
    expect(by(await repo.check(ctx), 'usage_spike').state).not.toBe('WARNING');
  });
  it('AIC-01 AI Center reconcile: the stale "trialing" row counts as old Trial/Running, but now as trial expired and NOT runnable; the gate agrees', async () => {
    await sub('ai_booking_assistant', 'active');
    const r: any = await repo.reconcile(ctx, { AI_ENTITLEMENT_ENFORCEMENT: '' } as any);
    const row = (c: string) => r.rows.find((x: any) => x.code === c);
    expect(row('ai_ocr_receipt_scanner')).toMatchObject({ storedStatus: 'trialing', state: 'trial_expired', oldLabel: 'trial', oldCountedRunning: true, mismatch: false });
    expect(row('ai_ocr_receipt_scanner').gate.allowed).toBe(false);
    expect(row('ai_voice_transcription').gate.allowed).toBe(false);
    expect(row('ai_booking_assistant')).toMatchObject({ state: 'active', mismatch: false });
    expect(row('ai_booking_assistant').gate.allowed).toBe(true);
    expect(r.old.onTrial).toBe(1);
    expect(r.now).toMatchObject({ trialing: 0, trialExpired: 1, paidActive: 1, canRunNow: 1, catalog: 15 });
    expect(r.staleTrialRows).toBe(1);
    expect(r.gateMismatches).toBe(0);
    expect(r.enforcement).toEqual({ modelCalls: 'always', featureRoutes: 'observe' });
    expect(row('ai_ocr_receipt_scanner').monthEvents + row('ai_voice_transcription').monthEvents).toBeGreaterThanOrEqual(0);
  });
  it('AIC-02 the check reports gate_matches_state PASSED and warns that feature routes are only observed', async () => {
    await q(sql`delete from ai_usage_health_runs where tenant_id = ${T}`);
    const c: any = await repo.check(ctx);
    const by = (k: string) => c.checks.find((x: any) => x.key === k);
    expect(by('gate_matches_state').state).toBe('PASSED');
    expect(by('feature_routes_gated').state).toBe('WARNING');
  });
});
