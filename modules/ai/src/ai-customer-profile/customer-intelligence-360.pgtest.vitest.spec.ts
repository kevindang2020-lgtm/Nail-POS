// customer-intelligence-360.pgtest — Customer Intelligence 30 "Five additional upgrades" on the REAL schema: the Customer
// 360-Degree view (identity · service history · preferences · loyalty · evidence-backed review suggestions, audited, masked
// contact without export, salon-scoped) and the dashboard's high-value list (spend sort + high_value flag).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerIntelligenceCenter, CustomerIntelligenceError } from './customer-intelligence-center';
import { DEFAULT_TUNABLES } from './ai-customer-profile-core';

const P = 'c3600000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20);
const C = { big: id(101), lapsed: id(102), bare: id(103), small: id(104), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view'], ...o }) as any;
let db: any; let ci: CustomerIntelligenceCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerIntelligenceError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = (cust: string, daysAgo: number, cents = 4500) => q(sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
  values (${T}, ${B}, ${cust}, ${LAN}, 'paid', ${cents}, ${++tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval) returning id`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); ci = new CustomerIntelligenceCenter(db, async () => ({ enabled: true, tunables: DEFAULT_TUNABLES }));
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'ci-360', 'CI360', 'active'), (${X}, 'X', 'Other', 'ci-360x', 'CI360X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@ci360.test', 'active', 'OWNER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn')`);
  const people: [string, string, string, string, string | null, string | null, boolean][] = [
    [C.big, T, B, 'Big Spender', '+16095550201', 'big@example.com', true], [C.lapsed, T, B, 'Lapsed Lee', '+16095550202', null, false],
    [C.bare, T, B, 'Bare Bones', null, null, false], [C.small, T, B, 'Small Sam', '+16095550204', null, true], [C.other, X, BX, 'Other Salon', '+16095550201', null, true],
  ];
  for (const [cid, tenant, branch, name, phone, email, verified] of people)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, phone_verified_at, preferred_technician_id, status, created_at)
      values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${phone}, ${email}, ${verified ? sql`now()` : null}, ${cid === C.big ? LAN : null}, 'active', now() - interval '400 days')`);
  for (const [d, cents] of [[60, 20000], [30, 18000], [5, 22000]] as const) await visit(C.big, d, cents);
  const tid = (await visit(C.big, 2, 9000))[0].id;
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id)
    values (${T}, ${B}, ${tid}, ${id(901)}, 'Gel Manicure', 9000, 45, 9000, ${LAN})`);
  for (const d of [110, 80, 50]) await visit(C.lapsed, d);
  await visit(C.small, 20, 1500);
  await q(sql`insert into customer_preferences (tenant_id, branch_id, customer_id, preferred_style_notes, product_preferences_json, favorite_colors_json) values (${T}, ${B}, ${C.big}, 'Short almond', '["OPI base"]', '["nude","red"]')`);
  await q(sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, loyalty_tier) values (${T}, ${B}, ${C.big}, 320, 320, 'Gold')`);
  await q(sql`set session_replication_role = origin`);
  await ci.scan(ctx());
}, 180_000);

describe('Customer Intelligence 30 — Customer 360-Degree Intelligence', () => {
  it('one read: identity (masked), newest-first service history with services, lifetime spend, preferences, loyalty; audited', async () => {
    const v = await ci.customer360(ctx(), C.big, audit, { fullContact: false });
    expect(v.identity).toMatchObject({ name: 'Big Spender', contact: 'masked', phoneVerified: true, state: 'verified' });
    expect(v.identity.phone).not.toContain('5550201'); expect(v.identity.email).not.toBe('big@example.com');
    expect(v.visitsTotal).toBe(4); expect(v.lifetimeSpendCents).toBe(69000);
    expect(v.visits[0]).toMatchObject({ services: ['Gel Manicure'], technician: 'Lan Nguyễn', totalCents: 9000 });
    expect(v.preferences).toEqual({ preferredTechnician: 'Lan Nguyễn', style: 'Short almond', products: ['OPI base'], colors: ['nude', 'red'] });
    expect(v.loyalty).toMatchObject({ points: 320, tier: 'Gold', membership: null });
    expect(v.suggestions).toEqual([]);
    expect(audits.at(-1)).toEqual({ customerId: C.big, view: '360' });
    const full = await ci.customer360(ctx(), C.big, audit, { fullContact: true });
    expect(full.identity.email).toBe('big@example.com');
  });
  it('evidence-backed review suggestions: a lapsed regular with no booking → rebook_review with its interval; unverified phone; no contact', async () => {
    const v = await ci.customer360(ctx(), C.lapsed, audit, { fullContact: false });
    const rb = v.suggestions.find((s) => s.code === 'rebook_review');
    expect(rb?.evidence).toEqual(expect.arrayContaining(['usual_interval_days:30', 'no_future_booking']));
    expect(v.suggestions.map((s) => s.code)).toContain('verify_phone');
    expect(v.identity.state).toBe('unverified');
    const bare = await ci.customer360(ctx(), C.bare, audit, { fullContact: false });
    expect(bare.suggestions).toEqual([{ code: 'add_contact', evidence: ['no_phone', 'no_email'] }]);
    expect(bare.classification).toMatchObject({ completedVisits: 0 });
  });
  it('another salon\'s customer is not found (and nothing is audited for it)', async () => {
    const n = audits.length;
    expect(await code(ci.customer360(ctx(), C.other, audit, { fullContact: false }))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(ci.customer360(ctx(), 'nope', audit, { fullContact: false }))).toBe('CUSTOMER_NOT_FOUND');
    expect(audits.length).toBe(n);
  });
});

describe('Customer Intelligence 30 — high-value list on the dashboard', () => {
  it('sort=spend lists by lifetime settled spend, highest first, with spendCents on each row', async () => {
    const r: any = await ci.customers(ctx(), { sort: 'spend' } as any, { fullContact: false });
    expect(r.items.map((i: any) => i.id).slice(0, 3)).toEqual([C.big, C.lapsed, C.small]);
    expect(r.items[0].spendCents).toBe(69000);
    expect(r.applied.sort).toBe('spend');
  });
  it('flag=high_value keeps only customers at or above the salon\'s 90th percentile of spend', async () => {
    const r: any = await ci.customers(ctx(), { flag: 'high_value' } as any, { fullContact: false });
    expect(r.items.map((i: any) => i.id)).toEqual([C.big]);
  });
});
