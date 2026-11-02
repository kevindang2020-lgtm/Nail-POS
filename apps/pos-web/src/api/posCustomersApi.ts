import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';
// posCustomersApi.ts — customers client (reconciled). Reads via the shared `api` (root-relative /pos). The previous
// `merge` posted /pos/customers/merge, which does not exist — corrected to the real backend route
// /pos/customers/duplicates/:duplicateGroupId/merge with body { primaryCustomerId }. Added `duplicates()` to list the
// server-detected duplicate groups (GET /pos/customers/duplicates → DuplicateGroup[]).
import { api } from "./client";
const enc = (s: string) => encodeURIComponent(s);
export const posCustomersApi = {
  list: () => api.get(`/pos/customers`),
  state: () => api.get<any>(`/pos/customers/state`),
  atRisk: (inactiveDays: number) => api.get<any>(`/pos/customers`, { inactiveDays, pageSize: 100 }),
  search: (q: string) => api.get(`/pos/customers/search`, { q }),
  // Top-bar quick search: backend filters by name/phone/email via the `search` query param.
  quickSearch: (q: string) => api.get<any>(`/pos/customers/search`, { search: q, pageSize: 8 }),
  duplicates: () => api.get(`/pos/customers/duplicates`),
  create: (body: Record<string, unknown>) => api.post(`/pos/customers`, body),
  exportCsv: (q?: Record<string, unknown>) => api.exportAsync<{ format: string; filename: string; csv: string }>(`/pos/customers/export`, q),
  getDetail: (customerId: string) => api.get<any>(`/pos/customers/${enc(customerId)}`),
  appointments: (customerId: string) => api.get<any>(`/pos/customers/${enc(customerId)}/appointments`),
  getNotes: (customerId: string) => api.get<any>(`/pos/customers/${enc(customerId)}/notes`),
  setNotes: (customerId: string, notes: Record<string, unknown>) => api.patch(`/pos/customers/${enc(customerId)}/notes`, notes),
  setTags: (customerId: string, tags: string[]) => api.patch(`/pos/customers/${enc(customerId)}/tags`, { tags }),
  setLoyalty: (customerId: string, loyalty: Record<string, unknown>) => api.patch(`/pos/customers/${enc(customerId)}/loyalty`, loyalty),
  getLoyaltyLedger: (customerId: string) => api.get<any[]>(`/pos/customers/${enc(customerId)}/loyalty-ledger`),
  adjustLoyaltyPoints: (customerId: string, body: Record<string, unknown>) => api.post(`/pos/customers/${enc(customerId)}/loyalty-adjust`, body),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/pos/customers/${enc(id)}`, body),

  // ── phone changes go through the CANONICAL flow, never the generic update ──
  //
  // `PATCH /pos/customers/:id` used to write the phone directly: no E.164, no duplicate check, no verification, no
  // optimistic lock, no audit. That is closed — the field is now ignored there, so sending `phone` in an update
  // would SILENTLY do nothing, which is worse than the hole it replaced.
  //
  // start → send → verify. A number does not become the customer's number without an SMS in between.
  /** The customer's number, its proof, and any change in flight (Phase 3). */
  phoneStatus: (customerId: string) => api.get<CustomerPhoneStatus>(`/pos/customers/${enc(customerId)}/phone/status`),
  /** A MANAGER resolves a duplicate-number conflict (nothing is merged; the reason is recorded). */
  phoneResolve: (customerId: string, body: { phone: string; resolution: 'shared_family_phone' | 'different_people' | 'same_person_keep_separate'; reason: string; expectedVersion?: number; idempotencyKey?: string }) =>
    api.post<{ sessionId: string; state: string; maskedPhone: string; duplicates: any }>(`/pos/customers/${enc(customerId)}/phone/resolve`, body),
  /** A MANAGER approves a receptionist's change (salon setting "require manager approval"). */
  phoneApprove: (customerId: string, sessionId: string) =>
    api.post<{ state: string; activated: boolean }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/approve`, {}),
  /** A MANAGER confirms a number without a code — labelled "OTP not completed", never verified. */
  phoneManualConfirm: (customerId: string, sessionId: string, phone: string, reason: string) =>
    api.post<{ state: string; label: string }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/manual-confirm`, { phone, reason }),
  /** Show the code pad on the customer display: the customer types the code there instead of reading it aloud. */
  phoneToDisplay: (customerId: string, sessionId: string) =>
    api.post<{ ok: true }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/to-display`, {}),
  /** A MANAGER re-runs a failed synchronisation now. */
  phoneRetrySync: (customerId: string, sessionId: string) =>
    api.post<{ state: string }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/retry-sync`, {}),
  phoneStart: (customerId: string, body: { phone: string; reason?: string; expectedVersion?: number; sharedFamilyPhone?: boolean; idempotencyKey?: string }) =>
    api.post<{ sessionId: string; state: string; maskedPhone: string; duplicates: any }>(`/pos/customers/${enc(customerId)}/phone`, body),
  phoneSend: (customerId: string, sessionId: string, phone: string) =>
    api.post<{ state: string; message: string }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/send`, { phone }),
  phoneVerify: (customerId: string, sessionId: string, phone: string, code: string) =>
    api.post<{ state: string; activated: boolean; message: string }>(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/verify`, { phone, code }),
  phoneCancel: (customerId: string, sessionId: string) =>
    api.post(`/pos/customers/${enc(customerId)}/phone/${enc(sessionId)}/cancel`, {}),
  merge: (duplicateGroupId: string, primaryCustomerId: string) =>
    api.post(`/pos/customers/duplicates/${enc(duplicateGroupId)}/merge`, { primaryCustomerId }),
  /** Functional Decision 29: Keep Separate (the group leaves the queue) or Not Sure (it stays, flagged). */
  decideDuplicate: (duplicateGroupId: string, decision: 'keep_separate' | 'not_sure') =>
    api.post(`/pos/customers/duplicates/${enc(duplicateGroupId)}/decision`, { decision }),
  importPreview: (csv: string, updateExisting?: boolean) => api.post(`/pos/customers/import/preview`, { csv, updateExisting: !!updateExisting }),
  importCommit: (csv: string, updateExisting?: boolean) => api.post(`/pos/customers/import/commit`, { csv, updateExisting: !!updateExisting }),
};
