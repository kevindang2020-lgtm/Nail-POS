/**
 * rbac.ts — roles, the permission catalog, and pure permission checks.
 * No I/O. The catalog is the single source of truth for what each role can do.
 */

export type Role =
  | 'SUPER_ADMIN' | 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'RECEPTION' | 'TECHNICIAN' | 'CUSTOMER';

export const PERMISSIONS = [
  'pos.login','dashboard.view','global_search.use',
  'checkin.view','checkin.manage','booking.view','booking.manage','booking.override',   // booking.override: Smooth Refresh spec §11 -- intentional overbooking, owner + manager
  'queue.view','queue.manage','serving.view','serving.manage',
  'checkout.view','checkout.process_payment','checkout.approve_refund','checkout.manage_overrides',
  'deals.apply',   // BUILD_PLAN Phase 5: put a deal or a coupon on a ticket — everyone who runs checkout (a MANUAL discount stays checkout.manage_overrides)   // approve_refund: Constitution 12 M9 — large/cash refunds; manage_overrides: developer merge Sep 2026
  'customers.view','customers.edit','customers.export','customers.phone_manage','technicians.view','technicians.edit',   // customers.export: Constitution 12 §323 — owners/managers only; customers.phone_manage: Phase 3 — approve / resolve / manually confirm / configure customer phone changes (owners, managers)
  'services.view','services.edit','reports.view','reports.export',
  // AI Deposit Reconciliation — tenant finance perms
  'reconciliation.view','reconciliation.manage','reconciliation.approve',
  'settings.view','settings.edit','ai.use','ai.manage','ai_business.view','ai_inventory.view','ai_inventory.manage_recipes','ai_analytics.view','ai_checkout_upsell.view','subscription.manage',
  // Coarse marketing + inventory-manage capabilities. The granular guards (`pos.marketing.*`, and the
  // pos.ai_review_reputation.* / pos.ai_ocr_receipt.* aliases in security-core) resolve to these via
  // requiredCapability(); before the four-package merge they resolved to capabilities NO role held, which
  // 403'd the marketing/reviews-visibility surface (and the aliased AI modules) for every live token.
  'marketing.view','marketing.manage','inventory.manage',
  // Coarse communications + payroll + tenant-audit capabilities. The granular guards resolve to these via
  // requiredCapability(): pos.communications.view -> communications.view; pos.communications.send/manage ->
  // communications.manage; pos.payroll.* -> payroll.*; and the tenant Audit Log controller gates 'audit.view'
  // directly. Like the marketing/inventory case above, before this fix these resolved to capabilities NO role
  // held, so the Communications inbox, Payroll screens, and tenant Audit view 403'd for every token including
  // OWNER. Reachability is now locked by common/permission-reachability.vitest.spec.ts.
  'communications.view','communications.manage','payroll.view','payroll.manage','audit.view',
  // Payroll mandate wave 2 (Oct 12 2026, §71/§82/§63/§79/§101): approving / locking / reopening a pay period, exporting
  // payroll, adding manual adjustments and deductions, and recording payouts are each their own key (owner by default;
  // a manager keeps payroll.adjust — they could already edit lines). Approve / reopen / pay also need a fresh step-up.
  'payroll.approve','payroll.export','payroll.adjust','payouts.manage',
  // Weekly Paycheck mandate (Oct 21 2026, §10–§12 / §16): issuing / delivering / voiding paychecks and preparing / handing
  // over payroll cash are their own keys (owner + manager by default) — paying out what the OWNER approved, never approving it.
  'payroll.issue_check','payroll.cash_handoff',
  'super_admin.tenants.view','super_admin.tenants.create','super_admin.tenants.edit',
  'super_admin.tenants.suspend','super_admin.users.manage',
  'super_admin.subscriptions.manage','super_admin.billing.view','super_admin.billing.invoices.create','super_admin.billing.invoices.finalize','super_admin.billing.credits.apply','super_admin.billing.payments.retry','super_admin.billing.plans.change','super_admin.billing.addons.manage','super_admin.billing.trials.extend','super_admin.billing.discounts.manage','super_admin.billing.pause','super_admin.billing.cancel','super_admin.billing.requests.review','super_admin.billing.export','super_admin.ai_packages.manage','super_admin.catalog.manage','super_admin.disputes.view','super_admin.disputes.manage','super_admin.disputes.evidence.submit','super_admin.disputes.outcome.record','super_admin.disputes.risk.flag','super_admin.disputes.override','super_admin.disputes.export','super_admin.memberships.view','super_admin.memberships.manage','super_admin.memberships.export','super_admin.memberships.support_mode','super_admin.memberships.correct','super_admin.memberships.disable','super_admin.audit_logs.view',
  // §34 customer sync & reconciliation (global customer identity). SUPER_ADMIN-only by construction: the keys live
  // in the super_admin.* namespace and OWNER is defined as "everything except super_admin.*", so no tenant employee
  // can ever receive global customer-directory access.
  'super_admin.customer_sync.view','super_admin.customer_sync.run','super_admin.customer_sync.review',
  'super_admin.customer_sync.merge','super_admin.customer_sync.resolve_conflict',
  // Onboarding & Approvals (Super Admin only; the SuperAdminGuard is the runtime gate, these document the granular surface)
  'super_admin.applications.view','super_admin.applications.review','super_admin.applications.assign','super_admin.applications.contact','super_admin.applications.note','super_admin.applications.update_status','super_admin.applications.approve','super_admin.applications.reject','super_admin.applications.convert','super_admin.applications.view_sensitive','super_admin.applications.export','super_admin.applications.archive',
  'super_admin.onboarding.view','super_admin.onboarding.create','super_admin.onboarding.assign_specialist',
  'super_admin.onboarding.review','super_admin.onboarding.identity.override','super_admin.onboarding.data_import.approve',
  'super_admin.onboarding.approve','super_admin.onboarding.reject','super_admin.onboarding.return_for_correction',
  'super_admin.onboarding.activate','super_admin.onboarding.export','super_admin.onboarding.notes.view',
  'super_admin.onboarding.notes.create','super_admin.onboarding.audit.view',
  // integrations (Super Admin; enforced by IntegrationPermissionGuard — keep in sync with
  // super-admin-integrations/integration-permissions.ts). Sensitive capabilities are listed but held separate there.
  'super_admin.integrations.view','super_admin.integrations.search','super_admin.integrations.details.view',
  'super_admin.integrations.create','super_admin.integrations.edit','super_admin.integrations.enable',
  'super_admin.integrations.disable','super_admin.integrations.connection.test','super_admin.integrations.authentication.refresh',
  'super_admin.integrations.sync.view','super_admin.integrations.sync.retry','super_admin.integrations.webhooks.view',
  'super_admin.integrations.webhooks.details.view','super_admin.integrations.errors.view','super_admin.integrations.api_health.view',
  'super_admin.integrations.tenant_access.view','super_admin.integrations.marketplace.view','super_admin.integrations.export',
  'super_admin.integrations.audit.view','super_admin.integrations.compromised.disable','super_admin.integrations.cross_tenant.view',
  'super_admin.integrations.cross_tenant.export','super_admin.integrations.credentials.view','super_admin.integrations.credentials.manage',
  'super_admin.integrations.credentials.rotate','super_admin.integrations.raw_payload.view','super_admin.integrations.shared_connection.manage',
  'super_admin.integrations.production_webhook.manage','super_admin.integrations.tenant_access.manage',
  // platform branding (Super Admin only; the official logo asset is locked even with asset.upload)
  'super_admin.branding.view','super_admin.branding.update','super_admin.branding.asset.upload','super_admin.branding.asset.restore',
  'super_admin.general_settings.view','super_admin.general_settings.edit','super_admin.general_settings.reset',
  // Constitution 11 §180: System Operations (component health, alerts, SLOs). Granted with every super_admin.* permission.
  'super_admin.system_operations.view',
  // BUILD_PLAN Phase 10 (Constitution 1 §94–98): System Operations → Database — read the figures / run the audited actions
  'super_admin.database.view','super_admin.database.manage',
  // BUILD_PLAN Phase 13 B (Constitution 6 §55–57, §150): System Operations → Mobile app versions — read the policies and the
  // installed-version distribution / set a store app's minimum, recommended and latest version (step-up + reason + audit)
  'super_admin.mobile_versions.view','super_admin.mobile_versions.manage',
  // BUILD_PLAN Phase 14 A (Constitution 11 §181): telemetry search (System Operations → Request search). view = the
  // aggregate-safe projection; sensitive.view = per-request rows as stored (tenant ids, routes with ids, error messages)
  'super_admin.telemetry.view','super_admin.telemetry.sensitive.view',
  'super_admin.general_settings.legal_documents.view','super_admin.general_settings.legal_documents.manage','super_admin.general_settings.legal_documents.publish',
  'super_admin.general_settings.maintenance.view','super_admin.general_settings.maintenance.manage',
  'super_admin.general_settings.business_categories.view','super_admin.general_settings.business_categories.manage',
  'super_admin.general_settings.tenant_presets.view','super_admin.general_settings.tenant_presets.manage',
  // technician-app granular permissions (enforced by TechService; embedded in the token via permissionsFor)
  'tech.dashboard.view','tech.schedule.view','tech.ticket.view','tech.ticket.accept','tech.ticket.decline','tech.service.start',
  'tech.service.complete','tech.service.note_add','tech.service.pause','tech.ticket.cancel_request','tech.ticket.transfer_request','tech.ticket.add_addon','tech.ticket.edit_lines',
  'tech.break.start','tech.break.end','tech.timeclock.punch','tech.walkin.request','tech.earnings.view','tech.payroll.view',
  'tech.profile.edit','tech.notifications.manage',
  'tech.time_off.request',
  'tech.turn_queue.view',   // Fair Turn §94–96: her own turn position / status / today's turns (the salon's visibility setting decides the rest)   // merge Oct 12 2026 (BK): a technician requests / withdraws her OWN time off (technician-time-off.controller)
  // owner-app permissions (enforced by OwnerService; embedded via permissionsFor)
  'owner.dashboard.view','owner.branches.view','owner.branches.compare','owner.bookings.view','owner.bookings.details',
  'owner.staff.view','owner.staff.performance.view','owner.staff.earnings.view','owner.finance.view','owner.reports.view',
  'owner.reports.export','owner.alerts.view','owner.alerts.resolve','owner.settings.view','owner.settings.edit','owner.notifications.manage',
  'owner.expenses.view','owner.expenses.manage',
  // Receipt / Expense / OCR / Accounting mandate (Oct 21 2026): approve (§82 — AI extracts, owner / manager approves), the
  // accountant export (§97–100), the salon's categories + categorization rules + expense settings (§175–176), reimbursements (§64)
  'owner.expenses.approve','owner.expenses.export','owner.expenses.categories.manage','owner.expenses.reimbursements.manage',
  // tenant (salon) branding — owners manage only their own salon identity, never the platform logo
  'owner.tenant_branding.view','owner.tenant_branding.update',
  // salon location management (tenant manager side) + super-admin platform verification
  'locations.view','locations.create','locations.update','locations.map.update','locations.publish',
  'locations.unpublish','locations.archive','locations.hours.manage','locations.booking.manage',
  'inventory.view','inventory.view_limited','inventory.create','inventory.update','inventory.archive',
  'inventory.stock.add','inventory.stock.adjust','inventory.stock.count','inventory.transfer',
  'inventory.purchase_order.view','inventory.purchase_order.create','inventory.purchase_order.approve','inventory.purchase_order.receive',
  'inventory.vendor.manage','inventory.category.manage','inventory.brand.manage','inventory.color.manage',
  'inventory.reports.view','inventory.cost.view','inventory.value.view',
  'inventory.technician_report.submit','inventory.technician_report.approve','inventory.product_usage.submit','inventory.bottle.open','inventory.barcode.manage',
  'super_admin.platform_locations.view','super_admin.platform_locations.verify','super_admin.platform_locations.reject',
  'super_admin.platform_locations.suspend','super_admin.platform_locations.correct','super_admin.platform_locations.audit.view',
  // Owner & Manager Payment App (backup mobile checkout / Tap to Pay on iPhone). The PERMISSION is the gate — never
  // the job title — and is layered on top of approved-device + active-employee + branch-merchant checks at runtime.
  'mobile_checkout.login','mobile_checkout.view_queue','mobile_checkout.open_ticket','mobile_checkout.add_product',
  'mobile_checkout.tip','mobile_checkout.split_payment','mobile_checkout.tap_to_pay','mobile_checkout.send_receipt',
  'mobile_checkout.view_history','mobile_checkout.view_reports','mobile_checkout.refund_request','mobile_checkout.void_request',
  // AI Reception Copilot permission matrix (§45). Advisory-view perms + per-action perms; high-risk actions require the
  // matching domain permission IN ADDITION to these (enforced in the Copilot action spine).
  'reception_copilot.use',
  'reception_copilot.view_customer_context','reception_copilot.view_queue','reception_copilot.view_recommendations',
  'reception_copilot.view_ai_phone_activity','reception_copilot.explain_services','reception_copilot.suggest_waitlist',
  'reception_copilot.draft_messages',
  'reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message',
  'reception_copilot.take_over_calls','reception_copilot.give_feedback',
  'reception_copilot.manage_settings','reception_copilot.view_learning','reception_copilot.approve_learning','reception_copilot.view_usage',
  // AI Booking Assistant permission matrix (§54). Per-action + override + management. High-risk actions require the
  // matching domain permission (pos.booking.*) IN ADDITION, enforced in the ai_booking mutation facade + domain service.
  'ai_booking.view','ai_booking.search_availability','ai_booking.create','ai_booking.reschedule','ai_booking.cancel','ai_booking.confirm',
  'ai_booking.override_duplicate','ai_booking.override_conflict','ai_booking.use_alternate_branch','ai_booking.manage_partner_links',
  'ai_booking.view_sources','ai_booking.view_conversion','ai_booking.manage_settings','ai_booking.support_mode',
  // AI Money Protection (financial anomaly detection + investigations). View is advisory; investigate/resolve/
  // escalate gate the human-review workflow. High-risk money actions still require the matching checkout/refund
  // permission IN ADDITION — this module never authorizes money movement on its own.
  'ai_money_protection.view','ai_money_protection.view_alerts','ai_money_protection.manage_rules',
  'ai_money_protection.investigate','ai_money_protection.resolve','ai_money_protection.escalate',
  'ai_money_protection.manage_settings','ai_money_protection.export',
  'ai_voice_transcription.view','ai_voice_transcription.view_transcripts','ai_voice_transcription.manage_rules',
  'ai_voice_transcription.manage_settings','ai_voice_transcription.play_recording','ai_voice_transcription.view_raw',
  'ai_voice_transcription.delete','ai_voice_transcription.export',
  // AI Queue Assignment — recommendation/assignment intelligence over the existing queue.
  'ai_queue_assignment.view','ai_queue_assignment.recommend','ai_queue_assignment.assign',
  'ai_queue_assignment.override','ai_queue_assignment.manage_rules','ai_queue_assignment.manage_auto',
  'ai_queue_assignment.resolve_alerts','ai_queue_assignment.export',
  // AI Scheduling Optimizer (BUILD_PLAN Phase 7) — its own capabilities. It used to borrow booking.view / booking.manage,
  // so every technician (who holds booking.manage) could generate, accept and apply schedule changes. view_own = a
  // technician sees only recommendations that touch them. approve = the duration / staffing / availability insights.
  'ai_scheduling.view','ai_scheduling.view_own','ai_scheduling.generate','ai_scheduling.review','ai_scheduling.approve',
  'ai_scheduling.apply','ai_scheduling.configure','ai_scheduling.export',
  // Safety Community (tenant_safety_community). The role split mirrors the module's own safety floor in
  // community-permissions.ts: reception/front-desk may draft and comment but may NEVER submit or approve an
  // advisory; technicians get nothing by default; moderation is Super-Admin-only (not a tenant permission).
  'community.feed.view','community.incident.create','community.advisory.draft','community.advisory.submit',
  'community.advisory.approve','community.comment.create','community.evidence.upload',
  // BUILD_PLAN Phase 8: the actions every tenant user was doing under community.feed.view get their own keys.
  'community.settings.manage','community.report.create','community.dispute.create','community.appeal.create','community.follow',
  // BUILD_PLAN Phase 9 (Constitution 2): roles + branch access + per-user overrides + ownership; access governance; the
  // salon's one approvals engine. roles.manage replaces the technicians.edit key the role routes borrowed.
  'roles.view','roles.manage','branch_access.manage','permissions.override','ownership.transfer',
  'access_review.view','access_review.manage','security_reports.view',
  'approvals.view','approvals.request','approvals.decide','approvals.manage_policies',
  // BUILD_PLAN Phase 9 (Constitution 2 §default deny): the keys the last 324 unkeyed staff routes now declare.
  // Self-service (a person's own profile, sessions, preferences, privacy export, account-closure request) and the Help
  // Center: every staff role, exactly as the open routes allowed. help.triage = the ticket triage the support service
  // already limited to owners and managers.
  'self.profile.view','self.profile.edit','self.notifications',
  // BUILD_PLAN Phase 12 (Constitution 5 §32–33): a person's own asynchronous exports (status + download). Seeing ANOTHER
  // person's export also needs that export's own permission in the same salon — the operations service checks it.
  'self.operations.view',
  'help.view','help.request','help.triage',
  // Owner app: the multi-salon portfolio (OwnerPortfolioGuard: OWNER only).
  'owner.portfolio.view',
  // Technician app: end-of-day follow-ups, the technician's own cash (cash collected / hand-off) and technician deals.
  'tech.followups.manage','tech.cash.manage','tech.deals.manage',
  // Five keys services checked that no catalog held (audit bug 6). compensation.*: the compensation controller's gate
  // let only the OWNER role in; ai.control.manage: AI control modes, owner-only (ai-governance.service.ts);
  // ai_inventory.view_cost: AI inventory cost / margin, which every non-technician with inventory.view already sees
  // (ai-inventory-access.ts costVisible). pos.pricing.override is not registered: Phase 1 replaced its only check with
  // pos.checkout.override_total (→ checkout.manage_overrides) and nothing references it any more.
  'compensation.view_all','compensation.manage','ai.control.manage','ai_inventory.view_cost',
  // Payroll merge (Oct 12 2026, mandate §28/§101 tips.adjust): set an explicit per-technician tip split on a ticket; after
  // payment the change is a posted tip_correction in the adjustments ledger (never a snapshot edit). Owner + manager.
  'tips.adjust',
  // Technician Profile merge (Oct 12 2026, mandate §72/§122): READ a technician's pay — commission %, commission
  // history, payroll summary. technicians.view is the roster read (name, status, skills, schedule); pay is its own key.
  'technicians.view_pay',
  // Fair Turn Engine (wave 2, Oct 12 2026, mandate §139): the technician TURN QUEUE. Read the board; join a technician
  // to the rotation; hold / release; assign (the recommended technician, a customer decline); reorder; adjust turn credit
  // and close a day; change the salon's turn rules (owner); read the turn history / fairness dashboard. The Technician
  // App reads her own position with tech.turn_queue.view (visibility set by the salon, never anyone's money).
  'turn_queue.read','turn_queue.join','turn_queue.hold','turn_queue.assign','turn_queue.auto_assign','turn_queue.manual_assign',
  'turn_queue.reorder','turn_queue.adjust','turn_queue.settings.manage','turn_queue.history.read',
  // Super Admin technician account management (Workforce Oversight). Each sensitive action is its own key, so a
  // super-admin session can be minted with only the subset it should hold — the guard enforces per-action, and the
  // most dangerous (suspend / merge / delete / anonymize / hard_delete) are gated separately from routine oversight.
  // §54 SMS Verification Packages (Jul 29 2026)
  'super_admin.sms_packages.view','super_admin.sms_packages.manage',
  'super_admin.sms_tenant_plan.view','super_admin.sms_tenant_plan.change',
  'super_admin.sms_usage.view','super_admin.sms_usage.adjust',
  'super_admin.sms_billing.view','super_admin.sms_billing.adjust',
  'super_admin.sms_emergency.disable',
  'super_admin.technicians.view','super_admin.technicians.manage','super_admin.technicians.pause',
  'super_admin.technicians.reactivate','super_admin.technicians.suspend','super_admin.technicians.restore',
  'super_admin.technicians.transfer','super_admin.technicians.memberships_manage','super_admin.technicians.profile_moderate',
  'super_admin.technicians.support_mode','super_admin.technicians.merge','super_admin.technicians.delete_request',
  'super_admin.technicians.anonymize','super_admin.technicians.hard_delete','super_admin.technicians.security_manage',
  // Constitution 7 §6–§7 — control-plane DOMAIN keys (platform-roles.ts): the read/manage key a platform route requires
  // when it declares none, and the platform-role key (§25). Kept literal so the Permission union stays exact.
  'super_admin.analytics.view','super_admin.analytics.manage','super_admin.users.view','super_admin.onboarding.manage','super_admin.plans.view','super_admin.plans.manage','super_admin.billing.manage','super_admin.payments.view','super_admin.payments.manage','super_admin.communications.view','super_admin.communications.manage','super_admin.marketing.view','super_admin.marketing.manage','super_admin.ai.view','super_admin.ai.manage','super_admin.customers.view','super_admin.customers.manage','super_admin.operations.view','super_admin.operations.manage','super_admin.catalog.view','super_admin.support.view','super_admin.support.manage','super_admin.system.manage','super_admin.security.view','super_admin.security.manage','super_admin.audit.manage','super_admin.integrations.manage','super_admin.platform_roles.manage','super_admin.tickets.remove',
] as const;
export type Permission = typeof PERMISSIONS[number];

