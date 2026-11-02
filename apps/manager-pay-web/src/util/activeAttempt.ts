// activeAttempt.ts — mandate §130–§131 / §160: the ONE in-flight payment intent this install is working on, so a relaunch
// (app killed, phone rebooted) RESTORES and VERIFIES it instead of starting a new charge. Only ids + the amount are kept
// (no card data, no customer data, no credential) — a per-viewer convenience in localStorage; the backend attempt row is
// the truth and is re-read on launch.
export interface ActiveAttempt { ticketId: string; idempotencyKey: string; amountCents: number; handoff?: boolean; startedAt: string }
const KEY = 'aps_pay_active_attempt';

export function rememberActiveAttempt(a: Omit<ActiveAttempt, 'startedAt'>): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...a, startedAt: new Date().toISOString() })); } catch { /* private mode: nothing to restore later */ }
}
export function readActiveAttempt(): ActiveAttempt | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.ticketId !== 'string' || typeof v.idempotencyKey !== 'string') return null;
    return { ticketId: v.ticketId, idempotencyKey: v.idempotencyKey, amountCents: Number(v.amountCents) || 0, handoff: !!v.handoff, startedAt: String(v.startedAt || '') };
  } catch { return null; }
}
export function clearActiveAttempt(): void {
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* nothing to clear */ }
}
