// queryLayer.tsx — BUILD_PLAN Phase 13 (Constitution 6 §24–27): the Owner App's server-state layer. Mounted inside
// AuthProvider (so a sign-out — scope → null — wipes the cache and the journal); a salon switch calls
// useServerStateReset() (OwnerSalonContext) because the context switch re-issues the session without a new principal.
import type { ReactNode } from 'react';
import { MobileQueryProvider, scopeFromPrincipal, type JournalSender } from '@aipowersalon/mobile-sdk';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export const sendJournaled: JournalSender = (r) => {
  const o = { idempotencyKey: r.idempotencyKey };
  if (r.method === 'PATCH') return api.patch(r.path, r.body, o);
  if (r.method === 'DELETE') return api.del(r.path, o);
  return api.post(r.path, r.body, o);
};

export function OwnerQueryLayer({ children }: { children: ReactNode }) {
  const { principal } = useAuth();
  return <MobileQueryProvider app="owner" scope={scopeFromPrincipal('tenant', principal)} send={sendJournaled}>{children}</MobileQueryProvider>;
}
