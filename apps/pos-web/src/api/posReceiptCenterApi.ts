// posReceiptCenterApi — AI Center → AI OCR Receipt Scanner (/pos/receipt-center/*). AI OCR Receipt Scanner guide (Nov 1 2026):
// the four cards with their definitions, the receipt history (search · status group · which date · presets / range · sort ·
// pages, newest first), one receipt read-only, and the read-only Check OCR System. Every change stays on posAiOcrReceiptApi.
import { api } from './client';
const enc = encodeURIComponent;
type Q = Record<string, string | number | undefined>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posReceiptCenterApi = {
  summary: (q: Q = {}) => api.get<any>(`/pos/receipt-center/summary`, clean(q)),
  documents: (q: Q = {}) => api.get<any>(`/pos/receipt-center/documents`, clean(q)),
  document: (id: string) => api.get<any>(`/pos/receipt-center/documents/${enc(id)}`),
  check: () => api.post<any>(`/pos/receipt-center/check`, {}),
};
