// posMessagingSetupApi.ts — Text Messaging Setup & SMS Readiness guide (Oct 31 2026) §11–§16: the six-part readiness, the
// guided wizard, per-branch senders and the searchable setup history. Session-scoped on the server (the tenant is never
// sent; a branch is named only in the PATH or as an authorized filter). Nothing here sends, buys or changes anything —
// "Check SMS System" is posPhoneApi.healthCheck (read-only at the provider).
import { api } from './client';

export type MsgSetupPartState = 'ready' | 'attention_required' | 'pending' | 'failed' | 'unknown' | 'off';
export type MsgSetupPartKey = 'account' | 'sender' | 'registration' | 'inbound' | 'delivery' | 'booking_verify';
interface ReadinessPart { key: MsgSetupPartKey; state: MsgSetupPartState; summary: string; evidence: string; source: string; checkedAt: string | null; nextAction: string | null; fixLink: string }
export type MsgSetupWizardKey = 'scope' | 'connect' | 'number' | 'registration' | 'webhooks' | 'test' | 'summary';
interface WizardStep { key: MsgSetupWizardKey; state: 'done' | 'action' | 'pending' | 'blocked'; summary: string; fixLink: string }
export interface SetupOverview {
  generatedAt: string; scope: { branchId: string | null; branchName: string | null; source: string }; overall: MsgSetupPartState; parts: ReadinessPart[];
  delivery: { statusCallbackUrl: boolean; lastStatusEventAt: string | null; waitingOver2h: number; failedTests24h: number; failedSms24h: number; awaitingReports: number };
  wizard: { steps: WizardStep[]; resumeAt: MsgSetupWizardKey };
  schedule: { enabled: boolean; lastScheduledAt: string | null; lastCheckAt: string | null; runsAt: string; mode: string };
  note: string;
  consentBoundary?: ConsentBoundaryView;
}
/** Phone & Messaging 12 — what STOP / unsubscribe does to each message type (the send path's own rule) + 30-day ledger evidence */
export interface ConsentBoundaryRuleView { kind: string; channel: 'sms' | 'email'; purpose: string | null; blockedByOptOut: boolean; blockedByMarketingUnsubscribe: boolean; basis: 'transactional' | 'service' | 'marketing'; path: 'verify_service' | 'notifications';
  last30Days: { blocked: number; sentToOptedOut: number } | null; state: 'consistent' | 'breach' | 'not_on_ledger' }
export interface ConsentBoundaryView { rules: ConsentBoundaryRuleView[]; optedOut: { sms: number; email: number }; overall: 'consistent' | 'breach'; note: string }
export interface BranchSender { branchId: string; name: string | null; source: string; inherits: boolean; accountSidMasked: string | null; sender: string | null; senderType: string | null; registration: MsgSetupPartState; parts: { key: MsgSetupPartKey; state: MsgSetupPartState }[]; lastCheckedAt: string | null;
  /** extras TEXT MESSAGING SETUP 07: the branch's parts counted + the parts' own next actions (server) */
  summary?: { ready: number; pending: number; blocked: number }; nextActions?: { key: MsgSetupPartKey; state: MsgSetupPartState; nextAction: string; fixLink: string }[];
  /** extras TEXT MESSAGING SETUP 09: what each kind of text would use from this branch, and its STOP rule (server, read only) */
  routes?: { reminders: MsgRoute; testSms: MsgRoute; otp: MsgRoute } }
export interface MsgRoute { account: string | null; number?: string | null; messagingServiceSidLast4?: string | null; verifyServiceSidLast4?: string | null; via: string; sendable: boolean; stopRule: 'blocked_by_stop' | 'sent_despite_stop' | 'not_applicable' }
export interface BranchSenders { salonDefault: { accountSidMasked: string | null; sender: string | null; senderType: string | null; source: string }; branches: BranchSender[]; rule: string }
export type MsgSetupActivityKind = 'test_sms' | 'health_check' | 'registration_check' | 'number_purchase';
export interface MessagingActivityRow { kind: MsgSetupActivityKind; id: string; branchId: string | null; branchName: string | null; createdAt: string | null; updatedAt: string | null; deliveredAt: string | null; state: 'ok' | 'pending' | 'failed'; rawStatus: string; number: string | null; recipient: string | null; providerRef: string | null; reason: string | null; detail: string | null }
export interface MsgSetupActivityPage { items: MessagingActivityRow[]; page: number; pageSize: number; totalItems: number; totalPages: number; basis: string; period: { preset: string; from: string | null; to: string | null; tz: string; today: string }; order: string }
export type ActivityDetail = MessagingActivityRow & Record<string, unknown>;
interface ActivityQuery { q?: string; kind?: string; state?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }

const clean = (o: ActivityQuery) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));

export const posMessagingSetupApi = {
  overview: (branchId = '') => api.get<SetupOverview>(branchId ? `/tenant/messaging/setup/overview/branches/${encodeURIComponent(branchId)}` : '/tenant/messaging/setup/overview'),
  branches: () => api.get<BranchSenders>('/tenant/messaging/setup/branches'),
  activity: (q: ActivityQuery) => api.get<MsgSetupActivityPage>('/tenant/messaging/setup/activity', clean(q)),
  detail: (kind: MsgSetupActivityKind, id: string) => api.get<ActivityDetail>(`/tenant/messaging/setup/activity/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`),
};
