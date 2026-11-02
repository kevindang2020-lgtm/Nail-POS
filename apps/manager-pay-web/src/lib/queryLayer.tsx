// queryLayer.tsx — BUILD_PLAN Phase 13 (Constitution 6 §19, §24–27): Manager Tap to Pay's server-state layer. This is a
// MONEY app: every read stays in memory (nothing is marked persist, so nothing reaches the device store) and nothing is
// ever journaled — a charge, refund or void needs a live server confirmation and carries its own Idempotency-Key
// (createIntentKeys). The sender refuses outright, so even a mistaken journal entry could never replay a payment.
import type { ReactNode } from 'react';
import { MobileQueryProvider, scopeFromPrincipal, type JournalSender } from '@aipowersalon/mobile-sdk';

export const refuseJournal: JournalSender = async () => { throw Object.assign(new Error('Manager Tap to Pay never replays a queued action.'), { status: 400, code: 'JOURNAL_REFUSED' }); };

export function PayQueryLayer({ principal, children }: { principal: { userId?: string | null; tenantId?: string | null; branchId?: string | null } | null; children: ReactNode }) {
  return <MobileQueryProvider app="manager-pay" scope={scopeFromPrincipal('tenant', principal)} send={refuseJournal}>{children}</MobileQueryProvider>;
}
