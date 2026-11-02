// security-core.ts — framework-agnostic, unit-tested core for steps 2 & 3.
// The NestJS guards/middleware and the Kysely scope helper are thin adapters over these pure functions,
// so the security LOGIC is testable without the framework.

import type { Role } from './rbac';   // ONE Role type (this file used to declare its own identical copy)
import type { TenantContext } from '@aipowersalon/tenant-context';
import { decide } from './decision';
export type { Role };

// Constitution 13 §72: the trusted context SHAPE is @aipowersalon/tenant-context's; this is it with our Role.
export type Ctx = TenantContext<Role> & {
  /** BUILD_PLAN Phase 9: what the request path learned about the principal's CURRENT authorization (set by the
   *  tenant-context middleware for staff sessions) — the decision object reads scope, branches and overrides from it. */
  authz?: AuthzContextState;
};
/** The per-request authorization facts (decision.ts consumes them; the middleware fills them). */
export interface AuthzContextState {
  scope: import('./role-templates').AccessScope | null;
  branchIds: string[] | null;
  templateKey: string | null;
  overrides: import('./decision').AuthzOverride[];
  /** the role / template GRANT before overrides (ctx.permissions is the effective set) */
  grant: string[];
  userVersion: number | null;
  tenantVersion: number | null;
  /** true when this request was re-authorized from the current grants because the session was stale */
  reauthorized: boolean;
}

// where the user lands after login (step: auth role redirect)
export function resolveLandingRoute(role: Role): string {
  switch (role) {
    case "TECHNICIAN": return "/tech/dashboard";
    case "CUSTOMER": return "/customer/home";
    case "SUPER_ADMIN": return "/super-admin/dashboard";
    default: return "/pos/dashboard"; // OWNER, MANAGER, FRONT_DESK, RECEPTION
  }
}

export function isTenantRole(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "FRONT_DESK" || role === "RECEPTION" || role === "TECHNICIAN";
}

// The per-feature guards/services enforce GRANULAR keys (`pos.<domain>.<action>`), but the RBAC catalog (rbac.ts) grants
// COARSE capabilities (`checkin.manage`, `checkout.process_payment`, …). requiredCapability() bridges the two so non-owner
// roles work: a granular key is satisfied if the principal holds the coarse capability it maps to.
const COARSE_DOMAIN: Record<string, string> = {
  check_in: "checkin", service_done: "serving", tech_queue: "queue", tech_appointments: "booking",
  overview: "dashboard", customer_display: "settings", receipts: "checkout", bundles: "services", memberships: "customers", devices: "settings", api_keys: "settings", webhooks: "settings", deployments: "settings", logs: "settings",
  // AI Customer Profile Assistant is a read-only intelligence view over the authoritative Customers module, so its
  // granular pos.ai_customer_profile.* keys reuse the real `customers` capabilities (view -> customers.view;
  // any future mutation -> customers.edit). This avoids minting a capability no role grants (which would 403 everyone).
  ai_customer_profile: "customers",
  // AI Checkout Upsell is an advisory layer over Checkout; the .view key gates "may use the assistant" (-> checkout.view).
  // Per-ACTION authority for each mutation (add-on -> checkout.reopen_service, membership -> memberships.enroll, loyalty
  // redeem -> loyalty.redeem, promotion -> checkout.apply_discount, booking -> booking.create) is enforced in the service
  // via need(), so a single domain mapping here is intentional and correct.
  ai_checkout_upsell: "checkout",
  // AI Review & Reputation is an intelligence/response layer over the existing reviews + marketing surface; its granular
  // pos.ai_review_reputation.* keys reuse the real `marketing` capabilities (view -> marketing.view; manage ->
  // marketing.manage). Per-action authority (publish, escalate, recovery) is enforced in the services via need().
  ai_review_reputation: "marketing",
  // AI Receipt & Document Recognition posts into the existing expenses + inventory-receiving surface; its granular
  // pos.ai_ocr_receipt.* keys reuse the real `inventory` capabilities (view -> inventory.view; manage -> inventory.manage).
  // Per-action authority (approve, post, receive) is enforced in the services via need() (reusing inventory.purchase_order.receive).
  ai_ocr_receipt: "inventory",
  // (BUILD_PLAN Phase 7: the AI Scheduling Optimizer's routes use their own ai_scheduling.* keys — the old mapping of
  // pos.ai_scheduling_optimizer.* onto booking.* let a TECHNICIAN, who holds booking.manage, generate / accept / apply.)
  // 23-inch dual-screen spec §75: Customer Display Advertising is a Marketing & Growth surface — pos.customer_display_ads.view
  // -> marketing.view, every write (create/update/publish/pause/archive) -> marketing.manage (owners and managers). A
  // branch manager's reach (their own branch only, §63) is enforced in the marketing module's service.
  customer_display_ads: "marketing",
};
const VIEW_ACTIONS = new Set(["view", "export", "notes_view"]);
const MANAGE_CAP: Record<string, string> = {
  checkout: "checkout.process_payment", customers: "customers.edit", technicians: "technicians.edit",
  services: "services.edit", reports: "reports.export", settings: "settings.edit", ai: "ai.manage",
};
const VIEW_CAP: Record<string, string> = { ai: "ai.use" }; // ai has no `.view`, it uses `.use`
/**
 * Secure Tap to Pay mandate §44 (M6-6, Oct 23 2026): the mandate's suggested permission names, "adapted to the current
 * registry" — each is an ALIAS of the catalog key that already governs that action (never a second permission system;
 * nobody is granted these names, a check for one is a check for its catalog key). Documented in docs/PERMISSIONS.md as
 * deprecatedAliases of the target key.
 *  • payments.tap_to_pay            → mobile_checkout.tap_to_pay   (take card payments on an approved phone)
 *  • payments.refund / payments.void → checkout.manage_overrides    (what pos.checkout.refund / pos.checkout.void resolve to;
 *                                                                     the routes also require a fresh step-up)
 *  • payment_devices.register       → mobile_checkout.tap_to_pay   (a phone is registered by someone who may take payments)
 *  • payment_devices.approve / revoke / manage → settings.edit     (what pos.devices.manage resolves to; step-up on each)
 *  • payment_branch.switch          → mobile_checkout.tap_to_pay   (switching the location a phone takes payments in;
 *                                                                     the switch itself also needs user ∩ device branches + step-up)
 */
