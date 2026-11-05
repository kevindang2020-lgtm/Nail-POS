// platform-roles.ts — Constitution 7 §5–§7: platform roles and default deny INSIDE the control plane.
//
// Until now there was one platform role, SUPER_ADMIN, holding every super_admin.* key (§5's forbidden "admin = true"),
// and ~867 of ~1,006 /super-admin routes declared no permission at all, so any platform identity reached them (§7).
//
//  • Every platform route now has an EFFECTIVE key: its own @RequirePermission if it declares one, otherwise the key
//    DERIVED here from its path (domain) and method (read vs manage). PlatformDomainGuard enforces the derived key.
//  • A platform path with no domain mapping is DENIED (default deny) — a coverage test fails the build before that can
//    reach production, so a new controller must be classified when it is written.
//  • Platform roles are permission SETS over the existing super_admin.* keys (the namespace is kept — decision D2).
//    PLATFORM_SUPER_ADMIN = every key, which is exactly what every existing SUPER_ADMIN account holds today.
//
// Nothing here imports rbac.ts (rbac imports this file): role definitions are predicates over the full key list, and
// rbac.ts resolves them.

/** Read vs manage key per control-plane domain. Reuses an existing key wherever one already means the same thing. */
export const PLATFORM_DOMAINS = {
  analytics:      { view: 'super_admin.analytics.view',        manage: 'super_admin.analytics.manage' },
  tenants:        { view: 'super_admin.tenants.view',          manage: 'super_admin.tenants.edit' },
  users:          { view: 'super_admin.users.view',            manage: 'super_admin.users.manage' },
  onboarding:     { view: 'super_admin.onboarding.view',       manage: 'super_admin.onboarding.manage' },
  plans:          { view: 'super_admin.plans.view',            manage: 'super_admin.plans.manage' },
  billing:        { view: 'super_admin.billing.view',          manage: 'super_admin.billing.manage' },
  payments:       { view: 'super_admin.payments.view',         manage: 'super_admin.payments.manage' },
  communications: { view: 'super_admin.communications.view',   manage: 'super_admin.communications.manage' },
  marketing:      { view: 'super_admin.marketing.view',        manage: 'super_admin.marketing.manage' },
  ai:             { view: 'super_admin.ai.view',               manage: 'super_admin.ai.manage' },
  customers:      { view: 'super_admin.customers.view',        manage: 'super_admin.customers.manage' },
  operations:     { view: 'super_admin.operations.view',       manage: 'super_admin.operations.manage' },
  workforce:      { view: 'super_admin.technicians.view',      manage: 'super_admin.technicians.manage' },
  catalog:        { view: 'super_admin.catalog.view',          manage: 'super_admin.catalog.manage' },
  settings:       { view: 'super_admin.general_settings.view', manage: 'super_admin.general_settings.edit' },
  support:        { view: 'super_admin.support.view',          manage: 'super_admin.support.manage' },
  system:         { view: 'super_admin.system_operations.view', manage: 'super_admin.system.manage' },
  security:       { view: 'super_admin.security.view',         manage: 'super_admin.security.manage' },
  audit:          { view: 'super_admin.audit_logs.view',       manage: 'super_admin.audit.manage' },
  integrations:   { view: 'super_admin.integrations.view',     manage: 'super_admin.integrations.manage' },
} as const;
export type PlatformDomain = keyof typeof PLATFORM_DOMAINS;

/** Keys introduced by this file (the rest already existed). rbac.ts adds them to PERMISSIONS, so SUPER_ADMIN holds them. */
export const PLATFORM_DOMAIN_NEW_KEYS: readonly string[] = [
  'super_admin.analytics.view', 'super_admin.analytics.manage', 'super_admin.users.view', 'super_admin.onboarding.manage',
  'super_admin.plans.view', 'super_admin.plans.manage', 'super_admin.billing.manage', 'super_admin.payments.view',
  'super_admin.payments.manage', 'super_admin.communications.view', 'super_admin.communications.manage',
  'super_admin.marketing.view', 'super_admin.marketing.manage', 'super_admin.ai.view', 'super_admin.ai.manage',
  'super_admin.customers.view', 'super_admin.customers.manage', 'super_admin.operations.view', 'super_admin.operations.manage',
  'super_admin.catalog.view', 'super_admin.support.view', 'super_admin.support.manage', 'super_admin.system.manage',
  'super_admin.security.view', 'super_admin.security.manage', 'super_admin.audit.manage', 'super_admin.integrations.manage',
  // §25: changing a platform user's role is its own key — held by PLATFORM_SUPER_ADMIN only
  'super_admin.platform_roles.manage',
  // D7 (Oct 22 2026): the ticket deletion-code / remove flow is its own key, so that moving POS Ticket Oversight from the
  // support domain to operations keeps the support team's old grant working without handing it every operations write.
  'super_admin.tickets.remove',
];