// Safety Community grants. Kept in sync with community-permissions.ts: an approver role may submit/approve;
// front-of-house may draft and comment but never publish; technicians get none by default.
const COMMUNITY_MANAGER: Permission[] = [
  'community.feed.view', 'community.incident.create', 'community.advisory.draft',
  'community.advisory.submit', 'community.advisory.approve', 'community.comment.create', 'community.evidence.upload',
  'community.report.create', 'community.dispute.create', 'community.appeal.create', 'community.follow',
];
const COMMUNITY_FRONT_DESK: Permission[] = [
  'community.feed.view', 'community.incident.create', 'community.advisory.draft', 'community.comment.create',
  'community.report.create', 'community.follow',
];

const POS_VIEW = ['pos.login','dashboard.view','global_search.use','inventory.view','checkin.view','booking.view','queue.view','serving.view','checkout.view','customers.view','technicians.view','services.view','communications.view'] as const;
// BUILD_PLAN Phase 6 — AI queue assignment role matrix. The front desk sees the suggestion, asks for one, accepts it
// (accepting = assigning through the queue's own guarded action) and acknowledges alerts; overriding the suggestion,
// locks, rules, auto-assignment and exports are the manager's.
const AI_QUEUE_FRONT_DESK = ['ai_queue_assignment.view','ai_queue_assignment.recommend','ai_queue_assignment.assign','ai_queue_assignment.resolve_alerts'] as const;
const AI_QUEUE_MANAGER = [...AI_QUEUE_FRONT_DESK,'ai_queue_assignment.override','ai_queue_assignment.manage_rules','ai_queue_assignment.manage_auto','ai_queue_assignment.export'] as const;
// BUILD_PLAN Phase 7 — AI scheduling role matrix. The front desk asks for options and recommendations; reviewing,
// approving insights, applying and exporting are the manager's; configuring (settings, automation, kill switch) is the
// owner's alone (OWNER holds every tenant key). Technicians see what touches them.
const AI_SCHED_FRONT_DESK = ['ai_scheduling.view','ai_scheduling.generate'] as const;
const AI_SCHED_MANAGER = [...AI_SCHED_FRONT_DESK,'ai_scheduling.review','ai_scheduling.approve','ai_scheduling.apply','ai_scheduling.export'] as const;
// BUILD_PLAN Phase 9 role defaults (Kevin's open decisions carried as defaults): managers assign roles within their own
// ceiling and decide approvals within the salon's thresholds; branch access, overrides, ownership, access review and the
// high-risk reports are the owner's; the front desk may REQUEST an approval.
const GOV_MANAGER = ['roles.view','roles.manage','approvals.view','approvals.request','approvals.decide'] as const;
const GOV_FRONT_DESK = ['approvals.view','approvals.request'] as const;
const POS_MANAGE = ['checkin.manage','booking.manage','queue.manage','serving.manage','checkout.process_payment','customers.edit','communications.manage','deals.apply'] as const;
// Fair Turn Engine §142–144: the front desk views the board, joins a clocked-in technician, assigns the recommended
// technician and logs a guest's decline; the manager also holds / reorders / manual-assigns / corrects turn credit, closes
// a day and reads the history + fairness dashboard (branch scope); the turn RULES (mode, fairness, weights, policies) are
// the owner's (turn_queue.settings.manage — OWNER holds every tenant key).
const TURN_FRONT_DESK = ['turn_queue.read','turn_queue.join','turn_queue.assign'] as const;
const TURN_MANAGER = [...TURN_FRONT_DESK,'turn_queue.hold','turn_queue.reorder','turn_queue.manual_assign','turn_queue.auto_assign','turn_queue.adjust','turn_queue.history.read'] as const;
// BUILD_PLAN Phase 9: what every signed-in staff member may do for THEMSELVES (own profile, sessions, preferences, privacy
// export, closing their account) and the Help Center — granted to every staff role. Exported so a role template / custom
// role that narrows a base role can keep them (role-templates BASICS) instead of locking a person out of their own profile.
export const STAFF_SELF_SERVICE = ['self.profile.view','self.profile.edit','self.notifications','self.operations.view','help.view','help.request'] as const;

