// sender-identity — C2 audit (Nov 4 2026): SPF / DKIM / DMARC read from DNS; a lookup error is unknown, never missing.
import { describe, it, expect } from 'vitest';
import { checkSenderIdentity, domainOf, type DnsResolver } from './sender-identity';

const nf = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const fake = (txt: Record<string, string[]>, cname: Record<string, string[]> = {}, failAll = false): DnsResolver => ({
  resolveTxt: async (n) => { if (failAll) throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); if (!txt[n]) throw nf(); return txt[n]!.map((x) => [x]); },
  resolveCname: async (n) => { if (failAll) throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }); if (!cname[n]) throw nf(); return cname[n]!; },
});
const NOW = () => Date.parse('2026-11-04T12:00:00Z');

describe('sender identity from DNS', () => {
  it('reads the domain of a From address', () => {
    expect(domainOf('nailsalons@aipowersalon.com')).toBe('aipowersalon.com');
    expect(domainOf('Lotus Nails <hi@Lotus.Example.com>')).toBe('lotus.example.com');
    expect(domainOf('nope')).toBeNull();
  });
  it('verified only when SPF includes the provider, a DKIM selector resolves and DMARC exists', async () => {
    const r = await checkSenderIdentity('a@x.com', fake({ 'x.com': ['v=spf1 include:sendgrid.net ~all'], '_dmarc.x.com': ['v=DMARC1; p=quarantine'] }, { 's1._domainkey.x.com': ['s1.domainkey.u123.wl.sendgrid.net'] }), NOW);
    expect(r).toMatchObject({ domain: 'x.com', spf: 'pass', dkim: 'pass', dmarc: 'pass', dmarcPolicy: 'quarantine', overall: 'verified' });
  });
  it('missing records → failed; SPF without the provider is called out', async () => {
    const r = await checkSenderIdentity('a@x.com', fake({ 'x.com': ['v=spf1 include:_spf.google.com ~all'] }), NOW);
    expect(r).toMatchObject({ spf: 'present_without_provider', dkim: 'missing', dmarc: 'missing', overall: 'failed' });
  });
  it('a DNS error is unknown, never missing or verified', async () => {
    expect(await checkSenderIdentity('a@x.com', fake({}, {}, true), NOW)).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', overall: 'unknown' });
  });
});
