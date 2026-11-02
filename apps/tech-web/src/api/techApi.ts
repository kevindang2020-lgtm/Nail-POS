// techApi.ts — Technician app client for the real @Controller('tech') routes. Same-origin, session cookie; the server
// derives the technician from the session (no ids sent from the client). Reads return server-truth; payment/earnings
// values are whatever the backend computes (no fabrication).
import { mobile } from '../lib/mobile';   // Phase 13 D: push permission after the first meaningful action
import type { TechAssignmentSignals, TechAssignSource, RequestableService, SkillChangeRequest, SkillChangeStatus, SkillChangeType, TechAvailableActions, TechClockView, TechCurrentService, TechDashboardState, TechEarningsDetail, TechEarningsLine, TechEarningsSnapshot, TechMe, TechMoreState, TechNextAppointment, TechPayrollPeriod, TechQueueCustomer, TechQueueEntry, TechQueueState, TechScheduleItem, TechSkillService, TechSkillsView, TechTicketListItem, TechTicketServiceLine, TechTodayOverview, TechWorkingHoursDay, TechSharedVisit } from '@aipowersalon/api-contracts/tenant';
export type { TechAssignmentSignals, TechAssignSource, RequestableService, SkillChangeRequest, SkillChangeStatus, SkillChangeType, TechAvailableActions, TechClockView, TechCurrentService, TechDashboardState, TechEarningsDetail, TechEarningsLine, TechEarningsSnapshot, TechMe, TechMoreState, TechNextAppointment, TechPayrollPeriod, TechQueueCustomer, TechQueueEntry, TechQueueState, TechScheduleItem, TechSkillService, TechSkillsView, TechTicketListItem, TechTicketServiceLine, TechTodayOverview, TechWorkingHoursDay, TechSharedVisit };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import type { TechTimeClockView, TechPerformanceView, TechTipsView, TechCustomerRow, TechCertificationView, TechCertificationBody, TechCertificationDeleted, TimeOffEntry, TimeOffKind, TimeOffRequestBody, TimeOffWithdrawResult } from '@aipowersalon/api-contracts/tenant';
export type { TechTimeClockView, TechPerformanceView, TechTipsView, TechCustomerRow, TechCertificationView, TechCertificationBody, TimeOffEntry, TimeOffKind };
import type { TechPayout, TechPayrollInquiry, TechPayStatements, TechPayStatementDetail, PaycheckPayout } from '@aipowersalon/api-contracts/tenant';
import type { TechTurnQueueView, TurnPeriodSummary } from '@aipowersalon/api-contracts/tenant';
import type { PendingProfileChangeWithdrawResult, PortfolioShowcaseShareResult, PortfolioShowcaseUnshareResult } from '@aipowersalon/api-contracts/tenant';   // §46/§95 wire types
import { api } from './client';

export interface TechCanonicalEarnings {
  serviceCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number;
  retailCommissionCents: number; bonusCents: number | null; guaranteeTopUpCents: number | null; adjustmentsCents: number | null;
  estimatedEarningsCents: number; status: string; tickets: number; dateFrom: string; dateTo: string;
  // ONE source (merge Oct 12): the per-line detail comes back with the summary — same snapshot store, same tenant-zone window
  period?: string; timezone?: string; clamped?: boolean; payPeriodId?: string; lines?: TechEarningsLine[];
}
export interface TechHelpRequest { id: string; ticketId: string; serviceLineId: string; serviceId: string | null; primaryTechnicianId: string; helperTechnicianId: string; reason: string; note: string | null; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; respondedAt: string | null; declineReason: string | null; createdAt: string }
export interface TechQualifiedHelper { technicianId: string; displayName: string; workingStatus: string; shiftStatus: string; status: string }

