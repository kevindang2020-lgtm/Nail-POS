// provider-breaker.test — BUILD_PLAN Phase 2 (Constitution 4 §117): the provider circuit BLOCKS at the chokepoint.
// Before, instrumentedFetch recorded "open" and still called the provider: a dead SMS provider took 15 s per text, a
// dead gateway 60 s per card. Now an open circuit refuses the call without touching the network.
import { describe, it, expect, beforeEach } from 'vitest';
import { instrumentedFetch, resetProviderHealth, providerHealth, providerBreakers, setProviderBreakerClock } from './provider-telemetry';
import { CircuitOpenError, DEFAULT_BREAKER_POLICY as P } from './circuit-breaker';

let wall = 1_000_000;
beforeEach(() => { resetProviderHealth(); wall = 1_000_000; setProviderBreakerClock(() => wall); });

const counting = (status: number | 'throw') => {
  const calls: string[] = [];
  const f = async (url: string) => { calls.push(url); if (status === 'throw') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return { status }; };
  return { calls, f };
};

describe('provider circuit breaker blocks at instrumentedFetch', () => {
  it('after the threshold of provider failures the next call never reaches the provider', async () => {
    const { calls, f } = counting(503);
    const http = instrumentedFetch('twilio', f);
    for (let i = 0; i < P.failureThreshold; i++) await http('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(calls).toHaveLength(P.failureThreshold);
    await expect(http('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toHaveLength(P.failureThreshold);                       // refused without a network call
    expect(providerHealth('twilio').status).toBe('OUTAGE');
  });

  it('network errors count; our own 4xx never opens it', async () => {
    const bad = counting(401); const http401 = instrumentedFetch('email', bad.f);
    for (let i = 0; i < 20; i++) await http401('https://api.sendgrid.com/v3/mail/send');
    expect(bad.calls).toHaveLength(20);
    const down = counting('throw'); const httpDown = instrumentedFetch('email', down.f);
    for (let i = 0; i < P.failureThreshold; i++) await expect(httpDown('https://api.sendgrid.com/v3/mail/send')).rejects.toThrow(/ECONNREFUSED/);
    await expect(httpDown('https://api.sendgrid.com/v3/mail/send')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(down.calls).toHaveLength(P.failureThreshold);
  });

  it('one host failing does not block another host of the same provider (one salon\'s gateway site ≠ every salon\'s)', async () => {
    const dead = counting('throw'); const ok = counting(200);
    const httpA = instrumentedFetch('cardpointe', dead.f); const httpB = instrumentedFetch('cardpointe', ok.f);
    for (let i = 0; i < P.failureThreshold; i++) await expect(httpA('https://badsite.cardconnect.com/cardconnect/rest/auth')).rejects.toThrow();
    await expect(httpA('https://badsite.cardconnect.com/cardconnect/rest/auth')).rejects.toBeInstanceOf(CircuitOpenError);
    expect((await httpB('https://goodsite.cardconnect.com/cardconnect/rest/auth')).status).toBe(200);
  });

  it('after openMs exactly one probe goes through; its success closes the circuit', async () => {
    const state = { status: 503 as number };
    const calls: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = async () => { calls.push(wall); if (state.status === 200) await gate; return { status: state.status }; };
    const http = instrumentedFetch('fcm', f);
    for (let i = 0; i < P.failureThreshold; i++) await http('https://fcm.googleapis.com/v1/projects/p/messages:send');
    wall += P.openMs;
    state.status = 200;
    const probe = http('https://fcm.googleapis.com/v1/projects/p/messages:send');      // the probe, held open
    await expect(http('https://fcm.googleapis.com/v1/projects/p/messages:send')).rejects.toBeInstanceOf(CircuitOpenError);
    release(); expect((await probe).status).toBe(200);
    expect((await http('https://fcm.googleapis.com/v1/projects/p/messages:send')).status).toBe(200);   // closed
    expect(calls).toHaveLength(P.failureThreshold + 2);
  });

  it('a failed probe opens it again for another openMs', async () => {
    const { calls, f } = counting(500);
    const http = instrumentedFetch('apns', f);
    for (let i = 0; i < P.failureThreshold; i++) await http('https://api.push.apple.com/3/device/x');
    wall += P.openMs; await http('https://api.push.apple.com/3/device/x');              // probe → 500
    await expect(http('https://api.push.apple.com/3/device/x')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toHaveLength(P.failureThreshold + 1);
    expect(providerBreakers().isOpen('apns|api.push.apple.com')).toBe(true);
  });

  it('a transport that opts out (the card terminal, which waits on the customer) is never blocked', async () => {
    const { calls, f } = counting('throw');
    const http = instrumentedFetch('cardpointe', f, undefined, { timeoutMs: 180_000, breaker: false });
    for (let i = 0; i < P.failureThreshold + 3; i++) await expect(http('https://bolt.cardpointe.com/api/v3/authCard')).rejects.toThrow(/ECONNREFUSED/);
    expect(calls).toHaveLength(P.failureThreshold + 3);
  });
});
