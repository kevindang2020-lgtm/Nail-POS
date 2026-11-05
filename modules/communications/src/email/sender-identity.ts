// sender-identity.ts — C2 audit (Nov 4 2026): the Email health "Sender identity" layer was a fixed "unknown". It is now read
// from public DNS for the sending domain: SPF (a v=spf1 record that includes the provider), DKIM (the provider's selector
// records s1 / s2 under _domainkey) and DMARC (a v=DMARC1 record and its policy). A lookup that fails for any reason other
// than "no such record" is UNKNOWN — never read as missing, never as verified.
import { promises as dnsPromises } from 'node:dns';

export type RecordState = 'pass' | 'missing' | 'unknown' | 'present_without_provider';
export interface SenderIdentityResult {
  domain: string | null; spf: RecordState; dkim: RecordState; dmarc: RecordState; dmarcPolicy: string | null;
  overall: 'verified' | 'failed' | 'unknown'; checkedAt: string;
}
export interface DnsResolver { resolveTxt(name: string): Promise<string[][]>; resolveCname(name: string): Promise<string[]> }

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);
const notFound = (e: unknown) => NOT_FOUND.has(String((e as { code?: unknown } | null)?.code ?? ''));
/** the provider's own markers (SendGrid: SPF include and DKIM selectors) */
const PROVIDER = { spfInclude: 'sendgrid.net', dkimSelectors: ['s1', 's2'], dkimTarget: 'sendgrid.net' };

export function domainOf(fromAddress: string | null | undefined): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})\s*>?\s*$/i.exec(String(fromAddress ?? '').trim());
  return m ? m[1]!.toLowerCase() : null;
}

async function txt(r: DnsResolver, name: string): Promise<string[] | null | 'error'> {
  try { return (await r.resolveTxt(name)).map((parts) => parts.join('')); } catch (e) { return notFound(e) ? null : 'error'; }
}

export async function checkSenderIdentity(fromAddress: string | null | undefined, resolver: DnsResolver = dnsPromises, now: () => number = Date.now): Promise<SenderIdentityResult> {
  const domain = domainOf(fromAddress);
  const checkedAt = new Date(now()).toISOString();
  if (!domain) return { domain: null, spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', dmarcPolicy: null, overall: 'unknown', checkedAt };
  const spfRecs = await txt(resolver, domain);
  const spfLine = Array.isArray(spfRecs) ? spfRecs.find((x) => /^v=spf1\b/i.test(x)) : undefined;
  const spf: RecordState = spfRecs === 'error' ? 'unknown' : !spfLine ? 'missing' : spfLine.toLowerCase().includes(`include:${PROVIDER.spfInclude}`) ? 'pass' : 'present_without_provider';
  let dkim: RecordState = 'missing'; let dkimError = false;
  for (const sel of PROVIDER.dkimSelectors) {
    const name = `${sel}._domainkey.${domain}`;
    try { const c = await resolver.resolveCname(name); if (c.some((x) => x.toLowerCase().includes(PROVIDER.dkimTarget))) { dkim = 'pass'; break; } }
    catch (e) { if (!notFound(e)) dkimError = true; }
    const t = await txt(resolver, name);
    if (Array.isArray(t) && t.some((x) => /v=DKIM1/i.test(x) || /\bp=/.test(x))) { dkim = 'pass'; break; }
    if (t === 'error') dkimError = true;
  }
  if (dkim !== 'pass' && dkimError) dkim = 'unknown';
  const dm = await txt(resolver, `_dmarc.${domain}`);
  const dmLine = Array.isArray(dm) ? dm.find((x) => /^v=DMARC1\b/i.test(x)) : undefined;
  const dmarc: RecordState = dm === 'error' ? 'unknown' : dmLine ? 'pass' : 'missing';
  const dmarcPolicy = dmLine ? (/\bp=([a-z]+)/i.exec(dmLine)?.[1]?.toLowerCase() ?? null) : null;
  const states = [spf, dkim, dmarc];
  const overall = states.includes('unknown') ? 'unknown' : states.every((s) => s === 'pass') ? 'verified' : 'failed';
  return { domain, spf, dkim, dmarc, dmarcPolicy, overall, checkedAt };
}
