// permission-registry.ts — BUILD_PLAN Phase 9 (Constitution 2 "one typed catalog" + "metadata registry"): every catalog
// key (rbac.ts PERMISSIONS) with the metadata a salon owner's role editor, the docs generator, the high-risk report and
// the step-up policy need — domain, action, label, description, sensitivity, scopes, step-up, realm — and the legacy
// `pos.<domain>.<action>` route keys folded in as deprecatedAliases of the catalog key requiredCapability() maps them to.
//
// DESIGN
//   • The catalog stays rbac.ts (Agent C owns it). The registry DERIVES a definition for every key — domain / action /
//     label / realm / scopes from the key's shape, sensitivity from rules — so a new key is never missing here.
//   • Rules are not enough for the dangerous ones. Every TENANT-side key the rules call high or critical (money, refunds,
//     exports, roles, overrides, branch access, ownership, payouts, payment / SMS settings, deletes) MUST carry an
//     EXPLICIT entry below — a human-written description, sensitivity, scopes and step-up — or permission-registry.test
//     fails. That is the review gate: adding `x.export` to the catalog forces somebody to say what it exposes.
//   • Platform (super_admin.*) keys take derived metadata; their step-up is enforced by the platform's own policy.
//   • docs/PERMISSIONS.md is generated from this (tooling/permissions/generate-permission-docs.mjs).
import { PERMISSIONS, ROLE_PERMISSIONS, type Role } from './rbac';
import { requiredCapability, PAYMENT_PERMISSION_ALIASES } from './security-core';
import { POS_ROUTE_KEY_ALIASES } from './permission-aliases.generated';

export type PermissionSensitivity = 'low' | 'medium' | 'high' | 'critical';
/** Security Deep Scan §68: ASSIGNED = records assigned to the principal; PLATFORM = the platform role plane (super_admin.* keys). */
export type PermissionScope = 'OWN' | 'ASSIGNED' | 'BRANCH' | 'SELECTED_BRANCHES' | 'TENANT' | 'PLATFORM';
export type PermissionRealm = 'tenant' | 'platform' | 'technician' | 'owner';

/** One catalog key with its metadata. Structurally identical to @aipowersalon/api-contracts' PermissionDefinition. */
export interface PermissionDefinition {
  key: string; domain: string; action: string; label: string; description: string;
  sensitivity: PermissionSensitivity; scopes: PermissionScope[]; stepUp: boolean; realm: PermissionRealm;
  deprecatedAliases: string[];
}

interface Explicit { description: string; sensitivity: PermissionSensitivity; scopes: PermissionScope[]; stepUp: boolean; label?: string }
const ALL_BRANCH: PermissionScope[] = ['BRANCH', 'SELECTED_BRANCHES', 'TENANT'];
const TENANT_ONLY: PermissionScope[] = ['TENANT'];
const OWN: PermissionScope[] = ['OWN'];
const e = (sensitivity: PermissionSensitivity, stepUp: boolean, scopes: PermissionScope[], description: string, label?: string): Explicit =>
  ({ sensitivity, stepUp, scopes, description, ...(label ? { label } : {}) });

/**
 * The reviewed keys. Every tenant key the rules rate high / critical is here (the test enforces it); a few lower ones
 * are here because their one-line description matters to an owner deciding who gets them.
 */
