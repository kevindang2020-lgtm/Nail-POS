// captcha.ts — the human check for a challenged booking-code send (Nov 5 2026 sweep).
//
// The server's risk engine can answer POST /customer/booking/verification/send with 428 { status: 'captcha_required' }.
// It FAILS CLOSED: without a solved captcha token no code is sent. The public booking page (apps/booking-public) always
// handled this; the customer app did not, so a challenged customer hit a dead end ("Please complete the verification
// challenge") with nothing to complete. This shows the provider's widget in an overlay and returns its token.
//
// Provider + public site key come from GET /customer/booking/verification/captcha (null when not configured). The
// script hosts below are what tooling's CSP generator allows for apps that use a captcha (generate-app-headers.mjs).
import { api } from '../api/client';

type CaptchaConfig = { provider: 'turnstile' | 'hcaptcha' | 'recaptcha' | null; siteKey: string | null };

const PROVIDERS: Record<string, { src: string; global: string }> = {
  turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit', global: 'hcaptcha' },
  recaptcha: { src: 'https://www.google.com/recaptcha/api.js?render=explicit', global: 'grecaptcha' },
};

export const CAPTCHA_UNAVAILABLE = 'We need to confirm you’re not a robot, and we can’t show that check right now. Please call the salon to book.';

/** Is this error the server asking for a human check? */
export function isCaptchaRequired(e: any): boolean {
  return e?.status === 428 && (e?.details?.status === 'captcha_required' || e?.code === 'captcha_required');
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { loaded.delete(src); reject(new Error('captcha script failed to load')); };
      document.head.appendChild(el);
    });
    loaded.set(src, p);
  }
  return p;
}

/** Shows the widget in an overlay. Resolves the token, or null when the customer cancels or the check can't be shown. */
export async function solveCaptcha(): Promise<string | null> {
  let cfg: CaptchaConfig;
  try { cfg = await api.get<CaptchaConfig>('/customer/booking/verification/captcha'); } catch { return null; }
  const prov = cfg?.provider ? PROVIDERS[cfg.provider] : null;
  if (!prov || !cfg.siteKey) return null;
  try { await loadScript(prov.src); } catch { return null; }
  const g = (window as any)[prov.global];
  if (!g?.render) return null;

  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Security check');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;padding:20px;max-width:360px;width:100%;text-align:center;font:14px/1.4 system-ui,sans-serif;color:#222';
    const title = document.createElement('p');
    title.textContent = 'Please confirm you’re not a robot to get your code.';
    title.style.cssText = 'margin:0 0 12px;font-weight:600';
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;justify-content:center;min-height:70px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'margin-top:12px;background:none;border:0;color:#666;font:inherit;cursor:pointer;padding:8px 12px';
    card.append(title, box, cancel); overlay.append(card); document.body.append(overlay);

    let done = false;
    const finish = (t: string | null) => { if (done) return; done = true; overlay.remove(); resolve(t); };
    cancel.onclick = () => finish(null);
    const render = () => {
      try { g.render(box, { sitekey: cfg.siteKey, callback: (t: string) => finish(t), 'error-callback': () => finish(null) }); }
      catch { finish(null); }
    };
    if (cfg.provider === 'recaptcha' && g.ready) g.ready(render); else render();
  });
}

/** Runs a send; when the server asks for a human check, shows it once and retries with the token. */
export async function withCaptcha<T>(send: (captchaToken?: string) => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (e: any) {
    if (!isCaptchaRequired(e)) throw e;
    const token = await solveCaptcha();
    if (!token) throw Object.assign(new Error(CAPTCHA_UNAVAILABLE), { code: 'captcha_unavailable' });
    return send(token);
  }
}
