// support-attachments-core.vitest.spec.ts — locks the pure attachment rules: MIME allowlist, the 5 MB cap
// (checked both pre-decode and post-decode), filename sanitization, private storage-key shape, and delete rules.
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES, attachmentStorageKey, canDeleteAttachment, safeFileName, validateAttachmentUpload,
} from './support-attachments-core';

const png = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');

describe('validateAttachmentUpload', () => {
  it('accepts an allowed type within the size cap and returns sanitized metadata', () => {
    const r = validateAttachmentUpload({ fileName: 'receipt photo.PNG', contentType: 'image/png', data: png(1024) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fileName).toBe('receipt photo.PNG'); // keeps the display name, already carries the extension
      expect(r.value.ext).toBe('png');
      expect(r.value.bytes.length).toBe(1024);
    }
  });

  it('refuses disallowed MIME types — including executables and html', () => {
    for (const ct of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/zip', '']) {
      const r = validateAttachmentUpload({ fileName: 'x', contentType: ct, data: png(10) });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses payloads over 5 MB (cheap pre-decode bound and exact post-decode check)', () => {
    const over = validateAttachmentUpload({ fileName: 'big.pdf', contentType: 'application/pdf', data: png(ATTACHMENT_MAX_BYTES + 1) });
    expect(over.ok).toBe(false);
    const exact = validateAttachmentUpload({ fileName: 'ok.pdf', contentType: 'application/pdf', data: png(ATTACHMENT_MAX_BYTES) });
    expect(exact.ok).toBe(true);
  });

  it('refuses empty content', () => {
    expect(validateAttachmentUpload({ fileName: 'x.png', contentType: 'image/png', data: '' }).ok).toBe(false);
  });
});

describe('safeFileName', () => {
  it('strips path separators and control characters, appends the validated extension', () => {
    expect(safeFileName('../../etc/passwd', 'txt')).toBe('.. .. etc passwd.txt');
    expect(safeFileName('a\u0000b\u001fc', 'png')).toBe('abc.png');
    expect(safeFileName('', 'pdf')).toBe('attachment.pdf');
  });
  it('caps overly long names', () => {
    expect(safeFileName('x'.repeat(500), 'csv').length).toBeLessThanOrEqual(125 + 4);
  });
});

describe('attachmentStorageKey', () => {
  it('scopes keys under the private support-attachments subtree by tenant and ticket', () => {
    const k = attachmentStorageKey('t1', 'tk1', 'op1', 'png');
    expect(k).toBe('support-attachments/t1/tk1/op1.png');
  });
});

describe('canDeleteAttachment', () => {
  const base = { uploaderUserId: 'u1', userId: 'u1', isTriager: false, ticketStatus: 'open' };
  it('uploader may delete while the ticket is open', () => {
    expect(canDeleteAttachment(base)).toBe(true);
  });
  it('uploader may NOT delete after resolution/closure', () => {
    for (const st of ['resolved', 'closed', 'cancelled']) expect(canDeleteAttachment({ ...base, ticketStatus: st })).toBe(false);
  });
  it('someone else may not delete even while open', () => {
    expect(canDeleteAttachment({ ...base, userId: 'u2' })).toBe(false);
  });
  it('a triager may always delete', () => {
    expect(canDeleteAttachment({ ...base, userId: 'u2', isTriager: true, ticketStatus: 'closed' })).toBe(true);
  });
});