export const EXPLICIT_PERMISSION_METADATA: Readonly<Record<string, Explicit>> = {
  // ── money: payments, refunds, overrides, payouts ─────────────────────────────────────────────────────────────────
  'checkout.process_payment': e('high', false, ALL_BRANCH, 'Take payments at checkout (card, cash, gift card, split) and close tickets.'),
  'checkout.approve_refund': e('critical', true, ALL_BRANCH, 'Refund past the salon\'s approval threshold (cash or large refunds) and approve a refund someone else asked for.'),
  'checkout.manage_overrides': e('high', false, ALL_BRANCH, 'Void tickets, override totals, apply manual discounts, refund and reopen finished services.'),
  'booking.override': e('high', false, ALL_BRANCH, 'Double-book a technician on purpose and complete a booking without the customer\'s phone code.'),
  'mobile_checkout.tap_to_pay': e('high', false, ALL_BRANCH, 'Take card payments on an approved phone with Tap to Pay.'),
  'mobile_checkout.split_payment': e('high', false, ALL_BRANCH, 'Split one ticket across several payments on the mobile checkout.'),
  'mobile_checkout.refund_request': e('high', false, ALL_BRANCH, 'Ask for a refund from the mobile checkout (it still needs the refund approval rules).'),
  'mobile_checkout.void_request': e('high', false, ALL_BRANCH, 'Ask for a void from the mobile checkout.'),
  'reconciliation.manage': e('high', false, ALL_BRANCH, 'Match deposits to sales, record adjustments and resolve differences in deposit reconciliation.'),
  'reconciliation.approve': e('critical', true, TENANT_ONLY, 'Approve and close a deposit reconciliation — the books for that period are final.'),
  'payroll.view': e('high', false, ALL_BRANCH, 'See every technician\'s pay, commission and tips for a pay period.'),
  'payroll.manage': e('critical', true, TENANT_ONLY, 'Run payroll, edit pay rules and finalize pay periods (money paid to staff).'),
  'payroll.approve': e('critical', true, TENANT_ONLY, 'Approve and lock a pay period (and reopen an approved one with a reason) — the figures every technician is paid.'),
  'payroll.export': e('high', false, TENANT_ONLY, 'Download a pay period as CSV / Excel for the accountant or a payroll provider (every export is audited).'),
  'payroll.adjust': e('high', false, ALL_BRANCH, 'Add bonuses, corrections and configured deductions to an open pay period (large ones wait for an owner\'s approval).'),
  'payroll.issue_check': e('critical', true, TENANT_ONLY, 'Issue, deliver, void and replace payroll checks for an approved pay week (check numbers are recorded).'),
  'cash_handoff.reopen': e('high', false, ALL_BRANCH, 'Reopen a closed end-of-day cash count with a reason (the earlier figures stay in its history and it must be counted again).'),
  'payroll.cash_handoff': e('critical', true, TENANT_ONLY, 'Prepare payroll cash (from the register drawer, the safe or the bank), hand it to a technician and take their PIN confirmation.'),
  'payouts.manage': e('critical', true, TENANT_ONLY, 'Record what was actually paid to technicians for an approved pay period (cash, check, direct deposit).'),
  'owner.finance.view': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'See revenue, deposits, fees and profit in the Owner App.'),
  'owner.staff.earnings.view': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'See every staff member\'s earnings in the Owner App.'),
  'owner.expenses.manage': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'Record receipts and expenses and edit drafts — the salon\'s spending records.'),
  'owner.expenses.delete_draft': e('medium', false, ['SELECTED_BRANCHES', 'TENANT'], 'Delete an expense that is still a draft (anything submitted or approved can only be voided or archived).'),
  'owner.expenses.archive': e('medium', false, ['SELECTED_BRANCHES', 'TENANT'], 'Archive an expense out of the working lists, and restore it.'),
  'owner.expenses.bills.manage': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'Record payments against a vendor bill (partial or full) and match them to bank / card payments.'),
  'owner.expenses.approve': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'Approve or reject receipts and expenses, void an approved one with a reason, decide suspected duplicates, correct an approved expense (audited).'),
  'owner.expenses.export': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'Download expense records as CSV / Excel for the accountant or tax preparer (every export is audited).'),
  'owner.expenses.categories.manage': e('medium', false, TENANT_ONLY, 'Add custom expense categories, map categories to accounting codes, set categorization rules and expense settings.'),
  'owner.expenses.reimbursements.manage': e('high', false, TENANT_ONLY, 'Approve and mark paid the reimbursements owed to staff who paid for salon supplies themselves.'),
  'tech.earnings.view': e('medium', false, OWN, 'A technician sees their own earnings, tips and commission.'),
  'tech.turn_queue.view': e('low', false, OWN, 'A technician sees her own turn position, status and today\'s turns — the rest of the team only as far as the salon\'s visibility setting allows, never anyone\'s money.'),
  'tech.time_off.request': e('low', false, OWN, 'A technician requests time off for herself and withdraws her own pending request (a manager decides it).'),
  'compensation.view_all': e('high', false, TENANT_ONLY, 'See every technician\'s compensation plan, wage settings and earnings statements.'),
  'compensation.manage': e('critical', true, TENANT_ONLY, 'Change commission plans, wage configuration and technician pay agreements.'),
  'technicians.view_pay': e('high', false, ALL_BRANCH, 'See a technician\'s commission rate, commission history and payroll summary (owners and managers; never the front desk).'),
  // Fair Turn Engine (wave 2, mandate §139–144)
  'turn_queue.read': e('low', false, ALL_BRANCH, 'See the technician turn board: who is next and why, who is serving, on break or on hold (never anyone\'s money).'),
  'turn_queue.join': e('low', false, ALL_BRANCH, 'Add a clocked-in technician to today\'s rotation (she joins where the salon\'s join rule places her).'),
  'turn_queue.assign': e('medium', false, ALL_BRANCH, 'Assign the recommended technician and record that a guest declined a technician (never costs her a turn).'),
  'turn_queue.hold': e('medium', false, ALL_BRANCH, 'Put a technician on queue hold and release her (a hold is not a payroll break).'),
  'turn_queue.reorder': e('medium', false, ALL_BRANCH, 'Move a technician in the rotation (set next, before someone, to the back) with a reason — changes the future order only, history is kept.'),
  'turn_queue.manual_assign': e('medium', false, ALL_BRANCH, 'Assign someone other than the recommended technician, with a manual-override reason (audited).'),
  'turn_queue.auto_assign': e('medium', false, ALL_BRANCH, 'Run automatic turn assignment for the location.'),
  'turn_queue.adjust': e('high', false, ALL_BRANCH, 'Correct a technician\'s turn credit (+/− turns) for a genuine operational error, and close a business day — reason required, audited.'),
  'turn_queue.settings.manage': e('high', false, TENANT_ONLY, 'Change the salon\'s turn rules: assignment mode, fairness mode, turn weights, requested / appointment / break / decline policies.'),
  'turn_queue.history.read': e('medium', false, ALL_BRANCH, 'Read the turn history, the fairness dashboard and the team turn reports.'),
  'tips.adjust': e('high', false, ALL_BRANCH, 'Re-split a ticket\'s tip between the technicians who worked it; after payment the change is a recorded tip adjustment.'),
  'ai_inventory.view_cost': e('medium', false, ALL_BRANCH, 'See product cost and margin inside the AI inventory analyses.'),
  'ai.control.manage': e('high', true, TENANT_ONLY, 'Change how much the salon\'s AI assistants may do on their own (recommend only, approval required, automation).'),
  'help.triage': e('medium', false, TENANT_ONLY, 'See every support ticket the salon filed, triage them and file a critical (outage) ticket.'),
  'tech.payroll.view': e('medium', false, OWN, 'A technician sees their own pay statements.'),
  'ai_money_protection.investigate': e('high', false, ALL_BRANCH, 'Open an investigation into a flagged money anomaly (refund, void or discount pattern).'),
  'ai_money_protection.resolve': e('high', false, ALL_BRANCH, 'Close a money-protection alert or investigation with a finding.'),
  'ai_money_protection.manage_rules': e('high', true, TENANT_ONLY, 'Change what the money-protection AI treats as suspicious.'),
  'ai_money_protection.manage_settings': e('high', true, TENANT_ONLY, 'Turn money-protection monitoring on or off and set its thresholds.'),
  'inventory.purchase_order.approve': e('high', false, ALL_BRANCH, 'Approve a purchase order — commits the salon to paying the vendor.'),
  'loyalty.bonus.approve': e('high', false, TENANT_ONLY, 'Approve bonus loyalty points a manager asked for — spends the salon\'s prepaid reward tokens. Salon owner only.'),
  'inventory.cost.view': e('medium', false, ALL_BRANCH, 'See what the salon pays for products (unit cost).'),
  'inventory.value.view': e('medium', false, ALL_BRANCH, 'See the money value of stock on hand.'),
  'inventory.stock.adjust': e('medium', false, ALL_BRANCH, 'Correct stock counts by hand (shrinkage, damage, recount).'),
  'subscription.manage': e('critical', true, TENANT_ONLY, 'Change the salon\'s AIPowerSalon plan, add-ons and billing.'),
  // ── exports (data leaving the system) ────────────────────────────────────────────────────────────────────────────
  'customers.export': e('high', true, ALL_BRANCH, 'Download the customer list (names, phone numbers, emails). Every export is recorded.'),
  'reports.export': e('high', false, ALL_BRANCH, 'Download sales, payment and staff reports. Every export is recorded.'),
  'owner.reports.export': e('high', false, ['SELECTED_BRANCHES', 'TENANT'], 'Download Owner App reports. Every export is recorded.'),
  'ai_money_protection.export': e('high', false, ALL_BRANCH, 'Download money-protection alerts and investigations.'),
  'ai_voice_transcription.export': e('high', true, ALL_BRANCH, 'Download call transcripts (customer conversations).'),
  'ai_queue_assignment.export': e('medium', false, ALL_BRANCH, 'Download queue-assignment decisions and metrics.'),
  'ai_scheduling.export': e('medium', false, ALL_BRANCH, 'Download scheduling recommendations and outcomes.'),
  // ── people & access: roles, overrides, branch access, ownership, reviews ─────────────────────────────────────────
  'roles.view': e('medium', false, TENANT_ONLY, 'See the team\'s roles, permissions, branch access and the authorization audit.'),
  'roles.manage': e('critical', true, TENANT_ONLY, 'Assign roles and build custom roles — never above your own permissions, never on yourself.'),
  'branch_access.manage': e('critical', true, TENANT_ONLY, 'Decide which branches each team member may sign in to.'),
  'permissions.override': e('critical', true, TENANT_ONLY, 'Give one person an extra permission (ALLOW, optionally temporary) or take one away (DENY).'),
  'ownership.transfer': e('critical', true, TENANT_ONLY, 'Transfer ownership of the salon to another team member.'),
  'access_review.view': e('medium', false, TENANT_ONLY, 'See access reviews and their decisions.'),
  'access_review.manage': e('critical', true, TENANT_ONLY, 'Run an access review: keep, change or revoke each person\'s access.'),
  'security_reports.view': e('high', false, TENANT_ONLY, 'See who holds high-risk permissions, dormant accounts and permission denials.'),
  'approvals.decide': e('high', false, ALL_BRANCH, 'Approve or reject requests (refunds over threshold, voids, discounts, purchase orders) within your limit.'),
  'approvals.manage_policies': e('critical', true, TENANT_ONLY, 'Change what needs approval, the thresholds and who may approve.'),
  'technicians.edit': e('high', false, ALL_BRANCH, 'Hire, edit and deactivate technicians, and change their commission and payment permissions.'),
  'audit.view': e('medium', false, TENANT_ONLY, 'Read the salon\'s audit log.'),
  // ── settings that move money or messages ─────────────────────────────────────────────────────────────────────────
  'settings.edit': e('critical', true, TENANT_ONLY, 'Change salon settings, including payment processors, devices, Twilio / SMS and receipt settings.'),
  'owner.settings.edit': e('high', true, TENANT_ONLY, 'Change Owner App settings and the Owner Access Code.'),
  'communications.manage': e('medium', false, ALL_BRANCH, 'Send messages to customers and manage message templates.'),
  'marketing.manage': e('medium', false, ALL_BRANCH, 'Create and send campaigns and promotions; manage display advertising.'),
  'ai.manage': e('high', true, TENANT_ONLY, 'Turn AI features on or off and change their settings.'),
  'reception_copilot.manage_settings': e('high', true, TENANT_ONLY, 'Change what the Reception Copilot may do on its own.'),
  'reception_copilot.approve_learning': e('high', false, TENANT_ONLY, 'Approve what the Reception Copilot learns from the salon\'s conversations.'),
  'ai_booking.manage_settings': e('high', true, TENANT_ONLY, 'Change how the AI booking assistant books, overrides and uses partner links.'),
  'ai_booking.manage_partner_links': e('medium', false, TENANT_ONLY, 'Manage the booking partner links the AI may use.'),
  'ai_booking.support_mode': e('high', false, TENANT_ONLY, 'Let platform support act inside the AI booking assistant for this salon.'),
  'ai_booking.override_duplicate': e('high', false, ALL_BRANCH, 'Let the AI book a customer who already has an overlapping booking.'),
  'ai_booking.override_conflict': e('high', false, ALL_BRANCH, 'Let the AI double-book a technician.'),
  'ai_queue_assignment.override': e('medium', false, ALL_BRANCH, 'Overrule the AI\'s queue suggestion and lock an assignment.'),
  'ai_queue_assignment.manage_rules': e('medium', false, ALL_BRANCH, 'Set the rotation, thresholds and rules for AI queue assignment.'),
  'ai_queue_assignment.manage_auto': e('high', true, TENANT_ONLY, 'Turn automatic AI queue assignment on or off.'),
  'ai_scheduling.approve': e('medium', false, ALL_BRANCH, 'Approve the AI\'s duration, staffing and availability insights.'),
  'ai_scheduling.apply': e('high', false, ALL_BRANCH, 'Apply an AI schedule change to real bookings.'),
  'ai_scheduling.configure': e('high', true, TENANT_ONLY, 'Change scheduling-AI settings, automation and the kill switch.'),
  'ai_voice_transcription.manage_settings': e('high', true, TENANT_ONLY, 'Turn call transcription on or off and set its retention.'),
  'ai_voice_transcription.manage_rules': e('medium', false, TENANT_ONLY, 'Change what the transcription AI flags in calls.'),
  'ai_voice_transcription.view_raw': e('critical', true, ALL_BRANCH, 'Read unredacted call transcripts (card digits, phone numbers as spoken).'),
  'ai_voice_transcription.play_recording': e('high', false, ALL_BRANCH, 'Listen to recorded customer calls.'),
  'ai_voice_transcription.delete': e('critical', true, TENANT_ONLY, 'Delete call recordings and transcripts permanently.'),
  'community.settings.manage': e('medium', false, TENANT_ONLY, 'Change the salon\'s Safety Community settings.'),
  'community.advisory.approve': e('medium', false, TENANT_ONLY, 'Approve a safety advisory for publication to other salons.'),
  // ── locations & catalogue deletes / archives ─────────────────────────────────────────────────────────────────────
  'locations.archive': e('high', true, TENANT_ONLY, 'Archive a salon location (it stops taking bookings).'),
  'locations.publish': e('medium', false, TENANT_ONLY, 'Publish a location to the customer app and marketplace.'),
  'locations.unpublish': e('medium', false, TENANT_ONLY, 'Hide a location from the customer app and marketplace.'),
  'inventory.archive': e('medium', false, ALL_BRANCH, 'Archive products (they stop appearing in stock and sales).'),
  'owner.tenant_branding.update': e('medium', false, TENANT_ONLY, 'Change the salon\'s own logo and colours.'),
  'customers.phone_manage': e('high', false, ALL_BRANCH, 'Approve, resolve and manually confirm customer phone-number changes and set the phone policy.'),
  'customers.edit': e('medium', false, ALL_BRANCH, 'Create and edit customer profiles.'),
  'pos.login': e('low', false, ALL_BRANCH, 'Sign in to the POS at all. Every staff role needs it.', 'Sign in to the POS'),
};

