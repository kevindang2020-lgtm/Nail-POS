// principal.tsx — the signed-in principal (server-resolved; the app assigns nothing) shared with the screens that gate a
// control on a permission (mandate §10, §52, §112): the takeover button, the split cash tender, refund/void.
import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Principal } from '../api/authApi';

const Ctx = createContext<Principal | null>(null);
export const PrincipalProvider = Ctx.Provider;
export const useSessionPrincipal = () => useContext(Ctx);

/** Mandate §120: More → Branch announces the re-signed principal (aps:branch-switched) after POST /auth/select-branch; the
 *  app-level principal takes the new branch (keeping the sign-in name), which re-keys the data layer to that location and
 *  re-registers the phone there. Only for the same signed-in person and a real branch. */
export function useBranchSwitchedPrincipal(set: Dispatch<SetStateAction<Principal | null | undefined>>): void {
  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent).detail as Partial<Principal> | undefined;
      if (!next || typeof next.branchId !== 'string' || !next.branchId) return;
      set((prev) => (prev && prev.userId === next.userId ? { ...prev, ...next } as Principal : prev));
    };
    window.addEventListener('aps:branch-switched', on);
    return () => window.removeEventListener('aps:branch-switched', on);
  }, [set]);
}
