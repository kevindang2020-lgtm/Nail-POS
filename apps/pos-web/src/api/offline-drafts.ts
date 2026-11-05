// offline-drafts.ts — Functional Decision 33, the last part: DRAFT notes. A note saved while the connection is down is
// kept on this device as a draft (never sent, never "applied" offline). On reconnect the decision's order holds:
// authenticate → refresh → validate drafts → apply or reject — and a person decides. A draft remembers the notes as they
// were when editing began, so a change made on another device meanwhile is shown as a conflict instead of being
// silently overwritten.
//
// Drafts belong to the signed-in user at their salon (the same scope as the offline read cache) and expire after 7 days.
export type OfflineDraftKind = 'customer_notes';   // (named OfflineDraftKind: the API has an unrelated OfflineDraftKind)
export interface OfflineDraft {
  id: string; kind: OfflineDraftKind; targetId: string; label: string;
  payload: Record<string, unknown>;   // what was typed
  base: Record<string, unknown>;      // the record as loaded before editing — the conflict check compares against it
  savedAt: number;
}
export type DraftCheck = { status: 'ready' } | { status: 'conflict'; current: Record<string, unknown> } | { status: 'gone' } | { status: 'signed_out' } | { status: 'offline' };

export const DRAFTS_CHANGED = 'aps:offline-drafts-changed';
const MAX_AGE_MS = 7 * 86_400_000;
const KEY = 'aps_offline_drafts:';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
let scope = '';
export function setDraftScope(next: string): void { scope = next || ''; }
const key = () => KEY + scope;
const notify = () => { try { window.dispatchEvent(new CustomEvent(DRAFTS_CHANGED)); } catch { /* no window */ } };

export function listDrafts(store: Store = localStorage, now = Date.now()): OfflineDraft[] {
  if (!scope) return [];
  try { const all = JSON.parse(store.getItem(key()) || '[]') as OfflineDraft[]; return all.filter((d) => now - d.savedAt <= MAX_AGE_MS); } catch { return []; }
}
function write(list: OfflineDraft[], store: Store) { try { store.setItem(key(), JSON.stringify(list)); } catch { /* storage full */ } notify(); }

/** One draft per record: a second offline save of the same customer's notes replaces the first (keeping the ORIGINAL base). */
export function saveDraft(d: Omit<OfflineDraft, 'id' | 'savedAt'>, store: Store = localStorage, now = Date.now()): OfflineDraft | null {
  if (!scope) return null;
  const list = listDrafts(store, now);
  const prev = list.find((x) => x.kind === d.kind && x.targetId === d.targetId);
  const draft: OfflineDraft = { ...d, base: prev?.base ?? d.base, id: prev?.id ?? `${d.kind}:${d.targetId}:${now}`, savedAt: now };
  write([...list.filter((x) => x.id !== draft.id), draft], store);
  return draft;
}
export function removeDraft(id: string, store: Store = localStorage): void { write(listDrafts(store).filter((d) => d.id !== id), store); }

const same = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) if (JSON.stringify(a?.[k] ?? '') !== JSON.stringify(b?.[k] ?? '')) return false;
  return true;
};
/** authenticate → refresh → validate. `whoAmI` and `fetchCurrent` are the real API calls (injected for tests). */
export async function checkDraft(d: OfflineDraft, deps: { online: () => boolean; whoAmI: () => Promise<unknown>; fetchCurrent: (targetId: string) => Promise<Record<string, unknown> | null> }): Promise<DraftCheck> {
  if (!deps.online()) return { status: 'offline' };
  try { await deps.whoAmI(); } catch { return { status: 'signed_out' }; }
  let current: Record<string, unknown> | null;
  try { current = await deps.fetchCurrent(d.targetId); } catch (e: any) { return (e?.status === 404 || e?.statusCode === 404) ? { status: 'gone' } : { status: 'offline' }; }
  if (!current) return { status: 'gone' };
  return same(current, d.base) ? { status: 'ready' } : { status: 'conflict', current };
}

/** Did this save fail because we are offline (the network layer's refusal, or no connection at all)? */
export const isOfflineFailure = (e: any) => (typeof navigator !== 'undefined' && navigator.onLine === false) || e?.code === 'OFFLINE' || e?.status === 503 && /offline/i.test(String(e?.message)) || e instanceof TypeError;
