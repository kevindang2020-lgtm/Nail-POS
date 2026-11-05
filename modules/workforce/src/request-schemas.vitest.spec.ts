// BUILD_PLAN Phase 12 (#17): team-permissions body validation, route by route on the real controller (pos-web posAccessApi bodies).
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { TeamAccessController as A } from './team-permissions/access.controller';

const U = '66666666-6666-4666-8666-666666666666';
const CASES: RouteBodyCase[] = [
  { route: 'PUT /pos/access/members/:id/role', ctl: A, handler: 'assignRole', today: [{ templateKey: 'front_desk', reason: 'promoted' }, { templateKey: null, reason: 'reset' }], bad: [{ templateKey: ['x'], reason: 'r' }, 'templateKey'] },
  { route: 'PUT /pos/access/members/:id/branches', ctl: A, handler: 'setBranches', today: [{ branchIds: [U], accessLevel: 'staff', reason: 'covers Cherry Hill' }], bad: [{ branchIds: U, reason: 'r' }, 'branchIds'] },
  { route: 'POST /pos/access/members/:id/overrides', ctl: A, handler: 'grantOverride', today: [{ permission: 'pos.reports.view', effect: 'ALLOW', reason: 'month end', expiresAt: '2026-10-31T23:59:59.000Z' }, { permission: 'pos.checkout.refund', effect: 'DENY', scopeBranchId: U, reason: 'training', expiresAt: null }], bad: [{ permission: { all: true }, effect: 'ALLOW', reason: 'r' }, 'permission'] },
  { route: 'POST /pos/access/overrides/:id/revoke', ctl: A, handler: 'revokeOverride', today: [{ reason: 'no longer needed' }], bad: [{ reason: 7 }, 'reason'] },
  { route: 'POST /pos/access/preview', ctl: A, handler: 'preview', today: [{ userId: U, templateKey: 'manager' }, { customRole: { baseRole: 'MANAGER', scope: 'BRANCH', permissions: ['pos.queue.view'] }, overrides: [{ permission: 'pos.reports.view', effect: 'ALLOW', reason: 'x' }] }], bad: [{ overrides: 'all' }, 'overrides'] },
  { route: 'POST /pos/access/ownership/transfer', ctl: A, handler: 'transfer', today: [{ toUserId: U, reason: 'selling the salon', keepPreviousOwnerAs: 'manager' }, { toUserId: U, reason: 'co-owner', keepPreviousOwnerAs: null }], bad: [{ toUserId: [U], reason: 'r' }, 'toUserId'] },
];
describe('workforce team-permissions — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});

// ── round 2: every other workforce route (bodies copied from the client calls named in request-schemas.ts) ─────────
import { TechniciansController as T } from './technicians/technicians.controller';
import { CompensationController as Co } from './compensation/compensation.controller';
import { CustomerTechController as CT } from './tech-profile/customer-tech.controller';
import { PosTechProfileController as PT } from './tech-profile/pos-tech-profile.controller';
import { TechProfileController as TP } from './tech-profile/tech-profile.controller';
import { TechProfileSuperAdminController as TS } from './tech-profile/tech-profile.super-admin.controller';
import { TechWorkplacesController as TW } from './tech-profile/tech-workplaces.controller';
import { NailShowcaseSocialController as NSo } from './nail-showcase/nail-showcase-social.controller';
import { NailShowcaseCustomerController as NC } from './nail-showcase/nail-showcase.controller';
import { NailShowcasePosController as NP } from './nail-showcase/nail-showcase.pos.controller';
import { NailShowcaseSuperAdminController as NS } from './nail-showcase/nail-showcase.super-admin.controller';
import { PosApprovalsController as PA, OwnerApprovalsController as OA } from './approvals/approvals.controller';
import { AccessGovernanceController as AG } from './access-governance/access-governance.controller';
import { PayrollController as PR } from './payroll/payroll.controller';
import { TimeClockController as TC } from './time-clock/time-clock.controller';
import { TechnicianClockManagementController as CM } from './technician-clock-pin/technician-clock-management.controller';
import { TechCashHandoffPosController as CHP } from './tech-cash-handoff/tech-cash-handoff.pos.controller';
import { TechCashHandoffTechController as CHT } from './tech-cash-handoff/tech-cash-handoff.tech.controller';

const day = { isWorking: true, startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchEnd: '12:30' };
const ver = { commissionType: 'percent', commissionValue: 60, effectiveStart: '2026-11-01' };
const R2: RouteBodyCase[] = [
  { route: 'POST /pos/technicians/lookup', ctl: T, handler: 'lookup', today: [{ phone: '6095551234' }, { email: 'mai@x.co' }], bad: [{ phone: 6095551234 }, 'phone'] },
  { route: 'POST /pos/technicians', ctl: T, handler: 'create', today: [{ firstName: 'Mai', lastName: 'Tran', status: 'active', phone: '6095551234', email: 'mai@x.co' }, { firstName: 'Lan', lastName: 'Vo', status: 'active' }], bad: [{ firstName: ['Mai'], lastName: 'Tran' }, 'firstName'] },
  { route: 'POST /pos/technicians/:technicianId/suspend', ctl: T, handler: 'suspend', today: [{ reason: 'no-show twice' }, { status: 'suspended', reason: 'x', managerPin: '1234' }], bad: [{ reason: { r: 1 } }, 'reason'] },
  { route: 'PATCH /pos/technicians/salon-commission', ctl: T, handler: 'setSalonComm', today: [{ defaultCommissionPercent: 55, adminAuthCode: '123456' }], bad: [{ defaultCommissionPercent: '55' }, 'defaultCommissionPercent'] },
  { route: 'PATCH /pos/technicians/:technicianId/schedule', ctl: T, handler: 'sSchedule', today: [{ weekly: { monday: day, tuesday: { ...day, shifts: [{ startTime: '09:00', endTime: '13:00' }], breaks: [{ startTime: '11:00', endTime: '11:15', type: 'paid' }] } }, expectedVersion: 3 }], bad: [{ weekly: { monday: { isWorking: 'yes' } } }, 'weekly.monday.isWorking'] },
  { route: 'PATCH /pos/technicians/:technicianId/shifts', ctl: T, handler: 'sShift', today: [{ shiftStatus: 'on_shift' }, { shiftStatus: 'off_shift', onBreak: false }], bad: [{ shiftStatus: 1 }, 'shiftStatus'] },
  { route: 'PATCH /pos/technicians/:technicianId/skills', ctl: T, handler: 'sSkills', today: [{ skillGroups: ['acrylic', 'gel'] }], bad: [{ skillGroups: 'gel' }, 'skillGroups'] },
  { route: 'PATCH /pos/technicians/:technicianId/services', ctl: T, handler: 'sServices', today: [{ serviceIds: [U] }, { serviceIds: [] }], bad: [{}, 'serviceIds'] },
  { route: 'PATCH /pos/technicians/:technicianId/commission', ctl: T, handler: 'sComm', today: [{ defaultPercent: 60, adminAuthCode: '123456' }], bad: [{ defaultPercent: 'sixty' }, 'defaultPercent'] },
  { route: 'PATCH /pos/technicians/:technicianId/app-access', ctl: T, handler: 'sApp', today: [{ enabled: true, loginEmail: 'mai@x.co', pinEnabled: true, allowedBranches: [], allowedSections: ['queue', 'earnings'], canAcceptTicket: true, canStartService: true, canMarkDone: true, canRequestBreak: true, canViewEarnings: true, canEditNotes: false, canProcessPayment: false }], bad: [{ enabled: 'on' }, 'enabled'] },
  { route: 'PATCH /pos/technicians/:technicianId/permissions', ctl: T, handler: 'sPerms', today: [{ matrix: [{ permission: 'tech.queue.accept', allowed: true }] }], bad: [{ matrix: [{ permission: 'x', allowed: 'yes' }] }, 'matrix[0].allowed'] },
  { route: 'PATCH /pos/technicians/:technicianId', ctl: T, handler: 'update', today: [{ fullName: 'Mai Tran', status: 'active', phone: '6095551234', email: 'mai@x.co', commissionSplitPercent: 60 }, { fullName: 'Mai Tran', status: 'active' }], bad: [{ commissionSplitPercent: '60%' }, 'commissionSplitPercent'] },
  { route: 'POST /owner/compensation/agreements', ctl: Co, handler: 'agreementCreate', today: [{ technicianId: U, title: '60/40 split', terms: { split: 60 }, effectiveStart: '2026-11-01' }], bad: [{ technicianId: U, title: 'x', terms: 'sixty' }, 'terms'] },
  { route: 'POST /owner/compensation/compliance-preview', ctl: Co, handler: 'compliancePreview', today: [{ technicianId: U, periodPayCents: 120000, hoursWorked: 80 }], bad: [{ technicianId: U, hoursWorked: [80] }, 'hoursWorked'] },
  { route: 'POST /owner/compensation/compliance-period-review', ctl: Co, handler: 'compliancePeriodReview', today: [{ periodId: U }], bad: [{ periodId: 5 }, 'periodId'] },
  { route: 'POST /owner/compensation/bonus-rules', ctl: Co, handler: 'bonusRulesCreate', today: [{ metric: 'service_sales', target: 500000, amountCents: 10000, label: 'Hit $5k' }, { metric: 'retail_sales', target: 100, amountCents: 500, technicianId: U }], bad: [{ metric: 'x', target: {} }, 'target'] },
  { route: 'POST /owner/compensation/bonus-rules/preview', ctl: Co, handler: 'bonusRulesPreview', today: [{ technicianId: U, fromIso: '2026-10-01T00:00:00.000Z', toIso: '2026-10-15T00:00:00.000Z' }], bad: [{ technicianId: [U] }, 'technicianId'] },
  { route: 'POST /owner/compensation/bonus-rules/period-review', ctl: Co, handler: 'bonusRulesPeriodReview', today: [{ periodId: U }], bad: [{ periodId: {} }, 'periodId'] },
  { route: 'POST /owner/compensation/bonus-rules/approve', ctl: Co, handler: 'bonusApprove', today: [{ technicianId: U, periodId: U, amountCents: 10000, label: 'Bonus' }], bad: [{ technicianId: U, amountCents: 1, status: 'approved' }, 'status'] },
  { route: 'POST /owner/compensation/preview', ctl: Co, handler: 'preview', today: [{ ticketId: 't-1', branchId: null, serviceLines: [{ lineId: 'l1', priceCents: 4500 }], tip: { tipCents: 500 } }], bad: [{ serviceLines: 'l1' }, 'serviceLines'] },
  { route: 'POST /owner/compensation/supply/preview', ctl: Co, handler: 'supplyPreview', today: [{ config: { method: 'fixed', value: 200 }, priceCents: 4500 }], bad: [{ config: 'fixed' }, 'config'] },
  { route: 'POST /owner/compensation/guarantee/preview', ctl: Co, handler: 'guaranteePreview', today: [{ policy: { dailyMinimumCents: 10000 }, facts: { daysWorked: 5 }, earnings: { commissionCents: 30000 } }], bad: [{ policy: [] }, 'policy'] },
  { route: 'POST /owner/compensation/validate', ctl: Co, handler: 'validate', today: [{ rule: { technicianPercent: 60 } }, { rule: { technicianPercent: 60 }, supply: { method: 'none' } }], bad: [{ rule: 60 }, 'rule'] },
  { route: 'POST /owner/compensation/rules', ctl: Co, handler: 'rulesCreate', today: [{ scope: { technicianId: U }, label: 'Mai 60/40', version: ver }], bad: [{ version: { ...ver, commissionValue: '60' } }, 'version.commissionValue'] },
  { route: 'POST /owner/compensation/rules/seed-default', ctl: Co, handler: 'seedDefault', today: [{ technicianPercent: 60 }], bad: [{ technicianPercent: '60' }, 'technicianPercent'] },
  { route: 'POST /owner/compensation/rules/:id/versions', ctl: Co, handler: 'ruleAddVersion', today: [{ version: ver }, ver], bad: [{ version: { ...ver, effectiveStart: 20261101 } }, 'version.effectiveStart'] },
  { route: 'POST /owner/compensation/tier-plans', ctl: Co, handler: 'tierPlansCreate', today: [{ technicianId: U, mode: 'marginal', bands: [{ fromCents: 0, toCents: 100000, percent: 50 }, { fromCents: 100000, toCents: null, percent: 60 }] }], bad: [{ technicianId: U, mode: 'entire', bands: 'all' }, 'bands'] },
  { route: 'POST /owner/compensation/tier-plans/preview', ctl: Co, handler: 'tierPlansPreview', today: [{ productionCents: 250000, bands: [{ fromCents: 0, toCents: null, percent: 55 }] }], bad: [{ productionCents: [1] }, 'productionCents'] },
  { route: 'PUT /owner/compensation/classifications/:technicianId', ctl: Co, handler: 'classificationSet', today: [{ classification: 'employee' }], bad: [{ classification: 1 }, 'classification'] },
  { route: 'PUT /owner/compensation/wage-config', ctl: Co, handler: 'wageConfigSet', today: [{ minHourlyWageCents: 1530, overtimeThresholdHours: 40 }], bad: [{ minHourlyWageCents: {} }, 'minHourlyWageCents'] },
  { route: 'PUT /owner/compensation/retail-policy', ctl: Co, handler: 'retailPolicySet', today: [{ method: 'percent', value: 10 }], bad: [{ method: ['percent'] }, 'method'] },
  { route: 'PUT /owner/compensation/tip-policy', ctl: Co, handler: 'tipPolicySet', today: [{ manyTechTipMethod: 'proportional' }], bad: [{ manyTechTipMethod: true }, 'manyTechTipMethod'] },
  { route: 'POST /customer/tech-favorites', ctl: CT, handler: 'addFavorite', today: [{ publicSlug: 'mai-tran' }, { technicianId: U }], bad: [{ publicSlug: 7 }, 'publicSlug'] },
  { route: 'POST /customer/techs/:publicSlug/event', ctl: CT, handler: 'trackEvent', today: [{ type: 'link_click', ref: 'instagram' }, { type: 'post_tap' }], bad: [{ type: {} }, 'type'] },
  { route: 'POST /customer/messages/:threadId', ctl: CT, handler: 'dmSend', today: [{ body: 'Hi! Are you free Saturday?' }], bad: [{ body: 'x'.repeat(4001) }, 'body'] },
  { route: 'POST /customer/messages/:threadId/report', ctl: CT, handler: 'dmReport', today: [{ reason: 'spam' }, {}], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /customer/tickets/:ticketId/technician-ratings', ctl: CT, handler: 'rate', today: [{ technicianId: U, rating: 5, reviewText: 'Perfect', tags: ['friendly'], isPublic: true }], bad: [{ technicianId: U, rating: 5, tags: 'friendly' }, 'tags'] },
  { route: 'PATCH /customer/tickets/:ticketId/technician-ratings/:ratingId', ctl: CT, handler: 'updateRating', today: [{ rating: 4, reviewText: 'Good' }], bad: [{ isPublic: 'yes' }, 'isPublic'] },
  { route: 'PATCH /pos/technicians/:technicianId/profile', ctl: PT, handler: 'updateProfile', today: [{ displayName: 'Mai', title: 'Master Nail Artist', bio: 'Gel-X' }], bad: [{ specialties: 'gel' }, 'specialties'] },
  { route: 'PATCH /pos/technicians/:technicianId/feature', ctl: PT, handler: 'feature', today: [{ featured: true }], bad: [{ featured: 'true' }, 'featured'] },
  { route: 'PATCH /pos/technicians/:technicianId/ratings/:ratingId/hide', ctl: PT, handler: 'hideRating', today: [{ hidden: true, reason: 'abusive' }, { hidden: false }], bad: [{ hidden: 1 }, 'hidden'] },
  { route: 'POST /tech/profile/membership-request', ctl: TP, handler: 'request', today: [{ salonCode: 'SALON-42', message: 'Hi' }, { salonCode: 'SALON-42' }], bad: [{ salonCode: ['x'] }, 'salonCode'] },
  { route: 'POST /tech/profile/ratings/:reviewId/respond', ctl: TP, handler: 'respond', today: [{ response: 'Thank you!' }], bad: [{ response: {} }, 'response'] },
  { route: 'POST /tech/profile/messages/:threadId', ctl: TP, handler: 'dmSend', today: [{ body: 'Yes, 2pm works' }], bad: [{ body: 5 }, 'body'] },
  { route: 'POST /tech/profile/messages/:threadId/report', ctl: TP, handler: 'dmReport', today: [{ reason: 'harassment' }], bad: [{ reason: [] }, 'reason'] },
  { route: 'POST /tech/profile/photos', ctl: TP, handler: 'addPhotos', today: [{ caption: 'Chrome french' }, {}], bad: [{ caption: 'x'.repeat(501) }, 'caption'] },
  { route: 'POST /tech/profile/photos/:photoId/consent', ctl: TP, handler: 'setConsent', today: [{ approvedUses: ['portfolio', 'social'], customerId: U, ticketId: U, consentVersion: 'v1' }], bad: [{ approvedUses: 'portfolio' }, 'approvedUses'] },
  { route: 'POST /tech/profile/before-after', ctl: TP, handler: 'createBeforeAfter', today: [{ servicePerformed: 'Gel-X', designNotes: 'ombre', durationMinutes: '75', customerConsent: 'true' }], bad: [{ durationMinutes: {} }, 'durationMinutes'] },
  { route: 'PATCH /tech/profile', ctl: TP, handler: 'update', today: [{ displayName: 'Mai', bio: 'Gel-X specialist', specialties: ['gel'], profileLinks: { instagram: 'https://instagram.com/mai' }, isPublic: true }], bad: [{ isPublic: 'yes' }, 'isPublic'] },
  { route: 'PATCH /tech/profile/photos/reorder', ctl: TP, handler: 'reorder', today: [{ photoIds: [U, U] }], bad: [{ photoIds: U }, 'photoIds'] },
  { route: 'PATCH /tech/profile/photos/:photoId', ctl: TP, handler: 'updatePhoto', today: [{ caption: 'Chrome', tags: ['chrome'], nailShape: 'almond', isPublic: true }], bad: [{ tags: 'chrome' }, 'tags'] },
  { route: 'PATCH /tech/profile/before-after/:setId', ctl: TP, handler: 'updateBeforeAfter', today: [{ isPublic: true, customerConsent: true }, { designNotes: 'ombre', durationMinutes: 60 }], bad: [{ isPublic: 'yes' }, 'isPublic'] },
  { route: 'PATCH /super-admin/tech-profiles/verifications/:profileId', ctl: TS, handler: 'setVerification', today: [{ status: 'verified', note: 'license checked' }], bad: [{ status: 1 }, 'status'] },
  { route: 'PATCH /super-admin/tech-profiles/dm-reports/:reportId', ctl: TS, handler: 'resolveDmReport', today: [{ action: 'dismiss' }], bad: [{ action: [] }, 'action'] },
  { route: 'POST /tech/context/switch', ctl: TW, handler: 'switchSalon', today: [{ salonId: U }], bad: [{ salonId: { id: U } }, 'salonId'] },
  { route: 'PATCH /customer/social/me/profile', ctl: NSo, handler: 'updateMyProfile', today: [{ publicDisplayName: 'Linh', bio: 'nails', profileVisibility: 'public', showRankOnProfile: true, showPostsOnProfile: true, allowFollowers: true }], bad: [{ allowFollowers: 'yes' }, 'allowFollowers'] },
  { route: 'POST /customer/social/me/avatar', ctl: NSo, handler: 'avatar', today: [{}, { avatarUrl: '/media/a.png' }], bad: [{ avatarUrl: 5 }, 'avatarUrl'] },
  { route: 'POST /customer/social/profile/:customerId/report', ctl: NSo, handler: 'report', today: [{ reason: 'spam', details: 'bot' }, { reason: 'other' }], bad: [{ reason: {} }, 'reason'] },
  { route: 'POST /customer/nail-showcase/posts', ctl: NC, handler: 'createPost', today: [{ caption: 'New set!', tags: ['gel'], visibility: 'public', allowComments: true, technicianId: U }], bad: [{ caption: 'x', photos: 'a.png' }, 'photos'] },
  { route: 'PATCH /customer/nail-showcase/posts/:postId', ctl: NC, handler: 'updatePost', today: [{ caption: 'edit', visibility: 'followers' }], bad: [{ allowComments: 'no' }, 'allowComments'] },
  { route: 'POST /customer/nail-showcase/posts/:postId/photos', ctl: NC, handler: 'addPhotos', today: [{}, { caption: 'side view' }, { photos: [{ imageUrl: '/media/x.jpg' }] }], bad: [{ photos: [{ imageUrl: 5 }] }, 'photos[0].imageUrl'] },
  { route: 'POST /customer/nail-showcase/posts/:postId/reaction', ctl: NC, handler: 'react', today: [{ reactionType: 'like' }], bad: [{ reactionType: 1 }, 'reactionType'] },
  { route: 'POST /customer/nail-showcase/posts/:postId/comments', ctl: NC, handler: 'addComment', today: [{ commentText: 'Gorgeous' }], bad: [{ commentText: ['x'] }, 'commentText'] },
  { route: 'POST /customer/nail-showcase/posts/:postId/report', ctl: NC, handler: 'reportPost', today: [{ reason: 'inappropriate', details: 'x' }, { reason: 'spam' }], bad: [{ reason: 3 }, 'reason'] },
  { route: 'POST /customer/nail-showcase/comments/:commentId/report', ctl: NC, handler: 'reportComment', today: [{ reason: 'spam' }], bad: [{ details: {} }, 'details'] },
  { route: 'POST /customer/tickets/:ticketId/nail-showcase-post', ctl: NC, handler: 'verifiedPost', today: [{ caption: 'Love it', visibility: 'public', isAnonymous: false }], bad: [{ isAnonymous: 'no' }, 'isAnonymous'] },
  { route: 'PATCH /pos/nail-showcase/reports/:reportId', ctl: NP, handler: 'resolve', today: [{ status: 'reviewed' }], bad: [{ status: 1 }, 'status'] },
  { route: 'PATCH /super-admin/nail-showcase/reports/:reportId', ctl: NS, handler: 'resolve', today: [{ status: 'action_taken' }], bad: [{ status: [] }, 'status'] },
  { route: 'POST /pos/approvals', ctl: PA, handler: 'create', today: [{ kind: 'refund', subjectType: 'payment', subjectId: U, amountCents: 12000, reason: 'customer unhappy', payload: { ticketId: U } }], bad: [{ kind: 'refund', subjectType: 'payment', reason: 'x', status: 'approved' }, 'status'] },
  { route: 'POST /pos/approvals/:id/decide', ctl: PA, handler: 'decide', today: [{ decision: 'approve', expectedVersion: 1 }, { decision: 'reject', note: 'not eligible', expectedVersion: 2 }], bad: [{ decision: 'approve', expectedVersion: {} }, 'expectedVersion'] },
  { route: 'POST /pos/approvals/:id/cancel', ctl: PA, handler: 'cancel', today: [{ reason: 'customer left' }], bad: [{ reason: 1 }, 'reason'] },
  { route: 'PUT /pos/approvals/policies', ctl: PA, handler: 'updatePolicy', today: [{ kind: 'refund', expectedVersion: 1, reason: 'raise the limit for busy weekends', thresholdCents: 20000, cashThresholdCents: 10000, requireDifferentApprover: true, expiresAfterHours: 24 }], bad: [{ kind: 'refund', thresholdCents: [1] }, 'thresholdCents'] },
  { route: 'POST /owner/approvals/requests/:id/decide', ctl: OA, handler: 'decide', today: [{ decision: 'approve', note: 'ok', expectedVersion: 1 }], bad: [{ decision: 'approve', expectedVersion: 1, decidedByUserId: U }, 'decidedByUserId'] },
  { route: 'POST /pos/security/access-reviews', ctl: AG, handler: 'start', today: [{}, { dueAt: '2026-11-01T00:00:00.000Z' }], bad: [{ dueAt: 20261101 }, 'dueAt'] },
  { route: 'POST /pos/security/access-reviews/:id/decisions', ctl: AG, handler: 'decide', today: [{ userId: U, decision: 'keep' }, { userId: U, decision: 'change', templateKey: 'front_desk', note: 'moved' }], bad: [{ userId: U, decision: ['keep'] }, 'decision'] },
  { route: 'POST /pos/payroll/periods', ctl: PR, handler: 'create', today: [{ label: 'Oct 1-15', periodStart: '2026-10-01', periodEnd: '2026-10-15' }], bad: [{ periodStart: '2026-10-01', status: 'paid' }, 'status'] },
  { route: 'POST /pos/time-clock/clock-in', ctl: TC, handler: 'clockIn', today: [{ technicianId: U }], bad: [{ technicianId: {} }, 'technicianId'] },
  { route: 'POST /pos/time-clock/clock-out', ctl: TC, handler: 'clockOut', today: [{ technicianId: U }], bad: [{ technicianId: [] }, 'technicianId'] },
  { route: 'POST /pos/technician-clock/technicians/:technicianId/clock-pin/reset', ctl: CM, handler: 'resetPin', today: [{ pin: '4821' }], bad: [{ pin: ['4821'] }, 'pin'] },
  { route: 'POST /pos/technician-clock/timecards/:shiftId/adjust', ctl: CM, handler: 'adjust', today: [{ startTime: '2026-10-08T09:00:00.000Z', endTime: '2026-10-08T17:00:00.000Z', reason: 'forgot to clock out' }], bad: [{ reason: { r: 1 } }, 'reason'] },
  { route: 'POST /pos/cash-handoffs/:technicianId/reconcile', ctl: CHP, handler: 'reconcile', today: [{ countedCents: 41250 }, { countedCents: 41250, notes: 'short a five', date: '2026-10-08' }], bad: [{ countedCents: 1, status: 'reconciled' }, 'status'] },
  { route: 'POST /tech/cash-handoff/submit', ctl: CHT, handler: 'submit', today: [{}, { date: '2026-10-08' }], bad: [{ date: 20261008 }, 'date'] },
];
describe('workforce — validated bodies, route by route (round 2)', () => {
  for (const c of R2) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
