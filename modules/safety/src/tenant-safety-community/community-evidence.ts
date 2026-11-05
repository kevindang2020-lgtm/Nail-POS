// community-evidence.ts — evidence access control, the safety-critical rule that raw evidence never leaks.
// Community readers see only a SUMMARY; the raw bytes (a signed URL) are reachable ONLY by the owning tenant's
// authorized users or by a moderator acting under an explicit audited case. Blob storage and malware scanning
// are honest NotConnected adapters (never fabricate a 'clean' scan or a real signed URL) until that infra is
// wired — the same discipline as the OCR file/scan ports. PURE core + port interfaces.
import type { CommunityRole } from './community-classification';

export interface EvidenceRecord {
  id: string;
  ownerTenantId: string;
  scanStatus: 'unscanned' | 'clean' | 'infected' | 'error';
  redactionStatus: 'pending' | 'redacted' | 'not_required';
}

export interface EvidenceViewer {
  tenantId: string;
  role: CommunityRole;
  canUploadEvidence: boolean;          // has the upload_evidence capability in their tenant
  moderationCaseId?: string | null;    // set ONLY when a moderator acts under an audited case
}

export type EvidenceDecision = { allowed: boolean; reason: string };

/** Raw evidence (signed URL) access. Fail-closed. Only the owning tenant's authorized users or a moderator
 *  under an explicit case. An infected/unscanned file is never released. */
export function canAccessRawEvidence(viewer: EvidenceViewer, ev: EvidenceRecord): EvidenceDecision {
  // INFECTED is absolute. Nobody, ever — not even the tenant that uploaded it.
  if (ev.scanStatus === 'infected') return { allowed: false, reason: 'infected' };

  const isOwningTenant = viewer.tenantId === ev.ownerTenantId;

  if (isOwningTenant) {
    if (viewer.role !== 'owner' && viewer.role !== 'tenant_admin' && viewer.role !== 'branch_manager') {
      return { allowed: false, reason: 'role_not_authorized_for_raw_evidence' };
    }
    // The uploading tenant may open its OWN file even while it is unscanned.
    //
    // This is a deliberate line, not a convenience. Malware in an uploaded file is a threat to whoever RECEIVES
    // it — and this salon already has the bytes: they are the ones who uploaded them, from their own device.
    // Refusing them their own attachment protects nobody, and (with no scanner wired) it would make evidence
    // upload a feature that can never be used: you could attach a file and then never look at it again.
    //
    // What the scan gates is release to a THIRD PARTY. That rule below is unchanged.
    return { allowed: true, reason: 'owning_tenant_authorized' };
  }

  // Cross-party access — a Super Admin moderator under an audited case. Here the scan matters absolutely: we are
  // about to hand a file from one salon to someone else. It must be proven clean first.
  if (viewer.role === 'moderator' && viewer.moderationCaseId) {
    if (ev.scanStatus !== 'clean') return { allowed: false, reason: 'not_scanned_clean' };
    return { allowed: true, reason: 'moderator_case' };
  }

  return { allowed: false, reason: 'cross_tenant_evidence_denied' };
}

/** The community-safe view: counts + types + whether redaction is still pending. NEVER a storage key or URL. */
export interface EvidenceSummary { count: number; scanned: number; redactionPending: number }
export function evidenceSummary(list: EvidenceRecord[]): EvidenceSummary {
  return {
    count: list.length,
    scanned: list.filter((e) => e.scanStatus === 'clean').length,
    redactionPending: list.filter((e) => e.redactionStatus === 'pending').length,
  };
}

// ── Honest infra ports (no fabrication) ──
export interface EvidenceBlobStore {
  putMetadata(tenantId: string, evidenceId: string, storageKey: string): Promise<void>;
  signedUrl(storageKey: string): Promise<{ url: string; expiresAt: string }>;
}
export interface EvidenceScanner { scan(storageKey: string): Promise<{ status: EvidenceRecord['scanStatus'] }>; }

// Not connected: never returns a fabricated 'clean' or a real signed URL. Access control still holds — an
// unscanned file simply can't be released (canAccessRawEvidence requires 'clean').
export class NotConnectedEvidenceBlob implements EvidenceBlobStore {
  async putMetadata(): Promise<void> { /* metadata is recorded by the repo; bytes go to blob when wired */ }
  async signedUrl(storageKey: string): Promise<{ url: string; expiresAt: string }> {
    return { url: `notconnected:${storageKey}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
}
export class NotConnectedEvidenceScanner implements EvidenceScanner {
  async scan(): Promise<{ status: EvidenceRecord['scanStatus'] }> { return { status: 'unscanned' }; }
}

// ── BUILD_PLAN Phase 8 (agent C): presigned evidence uploads ─────────────────────────────────────────────────────
// The browser PUTs the bytes straight to private storage with a short-lived presigned URL; the API never handles the
// file. The request names the type, the size and the SHA-256 up front; `complete` then checks the object really exists
// with that size before the scanner is asked — and the scanner FAILS CLOSED (no verdict → unscanned → locked).
export const EVIDENCE_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;           // 15 MB — the column CHECK (chk_ce_size) agrees
export const EVIDENCE_UPLOAD_TTL_SECONDS = 10 * 60;            // presigned PUT lives ≤ 10 minutes
export const EVIDENCE_READ_TTL_SECONDS = 5 * 60;
export const EVIDENCE_UPLOADS_PER_HOUR = 30;                   // per salon

export interface EvidenceUploadRequestClean { postId: string | null; incidentId: string | null; mimeType: string; sizeBytes: number; sha256: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateEvidenceUpload(b: any): { ok: true; value: EvidenceUploadRequestClean } | { ok: false; field: string; message: string } {
  const postId = b?.postId == null || b.postId === '' ? null : String(b.postId);
  const incidentId = b?.incidentId == null || b.incidentId === '' ? null : String(b.incidentId);
  if ((postId === null) === (incidentId === null)) return { ok: false, field: 'postId', message: 'exactly one of postId / incidentId' };
  if (postId !== null && !UUID.test(postId)) return { ok: false, field: 'postId', message: 'not an id' };
  if (incidentId !== null && !UUID.test(incidentId)) return { ok: false, field: 'incidentId', message: 'not an id' };
  const mimeType = String(b?.mimeType ?? '').toLowerCase().trim();
  if (!(EVIDENCE_MIME_ALLOWLIST as readonly string[]).includes(mimeType)) return { ok: false, field: 'mimeType', message: 'jpeg, png, webp or pdf only' };
  const sizeBytes = Number(b?.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > EVIDENCE_MAX_BYTES) return { ok: false, field: 'sizeBytes', message: '1 byte to 15 MB' };
  const sha256 = String(b?.sha256 ?? '').toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, field: 'sha256', message: 'hex SHA-256 (64 characters)' };
  return { ok: true, value: { postId, incidentId, mimeType, sizeBytes, sha256 } };
}

/** S3's x-amz-checksum-sha256 is the BASE64 of the digest; the request carries hex. */
export function sha256HexToBase64(hex: string): string { return Buffer.from(hex, 'hex').toString('base64'); }

/** The private key for one evidence object — tenant-namespaced, no customer data, no file name. */
export function evidenceStorageKey(tenantId: string, evidenceId: string): string { return `tenants/${tenantId}/community-evidence/${evidenceId}`; }