// BUILD_PLAN Phase 6: the ticket carries the queue's assign source / lock / lockedToYou (the contract's TechAssignmentSignals)
export interface TechTicketDetail extends TechAssignmentSignals {
  ticketId: string; technicianId: string | null; status: string; ticketNumber?: string;
  customerName?: string | null; customerPhoneMasked?: string | null;
  services?: TechTicketServiceLine[]; notes?: string | null; totalCents?: number; durationMinutes?: number;
  scheduledStart?: string | null; scheduledEnd?: string | null; acceptedAt?: string | null; startedAt?: string | null; completedAt?: string | null; acceptanceDeadline?: string | null; version?: number;
  // Optional rich fields the reference shows — rendered only when the backend supplies them (never invented):
  vip?: boolean; loyaltyTier?: string | null; allergies?: string[] | null; safetyNotes?: string | null;
  assignmentReason?: string | null; requestedTechnician?: string | null; inspoUrl?: string | null;
  // multi-technician routing: this ticket is ONE technician's part of a shared visit (null / absent = the whole visit)
  sharedVisit?: TechSharedVisit | null;
}
// Live-edit options for a ticket (serving.techEditOptions). Typed so the Edit-Ticket modal's reads are compiler-checked.
export interface TechEditService { serviceId: string; name: string; categoryName: string; priceCents: number; durationMinutes: number; isAddOn: boolean }
export interface TechPendingChangeRequest { id: string; requestType: string; oldValue?: { serviceName?: string | null } | null; newValue?: { serviceName?: string | null } | null; status?: string }
export interface TechEditOptions {
  editable: boolean; lockedReason: string | null; ticketStatus: string;
  can: { addService: boolean; changeService: boolean; removeLine: boolean };
  approvalRequiredFor: string[]; categories: string[];
  services: TechEditService[]; pendingChangeRequests: TechPendingChangeRequest[];
}
// Owner's own public-page preview (myPublicPreview) — buildPublicProfilePayload + a live flag. Screen reads portfolio/reviewCount/live.
export interface TechPreviewPhoto { photoId: string; imageUrl: string; thumbnailUrl: string | null; caption: string | null; tags: string[]; serviceCategory: string | null; isFeatured: boolean }
export interface TechPublicPreview { portfolio: TechPreviewPhoto[]; reviewCount: number; isLivePublicly: boolean }

const id = (s: string) => encodeURIComponent(s);

export interface TechMemberBenefit { benefitId: string; label: string; benefitType: string; serviceId: string | null; serviceCreditsAvailable: number; dollarCreditsAvailableCents: number }
export interface TechMembershipView {
  hasMembership: boolean;
  membership: { membershipId: string; planName: string | null; status: string; memberNumber: string | null; nextBillingAt: string | null; startedAt: string | null } | null;
  benefits: TechMemberBenefit[];
}
export interface TechCashPendingItem { confirmationId: string; ticketId: string; paymentIntentId: string | null; amountCents: number; customerName: string; ticketNumber: string; services: { serviceLineId: string; serviceName: string; priceCents: number; technicianId?: string | null }[]; }

export interface TechCashHandoffLine { ticketId: string; ticketNumber: string; customerName: string; amountCents: number; confirmedAt: string | null; }
export interface TechCashHandoff { technicianId: string; technicianName: string; businessDate: string; expectedCents: number; paymentCount: number; countedCents: number | null; varianceCents: number | null; status: 'open' | 'submitted' | 'reconciled' | 'discrepancy' | 'cancelled'; submittedAt: string | null; reconciledAt: string | null; notes: string | null; lines: TechCashHandoffLine[]; }

export interface TechPayroll { paidCents: number; unpaidCents: number; totalCents: number; periods: TechPayrollPeriod[] }
export type { TechPayout, TechPayrollInquiry, TechPayStatements, TechPayStatementDetail, PaycheckPayout } from '@aipowersalon/api-contracts/tenant';