const SUPER_ADMIN_PERMS = PERMISSIONS.filter((p) => p.startsWith('super_admin.')) as Permission[];
const TECH_PERMS = PERMISSIONS.filter((p) => p.startsWith('tech.')) as Permission[];
// Copilot: front-line operational perms (view + per-action + feedback) vs. management perms (settings/learning/usage).
const COPILOT_OPS = PERMISSIONS.filter((p) => p.startsWith('reception_copilot.') && !['reception_copilot.manage_settings','reception_copilot.view_learning','reception_copilot.approve_learning','reception_copilot.view_usage'].includes(p)) as Permission[];
const COPILOT_MANAGE = ['reception_copilot.manage_settings','reception_copilot.view_learning','reception_copilot.approve_learning','reception_copilot.view_usage'] as Permission[];
// AI Booking: front-line ops (view/search/create/reschedule/cancel/confirm/view_sources) vs. management (overrides,
// partner links, conversion, settings, support mode).
const AI_BOOKING_OPS = ['ai_booking.view','ai_booking.search_availability','ai_booking.create','ai_booking.reschedule','ai_booking.cancel','ai_booking.confirm','ai_booking.view_sources'] as Permission[];
const AI_BOOKING_MANAGE = ['ai_booking.override_duplicate','ai_booking.override_conflict','ai_booking.use_alternate_branch','ai_booking.manage_partner_links','ai_booking.view_conversion','ai_booking.manage_settings','ai_booking.support_mode'] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...SUPER_ADMIN_PERMS],
  OWNER: PERMISSIONS.filter((p) => !p.startsWith('super_admin.')) as Permission[],
  MANAGER: [
    ...COMMUNITY_MANAGER,
    ...POS_VIEW, ...POS_MANAGE, 'checkout.manage_overrides', 'booking.override',
    'mobile_checkout.login','mobile_checkout.view_queue','mobile_checkout.open_ticket','mobile_checkout.add_product','mobile_checkout.tip','mobile_checkout.split_payment','mobile_checkout.tap_to_pay','mobile_checkout.send_receipt','mobile_checkout.view_history','mobile_checkout.view_reports','mobile_checkout.refund_request','mobile_checkout.void_request',
    'technicians.edit','services.edit','reports.view','reports.export','settings.view','ai.use','ai_business.view','ai_inventory.view','ai_inventory.manage_recipes','ai_analytics.view',
    // View-tier for the AI modules built in package B. The AI CENTER sidebar section is roles: MGMT (OWNER+MANAGER),
    // and the other eight AI modules already grant MANAGER `.view`; these three only ever granted OWNER (their perms
    // went into PERMISSIONS, which OWNER inherits, but MANAGER's list was never updated), so MANAGER saw the items
    // and 403'd. Read-tier only — the sensitive mutations (assign/override, investigate/escalate/resolve, delete/
    // view_raw/play_recording) remain owner-gated. Nav-visibility alignment is checked by tenant-nav.wiring.test.ts.
    'ai_checkout_upsell.view','ai_queue_assignment.view','ai_money_protection.view',
    // BUILD_PLAN Phase 6 (ai_queue_assignment role matrix): the manager runs the floor — accepts, overrides, locks,
    // resolves alerts, sets the rotation / thresholds / auto-assignment and exports. Only the OWNER (all keys) is above.
    ...AI_QUEUE_MANAGER,...AI_SCHED_MANAGER,...GOV_MANAGER,...TURN_MANAGER,...STAFF_SELF_SERVICE,'help.triage','ai_inventory.view_cost','ai_money_protection.view_alerts','ai_voice_transcription.view','ai_voice_transcription.view_transcripts',
    'marketing.view','marketing.manage','inventory.manage',
    'payroll.view','payroll.manage','audit.view',
    'payroll.issue_check', 'payroll.cash_handoff',   // Weekly Paycheck: pay out what the owner approved (checks, cash envelopes)
    'payroll.adjust',            // Payroll wave 2: manual adjustments / bonuses / deductions (audited; large ones wait for an owner's approval)
    'technicians.view_pay',      // Technician Profile merge Oct 12 2026: managers read commission / payroll figures; front desk and reception do not
    'tips.adjust',               // Payroll merge Oct 12 2026: a manager may re-split a ticket's tip (audited; posted tip_correction once paid)
    'checkout.approve_refund',   // Constitution 12 M9: managers may perform refunds past the approval limit; front desk may not
    'customers.export',          // Constitution 12 §323: managers may export the customer list; front desk, reception and technicians may not
    'customers.phone_manage',    // Phase 3: a manager approves, resolves, manually confirms and configures phone changes; reception does not
    ...COPILOT_OPS, ...COPILOT_MANAGE, ...AI_BOOKING_OPS, ...AI_BOOKING_MANAGE,
    ...TECH_PERMS,
    'owner.dashboard.view','owner.branches.view','owner.bookings.view','owner.staff.view','owner.staff.performance.view',
    'owner.finance.view','owner.reports.view','owner.alerts.view','owner.notifications.manage','owner.expenses.view',
    // mandate §77 / §82: a manager records, approves and exports expenses — of their own branch only (OwnerService branch scope)
    'owner.expenses.manage','owner.expenses.approve','owner.expenses.export',
    'reconciliation.view','reconciliation.manage',
    'locations.view','locations.create','locations.update','locations.map.update','locations.publish','locations.unpublish','locations.hours.manage','locations.booking.manage',
    'inventory.view','inventory.create','inventory.update','inventory.archive','inventory.stock.add','inventory.stock.adjust','inventory.stock.count','inventory.transfer','inventory.purchase_order.view','inventory.purchase_order.create','inventory.purchase_order.approve','inventory.purchase_order.receive','inventory.vendor.manage','inventory.category.manage','inventory.brand.manage','inventory.color.manage','inventory.reports.view','inventory.cost.view','inventory.value.view','inventory.technician_report.approve','inventory.barcode.manage',
  ],
  FRONT_DESK: [...POS_VIEW, ...POS_MANAGE, 'ai.use', ...COPILOT_OPS, ...AI_BOOKING_OPS, ...COMMUNITY_FRONT_DESK, ...AI_QUEUE_FRONT_DESK, ...AI_SCHED_FRONT_DESK, ...GOV_FRONT_DESK, ...STAFF_SELF_SERVICE, 'ai_inventory.view_cost', ...TURN_FRONT_DESK],
  RECEPTION: [...POS_VIEW, ...POS_MANAGE, 'ai.use', ...COPILOT_OPS, ...AI_BOOKING_OPS, ...COMMUNITY_FRONT_DESK, ...AI_QUEUE_FRONT_DESK, ...AI_SCHED_FRONT_DESK, ...GOV_FRONT_DESK, ...STAFF_SELF_SERVICE, 'ai_inventory.view_cost', ...TURN_FRONT_DESK],
  TECHNICIAN: ['pos.login','dashboard.view','global_search.use','inventory.view_limited','inventory.technician_report.submit','inventory.product_usage.submit','inventory.bottle.open','checkin.view','checkin.manage','booking.view','booking.manage','queue.view','serving.view','serving.manage','customers.view','services.view', ...TECH_PERMS, 'ai_scheduling.view_own',
    // Phase 8: the route key only — the community service still refuses a technician unless the salon granted view_community
    'community.feed.view', ...STAFF_SELF_SERVICE],
  CUSTOMER: ['booking.view','booking.manage'],
};

