// pos-account-overview.core.ts — the POS Account overview, built from the tenant's REAL records.
//
// Sep 2026 merge: the developer's version returned one fixed sample for EVERY salon — "Sophia Nguyen" at "Luxe Nails &
// Spa", a VISA ending 4242, three San Francisco branches, "12 / 20" users, invented backups — which the screen showed as
// the salon's own account. Replaced: every value below comes from the tenant's rows, or is null where no source exists
// (the screen shows "Not connected"). Card details are held by the processor and are never read here.
import type { PosAccountOverview } from '@aipowersalon/api-contracts/tenant';
import { LANGUAGE_NAME, type AppLanguage } from '@aipowersalon/api-contracts';
export type { PosAccountOverview };   // owned by packages/api-contracts (Constitution 13 §13)

export type AccountRows = {
  user: { email: string | null; normalized_phone: string | null; role: string | null; created_at: unknown; last_login_at: unknown; password_changed_at: unknown } | null;
  tenant: { display_name: string | null; legal_name: string | null; business_phone: string | null; tenant_code: string | null } | null;
  branch: { name: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; timezone: string | null; public_display_name: string | null } | null;
  subscription: { plan_name: string | null; plan_code: string | null; status: string | null; current_period_end: unknown; monthly_price_cents: number | null } | null;
  branches: { name: string; address: string | null; city: string | null; state: string | null; role: string | null; access_level: string | null; status: string | null }[];
  roleCounts: { role: string; n: number }[];
  activeBranchCount: number;
  /** Vietnamese POS mandate WP-A: the language this user's POS shows — their own choice, else the salon's default POS
   *  language (the authority; tenants.locale is only a derived copy now). null = neither set (the POS shows English). */
  language?: AppLanguage | null;
};

const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const human = (r: string | null | undefined): string | null => (r ? r.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null);
const money = (c: number | null | undefined): string | null => (c == null ? null : `$${(Number(c) / 100).toFixed(2)}`);
const joinAddr = (b: { address: string | null; city: string | null; state: string | null; zip?: string | null }): string | null => {
  const s = [b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter((x) => x && String(x).trim()).join(', ');
  return s || null;
};

export const NOTIFICATION_CATEGORIES: { l: string; d: string }[] = [
  { l: 'SMS Notifications', d: 'Receipts, reminders & alerts' },
  { l: 'Email Notifications', d: 'Receipts, reports & updates' },
  { l: 'Push Notifications', d: 'Mobile app push alerts' },
  { l: 'Missed Call Alerts', d: 'Instant alerts for missed calls' },
  { l: 'Booking Alerts', d: 'New & updated bookings' },
  { l: 'Low Stock Alerts', d: 'Inventory low stock warnings' },
  { l: 'Payroll Approvals', d: 'Payroll ready approvals' },
  { l: 'Weekly Report Summaries', d: 'Performance summary emails' },
];

/** Pure: rows -> overview. Nothing is invented; a missing row gives nulls / zero counts. */
export function buildAccountOverview(rows: AccountRows): PosAccountOverview {
  const { user, tenant, branch, subscription } = rows;
  const count = (pred: (r: string) => boolean) => rows.roleCounts.filter((x) => pred(x.role.toUpperCase())).reduce((a, x) => a + x.n, 0);
  const renewal = iso(subscription?.current_period_end);
  const activeUsers = rows.roleCounts.reduce((a, x) => a + x.n, 0);
  return {
    profile: {
      email: user?.email ?? null, phone: user?.normalized_phone ?? null, loyaltyId: tenant?.tenant_code ?? null,
      language: rows.language ? LANGUAGE_NAME[rows.language] : null, memberSince: iso(user?.created_at), lastLogin: iso(user?.last_login_at), ownerTitle: human(user?.role),
    },
    business: {
      name: tenant?.legal_name ?? tenant?.display_name ?? null, branch: branch?.name ?? null, address: branch ? joinAddr(branch) : null,
      phone: branch?.phone ?? tenant?.business_phone ?? null, timezone: branch?.timezone ?? null,
      display: branch?.public_display_name ?? tenant?.display_name ?? null, receipts: tenant?.display_name ?? null,
    },
    security: { passwordChanged: iso(user?.password_changed_at), loginAlerts: null, trustedDevices: null },
    billing: {
      plan: subscription?.plan_name ?? subscription?.plan_code ?? null, renewal, renewalShort: renewal ? `Next: ${renewal.slice(0, 10)}` : null,
      method: null, expires: null, fee: money(subscription?.monthly_price_cents),
      locations: String(rows.activeBranchCount), users: String(activeUsers), features: [],
    },
    role: {
      level: human(user?.role), scope: rows.branches.length > 1 ? 'All assigned locations' : rows.branches.length === 1 ? 'This location' : null,
      branches: rows.branches.map((b) => ({ name: b.name, sub: joinAddr(b) ?? '', role: human(b.role) ?? '', access: human(b.access_level) ?? '', status: human(b.status) ?? '' })),
      totals: { users: activeUsers, admins: count((r) => r === 'OWNER' || r === 'ADMIN'), managers: count((r) => r === 'MANAGER'), staff: count((r) => r !== 'OWNER' && r !== 'ADMIN' && r !== 'MANAGER') },
    },
    backup: { last: null, status: null, next: null },
    notifications: NOTIFICATION_CATEGORIES,
  };
}
