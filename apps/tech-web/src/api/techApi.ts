// techApi.ts — Technician app client for the real @Controller('tech') routes. Same-origin, session cookie; the server
// derives the technician from the session (no ids sent from the client). Reads return server-truth; payment/earnings
// values are whatever the backend computes (no fabrication).
import { api } from './client';
import type { SkillChangeRequest, SkillChangeStatus, TechClockView, TechDashboardState, TechEarningsDetail, TechEarningsSnapshot, TechMoreState, TechPayrollPeriod, TechQueueState, TechScheduleItem, TechSkillsView, TechTicketListItem, TechTicketServiceLine, TechWorkingHoursDay } from '@aipowersalon/api-contracts/tenant';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { RequestableService, SkillChangeRequest, SkillChangeStatus, SkillChangeType, TechAvailableActions, TechClockView, TechCurrentService, TechDashboardState, TechEarningsDetail, TechEarningsLine, TechEarningsSnapshot, TechMe, TechMoreState, TechNextAppointment, TechPayrollPeriod, TechQueueCustomer, TechQueueEntry, TechQueueState, TechScheduleItem, TechSkillService, TechSkillsView, TechTicketListItem, TechTicketServiceLine, TechTodayOverview, TechWorkingHoursDay } from '@aipowersalon/api-contracts/tenant';

export interface TechCanonicalEarnings {
  serviceCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number;
  retailCommissionCents: number; bonusCents: number | null; guaranteeTopUpCents: number | null; adjustmentsCents: number | null;
  estimatedEarningsCents: number; status: string; tickets: number; dateFrom: string; dateTo: string;
}
export interface TechHelpRequest { id: string; ticketId: string; serviceLineId: string; serviceId: string | null; primaryTechnicianId: string; helperTechnicianId: string; reason: string; note: string | null; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; respondedAt: string | null; declineReason: string | null; createdAt: string }
export interface TechQualifiedHelper { technicianId: string; displayName: string; workingStatus: string; shiftStatus: string; status: string }

