// ScopeContext — the platform-wide tenant scope selected from the top-bar selector. Default (null) = All Branches,
// i.e. platform-wide, which is byte-identical to the pre-scope behaviour. The shell's selector sets it; the Overview
// reads it and re-fetches the aggregate scoped to one salon. Governance KPIs remain platform-wide server-side.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Scope = { tenantId: string | null; tenantName: string | null };
type ScopeContextValue = Scope & {
  setScope: (tenantId: string, tenantName: string) => void;
  clear: () => void;
};

const ScopeContext = createContext<ScopeContextValue>({
  tenantId: null,
  tenantName: null,
  setScope: () => {},
  clear: () => {},
});

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>({ tenantId: null, tenantName: null });
  const value = useMemo<ScopeContextValue>(
    () => ({
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
      setScope: (tenantId, tenantName) => setScopeState({ tenantId, tenantName }),
      clear: () => setScopeState({ tenantId: null, tenantName: null }),
    }),
    [scope.tenantId, scope.tenantName],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  return useContext(ScopeContext);
}
