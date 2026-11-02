// clock-pin-lookup.ts — 200-technician mandate §46/§47/§89 (Oct 23 2026): identify-by-PIN used to run one scrypt check per
// pinned technician at the branch (200 technicians ≈ 200 × ~50 ms of CPU on every kiosk tap, and a 100-technician
// opening burst queued behind it). A keyed digest of (tenant, PIN) — HMAC-SHA256 with a SERVER-side key that never
// reaches the database — lets the kiosk narrow to the one or two rows whose digest matches, then verify those with the
// same scrypt hash as before. The digest is useless without the key (a stolen table cannot be brute-forced offline any
// faster than the hashes), and `kid` names the key so a rotated key never strands a technician: rows written under
// another key (or before this existed) are still scanned the old way and re-keyed on their next successful match.
import { createHash, createHmac } from 'crypto';

export interface PinLookupKey {
  /** short id of the key (a digest of it — never the key) stored next to each digest */
  readonly kid: string;
  digest(tenantId: string, pin: string): string;
}

/** CLOCK_PIN_LOOKUP_KEY, else a key derived (domain-separated) from AUTH_SESSION_SECRET; null when neither is set —
 *  identify then scans every candidate as it always did (correct, just slower). */
export function pinLookupKeyFromEnv(env: Record<string, string | undefined> = process.env): PinLookupKey | null {
  const explicit = env.CLOCK_PIN_LOOKUP_KEY || '';
  const session = env.AUTH_SESSION_SECRET || '';
  const raw = explicit.length >= 16 ? explicit : session.length >= 16 ? createHmac('sha256', session).update('aipowersalon/clock-pin-lookup/v1').digest('hex') : '';
  return raw ? pinLookupKey(raw) : null;
}

export function pinLookupKey(raw: string): PinLookupKey {
  const kid = createHash('sha256').update('kid:' + raw).digest('hex').slice(0, 12);
  return { kid, digest: (tenantId: string, pin: string) => createHmac('sha256', raw).update(tenantId + ':' + pin).digest('hex') };
}

/** Run `fn` over `items` with at most `limit` in flight (scrypt runs on libuv's pool — 4 threads by default). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
