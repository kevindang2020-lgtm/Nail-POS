// Security Deep Scan D4: skill-request evidence links are https or same-origin paths only.
import { describe, it, expect } from 'vitest';
import { isSafeEvidenceLink, assertEvidenceLinks } from './tech.service';

describe('skill evidence links', () => {
  it('refuses script, data, http and protocol-relative links', () => {
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'http://x.example/a.png', '//evil.example/a.png', 'https://u:p@x.example', 'vbscript:x'])
      expect(isSafeEvidenceLink(bad), bad).toBe(false);
    expect(() => assertEvidenceLinks({ certificateEvidence: 'javascript:alert(1)' })).toThrow();
    expect(() => assertEvidenceLinks({ supportingPhotos: ['https://ok.example/a.png', 'data:image/png;base64,AA'] })).toThrow();
  });
  it('accepts https links, uploaded media paths and empty values', () => {
    for (const ok of ['https://cdn.example/cert.pdf', '/media/tenant/abc.jpg', '', null, undefined]) expect(isSafeEvidenceLink(ok), String(ok)).toBe(true);
    expect(() => assertEvidenceLinks({ certificateEvidence: 'https://x.example/c.pdf', supportingPhotos: ['/media/a.jpg'] })).not.toThrow();
  });
});
