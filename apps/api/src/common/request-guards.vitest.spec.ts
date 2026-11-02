// request-guards.vitest.spec.ts — Security Deep Scan C5/C9/D3: the marketing site is never a credentialed CORS origin,
// a cookie-authenticated write from a foreign origin is refused (CSRF), anonymous bodies are small, and form bodies are
// parsed only on provider callback paths.
import { describe, it, expect } from 'vitest';
import express from 'express';
import { computeAllowedOrigins, corsDecision, csrfVerdict, isMarketingPath } from './allowed-origins';
import { bodyParsers, hasCredentials, isFormBodyPath } from './request-body-limits';

const env = { NODE_ENV: 'production', WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com,https://aipowersalon.com,https://admin.aipowersalon.com' } as any;
const allowed = computeAllowedOrigins(env);

describe('CORS', () => {
  it('drops the marketing site from the credentialed list even when WEB_CORS_ORIGINS names it', () => {
    expect(allowed).toContain('https://pos.aipowersalon.com');
    expect(allowed).not.toContain('https://aipowersalon.com');
  });
  it('marketing origin: uncredentialed and only on /public/website/*', () => {
    expect(corsDecision('https://aipowersalon.com', '/public/website/applications', allowed)).toEqual({ origin: true, credentials: false });
    expect(corsDecision('https://www.aipowersalon.com', '/pos/customers', allowed)).toEqual({ origin: false, credentials: false });
    expect(corsDecision('https://pos.aipowersalon.com', '/pos/customers', allowed)).toEqual({ origin: true, credentials: true });
    expect(corsDecision('https://evil.example', '/pos/customers', allowed).origin).toBe(false);
    expect(isMarketingPath('/api/v1/public/website/leads')).toBe(true);
  });
});

describe('CSRF (cookie-authenticated writes)', () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers });
  it('refuses a cookie write from the marketing site or another site; allows the app origin', () => {
    expect(csrfVerdict(req('POST', { cookie: 'aps_session=x', origin: 'https://aipowersalon.com' }), allowed).ok).toBe(false);
    expect(csrfVerdict(req('DELETE', { cookie: 'aps_platform=x', origin: 'https://evil.example' }), allowed).ok).toBe(false);
    expect(csrfVerdict(req('POST', { cookie: 'aps_session=x', 'sec-fetch-site': 'cross-site' }), allowed).ok).toBe(false);
    expect(csrfVerdict(req('POST', { cookie: 'aps_session=x', origin: 'null' }), allowed).ok).toBe(false);
    expect(csrfVerdict(req('POST', { cookie: 'aps_session=x', origin: 'https://pos.aipowersalon.com' }), allowed).ok).toBe(true);
  });
  it('reads, bearer/API-key callers, cookieless callers and same-origin/native writes pass', () => {
    expect(csrfVerdict(req('GET', { cookie: 'aps_session=x', origin: 'https://evil.example' }), allowed).ok).toBe(true);
    expect(csrfVerdict(req('POST', { authorization: 'Bearer t', origin: 'https://evil.example' }), allowed).ok).toBe(true);
    expect(csrfVerdict(req('POST', { origin: 'https://evil.example' }), allowed).ok).toBe(true);
    expect(csrfVerdict(req('POST', { cookie: 'aps_session=x', 'sec-fetch-site': 'same-origin' }), allowed).ok).toBe(true);
  });
});

describe('body parsers', () => {
  it('credentials and form paths are recognised', () => {
    expect(hasCredentials({ headers: { cookie: 'aps_session=1' } } as any)).toBe(true);
    expect(hasCredentials({ headers: { authorization: 'Bearer x' } } as any)).toBe(true);
    expect(hasCredentials({ headers: { cookie: 'theme=dark' } } as any)).toBe(false);
    expect(isFormBodyPath('/webhooks/twilio/sms/inbound')).toBe(true);
    expect(isFormBodyPath('/api/v1/voice/incoming')).toBe(true);
    expect(isFormBodyPath('/pos/webhooks')).toBe(false);
    expect(isFormBodyPath('/pos/customers')).toBe(false);
  });
  it('anonymous JSON over the public limit is 413; the same body signed in is accepted; a form body is parsed only on callback paths; rawBody is kept', async () => {
    const app = express(); for (const p of bodyParsers({ PUBLIC_BODY_LIMIT: '1kb', MAX_BODY_SIZE: '1mb' } as any)) app.use(p);
    app.post('*', (req: any, res) => res.json({ body: req.body ?? null, raw: req.rawBody ? req.rawBody.length : 0 }));
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.type }));
    const srv = app.listen(0); const port = (srv.address() as any).port; const url = (p: string) => `http://127.0.0.1:${port}${p}`;
    try {
      const big = JSON.stringify({ x: 'a'.repeat(5000) });
      expect((await fetch(url('/public/booking/hold'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: big })).status).toBe(413);
      const ok = await fetch(url('/pos/customers/import'), { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'aps_session=1' }, body: big });
      expect(ok.status).toBe(200); expect((await ok.json()).raw).toBe(big.length);
      const formJson = await (await fetch(url('/pos/customers'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' })).json();
      expect(formJson.body).toEqual({});   // not parsed off the callback paths (express leaves {} only when a parser ran) or null
      const tw = await (await fetch(url('/webhooks/twilio/sms/inbound'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'From=%2B1&Body=STOP' })).json();
      expect(tw.body).toEqual({ From: '+1', Body: 'STOP' }); expect(tw.raw).toBeGreaterThan(0);
    } finally { srv.close(); }
  });
});
