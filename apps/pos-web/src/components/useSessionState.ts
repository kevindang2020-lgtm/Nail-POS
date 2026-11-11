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
export function useSessionState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => readSession(key, fallback));
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* best effort */ } }, [key, v]);
  return [v, setV];
}