/** True if the role grants the permission. */
export function can(role: Role, perm: Permission): boolean {
  const list = ROLE_PERMISSIONS[role];
  return !!list && list.includes(perm);
}

/** Resolve the full permission set for a role (e.g. to embed in a token / login response). */
export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Only SUPER_ADMIN may touch /super-admin routes. */
export function isSuperAdmin(role: Role): boolean {
  return role === 'SUPER_ADMIN';
}

/** Tenant roles must never reach the super-admin portal, and vice-versa. */
export function canAccessSuperAdminPortal(role: Role): boolean {
  return role === 'SUPER_ADMIN';
}
export function canAccessTenantPos(role: Role): boolean {
  return role !== 'SUPER_ADMIN' && can(role, 'pos.login');
}

// ── Constitution 7 §5: platform roles as permission sets over the super_admin.* keys ─────────────────────────────────
import { PLATFORM_ROLE_GRANTS, PLATFORM_FALLBACK_ROLE, isPlatformRole, type PlatformRole } from './platform-roles';
/** The super_admin.* keys a platform role holds. Unknown / missing role → the read-only fallback, never everything. */
export function platformPermissionsFor(role: PlatformRole | string | null | undefined): Permission[] {
  const r: PlatformRole = isPlatformRole(role) ? role : PLATFORM_FALLBACK_ROLE;
  const grant = PLATFORM_ROLE_GRANTS[r];
  return SUPER_ADMIN_PERMS.filter((k) => grant(k));
}
