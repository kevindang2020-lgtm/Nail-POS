// role-templates.ts — Functional Decision 12: "role-based access with scopes and optional custom roles, rather than fully
// manual permissions for every employee." Default roles: Tenant Owner, Tenant Admin, General Manager, Branch Manager,
// Receptionist, Technician, Accountant, Inventory Manager, Marketing Manager, Support Staff. Custom roles (e.g.
// Assistant Manager, Front Desk Lead). Scopes: OWN, BRANCH, SELECTED_BRANCHES, TENANT.
//
// DESIGN — an EXTENSION of the existing model, not a second permission system:
//   • The seven base roles (OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN, …) stay the authorization primitive that
//     every guard, realm check and module already understands.
//   • A role TEMPLATE sits on one base role and selects a SUBSET of that base role's permissions. It can only narrow,
//     never widen: a template's permissions are always intersected with permissionsFor(baseRole) — so no template, and
//     no owner-made custom role, can ever grant what its base role cannot.
//   • The SCOPE says where the role applies; it maps onto the per-branch access that already exists
//     (user_branch_access): TENANT = every branch, SELECTED_BRANCHES = the branches assigned, BRANCH = one branch,
//     OWN = only the person's own records (the technician model).
import { permissionsFor, type Role } from './rbac';

export type AccessScope = 'OWN' | 'BRANCH' | 'SELECTED_BRANCHES' | 'TENANT';
export const ACCESS_SCOPES: readonly AccessScope[] = ['OWN', 'BRANCH', 'SELECTED_BRANCHES', 'TENANT'];

export interface RoleTemplate {
  key: string;
  name: string;
  baseRole: Role;
  scope: AccessScope;
  description: string;
  /** Which of the base role's permissions this role keeps. */
  select: (perm: string) => boolean;
}

const all = () => true;
const re = (pattern: RegExp) => (p: string) => pattern.test(p);
/** Everything a person needs to sign in and see the home screen. */
// Phase 9: the self-service keys (own profile, own notifications, the Help Center) belong to EVERY template — they keyed
// routes every staff member used before (rbac.ts STAFF_SELF_SERVICE).
const BASICS = /^(pos\.login|dashboard\.view|global_search\.use|self\.profile\.view|self\.profile\.edit|self\.notifications|self\.operations\.view|help\.view|help\.request)$/;   // Phase 12: + own async exports

export const DEFAULT_ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { key: 'TENANT_OWNER', name: 'Tenant Owner', baseRole: 'OWNER', scope: 'TENANT', description: 'Everything in the business, every branch.', select: all },
  { key: 'TENANT_ADMIN', name: 'Tenant Admin', baseRole: 'OWNER', scope: 'TENANT',
    description: 'Runs the business across branches, but cannot change the subscription or archive locations.',
    select: (p) => p !== 'subscription.manage' && p !== 'locations.archive' },
  { key: 'GENERAL_MANAGER', name: 'General Manager', baseRole: 'MANAGER', scope: 'TENANT', description: 'Manager rights across every branch.', select: all },
  { key: 'BRANCH_MANAGER', name: 'Branch Manager', baseRole: 'MANAGER', scope: 'BRANCH', description: 'Manager rights in one branch.', select: all },
  { key: 'RECEPTIONIST', name: 'Receptionist', baseRole: 'FRONT_DESK', scope: 'BRANCH', description: 'Front desk: check-in, booking, queue, checkout.', select: all },
  { key: 'TECHNICIAN', name: 'Technician', baseRole: 'TECHNICIAN', scope: 'OWN', description: 'Their own queue, services, schedule and earnings.', select: all },
  { key: 'ACCOUNTANT', name: 'Accountant', baseRole: 'MANAGER', scope: 'TENANT',
    description: 'Reports, payroll, reconciliation, payment history and expense records (read + export, §101) — no front-desk operations.',
    select: (p) => BASICS.test(p) || /^(reports\.|reconciliation\.|payroll\.|tech\.payroll\.view$|owner\.reports\.view$|owner\.expenses\.(view|export)$|checkout\.view$|mobile_checkout\.view_(history|reports)$|inventory\.reports\.view$)/.test(p) },
  { key: 'INVENTORY_MANAGER', name: 'Inventory Manager', baseRole: 'MANAGER', scope: 'SELECTED_BRANCHES',
    description: 'Products, stock, transfers, purchase orders and vendors.',
    select: (p) => BASICS.test(p) || /^(inventory\.|ai_inventory\.|services\.view$)/.test(p) },
  { key: 'MARKETING_MANAGER', name: 'Marketing Manager', baseRole: 'MANAGER', scope: 'TENANT',
    description: 'Campaigns, promotions and reviews, with customer lists to target them.',
    select: (p) => BASICS.test(p) || /^(marketing\.|customers\.view$|reports\.view$)/.test(p) },
  { key: 'SUPPORT_STAFF', name: 'Support Staff', baseRole: 'FRONT_DESK', scope: 'BRANCH',
    description: 'Can look things up for customers — check-in, bookings, queue — but change nothing.',
    select: (p) => BASICS.test(p) || /\.view$/.test(p) },
];

