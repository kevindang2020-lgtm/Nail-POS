// POSSetupHealthScreen.tsx — Management → Setup Health (/tenant/management/setup-health). Four-Module Completion Guide (Oct 30
// 2026) §13: one owner screen for Twilio account & sender, carrier registration, SMS transport, Booking integration, branch
// settings, AI subscriptions, background jobs and release evidence. Every row says what works / what is blocked / what to do
// next, when the fact was last VERIFIED, and links to the module that fixes it. A row is Ready only when the server verified
// it recently; configured-but-unchecked is Unknown. The technical view (source + safe detail codes) is for settings.edit only.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posSetupHealthApi } from '../api/posSetupHealthApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, Pager, ErrorRetry, type PageInfo } from '../components/FitKit';

type Status = 'ready' | 'warning' | 'action_required' | 'pending_external' | 'unknown' | 'disabled' | 'error';
type Check = { key: string; area: string; branchId: string | null; branchName: string | null; status: Status; stale: boolean; severity: string; code: string; verifiedAt: string | null; expiresAt: string | null;
  lastGoodAt: string | null; action: { code: string; route: string } | null; technical: { source: string; detail: Record<string, unknown> } | null };
type Summary = { branches: { id: string; name: string }[]; branchId: string | null; canRun: boolean; technical: boolean;
  run: { id: string; trigger: string; runDate: string; status: string; startedAt: string | null; finishedAt: string | null; stale: boolean } | null;
  nightly: { status: string; runDate: string; finishedAt: string | null; failed: boolean } | null; overall: Status; counts: Record<Status, number>; checks: Check[];
  alerts: { id: string; key: string; branchId: string | null; severity: string; status: Status; occurrences: number; firstSeenAt: string | null; lastSeenAt: string | null; escalatedAt: string | null; acknowledgedAt: string | null }[] };

