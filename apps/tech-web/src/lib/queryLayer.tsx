// queryLayer.tsx — BUILD_PLAN Phase 13 (Constitution 6 §24–27): the Technician App's server-state layer. Mounted inside
// AuthProvider: the signed-in principal is the cache scope (tenant + branch + user), so logout or a salon switch wipes
// the cache and the journal; journaled actions replay through this app's transport with their Idempotency-Key.
import type { ReactNode } from 'react';
import { MobileQueryProvider, scopeFromPrincipal, type JournalSender } from '@aipowersalon/mobile-sdk';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export const sendJournaled: JournalSender = (r) => {
  const o = { idempotencyKey: r.idempotencyKey };
  if (r.method === 'PATCH') return api.patch(r.path, r.body, o);
  if (r.method === 'DELETE') return api.del(r.path, o);
  return api.post(r.path, r.body, o);                            // POST (PUT is not journaled by this app)
};

export function TechQueryLayer({ children }: { children: ReactNode }) {
  const { principal } = useAuth();
  return <MobileQueryProvider app="tech" scope={scopeFromPrincipal('tenant', principal)} send={sendJournaled}>{children}</MobileQueryProvider>;
}
