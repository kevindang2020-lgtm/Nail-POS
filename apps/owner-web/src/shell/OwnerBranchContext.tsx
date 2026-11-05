// OwnerBranchContext.tsx — loads the owner's allowed salons from GET /owner/context once after sign-in and holds the
// current view selection (single branch or "All My Salons"). Selection persists per browser under
// `owner_selected_branch_context`; if a saved branch is no longer assigned, it falls back to the primary salon, else
// "All My Salons". `effectiveBranchId` is the value screens pass to the API: a branch id in single mode, or undefined
// in "all" mode (the backend then combines over exactly the owner's assigned branches).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ownerContextApi, type OwnerAllowedBranch } from '../api/ownerApi';
import { useOwnerSalonEpoch } from './OwnerSalonContext';

const PREF_KEY = 'owner_selected_branch_context';
type Selection = { mode: 'single' | 'all'; branchId: string | null };

interface OwnerBranchValue {
  loading: boolean;
  error: string | null;
  branches: OwnerAllowedBranch[];
  canViewAll: boolean;
  selection: Selection;
  effectiveBranchId: string | undefined; // undefined in "all" mode
  currentLabel: string;
  setSelection: (sel: Selection) => void;
  reload: () => void;
}

const Ctx = createContext<OwnerBranchValue | null>(null);

function readPref(): Selection | null {
  try { const raw = localStorage.getItem(PREF_KEY); if (!raw) return null; const p = JSON.parse(raw); if (p && (p.mode === 'single' || p.mode === 'all')) return { mode: p.mode, branchId: p.branchId ?? null }; } catch { /* ignore */ }
  return null;
}

export function OwnerBranchProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<OwnerAllowedBranch[]>([]);
  const [canViewAll, setCanViewAll] = useState(false);
  const [selection, setSelectionState] = useState<Selection>({ mode: 'all', branchId: null });

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    ownerContextApi.context()
      .then((ctx) => {
        setBranches(ctx.allowedBranches);
        setCanViewAll(ctx.canViewAllAssignedBranches);
        const ids = new Set(ctx.allowedBranches.map((b) => b.branchId));
        const saved = readPref();
        let next: Selection;
        if (saved && saved.mode === 'single' && saved.branchId && ids.has(saved.branchId)) next = saved;            // saved branch still valid
        else if (saved && saved.mode === 'all' && ctx.canViewAllAssignedBranches) next = { mode: 'all', branchId: null };
        else if (ctx.allowedBranches.length === 1) next = { mode: 'single', branchId: ctx.allowedBranches[0].branchId }; // exactly one → open it
        else if (ctx.defaultBranchId && ids.has(ctx.defaultBranchId) && !ctx.canViewAllAssignedBranches) next = { mode: 'single', branchId: ctx.defaultBranchId };
        else next = { mode: 'all', branchId: null };                                                                 // multiple → combined by default
        setSelectionState(next);
      })
      .catch((e: any) => setError(e?.message || 'Could not load your salons.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // The SALON switcher (OwnerSalonContext) does a server-side context switch and bumps `epoch`. When it does, the
  // active salon's branch set changes, so re-load here: this refreshes the branch list AND resets the selection to
  // the new salon (an old-salon branchId can't pass the `ids.has(...)` check in reload), which flips
  // `effectiveBranchId` and makes every screen keyed on it re-fetch for the newly active salon. Without this, a
  // salon switch left branch-scoped screens showing the previous salon's data — the "not yet keyed to epoch" gap.
  // epoch is 0 on first load (only user switches bump it; the initial GET /owner/context does not), so no double-fetch.
  const salonEpoch = useOwnerSalonEpoch();
  useEffect(() => { if (salonEpoch > 0) reload(); }, [salonEpoch, reload]);

  const setSelection = useCallback((sel: Selection) => {
    setSelectionState(sel);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(sel)); } catch { /* ignore */ }
  }, []);

  const value = useMemo<OwnerBranchValue>(() => {
    const effectiveBranchId = selection.mode === 'single' && selection.branchId ? selection.branchId : undefined;
    const current = effectiveBranchId ? branches.find((b) => b.branchId === effectiveBranchId) : undefined;
    const currentLabel = current ? (current.branchName && current.branchName !== 'Main' ? `${current.salonName}` : current.salonName) : 'All My Salons';
    return { loading, error, branches, canViewAll, selection, effectiveBranchId, currentLabel, setSelection, reload };
  }, [loading, error, branches, canViewAll, selection, setSelection, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOwnerBranch(): OwnerBranchValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOwnerBranch must be used within OwnerBranchProvider');
  return v;
}
