// route-domains.mjs — BUILD_PLAN Phase 12 (Constitution 5 DoD #2): every route is assigned an explicit BUSINESS DOMAIN.
//
// The vocabulary is the Phase 10 ownership registry's (apps/api/db/ownership/heuristics.mjs DOMAINS — the same 22 names
// every table carries), so a route and the tables it writes speak one language. The manifest shows `domain=<d>` and the
// OpenAPI document `x-domain`; check:api-contract fails on a route this map cannot place.
//
// How a route is placed, first match wins:
//   1. a `@Domain('booking')` decorator on the handler or its controller (none needed today; the reader honours one)
//   2. SOURCE — the module directory the controller lives in (modules/<m>/src/<dir>, or apps/api/src/<dir>); most
//      directories are one domain. A directory mapped to BY_PATH is a mix and goes to step 3.
//   3. PATH — keyword rules over the path with its realm prefix removed (/pos, /owner, /super-admin/platform …)
// A new controller directory that is in neither table and whose path matches no rule has NO domain: the gate names it.
import { DOMAINS } from '../db/ownership/heuristics.mjs';

export { DOMAINS };
const BY_PATH = null;

/** Source directory → domain. Key: `<module>:<first dir under src>` for modules/*, `api:<dir>` for apps/api/src. */
export const SOURCE_DOMAINS = {
  // apps/api/src
  'api:account': 'IDENTITY', 'api:ai-booking': 'AI', 'api:api-webhooks': 'OPERATIONS', 'api:common': BY_PATH,
  'api:customer-display': 'OPERATIONS', 'api:customer': 'CUSTOMERS', 'api:deployments': 'OPERATIONS',
  'api:domain-streams': 'OPERATIONS', 'api:events': 'OPERATIONS', 'api:health': 'OPERATIONS', 'api:jobs': 'OPERATIONS',
  'api:logs': 'OPERATIONS', 'api:oauth': 'IDENTITY', 'api:observability': 'OPERATIONS', 'api:pos-account': 'IDENTITY',
  'api:pos-project-status': 'SUPPORT', 'api:pos': BY_PATH, 'api:profile': 'IDENTITY', 'api:project-status': 'SUPPORT',
  'api:realtime': 'OPERATIONS', 'api:mobile-links': 'OPERATIONS', 'api:mobile-config': 'OPERATIONS',   /* Phase 13 B: /app-config, UPDATE_REQUIRED, Super Admin mobile versions */   /* Phase 13 D: AASA / assetlinks / app-links fallback */ 'api:super-admin-system-status': 'OPERATIONS', 'api:api': BY_PATH,
  // modules/ai
  'ai:ai': 'AI', 'ai:ai-analytics-forecasting': 'AI', 'ai:ai-center': 'AI', 'ai:ai-customer-profile': 'AI', 'ai:ai-governance': 'AI',
  'ai:ai-inventory': 'AI', 'ai:ai-marketing': 'AI', 'ai:ai-money-protection': 'AI', 'ai:ai-queue-assignment': 'AI',
  'ai:ai-readiness': 'AI', 'ai:ai-revenue': 'AI', 'ai:ai-review-reputation': 'AI', 'ai:ai-scheduling-optimizer': 'AI',
  'ai:ai-voice-transcription': 'AI', 'ai:call-intelligence': 'AI', 'ai:voice-booking': 'AI', 'ai:workflow-runs': 'AI',
  // modules/analytics, reports
  'analytics:ai-business': 'ANALYTICS', 'analytics:dashboard': 'ANALYTICS', 'analytics:overview': 'ANALYTICS', 'analytics:owner': 'ANALYTICS',
  'reports:marketing-report': 'ANALYTICS', 'reports:menu-insights': 'ANALYTICS', 'reports:reports': 'ANALYTICS',
  // modules/appointments, booking, queue
  'appointments:tech-appointments': 'BOOKING', 'booking:booking': 'BOOKING', 'booking:customer-activation': 'IDENTITY',
  'booking:customer-booking': 'BOOKING', 'booking:customer-phone': 'IDENTITY',
  'queue:check-in': 'BOOKING', 'queue:go-check-in': 'BOOKING', 'queue:live-technician-schedule': 'BOOKING', 'queue:queue': 'BOOKING',
  'queue:service-done': 'CHECKOUT', 'queue:serving': 'CHECKOUT', 'queue:tech': BY_PATH, 'queue:tech-queue': 'BOOKING',
  'queue:technician-help': 'WORKFORCE',
  // modules/audit
  'audit:audit.controller.ts': 'AUDIT',
  // modules/catalog, inventory
  'catalog:service-add-ons': 'CATALOG', 'catalog:services': 'CATALOG',
  'inventory:inventory.controller.ts': 'INVENTORY', 'inventory:technician-inventory.controller.ts': 'INVENTORY',
  // modules/checkout, payments, gift-cards
  'checkout:ai-checkout-upsell': 'CHECKOUT', 'checkout:cash-drawer': 'PAYMENTS', 'checkout:checkout': 'CHECKOUT',
  'checkout:mobile-checkout': 'CHECKOUT', 'checkout:skip-line-checkout': 'CHECKOUT', 'checkout:ticket-history': 'CHECKOUT',
  'payments:customer-payments': 'PAYMENTS', 'payments:deposit-reconciliation': 'PAYMENTS', 'payments:hardware-payment': 'PAYMENTS',
  'payments:invoices': 'FINANCE', 'payments:payments': 'PAYMENTS', 'payments:refunds-voids': 'PAYMENTS', 'payments:split-payments': 'PAYMENTS',
  'gift-cards:gift-card-stock': 'PAYMENTS', 'gift-cards:gift-cards': 'PAYMENTS',
  // modules/communications
  'communications:campaigns': 'MARKETING', 'communications:communications': 'COMMUNICATIONS', 'communications:end-of-day-followups': 'MARKETING',
  'communications:messaging-inbound': 'COMMUNICATIONS', 'communications:messaging-readiness': 'COMMUNICATIONS',
  'communications:notifications': 'COMMUNICATIONS', 'communications:platform-announcements': 'COMMUNICATIONS', 'communications:push': 'COMMUNICATIONS', 'communications:reminders': 'COMMUNICATIONS',
  'communications:sms-packages': 'COMMUNICATIONS', 'communications:tenant-a2p': 'COMMUNICATIONS', 'communications:tenant-messaging': 'COMMUNICATIONS',
  // modules/customers, loyalty, memberships, deals, marketing
  'customers:customer-salons': 'CUSTOMERS', 'customers:customers': 'CUSTOMERS', 'customers:pos-referrals': 'LOYALTY',
  'customers:reviews': 'CUSTOMERS', 'customers:wallet': 'PAYMENTS',
  'loyalty:loyalty.controller.ts': 'LOYALTY',
  'finance:expense.controller.ts': 'FINANCE',   // Receipt/Expense/OCR/Accounting mandate (Oct 21 2026)
  'memberships:membership-billing.controller.ts': 'MEMBERSHIPS', 'memberships:membership-comms.controller.ts': 'MEMBERSHIPS',
  'memberships:membership-compensation.controller.ts': 'MEMBERSHIPS', 'memberships:membership-enroll.controller.ts': 'MEMBERSHIPS',
  'memberships:memberships.controller.ts': 'MEMBERSHIPS',
  'deals:bundles': 'DEALS', 'deals:deals': 'DEALS', 'deals:promotions': 'DEALS', 'deals:salon-promotions': 'DEALS',
  'marketing:display-advertising': 'MARKETING',
  // modules/identity
  'identity:auth': 'IDENTITY', 'identity:customer-registration': 'IDENTITY', 'identity:customer-security': 'SECURITY', 'identity:staff-roles': 'IDENTITY',
  // modules/platform, safety, support, tenants
  'platform:platform-approvals': 'PLATFORM', 'platform:super-admin-automation': 'PLATFORM', 'platform:super-admin-plans': 'FINANCE',
  'safety:ai-ocr-receipt': 'AI', 'safety:tenant-safety-community': 'SUPPORT',
  'support:help': 'SUPPORT',
  'tenants:branding': 'TENANTS', 'tenants:devices': 'OPERATIONS', 'tenants:owner-portfolio': 'TENANTS', 'tenants:pos-social': 'MARKETING',
  'tenants:settings': 'TENANTS', 'tenants:tenant-entitlements': 'TENANTS', 'tenants:tenant-locations': 'TENANTS', 'tenants:tenant-navigation': 'TENANTS',
  // modules/workforce
  'workforce:access-governance': 'SECURITY', 'workforce:approvals': 'WORKFORCE', 'workforce:commission-report': 'FINANCE',
  'workforce:compensation': 'FINANCE', 'workforce:nail-showcase': 'WORKFORCE', 'workforce:payroll': 'FINANCE', 'workforce:pos-team': 'WORKFORCE',
  'workforce:team-permissions': 'IDENTITY', 'workforce:tech-cash-handoff': 'PAYMENTS', 'workforce:tech-profile': 'WORKFORCE',
  'workforce:technician-clock-pin': 'WORKFORCE', 'workforce:technicians': 'WORKFORCE', 'workforce:time-clock': 'WORKFORCE', 'workforce:turn-queue': 'WORKFORCE', 'workforce:time-off': 'WORKFORCE', 'workforce:workforce-status': 'WORKFORCE', 'workforce:eligibility': 'WORKFORCE',
  // modules/super-admin — the platform's own screens, by the business domain they govern
  'super-admin:onboarding': 'SUPPORT', 'super-admin:super-admin-ai': 'AI', 'super-admin:super-admin-ai-checkout-upsell': 'AI',
  'super-admin:super-admin-ai-customer-profile': 'AI', 'super-admin:super-admin-ai-insights': 'AI', 'super-admin:super-admin-ai-ocr-receipt': 'AI',
  'super-admin:super-admin-ai-reports': 'AI', 'super-admin:super-admin-ai-review-reputation': 'AI', 'super-admin:super-admin-ai-scheduling-optimizer': 'AI',
  'super-admin:super-admin-ai-usage': 'AI', 'super-admin:super-admin-alerts': 'SUPPORT', 'super-admin:super-admin-analytics': 'ANALYTICS',
  'super-admin:super-admin-appointment-oversight': 'BOOKING', 'super-admin:super-admin-audit-logs': 'AUDIT', 'super-admin:super-admin-billing': 'FINANCE',
  'super-admin:super-admin-booking-checkin': 'BOOKING', 'super-admin:super-admin-business-categories': 'CATALOG', 'super-admin:super-admin-catalog': 'CATALOG',
  'super-admin:super-admin-checkin': 'BOOKING', 'super-admin:super-admin-compensation': 'FINANCE', 'super-admin:super-admin-customer-data': 'CUSTOMERS',
  'super-admin:super-admin-dashboard': 'ANALYTICS', 'super-admin:super-admin-database': 'OPERATIONS', 'super-admin:super-admin-device-management': 'OPERATIONS',
  'super-admin:super-admin-disputes': 'PAYMENTS', 'super-admin:super-admin-forecasting': 'ANALYTICS', 'super-admin:super-admin-gift-card-programs': 'PAYMENTS',
  'super-admin:super-admin-gift-card-settlement': 'PAYMENTS', 'super-admin:super-admin-hardware-packages': 'OPERATIONS', 'super-admin:super-admin-health': 'OPERATIONS',
  'super-admin:super-admin-integrations': 'OPERATIONS', 'super-admin:super-admin-kill-switches': 'PLATFORM', 'super-admin:super-admin-legal': 'PLATFORM',
  'super-admin:super-admin-loyalty': 'LOYALTY', 'super-admin:super-admin-maintenance': 'SUPPORT', 'super-admin:super-admin-membership-programs': 'MEMBERSHIPS',
  'super-admin:super-admin-memberships': 'MEMBERSHIPS', 'super-admin:super-admin-merchant-accounts': 'PAYMENTS', 'super-admin:super-admin-overview': 'ANALYTICS',
  'super-admin:super-admin-overview-aggregate': 'ANALYTICS', 'super-admin:super-admin-owners': 'TENANTS', 'super-admin:super-admin-platform': BY_PATH,
  'super-admin:super-admin-platform-search': 'PLATFORM', 'super-admin:super-admin-platform-staff': 'IDENTITY', 'super-admin:super-admin-product-catalog': 'INVENTORY',
  'super-admin:super-admin-promotions': 'DEALS', 'super-admin:super-admin-queue': 'BOOKING', 'super-admin:super-admin-reconciliation': 'PAYMENTS',
  'super-admin:super-admin-report-builder': 'ANALYTICS', 'super-admin:super-admin-revenue-residuals': 'FINANCE', 'super-admin:super-admin-scheduled-reports': 'ANALYTICS',
  'super-admin:super-admin-security': 'SECURITY', 'super-admin:super-admin-settings': 'PLATFORM', 'super-admin:super-admin-settlements': 'PAYMENTS',
  'super-admin:super-admin-smart-reminders': 'COMMUNICATIONS', 'super-admin:super-admin-staff': 'WORKFORCE', 'super-admin:super-admin-support': 'SUPPORT',
  'super-admin:super-admin-tenant-activity': 'TENANTS', 'super-admin:super-admin-tenant-presets': 'TENANTS', 'super-admin:super-admin-tenant-warnings': 'SUPPORT',
  'super-admin:super-admin-tenants': 'TENANTS', 'super-admin:super-admin-ticket-removal': 'CHECKOUT', 'super-admin:super-admin-tickets': 'CHECKOUT',
  'super-admin:super-admin-voice': 'AI', 'super-admin:super-admin-website-leads': 'MARKETING', 'super-admin:tenant-ai': 'AI', 'super-admin:tenant-billing': 'FINANCE',
};

