import { describe, it, expect } from 'vitest';
import { evidenceChecklist, validateUpload, modeledScan, EICAR_MARKER, MAX_EVIDENCE_BYTES } from './evidence-policy-core';

describe('evidenceChecklist', () => {
  it('returns reason-specific required + recommended items', () => {
    const c = evidenceChecklist('fraud_card_absent');
    expect(c.required).toContain('Proof of service delivery');
    expect(c.recommended.length).toBeGreaterThan(0);
  });
  it('falls back to a generic checklist for unknown categories', () => {
    const c = evidenceChecklist('mystery');
    expect(c.required).toContain('Itemized receipt');
  });
});

describe('validateUpload', () => {
  const ok = { fileName: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };
  it('accepts an allowed pdf', () => { expect(validateUpload(ok).ok).toBe(true); });
  it('accepts png/jpeg/docx/xlsx', () => {
    expect(validateUpload({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 10 }).ok).toBe(true);
    expect(validateUpload({ fileName: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 10 }).ok).toBe(true);
  });
  it('rejects executables by extension even with a benign mime', () => {
    const r = validateUpload({ fileName: 'evil.exe', mimeType: 'application/pdf', sizeBytes: 10 });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/Executable/);
  });
  it('rejects .js and .sh scripts', () => {
    expect(validateUpload({ fileName: 'x.js', mimeType: 'application/pdf', sizeBytes: 10 }).ok).toBe(false);
    expect(validateUpload({ fileName: 'x.sh', mimeType: 'application/pdf', sizeBytes: 10 }).ok).toBe(false);
  });
  it('rejects unsupported mime types', () => {
    expect(validateUpload({ fileName: 'x.txt', mimeType: 'text/plain', sizeBytes: 10 }).ok).toBe(false);
  });
  it('rejects oversize files', () => {
    expect(validateUpload({ ...ok, sizeBytes: MAX_EVIDENCE_BYTES + 1 }).ok).toBe(false);
  });
  it('requires a name and a positive size', () => {
    expect(validateUpload({ fileName: '', mimeType: 'application/pdf', sizeBytes: 10 }).ok).toBe(false);
    expect(validateUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok).toBe(false);
  });
});

describe('modeledScan', () => {
  it('flags EICAR content as infected, otherwise clean', () => {
    expect(modeledScan(`prefix ${EICAR_MARKER} suffix`)).toBe('infected');
    expect(modeledScan('a normal receipt')).toBe('clean');
    expect(modeledScan(null)).toBe('clean');
  });
});
