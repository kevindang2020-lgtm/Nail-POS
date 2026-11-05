// posAiApi.ts — POS access to the AI assistants. `packages` returns this tenant's per-package access state (the same
// gate decision the backend enforces) so the UI knows whether to offer the assistant or show a locked panel; `invoke`
// runs an assistant. Tenant scope is derived from the session server-side.
import type { AiActivityRow, AiCenterOverview, AiCenterSection, AiRevenueSummary, CallIntelSummary, ChecklistItem, CopilotHoldRequest, CopilotHoldResult, CopilotSettings, IntentResult, Metric, ParsedReceipt, ProvisioningJob, ReceiptItem, ReceptionistOverview, ReceptionistSettings, WorkflowStat } from '@aipowersalon/api-contracts/tenant';
export type { AiActivityRow, AiCenterOverview, AiCenterSection, AiRevenueSummary, CallIntelSummary, ChecklistItem, CopilotHoldResult, CopilotSettings, IntentResult, Metric, ParsedReceipt, ProvisioningJob, ReceiptItem, ReceptionistOverview, ReceptionistSettings, WorkflowStat };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';

export interface PosAiPackage {
  code: string; name: string; description: string; usageUnit: string; category?: string; posArea?: string;
  monthlyPriceCents?: number; includedUsageLimit?: number;
  subscription: { status: string; usageLimit: number } | null;
  used: number; remainingUsage: number; accessible: boolean; lockReason: string | null; lockLabel: string | null; trialAvailable: boolean;
}

export interface ReceptionistCall { providerCallId: string; startedAt?: string | null; endedAt?: string | null; createdMs?: number; language?: string | null; intents?: string[]; toolCalls?: { name: string; ok: boolean }[]; bookingOutcome?: string | null; handoffOutcome?: string | null; sentiment?: string | null; errorCategory?: string | null; abandoned?: boolean; followUpRequired?: boolean; durationSeconds?: number | null; summary?: string | null }
export interface ReceptionistAgent { id: string; name: string; status: string; callType: string; language: string; useCase: string | null; greeting: string | null; behavior: string | null; provider: string | null; knowledgeVersion: number; createdAtMs: number; updatedAtMs: number }
export interface ReceptionistFollowUp { id: string; reason: string; priority: string; status: string; customerId: string | null; callerPhone: string | null; providerCallId: string | null; appointmentId: string | null; assignedUserId: string | null; notes: string | null; resolution: string | null; source: string; createdAtMs: number; updatedAtMs: number }
export interface ReceptionistFaq { id: string; question: string; answer: string; category: string | null; language: string; isActive: boolean; createdAtMs: number; updatedAtMs: number }
export interface CopilotSafeCustomer { customerId: string; fullName: string; maskedPhone: string; returning: boolean; visitsCount: number; lastVisitDate: string | null; loyaltyTier: string | null; favoriteServiceName: string | null; favoriteTechnicianName: string | null; upcomingAppointment?: { startsAt: string; serviceName: string; technicianName: string } | null }
export interface CopilotContextResult { matchState: 'none' | 'exact' | 'multiple'; candidates: CopilotSafeCustomer[]; customer: CopilotSafeCustomer | null; denied?: boolean }
export interface CopilotTechnicians { available: boolean; technicians: { technicianId: string; name: string; firstAvailable: string | null; openSlots: number; isUsual: boolean }[]; denied?: boolean }
export interface CopilotConflict { hasConflict: boolean; status: string; conflictingAppointmentId: string | null; denied?: boolean; unavailable?: boolean }
export interface CopilotAvailability { available: boolean; date: string | null; recommendations: { time: string; technicianId: string; technicianName: string }[]; byTechnician: { technicianId: string; name: string; slotCount: number; firstSlot: string | null }[]; denied?: boolean }
export interface CopilotDuplicatesResult { groups: { groupId: string; reason: string; members: { customerId: string; fullName: string; maskedPhone: string; visitCount: number | null }[] }[]; denied?: boolean }
export interface CopilotActionResult { ok: boolean; requiresConfirmation?: boolean; errorCode?: string; message?: string; result?: unknown }
export interface CopilotQueueSummary { available: boolean; waiting: number; inService: number; unassigned: number; vipWaiting: number; longestWaitMinutes: number | null; denied?: boolean }
export interface CopilotReply { ok: boolean; text: string | null; degraded: boolean; decision?: { label?: string; reason?: string }; remainingUsage?: number | null; label?: string | null }


