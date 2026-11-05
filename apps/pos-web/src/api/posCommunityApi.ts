// posCommunityApi.ts — typed client for the tenant Safety Community (/community, BUILD_PLAN Phase 8 — contract
// scratchpad/p8/CONTRACT.md §2 (agent A: feed, posts, advisories, incidents, settings, rules, reports, disputes,
// appeals) and §4 (agent C: comments, similar experiences, follows, evidence, alerts, analytics)). Every shape is the
// API's own (@aipowersalon/api-contracts/tenant `Community*`) — never re-declared here. The client NEVER sends a tenant,
// branch or user id (the server derives them from the session) and never sends another salon's id (it never has one).
//
// Writes that change a versioned row carry `expectedVersion`; a 409 `version_conflict` means "someone changed it —
// reload". The evidence upload is three steps: ask for a short-lived upload ticket (sha256 + size + type), PUT the
// bytes straight to storage with the ticket's headers, then `complete` (the server checks the object and scans it).
import { api } from './client';
import type {
  CommunityActiveAlert, CommunityAdvisoryInput, CommunityAdvisoryUpdate, CommunityAppealInput, CommunityAppealView,
  CommunityCommentEdit, CommunityCommentInput, CommunityCommentView, CommunityDisputeInput, CommunityEvidenceAccess,
  CommunityEvidenceUploadRequest, CommunityEvidenceUploadTicket, CommunityEvidenceView, CommunityFeedQuery,
  CommunityFollowInput, CommunityFollowView, CommunityIncidentInput, CommunityIncidentView, CommunityMyListKind,
  CommunityMyPostView, CommunityPage, CommunityPostStatus, CommunityPostView, CommunityReportInput, CommunitySettingsUpdate,
  CommunitySettingsView, CommunitySimilarInput, CommunitySubmitResult, CommunityTenantAnalytics, CommunityWordingIssue,
} from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const BASE = '/community';
const enc = encodeURIComponent;
const body = <T extends object>(b: T) => b as unknown as Record<string, unknown>;
/** drop empty filters so the query string carries only what the user chose */
const query = (q: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '' && v !== false) out[k] = typeof v === 'boolean' ? 'true' : v;
  return out;
};
/** list routes answer CommunityPage<T>; a bare array is tolerated (never crash on either) */
export const pageOf = <T>(r: CommunityPage<T> | T[] | null | undefined): CommunityPage<T> =>
  Array.isArray(r) ? { items: r, page: 1, pageSize: r.length, total: r.length, hasMore: false }
    : r && Array.isArray(r.items) ? r : { items: [], page: 1, pageSize: 0, total: 0, hasMore: false };
const list = <T>(r: T[] | { items?: T[] } | null | undefined): T[] => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r!.items! : []);

export interface CommunityAssistResult { suggestion: string | null; flags: string[] }
export interface CommunityAckResult { acknowledged: true; rulesVersion: string }
export interface CommunityFollowState { following: boolean; followers: number }
export interface CommunitySimilarResult { similarCount: number; mine: true }
export interface CommunityDisputeResult { ok: true; status: CommunityPostStatus }
export type { CommunityWordingIssue };