/** Path keyword rules — for BY_PATH directories and any directory not in SOURCE_DOMAINS. Over the path minus its realm prefix. */
export const PATH_RULES = [
  ['SUPPORT', /^\/website\/applications(\/|$)/],                    // the public Free-Package application form
  ['SECURITY', /^\/(security|access-requests|privacy-requests|sessions|roles|step-up)(\/|$)/],
  ['AUDIT', /^\/audit(-logs)?(\/|$)/],
  ['IDENTITY', /^\/(users|users-dashboard|invitations|tenant-users-branches|support-sessions|me|profile|access)(\/|$)/],   // access: the salon's own staff invitations (wave 4 pilot)
  ['SUPPORT', /^\/(applications|onboarding|help|alerts|support)(\/|$)/],
  ['MARKETING', /^\/(leads|website|campaigns|automations|social)(\/|$)/],
  ['ANALYTICS', /^\/(reports|report-exports|scheduled-reports|tenant-performance|top-performing-tenants|branches-dashboard|dashboard|kpis?|overview|state|search)(\/|$)/],
  ['PAYMENTS', /^\/(payments|payments-transactions|payment-gateways|hardware|gift-cards?|refunds?|cash)(\/|$)/],
  ['FINANCE', /^\/(ai-packages|usage-limits|billing|plans|earnings|payroll|commission|tips)(\/|$)/],   // tips: the Technician App's own tips (Oct 12 2026 merge)
  ['CATALOG', /^\/(services|service-categories|tenant-service-categories|categories)(\/|$)/],
  ['INVENTORY', /^\/(products|product-categories|tenant-product-categories|brands|suppliers|inventory)(\/|$)/],
  ['BOOKING', /^\/(appointments|booking|queue|check-in|schedule)(\/|$)/],
  ['CUSTOMERS', /^\/(customers|customer-duplicates)(\/|$)/],
  ['COMMUNICATIONS', /^\/(reminders|messages|notifications|sms)(\/|$)/],
  ['OPERATIONS', /^\/(operations|integrations|devices|run-due|app-flags|jobs|stream|presence|health|feature-flags|platform-flags)(\/|$)/],
  ['TENANTS', /^\/(branches|tenants?|settings|:id|\{id\})(\/|$)|^\/?$/],
  ['WORKFORCE', /^\/(technicians?|tickets|staff|clock|skills|working-hours|time-clock|status|manager-messages|more|service-history|performance|certifications|technician-certifications)(\/|$)/],   // performance / certifications: Oct 12 2026 merge
  ['PLATFORM', /^\/features(\/|$)/],
];
/** Whole-path rules, before the realm prefix is removed (a realm's own root, internal job triggers). */
export const FULL_PATH_RULES = [
  ['WORKFORCE', /^\/tech\/?$/],                 // the technician app's home state
  ['OPERATIONS', /^\/internal\//],              // service-token job triggers
];
const REALM_PREFIX = /^\/(super-admin\/platform|super-admin|pos|owner|tenant|tech|customer|mobile-checkout|auth|public|api\/v1|api)(?=\/|$)/;

export function sourceKey(file) {
  const parts = String(file || '').split('/');
  if (parts[0] === 'modules' && parts[2] === 'src') return `${parts[1]}:${parts[3]}`;
  return `api:${parts[0].replace(/\.ts$/, '')}`;
}
const strArgs = (args) => [...String(args || '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);

/** The domain of one collected route (scripts/audit-routes.js shape), lower-case for the manifest; null = unplaced. */
export function domainOfRoute(r) {
  const deco = [...(r.decorators || []), ...(r.classDecorators || [])].find((d) => d.name === 'Domain');
  if (deco) { const d = String(strArgs(deco.args)[0] || '').toUpperCase(); return DOMAINS.includes(d) ? d.toLowerCase() : null; }
  const key = sourceKey(r.file);
  const src = SOURCE_DOMAINS[key];
  if (src) return src.toLowerCase();
  for (const [d, re] of FULL_PATH_RULES) if (re.test(String(r.path || ''))) return d.toLowerCase();
  const rest = String(r.path || '').replace(REALM_PREFIX, '') || '/';
  for (const [d, re] of PATH_RULES) if (re.test(rest)) return d.toLowerCase();
  return null;
}
