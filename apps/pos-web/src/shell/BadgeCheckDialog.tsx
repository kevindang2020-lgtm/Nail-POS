// BadgeCheckDialog.tsx — extras Customer Notifications 02 "Badge Accuracy Self-Check": one click compares every count the shell
// is SHOWING (sidebar badges + the bell, from the last /tenant/navigation/badges read) with a fresh server read of the same
// endpoint, names each badge that disagrees, and offers the safe recalculation: ask the shell to read the badges again
// (the 'aps:nav-counts-changed' event every screen already uses after it changes a counted thing). Read-only — nothing is
// marked read, acknowledged or changed; counts only, never names or messages.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from '../components/FitKit';
import { api } from '../api/client';
import { fmtDateTime, fmtNumber } from '../i18n/format';
import type { BadgeKey } from './tenant-nav';
import type { Badges } from './tenant-access';

export const BADGE_KEYS: BadgeKey[] = ['checkIn', 'techQueue', 'customerQueue', 'serviceDone', 'checkout', 'messages', 'notifications', 'techReportsPending',
  'inventoryAlerts', 'reviews', 'payrollPending', 'billingAlerts', 'aiUsageAlerts', 'supportTickets', 'setupHealthAlerts'];
export interface BadgeCompareRow { key: BadgeKey; shown: number | null; server: number | null; match: boolean }

/** shown (what the shell renders) vs server (a fresh read); a key the server does not return for this person is not compared */
export function compareBadges(shown: Badges, server: Badges): BadgeCompareRow[] {
  return BADGE_KEYS.filter((k) => server[k] !== undefined || shown[k] !== undefined).map((k) => {
    const s = typeof shown[k] === 'number' ? (shown[k] as number) : null; const v = typeof server[k] === 'number' ? (server[k] as number) : null;
    return { key: k, shown: s, server: v, match: (s ?? 0) === (v ?? 0) };
  });
}

export function BadgeCheckDialog({ shown, onClose }: { shown: Badges; onClose: () => void }) {
  const [rows, setRows] = useState<BadgeCompareRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const run = useCallback(() => {
    setErr(null);
    api.get<Badges>('/tenant/navigation/badges').then((server) => { setRows(compareBadges(shown, server ?? {})); setAt(new Date().toISOString()); }, (e: unknown) => setErr((e as Error)?.message || tx('nav.badgechk.failed')));
  }, [shown]);
  useEffect(() => { run(); }, [run]);
  const recalc = () => { window.dispatchEvent(new Event('aps:nav-counts-changed')); setAsked(true); };
  const off = rows?.filter((r) => !r.match).length ?? 0;
  return (
    <FitDialog title={tx('nav.badgechk.title')} subtitle={tx('nav.badgechk.sub')} onClose={onClose} testId="badge-check"
      footer={<><button type="button" className="fk-btn" onClick={run} data-testid="badge-check-rerun">{tx('nav.badgechk.rerun')}</button>
        <button type="button" className="fk-btn primary" onClick={recalc} data-testid="badge-check-recalc">{tx('nav.badgechk.recalc')}</button>
        <button type="button" className="fk-btn" onClick={onClose}>{tx('nav.badgechk.close')}</button></>}>
      {err ? <div className="fk-err" role="alert">{err}</div> : !rows ? <div className="fk-loading">…</div> : <>
        <div className={'fk-preview' + (off ? ' bad' : '')} data-testid="badge-check-verdict">{off ? tx('nav.badgechk.off', { n: fmtNumber(off) }) : tx('nav.badgechk.ok', { n: fmtNumber(rows.length) })}</div>
        <table className="fk-table" data-testid="badge-check-table"><thead><tr><th>{tx('nav.badgechk.col.badge')}</th><th className="num">{tx('nav.badgechk.col.shown')}</th><th className="num">{tx('nav.badgechk.col.server')}</th><th>{tx('nav.badgechk.col.result')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} data-testid={'badge-row-' + r.key}><td>{tx('nav.badgechk.k.' + r.key)}</td>
            <td className="num">{r.shown == null ? '—' : fmtNumber(r.shown)}</td><td className="num">{r.server == null ? '—' : fmtNumber(r.server)}</td>
            <td><span className={'fk-chip ' + (r.match ? 'ok' : 'bad')}>{r.match ? tx('nav.badgechk.match') : tx('nav.badgechk.mismatch')}</span></td></tr>)}</tbody></table>
        <div className="fk-hint">{tx('nav.badgechk.evidence', { when: at ? fmtDateTime(at) : '—' })}</div>
        {asked ? <div className="fk-hint" data-testid="badge-check-asked">{tx('nav.badgechk.asked')}</div> : null}
      </>}
    </FitDialog>
  );
}