/** The permissions a template grants: its selection, never more than its base role holds. */
export function templatePermissions(t: Pick<RoleTemplate, 'baseRole' | 'select'>): string[] {
  return permissionsFor(t.baseRole).filter((p) => t.select(p));
}

export function findRoleTemplate(key: string): RoleTemplate | undefined {
  return DEFAULT_ROLE_TEMPLATES.find((t) => t.key === key);
}

/** Base roles a salon may build a custom role on. Platform and customer accounts are not staff roles. */
export const CUSTOM_ROLE_BASES: readonly Role[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];

export interface CustomRoleInput { name: string; baseRole: string; scope: string; permissions: string[] }
export type CustomRoleCheck =
  | { ok: true; role: { name: string; baseRole: Role; scope: AccessScope; permissions: string[] } }
  | { ok: false; error: string };

/**
 * Validates an owner-made custom role (e.g. "Assistant Manager", "Front Desk Lead"). The permission list must be a
 * subset of the base role's — a custom role can narrow a base role, never extend it. Only an OWNER may create a role
 * on the OWNER base (a manager must not mint owner-level roles).
 */
export function validateCustomRole(input: CustomRoleInput, creatorRole: string): CustomRoleCheck {
  const name = String(input?.name ?? '').trim();
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'Role name must be 2–60 characters.' };
  if (!CUSTOM_ROLE_BASES.includes(input.baseRole as Role)) return { ok: false, error: 'A custom role must be based on Owner, Manager, Front Desk, Reception or Technician.' };
  if (input.baseRole === 'OWNER' && creatorRole !== 'OWNER') return { ok: false, error: 'Only the owner can create a role with owner-level rights.' };
  if (!ACCESS_SCOPES.includes(input.scope as AccessScope)) return { ok: false, error: 'Scope must be OWN, BRANCH, SELECTED_BRANCHES or TENANT.' };
  const base = new Set<string>(permissionsFor(input.baseRole as Role));
  const asked = Array.from(new Set((input.permissions ?? []).map(String)));
  const beyond = asked.filter((p) => !base.has(p));
  if (beyond.length) return { ok: false, error: `These permissions are not part of the ${input.baseRole} role: ${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? '…' : ''}` };
  if (!asked.includes('pos.login') && input.baseRole !== 'TECHNICIAN') return { ok: false, error: 'A staff role needs pos.login, or nobody holding it can sign in.' };
  return { ok: true, role: { name, baseRole: input.baseRole as Role, scope: input.scope as AccessScope, permissions: asked.sort() } };
}

// ── BUILD_PLAN Phase 9: template scope READ AT RUNTIME (it was stored and displayed, never enforced — audit bug 2) ──────
/**
 * The scope a staff member works under when they hold NO template: the base role's own default template's scope
 * (OWNER → Tenant Owner, MANAGER → General Manager, FRONT_DESK / RECEPTION → Receptionist, TECHNICIAN → Technician).
 * Platform / customer / system principals get TENANT (no branch confinement from this rule).
 */
export function defaultScopeForRole(role: string): AccessScope {
  switch (role) {
    case 'FRONT_DESK': case 'RECEPTION': return 'BRANCH';
    case 'TECHNICIAN': return 'OWN';
    default: return 'TENANT';
  }
}

/**
 * The branches a staff member may ENTER (sign in to / select) — Kevin's open decision (1), carried as the default:
 *   • explicit grants (user_branch_access) always confine, whatever the scope (today's rule, kept: no loosening);
 *   • BRANCH / SELECTED_BRANCHES with no grants → the home branch (users.branch_id);
 *   • … and with no home branch either → any branch (legacy accounts; nobody is locked out);
 *   • TENANT (owner, general manager) and OWN (technicians, who follow their own tickets) → any branch.
 * Returns null for "every branch of the salon".
 */
export function enterableBranches(input: { scope: AccessScope | null | undefined; grants: readonly string[]; homeBranchId: string | null | undefined }): string[] | null {
  const grants = Array.from(new Set((input.grants ?? []).filter(Boolean)));
  if (grants.length) return grants.sort();
  if ((input.scope === 'BRANCH' || input.scope === 'SELECTED_BRANCHES') && input.homeBranchId) return [input.homeBranchId];
  return null;
}