export const techApi = {
  serviceHistory: (service?: string) => api.get<{ items: { ticketId: string; serviceName: string; customerName: string; completedAt: string | null; rating: number | null; lineTotalCents: number }[]; services: string[] }>(`/tech/service-history${service ? `?service=${encodeURIComponent(service)}` : ''}`),
  payroll: () => api.get<TechPayroll>('/tech/payroll'),
  // Fair Turn §94–96: my place in the salon's turn rotation (only what the salon's visibility setting allows) + my summary
  turnQueue: () => api.get<TechTurnQueueView>('/tech/turn-queue'),
  turnSummary: (period: 'day' | 'week' | 'month' = 'day') => api.get<TurnPeriodSummary & { technicianId: string; name: string }>(`/tech/turn-queue/summary?period=${period}`),
  // Payroll wave 2 (§89 payout history, §152 questions): the technician's OWN rows (the server derives who from the session)
  payrollPayouts: () => api.get<TechPayout[]>('/tech/payroll/payouts'),
  payrollInquiries: () => api.get<TechPayrollInquiry[]>('/tech/payroll/inquiries'),
  askAboutPayroll: (body: { message: string; periodId?: string; subjectType?: string }) => api.post<TechPayrollInquiry>('/tech/payroll/inquiries', body as Record<string, unknown>),
  // Weekly Paycheck (Oct 21 2026, §15): my pay statements (estimated until the owner approves) and the cash handed to me
  payStatements: () => api.get<TechPayStatements>('/tech/payroll/statements'),
  payStatement: (statementId: string) => api.get<TechPayStatementDetail>(`/tech/payroll/statements/${encodeURIComponent(statementId)}`),
  /** 17.5 (Oct 27 2026): an approved week's pay stub — the PDF built from the locked statement, in the app's language */
  payStub: (statementId: string, lang: string) => api.exportAsync<Blob>(`/tech/payroll/statements/${encodeURIComponent(statementId)}/pay-stub.pdf`, { lang }, 'blob'),
  // Weekly Paycheck §11.5 (Oct 27 2026): with the manager's QR handoff code when scanned / typed (optional)
  acknowledgeCash: (payoutId: string, handoffCode?: string | null) => api.post<PaycheckPayout>(`/tech/payroll/cash-payouts/${encodeURIComponent(payoutId)}/acknowledge`, handoffCode ? { handoffCode } : {}),
  disputeCash: (payoutId: string, reason: string) => api.post<PaycheckPayout>(`/tech/payroll/cash-payouts/${encodeURIComponent(payoutId)}/dispute`, { reason }),
  dashboard: () => api.get<TechDashboardState>('/tech'),
  earnings: () => api.get<TechEarningsSnapshot>('/tech/earnings'),
  schedule: (date?: string) => api.get<TechScheduleItem[]>(`/tech/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  earningsCanonical: (period: string = 'day', date?: string, dateTo?: string, payPeriodId?: string) => api.get<TechCanonicalEarnings>(`/tech/earnings/canonical?period=${period}${date ? `&date=${encodeURIComponent(date)}` : ''}${dateTo ? `&dateTo=${encodeURIComponent(dateTo)}` : ''}${payPeriodId ? `&payPeriodId=${encodeURIComponent(payPeriodId)}` : ''}`),
  tickets: () => api.get<TechTicketListItem[]>('/tech/tickets'),
  ticket: (tid: string) => api.get<TechTicketDetail>(`/tech/tickets/${id(tid)}`),
  ticketMembership: (tid: string) => api.get<TechMembershipView>(`/tech/tickets/${id(tid)}/membership`),
  // Phase 13 D (C6 §58): accepting a ticket is the technician's first meaningful action — the one moment the app may ask for push permission
  accept: (tid: string, expectedVersion?: number) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/accept`, typeof expectedVersion === 'number' ? { expectedVersion } : {}).then((r) => { void mobile.push.noteMeaningfulAction(); return r; }),
  /** reasonCode (Fair Turn §64–66): a safety / eligibility reason never costs the technician a turn */
  decline: (tid: string, reason: string, reasonCode?: string) => api.post<{ ok: true }>(`/tech/tickets/${id(tid)}/decline`, reasonCode ? { reason, reasonCode } : { reason }),
  // Request-Help workflow (helper side): incoming requests + accept/decline. Accepting reassigns the service line to me.
  helpRequests: () => api.get<TechHelpRequest[]>('/tech/help-requests'),
  acceptHelp: (rid: string) => api.post<TechHelpRequest>(`/tech/help-requests/${id(rid)}/accept`, {}),
  declineHelp: (rid: string, reason?: string) => api.post<TechHelpRequest>(`/tech/help-requests/${id(rid)}/decline`, reason ? { reason } : {}),
  // Request-Help workflow (primary side): find qualified helpers for a line, then request one.
  qualifiedForLine: (ticketId: string, serviceLineId: string) => api.get<TechQualifiedHelper[]>(`/tech/help-requests/qualified?ticketId=${id(ticketId)}&serviceLineId=${id(serviceLineId)}`),
  requestHelp: (body: { ticketId: string; serviceLineId: string; helperTechnicianId: string; reason: string; note?: string }) => api.post<TechHelpRequest>('/tech/help-requests', body),
  sendMessageToManager: (topic: string, message: string) => api.post<{ ok: true; messageId: string }>('/tech/help/message', { topic, message }),
  // push register / unregister moved to the ONE push client (lib/mobile.ts → @aipowersalon/mobile-sdk push/, Phase 13 D)
  // Portable Tech Profile (tech-profile spec set)
  profile: () => api.get<TechProfile>('/tech/profile'),
  updateProfile: (patch: Record<string, unknown>) => api.patch<TechProfile>('/tech/profile', patch),
  uploadAvatar: (file: File) => { const f = new FormData(); f.append('file', file); return api.upload<TechProfile>('/tech/profile/avatar', f); },
  uploadCover: (file: File) => { const f = new FormData(); f.append('file', file); return api.upload<TechProfile>('/tech/profile/cover', f); },
  removeCover: () => api.del<TechProfile>('/tech/profile/cover'),
  myPhotos: () => api.get<TechPhoto[]>('/tech/profile/photos'),
  addPhotos: (files: File[], caption?: string) => { const f = new FormData(); files.forEach((x) => f.append('files', x)); if (caption) f.append('caption', caption); return api.upload<{ ok: boolean; photos: { photoId: string }[] }>('/tech/profile/photos', f); },
  updatePhoto: (photoId: string, patch: Record<string, unknown>) => api.patch<{ ok: boolean }>(`/tech/profile/photos/${photoId}`, patch),
  deletePhoto: (photoId: string) => api.del<{ ok: boolean }>(`/tech/profile/photos/${photoId}`),
  setPhotoConsent: (photoId: string, body: { approvedUses: string[]; customerId?: string; ticketId?: string; consentVersion?: string }) => api.post<{ ok: boolean; consent: { approvedUses: string[]; revoked: boolean } }>(`/tech/profile/photos/${photoId}/consent`, body),
  withdrawPhotoConsent: (photoId: string) => api.post<{ ok: boolean; consent: { approvedUses: string[]; revoked: boolean } }>(`/tech/profile/photos/${photoId}/consent/withdraw`, {}),
  listBeforeAfter: () => api.get<TechBeforeAfter[]>('/tech/profile/before-after'),
  createBeforeAfter: (before: File, after: File, meta: { servicePerformed?: string; designNotes?: string; productsUsed?: string; durationMinutes?: number; customerConsent?: boolean }) => { const f = new FormData(); f.append('before', before); f.append('after', after); Object.entries(meta).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') f.append(k, String(v)); }); return api.upload<{ ok: boolean; setId: string }>('/tech/profile/before-after', f); },
  updateBeforeAfter: (setId: string, patch: Record<string, unknown>) => api.patch<{ ok: boolean }>(`/tech/profile/before-after/${setId}`, patch),
  deleteBeforeAfter: (setId: string) => api.del<{ ok: boolean }>(`/tech/profile/before-after/${setId}`),
  reorderPhotos: (photoIds: string[]) => api.patch<{ ok: boolean }>('/tech/profile/photos/reorder', { photoIds }),
  publicPreview: () => api.get<TechPublicPreview>('/tech/profile/public-preview'),
  cancelMembershipRequest: (requestId: string) => api.post<{ ok: boolean; status: string }>(`/tech/profile/membership-request/${requestId}/cancel`, {}),
  // §60: `transfer` = "I am LEAVING my current salon for this one" — approval at the new salon ends the current employment.
  requestMembership: (salonCode: string, message?: string, transfer?: boolean) => api.post<{ ok: boolean; status: string; salonName: string; message: string; transfer?: boolean }>('/tech/profile/membership-request', { salonCode, message, ...(transfer ? { transfer: true } : {}) }),
  // §46: share / take back a portfolio photo in the Nail Showcase
  sharePhotoToShowcase: (photoId: string) => api.post<PortfolioShowcaseShareResult>(`/tech/profile/photos/${photoId}/showcase`, {}),
  unsharePhotoFromShowcase: (photoId: string) => api.del<PortfolioShowcaseUnshareResult>(`/tech/profile/photos/${photoId}/showcase`),
  // §95: take back a public-profile edit a salon is still reviewing
  withdrawPendingProfileChange: () => api.post<PendingProfileChangeWithdrawResult>('/tech/profile/pending-changes/withdraw', {}),
  myRatings: () => api.get<TechRatings>('/tech/profile/ratings'),
  respondToReview: (reviewId: string, response: string) => api.post<TechRatings>(`/tech/profile/ratings/${reviewId}/respond`, { response }),
  dmThreads: () => api.get<{ threads: TechDmThread[] }>('/tech/profile/messages'),
  dmMessages: (threadId: string) => api.get<{ status: string; messages: TechDmMessage[] }>(`/tech/profile/messages/${threadId}`),
  dmSend: (threadId: string, body: string) => api.post<{ ok: true }>(`/tech/profile/messages/${threadId}`, { body }),
  dmBlock: (threadId: string) => api.post<{ ok: true }>(`/tech/profile/messages/${threadId}/block`, {}),
  dmReport: (threadId: string, reason?: string) => api.post<{ ok: true }>(`/tech/profile/messages/${threadId}/report`, { reason }),
  analytics: () => api.get<TechAnalytics>('/tech/profile/analytics'),
  requestVerification: () => api.post<{ verificationStatus: 'unverified' | 'pending' | 'verified' }>('/tech/profile/verification/request', {}),
  /**
   * Her own personal data. `@Get('tech/me/privacy-export')` has been live the whole time and TechPrivacyScreen
   * was a page of prose. A right of access nobody can exercise is a support ticket, not a right.
   */
  privacyExport: () => api.exportAsync<unknown>('/tech/me/privacy-export'),
  // Workplaces — one global profile, several salons.
  workplaces: () => api.get<{ workplaces: TechWorkplace[] }>('/tech/workplaces'),
  acceptWorkplace: (membershipId: string) => api.post<{ ok: boolean; status: string; salonName: string }>(`/tech/workplaces/${id(membershipId)}/accept`, {}),
  declineWorkplace: (membershipId: string) => api.post<{ ok: boolean; status: string }>(`/tech/workplaces/${id(membershipId)}/decline`, {}),
  switchSalon: (salonId: string) => api.post<TechSwitchResult>('/tech/context/switch', { salonId }),
  notifications: () => api.get<{ items: { id: string; type: string; title: string; body: string | null; reference: string | null; readAt: string | null; createdAt: string }[]; unread: number }>('/tech/notifications'),
  markNotificationsRead: () => api.post<{ ok: boolean; marked: number }>('/tech/notifications/read', {}),
  settings: () => api.get<Record<string, boolean>>('/tech/settings'),
  // Live Ticket Edit (build doc §5–§10)
  editOptions: (tid: string) => api.get<TechEditOptions>(`/tech/tickets/${id(tid)}/edit-options`),
  addServiceLine: (tid: string, body: { serviceId: string; notes?: string }) => api.post<any>(`/tech/tickets/${id(tid)}/service-lines`, body),
  patchLine: (tid: string, lineId: string, body: { notes?: string; status?: string }) => api.patch<any>(`/tech/tickets/${id(tid)}/service-lines/${id(lineId)}`, body),
  changeService: (tid: string, lineId: string, newServiceId: string, reason?: string) => api.post<any>(`/tech/tickets/${id(tid)}/change-requests`, { type: 'change_service', lineId, newServiceId, reason }),
  removeLine: (tid: string, lineId: string, reason?: string) => api.post<any>(`/tech/tickets/${id(tid)}/change-requests`, { type: 'remove_line', lineId, reason }),
  changeRequests: (tid: string) => api.get<any[]>(`/tech/tickets/${id(tid)}/change-requests`),
  addAddOn: (tid: string, serviceId: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/add-addon`, { serviceId }),
  // BUILD_PLAN Phase 13: one Idempotency-Key per start / completion (lib/offlineActions.ts journals them; the routes are @Idempotent())
  startService: (tid: string, o?: { idempotencyKey?: string }) => o?.idempotencyKey ? api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/start-service`, {}, { idempotencyKey: o.idempotencyKey }) : api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/start-service`, {}),
  pauseService: (tid: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/pause`, {}),
  resumeService: (tid: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/resume`, {}),
  serviceDone: (tid: string, notes?: string, o?: { idempotencyKey?: string }) => o?.idempotencyKey ? api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/service-done`, notes !== undefined ? { notes } : {}, { idempotencyKey: o.idempotencyKey }) : api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/service-done`, notes !== undefined ? { notes } : {}),
  // Skip-the-Line cash confirmation (Tech App) — server enforces tenant + assignment.
  cashPending: () => api.get<{ items: TechCashPendingItem[] }>('/tech/me/cash-pending'),
  cashPayment: (tid: string) => api.get<TechCashPendingItem>(`/tech/tickets/${id(tid)}/cash-payment`),
  confirmCashReceived: (tid: string) => api.post<{ paid: true; paymentId: string; amountCents: number; ticketStatus: string }>(`/tech/tickets/${id(tid)}/confirm-cash-received`, {}),
  reportCashNotPaid: (tid: string, notes?: string) => api.post<{ reported: true; status: string }>(`/tech/tickets/${id(tid)}/report-cash-not-paid`, notes !== undefined ? { notes } : {}),
  cashHandoff: () => api.get<TechCashHandoff>('/tech/me/cash-handoff'),
  submitCashHandoff: () => api.post<TechCashHandoff>('/tech/cash-handoff/submit', {}),
  addNote: (tid: string, note: string, visibility: 'internal' | 'customer' = 'internal') => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/notes`, { note, visibility }),
  requestCancel: (tid: string, reason: string) => api.post<{ ok: true }>(`/tech/tickets/${id(tid)}/request-cancel`, { reason }),
  queue: () => api.get<TechQueueState>('/tech/queue/state'),
  more: () => api.get<TechMoreState>('/tech/more/state'),
  // Decision 9: clock in / out as the signed-in technician — the same timecard as the POS and the Go Check-In kiosk.
  timeClock: () => api.get<TechClockView>('/tech/time-clock'),
  clockIn: () => api.post<TechClockView>('/tech/time-clock/clock-in', {}),
  clockOut: () => api.post<TechClockView>('/tech/time-clock/clock-out', {}),
  skills: () => api.get<TechSkillsView>('/tech/skills'),
  workingHours: () => api.get<TechWorkingHoursDay[]>('/tech/working-hours'),
  uploadSkillDocument: (file: File) => { const f = new FormData(); f.append('file', file); return api.upload<{ url: string; key: string }>('/tech/skills/upload-document', f); },
  requestSkillChange: (body: { serviceId: string, note?: string, proficiencyLevel?: string, experienceYears?: number, supportingPhotos?: string[], certificateEvidence?: string, status?: SkillChangeStatus }) => api.post<SkillChangeRequest>('/tech/skills/change-request', { ...body, requestType: 'add' }),
  updateSkillChange: (id: string, body: { serviceId: string, note?: string, proficiencyLevel?: string, experienceYears?: number, supportingPhotos?: string[], certificateEvidence?: string, status?: SkillChangeStatus }) => api.post<SkillChangeRequest>(`/tech/skills/change-request/${encodeURIComponent(id)}`, { ...body, requestType: 'add' }),
  skillRequests: () => api.get<SkillChangeRequest[]>('/tech/skills/change-requests'),
  // ── merge Oct 12 2026 (Technician App self-service; AUTH's /tech routes + BK's /tech/time-off) ──
  // Own-data reads: time clock (punches + breaks of the salon day), performance, tips, the clients she served.
  timeClockSummary: () => api.get<TechTimeClockView>('/tech/time-clock/summary'),
  performance: (days: 7 | 30 | 90 = 30) => api.get<TechPerformanceView>('/tech/performance', { days }),
  tips: (days: 7 | 14 | 30 = 14) => api.get<TechTipsView>('/tech/tips', { days }),
  myCustomers: (search?: string) => api.get<TechCustomerRow[]>('/tech/customers', search ? { search } : undefined),
  // Time off (own): request → the salon approves / declines; a pending request can be withdrawn.
  timeOff: () => api.get<TimeOffEntry[]>('/tech/time-off'),
  requestTimeOff: (body: TimeOffRequestBody) => api.post<TimeOffEntry>('/tech/time-off', body as unknown as Record<string, unknown>),
  withdrawTimeOff: (requestId: string) => api.del<TimeOffWithdrawResult>(`/tech/time-off/${id(requestId)}`),
  // Certifications (own): add / edit / remove while UNVERIFIED; the salon verifies (verification feeds service eligibility).
  certifications: () => api.get<TechCertificationView[]>('/tech/certifications'),
  addCertification: (body: TechCertificationBody) => api.post<TechCertificationView>('/tech/certifications', body as Record<string, unknown>),
  updateCertification: (certId: string, body: TechCertificationBody) => api.patch<TechCertificationView>(`/tech/certifications/${id(certId)}`, body as Record<string, unknown>),
  deleteCertification: (certId: string) => api.del<TechCertificationDeleted>(`/tech/certifications/${id(certId)}`),
  startBreak: (managerOverride?: boolean) => api.post<{ status: string }>('/tech/status/start-break', managerOverride ? { managerOverride: true } : {}),
  endBreak: () => api.post<{ status: string }>('/tech/status/end-break', {}),
  toggleBreak: (managerOverride?: boolean) => api.post<{ status: string }>('/tech/status/break', managerOverride ? { managerOverride: true } : {}),
};

