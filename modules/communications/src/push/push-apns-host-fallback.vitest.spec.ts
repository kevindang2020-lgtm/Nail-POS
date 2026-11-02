// push-apns-host-fallback.vitest.spec.ts — Oct 23 2026 (merged from the developer tree): a development-build token belongs to
// APNs' sandbox; production answers BadDeviceToken for it. One retry on the other host; a token bad on BOTH is unregistered
// (revoked) as before; any other error is returned as-is with no retry. The default host stays PRODUCTION.
import { describe, it, expect } from 'vitest';
import { ApnsPushProvider } from './push-providers';

function provider(answers: Record<string, any>) {
  const p: any = Object.create(ApnsPushProvider.prototype);
  p.cfg = { keyId: 'K', teamId: 'T', keyPem: 'x', bundleIds: { customer: 'com.x.customer' } };
  p.topicFor = () => 'com.x.customer';
  const hosts: string[] = [];
  p.sendToHost = async (host: string) => { hosts.push(host); return answers[host]; };
  return { p, hosts };
}
const target = { platform: 'ios', token: 'tok', app: 'customer' } as any, msg = { title: 'Hi' } as any;
const PROD = 'https://api.push.apple.com', SANDBOX = 'https://api.sandbox.push.apple.com';

describe('APNs host fallback', () => {
  it('production first; a sandbox token is delivered by the sandbox on retry', async () => {
    const { p, hosts } = provider({ [PROD]: { ok: false, error: 'apns_BadDeviceToken' }, [SANDBOX]: { ok: true, providerId: 'id1' } });
    expect(await p.send(target, msg)).toEqual({ ok: true, providerId: 'id1' });
    expect(hosts).toEqual([PROD, SANDBOX]);
  });
  it('bad on both hosts → unregistered (the token is revoked)', async () => {
    const { p } = provider({ [PROD]: { ok: false, error: 'apns_BadDeviceToken' }, [SANDBOX]: { ok: false, error: 'apns_BadDeviceToken' } });
    expect(await p.send(target, msg)).toEqual({ ok: false, error: 'unregistered' });
  });
  it('any other answer is final — no second host', async () => {
    const { p, hosts } = provider({ [PROD]: { ok: false, error: 'unregistered' } });
    expect(await p.send(target, msg)).toEqual({ ok: false, error: 'unregistered' });
    expect(hosts).toEqual([PROD]);
  });
});