// Ticket detail (Module 3) — server-truth; money in integer cents.
export interface TechTicketDetail {
  ticketId: string; technicianId: string | null; status: string; ticketNumber?: string;
  customerName?: string | null; customerPhoneMasked?: string | null;
  services?: TechTicketServiceLine[]; notes?: string | null; totalCents?: number; durationMinutes?: number;
  scheduledStart?: string | null; scheduledEnd?: string | null; acceptedAt?: string | null; startedAt?: string | null; completedAt?: string | null; acceptanceDeadline?: string | null; version?: number;
  // Optional rich fields the reference shows — rendered only when the backend supplies them (never invented):
  vip?: boolean; loyaltyTier?: string | null; allergies?: string[] | null; safetyNotes?: string | null;
  assignmentReason?: string | null; requestedTechnician?: string | null; inspoUrl?: string | null;
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

export const techApi = {
  serviceHistory: (service?: string) => api.get<{ items: { ticketId: string; serviceName: string; customerName: string; completedAt: string | null; rating: number | null; lineTotalCents: number }[]; services: string[] }>(`/tech/service-history${service ? `?service=${encodeURIComponent(service)}` : ''}`),
  payroll: () => api.get<TechPayroll>('/tech/payroll'),
  dashboard: () => api.get<TechDashboardState>('/tech'),
  earnings: () => api.get<TechEarningsSnapshot>('/tech/earnings'),
  schedule: (date?: string) => api.get<TechScheduleItem[]>(`/tech/schedule${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  earningsDetail: (period: string = 'day', date?: string, dateTo?: string) => api.get<TechEarningsDetail>(`/tech/earnings/detail?period=${period}${date ? `&date=${encodeURIComponent(date)}` : ''}${dateTo ? `&dateTo=${encodeURIComponent(dateTo)}` : ''}`),
  earningsCanonical: (period: string = 'day', date?: string, dateTo?: string) => api.get<TechCanonicalEarnings>(`/tech/earnings/canonical?period=${period}${date ? `&date=${encodeURIComponent(date)}` : ''}${dateTo ? `&dateTo=${encodeURIComponent(dateTo)}` : ''}`),
  tickets: () => api.get<TechTicketListItem[]>('/tech/tickets'),
  ticket: (tid: string) => api.get<TechTicketDetail>(`/tech/tickets/${id(tid)}`),
  ticketMembership: (tid: string) => api.get<TechMembershipView>(`/tech/tickets/${id(tid)}/membership`),
  accept: (tid: string, expectedVersion?: number) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/accept`, typeof expectedVersion === 'number' ? { expectedVersion } : {}),
  decline: (tid: string, reason: string) => api.post<{ ok: true }>(`/tech/tickets/${id(tid)}/decline`, { reason }),
  // Request-Help workflow (helper side): incoming requests + accept/decline. Accepting reassigns the service line to me.
  helpRequests: () => api.get<TechHelpRequest[]>('/tech/help-requests'),
  acceptHelp: (rid: string) => api.post<TechHelpRequest>(`/tech/help-requests/${id(rid)}/accept`, {}),
  declineHelp: (rid: string, reason?: string) => api.post<TechHelpRequest>(`/tech/help-requests/${id(rid)}/decline`, reason ? { reason } : {}),
  // Request-Help workflow (primary side): find qualified helpers for a line, then request one.
  qualifiedForLine: (ticketId: string, serviceLineId: string) => api.get<TechQualifiedHelper[]>(`/tech/help-requests/qualified?ticketId=${id(ticketId)}&serviceLineId=${id(serviceLineId)}`),
  requestHelp: (body: { ticketId: string; serviceLineId: string; helperTechnicianId: string; reason: string; note?: string }) => api.post<TechHelpRequest>('/tech/help-requests', body),
  sendMessageToManager: (topic: string, message: string) => api.post<{ ok: true; messageId: string }>('/tech/help/message', { topic, message }),
  registerPush: (platform: 'ios' | 'android' | 'web', token: string) => api.post<{ ok: true }>('/push/register', { platform, token, app: 'tech' }),
  unregisterPush: (token: string) => api.post<{ ok: true }>('/push/unregister', { token }),
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
  requestMembership: (salonCode: string, message?: string) => api.post<{ ok: boolean; status: string; salonName: string; message: string }>('/tech/profile/membership-request', { salonCode, message }),
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
  privacyExport: () => api.get<unknown>('/tech/me/privacy-export'),
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
  startService: (tid: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/start-service`, {}),
  pauseService: (tid: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/pause`, {}),
  resumeService: (tid: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/resume`, {}),
  serviceDone: (tid: string, notes?: string) => api.post<TechTicketDetail>(`/tech/tickets/${id(tid)}/service-done`, notes !== undefined ? { notes } : {}),
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
  skills: () => api.get<TechSkillsView>('/tech/skills'),   // the wire: skills + requestable services + change requests
  workingHours: () => api.get<TechWorkingHoursDay[]>('/tech/working-hours'),
  uploadSkillDocument: (file: File) => { const f = new FormData(); f.append('file', file); return api.upload<{ url: string; key: string }>('/tech/skills/upload-document', f); },
  requestSkillChange: (body: { serviceId: string, note?: string, proficiencyLevel?: string, experienceYears?: number, supportingPhotos?: string[], certificateEvidence?: string, status?: SkillChangeStatus }) => api.post<SkillChangeRequest>('/tech/skills/change-request', { ...body, requestType: 'add' }),
  updateSkillChange: (id: string, body: { serviceId: string, note?: string, proficiencyLevel?: string, experienceYears?: number, supportingPhotos?: string[], certificateEvidence?: string, status?: SkillChangeStatus }) => api.post<SkillChangeRequest>(`/tech/skills/change-request/${encodeURIComponent(id)}`, { ...body, requestType: 'add' }),
  skillRequests: () => api.get<SkillChangeRequest[]>('/tech/skills/change-requests'),
  // Decision 9: clock in / out as the signed-in technician
  timeClock: () => api.get<TechClockView>('/tech/time-clock'),
  clockIn: () => api.post<TechClockView>('/tech/time-clock/clock-in', {}),
  clockOut: () => api.post<TechClockView>('/tech/time-clock/clock-out', {}),
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