export const PAYMENT_PERMISSION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'payments.tap_to_pay': 'mobile_checkout.tap_to_pay',
  'payments.refund': 'checkout.manage_overrides',
  'payments.void': 'checkout.manage_overrides',
  'payment_devices.register': 'mobile_checkout.tap_to_pay',
  'payment_devices.approve': 'settings.edit',
  'payment_devices.revoke': 'settings.edit',
  'payment_devices.manage': 'settings.edit',
  'payment_branch.switch': 'mobile_checkout.tap_to_pay',
});

export function requiredCapability(key: string): string {
  const paymentAlias = PAYMENT_PERMISSION_ALIASES[key];
  if (paymentAlias) return paymentAlias;                 // §44: a mandate permission name → its catalog key
  if (!key.startsWith("pos.")) return key;               // already a coarse key (e.g. "settings.view")
  const rest = key.slice(4); const dot = rest.indexOf("."); if (dot < 0) return key;
  const rawDomain = rest.slice(0, dot); const action = rest.slice(dot + 1);
  const domain = COARSE_DOMAIN[rawDomain] ?? rawDomain;
  // B-19 (Oct 22 2026): selling past the counted stock is a manager override like a void or a discount — never the
  // front desk's plain checkout capability (the fall-through below would have handed it to FRONT_DESK / RECEPTION)
  if (rawDomain === "checkout" && ["void", "override_total", "apply_discount", "refund", "reopen_service", "override_inventory"].includes(action)) {
    return "checkout.manage_overrides";
  }
  // 23-inch dual-screen spec §82: OPERATING the customer display during checkout — Send to Display, Refresh, Cancel the
  // display session, Switch display, see its status — is front-desk work: it rides the checkout capability the front
  // desk holds. (Every display action used pos.customer_display.manage → settings.edit, which FRONT_DESK and RECEPTION
  // do not hold: the people who run checkout got 403 on "To Display".) Pairing, renaming, register assignment,
  // maintenance and revoking stay pos.customer_display.manage → settings.edit (the owner, spec §86 "Owner/Admin").
  if (rawDomain === "customer_display" && action === "operate") return "checkout.process_payment";
  // BUILD_PLAN Phase 5, bug 2: putting a deal or a coupon on a ticket is front-desk work. The routes asked for
  // pos.checkout.apply_discount (→ checkout.manage_overrides, owners and managers only), so a receptionist got 403 and the
  // POS swallowed it: the customer paid full price. Deals and coupons have their own capability; a MANUAL discount
  // (pos.checkout.apply_discount) stays a manager decision.
  if (rawDomain === "deals" && action === "apply") return "deals.apply";
  // Smooth Refresh spec §11: intentionally double-booking a technician is an authorized-role decision (OWNER +
  // MANAGER hold booking.override), not part of everyday booking.manage that reception and technicians hold.
  if (rawDomain === "booking" && action === "override_conflict") return "booking.override";
  // BUILD_PLAN Phase 4: completing a booking WITHOUT the customer's phone code (and seeing the verifications waiting for
  // one) is the same manager-tier decision. It collapsed to booking.manage, which RECEPTION holds — the receptionist is
  // exactly who a social engineer calls; only the service's role check stood in the way.
  if (rawDomain === "booking" && (action === "override_verification" || action === "verification_pending")) return "booking.override";
  // BUILD_PLAN Phase 3: the MANAGER-level phone powers — approve a receptionist's change, resolve a duplicate, confirm a
  // number without SMS, configure the policy, retry a failed sync. They used to collapse to customers.edit, which
  // reception holds (audit); only the service's role check stood in the way.
  if (rawDomain === "customers" && ["phone.manual_confirm", "phone.approve", "phone.resolve", "phone.settings", "phone.retry_sync"].includes(action)) return "customers.phone_manage";
  if (VIEW_ACTIONS.has(action)) {
    if (rawDomain === "reports" && action === "export") return "reports.export";
    // Constitution 12 §323 ("never allow unrestricted customer export"): exporting the customer list is not "viewing"
    // it. It collapsed to customers.view, which every staff role holds — a departing technician could download every
    // client's name and phone number. Owners and managers hold customers.export; nobody else.
    if (rawDomain === "customers" && action === "export") return "customers.export";
    return VIEW_CAP[domain] ?? domain + ".view";
  }
  return MANAGE_CAP[domain] ?? domain + ".manage";
}

