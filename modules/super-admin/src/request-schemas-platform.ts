// request-schemas-platform.ts — BUILD_PLAN Phase 12 (#17): the super-admin platform controller (applications, leads,
// hardware, AI packages, usage limits, branches, merges, privacy requests, users / invitations, scheduled reports,
// access requests, support sessions, app flags) and platform-staff. Clients: admin-web superAdminApi.ts and the
// screens behind it (BranchesScreen, HardwareScreen, LeadsScreen, UsersRolesScreen, SupportAccessScreen,
// ServicesScreen, AppControlsPanel); fields from super-admin-platform.service.ts. A platform role / tenant / branch
// that a route DECLARES is the target of the Super Admin's action; undeclared ones stay refused.
import { S, blob, flag, id, ids, num, numish, obj, scalar, str, type BodySchema } from './request-schemas-fields';

const v = (max = 500): BodySchema => ({ type: ['string', 'number', 'boolean', 'null'], maxLength: max });
// ── applications + leads ───────────────────────────────────────────────────────────────────────────────────────────
/** a manual application (snake_case, as the intake row is stored) */
export const PL_APPLICATION_BODY: BodySchema = obj({ salon_name: v(200), owner_name: v(200), phone: v(40), email: v(254), city: v(120), state: v(60), technicians_count: v(10), current_pos: v(120), current_processor: v(120), monthly_card_volume_cents: v(20), preferred_imac_color: v(40), source: v(60) });
export const PL_APP_STATUS_BODY: BodySchema = obj({ status: str(30), note: str(2000), reason: str(2000) });
export const PL_APP_ASSIGN_BODY: BodySchema = obj({ userId: id });
export const PL_APP_PRIORITY_BODY: BodySchema = obj({ priority: scalar(20) });
export const PL_APP_FOLLOW_UP_BODY: BodySchema = obj({ at: str(40) });
export const PL_APP_CONTACT_BODY: BodySchema = obj({ channel: str(30), note: str(2000) });
export const PL_NOTE_BODY: BodySchema = obj({ note: str(2000) });
export const PL_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const PL_TEXT_BODY: BodySchema = obj({ text: str(5000) });
export const PL_APP_CONVERTED_BODY: BodySchema = obj({ tenantId: id });
export const PL_LEAD_BODY: BodySchema = obj({ kind: str(40), name: str(200), salon_name: str(200), phone: str(40), email: str(254), city: str(120), state: str(60), source_page: str(200), message: str(5000) });
export const PL_STATUS_BODY: BodySchema = obj({ status: str(30) });
// ── platform hardware (legacy iMac / Clover packages; snake_case columns) ─────────────────────────────────────────
const hw = { tenant_id: id, imac_color: str(40), imac_serial: str(120), clover_flex_serial: str(120), checkin_display_serial: str(120) };
export const PL_HARDWARE_CREATE_BODY: BodySchema = obj({ ...hw, application_id: id, status: str(30) });
export const PL_HARDWARE_UPDATE_BODY: BodySchema = obj({ ...hw, status: str(30), agreement_status: str(20), payment_setup_status: str(20) });
// ── AI packages / usage limits / app flags ─────────────────────────────────────────────────────────────────────────
export const PL_AI_PACKAGE_BODY: BodySchema = obj({ package: str(80) });
export const PL_AI_FEATURE_BODY: BodySchema = obj({ feature: scalar(120), enabled: bool3() });
export const PL_USAGE_LIMIT_BODY: BodySchema = obj({ metric: str(80), limitValue: numish });
export const PL_APP_FLAG_BODY: BodySchema = obj({ flag: scalar(120), enabled: bool3() });
function bool3(): BodySchema { return { type: ['boolean', 'null', 'string', 'number'], maxLength: 8 }; }
// ── branches ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const PL_BULK_BRANCH_STATUS_BODY: BodySchema = obj({ branchIds: ids(1000), status: str(30), reason: str(2000) });
export const PL_CREATE_BRANCH_BODY: BodySchema = obj({
  tenantId: id, name: str(200), address: str(500), city: str(120), state: str(60), zip: str(20), phone: str(40),
  latitude: numish, longitude: numish, managerName: str(200), managerEmail: str(254), managerPhone: str(40), managerUserId: id,
  timezone: str(64), openingStatus: str(30), reason: str(2000),
});
export const PL_BRANCH_STATUS_BODY: BodySchema = obj({ status: str(30), reason: str(2000), confirmName: str(200) });
export const PL_BRANCH_MANAGER_BODY: BodySchema = obj({ managerUserId: id, reason: str(2000), effectiveDate: str(40) });
export const PL_BRANCH_TRANSFER_BODY: BodySchema = obj({ destinationTenantId: id, reason: str(2000), confirmName: str(200), effectiveDate: str(40) });
const day: BodySchema = obj({ dayOfWeek: numish, isClosed: flag, opensAt: str(10), closesAt: str(10) });
export const PL_BRANCH_HOURS_BODY: BodySchema = obj({ days: S.nullable(S.array(day, { maxItems: 14 })) });
export const PL_ALLOCATE_DEVICE_BODY: BodySchema = obj({ deviceId: id, category: str(40) });
// ── merges / privacy requests (run inside a support session) ──────────────────────────────────────────────────────
export const PL_MERGE_CUSTOMERS_BODY: BodySchema = obj({ sessionId: id, tenantId: id, sourceCustomerId: id, targetCustomerId: id, reason: str(2000) });
export const PL_MERGE_CATEGORIES_BODY: BodySchema = obj({ sessionId: id, tenantId: id, sourceCategoryId: id, targetCategoryId: id, reason: str(2000) });
export const PL_PRIVACY_REQUEST_BODY: BodySchema = obj({ tenantId: id, customerId: id, requestType: str(40), requesterName: str(200), requesterContact: str(254), scope: str(200), legalBasis: str(500) });
export const PL_PRIVACY_ADVANCE_BODY: BodySchema = obj({ sessionId: id, tenantId: id, status: str(30), note: str(2000) });
// ── users / invitations / access requests ─────────────────────────────────────────────────────────────────────────
export const PL_CREATE_SUPER_ADMIN_BODY: BodySchema = obj({ email: str(254), fullName: str(200) });
/** C3 (Oct 23 2026): the general invite is the secure invitation — platformRole (checked against the inviter's own
 *  permissions) and the delivery channel are declared like PL_INVITATION_BODY */
