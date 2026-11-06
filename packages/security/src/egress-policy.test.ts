// egress-policy.test — Security Deep Scan §93: the process-wide egress allowlist. Pure rules + the installed hooks
// (no network: enforce refuses BEFORE a socket opens; an allowed loopback call is left to fail on its own).
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { egressPolicyFromEnv, isEgressAllowed, installEgressPolicy, uninstallEgressPolicyForTests, egressReport, egressExempt, EgressBlockedError } from './egress-policy';

afterEach(() => uninstallEgressPolicyForTests());

describe('the list (pure)', () => {
  it('providers by suffix, configured *_URL hosts, EGRESS_ALLOWLIST hosts and .suffixes, loopback and Railway private networking', () => {
    const p = egressPolicyFromEnv({ MEDIA_CDN_BASE_URL: 'https://cdn.salon-media.net/x', CLAMAV_HOST: 'clamav.railway.internal', EGRESS_ALLOWLIST: 'partner.example.org, .trusted.dev', DATABASE_URL: 'postgres://u:p@db.host:5432/aps' });
    for (const h of ['api.twilio.com', 'bolt.cardpointe.com', 'fts.cardconnect.com', 'scl.clover.com', 'api.sendgrid.com', 'api.push.apple.com', 'fcm.googleapis.com', 'b.s3.us-west-2.amazonaws.com',
      'cdn.salon-media.net', 'clamav.railway.internal', 'partner.example.org', 'a.trusted.dev', 'localhost', '127.0.0.1', 'db.host']) expect(isEgressAllowed(h, p), h).toBe(true);
    for (const h of ['evil.example.com', 'twilio.com.evil.io', 'nottwilio.com', 'example.org', '169.254.169.254', '', null]) expect(isEgressAllowed(h as string, p), String(h)).toBe(false);
  });
  it('mode: report by default and for unknown values; off / enforce only when named', () => {
    expect(egressPolicyFromEnv({}).mode).toBe('report');
    expect(egressPolicyFromEnv({ EGRESS_POLICY: 'whatever' }).mode).toBe('report');
    expect(egressPolicyFromEnv({ EGRESS_POLICY: 'ENFORCE' }).mode).toBe('enforce');
    expect(egressPolicyFromEnv({ EGRESS_POLICY: 'off' }).mode).toBe('off');
  });
});

describe('installed hooks', () => {
  it('enforce: fetch and node:https / node:http to an unlisted host are refused before connecting', async () => {
    const lines: string[] = [];
    installEgressPolicy({ EGRESS_POLICY: 'enforce' }, (m) => lines.push(m));
    await expect(fetch('https://evil.example.com/steal')).rejects.toBeInstanceOf(EgressBlockedError);
    expect(() => https.request('https://evil.example.com/x')).toThrow(EgressBlockedError);
    expect(() => http.get({ hostname: '169.254.169.254', path: '/latest/meta-data' })).toThrow(/not on the egress allowlist/);
    expect(lines.filter((l) => l.includes('evil.example.com'))).toHaveLength(1);   // logged once per host
    expect(egressReport().find((r) => r.host === 'evil.example.com')?.count).toBe(2);
  });
  it('enforce: an approved host is not refused by the policy (the call proceeds to the network layer)', async () => {
    installEgressPolicy({ EGRESS_POLICY: 'enforce' }, () => undefined);
    const r = http.request({ hostname: '127.0.0.1', port: 9, path: '/' });
    await new Promise<void>((res) => { r.on('error', () => res()); r.end(); });   // connection refused — not EGRESS_BLOCKED
  });
  it('report: the call is not refused, the host is recorded', async () => {
    const lines: string[] = [];
    installEgressPolicy({}, (m) => lines.push(m));
    const r = https.request({ hostname: 'unlisted.invalid', path: '/' });
    await new Promise<void>((res) => { r.on('error', () => res()); r.end(); });
    expect(lines.join()).toMatch(/unlisted outbound host unlisted\.invalid/);
  });
  it('a user-typed URL (inside egressExempt — safeOutboundRequest) is judged by its own SSRF guard, not this list', () => {
    installEgressPolicy({ EGRESS_POLICY: 'enforce' }, () => undefined);
    const r = egressExempt.run(true, () => https.request({ hostname: 'tenant-webhook.invalid', path: '/' }));
    r.on('error', () => undefined); r.destroy();
  });
  it('off installs nothing', () => {
    installEgressPolicy({ EGRESS_POLICY: 'off' }, () => undefined);
    const r = https.request({ hostname: 'anything.invalid', path: '/' }); r.on('error', () => undefined); r.destroy();
  });
});
