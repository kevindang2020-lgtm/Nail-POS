// upsell-center.pgtest — Checkout Upsell Assistant Settings guide (Nov 2 2026; migration 773) on the REAL migrated schema.
// SV = saving (merge, versions, ranges, history) · FC = fail closed · SU = status row · AC = Suggestion Activity ·
// HI = Settings History · HL = Check Checkout Upsell System (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyUpsellSettings } from './ai-checkout-upsell.kysely';
import { AiCheckoutUpsellService } from './ai-checkout-upsell.service';
import { UpsellCenter, UpsellCenterError, UC_CATEGORIES, type UcCategory } from './upsell-center';

const id = (n: number) => `77730000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), MGR = id(11);
const C1 = id(20), C2 = id(21), CX = id(22), TK1 = id(30), TK2 = id(31), TKX = id(32);
const WIRED = Object.fromEntries(UC_CATEGORIES.map((k) => [k, k === 'addOnsEnabled' || k === 'membershipEnabled'])) as Record<UcCategory, boolean>;
let pg: any; let db: any; let store: KyselyUpsellSettings; let svc: AiCheckoutUpsellService; let uc: UpsellCenter;
let ent: { allowed: boolean; reason: string; subscriptionStatus: string } = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
let customers = true;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_checkout_upsell.view', 'pos.checkout.view', 'settings.edit', 'pos.settings.edit'], deviceId: null, ...o });
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof UpsellCenterError ? e.code : (e as Error).message; } }
const none: any = { async candidates() { return []; } };
function service(settings = store) {
  return new AiCheckoutUpsellService({ getTicket: async () => null } as any, { getAddOns: async () => [] } as any, none, none,
    { async state() { return null; } } as any, { async options() { return { enabled: false, allowedAmountsCents: [] }; } } as any, { async context() { return null; } } as any, settings as any);
}
let n = 100;
async function card(o: { t?: string; b?: string; tk?: string; cust?: string | null; type?: string; status?: string; title?: string; daysAgo?: number; by?: string | null; ref?: string | null; target?: string } = {}) {
  const R = id(++n);
  await q(`insert into ai_checkout_upsell_recommendations (id, tenant_id, branch_id, checkout_id, customer_id, type, target_id, title, price_cents, status, context_fingerprint, accepted_by_user_id, result_ref, created_at, expires_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,1500,$9,$10,$11,$12, now() - ($13 || ' days')::interval, now() - ($13 || ' days')::interval + interval '5 minutes')`,
  [R, o.t ?? T, o.b ?? B, o.tk ?? TK1, o.cust === undefined ? C1 : o.cust, o.type ?? 'service_addon', o.target ?? ('t-' + R), o.title ?? 'Paraffin Dip', o.status ?? 'GENERATED', 'fp-' + R, o.by ?? null, o.ref ?? null, String(o.daysAgo ?? 0)]);
  return R;
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  store = new KyselyUpsellSettings(db);
  svc = service();
  uc = new UpsellCenter(db, {
    settings: (c) => svc.getEffectiveSettings(c as any) as any, entitlement: async () => ent, wired: WIRED, canSeeCustomers: () => customers,
  });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','uc-773','UC773','active'), ($2,'X','Other','uc-773x','UC773X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'North','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner Kim','o@uc.test','active','OWNER'), ($2,$3,'Manager Lan','m@uc.test','active','MANAGER')`, [OWNER, MGR, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$4,$5,'Linh','Pham','Linh Pham','+18565550142'),
    ($2,$4,$5,'Mai','Do','Mai Do','+18565550199'), ($3,$6,$7,'Other','Guest','Other Guest','+18565550142')`, [C1, C2, CX, T, B, X, BX]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number, created_at, updated_at) values
    ($1,$4,$5,$6,'serving',5000,0,0,5000,0,'T-1001',now(),now()), ($2,$4,$5,$7,'paid',4000,0,0,4000,0,'T-1002',now(),now()), ($3,$8,$9,$10,'serving',1000,0,0,1000,0,'T-9',now(),now())`,
  [TK1, TK2, TKX, T, B, C1, C2, X, BX, CX]);
}, 180_000);