/**
 * Every platform route's domain, keyed by its first path segment after /super-admin — or, under the mixed
 * /super-admin/platform/* surface, by its first two ("platform/users"). Generated from the measured route inventory
 * (docs/control-plane-route-inventory.md); the coverage test fails on any platform route this map does not classify.
 */
export const PLATFORM_PATH_DOMAIN: Readonly<Record<string, PlatformDomain>> = {
  // analytics & reporting
  'overview': 'analytics', 'dashboard': 'analytics', 'analytics': 'analytics', 'report-builder': 'analytics',
  'scheduled-reports': 'analytics', 'tenant-activity': 'analytics', 'project-status': 'analytics',
  'platform/reports': 'analytics', 'platform/report-exports': 'analytics', 'platform/scheduled-reports': 'analytics',
  'platform/tenant-performance': 'analytics', 'platform/top-performing-tenants': 'analytics', 'platform/state': 'analytics',
  'platform/branches-dashboard': 'analytics', 'platform/users-dashboard': 'analytics',
  // tenants & branches
  'tenants': 'tenants', 'owners': 'tenants',
  // BUILD_PLAN Phase 12: /super-admin/operations — a platform user's own async exports. Read = the tenant-list key every
  // platform role holds; WHICH operation they may see (their own, or one whose export key they hold) is the service's check.
  'operations': 'tenants', 'platform-search': 'tenants', 'approvals': 'tenants', 'tenant-locations': 'tenants', 'tenant-health': 'tenants',
  'platform/branches': 'tenants', 'platform/tenant-users-branches': 'tenants',
  // platform & tenant users
  'platform/users': 'users', 'platform/roles': 'users', 'platform/invitations': 'users', 'platform/access-requests': 'users',
  'platform/sessions': 'users', 'platform-staff': 'users',
  // onboarding & approvals
  'onboarding': 'onboarding', 'website-leads': 'onboarding', 'platform/applications': 'onboarding', 'platform/leads': 'onboarding',
  // plans, features, limits
  'plans': 'plans', 'features': 'plans', 'platform/usage-limits': 'plans', 'platform/app-flags': 'plans', 'sms-packages': 'plans', 'sms-tenant-plan': 'plans',
  // platform billing
  'billing': 'billing', 'hardware-packages': 'billing', 'hardware-payment': 'billing', 'platform/hardware': 'billing',
  // payments & revenue
  'merchant-accounts': 'payments', 'settlements': 'payments', 'disputes': 'payments', 'reconciliation': 'payments',
  'tap-to-pay': 'payments', 'revenue-residuals': 'payments', 'compensation': 'payments', 'payroll': 'payments',
  'platform/payment-gateways': 'payments', 'platform/payments': 'payments', 'platform/payments-transactions': 'payments',
  // communications
  'communications': 'communications', 'campaigns': 'communications', 'smart-reminders': 'communications',
  'messaging': 'communications', 'voice': 'communications', 'voice-transcription': 'communications', 'platform/reminders': 'communications',
  // marketing, promotions, loyalty, memberships
  'promotions': 'marketing', 'deals': 'marketing', 'loyalty': 'marketing',
  // D7 (Oct 22 2026): gift-card PROGRAMS are marketing; gift-card SETTLEMENT moves money between salons and the platform
  // and is finance work — classified payments (the FINANCE role holds super_admin.payments.*). Two-segment key, like platform/*.
  'gift-cards/programs': 'marketing', 'gift-cards/settlement': 'payments',
  'membership-programs': 'marketing', 'memberships': 'marketing',
  // AI & automation
  'ai': 'ai', 'ai-business': 'ai', 'ai-checkout-upsell': 'ai', 'ai-customer-profile': 'ai', 'ai-forecasting': 'ai',
  'ai-insights': 'ai', 'ai-narrative-model-versions': 'ai', 'ai-ocr-receipt': 'ai', 'ai-plans': 'ai', 'ai-platform': 'ai',
  'ai-queue-assignment': 'ai', 'ai-report-deliveries': 'ai', 'ai-report-schedules': 'ai', 'ai-report-templates': 'ai',
  'ai-reports': 'ai', 'ai-review-reputation': 'ai', 'ai-scheduling-optimizer': 'ai', 'ai-usage': 'ai', 'copilot': 'ai',
  'automation-rules': 'ai', 'platform/ai-packages': 'ai', 'platform/automations': 'ai',
  // customer data oversight
  'customer-data-oversight': 'customers', 'customer-phone': 'customers', 'platform/customers': 'customers',
  'platform/customer-duplicates': 'customers', 'platform/privacy-requests': 'customers',
  // appointment / booking / check-in / queue monitors
  'appointment-oversight': 'operations', 'booking-checkin': 'operations', 'booking-verification': 'operations',
  'checkin': 'operations', 'queue': 'operations', 'platform/appointments': 'operations',
  // workforce oversight
  'technicians': 'workforce', 'tech-profiles': 'workforce', 'technician-memberships': 'workforce', 'staff': 'workforce',
  'community-moderation': 'workforce', 'nail-showcase': 'workforce',
  // catalog management
  'catalog': 'catalog', 'product-catalog': 'catalog', 'platform/categories': 'catalog', 'platform/product-categories': 'catalog',
  'platform/products': 'catalog', 'platform/service-categories': 'catalog', 'platform/services': 'catalog',
  'platform/suppliers': 'catalog', 'platform/tenant-product-categories': 'catalog', 'platform/tenant-service-categories': 'catalog',
  'platform/brands': 'catalog',
  // platform settings
  'settings': 'settings',
  // support center
  'support': 'support', 'help': 'support', 'platform/support-sessions': 'support',
  // D7 (Oct 22 2026): POS Ticket Oversight is an operations monitor (it was filed under support on Oct 12); its removal
  // flow declares super_admin.tickets.remove, which SUPPORT keeps — see PLATFORM_ROLE_GRANTS.
  'tickets': 'operations',
  // system status & operations
  'system-status': 'system', 'system': 'system', 'system-health': 'system', 'realtime': 'system', 'events': 'system',
  'mobile-versions': 'system',   // BUILD_PLAN Phase 13 B: store app version policies (routes declare super_admin.mobile_versions.*)
  'database': 'system',   // BUILD_PLAN Phase 10: the Database page (its routes declare super_admin.database.*)
  'observability': 'system',   // BUILD_PLAN Phase 14 A: request / correlation / trace / log search (routes declare super_admin.telemetry.*)
  'jobs': 'system',   // Phase 2: the one job queue (stats, dead jobs, retry/cancel)
  // GET /super-admin/stream — the admin app's SSE stream. It carries only the aggregated live-ops snapshot the System
  // Status screen shows (counts, per-minute rates, realtime health). Unclassified until Constitution 5 Step 8, so
  // PlatformDomainGuard refused it to every platform identity (403 "not classified", confirmed live Oct 4 2026).
  'stream': 'system',
  'device-management': 'system', 'platform/devices': 'system', 'alerts': 'system',
  // security
  'security': 'security', 'platform/security': 'security', 'kill-switches': 'system',
  // audit
  'audit-logs': 'audit', 'audit-events': 'audit', 'platform/audit-logs': 'audit',
  // integrations
  'integrations': 'integrations', 'platform/integrations': 'integrations',
};

