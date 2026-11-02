// CaptchaChallenge.tsx — the human check a code send can demand (BUILD_PLAN Phase 4).
//
// The risk engine challenges suspicious sends (a CAPTCHA costs a person three seconds and a script the whole attack);
// before this component no client could render one, so every challenged request was simply refused. It loads the
// platform's provider (Cloudflare Turnstile, hCaptcha or reCAPTCHA — whichever the API is configured for) and hands the
// token back. With no provider configured it says so — the salon is the honest next step, not a spinner.
import { useEffect, useRef, useState } from 'react';
import type { CaptchaClientConfig } from '@aipowersalon/api-contracts';

const SCRIPTS: Record<NonNullable<CaptchaClientConfig['provider']>, { src: string; global: string }> = {
  turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit', global: 'hcaptcha' },
  recaptcha: { src: 'https://www.google.com/recaptcha/api.js?render=explicit', global: 'grecaptcha' },
};

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-captcha="${src}"]`);
  if (existing) return existing.dataset.loaded ? Promise.resolve() : new Promise((r, j) => { existing.addEventListener('load', () => r()); existing.addEventListener('error', () => j(new Error('captcha script'))); });
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true; s.dataset.captcha = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('captcha script'));
    document.head.appendChild(s);
  });
}

export function CaptchaChallenge({ config, onToken }: { config: CaptchaClientConfig | null; onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!config?.provider || !config.siteKey || !box.current) return;
    const { src, global } = SCRIPTS[config.provider];
    let cancelled = false;
    loadScript(src).then(() => {
      const api = (window as any)[global];
      if (cancelled || !api?.render || !box.current) return;
      const render = () => api.render(box.current, { sitekey: config.siteKey, callback: (t: string) => onToken(t) });
      if (config.provider === 'recaptcha' && api.ready) api.ready(render); else render();
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [config?.provider, config?.siteKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) return <div role="status" style={{ fontSize: 13, color: '#8A7A66' }}>Loading the security check…</div>;
  if (!config.provider || failed) {
    return <div role="alert" data-testid="captcha-unavailable" style={{ fontSize: 13, color: '#8F3226' }}>We need to confirm you’re not a robot, and we can’t show that check right now. Please call the salon to book.</div>;
  }
  return <div data-testid="captcha-box" ref={box} />;
}