describe('Checkout upsell settings — saving', () => {
  it('SV-01 a category toggle stores ONLY that key (platform defaults are not baked into the salon row)', async () => {
    await store.setLayer(ctx(), 'tenant', { tunables: { productsEnabled: false } });
    const row = (await q(`select tunables, version, enabled from ai_checkout_upsell_settings where tenant_id = $1 and level = 'tenant'`, [T]))[0];
    expect(row.tunables).toEqual({ productsEnabled: false });
    expect(row.version).toBe(1);
    expect(row.enabled).toBeNull();
  });
  it('SV-02 Disable then Enable keeps every category and limit (it used to write tunables: null)', async () => {
    await store.setLayer(ctx(), 'tenant', { tunables: { maxTotal: 3 } });
    await store.setLayer(ctx(), 'tenant', { enabled: false });
    await store.setLayer(ctx(), 'tenant', { enabled: true });
    const eff: any = await svc.getEffectiveSettings(ctx());
    expect(eff.enabled).toBe(true);
    expect(eff.tunables).toMatchObject({ productsEnabled: false, maxTotal: 3, addOnsEnabled: true, maxAddOn: 2 });
    expect(eff.sources).toMatchObject({ productsEnabled: 'tenant', maxTotal: 'tenant', maxAddOn: 'platform' });
    expect(eff.salon.version).toBe(4);
  });
  it('SV-03 a stale expectedVersion is refused; the right one saves; a no-op save makes no new version', async () => {
    expect(await code(store.setLayer(ctx(), 'tenant', { tunables: { maxAddOn: 1 } }, 2))).toBe('UPSELL_SETTINGS_VERSION_CONFLICT');
    expect(await store.setLayer(ctx({ userId: MGR, role: 'MANAGER' }), 'tenant', { tunables: { maxAddOn: 1 } }, 4)).toEqual({ version: 5 });
    expect(await store.setLayer(ctx(), 'tenant', { tunables: { maxAddOn: 1 } }, 5)).toEqual({ version: 5 });
  });
  it('SV-04 out-of-range or unknown values are refused, not clamped', async () => {
    for (const bad of [{ maxTotal: 9 }, { maxAddOn: -1 }, { maxProduct: 1.5 }, { maxTotal: '2' }, { addOnsEnabled: 'yes' }, { surprise: 1 }]) {
      expect(await code(store.setLayer(ctx(), 'tenant', { tunables: bad as any }))).toBe('UPSELL_SETTING_OUT_OF_RANGE');
    }
    expect((await q(`select version from ai_checkout_upsell_settings where tenant_id = $1 and level = 'tenant'`, [T]))[0].version).toBe(5);
  });
  it('SV-05 every save is one history row: before → after, who, which keys', async () => {
    const h = await q(`select version, changed_keys, before_tunables, after_tunables, before_enabled, after_enabled, actor_user_id from ai_checkout_upsell_settings_history where tenant_id = $1 order by version`, [T]);
    expect(h.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    expect(h[2]).toMatchObject({ changed_keys: ['enabled'], before_enabled: null, after_enabled: false });
    expect(h[4]).toMatchObject({ changed_keys: ['maxAddOn'], actor_user_id: MGR });
    expect(h[4].before_tunables.maxAddOn).toBeUndefined();
    expect(h[4].after_tunables.maxAddOn).toBe(1);
  });
});

describe('Checkout upsell settings — fails closed', () => {
  it('FC-01 an unreadable settings table turns the assistant OFF for the checkout (it used to answer "enabled, every category")', async () => {
    const broken = service({ layers: async () => { throw new Error('relation missing'); } } as any);
    const r: any = await broken.recommendations(ctx({ permissions: ['pos.ai_checkout_upsell.view', 'pos.checkout.view'] }), TK1);
    expect(r).toMatchObject({ enabled: false, disabledAtLevel: 'settings_unreadable', cards: [] });
    await expect(broken.getEffectiveSettings(ctx())).rejects.toThrow('relation missing');   // the settings page shows an error, not defaults
  });
});

describe('Checkout upsell — status row', () => {
  it('SU-01 effective state, subscription, the seven categories with connected / not connected, limits, counts kept apart', async () => {
    await card({ status: 'APPLIED', by: OWNER, ref: 'line-1' });
    await card({ status: 'DISMISSED', tk: TK2, cust: C2, title: 'Cuticle Oil', type: 'product' });
    await card({ status: 'ACCEPTED', by: OWNER });
    await card({ status: 'GENERATED', daysAgo: 40 });                               // outside the 30 days
    await card({ t: X, b: BX, tk: TKX, cust: CX });                                 // another salon
    const s: any = await uc.summary(ctx());
    expect(s.effective).toBe('enabled');
    expect(s.categories.find((c: any) => c.key === 'productsEnabled')).toEqual({ key: 'productsEnabled', on: false, wired: false, source: 'tenant' });
    expect(s.categories.find((c: any) => c.key === 'giftCardEnabled')).toMatchObject({ on: true, wired: false });
    expect(s.categories.find((c: any) => c.key === 'addOnsEnabled')).toMatchObject({ on: true, wired: true });
    expect(s.limits).toMatchObject({ maxTotal: 3, maxAddOn: 1, maxProduct: 2 });
    expect(s.last30d).toMatchObject({ generated: 3, accepted: 2, applied: 1, dismissed: 1 });
    expect(s.version).toBe(5);
    ent = { allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing' };
    expect((await uc.summary(ctx()) as any).effective).toBe('subscription_restricted');
    ent = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
  });
});

describe('Checkout upsell — Suggestion Activity', () => {
  it('AC-01 newest first, numbered pages, the session branch only; another salon never', async () => {
    const r: any = await uc.activity(ctx(), { pageSize: '10' });
    expect(r.total).toBe(4);
    expect(r.items[0].ticketNumber).toBe('T-1001');
    const times = r.items.map((x: any) => x.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect((await uc.activity(ctx({ branchId: B2 }), {}) as any).total).toBe(0);
  });
  it('AC-02 search: ticket number, offer, status; customer name / phone only with customers.view; filters and dates', async () => {
    expect((await uc.activity(ctx(), { q: 'T-1002' }) as any).total).toBe(1);
    expect((await uc.activity(ctx(), { q: 'cuticle' }) as any).total).toBe(1);
    expect((await uc.activity(ctx(), { type: 'product' }) as any).total).toBe(1);
    expect((await uc.activity(ctx(), { status: 'APPLIED' }) as any).items[0].acceptedBy).toBe('Owner Kim');
    const ph: any = await uc.activity(ctx(), { q: '555-0142' });
    expect(ph.total).toBe(3);
    expect(ph.items[0]).toMatchObject({ customer: 'Linh Pham', customerPhoneLast4: '0142' });
    customers = false;
    expect((await uc.activity(ctx(), { q: 'Linh' }) as any).total).toBe(0);
    expect((await uc.activity(ctx(), {}) as any).items.every((x: any) => x.customer === null && x.customerPhoneLast4 === null)).toBe(true);
    customers = true;
    expect((await uc.activity(ctx(), { preset: 'last_7' }) as any).total).toBe(3);
    expect(await code(uc.activity(ctx(), { from: '2026-10-05', to: '2026-10-01' }))).toBe('UC_INVALID_PERIOD');
  });
});

describe('Checkout upsell — Settings History', () => {
  it('HI-01 newest first, before → after per key, actor named, searchable by key and actor', async () => {
    const h: any = await uc.history(ctx(), {});
    expect(h.total).toBe(5);
    expect(h.items[0]).toMatchObject({ version: 5, actor: 'Manager Lan', changes: [{ key: 'maxAddOn', before: null, after: 1 }] });
    expect(h.items[2].changes).toEqual([{ key: 'enabled', before: null, after: false }]);
    expect((await uc.history(ctx(), { q: 'productsEnabled' }) as any).total).toBe(5);   // every later row still carries it in after_tunables
    expect((await uc.history(ctx(), { q: 'manager lan' }) as any).total).toBe(1);
  });
});

describe('Checkout upsell — Check Checkout Upsell System', () => {
  it('HL-01 read-only evidence: switched-on categories with no source are named; the core rules FAIL when broken; reused', async () => {
    await card({ status: 'APPLIED', by: null, ref: null, tk: TK2, cust: C2 });          // applied with no person and no result
    const before = (await q(`select count(*)::int as n from ai_checkout_upsell_recommendations`))[0].n;
    const r: any = await uc.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(r.overall).toBe('FAILED');
    expect(by.applied_needs_staff.state).toBe('FAILED');
    expect(by.applied_has_result.state).toBe('WARNING');
    expect(by.categories_connected).toMatchObject({ state: 'WARNING', count: 4 });
    expect(by.categories_connected.detail.notConnected).toEqual(['loyaltyEnrollEnabled', 'loyaltyRedeemEnabled', 'giftCardEnabled', 'rebookingEnabled']);
    expect(by.settings_readable.state).toBe('PASSED');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.addon_catalog.state).toBe('INSUFFICIENT_DATA');
    const again: any = await uc.check(ctx());
    expect(again).toMatchObject({ reused: true, id: r.id });
    expect((await q(`select count(*)::int as n from ai_checkout_upsell_recommendations`))[0].n).toBe(before);
    expect((await q(`select version from ai_checkout_upsell_settings where tenant_id = $1 and level = 'tenant'`, [T]))[0].version).toBe(5);
  });
  it('HL-02 tenant isolation FAILS when a card points at another salon\'s ticket', async () => {
    await q(`delete from checkout_upsell_health_runs`);
    await card({ tk: TKX, cust: null });
    const r: any = await uc.check(ctx());
    expect(r.checks.find((c: any) => c.key === 'tenant_isolation')).toMatchObject({ state: 'FAILED', count: 1 });
  });
});
