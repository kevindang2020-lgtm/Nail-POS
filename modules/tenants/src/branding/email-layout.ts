// email-layout.ts — ONE shared branded HTML email layout (AI PowerSalon). Used by the notifications/reminders
// email path so every outbound email carries the official logo header, warm-white body, gold action button, and
// a consistent footer — instead of a different logo embedded per template. Plain-text fallback is the raw body.
import { DEFAULT_BRANDING } from './branding.service';
import { portalUrl } from '@aipowersalon/config';

// Absolute logo URL for emails (relative /brand paths don't resolve in inboxes).
// pos.* is the served host; the previous app.* fallback resolved nowhere, which broke the logo image in every
// branded email. Set PUBLIC_APP_URL in production.
// Derived from WEB_CORS_ORIGINS rather than a hard-coded guess — a branded-email logo pointing at a host that
// does not exist renders as a broken image in every customer's inbox, and nothing on our side reports it.
const PUBLIC_BASE = portalUrl();
const LOGO_URL = process.env.BRAND_EMAIL_LOGO_URL || `${PUBLIC_BASE}/brand/aipowersalon-logo.png`;

function escapeHtml(s: string){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] as string)); }

export interface BrandedEmailOptions { salonName?: string; cta?: { label: string; url: string } | null; }

/** Wrap a plain message body in the shared branded layout. Body newlines become paragraphs. */
export function renderBrandedEmail(body: string, opts: BrandedEmailOptions = {}): string {
  const C = DEFAULT_BRANDING;
  const paras = String(body).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.5;color:${C.text_color}">${escapeHtml(p).replace(/\n/g,'<br/>')}</p>`).join('');
  // Constitution 12 §116: escaping does not stop a `javascript:` or `data:` URL — it is valid HTML text. Only http(s)
  // links render as a button; anything else is dropped. (No caller passes a CTA today; this keeps a future one safe.)
  const cta = opts.cta && /^https?:\/\//i.test(String(opts.cta.url)) ? `<tr><td style="padding:6px 0 4px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:${C.primary_color};color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600">${escapeHtml(opts.cta.label)}</a></td></tr>` : '';
  const footerSalon = opts.salonName ? `${escapeHtml(opts.salonName)} · powered by ${C.platform_name}` : `${C.platform_name} — ${C.tagline}`;
  return `<!doctype html><html><body style="margin:0;background:${C.surface_color};font-family:Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface_color};padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E7DCC9;border-radius:14px;overflow:hidden">
        <tr><td align="center" style="padding:22px 24px 8px;background:#FEFDFC">
          <img src="${LOGO_URL}" alt="${C.platform_name}" width="190" style="width:190px;max-width:62%;height:auto;display:block" />
        </td></tr>
        <tr><td style="padding:18px 28px 8px">${paras}${cta ? `<table role="presentation">${cta}</table>` : ''}</td></tr>
        <tr><td style="padding:14px 28px 22px;border-top:1px solid #E7DCC9;color:#8A7A66;font-size:12px">${footerSalon}</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
