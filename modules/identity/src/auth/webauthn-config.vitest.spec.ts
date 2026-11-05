// webauthn-config.vitest.spec.ts — the expected origin / RP ID are DERIVED, not configured.
//
// Getting WEBAUTHN_ORIGIN or WEBAUTHN_RP_ID wrong is the single most common cause of "Face ID doesn't work": the
// ceremony fails CLOSED (correct) but looks exactly like a bug, and the browser's error says nothing useful. That
// is a configuration trap, and configuration traps get sprung.
//
// So the values come from the browser's own `Origin` header — which page script cannot forge, and which by
// definition cannot disagree with the browser. The security condition is that we only accept an origin that is on
// the TRUSTED allowlist; otherwise a phishing site could relay a ceremony and have us validate it against its own
// origin.
import { describe, it, expect, afterEach } from 'vitest';
import { webAuthnConfig, withRequestOrigin, trustedWebOrigins, rpIdFor, WebAuthnOriginError } from './webauthn-config';

const ENV = { WEB_CORS_ORIGINS: 'https://customer.aipowersalon.com,https://pos.aipowersalon.com' } as any;
const prev = { ...process.env };
afterEach(() => { process.env = { ...prev }; });

describe('nothing needs configuring', () => {
  it('derives the expected origin and RP ID from the BROWSER\'s own Origin', () => {
    const cfg = withRequestOrigin('https://customer.aipowersalon.com', () => webAuthnConfig(ENV));
    expect(cfg.expectedOrigin).toBe('https://customer.aipowersalon.com');
    expect(cfg.rpId).toBe('customer.aipowersalon.com');   // always a valid RP ID for that origin
  });

  it('a DIFFERENT trusted app origin derives its own values — no single hard-coded host', () => {
    const cfg = withRequestOrigin('https://pos.aipowersalon.com', () => webAuthnConfig(ENV));
    expect(cfg.rpId).toBe('pos.aipowersalon.com');
  });

  it('they can never disagree with the browser, because they ARE the browser\'s value', () => {
    for (const o of ['https://customer.aipowersalon.com', 'https://pos.aipowersalon.com']) {
      const cfg = withRequestOrigin(o, () => webAuthnConfig(ENV));
      expect(cfg.expectedOrigin).toBe(o);
      expect(rpIdFor(o)).toBe(cfg.rpId);
    }
  });
});

describe('SECURITY: only a TRUSTED origin is accepted', () => {
  it('a phishing origin is REFUSED — it cannot have its ceremony validated against itself', () => {
    expect(() => withRequestOrigin('https://evil.example', () => webAuthnConfig(ENV))).toThrow(WebAuthnOriginError);
  });

  it('a missing Origin is refused', () => {
    expect(() => withRequestOrigin(undefined, () => webAuthnConfig(ENV))).toThrow(WebAuthnOriginError);
    expect(() => withRequestOrigin('', () => webAuthnConfig(ENV))).toThrow(WebAuthnOriginError);
  });

  it('a look-alike host is refused', () => {
    expect(() => withRequestOrigin('https://customer.aipowersalon.com.evil.example', () => webAuthnConfig(ENV)))
      .toThrow(WebAuthnOriginError);
  });

  it('NATIVE origins are excluded — native uses Apple/Android biometrics, never WebAuthn', () => {
    expect(trustedWebOrigins(ENV)).not.toContain('capacitor://localhost');
    expect(() => withRequestOrigin('capacitor://localhost', () => webAuthnConfig(ENV))).toThrow(WebAuthnOriginError);
  });

  it('the error says exactly what to fix — this is the failure that otherwise costs an afternoon', () => {
    const e = (() => { try { withRequestOrigin('https://evil.example', () => webAuthnConfig(ENV)); } catch (x) { return x as Error; } })()!;
    expect(e.message).toMatch(/not a trusted web origin/i);
    expect(e.message).toMatch(/WEB_CORS_ORIGINS/);
    expect(e.message).toMatch(/customer\.aipowersalon\.com/);   // and lists what IS trusted
  });
});

describe('explicit overrides still work', () => {
  it('WEBAUTHN_ORIGIN + WEBAUTHN_RP_ID win when both are set', () => {
    const env = { ...ENV, WEBAUTHN_ORIGIN: 'https://staging.aipowersalon.com', WEBAUTHN_RP_ID: 'aipowersalon.com' };
    const cfg = withRequestOrigin('https://customer.aipowersalon.com', () => webAuthnConfig(env));
    expect(cfg.expectedOrigin).toBe('https://staging.aipowersalon.com');
    expect(cfg.rpId).toBe('aipowersalon.com');
  });

  it('setting only ONE of them does not half-apply — it still derives from the request', () => {
    const env = { ...ENV, WEBAUTHN_RP_ID: 'aipowersalon.com' };
    const cfg = withRequestOrigin('https://customer.aipowersalon.com', () => webAuthnConfig(env));
    expect(cfg.expectedOrigin).toBe('https://customer.aipowersalon.com');   // from the browser, not a stale env
    expect(cfg.rpId).toBe('aipowersalon.com');                              // the override
  });
});

describe('concurrency', () => {
  it('two simultaneous requests never see each other\'s origin', async () => {
    const a = withRequestOrigin('https://customer.aipowersalon.com', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return webAuthnConfig(ENV).rpId;
    });
    const b = withRequestOrigin('https://pos.aipowersalon.com', async () => webAuthnConfig(ENV).rpId);
    expect(await Promise.all([a, b])).toEqual(['customer.aipowersalon.com', 'pos.aipowersalon.com']);
  });
});
