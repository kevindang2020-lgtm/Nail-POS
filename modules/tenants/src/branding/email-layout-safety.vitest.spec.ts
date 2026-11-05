// email-layout-safety.vitest.spec — Constitution 12 §116: outgoing HTML email cannot be injected into.
import { describe, it, expect } from 'vitest';
import { renderBrandedEmail } from './email-layout';

describe('every outgoing HTML email is escaped', () => {
  it('a customer-supplied value with markup renders as TEXT (a booking under a crafted "name")', () => {
    const html = renderBrandedEmail('Hi <img src=x onerror=alert(1)> — see you soon', { salonName: 'Luxe <script>x</script>' });
    expect(html).not.toMatch(/<img src=x/); expect(html).not.toMatch(/<script>x<\/script>/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('a javascript: or data: link never becomes a button — escaping alone would not stop it', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
      const html = renderBrandedEmail('Body', { cta: { label: 'Click', url } } as any);
      expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    }
  });
  it('an https link does render, escaped', () => {
    const html = renderBrandedEmail('Body', { cta: { label: 'Book', url: 'https://app.example.com/b?x="1"' } } as any);
    expect(html).toContain('href="https://app.example.com/b?x=&quot;1&quot;"');
  });
});