export interface PosAiPlanPkg { code: string; name: string; monthlyPriceCents: number; usageUnit: string; posArea?: string }
export interface PosAiPlan {
  code: string; name: string; description: string; essential: boolean;
  fullCents: number; discountCents: number; effectiveCents: number;
  subscribed: boolean; status: string | null; trialAvailable: boolean;
  packages: PosAiPlanPkg[];
}



export interface AiAssistantControl { assistantKey: string; mode: string; label: string; updatedByUserId: string | null; updatedAt: string | null }

export const posAiApi = {
  packages: () => api.get<{ packages: PosAiPackage[] }>('/tenant/ai/packages'),
  centerOverview: () => api.get<AiCenterOverview>('/tenant/ai/center/overview'),
  receptionCopilot: (prompt: string) => api.post<CopilotReply>('/tenant/ai/center/copilot', { prompt }),
  receptionCopilotContext: (phone: string) => api.post<CopilotContextResult>('/tenant/ai/center/copilot/context', { phone }),
  receptionCopilotQueue: () => api.get<CopilotQueueSummary>('/tenant/ai/center/copilot/queue'),
  receptionCopilotDuplicates: () => api.get<CopilotDuplicatesResult>('/tenant/ai/center/copilot/duplicates'),
  receptionCopilotAvailability: (date: string, serviceIds?: string[]) => api.post<CopilotAvailability>('/tenant/ai/center/copilot/availability', serviceIds?.length ? { date, serviceIds } : { date }),
  receptionCopilotHold: (p: CopilotHoldRequest) => api.post<CopilotHoldResult>('/tenant/ai/center/copilot/hold', { ...p }),
  receptionCopilotReleaseHold: (holdToken: string) => api.post<{ released: boolean }>('/tenant/ai/center/copilot/hold/release', { holdToken }),
  receptionCopilotConflict: (technicianId: string, startTime: string, endTime: string, date: string) => api.post<CopilotConflict>('/tenant/ai/center/copilot/conflict', { technicianId, startTime, endTime, date }),
  receptionCopilotTechnicians: (date: string) => api.post<CopilotTechnicians>('/tenant/ai/center/copilot/technicians', { date }),
  receptionCopilotCancelAppointment: (appointmentId: string, reason: string, confirm: boolean) => api.post<CopilotActionResult>('/tenant/ai/center/copilot/action', { type: 'cancel_appointment', appointmentId, reason, confirm }),
  receptionCopilotRescheduleAppointment: (appointmentId: string, startTime: string, date: string, confirm: boolean) => api.post<CopilotActionResult>('/tenant/ai/center/copilot/action', { type: 'reschedule_appointment', appointmentId, startTime, date, confirm }),
  receptionCopilotCreateAppointment: (p: { customerName: string; serviceIds: string[]; date: string; startTime: string; technicianId?: string; confirm: boolean; idempotencyKey?: string; holdToken?: string }) => api.post<CopilotActionResult>('/tenant/ai/center/copilot/action', { type: 'create_appointment', ...p }),
  receptionCopilotSendMessage: (to: string, body: string, confirm: boolean, idempotencyKey?: string) => api.post<CopilotActionResult>('/tenant/ai/center/copilot/action', { type: 'send_message', to, body, confirm, idempotencyKey }),
  receptionCopilotDraftMessage: (kind: string, phone?: string) => api.post<{ kind: string; body: string; matched: boolean; customerName: string | null; refined?: boolean }>('/tenant/ai/center/copilot/draft-message', { kind, phone }),
  receptionCopilotGetSettings: () => api.get<CopilotSettings>('/tenant/ai/center/copilot/settings'),
  receptionCopilotIntent: (text: string) => api.post<IntentResult>('/tenant/ai/center/copilot/intent', { text }),
  receptionCopilotAiPhoneActivity: () => api.get<{ available: boolean; calls: { callId: string; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; intents: string[]; bookingOutcome: string | null; handoffOutcome: string | null; summary: string | null; followUpRequired: boolean; handedOffToHuman: boolean }[] }>('/tenant/ai/center/copilot/ai-phone-activity'),
  receptionCopilotExplainService: (serviceId: string) => api.post<{ found: boolean; service?: { name: string; category: string; durationMinutes: number; priceCents: number; description: string | null }; policies?: string[] }>('/tenant/ai/center/copilot/explain-service', { serviceId }),
  receptionCopilotWaitlist: () => api.get<{ recommended: boolean; waiting: number; estimatedWaitMinutes: number | null; message: string }>('/tenant/ai/center/copilot/waitlist'),
  receptionCopilotNextActions: (input: { intent?: string; hasAvailability?: boolean; duplicateFound?: boolean; customerKnown?: boolean }) => api.post<{ action: string; label: string; reason: string }[]>('/tenant/ai/center/copilot/next-actions', input),
  receptionCopilotPatchSettings: (patch: Partial<CopilotSettings> & { level?: 'tenant' | 'branch' }) => api.patch<CopilotSettings>('/tenant/ai/center/copilot/settings', patch),
  controlModes: () => api.get<AiAssistantControl[]>('/tenant/ai/control-modes'),
  aiRevenueSummary: () => api.get<AiRevenueSummary>('/tenant/ai/revenue/summary'),
  receptionistOverview: () => api.get<ReceptionistOverview>('/tenant/ai/receptionist/overview'),
  receptionistCalls: (limit = 20) => api.get<ReceptionistCall[]>('/tenant/ai/receptionist/calls', { limit }),
  receptionistSettings: () => api.get<ReceptionistSettings>('/tenant/ai/receptionist/settings'),
  updateReceptionistSettings: (b: Record<string, unknown>) => api.patch<ReceptionistSettings>('/tenant/ai/receptionist/settings', b),
  receptionistAgents: (status?: string) => api.get<ReceptionistAgent[]>('/tenant/ai/receptionist/agents', status ? { status } : {}),
  createReceptionistAgent: (b: { name: string; callType?: string; language?: string; useCase?: string }) => api.post<ReceptionistAgent>('/tenant/ai/receptionist/agents', b),
  setReceptionistAgentStatus: (id: string, status: string) => api.post<ReceptionistAgent>(`/tenant/ai/receptionist/agents/${id}/status`, { status }),
  provisionReceptionistAgent: (id: string) => api.post<ProvisioningJob>(`/tenant/ai/receptionist/agents/${id}/provision`, {}),
  receptionistProvisioningJob: (jobId: string) => api.get<ProvisioningJob>(`/tenant/ai/receptionist/provisioning/${jobId}`),
  receptionistFollowUps: (status?: string, mine?: boolean) => api.get<ReceptionistFollowUp[]>('/tenant/ai/receptionist/follow-ups', { ...(status ? { status } : {}), ...(mine ? { mine: '1' } : {}) }),
  createReceptionistFollowUp: (b: { reason: string; priority?: string; callerPhone?: string; notes?: string }) => api.post<ReceptionistFollowUp>('/tenant/ai/receptionist/follow-ups', b),
  noteReceptionistFollowUp: (id: string, note: string) => api.post<ReceptionistFollowUp>(`/tenant/ai/receptionist/follow-ups/${id}/note`, { note }),
  setReceptionistFollowUpStatus: (id: string, status: string, resolution?: string) => api.post<ReceptionistFollowUp>(`/tenant/ai/receptionist/follow-ups/${id}/status`, { status, resolution }),
  receptionistFaqs: () => api.get<ReceptionistFaq[]>('/tenant/ai/receptionist/faqs'),
  createReceptionistFaq: (b: { question: string; answer: string; category?: string }) => api.post<ReceptionistFaq>('/tenant/ai/receptionist/faqs', b),
  updateReceptionistFaq: (id: string, b: Record<string, unknown>) => api.patch<ReceptionistFaq>(`/tenant/ai/receptionist/faqs/${id}`, b),
  deleteReceptionistFaq: (id: string) => api.del<{ deleted: boolean }>(`/tenant/ai/receptionist/faqs/${id}`),
  workflowRunsSummary: () => api.get<Record<string, WorkflowStat>>('/tenant/ai/workflows/runs/summary'),
  setControlMode: (key: string, mode: string) => api.patch<AiAssistantControl>(`/tenant/ai/control-modes/${encodeURIComponent(key)}`, { mode }),
  callIntelligenceSummary: () => api.get<CallIntelSummary>('/tenant/ai/call-intelligence/summary'),
  invoke: (code: string, body: { action?: string; prompt?: string }) =>
    api.post<{ ok: boolean; text?: string; remainingUsage?: number }>(`/ai/${encodeURIComponent(code)}`, body),
  scanReceipt: (imageBase64: string, mimeType: string) =>
    api.post<{ ok: boolean; receipt?: ParsedReceipt }>('/ai/ocr/scan-receipt', { imageBase64, mimeType }),
  plans: () => api.get<{ plans: PosAiPlan[] }>('/tenant/ai/plans'),
  startPlanTrial: (code: string) => api.post<{ ok: boolean; activated?: number }>(`/tenant/ai/plans/${encodeURIComponent(code)}/trial`, {}),
  cancelPlan: (code: string) => api.patch<{ ok: boolean }>(`/tenant/ai/plans/${encodeURIComponent(code)}/cancel`, {}),
};
