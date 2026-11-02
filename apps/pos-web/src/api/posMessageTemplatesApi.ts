// posMessageTemplatesApi.ts — Communications → Message Templates (Message Templates & Automation Center guide, 740): the salon's
// templates in their real store (pos_message_templates), versions, preview (never sends), the confirmed Test Send, automation
// connections and the template message history. Every route is tenant-scoped on the server from the session.
import { api } from './client';

export type MtStatus = 'draft' | 'active' | 'inactive' | 'archived';
export interface MtRow {
  id: string; name: string; channel: 'sms' | 'email'; category: string | null; messageClass: string | null; subject: string | null; description: string | null;
  branchId: string | null; branchName: string | null; status: MtStatus; version: number; recordVersion: number; bodyPreview: string;
  createdAt: string | null; createdAtKnown: boolean; updatedAt: string | null; lastUsedAt: string | null; archivedAt: string | null;
  createdByName: string | null; updatedByName: string | null; usageCount: number; activeBindings: number; problems: number; legacyPlaceholders: boolean;
}
export interface MtFinding { code: string; token?: string; message: string }
export interface MtValidation { errors: MtFinding[]; warnings: MtFinding[]; tokens: string[] }
export interface MtPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
export interface MtPage<T> { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number; period: MtPeriod }
export interface MtVariable { token: string; group: string; label: string; source: string; sample: string; categories: string[]; fallback: string | null }
export interface MtSummary {
  kpis: { total: number; active: number; sms: number; email: number; archived: number; drafts: number; inactive: number; usedThisMonthMessages: number; usedThisMonthTemplates: number };
  month: { from: string | null; to: string | null; tz: string }; checkedAt: string;
  categories: { key: string; messageClass: string }[]; variables: MtVariable[]; canManage: boolean; canTest: boolean; canPreviewCustomer: boolean;
}
export interface MtBinding { id: string; workflow: string; channel: string; templateId: string; templateName: string; templateStatus: string; strategy: 'latest' | 'pinned'; version: number; branchId: string | null; branchName: string | null; active: boolean; recordVersion: number; updatedAt: string | null; healthy: boolean }
export interface MtDetail {
  template: MtRow & { body: string }; validation: MtValidation;
  versions: { version: number; name: string; channel: string; category: string | null; subject: string | null; body: string; variables: string[]; backfilled: boolean; createdAt: string | null; byName: string | null }[];
  bindings: MtBinding[]; tests: { id: string; version: number; channel: string; target: string; status: string; providerRef: string | null; errorCode: string | null; createdAt: string | null; byName: string | null; delivery: string }[];
  variables: { token: string; label: string; group: string }[]; movedBindings?: number;
}
export interface MtRendered { subject: string | null; text: string; html: string | null; missing: string[]; used: string[]; unknown: string[]; sms: { segments: number; encoding: 'GSM-7' | 'UCS-2'; units: number; perSegment: number } | null }
export interface MtPreview { templateId: string | null; name: string | null; version: number | null; channel: string; category: string | null; source: 'sample' | 'customer'; sent: false; rendered: MtRendered; validation: MtValidation; unresolved: string[]; note: string }
export interface MtWorkflow { key: string; label: string; channels: string[]; bindable: boolean; categories: string[]; source: string; route: string | null; handoff: string | null; workflowActive: boolean | null; workflowChannel: string | null; bindings: MtBinding[]; usesThisTemplate: boolean | null; lastUsedAt: string | null; messagesFromTemplates: number }
export interface MtUsageRow {
  id: string; templateId: string; templateName: string; version: number; workflow: string; channel: string; customerId: string | null; customerName: string | null; recipient: string | null;
  appointmentId: string | null; threadId: string | null; messageId: string | null; notificationId: string | null; providerRef: string | null; renderedSubject: string | null; renderedBody: string;
  sendOutcome: string; reason: string | null; delivery: string; createdAt: string | null; sentAt: string | null; providerEventAt: string | null;
}
export interface MtHealth { checkedAt: string; findings: { key: string; status: 'ready' | 'attention' | 'failed' | 'info'; message: string; evidence: string; fix: string | null; templateId?: string }[]; sent: false }
export interface MtTestResult { duplicate: boolean; testId: string; status: string; target: string; providerRef: string | null; errorCode: string | null; delivery: string }

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;
const enc = encodeURIComponent;
const B = '/pos/message-templates';

export const posMessageTemplatesApi = {
  summary: () => api.get<MtSummary>(`${B}/summary`),
  list: (q: Q) => api.get<MtPage<MtRow> & { sort: string; basis: string; status: string }>(`${B}/templates`, clean(q)),
  detail: (id: string) => api.get<MtDetail>(`${B}/templates/${enc(id)}`),
  create: (b: { name: string; channel: 'sms' | 'email'; body: string; category?: string | null; subject?: string | null; description?: string | null; branchId?: string | null; activate?: boolean }) => api.post<MtDetail>(`${B}/templates`, b as unknown as Record<string, unknown>),
  update: (id: string, b: { recordVersion: number; name?: string; channel?: 'sms' | 'email'; body?: string; category?: string | null; subject?: string | null; description?: string | null; branchId?: string | null }) => api.patch<MtDetail>(`${B}/templates/${enc(id)}`, b as unknown as Record<string, unknown>),
  duplicate: (id: string) => api.post<MtDetail>(`${B}/templates/${enc(id)}/duplicate`, {}),
  setStatus: (id: string, b: { to: 'active' | 'inactive' | 'archived'; recordVersion: number; replacementTemplateId?: string; confirm?: boolean }) => api.post<MtDetail>(`${B}/templates/${enc(id)}/status`, b as unknown as Record<string, unknown>),
  /** never sends: sample data by default; a real customer only with customer access (audited) */
  preview: (b: { templateId?: string; version?: number; customerId?: string; appointmentId?: string; draft?: { channel: string; category?: string | null; subject?: string | null; body: string } }) => api.post<MtPreview>(`${B}/preview`, b as unknown as Record<string, unknown>),
  /** ONE real message to the number / address typed in — separate, confirmed, one key per intended test */
  testSend: (id: string, b: { to: string; version?: number; confirm: true }, key: string) => api.post<MtTestResult>(`${B}/templates/${enc(id)}/test`, b as unknown as Record<string, unknown>, { 'Idempotency-Key': key }),
  connections: (templateId?: string | null) => api.get<{ workflows: MtWorkflow[]; templateId: string | null; checkedAt: string }>(`${B}/connections`, templateId ? { templateId } : undefined),
  bind: (b: { workflow: string; channel: 'sms' | 'email'; templateId: string; branchId?: string | null; strategy?: 'latest' | 'pinned'; pinnedVersion?: number | null }) => api.post<{ workflows: MtWorkflow[]; bindingId: string; sent: false }>(`${B}/connections`, b as unknown as Record<string, unknown>),
  unbind: (bindingId: string, recordVersion: number) => api.post<{ workflows: MtWorkflow[] }>(`${B}/connections/${enc(bindingId)}/disconnect`, { recordVersion }),
  usage: (q: Q) => api.get<MtPage<MtUsageRow> & { basis: string; unlinkedNote: string }>(`${B}/usage`, clean(q)),
  health: () => api.post<MtHealth>(`${B}/health-check`, {}),
};
