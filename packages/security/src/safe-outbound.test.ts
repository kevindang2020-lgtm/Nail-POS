// safe-outbound.test.ts — Security Deep Scan D1/D7: the blocklist covers every smuggled form, the URL policy refuses
// internal names / http / odd ports / non-allowlisted hosts, the CONNECTION's own lookup refuses a private answer
// (so a rebinding name cannot get through), and a 3xx answer is returned, never followed.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { isBlockedAddress, checkOutboundUrl, guardedLookup, safeOutboundRequest } from './safe-outbound';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local/metadata, CGNAT, benchmarking, multicast and IPv6 smuggling forms', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '0.0.0.0', '255.255.255.255',
      '::1', '[::1]', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::', '2001::1', 'not-an-ip'])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });
  it('lets public addresses through', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe('checkOutboundUrl', () => {
  it('refuses http, credentials, internal names, private literals and odd ports', () => {
    for (const u of ['http://example.com', 'https://user:pw@example.com', 'https://localhost/x', 'https://api.railway.internal/x', 'https://printer.local',
      'https://intranet/x', 'https://127.0.0.1/', 'https://[::1]/', 'https://[::ffff:7f00:1]/', 'https://example.com:8443/'])
      expect(checkOutboundUrl(u).ok, u).toBe(false);
    expect(checkOutboundUrl('https://hooks.example.com/in?x=1').ok).toBe(true);
    expect(checkOutboundUrl('https://fts.cardconnect.com:6443/x', { allowPorts: [6443] }).ok).toBe(true);
  });
  it('a host allowlist is exact or *.suffix', () => {
    const p = { allowHosts: ['*.cardconnect.com', 'api.example.com'] };
    expect(checkOutboundUrl('https://fts.cardconnect.com/', p).ok).toBe(true);
    expect(checkOutboundUrl('https://api.example.com/', p).ok).toBe(true);
    expect(checkOutboundUrl('https://cardconnect.com.evil.io/', p).ok).toBe(false);
    expect(checkOutboundUrl('https://evilcardconnect.com/', p).ok).toBe(false);
  });
});

describe('the connection lookup is the check (rebinding closed)', () => {
  const resolverOf = (addrs: string[]) => ((_h: string, _o: any, cb: any) => cb(null, addrs.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })))) as any;
  it('refuses when ANY answer is private', async () => {
    const r = await new Promise<any>((res) => guardedLookup('evil.example', {}, (err, addr) => res({ err, addr }), resolverOf(['93.184.216.34', '10.0.0.5'])));
    expect(r.err?.code).toBe('EBLOCKEDADDR');
  });
  it('passes a public answer to the socket', async () => {
    const r = await new Promise<any>((res) => guardedLookup('ok.example', {}, (err, addr, fam) => res({ err, addr, fam }), resolverOf(['93.184.216.34'])));
    expect(r.err).toBeNull(); expect(r.addr).toBe('93.184.216.34'); expect(r.fam).toBe(4);
  });
  it('safeOutboundRequest hands the guarded lookup to the connection and maps a block to "Unsafe URL"', async () => {
    let seenLookup: any = null;
    const fakeRequest: any = (opts: any) => { seenLookup = opts.lookup; const req: any = new EventEmitter(); req.write = () => {}; req.end = () => { opts.lookup('evil.example', {}, (err: any) => req.emit('error', err)); }; req.destroy = () => {}; return req; };
    const r = await safeOutboundRequest('https://evil.example/hook', { body: '{}' }, {}, { request: fakeRequest, resolver: resolverOf(['127.0.0.1']) });
    expect(typeof seenLookup).toBe('function');
    expect(r).toEqual({ ok: false, status: null, error: 'Unsafe URL' });
  });
  it('a 307 is an answer, not a hop: returned as not-ok, nothing follows it', async () => {
    let calls = 0;
    const fakeRequest: any = (_opts: any, onRes: any) => { calls++; const req: any = new EventEmitter(); req.write = () => {}; req.destroy = () => {};
      req.end = () => { const res: any = new EventEmitter(); res.statusCode = 307; res.headers = { location: 'https://127.0.0.1:3000/internal' }; res.destroy = () => {}; onRes(res); res.emit('end'); }; return req; };
    const r = await safeOutboundRequest('https://public.example/hook', { body: '{}' }, {}, { request: fakeRequest, resolver: resolverOf(['93.184.216.34']) });
    expect(r.ok).toBe(false); expect(r.status).toBe(307); expect(calls).toBe(1);
  });
});