/** sha256 of a file as lowercase hex (the upload ticket is bound to it) */
export async function sha256Hex(file: Blob): Promise<string> {
  // Blob.arrayBuffer is missing on older iPad Safari (and jsdom) — FileReader is everywhere
  const buf: ArrayBuffer = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file);
  });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const posCommunityApi = {
  // ── feed + posts (A) ──
  feed: (q: CommunityFeedQuery = {}) => api.get<CommunityPage<CommunityPostView>>(`${BASE}/feed`, query(q)).then((r) => pageOf(r)),
  /** a text search (same filters + q) — the server refuses customer identifiers (400 search_identifier_rejected) */
  search: (q: CommunityFeedQuery) => api.get<CommunityPage<CommunityPostView>>(`${BASE}/search`, query(q)).then((r) => pageOf(r)),
  post: (id: string) => api.get<CommunityPostView>(`${BASE}/posts/${enc(id)}`),
  editPost: (id: string, u: CommunityAdvisoryUpdate) => api.put<CommunitySubmitResult>(`${BASE}/posts/${enc(id)}`, body(u)),
  addUpdate: (id: string, text: string) => api.post<CommunityPostView>(`${BASE}/posts/${enc(id)}/updates`, { body: text }),
  resolve: (id: string, expectedVersion: number, note: string) => api.post<CommunityPostView>(`${BASE}/posts/${enc(id)}/resolve`, { expectedVersion, note }),
  reportPost: (id: string, r: CommunityReportInput) => api.post<{ ok: true }>(`${BASE}/posts/${enc(id)}/report`, body(r)),
  dispute: (id: string, d: CommunityDisputeInput) => api.post<CommunityDisputeResult>(`${BASE}/posts/${enc(id)}/dispute`, body(d)),
  appeal: (id: string, a: CommunityAppealInput) => api.post<CommunityAppealView>(`${BASE}/posts/${enc(id)}/appeal`, body(a)),
  appeals: () => api.get<CommunityAppealView[] | { items: CommunityAppealView[] }>(`${BASE}/appeals`).then((r) => list<CommunityAppealView>(r)),

  // ── my advisories + the posting workflow (A) ──
  mine: (kind: CommunityMyListKind = 'all', page = 1, pageSize = 20) => api.get<CommunityPage<CommunityMyPostView>>(`${BASE}/mine`, { kind, page, pageSize }).then((r) => pageOf(r)),
  myPost: (id: string) => api.get<CommunityMyPostView>(`${BASE}/mine/${enc(id)}`),
  createAdvisory: (input: CommunityAdvisoryInput) => api.post<CommunityMyPostView>(`${BASE}/advisories`, body(input)),
  updateAdvisory: (id: string, u: CommunityAdvisoryUpdate) => api.put<CommunitySubmitResult>(`${BASE}/advisories/${enc(id)}`, body(u)),
  submit: (id: string, expectedVersion: number, officialReportReferenced?: boolean) =>
    api.post<CommunitySubmitResult>(`${BASE}/advisories/${enc(id)}/submit`, officialReportReferenced ? { expectedVersion, officialReportReferenced: true } : { expectedVersion }),
  approve: (id: string, expectedVersion: number) => api.post<CommunityMyPostView>(`${BASE}/advisories/${enc(id)}/approve`, { expectedVersion }),
  returnAdvisory: (id: string, expectedVersion: number, note: string) => api.post<CommunityMyPostView>(`${BASE}/advisories/${enc(id)}/return`, { expectedVersion, note }),
  withdraw: (id: string, expectedVersion: number) => api.post<CommunityMyPostView>(`${BASE}/advisories/${enc(id)}/withdraw`, { expectedVersion }),
  /** AI wording help — advisory only; 503 ai_not_configured when no AI backend is wired */
  assist: (text: string) => api.post<CommunityAssistResult>(`${BASE}/advisories/assist`, { body: text }),

  // ── private incidents (A) — never visible to another salon ──
  incidents: (page = 1) => api.get<CommunityPage<CommunityIncidentView>>(`${BASE}/incidents`, { page }).then((r) => pageOf(r)),
  incident: (id: string) => api.get<CommunityIncidentView>(`${BASE}/incidents/${enc(id)}`),
  createIncident: (input: CommunityIncidentInput) => api.post<CommunityIncidentView>(`${BASE}/incidents`, body(input)),

  // ── settings + rules (A) ──
  settings: () => api.get<CommunitySettingsView>(`${BASE}/settings`),
  saveSettings: (u: CommunitySettingsUpdate) => api.put<CommunitySettingsView>(`${BASE}/settings`, body(u)),
  acknowledgeRules: (rulesVersion: string) => api.post<CommunityAckResult>(`${BASE}/rules/acknowledge`, { rulesVersion }),

  // ── comments (C) ──
  comments: (postId: string) => api.get<CommunityCommentView[] | { items: CommunityCommentView[] }>(`${BASE}/posts/${enc(postId)}/comments`).then((r) => list<CommunityCommentView>(r)),
  addComment: (postId: string, c: CommunityCommentInput) => api.post<CommunityCommentView>(`${BASE}/posts/${enc(postId)}/comments`, body(c)),
  editComment: (id: string, e: CommunityCommentEdit) => api.put<CommunityCommentView>(`${BASE}/comments/${enc(id)}`, body(e)),
  deleteComment: (id: string) => api.del<unknown>(`${BASE}/comments/${enc(id)}`),
  reportComment: (id: string, r: CommunityReportInput) => api.post<{ ok: true }>(`${BASE}/comments/${enc(id)}/report`, body(r)),

  // ── similar experience + follows (C) ──
  markSimilar: (postId: string, s: CommunitySimilarInput = {}) => api.post<CommunitySimilarResult>(`${BASE}/posts/${enc(postId)}/similar`, body(s)),
  followPost: (postId: string) => api.post<CommunityFollowState>(`${BASE}/posts/${enc(postId)}/follow`, {}),
  unfollowPost: (postId: string) => api.del<CommunityFollowState>(`${BASE}/posts/${enc(postId)}/follow`),
  follows: () => api.get<CommunityFollowView[] | { items: CommunityFollowView[] }>(`${BASE}/follows`).then((r) => list<CommunityFollowView>(r)),
  addFollow: (f: CommunityFollowInput) => api.post<CommunityFollowView>(`${BASE}/follows`, body(f)),
  removeFollow: (id: string) => api.del<unknown>(`${BASE}/follows/${enc(id)}`),

  // ── evidence (C) — own salon only; other salons only ever see "evidence reviewed" ──
  requestEvidenceUpload: (r: CommunityEvidenceUploadRequest) => api.post<CommunityEvidenceUploadTicket>(`${BASE}/evidence/uploads`, body(r)),
  /** PUT the bytes to the presigned URL (storage, not the API — no session cookie, only the ticket's headers) */
  putEvidenceBytes: async (ticket: CommunityEvidenceUploadTicket, file: Blob): Promise<void> => {
    const res = await fetch(ticket.uploadUrl, { method: ticket.method || 'PUT', headers: ticket.headers, body: file });
    if (!res.ok) throw Object.assign(new Error(t('pos.the_file_could_not_be_uploaded_1dxw')), { status: res.status, code: 'evidence_upload_failed' });
  },
  completeEvidence: (id: string) => api.post<CommunityEvidenceView>(`${BASE}/evidence/${enc(id)}/complete`, {}),
  postEvidence: (postId: string) => api.get<CommunityEvidenceView[] | { items: CommunityEvidenceView[] }>(`${BASE}/posts/${enc(postId)}/evidence`).then((r) => list<CommunityEvidenceView>(r)),
  evidenceAccess: (id: string, reason: string) => api.get<CommunityEvidenceAccess>(`${BASE}/evidence/${enc(id)}/access`, { reason }),

  // ── alerts + analytics (C) ──
  activeAlerts: () => api.get<CommunityActiveAlert[] | { items: CommunityActiveAlert[] }>(`${BASE}/alerts/active`).then((r) => list<CommunityActiveAlert>(r)),
  analytics: (from: string, to: string) => api.get<CommunityTenantAnalytics>(`${BASE}/analytics`, { from, to }),
};