// permission check — the principal must hold the key, or (for a granular pos.* key) the coarse capability it maps to.
// No OWNER shortcut is needed: a real OWNER's token carries every coarse capability, which satisfies all granular
// checks via requiredCapability(). SUPER_ADMIN holds only super_admin.* permissions (minted at login from rbac) and
// NEVER tenant permissions — so it passes exactly the `super_admin.*` keys embedded in its session and hard-fails
// every tenant-side key. (Seven-package merge: the general-settings and communications arcs gate handlers with
// @RequirePermission('super_admin.…') behind SuperAdminGuard; the previous unconditional `false` 403'd those live.)
export function hasPermission(ctx: Ctx, key: string): boolean {
  // BUILD_PLAN Phase 9: the boolean FAÇADE over decide() (decision.ts) — one rule for both. The request context's
  // permission list is already the EFFECTIVE set (grant + live ALLOW − live DENY overrides, folded in by the tenant-context
  // middleware), so the façade asks with that list; the guard asks decide() directly for the reason code.
  if (!ctx) return false;
  return decide({ userId: ctx.userId, tenantId: ctx.tenantId || null, branchId: ctx.branchId || null, role: ctx.role, permissions: ctx.permissions || [] }, key).allowed;
}

// tenant isolation: a fetched resource must belong to the caller's tenant (and branch unless tenant-wide).
export function okSameTenant(resourceTenantId: string, ctx: Ctx): boolean {
  return resourceTenantId === ctx.tenantId;
}
export function okSameBranch(resourceBranchId: string | null, ctx: Ctx): boolean {
  return resourceBranchId === null || resourceBranchId === ctx.branchId; // null = tenant-wide row
}

// the canonical scope filter for every tenant query (step 3).
// includeNullBranch=true for settings/tenant-wide tables: branch_id = ctx OR branch_id IS NULL.
export interface ScopeFilter { tenantId: string; branchId: string; includeNullBranch: boolean; }
export function tenantScopeFilter(ctx: Ctx, includeNullBranch = false): ScopeFilter {
  return { tenantId: ctx.tenantId, branchId: ctx.branchId, includeNullBranch: includeNullBranch };
}

// NEVER trust tenant/branch from the client body or query — strip them before use.
export function stripClientTenantKeys<T extends Record<string, unknown>>(input: T): T {
  const banned = ["tenantId", "branchId", "tenant_id", "branch_id"];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) { if (banned.indexOf(k) < 0) out[k] = input[k]; }
  return out as T;
}

// route access matrix (which role family may touch which route prefix)
//
// Constitution 12 §6/§27. This function existed but NOTHING CALLED IT — a dead control. It is now enforced by
// RealmGuard (global), with three corrections that made it unsafe to switch on as first written:
//   1. prefixes match WHOLE PATH SEGMENTS — `indexOf("/customer") === 0` also matched `/customer-display/…` (the POS's
//      paired screen) and `/pos` matched `/posts`;
//   2. it states the §6 boundary exactly — CUSTOMER ≠ EMPLOYEE — and does not re-decide which STAFF role may use which
//      staff screen (the old `/pos → isTenantRole` would have locked technicians out of POS routes they use today;
//      per-role staff access is RolePermissionGuard's job);
//   3. `/owner`, `/tenant` and `/tech` are staff realms too.
// SUPER_ADMIN is unchanged here: its own guard confines it to /super-admin and Support Mode.
const STAFF_REALMS = ['pos', 'owner', 'tenant', 'tech'];
export function routeFirstSegment(path: string): string {
  return String(path || '').replace(/^\/+/, '').replace(/^api\/v\d+\//, '').split(/[/?#]/)[0].toLowerCase();
}
export function canAccessRoutePrefix(role: Role, prefix: string): boolean {
  const seg = routeFirstSegment(prefix);
  if (seg === 'super-admin') return role === 'SUPER_ADMIN';
  if (seg === 'customer') return role === 'CUSTOMER';
  if (STAFF_REALMS.includes(seg)) return role !== 'CUSTOMER';
  return true; // /public, /auth, /me, /push … — declared per route (check:authz)
}