// ── derivation ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function realmOf(key: string): PermissionRealm {
  if (key.startsWith('super_admin.')) return 'platform';
  if (key.startsWith('tech.')) return 'technician';
  if (key.startsWith('owner.')) return 'owner';
  return 'tenant';
}

/** domain = everything before the last segment; action = the last segment (super_admin.billing.invoices.create → billing.invoices / create). */
export function splitKey(key: string): { domain: string; action: string } {
  const k = key.startsWith('super_admin.') ? key.slice('super_admin.'.length) : key;
  const i = k.lastIndexOf('.');
  return i < 0 ? { domain: k, action: '' } : { domain: k.slice(0, i), action: k.slice(i + 1) };
}

const words = (s: string) => s.replace(/[._]+/g, ' ').trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const ACTION_VERB: Record<string, string> = {
  view: 'View', manage: 'Manage', edit: 'Edit', create: 'Create', update: 'Update', delete: 'Delete', export: 'Export',
  approve: 'Approve', use: 'Use', archive: 'Archive', publish: 'Publish', unpublish: 'Unpublish', apply: 'Apply',
};
export function labelOf(key: string): string {
  const { domain, action } = splitKey(key);
  const verb = ACTION_VERB[action] ?? cap(words(action));
  return `${verb} ${words(domain)}`.trim();
}

