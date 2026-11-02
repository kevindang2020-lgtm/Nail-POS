// posAiOcrReceiptApi.ts — typed client for the AI Receipt & Document Recognition endpoints. The client NEVER sends
// tenant/branch — the server derives them from the session. No financial record is posted without an approved document:
// post() only succeeds on the server once the document has passed review + approval.
import { api } from './client';
import type { OcrUploadResult, OcrPageAppendResult, OcrExtractionResult } from '@aipowersalon/api-contracts/tenant';

const enc = encodeURIComponent;

export const posAiOcrReceiptApi = {
  settings: () => api.get<any>(`/pos/ai-ocr-receipt/settings`),
  saveSettings: (patch: { level?: 'tenant' | 'branch'; branchId?: string | null; enabled?: boolean | null; config?: any }) => api.put<any>(`/pos/ai-ocr-receipt/settings`, patch),

  list: (filters?: Record<string, unknown>) => api.get<any>(`/pos/ai-ocr-receipt/documents`, filters),
  detail: (id: string) => api.get<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}`),
  previewUrl: (id: string, key: string) => api.get<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/preview-url`, { key }),

  /** Oct 27 2026: `source` names the channel (§12); `deferExtraction` holds the automatic reading until the pages are appended (§17/§18).
   *  The answer carries the §25 quality verdict ({ flags, difficult }) and the §159 thumbnail key. */
  upload: (payload: { filename: string; mimeType?: string; sizeBytes: number; bytes: number[] | Uint8Array; headerBytes?: number[]; pageCount?: number | null; width?: number | null; height?: number | null; source?: 'pos_upload' | 'owner_app_upload' | 'mobile_camera' | 'web_upload' | 'api_import'; deferExtraction?: boolean }) => api.post<OcrUploadResult>(`/pos/ai-ocr-receipt/upload`, payload),
  /** §17/§18: page 2, 3 … of ONE document (never a second document) */
  addPage: (id: string, payload: { filename: string; mimeType?: string; sizeBytes: number; bytes: number[] | Uint8Array; headerBytes?: number[]; width?: number | null; height?: number | null }) => api.post<OcrPageAppendResult>(`/pos/ai-ocr-receipt/documents/${enc(id)}/pages`, payload),
  /** §115: a person restarts the reading of a document that used its automatic attempts */
  retryExtract: (id: string) => api.post<OcrExtractionResult>(`/pos/ai-ocr-receipt/documents/${enc(id)}/retry-extract`, {}),

  correctField: (id: string, field: any, patch: { value?: string | null; valueCents?: number | null; confirmOnly?: boolean }) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/correct-field`, { field, ...patch }),
  // Re-check the malware verdict on a quarantined document (S3 scanners tag out of band, so the verdict
  // usually lands after the upload). Returns { pipelineState, scan, released } — never releases on its own.
  // Run OCR on a document parked in 'extracting'. Returns { pipelineState, providerKey, unavailable }.
  // unavailable=true means no provider could read it — the document routes to manual entry, not to a guess.
  extract: (id: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/extract`, {}),
  rescan: (id: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/rescan`, {}),
  /** M3: retry a posting that failed (idempotent — never a second expense) */
  retryPost: (id: string, destination: 'expense' | 'inventory_receipt' = 'expense') => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/retry-post`, { destination }),
  startReview: (id: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/start-review`, {}),
  approve: (id: string, reason?: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/approve`, { reason }),
  reject: (id: string, reason?: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/reject`, { reason }),
  returnForCorrection: (id: string, reason?: string) => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/return`, { reason }),
  post: (id: string, destination: 'expense' | 'inventory_receipt') => api.post<any>(`/pos/ai-ocr-receipt/documents/${enc(id)}/post`, { destination }),
};