const AREAS = ['twilio', 'registration', 'sms_transport', 'booking', 'branch_settings', 'ai', 'jobs', 'release'] as const;
const STATUSES: Status[] = ['error', 'action_required', 'warning', 'unknown', 'pending_external', 'disabled', 'ready'];
const TONE: Record<Status, string> = { ready: 'ok', warning: 'warn', action_required: 'bad', pending_external: 'info', unknown: 'mut', disabled: 'mut', error: 'bad' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const statusLabel = (s: string) => tx('hs.status.' + s);
const checkTitle = (k: string) => codeLabel('hs.check.' + k.replace(/\./g, '_'), k);
const codeText = (c: Check) => { const key = 'hs.code.' + c.code; const v = tx(key); return v === key ? tx('hs.meaning.' + c.status) : v; };

export function POSSetupHealthScreen() {
  const nav = useNavigate();
  const [branchId, setBranchId] = useState('');
  const [d, setD] = useState<Summary | null>(null); const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [tech, setTech] = useState(false); const [hist, setHist] = useState(false);
  const load = useCallback(() => { setErr(null); posSetupHealthApi.summary(branchId || undefined).then(setD).catch(setErr); }, [branchId]);
  useEffect(() => { load(); }, [load]);
  const runNow = async () => {
    setBusy(true); setNote(null);
    try { await posSetupHealthApi.run(); setD(await posSetupHealthApi.summary(branchId || undefined)); setNote({ tone: 'ok', text: tx('hs.ranNow') }); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('hs.runFailed')) }); } finally { setBusy(false); }
  };
  const ack = async (id: string) => { try { await posSetupHealthApi.acknowledge(id); load(); } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('hs.ackFailed')) }); } };
  const branchName = (id: string | null) => (id ? d?.branches.find((b) => b.id === id)?.name ?? tx('hs.branch') : tx('hs.wholeSalon'));

  return (
    <div className="work hs" data-testid="setup-health-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('hs.title')}</h1><div className="sub">{tx('hs.subtitle')}</div></div>
        <div className="fk-head-actions">
          {d && d.branches.length > 1 ? <select className="fk-select" aria-label={tx('hs.scope')} value={branchId} onChange={(e) => setBranchId(e.target.value)} data-testid="hs-branch">
            <option value="">{tx('hs.allBranches')}</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
          {d?.technical ? <button type="button" className={'fk-btn ghost' + (tech ? ' on' : '')} aria-pressed={tech} onClick={() => setTech((v) => !v)} data-testid="hs-tech">{tx('hs.technical')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => setHist(true)} data-testid="hs-history">{tx('hs.history')}</button>
          {d?.canRun ? <button type="button" className="fk-btn primary" onClick={runNow} disabled={busy} data-testid="hs-run">{busy ? tx('pos.loading') : tx('hs.run')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {err ? <ErrorRetry message={errorTextOf(err, tx('hs.loadFailed'))} onRetry={load} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <section className="hs-summary" data-testid="hs-summary" aria-label={tx('hs.summary')}>
          <div className={'hs-overall ' + TONE[d.overall]}><span>{tx('hs.overall')}</span><b data-testid="hs-overall">{statusLabel(d.overall)}</b>
            <small>{d.run ? tx(d.run.stale ? 'hs.lastRunStale' : 'hs.lastRun', { t: when(d.run.finishedAt ?? d.run.startedAt), how: tx('hs.trigger.' + d.run.trigger) }) : tx('hs.neverRun')}</small></div>
          {STATUSES.map((s) => <div key={s} className={'hs-count ' + TONE[s]} data-testid={'hs-count-' + s}><b>{d.counts[s] ?? 0}</b><span>{statusLabel(s)}</span></div>)}
          <div className={'hs-nightly' + (d.nightly?.failed ? ' bad' : '')} data-testid="hs-nightly">{d.nightly ? tx(d.nightly.failed ? 'hs.nightlyFailed' : 'hs.nightlyOk', { d: d.nightly.runDate, t: when(d.nightly.finishedAt) }) : tx('hs.nightlyNone')}</div>
        </section>
        {d.alerts.length ? <section className="hs-alerts" data-testid="hs-alerts" aria-label={tx('hs.alerts')}>
          {d.alerts.slice(0, 4).map((a) => <div key={a.id} className={'hs-alert ' + TONE[a.status]}>
            <span className={'fk-chip ' + TONE[a.status]}>{statusLabel(a.status)}</span><b>{checkTitle(a.key)}</b><span className="fk-muted">{branchName(a.branchId)} · {tx('hs.seen', { n: String(a.occurrences), t: when(a.firstSeenAt) })}</span>
            {a.escalatedAt ? <span className="fk-chip bad">{tx('hs.escalated')}</span> : null}
            {d.canRun && !a.acknowledgedAt ? <button type="button" className="fk-btn ghost sm" onClick={() => ack(a.id)} data-testid="hs-ack">{tx('hs.ack')}</button> : a.acknowledgedAt ? <span className="fk-muted">{tx('hs.acked')}</span> : null}
          </div>)}
          {d.alerts.length > 4 ? <span className="fk-hint">{tx('hs.moreAlerts', { n: String(d.alerts.length - 4) })}</span> : null}
        </section> : null}
        {!d.run ? <div className="fk-empty"><div className="fk-empty-t">{tx('hs.neverRun')}</div><div className="fk-hint">{tx('hs.neverRunHint')}</div></div> : null}
        <div className="hs-grid"><div className="hs-cols">
          {AREAS.map((area) => {
            const rows = d.checks.filter((c) => c.area === area); if (!rows.length) return null;
            const worst = STATUSES.find((s) => rows.some((r) => r.status === s)) ?? 'unknown';
            return (
              <section key={area} className="fk-panel hs-area" data-testid={'hs-area-' + area} aria-label={tx('hs.area.' + area)}>
                <div className="fk-panel-head"><h2>{tx('hs.area.' + area)}</h2><span className={'fk-chip ' + TONE[worst]}>{statusLabel(worst)}</span></div>
                <ul className="hs-rows">{rows.map((c) => (
                  <li key={c.key + (c.branchId ?? '')} className={'hs-row ' + TONE[c.status]} data-testid="hs-row" data-key={c.key} data-status={c.status}>
                    <div className="hs-row-h"><span className={'fk-chip ' + TONE[c.status]}>{statusLabel(c.status)}{c.stale ? ' · ' + tx('hs.stale') : ''}</span>
                      <b>{checkTitle(c.key)}</b>{c.branchId ? <span className="fk-muted">· {c.branchName ?? tx('hs.branch')}</span> : null}</div>
                    <p className="hs-why">{codeText(c)}</p>
                    <div className="hs-meta"><span>{tx('hs.lastVerified', { t: when(c.verifiedAt) })}</span>{c.status !== 'ready' && c.lastGoodAt ? <span>{tx('hs.lastGood', { t: when(c.lastGoodAt) })}</span> : null}
                      {c.action ? <button type="button" className="fk-btn ghost sm" onClick={() => nav(c.action!.route)} data-testid="hs-action">{tx('hs.action.' + c.action.code)}</button> : null}</div>
                    {tech && c.technical ? <pre className="hs-tech" data-testid="hs-tech-detail">{JSON.stringify({ source: c.technical.source, ...c.technical.detail })}</pre> : null}
                  </li>))}</ul>
              </section>
            );
          })}
        </div></div>
      </>}
      {hist ? <RunsDialog onClose={() => setHist(false)} /> : null}
    </div>
  );
}

function RunsDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<(PageInfo & { items: any[] }) | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { let alive = true; posSetupHealthApi.runs({ page, pageSize: 8 }).then((r) => alive && setD(r)).catch((e) => alive && setErr(e)); return () => { alive = false; }; }, [page]);
  return (
    <FitDialog wide title={tx('hs.history')} subtitle={tx('hs.historySub')} onClose={onClose} testId="hs-runs" footer={<><Pager info={d} onPage={setPage} /><button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{errorTextOf(err, tx('hs.loadFailed'))}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <table className="fk-table"><thead><tr><th>{tx('hs.when')}</th><th>{tx('hs.how')}</th><th>{tx('hs.result')}</th><th>{tx('hs.overall')}</th><th className="num">{statusLabel('action_required')}</th><th className="num">{statusLabel('error')}</th></tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id}><td>{when(r.startedAt)}</td><td>{tx('hs.trigger.' + r.trigger)}</td><td>{tx('hs.runStatus.' + r.status)}</td><td>{r.overall ? statusLabel(r.overall) : '—'}</td>
            <td className="num">{r.counts?.action_required ?? 0}</td><td className="num">{r.counts?.error ?? 0}</td></tr>)}</tbody></table>)}
    </FitDialog>
  );
}
