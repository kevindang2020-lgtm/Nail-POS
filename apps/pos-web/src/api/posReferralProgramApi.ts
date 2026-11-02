// posReferralProgramApi — Marketing & Growth → Referral Program (/pos/referral-program/*). Referral Program guide (Oct 30 2026):
// KPIs that reconcile to source rows, the referral history (tab / search / reward type / date basis + range / sort / pages), the
// Pending Reward Reviews (oldest first), the read-only eligibility checker, the ONE canonical record, manager review (approve /
// reject / investigate / clear), issuance retry (same issuance key), reversal, codes, policy, the non-mutating system check and
// the AI Referral Growth Assistant (an UNSENT audience for Campaign Center — nothing here sends). Tenant/branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type ReferralQuery = { tab?: string; q?: string; rewardType?: string; basis?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posReferralProgramApi = {
  summary: () => api.get<any>(`/pos/referral-program/summary`),
  referrals: (q: ReferralQuery) => api.get<any>(`/pos/referral-program/referrals`, clean(q)),
  approvals: (q: { q?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/referral-program/approvals`, clean(q)),
  referral: (id: string) => api.get<any>(`/pos/referral-program/referrals/${enc(id)}`),
  check: (b: { code: string; referredCustomerId?: string | null }) => api.post<any>(`/pos/referral-program/check`, b),
  record: (b: { code: string; referredCustomerId: string; idempotencyKey: string }) => api.post<any>(`/pos/referral-program/referrals`, b),
  review: (id: string, b: { action: 'approve' | 'reject' | 'investigate' | 'clear_review'; reason?: string | null; expectedVersion?: number | null }) => api.post<any>(`/pos/referral-program/referrals/${enc(id)}/review`, b),
  issue: (rewardId: string) => api.post<any>(`/pos/referral-program/rewards/${enc(rewardId)}/issue`, {}),
  reverse: (rewardId: string, reason: string) => api.post<any>(`/pos/referral-program/rewards/${enc(rewardId)}/reverse`, { reason }),
  codes: (q: { q?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/referral-program/codes`, clean(q)),
  codeStatus: (id: string, b: { status: 'active' | 'disabled'; reason?: string | null; expectedVersion: number }) => api.put<any>(`/pos/referral-program/codes/${enc(id)}/status`, b),
  health: () => api.get<any>(`/pos/referral-program/health`),
  settings: () => api.get<any>(`/pos/referral-program/settings`),
  saveSettings: (b: Record<string, unknown>) => api.put<any>(`/pos/referral-program/settings`, b),
  plan: (b: { goal: string; channel?: 'sms' | 'email'; budgetCents?: number | null }) => api.post<any>(`/pos/referral-program/assistant/plan`, clean(b)),
  save: (b: { goal: string; channel?: 'sms' | 'email'; message?: string; idempotencyKey: string }) => api.post<any>(`/pos/referral-program/assistant/save`, clean(b)),
};
