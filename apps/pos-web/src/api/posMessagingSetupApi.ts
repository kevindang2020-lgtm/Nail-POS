// posMessagingSetupApi.ts — Text Messaging Setup & SMS Readiness guide (Oct 31 2026) §11–§16: the six-part readiness, the
// guided wizard, per-branch senders and the searchable setup history. Session-scoped on the server (the tenant is never
// sent; a branch is named only in the PATH or as an authorized filter). Nothing here sends, buys or changes anything —
// "Check SMS System" is posPhoneApi.healthCheck (read-only at the provider).
import { api } from './client';

export type PartState = 'ready' | 'attention_required' | 'pending' | 'failed' | 'unknown' | 'off';
export type PartKey = 'account' | 'sender' | 'registration' | 'inbound' | 'delivery' | 'booking_verify';
export interface ReadinessPart { key: PartKey; state: PartState; summary: string; evidence: string; source: string; checkedAt: string | null; nextAction: string | null; fixLink: string }
export type WizardKey = 'scope' | 'connect' | 'number' | 'registration' | 'webhooks' | 'test' | 'summary';
export interface WizardStep { key: WizardKey; state: 'done' | 'action' | 'pending' | 'blocked'; summary: string; fixLink: string }
export interface SetupOverview {
  generatedAt: string; scope: { branchId: string | null; branchName: string | null; source: string }; overall: PartState; parts: ReadinessPart[];
  delivery: { statusCallbackUrl: boolean; lastStatusEventAt: string | null; waitingOver2h: number; failedTests24h: number; failedSms24h: number; awaitingReports: number };
  wizard: { steps: WizardStep[]; resumeAt: WizardKey };
  schedule: { enabled: boolean; lastScheduledAt: string | null; lastCheckAt: string | null; runsAt: string; mode: string };
  note: string;
}
export interface BranchSender { branchId: string; name: string | null; source: string; inherits: boolean; accountSidMasked: string | null; sender: string | null; senderType: string | null; registration: PartState; parts: { key: PartKey; state: PartState }[]; lastCheckedAt: string | null }
export interface BranchSenders { salonDefault: { accountSidMasked: string | null; sender: string | null; senderType: string | null; source: string }; branches: BranchSender[]; rule: string }
export type ActivityKind = 'test_sms' | 'health_check' | 'registration_check' | 'number_purchase';
export interface ActivityRow { kind: ActivityKind; id: string; branchId: string | null; branchName: string | null; createdAt: string | null; updatedAt: string | null; deliveredAt: string | null; state: 'ok' | 'pending' | 'failed'; rawStatus: string; number: string | null; recipient: string | null; providerRef: string | null; reason: string | null; detail: string | null }
export interface ActivityPage { items: ActivityRow[]; page: number; pageSize: number; totalItems: number; totalPages: number; basis: string; period: { preset: string; from: string | null; to: string | null; tz: string; today: string }; order: string }
export type ActivityDetail = ActivityRow & Record<string, unknown>;
export interface ActivityQuery { q?: string; kind?: string; state?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }

const clean = (o: ActivityQuery) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));

export const posMessagingSetupApi = {
  overview: (branchId = '') => api.get<SetupOverview>(branchId ? `/tenant/messaging/setup/overview/branches/${encodeURIComponent(branchId)}` : '/tenant/messaging/setup/overview'),
  branches: () => api.get<BranchSenders>('/tenant/messaging/setup/branches'),
  activity: (q: ActivityQuery) => api.get<ActivityPage>('/tenant/messaging/setup/activity', clean(q)),
  detail: (kind: ActivityKind, id: string) => api.get<ActivityDetail>(`/tenant/messaging/setup/activity/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`),
};
