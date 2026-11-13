// useSessionState — like useState, but kept in this browser TAB's sessionStorage under one key, so leaving a screen and
// coming back (or a re-login / language switch in the same tab) restores it. For NON-sensitive UI state only (filters,
// tabs, drafts the user typed) — never customer data, tokens or amounts read from the server. Storage failures (private
// mode, quota) silently fall back to plain in-memory state.
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    if (fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback)) return (v && typeof v === 'object') ? { ...fallback, ...v } : fallback;
    return typeof v === typeof fallback ? v : fallback;
  } catch { return fallback; }
}
/** keep a non-sensitive value for this tab (a storage failure leaves plain in-memory state) */
export function writeSession(key: string, v: unknown): void { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* best effort */ } }
export function useSessionState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => readSession(key, fallback));
  useEffect(() => { writeSession(key, v); }, [key, v]);
  return [v, setV];
}

// Shared front-desk terminals: remembered UI state belongs to ONE signed-in user at ONE salon. When the user / salon
// changes, or on sign-out, every 'aps.' tab key is dropped — except a held payment idempotency key, which must survive so a
// retried purchase can never be charged twice.
const SCOPE_KEY = 'aps.ui.scope';
const KEEP = new Set([SCOPE_KEY, 'aps.rn.buyKey', 'aps.rv.inflight']);   // + a refund / void cut off by a reload (POSRefundsVoidsScreen)
export function clearSessionUiState(): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.startsWith('aps.') && !KEEP.has(k)) drop.push(k); }
    for (const k of drop) sessionStorage.removeItem(k);
  } catch { /* no storage */ }
}
export function scopeSessionUiState(scope: string): void {
  try {
    const prev = sessionStorage.getItem(SCOPE_KEY);
    if (prev !== null && prev !== scope) clearSessionUiState();
    if (scope) sessionStorage.setItem(SCOPE_KEY, scope); else sessionStorage.removeItem(SCOPE_KEY);
  } catch { /* no storage */ }
}