/** The rule-based sensitivity. Explicit metadata (above) overrides it; the test makes the dangerous ones explicit. */
export function derivedSensitivity(key: string): PermissionSensitivity {
  const k = key.startsWith('super_admin.') ? key.slice('super_admin.'.length) : key;
  if (/^(roles|permissions|branch_access|ownership|access_review|subscription)\.(manage|override|transfer)$/.test(k)) return 'critical';
  if (/^approvals\.manage_policies$/.test(k) || /^platform_roles\./.test(k)) return 'critical';
  if (/(^|[._])(export|delete|hard_delete|anonymize|view_raw|purge)$/.test(k)) return 'high';
  if (/(refund|void|payout|payroll|compensation|earnings|finance|approve_refund|manage_overrides|tap_to_pay|split_payment|process_payment|credentials)/.test(k)) return 'high';
  if (/(^|\.)(override|override_[a-z_]+|archive|support_mode|security_reports\.view)$/.test(k) || /^security_reports\./.test(k)) return 'high';
  if (/(^settings\.edit$|manage_settings$|\.configure$|manage_auto$|^ai\.manage$|^reconciliation\.approve$)/.test(k)) return 'high';
  if (/(\.manage|\.edit|\.approve|\.decide|manage_rules|\.update|\.create|\.publish|\.unpublish|\.adjust|\.assign|\.resolve|\.investigate)$/.test(k)) return 'medium';
  return 'low';
}

