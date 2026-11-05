// support-attachments-core.ts — pure validation + key derivation for Support Center ticket attachments.
// Storage itself REUSES the established MediaStorage port (tech-profile/media-storage.ts): same interface, same
// local-disk driver, but a SEPARATE PRIVATE root — support attachments must never be resolvable by the public
// /media/* controller, so their keys live under a different storage root and are streamed only through the
// authorized tenant/help endpoints. Metadata never exposes the storage key (same rule as onboarding documents).

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file — matches the platform's upload ceiling.
export const ATTACHMENT_MAX_PER_TICKET = 10;

// Conservative allowlist: images the support team can view inline, plus the document types salons actually send.
export const ATTACHMENT_ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

export interface AttachmentUploadInput {
  fileName?: unknown;
  contentType?: unknown;
  /** base64 payload (no data-URL prefix). */
  data?: unknown;
}

export interface ValidatedAttachment {
  fileName: string;
  contentType: string;
  ext: string;
  bytes: Buffer;
}

/** Strip path separators/control chars, collapse whitespace, cap length — the stored display name. */
export function safeFileName(raw: string, ext: string): string {
  const base = String(raw)
    .replace(/[/\\]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const named = base || 'attachment';
  return named.toLowerCase().endsWith('.' + ext) ? named : `${named}.${ext}`;
}

export function validateAttachmentUpload(input: AttachmentUploadInput): { ok: true; value: ValidatedAttachment } | { ok: false; error: string } {
  const contentType = String(input.contentType ?? '').toLowerCase().split(';')[0].trim();
  const ext = ATTACHMENT_ALLOWED_TYPES[contentType];
  if (!ext) return { ok: false, error: 'That file type is not allowed. Allowed: PNG, JPEG, WebP, PDF, TXT, CSV.' };
  const b64 = String(input.data ?? '');
  if (!b64) return { ok: false, error: 'The file content is empty.' };
  // 4/3 expansion bound refuses oversized payloads before decoding the whole thing.
  if (b64.length > Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 8) return { ok: false, error: 'The file is larger than 5 MB.' };
  let bytes: Buffer;
  try { bytes = Buffer.from(b64, 'base64'); } catch { return { ok: false, error: 'The file content is not valid base64.' }; }
  if (bytes.length === 0) return { ok: false, error: 'The file content is empty.' };
  if (bytes.length > ATTACHMENT_MAX_BYTES) return { ok: false, error: 'The file is larger than 5 MB.' };
  return { ok: true, value: { fileName: safeFileName(String(input.fileName ?? ''), ext), contentType, ext, bytes } };
}

/** Private-root storage key: tenant/ticket scoped, opaque id, extension from the validated type only. */
export function attachmentStorageKey(tenantId: string, ticketId: string, opaqueId: string, ext: string): string {
  return `support-attachments/${tenantId}/${ticketId}/${opaqueId}.${ext}`;
}

/** Delete rule: the uploader may remove their own attachment while the ticket is still open; triagers may always. */
export function canDeleteAttachment(args: { uploaderUserId: string | null; userId: string | null; isTriager: boolean; ticketStatus: string }): boolean {
  if (args.isTriager) return true;
  const open = !/^(resolved|closed|cancelled)$/i.test(args.ticketStatus || '');
  return open && !!args.userId && args.uploaderUserId === args.userId;
}
