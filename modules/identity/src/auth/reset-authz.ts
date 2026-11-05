// reset-authz.ts — pure, tested. Who-can-reset-whom, delivery selection, role routing, rate configs (§10-15).
export type AnyRole = "OWNER" | "MANAGER" | "FRONT_DESK" | "RECEPTION" | "TECHNICIAN" | "CUSTOMER" | "SUPER_ADMIN";

// roles that may use the TENANT self-serve forgot flow (salon code + phone/email). Super Admin excluded.
export const TENANT_SELF_SERVE_ROLES: AnyRole[] = ["OWNER", "MANAGER", "FRONT_DESK", "RECEPTION", "TECHNICIAN", "CUSTOMER"];
export function isTenantSelfServeRole(role: string): boolean { return (TENANT_SELF_SERVE_ROLES as string[]).indexOf(role) >= 0; }
export function isSuperAdminRole(role: string): boolean { return role === "SUPER_ADMIN"; }

// delivery method selection (§9): auto prefers email for security unless the tenant prefers SMS.
export type Delivery = "sms" | "email";
export function chooseDelivery(method: "sms" | "email" | "auto" | undefined, hasPhone: boolean, hasEmail: boolean, tenantPrefersSms = false): Delivery | null {
  if (method === "sms") return hasPhone ? "sms" : null;
  if (method === "email") return hasEmail ? "email" : null;
  if (tenantPrefersSms && hasPhone) return "sms";
  if (hasEmail) return "email";
  if (hasPhone) return "sms";
  return null;
}

// ADMIN-INITIATED reset permission matrix (§11-13). actorPerms = the actor's permission keys.
export function canResetTargetRole(actorRole: AnyRole, actorPerms: string[], targetRole: AnyRole): boolean {
  if (targetRole === "SUPER_ADMIN") return false;                 // never reset a super admin via these flows
  if (actorRole === "SUPER_ADMIN") return actorPerms.indexOf("super_admin.users.reset_password") >= 0;
  if (targetRole === "OWNER") return actorRole === "OWNER" && actorPerms.indexOf("users.reset_owner_password") >= 0; // owner→owner only w/ perm
  if (actorRole === "OWNER") {
    if (targetRole === "MANAGER") return actorPerms.indexOf("users.reset_manager_password") >= 0 || actorPerms.indexOf("users.reset_password") >= 0;
    if (targetRole === "CUSTOMER") return actorPerms.indexOf("users.reset_customer_password") >= 0 || actorPerms.indexOf("users.reset_password") >= 0;
    return actorPerms.indexOf("users.reset_staff_password") >= 0 || actorPerms.indexOf("users.reset_password") >= 0; // FRONT_DESK/RECEPTION/TECHNICIAN
  }
  if (actorRole === "MANAGER") {
    if (targetRole === "MANAGER") return false; // (OWNER/SUPER_ADMIN already returned above)
    if (targetRole === "CUSTOMER") return actorPerms.indexOf("users.reset_customer_password") >= 0;
    return actorPerms.indexOf("users.reset_staff_password") >= 0; // staff only, if enabled
  }
  return false; // FRONT_DESK / RECEPTION / TECHNICIAN / CUSTOMER cannot reset others
}

// same-tenant requirement for tenant-initiated admin resets.
export function okSameTenantReset(actorTenantId: string, targetTenantId: string): boolean { return actorTenantId === targetTenantId; }

// post-reset landing + the change-password route per role (§8).
export function landingRoute(role: AnyRole): string {
  if (role === "SUPER_ADMIN") return "/super-admin/dashboard";
  if (role === "TECHNICIAN") return "/tech/dashboard";
  if (role === "CUSTOMER") return "/customer/home";
  return "/pos/dashboard";
}
export function changePasswordRoute(role: AnyRole): string {
  if (role === "SUPER_ADMIN") return "/super-admin/change-password";
  if (role === "TECHNICIAN") return "/tech/change-password";
  if (role === "CUSTOMER") return "/customer/change-password";
  return "/pos/change-password";
}

// rate-limit configs (§14). Super Admin is stricter.
export interface RateCounts { ipLast15: number; identifierLast15: number; tenantLastHour: number; }
export const RATE_TENANT = { ip15: 5, identifier15: 3, tenantHour: 30 };
export const RATE_SUPER_ADMIN = { ip15: 3, identifier15: 2, tenantHour: 0 };
export function isRateLimited(c: RateCounts, superAdmin = false): boolean {
  const r = superAdmin ? RATE_SUPER_ADMIN : RATE_TENANT;
  if (c.ipLast15 >= r.ip15) return true;
  if (c.identifierLast15 >= r.identifier15) return true;
  if (!superAdmin && r.tenantHour && c.tenantLastHour >= r.tenantHour) return true;
  return false;
}

// default permission sets seeded per role (§13) — for reference/seed.
export const ROLE_DEFAULT_RESET_PERMS: Record<AnyRole, string[]> = {
  SUPER_ADMIN: ["super_admin.users.reset_password"],
  OWNER: ["users.reset_password", "users.reset_manager_password", "users.reset_staff_password", "users.reset_customer_password"],
  MANAGER: [], // grant users.reset_staff_password to enable
  FRONT_DESK: ["auth.reset_own_password"],
  RECEPTION: ["auth.reset_own_password"],
  TECHNICIAN: ["auth.reset_own_password"],
  CUSTOMER: ["auth.reset_own_password"],
};
