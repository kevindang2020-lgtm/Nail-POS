// safe-outbound.ts — Security Deep Scan mandate §91–§93 (Oct 23 2026, finding D1/D7): the ONE way to call a URL that a
// tenant, an owner or a Super Admin typed in. The old webhook sender checked the FIRST URL and then let fetch() resolve the
// name again and follow redirects, so a public https URL answering 307 delivered the signed POST to 127.0.0.1 or
// *.railway.internal (reproduced), and a DNS answer that changed between the check and the connection (rebinding) got
// through. Here:
//   • https only, no credentials in the URL, port 443 unless the caller allows another;
//   • the connection's OWN DNS lookup is the check (node:https `lookup` hook) — every address it would connect to is
//     tested against the IANA special-purpose ranges (IPv4, IPv6, IPv4-mapped/compatible, NAT64, 6to4, Teredo), so the
//     checked address IS the connected address (rebinding closed);
//   • redirects are never followed (a 3xx is an answer, not a hop);
//   • a hard timeout and a response-size cap.
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';

const BLOCK = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCK.addSubnet(net, bits, 'ipv4');
BLOCK.addAddress('255.255.255.255', 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['::', 96] /* IPv4-compatible */, ['64:ff9b::', 96] /* NAT64 */, ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 32] /* Teredo */, ['2001:db8::', 32], ['2002::', 16] /* 6to4 */, ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
] as const) BLOCK.addSubnet(net, bits, 'ipv6');

/** True for any address an attacker-influenced request must never reach (loopback, private, link-local / cloud
 *  metadata, CGNAT, benchmarking, documentation, multicast, reserved, and IPv4 smuggled inside IPv6 forms). */
export function isBlockedAddress(raw: string): boolean {
  let ip = String(raw ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const zone = ip.indexOf('%'); if (zone >= 0) ip = ip.slice(0, zone);
  const fam = isIP(ip);
  if (fam === 0) return true;                                        // not an address at all → never connect
  if (fam === 4) return BLOCK.check(ip, 'ipv4');
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1) → judge the embedded IPv4
  const mapped = ip.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (isIP(tail) === 4) return BLOCK.check(tail, 'ipv4');
    const h = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (h) { const a = parseInt(h[1], 16), b = parseInt(h[2], 16); return BLOCK.check(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, 'ipv4'); }
    return true;
  }
  return BLOCK.check(ip, 'ipv6');
}

export interface OutboundUrlPolicy {
  /** exact hostnames (lowercase) or `*.suffix` patterns the URL must match; omitted = any public host */
  allowHosts?: readonly string[];
  /** ports other than 443 that are acceptable (e.g. CardPointe's 6443) */
  allowPorts?: readonly number[];
}

/** Static checks on the URL itself (no DNS). */
export function checkOutboundUrl(url: string, policy: OutboundUrlPolicy = {}): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(String(url)); } catch { return { ok: false, reason: 'Invalid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'URL must use https' };
  if (u.username || u.password) return { ok: false, reason: 'Credentials in the URL are not allowed' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'Invalid URL' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || !host.includes('.') && isIP(host) === 0)
    return { ok: false, reason: 'Internal host not allowed' };
  if (isIP(host) && isBlockedAddress(host)) return { ok: false, reason: 'Private or reserved address not allowed' };
  const port = u.port ? Number(u.port) : 443;
  if (port !== 443 && !(policy.allowPorts ?? []).includes(port)) return { ok: false, reason: `Port ${port} not allowed` };
  if (policy.allowHosts && !policy.allowHosts.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) : host === p.toLowerCase())))
    return { ok: false, reason: 'Host is not an approved destination' };
  return { ok: true, url: u };
}

export interface SafeRequestResult { ok: boolean; status: number | null; body?: string; error?: string }

/** The lookup hook node:https uses for the connection itself: any blocked address fails the connection. Exported for tests. */
export function guardedLookup(hostname: string, options: any, cb: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
  resolver: typeof dnsLookup = dnsLookup): void {
  resolver(hostname, { ...(typeof options === 'object' ? options : {}), all: true }, (err, addrs: any) => {
    if (err) return cb(err, undefined);
    const list: { address: string; family: number }[] = Array.isArray(addrs) ? addrs : [{ address: addrs, family: isIP(addrs) }];
    if (!list.length) return cb(Object.assign(new Error('Host does not resolve'), { code: 'ENOTFOUND' }), undefined);
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) return cb(Object.assign(new Error('Host resolves to a private or reserved address'), { code: 'EBLOCKEDADDR' }), undefined);
    if (options?.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

/**
 * One request to an attacker-influenced URL. Never follows redirects; the connection's own DNS answer is checked;
 * `timeoutMs` caps the whole exchange and `maxBytes` the response body.
 */
export function safeOutboundRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {},
  policy: OutboundUrlPolicy = {}, deps: { resolver?: typeof dnsLookup; request?: typeof httpsRequest } = {}): Promise<SafeRequestResult> {
  const chk = checkOutboundUrl(url, policy);
  if (!chk.ok) return Promise.resolve({ ok: false, status: null, error: chk.reason });
  const u = chk.url; const max = init.maxBytes ?? 64 * 1024; const timeout = init.timeoutMs ?? 5000;
  const resolver = deps.resolver ?? dnsLookup; const req = deps.request ?? httpsRequest;
  return new Promise((resolve) => {
    let settled = false; const done = (r: SafeRequestResult) => { if (!settled) { settled = true; resolve(r); } };
    const r = req({
      protocol: 'https:', hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port ? Number(u.port) : 443, path: u.pathname + u.search,
      method: init.method ?? 'POST', headers: init.headers, timeout,
      lookup: (h: string, o: any, cb: any) => guardedLookup(h, o, cb, resolver),
    }, (res) => {
      const chunks: Buffer[] = []; let n = 0;
      res.on('data', (c: Buffer) => { n += c.length; if (n <= max) chunks.push(c); else res.destroy(); });
      res.on('end', () => { const status = res.statusCode ?? null; done({ ok: status != null && status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', () => done({ ok: false, status: res.statusCode ?? null, error: 'response aborted' }));
      res.on('close', () => { const status = res.statusCode ?? null; done({ ok: status != null && status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    r.on('timeout', () => { r.destroy(); done({ ok: false, status: null, error: 'timed out' }); });
    r.on('error', (e: any) => done({ ok: false, status: null, error: e?.code === 'EBLOCKEDADDR' ? 'Unsafe URL' : (e?.code === 'ENOTFOUND' ? 'Host does not resolve' : 'network error') }));
    if (init.body != null) r.write(init.body);
    r.end();
  });
}