export function derivedScopes(key: string): PermissionScope[] {
  const realm = realmOf(key);
  if (realm === 'platform') return ['PLATFORM'];
  if (realm === 'technician' || key.startsWith('self.') || /\.view_own$/.test(key)) return [...OWN];
  if (realm === 'owner') return ['SELECTED_BRANCHES', 'TENANT'];
  return [...ALL_BRANCH];
}

const CATALOG = new Set<string>(PERMISSIONS as readonly string[]);

/** Legacy route key → the catalog key the guard checks for it (null = it resolves to nothing in the catalog). */
export function catalogKeyFor(aliasOrKey: string): string | null {
  if (CATALOG.has(aliasOrKey)) return aliasOrKey;
  const c = requiredCapability(aliasOrKey);
  return CATALOG.has(c) ? c : null;
}

function build(): PermissionDefinition[] {
  const aliases = new Map<string, string[]>();
  for (const a of [...POS_ROUTE_KEY_ALIASES, ...Object.keys(PAYMENT_PERMISSION_ALIASES)]) {   // M6-6: the Tap to Pay mandate's names too
    if (CATALOG.has(a)) continue;
    const k = catalogKeyFor(a);
    if (!k) continue;   // permission-registry.test reports it
    (aliases.get(k) ?? aliases.set(k, []).get(k)!).push(a);
  }
  return (PERMISSIONS as readonly string[]).map((key) => {
    const { domain, action } = splitKey(key);
    const x = EXPLICIT_PERMISSION_METADATA[key];
    const sensitivity = x?.sensitivity ?? derivedSensitivity(key);
    return {
      key, domain, action, realm: realmOf(key),
      label: x?.label ?? labelOf(key),
      description: x?.description ?? `${labelOf(key)}.`,
      sensitivity,
      scopes: x ? [...x.scopes] : derivedScopes(key),
      stepUp: x ? x.stepUp : sensitivity === 'critical',
      deprecatedAliases: (aliases.get(key) ?? []).sort(),
    };
  });
}

