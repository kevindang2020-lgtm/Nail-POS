// posPhoneCenterApi.ts — Customers → Phone Number Management center (Phone Number Management Complete Build Guide). READ routes only;
// every change (start / send / verify / approve / resolve / manual exception / retry sync / cancel) goes through posCustomersApi's
// existing phone* methods → pos/customers/:customerId/phone/*, which own the state machine and the audit.
import { api } from './client';

type PcGroup = 'pending' | 'code_sent' | 'retry_allowed' | 'expired' | 'failed' | 'manager_review' | 'cancelled' | 'completed' | 'sync_attention';
export type PcSync = 'not_needed' | 'pending' | 'in_progress' | 'synced' | 'retry_scheduled' | 'failed' | 'unknown';
export interface PcKpi { value: number | string; source: string }
export interface PcSummary { timezone: string; generatedAt: string; kpis: Record<'verified' | 'pending' | 'failed' | 'today' | 'shared' | 'smsHealth', PcKpi>; syncAttention: number; can: { startChange: boolean; editSettings: boolean; retrySync: boolean };
  /** PHONE NUMBER MANAGEMENT 4 · 06 — the server's suspicious-change review list (review only) */
  risk?: { windowDays: number; items: PcRiskItem[] } }
export interface PcRiskItem { customerId: string; customerName: string | null; changes: number; failedRequests: number; codeAttempts: number; channels: number; addresses: number; reasons: string[]; latestRequestId: string; latestAt: string | null }
export interface PcHealthItem { key: string; state: string; message: string; [k: string]: unknown }
export interface PcHealth { checkedAt: string; items: PcHealthItem[]; limits: { codeDigits: number; codeTtlSeconds: number; maxAttempts: number; resendCooldownSeconds: number; syncMaxAttempts: number } }
export interface PcRow {
  id: string; customerId: string; customerName: string; avatarUrl: string | null; oldPhoneMasked: string | null; newPhoneMasked: string | null;
  state: string; status: PcGroup; source: string; requestedBy: string | null; requestedByRole: string | null; branchId: string | null; branchName: string | null;
  createdAt: string | null; updatedAt: string | null; expiresAt: string | null; completedAt: string | null; verifiedAt: string | null; appliedAt: string | null;
  verificationMethod: 'sms_verified' | 'manual_exception' | null; sharedWith: number; attempts: number; lastAttemptAt: string | null; ageMinutes: number | null;
  sync: { state: PcSync; attempts: number; nextAttemptAt: string | null; lastError: string | null }; canRetry?: boolean;
}
export interface PcPage<T> { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number; timezone?: string; order?: string;
  period?: { preset: 'today' | 'week' | 'month' | 'year' | 'custom' | 'all'; from: string | null; to: string | null; tz: string; today: string } }
export interface PcDetail extends PcRow {
  reason: string | null; trustedStillActive: boolean; message: string;
  current: { phoneMasked: string | null; proof: string; since: string | null; verifiedAt: string | null };
  verification: { status: string; digits: number; attemptsUsed: number; attemptsLeft: number; resends: number; lastSentAt: string | null; deliveredAt: string | null; codeExpiresAt: string | null;
    resendAvailableInSeconds: number; failure: string | null; sender: { state: string; kind: string | null; lastCheckedAt: string | null; message: string } };
  oldNumberNotice: { state: string; at?: string | null; failure?: string | null };
  recent: Array<{ id: string; state: string; status: PcGroup; source: string; newPhoneMasked: string | null; createdAt: string | null }>;
  actions: Record<'sendCode' | 'verifyCode' | 'cancel' | 'approve' | 'resolveDuplicate' | 'manualException' | 'retrySync' | 'startNew', boolean>;
}
export interface PcCustomer { customerId: string; name: string; avatarUrl: string | null; phoneMasked: string | null; proof: string; sharedWith: number; openRequestId: string | null }
export type PcQuery = Record<string, string | number | undefined>;
const enc = encodeURIComponent;
/** drop empty filters so the server sees only what the user chose */
const clean = (q: PcQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const posPhoneCenterApi = {
  summary: () => api.get<PcSummary>('/pos/customer-phone-center/summary'),
  health: () => api.get<PcHealth>('/pos/customer-phone-center/health'),
  history: (q: PcQuery) => api.get<PcPage<PcRow>>('/pos/customer-phone-center/requests', clean(q)),
  pending: (q: PcQuery) => api.get<PcPage<PcRow>>('/pos/customer-phone-center/pending', clean(q)),
  sync: (q: PcQuery) => api.get<PcPage<PcRow>>('/pos/customer-phone-center/sync', clean(q)),
  detail: (id: string) => api.get<PcDetail>(`/pos/customer-phone-center/requests/${enc(id)}`),
  customers: (q: PcQuery) => api.get<PcPage<PcCustomer>>('/pos/customer-phone-center/customers', clean(q)),
};
