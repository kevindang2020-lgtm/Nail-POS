// ai-price-table.pgtest — AI Usage Limits 07 (extras round 11): the Super Admin AI price table as a MECHANISM (migration 971).
// The pure resolution rules (empty → no price set; current version; "existing salons keep their previous price" walks back
// only for salons that subscribed before; override wins / NULL removes; upcoming shown) and the publishing rules on the REAL
// schema (keep-previous is required — no default; whole cents within the ceiling; never back-dated; known packages; one row
// per package × unit; append-only; audited).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiPriceTable, AiPriceTableError, resolveAiTablePrice, type PriceVersionFact } from './ai-price-table';

const d = (s: string) => new Date(s);
const v = (versionNo: number, at: string, keepPrevious: boolean, rows: Record<string, number>): PriceVersionFact => ({ versionNo, effectiveFrom: d(at), keepPrevious, rows: new Map(Object.entries(rows)) });
const NOW = d('2026-11-13T12:00:00Z');

describe('resolveAiTablePrice (pure)', () => {
  it('empty table → no price set (no version published)', () => {
    expect(resolveAiTablePrice([], [], 'ai_marketing_assistant', 'month', null, NOW)).toEqual({ state: 'no_price_set', unit: 'month', reason: 'no_version_published', currentVersionNo: null, upcoming: null });
  });
  it('current version; a future version is upcoming only; a package missing from the current version has no price', () => {
    const vs = [v(1, '2026-10-01T00:00:00Z', false, { 'ai_x|month': 5000 }), v(2, '2026-12-01T00:00:00Z', true, { 'ai_x|month': 6000 })];
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'month', null, NOW)).toMatchObject({ state: 'set', priceCents: 5000, versionNo: 1, currentVersionNo: 1, keptPrevious: false,
      upcoming: { versionNo: 2, priceCents: 6000, existingSalonsKeepPrevious: true } });
    expect(resolveAiTablePrice(vs, [], 'ai_y', 'month', null, NOW)).toMatchObject({ state: 'no_price_set', reason: 'not_in_version', currentVersionNo: 1 });
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'year', null, NOW)).toMatchObject({ state: 'no_price_set', reason: 'not_in_version' });
  });
  it('keep previous: only a salon that subscribed BEFORE the version keeps the earlier price; it walks back across several keep versions; a "keep = false" version applies to everyone', () => {
    const vs = [v(1, '2026-01-01T00:00:00Z', false, { 'ai_x|month': 4000 }), v(2, '2026-06-01T00:00:00Z', true, { 'ai_x|month': 5000 }), v(3, '2026-10-01T00:00:00Z', true, { 'ai_x|month': 6000 })];
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'month', d('2026-03-01T00:00:00Z'), NOW)).toMatchObject({ priceCents: 4000, versionNo: 1, keptPrevious: true, currentVersionNo: 3 });
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'month', d('2026-07-01T00:00:00Z'), NOW)).toMatchObject({ priceCents: 5000, versionNo: 2, keptPrevious: true });
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'month', d('2026-11-01T00:00:00Z'), NOW)).toMatchObject({ priceCents: 6000, versionNo: 3, keptPrevious: false });
    expect(resolveAiTablePrice(vs, [], 'ai_x', 'month', null, NOW)).toMatchObject({ priceCents: 6000, keptPrevious: false });   // a new purchase sees today's version
    const reset = [...vs, v(4, '2026-11-01T00:00:00Z', false, { 'ai_x|month': 7000 })];
    expect(resolveAiTablePrice(reset, [], 'ai_x', 'month', d('2026-03-01T00:00:00Z'), NOW)).toMatchObject({ priceCents: 7000, versionNo: 4, keptPrevious: false });
  });
  it('keep previous on the FIRST version for a salon that subscribed before it: there was no table price → no price set', () => {
    expect(resolveAiTablePrice([v(1, '2026-10-01T00:00:00Z', true, { 'ai_x|month': 5000 })], [], 'ai_x', 'month', d('2026-01-01T00:00:00Z'), NOW))
      .toMatchObject({ state: 'no_price_set', reason: 'kept_previous_none', currentVersionNo: 1 });
  });
  it('a salon override in effect wins (newest first); a NULL-price row removes it; a future override is not in effect yet', () => {
    const vs = [v(1, '2026-01-01T00:00:00Z', false, { 'ai_x|month': 5000 })];
    const o = (priceCents: number | null, at: string, created: string) => ({ feature: 'ai_x', unit: 'month', priceCents, effectiveFrom: d(at), createdAt: d(created) });
    expect(resolveAiTablePrice(vs, [o(3000, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')], 'ai_x', 'month', null, NOW)).toMatchObject({ state: 'set', priceCents: 3000, source: 'salon_override', versionNo: null, currentVersionNo: 1 });
    expect(resolveAiTablePrice(vs, [o(3000, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'), o(null, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')], 'ai_x', 'month', null, NOW)).toMatchObject({ source: 'version', priceCents: 5000 });
    expect(resolveAiTablePrice(vs, [o(3000, '2026-12-01T00:00:00Z', '2026-11-01T00:00:00Z')], 'ai_x', 'month', null, NOW)).toMatchObject({ source: 'version', priceCents: 5000 });
    expect(resolveAiTablePrice([], [o(3000, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')], 'ai_x', 'month', null, NOW)).toMatchObject({ state: 'set', source: 'salon_override', currentVersionNo: null });
  });
});

describe('AiPriceTable on the real schema', () => {
  const T = 'c5e97100-0000-4000-8000-000000000001', SA = { userId: 'c5e97100-0000-4000-8000-0000000000aa' };
  let db: any; let pt: AiPriceTable;
  const q = async (s: any) => (await s.execute(db)).rows as any[];
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof AiPriceTableError ? e.code : (e as Error).message; } };
  const row = { feature: 'ai_marketing_assistant', unit: 'month', priceCents: 6100 };
  beforeAll(async () => {
    db = kyselyFor(await migratedPglite()); pt = new AiPriceTable(db);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'P', 'Price Salon', 'apt-971', 'APT971', 'active')`);
  }, 180_000);
  it('starts EMPTY — nothing is seeded', async () => {
    expect(await pt.list()).toEqual({ versions: [], overrides: [], empty: true, ceilingCents: 1_000_000 });
  });
  it('publishing requires the keep-previous choice (no default), whole cents within the ceiling, a known package, one row per package × unit, never back-dated', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(await code(pt.publish(SA, { effectiveFrom: at, rows: [row] }))).toBe('AI_PRICE_KEEP_PREVIOUS_REQUIRED');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: 'yes', rows: [row] }))).toBe('AI_PRICE_KEEP_PREVIOUS_REQUIRED');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [{ ...row, priceCents: 61.5 }] }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [{ ...row, priceCents: 1_000_001 }] }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [{ ...row, priceCents: -1 }] }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [{ ...row, feature: 'ai_made_up' }] }))).toBe('AI_PACKAGE_NOT_FOUND');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [row, row] }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [] }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.publish(SA, { effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(), existingSalonsKeepPrevious: true, rows: [row] }))).toBe('AI_PRICE_EFFECTIVE_PAST');
    expect((await pt.list()).empty).toBe(true);   // nothing half-written
  });
  it('a published version is numbered, listed (scheduled = not in effect yet), audited, and can never be edited or removed', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const r = await pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: false, note: 'Launch', rows: [row, { feature: 'ai_marketing_assistant', unit: 'overage_unit', priceCents: 2 }] });
    expect(r).toMatchObject({ versionNo: 1, existingSalonsKeepPrevious: false, inEffect: false, note: 'Launch' });
    const r2 = await pt.publish(SA, { effectiveFrom: at, existingSalonsKeepPrevious: true, rows: [row] });
    expect(r2.versionNo).toBe(2);
    const l = await pt.list();
    expect(l.versions.map((x) => [x.versionNo, x.existingSalonsKeepPrevious, x.rows.length])).toEqual([[2, true, 1], [1, false, 2]]);
    const a = await q(sql`select action_type, entity_type, metadata_json from audit_logs where action_type = 'super_admin_ai_price_version_published' order by created_at`);
    expect(a).toHaveLength(2); expect(a[0].metadata_json).toMatchObject({ versionNo: 1, existingSalonsKeepPrevious: false });
    await expect(q(sql`update platform_ai_price_version_rows set price_cents = 1`)).rejects.toThrow(/append-only/);
    await expect(q(sql`delete from platform_ai_price_versions`)).rejects.toThrow(/append-only/);
    await expect(q(sql`update platform_ai_price_versions set existing_salons_keep_previous = true`)).rejects.toThrow(/append-only/);
    await expect(q(sql`insert into platform_ai_price_versions (version_no, effective_from) values (99, now())`)).rejects.toThrow();   // keep-previous has no default in the database either
  });
  it('a salon override needs a known salon, a reason and whole cents; NULL removes it; append-only and audited', async () => {
    expect(await code(pt.setOverride(SA, { tenantId: 'c5e97100-0000-4000-8000-0000000000ff', feature: 'ai_marketing_assistant', unit: 'month', priceCents: 100, reason: 'test' }))).toBe('TENANT_NOT_FOUND');
    expect(await code(pt.setOverride(SA, { tenantId: T, feature: 'ai_marketing_assistant', unit: 'month', priceCents: 100, reason: '' }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.setOverride(SA, { tenantId: T, feature: 'ai_marketing_assistant', unit: 'week', priceCents: 100, reason: 'test' }))).toBe('AI_PRICE_INVALID');
    expect(await code(pt.setOverride(SA, { tenantId: T, feature: 'ai_marketing_assistant', unit: 'month', priceCents: 10.5, reason: 'test' }))).toBe('AI_PRICE_INVALID');
    await pt.setOverride(SA, { tenantId: T, feature: 'ai_marketing_assistant', unit: 'month', priceCents: 4500, reason: 'Pilot salon' });
    const f1 = await pt.facts(T);
    expect(resolveAiTablePrice(f1.versions, f1.overrides, 'ai_marketing_assistant', 'month', null, new Date())).toMatchObject({ source: 'salon_override', priceCents: 4500 });
    await pt.setOverride(SA, { tenantId: T, feature: 'ai_marketing_assistant', unit: 'month', priceCents: null, reason: 'Pilot ended' });
    const f2 = await pt.facts(T);
    expect(resolveAiTablePrice(f2.versions, f2.overrides, 'ai_marketing_assistant', 'month', null, new Date())).toMatchObject({ state: 'no_price_set', reason: 'no_version_published' });   // the versions above are scheduled, not in effect
    expect((await pt.list()).overrides.map((o) => o.priceCents)).toEqual([null, 4500]);
    expect((await q(sql`select action_type from audit_logs where entity_type = 'tenant_ai_price_override' order by created_at`)).map((x) => x.action_type)).toEqual(['super_admin_ai_price_override_set', 'super_admin_ai_price_override_removed']);
    await expect(q(sql`delete from tenant_ai_price_overrides`)).rejects.toThrow(/append-only/);
  });
});
