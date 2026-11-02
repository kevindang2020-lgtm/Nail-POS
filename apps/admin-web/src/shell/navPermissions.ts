// navPermissions.ts — Constitution 7 §10: the Super Admin sidebar shows what the signed-in platform role can open.
// Visibility follows PERMISSIONS (can("super_admin.billing.view")), never a role name. The backend stays the
// authority: hiding an entry is usability only — PlatformDomainGuard refuses the route regardless.
//
// Each destination's first path segment → the server's control-plane domain (packages/permissions platform-roles.ts);
// the entry needs that domain's VIEW key. A test fails if a sidebar destination is not mapped, and pins every key here
// to the server's key list.
export const NAV_DOMAIN_VIEW_KEY: Readonly<Record<string, string>> = {
  // analytics & reporting
  'dashboard': 'super_admin.analytics.view', 'live-operations': 'super_admin.analytics.view', 'analytics': 'super_admin.analytics.view',
  'platform-dashboard': 'super_admin.analytics.view', 'report-builder': 'super_admin.analytics.view', 'scheduled-reports': 'super_admin.analytics.view',
  'platform-reports': 'super_admin.analytics.view', 'tenant-activity': 'super_admin.analytics.view', 'project-status': 'super_admin.analytics.view',
  // tenants & branches
  'tenants': 'super_admin.tenants.view', 'branches': 'super_admin.tenants.view', 'owner-salons': 'super_admin.tenants.view',
  // users
  'users-roles': 'super_admin.users.view', 'platform-staff': 'super_admin.users.view', 'approvals': 'super_admin.tenants.view',
  // onboarding
  'onboarding': 'super_admin.onboarding.view', 'tenant-applications': 'super_admin.onboarding.view', 'website-leads': 'super_admin.onboarding.view',
  // plans & limits
  'plans': 'super_admin.plans.view', 'feature-registry': 'super_admin.plans.view', 'sms-verification-packages': 'super_admin.sms_packages.view',   // SCAN (Oct 12): its routes declare sms_packages.view explicitly
  'usage-limits': 'super_admin.plans.view',
  // billing
  'subscriptions': 'super_admin.billing.view', 'billing-cycle': 'super_admin.billing.view', 'loyalty-network': 'super_admin.billing.view', 'hardware-packages': 'super_admin.billing.view',
  'hardware-payments': 'super_admin.billing.view', 'hardware-payment-reports': 'super_admin.billing.view',
  // payments & revenue
  'payments-transactions': 'super_admin.payments.view', 'merchant-accounts': 'super_admin.payments.view', 'settlements-deposits': 'super_admin.payments.view',
  'chargebacks-disputes': 'super_admin.payments.view', 'payment-gateways': 'super_admin.payments.view', 'tap-to-pay': 'super_admin.payments.view', 'revenue-residuals': 'super_admin.payments.view',
  'compensation-oversight': 'super_admin.payments.view',
  'gift-card-settlement': 'super_admin.payments.view',   // D7 (Oct 22): /super-admin/gift-cards/settlement is classified payments server-side (finance)
  // communications
  'communications': 'super_admin.communications.view', 'smart-reminders': 'super_admin.communications.view', 'tenant-messaging': 'super_admin.communications.view',
  'a2p-registration': 'super_admin.communications.view', 'messaging-environment': 'super_admin.communications.view',
  // marketing, loyalty, memberships
  'marketing-campaigns': 'super_admin.marketing.view', 'promotions-offers': 'super_admin.marketing.view', 'loyalty-programs': 'super_admin.marketing.view',
  'membership-programs': 'super_admin.marketing.view', 'gift-card-programs': 'super_admin.marketing.view',
  // AI & automation
  'ai-insights': 'super_admin.ai.view', 'ai-reports': 'super_admin.ai.view', 'automation-rules': 'super_admin.ai.view', 'ai-usage-configuration': 'super_admin.ai.view',
  'ai-receptionist': 'super_admin.ai.view', 'reception-copilot': 'super_admin.ai.view', 'ai-booking-analytics': 'super_admin.ai.view',
  'ai-customer-profile': 'super_admin.ai.view', 'ai-checkout-upsell': 'super_admin.ai.view', 'ai-review-reputation': 'super_admin.ai.view',
  'ai-ocr-receipt': 'super_admin.ai.view', 'ai-forecasting': 'super_admin.ai.view',
  'ai-business-adoption': 'super_admin.ai.view', 'ai-platform': 'super_admin.ai.view', 'ai-packages': 'super_admin.ai.view', 'ai-plans': 'super_admin.ai.view',
  'ai-subscriptions': 'super_admin.ai.view',
  // customer data
  'customer-data-oversight': 'super_admin.customers.view', 'customer-phone-oversight': 'super_admin.customers.view', 'booking-verification-oversight': 'super_admin.operations.view', 'deals-oversight': 'super_admin.marketing.view',
  // operations monitors
  'appointment-oversight': 'super_admin.operations.view', 'booking-checkin': 'super_admin.operations.view', 'queue-management': 'super_admin.operations.view',
  'ticket-oversight': 'super_admin.operations.view',   // D7 (Oct 22): /super-admin/tickets is classified operations server-side
  'check-in-devices': 'super_admin.operations.view',
  'ai-queue-assignment': 'super_admin.operations.view',   // BUILD_PLAN Phase 6: AI queue assignment oversight (an operations monitor)
  'ai-scheduling-optimizer': 'super_admin.operations.view',   // BUILD_PLAN Phase 7: its reads need operations.view (writes: super_admin.ai.manage)
  // workforce
  'staff': 'super_admin.technicians.view', 'tech-profiles': 'super_admin.technicians.view', 'nail-showcase': 'super_admin.technicians.view',
  'community-moderation': 'super_admin.technicians.view',   // BUILD_PLAN Phase 8: the server classifies /super-admin/community-moderation under workforce (writes: super_admin.technicians.manage)
  // catalog
  'services': 'super_admin.catalog.view', 'service-templates': 'super_admin.catalog.view', 'product-catalog': 'super_admin.catalog.view',
  // settings
  'settings': 'super_admin.general_settings.view',
  // support
  'support-access': 'super_admin.support.view',
  // system
  'system-operations': 'super_admin.system_operations.view', 'system-status': 'super_admin.system_operations.view', 'system-health': 'super_admin.system_operations.view',
  'devices-management': 'super_admin.system_operations.view', 'alerts': 'super_admin.system_operations.view', 'jobs': 'super_admin.system_operations.view',
  'database': 'super_admin.database.view',   // BUILD_PLAN Phase 10: System Operations → Database
  'mobile-versions': 'super_admin.mobile_versions.view',   // BUILD_PLAN Phase 13 B: System Operations → Mobile app versions
  'request-search': 'super_admin.telemetry.view',   // BUILD_PLAN Phase 14 A: System → Request search (C11 §181, §291–292)
  'oncall': 'super_admin.system_operations.view',   // BUILD_PLAN Phase 14 C: System → On-call & monitoring (C11 §262–265)
  'ops-dashboards': 'super_admin.system_operations.view', 'branch-health': 'super_admin.system_operations.view',   // BUILD_PLAN Phase 14 B (C11 §145, §149–155, §345)
  // security & audit & integrations
  'security-compliance': 'super_admin.security.view', 'audit-logs': 'super_admin.audit_logs.view', 'integrations': 'super_admin.integrations.view',
};

export function navSegment(to: string): string { return String(to).split('?')[0].split('/').filter(Boolean)[0] ?? ''; }
/** Can this principal open this sidebar destination? Unmapped → hidden (default deny; a test keeps the map complete). */
export function canOpen(to: string, permissions: readonly string[] | undefined): boolean {
  const key = NAV_DOMAIN_VIEW_KEY[navSegment(to)];
  return !!key && !!permissions && permissions.includes(key);
}
/** SCAN (Oct 12 2026): where "/" (and an unknown path) lands — the first destination this principal can open, in sidebar-map
 *  order (Overview first). /dashboard needs analytics.view; a support / onboarding / billing role landed on a page it could
 *  not read. A principal with no view key lands on its own account page. */
export function landingPath(permissions: readonly string[] | undefined): string {
  for (const seg of ['dashboard', 'tenants', 'support-access', ...Object.keys(NAV_DOMAIN_VIEW_KEY)]) if (canOpen('/' + seg, permissions)) return '/' + seg;
  return '/account';
}
