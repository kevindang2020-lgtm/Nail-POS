import type { EvidenceChecklist } from '@aipowersalon/api-contracts/platform';
export type { EvidenceChecklist };   // owned by packages/api-contracts (Constitution 13 §13)
// evidence-policy-core.ts — pure evidence rules for Chargebacks & Disputes: reason-code-driven checklists and upload
// validation (allowed types, size cap, executable/blocked-type rejection). No I/O. Used by the service to gate uploads
// and to render the collection checklist. File contents are validated here but never returned.

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024; // 15 MB
export const ALLOWED_MIME = new Set<string>([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
]);
const BLOCKED_EXT = /\.(exe|sh|bat|cmd|com|js|mjs|jar|msi|dll|scr|ps1|vbs|app|bin)$/i;
// EICAR anti-malware test signature — lets the modeled scanner exercise the "infected" path deterministically.
export const EICAR_MARKER = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR';


export function evidenceChecklist(reasonCategory: string | null): EvidenceChecklist {
  const map: Record<string, EvidenceChecklist> = {
    fraud_card_absent: { required: ['Signed or authorization record', 'Proof of service delivery', 'Customer confirmation'], recommended: ['IP or device record', 'Terms accepted', 'Membership agreement'] },
    fraud_card_present: { required: ['Signed receipt', 'Device or terminal record', 'Service completion record'], recommended: ['Before-and-after service photos', 'Technician notes'] },
    cardholder_disagreement: { required: ['Itemized receipt', 'Service record', 'Customer communication'], recommended: ['Cancellation policy', 'Refund policy'] },
    cancellation: { required: ['Cancellation policy', 'Proof of service delivery'], recommended: ['Customer communication', 'Terms accepted'] },
    credit_not_processed: { required: ['Proof of refund', 'Refund policy'], recommended: ['Customer communication'] },
    not_received: { required: ['Proof of service delivery', 'Appointment record', 'Service completion record'], recommended: ['Customer check-in record', 'Technician notes'] },
    not_as_described: { required: ['Service record', 'Before-and-after service photos', 'Customer confirmation'], recommended: ['Technician notes', 'Customer communication'] },
  };
  return map[reasonCategory ?? ''] ?? { required: ['Itemized receipt', 'Service record'], recommended: ['Customer communication'] };
}

export type UploadMeta = { fileName?: string | null; mimeType?: string | null; sizeBytes?: number | null };
export type UploadValidation = { ok: boolean; error?: string };

export function validateUpload(m: UploadMeta): UploadValidation {
  const name = (m.fileName ?? '').trim();
  if (!name) return { ok: false, error: 'A file name is required.' };
  if (BLOCKED_EXT.test(name)) return { ok: false, error: 'Executable and script files are not allowed.' };
  const mime = (m.mimeType ?? '').trim();
  if (!ALLOWED_MIME.has(mime)) return { ok: false, error: `Unsupported file type: ${mime || 'unknown'}. Allowed: PDF, PNG, JPEG, WEBP, DOCX, XLSX.` };
  const size = Number(m.sizeBytes ?? 0);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'File size is required.' };
  if (size > MAX_EVIDENCE_BYTES) return { ok: false, error: `File exceeds the ${Math.round(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB limit.` };
  return { ok: true };
}

// Modeled malware scan: deterministic in dev. Real deployments run an async scanner and start at 'pending'.
export function modeledScan(content: string | null | undefined): 'clean' | 'infected' {
  return content && content.includes(EICAR_MARKER) ? 'infected' : 'clean';
}