export const PL_INVITE_USER_BODY: BodySchema = obj({ email: str(254), phone: str(40), fullName: str(200), role: str(40), platformRole: str(40), tenantId: id, branchId: id, channel: str(20) });
/** C2: an admin-initiated reset — why (audited; ≥ 10 characters, service-checked) and which of the account's own channels */
export const PL_RESET_PASSWORD_BODY: BodySchema = obj({ reason: str(2000), deliveryMethod: S.nullable(S.enumOf(['auto', 'email', 'sms'])) });
export const PL_RESEND_INVITE_BODY: BodySchema = obj({ deliveryMethod: S.nullable(S.enumOf(['auto', 'email', 'sms'])) });
/** platformRole is DECLARED here: inviting a platform staff member is this route's purpose (the service re-checks the
 *  inviter's own platform permissions) */
export const PL_INVITATION_BODY: BodySchema = obj({ email: str(254), phone: str(40), fullName: str(200), role: str(40), platformRole: str(40), tenantId: id, branchId: id, channel: str(20), approvalReason: str(2000) });   // approvalReason: Security Deep Scan §134 (dual approval on)
export const PL_SCHEDULED_REPORT_BODY: BodySchema = obj({ name: str(200), reportKey: str(100), cadence: str(20), recipientEmail: str(254), filters: blob, format: str(10) });
export const PL_TOGGLE_BODY: BodySchema = obj({ enabled: flag });
export const PL_ACCESS_REQUEST_BODY: BodySchema = obj({ requestingUserId: id, requestedRole: str(40), reason: str(2000), requestedDurationDays: num, tenantId: id, requestedBranchIds: ids(200) });
export const PL_ACCESS_DECISION_BODY: BodySchema = obj({ notes: str(2000), durationDays: num, confirmHighRisk: flag });
export const PL_USER_BRANCH_BODY: BodySchema = obj({ sessionId: id, tenantId: id, userId: id, branchId: id, reason: str(2000), accessLevel: str(30) });
export const PL_USER_ROLE_BODY: BodySchema = obj({ role: str(40) });
export const PL_USER_MFA_BODY: BodySchema = obj({ required: flag });
// ── support sessions ───────────────────────────────────────────────────────────────────────────────────────────────
export const PL_SUPPORT_START_BODY: BodySchema = obj({ tenantId: id, branchId: id, reason: str(2000), minutes: numish, scope: str(40), accessLevel: str(40) });
export const PL_SUPPORT_EXTEND_BODY: BodySchema = obj({ minutes: numish, reason: str(2000) });
/** an audited change made inside a support session: before / after are snapshots the service records verbatim */
export const PL_SUPPORT_ACTION_BODY: BodySchema = obj({ tenantId: id, branchId: id, appointmentId: id, action: str(60), reason: str(2000), before: S.any(), after: S.any() });
export const PL_SUPPORT_CUSTOMER_ACTION_BODY: BodySchema = obj({ tenantId: id, branchId: id, customerId: id, action: str(60), reason: str(2000), before: S.any(), after: S.any() });
// ── platform staff (platformRole declared — changing it IS this route) ───────────────────────────────────────────────
export const PS_ROLE_BODY: BodySchema = obj({ platformRole: str(40), reason: str(2000) });
export const PS_STATUS_BODY: BodySchema = obj({ status: str(20), reason: str(2000) });
export const PS_REASON_BODY: BodySchema = obj({ reason: str(2000) });
