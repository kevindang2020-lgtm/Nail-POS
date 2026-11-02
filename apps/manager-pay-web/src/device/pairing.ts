// pairing.ts — Secure Tap to Pay M6-4: the POS "Add Tap to Pay device" QR / link. The POS shows
// aipowersalon-pay://pair?code=<43-char base64url>; the phone opens it (camera / deep link) — or staff paste the code — and
// the next registration presents it (single use, 5 minutes, this location). The code is held in MEMORY only (never
// written to storage) and dropped once used or refused.
import { useSyncExternalStore } from 'react';

const CODE_RE = /^[A-Za-z0-9_-]{16,100}$/;

/** The pairing code inside a scanned / opened link, or a pasted bare code. null when it is not one. */
export function parsePairingInput(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (CODE_RE.test(s)) return s;
  try {
    const u = new URL(s);
    const isPair = (u.protocol === 'aipowersalon-pay:' && (u.host === 'pair' || u.pathname.replace(/^\/+/, '') === 'pair'));
    if (!isPair) return null;
    const c = u.searchParams.get('code');
    return c && CODE_RE.test(c) ? c : null;
  } catch { return null; }
}

let pending: string | null = null;
let lastError: string | null = null;   // why the last QR / link pairing was refused (plain English), until dismissed
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
export function setPairingError(msg: string | null): void { lastError = msg; emit(); }
export function usePairingError(): string | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => lastError, () => lastError);
}
export function setPendingPairingCode(code: string | null): void { pending = code; emit(); }
export function takePendingPairingCode(): string | null { const c = pending; pending = null; emit(); return c; }
export function peekPendingPairingCode(): string | null { return pending; }
export function usePendingPairingCode(): string | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => pending, () => pending);
}

interface AppUrlPlugin {
  addListener(event: 'appUrlOpen', cb: (e: { url: string }) => void): Promise<{ remove(): unknown }> | { remove(): unknown };
  getLaunchUrl?(): Promise<{ url?: string } | undefined>;
}
/** Native: a pairing link that opened (or launched) the app becomes the pending code. Returns an unsubscribe. */
export async function listenForPairingLinks(plugin: AppUrlPlugin | null | undefined): Promise<() => void> {
  if (!plugin) return () => {};
  const take = (url?: string) => { const c = parsePairingInput(url); if (c) setPendingPairingCode(c); };
  let sub: { remove(): unknown } | null = null;
  try { sub = await plugin.addListener('appUrlOpen', (e) => take(e?.url)); } catch { /* no plugin in this shell */ }
  try { take((await plugin.getLaunchUrl?.())?.url); } catch { /* none */ }
  return () => { try { void sub?.remove(); } catch { /* gone */ } };
}