/** The domain-map key for a request path ("/super-admin/platform/users/:id" → "platform/users"), or null if not a platform path. */
export function platformPathKey(path: string): string | null {
  const segs = String(path || '').split('?')[0].split('/').filter(Boolean);
  const i = segs.indexOf('super-admin');
  if (i < 0) return null;
  const rest = segs.slice(i + 1);
  if (!rest.length) return '';
  return TWO_SEGMENT_PREFIXES.has(rest[0]) ? `${rest[0]}/${rest[1] ?? ''}` : rest[0];
}
/** Surfaces whose first segment mixes domains: the map keys them by two segments ("platform/users", "gift-cards/settlement"). */
const TWO_SEGMENT_PREFIXES: ReadonlySet<string> = new Set(['platform', 'gift-cards']);

/** §7: the key a platform route requires when it declares none — null when the path is not classified (→ deny). */
export function platformDomainKeyFor(path: string, method: string): string | null {
  const k = platformPathKey(path);
  if (k === null) return null;
  const d = PLATFORM_PATH_DOMAIN[k];
  if (!d) return null;
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
  return read ? PLATFORM_DOMAINS[d].view : PLATFORM_DOMAINS[d].manage;
}

// ── Platform roles (§5) ───────────────────────────────────────────────────────────────────────────────────────────────
export const PLATFORM_ROLES = [
  'PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_FINANCE', 'PLATFORM_SECURITY',
  'PLATFORM_OPERATIONS', 'PLATFORM_AUDITOR', 'PLATFORM_AI_ADMIN', 'PLATFORM_BILLING_ADMIN', 'PLATFORM_ONBOARDING',
  'PLATFORM_DEVELOPER_SUPPORT',
] as const;
export type PlatformRole = typeof PLATFORM_ROLES[number];
export const isPlatformRole = (r: unknown): r is PlatformRole => typeof r === 'string' && (PLATFORM_ROLES as readonly string[]).includes(r);
/** A platform account whose role is missing or unreadable gets read-only access, never everything (fail SAFE). */
export const PLATFORM_FALLBACK_ROLE: PlatformRole = 'PLATFORM_AUDITOR';

