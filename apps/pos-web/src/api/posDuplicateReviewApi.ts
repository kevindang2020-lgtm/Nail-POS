// posDuplicateReviewApi — AI Center → Customer Profile → Duplicate Review (/pos/duplicate-review/*). Duplicate Review guides
// (FULL + COMPLETE, Nov 1 2026): the candidate queue (search · status · confidence · reason · date field + range · sort ·
// pages 10/25/50/100, newest detected first), the audited side-by-side comparison, review decisions, the read-only merge
// preview, the human-confirmed merge (preview hash + request key + acknowledgements), history, scan and the read-only check.
// Tenant / branch / role: the session — never sent from here.
import { api } from './client';
const enc = encodeURIComponent;
export type DuplicateQuery = {
  q?: string; status?: string; confidence?: string; reason?: string; branch?: string;
  dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number;
};
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
/** one key per merge INTENT: a retry of the same confirmation sends the same key and gets the first answer back */
export const newMergeKey = (): string => globalThis.crypto?.randomUUID?.() || `dr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
export const posDuplicateReviewApi = {
  summary: () => api.get<any>(`/pos/duplicate-review/summary`),
  groups: (q: DuplicateQuery) => api.get<any>(`/pos/duplicate-review/groups`, clean(q)),
  group: (id: string) => api.get<any>(`/pos/duplicate-review/groups/${enc(id)}`),
  scan: () => api.post<any>(`/pos/duplicate-review/scan`, {}),
  decide: (id: string, body: { decision: string; note?: string; expectedVersion?: number; dueOn?: string }) => api.post<any>(`/pos/duplicate-review/groups/${enc(id)}/decision`, clean(body)),
  note: (id: string, note: string) => api.post<any>(`/pos/duplicate-review/groups/${enc(id)}/notes`, { note }),
  preview: (id: string, survivorId: string) => api.post<any>(`/pos/duplicate-review/groups/${enc(id)}/preview`, { survivorId }),
  merge: (id: string, body: { survivorId: string; previewHash: string; idempotencyKey: string; acknowledged: string[] }) =>
    api.post<any>(`/pos/duplicate-review/groups/${enc(id)}/merge`, { ...body, confirm: true }),
  history: (q: { groupId?: string; customerId?: string; eventType?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/duplicate-review/history`, clean(q)),
  check: () => api.post<any>(`/pos/duplicate-review/check`, {}),
};
