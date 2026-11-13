// AlertReadPanel.tsx — extras round 9 (AI BUSINESS ALERTS 05 / Global Loyalty Rewards 08): the bell panel's "Unread alerts"
// section. Lists this person's salon alerts (loyalty wallet, business alerts, messaging incidents …) with MY read state
// beside the alert's own lifecycle state. "Mark read" clears only my unread badge — on every tab and device of mine — and
// never acknowledges or resolves the alert: the failure stays open (the note under the list says so).
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { StaffAlertList } from '@aipowersalon/api-contracts/tenant';
import { codeLabel, agoLabel } from '../components/codeLabel';
import { fmtNumber } from '../i18n/format';
import { alertReadsApi, markAlertsReadEverywhere } from './alertReads';

export function AlertReadPanel() {
  const [list, setList] = useState<StaffAlertList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    Promise.resolve().then(() => alertReadsApi.list({ limit: 10 })).then((r) => { setList(r); setErr(null); }, (e: unknown) => setErr((e as Error)?.message || tx('nav.alertreads.failed')));
  }, []);
  useEffect(() => { load(); }, [load]);
  const mark = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try { await markAlertsReadEverywhere(ids); load(); }
    catch (e: unknown) { setErr((e as Error)?.message || tx('nav.alertreads.failed')); }
    finally { setBusy(false); }
  };
  if (err) return <div className="fk-err" role="alert" data-testid="alert-reads-error">{err}</div>;
  if (!list) return <div className="fk-loading">…</div>;
  const unreadIds = list.items.filter((i) => !i.readAt).map((i) => i.alertId);
  return (
    <div className="alert-reads" data-testid="alert-reads">
      <div className="panel-sub">
        <b>{tx('nav.alertreads.title')}</b>
        <span className="panel-count" data-testid="alert-reads-unread">{fmtNumber(list.unread)}</span>
        {unreadIds.length > 1 ? <button type="button" className="fk-btn sm" disabled={busy} onClick={() => void mark(unreadIds)} data-testid="alert-reads-all">{tx('nav.alertreads.markAll')}</button> : null}
      </div>
      {list.items.length === 0 ? <div className="panel-empty">{tx('nav.alertreads.none', { days: fmtNumber(list.windowDays) })}</div> : list.items.map((a) => (
        <div key={a.alertId} className={'panel-row' + (a.readAt ? ' read' : ' unread')} data-testid={'alert-read-' + a.alertId}>
          <span className={'fk-chip ' + (a.severity === 'critical' || a.severity === 'high' ? 'bad' : a.severity === 'warning' ? 'warn' : '')}>{codeLabel('nav.alertreads.sev', a.severity)}</span>
          <span className="pr-lbl">
            <b>{a.title}</b>
            <small>{codeLabel('nav.alertreads.cat', a.category)} · {tx('nav.alertreads.lifecycle', { status: codeLabel('nav.alertreads.st', a.lifecycleStatus) })} · {agoLabel(a.createdAt)}</small>
          </span>
          {a.readAt ? <span className="fk-chip ok" data-testid={'alert-read-state-' + a.alertId}>{tx('nav.alertreads.read')}</span>
            : <button type="button" className="fk-btn sm" disabled={busy} onClick={() => void mark([a.alertId])} data-testid={'alert-read-mark-' + a.alertId}>{tx('nav.alertreads.mark')}</button>}
        </div>
      ))}
      <div className="fk-hint" data-testid="alert-reads-note">{tx('nav.alertreads.note')}</div>
    </div>
  );
}