/** Every catalog key with its metadata, in catalog order. */
export const PERMISSION_REGISTRY: readonly PermissionDefinition[] = Object.freeze(build());
const BY_KEY = new Map(PERMISSION_REGISTRY.map((d) => [d.key, d]));

/** The definition of a catalog key — or of a legacy `pos.*` route key (resolved to the catalog key it maps to). */
export function definitionOf(key: string): PermissionDefinition | undefined {
  return BY_KEY.get(key) ?? (catalogKeyFor(key) ? BY_KEY.get(catalogKeyFor(key)!) : undefined);
}

export const HIGH_RISK_SENSITIVITIES: readonly PermissionSensitivity[] = ['high', 'critical'];
/** Tenant-side keys rated high or critical — what the high-risk report and access reviews list. */
export function isHighRiskPermission(key: string): boolean {
  const d = definitionOf(key);
  return !!d && d.realm !== 'platform' && HIGH_RISK_SENSITIVITIES.includes(d.sensitivity);
}
/** Keys that need a fresh step-up when GRANTED (role, override) or USED on a step-up route. */
export function requiresStepUp(key: string): boolean { return !!definitionOf(key)?.stepUp; }

/** The base roles that hold a key by default (docs + the role editor's "who has this"). */
export function rolesHolding(key: string): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => (ROLE_PERMISSIONS[r] as readonly string[]).includes(key));
}

/** Domains in catalog order (the role editor groups by these). */
export function permissionDomains(realm?: PermissionRealm): string[] {
  const out: string[] = [];
  for (const d of PERMISSION_REGISTRY) if ((!realm || d.realm === realm) && !out.includes(d.domain)) out.push(d.domain);
  return out;
}