const v = (d: PlatformDomain) => PLATFORM_DOMAINS[d].view;
const m = (d: PlatformDomain) => PLATFORM_DOMAINS[d].manage;
const isView = (k: string) => /\.view$/.test(k) || /\.(audit|details|api_health|credentials|business_categories|legal_documents|maintenance|tenant_presets)\.view$/.test(k);
const under = (...prefixes: string[]) => (k: string) => prefixes.some((p) => k.startsWith(p));
const oneOf = (...keys: string[]) => (k: string) => keys.includes(k);
const anyOf = (...ps: Array<(k: string) => boolean>) => (k: string) => ps.some((p) => p(k));

/** Keys only the top role may hold: platform role changes (§25) and security policy / emergency controls. */
export const SUPER_ADMIN_ONLY_KEYS: readonly string[] = ['super_admin.platform_roles.manage', 'super_admin.security.manage'];

/**
 * Each role as a predicate over the full super_admin.* key list. Least privilege: a role gets its domains, plus READ on
 * the domains it needs for context (every role can see the tenant list), and nothing else.
 */
export const PLATFORM_ROLE_GRANTS: Readonly<Record<PlatformRole, (key: string) => boolean>> = {
  PLATFORM_SUPER_ADMIN: () => true,
  PLATFORM_ADMIN: (k) => !SUPER_ADMIN_ONLY_KEYS.includes(k),
  PLATFORM_SUPPORT: anyOf(
    oneOf(v('tenants'), v('users'), v('support'), m('support'), v('operations'), v('workforce'), v('onboarding'), v('catalog'),
          v('communications'), v('system'), 'super_admin.memberships.support_mode', 'super_admin.technicians.support_mode',
          'super_admin.memberships.view', 'super_admin.telemetry.view',   // §181: support finds a request — not its sensitive fields
          'super_admin.tickets.remove'),   // D7: ticket oversight moved to operations; support keeps the removal flow it had
  ),
  PLATFORM_FINANCE: anyOf(
    under('super_admin.billing.', 'super_admin.disputes.', 'super_admin.payments.', 'super_admin.sms_billing.'),
    oneOf(v('plans'), v('analytics'), v('tenants')),
  ),
  PLATFORM_SECURITY: anyOf(
    oneOf(v('security'), v('audit'), v('users'), v('tenants'), v('system'), v('integrations'),
          'super_admin.integrations.compromised.disable', 'super_admin.integrations.audit.view',
          'super_admin.telemetry.view', 'super_admin.telemetry.sensitive.view'),   // §181: security traces
  ),
  PLATFORM_OPERATIONS: anyOf(
    oneOf(v('system'), m('system'), v('integrations'), m('integrations'), v('operations'), v('tenants'), v('analytics'),
          'super_admin.sms_emergency.disable', 'super_admin.integrations.api_health.view', 'super_admin.integrations.connection.test',
          'super_admin.mobile_versions.view', 'super_admin.mobile_versions.manage',
          'super_admin.telemetry.view', 'super_admin.telemetry.sensitive.view',   // §181: operations debug per-request rows
          'super_admin.tickets.remove'),   // D7: POS Ticket Oversight is operations work, removal included
  ),
  PLATFORM_AUDITOR: (k) => isView(k) && !k.endsWith('view_sensitive') && !k.endsWith('.sensitive.view'),
  PLATFORM_AI_ADMIN: anyOf(oneOf(v('ai'), m('ai'), 'super_admin.ai_packages.manage', v('tenants'), v('analytics'))),
  PLATFORM_BILLING_ADMIN: anyOf(
    under('super_admin.billing.', 'super_admin.sms_packages.', 'super_admin.sms_tenant_plan.'),
    oneOf(v('plans'), m('plans'), 'super_admin.subscriptions.manage', v('tenants')),
  ),
  PLATFORM_ONBOARDING: anyOf(
    under('super_admin.applications.', 'super_admin.onboarding.', 'super_admin.platform_locations.'),
    oneOf(v('tenants'), 'super_admin.tenants.create', v('users')),
  ),
  PLATFORM_DEVELOPER_SUPPORT: anyOf(
    oneOf(v('integrations'), v('system'), v('tenants'), 'super_admin.integrations.api_health.view', 'super_admin.integrations.details.view',
          'super_admin.telemetry.view'),
  ),
};
