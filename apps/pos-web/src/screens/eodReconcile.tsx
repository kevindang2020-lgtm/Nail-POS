// eodReconcile.tsx — extras FOLLOW-UP QUEUE 09: the health panel's cross-module reconciliation row, in the cashier's language.
// The counts are the server's (EodCenter.reconciliation — the send path's own rules); nothing is recomputed here.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { EodHealthRow } from '../api/posEodFollowUpsApi';

const KEYS = [['sourceCancelled', 'eod.rec.source'], ['customerArchived', 'eod.rec.archived'], ['alreadyBooked', 'eod.rec.booked'], ['technicianInactive', 'eod.rec.tech']] as const;

export function EodReconcile({ rec }: { rec: NonNullable<EodHealthRow['reconcile']> }) {
  const tt = (k: string, v?: Record<string, string>) => tx(k, v as Parameters<typeof tx>[1]);
  const issues = KEYS.filter(([f]) => rec[f] > 0);
  return (
    <div className="s" data-testid="eod-reconcile">
      <div>{tt('eod.rec.open', { n: String(rec.open) })}</div>
      {issues.length === 0 ? <div data-testid="eod-rec-ok">{tt('eod.rec.ok')}</div>
        : issues.map(([f, k]) => <div key={f} data-testid={`eod-rec-${f}`}>{tt(k, { n: String(rec[f]) })}</div>)}
    </div>
  );
}
