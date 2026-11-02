// queryLayer.tsx — BUILD_PLAN Phase 13 (Constitution 6 §24–27): the Customer App's server-state layer. Mounted inside
// AuthProvider: the signed-in customer is the cache scope, so sign-out wipes the cache. A guest has no principal → no
// scope → nothing is cached on the device. The customer app journals nothing: booking is online-only (§20).
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

export function CustomerQueryLayer({ children }: { children: ReactNode }) {
  const { principal } = useAuth();
  return <MobileQueryProvider app="customer" scope={scopeFromPrincipal('customer', principal)} send={sendJournaled}>{children}</MobileQueryProvider>;
}
