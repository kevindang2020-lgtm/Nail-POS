// aes-gcm.ts — @aipowersalon/security: the ONE AES-256-GCM implementation (Constitution 13 §81, audit §4).
//
// Seven near-identical copies lived in the API, in TWO wire formats that already exist at rest:
//   'dotted'   iv.tag.ct  base64url                    (provider vault, funding vault, webhook secrets, AI provider keys)
//   'prefixed' <prefix>:iv:tag:ct  base64               (MFA secrets, payment credentials, field encryption, ticket-deletion codes)
// Both are supported forever: no row is re-encrypted by this consolidation (§200–202). Keys are passed in as buffers —
// this package never reads the environment; the API's key ring (rotation, legacy purposes) is the adapter.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type WireFormat = { layout: 'dotted' } | { layout: 'prefixed'; prefix: string };
const IV_BYTES = 12;

/** Encrypt UTF-8 text under `key` (32 bytes) into the given wire format. */
export function seal(key: Buffer, plaintext: string, fmt: WireFormat): string {
  if (key.length !== 32) throw new Error('aes-gcm: key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return fmt.layout === 'dotted'
    ? [iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
    : `${fmt.prefix}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Split a stored value into its parts, or null when it is not in the expected format (never throws on shape). */
export function parse(stored: string, fmt: WireFormat): { iv: Buffer; tag: Buffer; ct: Buffer } | null {
  if (!stored) return null;
  if (fmt.layout === 'dotted') {
    const p = stored.split('.'); if (p.length !== 3 || !p[0] || !p[1]) return null;
    return { iv: Buffer.from(p[0], 'base64url'), tag: Buffer.from(p[1], 'base64url'), ct: Buffer.from(p[2], 'base64url') };
  }
  const p = stored.split(':'); if (p.length !== 4 || p[0] !== fmt.prefix) return null;
  return { iv: Buffer.from(p[1], 'base64'), tag: Buffer.from(p[2], 'base64'), ct: Buffer.from(p[3], 'base64') };
}

/** Decrypt with ONE key; throws on a bad tag (callers doing rotation try keys in turn). */
export function openWith(key: Buffer, stored: string, fmt: WireFormat): string {
  const p = parse(stored, fmt);
  if (!p) throw new Error('aes-gcm: stored value is not in the expected format');
  const d = createDecipheriv('aes-256-gcm', key, p.iv); d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ct), d.final()]).toString('utf8');
}

/** Decrypt trying each key in order (current, previous, legacy…): the first that authenticates wins. */
export function open(keys: readonly Buffer[], stored: string, fmt: WireFormat): string {
  let last: unknown = new Error('aes-gcm: no key available');
  for (const k of keys) { try { return openWith(k, stored, fmt); } catch (e) { last = e; } }
  throw last;
}

/** True when the value carries this format's shape (used to tell ciphertext from legacy plaintext, never to decrypt). */
export function looksSealed(stored: string, fmt: WireFormat): boolean { return parse(stored, fmt) !== null; }