export interface TechProfile {
  profileId: string; publicSlug: string; displayName: string; title: string | null; avatarUrl: string | null;
  coverUrl: string | null; certifications: string[]; styleTags: string[]; verificationStatus: 'unverified' | 'pending' | 'verified';
  bio: string | null; yearsExperience: number | null; specialties: string[]; languages: string[];
  profileLinks: Record<string, string>; profileLinkVisibility: Record<string, string>; isPublic: boolean; isBookable: boolean; marketplaceDiscoveryEnabled: boolean; acceptsMessages?: boolean;
  overallRating: number | null; ratingCount: number; portfolioPhotoCount: number; verifiedCompletedServicesCount: number;
  servicesHere: { serviceId: string; name: string; isPrimary: boolean }[];
  completionPercent: number;
  memberships: { membershipId: string; tenantId: string; branchId: string | null; salonName: string; status: string; requestedAt: string }[];
  // Technician Profile mandate §53 / §62 / §95
  publicProfileStatus?: 'PUBLIC' | 'PRIVATE' | 'HIDDEN' | 'SUSPENDED';
  careerHistoryPublic?: boolean;
  pendingChanges?: { requestId: string; changes: Record<string, unknown>; requestedAt: string } | null;
}
/** One salon this technician has a relationship with — active, pending, or ended. */
export interface TechWorkplace {
  membershipId: string; tenantId: string; salonName: string; branchId: string | null;
  status: string; roleLabel: string | null;
  isCurrentSession: boolean; canWorkHere: boolean; awaitingMe: boolean; awaitingSalon: boolean;
  startedAt: string | null;
}
export interface TechSwitchResult { ok: boolean; activeSalonId: string; activeBranchId: string | null; salonName: string; accessToken?: string }

