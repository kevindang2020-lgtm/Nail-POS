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
});
