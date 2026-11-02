// The POS Account overview is built from the tenant's own rows — never the developer's fixed sample (Sep 2026 merge).
import { describe, it, expect } from 'vitest';
import { buildAccountOverview, type AccountRows } from './pos-account-overview.core';

const none: AccountRows = { user: null, tenant: null, branch: null, subscription: null, branches: [], roleCounts: [], activeBranchCount: 0 };
describe('POS Account overview', () => {
  it('with no rows every value is null / zero — nothing invented', () => {
    const o = buildAccountOverview(none);
    const text = JSON.stringify(o);
    for (const fake of ['Sophia', 'Luxe', '4242', 'San Francisco', 'Premium', '12 / 20', 'Successful', '$499']) expect(text).not.toContain(fake);
    expect(o.profile.email).toBeNull(); expect(o.billing.method).toBeNull(); expect(o.backup).toEqual({ last: null, status: null, next: null });
    expect(o.role.totals).toEqual({ users: 0, admins: 0, managers: 0, staff: 0 });
  });
  it('real rows flow through; card details never do (the processor holds them)', () => {
    const o = buildAccountOverview({ ...none,
      user: { email: 'kim@salon.com', normalized_phone: '+15550100', role: 'OWNER', created_at: '2025-02-01T00:00:00Z', last_login_at: null, password_changed_at: '2026-09-01T00:00:00Z' },
      tenant: { display_name: 'Kim Nails', legal_name: 'Kim Nails LLC', business_phone: null, tenant_code: 'KIM01' },
      branch: { name: 'Main', address: '1 Elm St', city: 'Camden', state: 'NJ', zip: '08101', phone: '555-0101', timezone: 'America/New_York', public_display_name: null },
      subscription: { plan_name: 'Starter', plan_code: 'starter', status: 'active', current_period_end: '2026-10-15T00:00:00Z', monthly_price_cents: 4900 },
      roleCounts: [{ role: 'OWNER', n: 1 }, { role: 'MANAGER', n: 1 }, { role: 'TECHNICIAN', n: 4 }], activeBranchCount: 1 });
    expect(o.profile).toMatchObject({ email: 'kim@salon.com', loyaltyId: 'KIM01', ownerTitle: 'Owner' });
    expect(o.business).toMatchObject({ name: 'Kim Nails LLC', branch: 'Main', address: '1 Elm St, Camden, NJ, 08101', timezone: 'America/New_York' });
    expect(o.billing).toMatchObject({ plan: 'Starter', fee: '$49.00', locations: '1', users: '6', method: null, expires: null });
    expect(o.role.totals).toEqual({ users: 6, admins: 1, managers: 1, staff: 4 });
  });
  it('WP-A: the language is the resolved POS language (own choice ?? salon default) by name, never tenants.locale', () => {
    expect(buildAccountOverview({ ...none, language: 'vi' }).profile.language).toBe('Tiếng Việt');
    expect(buildAccountOverview({ ...none, language: 'en' }).profile.language).toBe('English');
    expect(buildAccountOverview(none).profile.language).toBeNull();
  });
});