export interface TechPhoto {
  photoId: string; imageUrl: string; thumbnailUrl: string | null; caption: string | null; tags: string[];
  serviceCategory: string | null; isPublic: boolean; isFeatured: boolean; moderationStatus: string; sortOrder: number; createdAt: string;
  nailShape: string | null; nailLength: string | null; designStyle: string | null; complexity: string | null; brand: string | null; colorName: string | null;
  consent: { approvedUses: string[]; revoked: boolean } | null;
  showcase?: { postId: string; status: string } | null;   // §46: shared into the Nail Showcase (pending_review | published)
}
export interface TechBeforeAfter {
  setId: string; beforeImageUrl: string; beforeThumbnailUrl: string | null; afterImageUrl: string; afterThumbnailUrl: string | null;
  servicePerformed: string | null; designNotes: string | null; productsUsed: string | null; durationMinutes: number | null;
  customerConsent: boolean; isPublic: boolean; moderationStatus: string; createdAt: string;
}
export interface TechRatings {
  overallRating: number | null; ratingCount: number; breakdown: Record<string, number>;
  recent: { ratingId: string; rating: number; comment: string | null; tags: string[]; reviewer: string; createdAt: string; response?: string | null; respondedAt?: string | null }[];
}

// Apple-compliance: technician account deactivation request (work/financial records retained; access disabled).
export interface TechAccountRequestResult { requestId: string; status: string; requestType: 'delete' | 'deactivate'; submittedAt: string; willRemove: string[]; willRetain: string[]; contactEmail: string | null; message: string }
export const techAccountApi = {
  requestDeactivation: (reason?: string) => api.post<TechAccountRequestResult>('/tech/me/delete-account-request', reason ? { reason } : {}),
};

export interface TechDmThread { threadId: string; status: string; lastMessageAt: string | null; lastMessagePreview: string | null; customerUnread: number; technicianUnread: number; customerName?: string }
export interface TechDmMessage { id: string; sender: 'customer' | 'technician'; body: string; createdAt: string }

export interface TechAnalytics { windowDays: number; totals: { profileViews: number; linkClicks: number; postTaps: number; messagesOpened: number }; dailyViews: { date: string; count: number }[]; topLinks: { ref: string; count: number }[]; topPosts: { ref: string; count: number }[] }

export interface TechAgreement { id: string; technicianId: string; title: string; terms: Record<string, unknown>; status: string; version: number; effectiveStart: string; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null }
export const techCompensationApi = {
  agreements: () => api.get<TechAgreement[]>('/tech/compensation-agreements'),
  acknowledgeAgreement: (id: string) => api.post<TechAgreement>(`/tech/compensation-agreements/${encodeURIComponent(id)}/acknowledge`, {}),
};
