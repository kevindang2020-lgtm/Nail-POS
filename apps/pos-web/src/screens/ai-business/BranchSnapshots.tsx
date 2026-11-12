// BranchSnapshots.tsx — AI BRANCH COMPARISON 14 (Nov 12 2026): Manager Sign-Off Notes.
// "Save this comparison" asks the server to freeze ITS OWN comparison for the chosen period (the browser sends only the
// period and an optional title — never figures). A saved comparison never changes; a reviewer adds sign-off notes
// (approved / needs follow-up / noted, a required note) that are kept in order and never edit the figures.
// Server: modules/analytics/src/ai-business/branch-insights.ts saveSnapshot / listSnapshots / snapshot / signOff.
import { useEffect, useState } from 'react';
import { posAiBusinessApi } from '../../api/posAiBusinessApi';
import { Empty, ErrorRetry, FitDialog, Pager } from '../../components/FitKit';
import { bt, bzErr, bzNum, bzValue, bzWhen, bzDays } from '../../components/BusinessKit';

type SignOffView = { id: string; decision: string; note: string; reviewer: string | null; at: string };
type SnapshotSummaryView = { id: string; title: string | null; preset: string; range: { from: string; to: string } | null; asOf: string; savedBy: string | null; savedAt: string;
  branches: number; financialsIncluded: boolean; signOffs: number; lastDecision: string | null };
type SnapshotDetailView = SnapshotSummaryView & { totals: Record<string, number | null>; rows: Array<Record<string, string | number | null>>; signOffList: SignOffView[]; canSignOff: boolean };
type ListView = { items: SnapshotSummaryView[]; page: number; pageSize: number; totalItems: number; totalPages: number };
const DECISIONS = ['approved', 'needs_follow_up', 'noted'] as const;
const tone = (d: string | null) => (d === 'approved' ? 'ok' : d === 'needs_follow_up' ? 'warn' : '');
const periodText = (s: { preset: string; range: { from: string; to: string } | null }) => (s.range ? bzDays(s.range) : bt('bzx.period.' + s.preset));
const money = (v: number | string | null | undefined) => (v == null ? '—' : bzValue(Number(v), 'cents'));

export function BranchSnapshotsPanel({ period, tick }: { period: { preset?: string; from?: string; to?: string }; tick: number }) {
  const [list, setList] = useState<ListView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [n, setN] = useState(0);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setErr(null);
    posAiBusinessApi.center.branchSnapshots({ page }).then((x) => { if (live) setList(x as ListView); }).catch((e) => { if (live) setErr(bzErr(e)); });
    return () => { live = false; };
  }, [page, n, tick]);
  const save = () => {
    setBusy(true); setErr(null);
    const p = period.preset === 'custom' ? { from: period.from, to: period.to } : { preset: period.preset };
    posAiBusinessApi.center.saveBranchSnapshot({ ...p, title: title.trim() || undefined })
      .then((d: SnapshotDetailView) => { setSaving(false); setTitle(''); setNote(bt('bcx.snap.saved')); setPage(1); setN((x) => x + 1); setOpenId(d.id); })
      .catch((e) => setErr(bzErr(e))).finally(() => setBusy(false));
  };
  return (
    <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="bcx-snaps">
      <div className="p-h">{bt('bcx.snap.title')}</div>
      <div className="sub">{bt('bcx.snap.sub')}</div>
      {note ? <div className="fk-note ok" role="status" data-testid="bcx-snap-note">{note}</div> : null}
      {saving ? (
        <div className="rvw-filters" data-testid="bcx-snap-form">
          <input className="rvw-search" data-testid="bcx-snap-name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={bt('bcx.snap.namePh')} aria-label={bt('bcx.snap.namePh')} />
          <button type="button" className="btn" data-testid="bcx-snap-confirm" disabled={busy} onClick={save}>{bt('bcx.snap.confirm')}</button>
          <button type="button" className="btn ghost" onClick={() => setSaving(false)}>{bt('bzx.close')}</button>
        </div>
      ) : <button type="button" className="btn ghost" data-testid="bcx-snap-save" onClick={() => { setNote(null); setSaving(true); }}>{bt('bcx.snap.save')}</button>}
      {err ? <ErrorRetry message={err} onRetry={() => setN((x) => x + 1)} /> : !list ? <div className="state">{bt('bzx.loading')}</div> : list.items.length === 0 ? <Empty title={bt('bcx.snap.none')} /> : (<>
        <ul className="rvw-list" data-testid="bcx-snap-list">{list.items.map((s) => (
          <li key={s.id} data-testid="bcx-snap-row">
            <button type="button" className="fk-link" onClick={() => setOpenId(s.id)}>{s.title || periodText(s)}</button>{' '}
            <span className="sub">{bt('bcx.snap.line', { p: periodText(s), at: bzWhen(s.asOf), who: s.savedBy ?? '—', n: bzNum(s.branches) })}</span>{' '}
            {s.lastDecision ? <span className={'chip ' + tone(s.lastDecision)} data-testid="bcx-snap-last">{bt('bcx.snap.d.' + s.lastDecision)}</span> : <span className="chip" data-testid="bcx-snap-last">{bt('bcx.snap.unreviewed')}</span>}
          </li>))}</ul>
        <Pager info={{ page: list.page, pageSize: list.pageSize, totalItems: list.totalItems, totalPages: list.totalPages }} onPage={setPage} />
      </>)}
      {openId ? <SnapshotDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => setN((x) => x + 1)} /> : null}
    </section>
  );
}

function SnapshotDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<SnapshotDetailView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [decision, setDecision] = useState<string>('approved');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    posAiBusinessApi.center.branchSnapshot(id).then((x) => { if (live) setD(x as SnapshotDetailView); }).catch((e) => { if (live) setErr(bzErr(e)); });
    return () => { live = false; };
  }, [id]);
  const sign = () => {
    if (text.trim().length < 3) { setFormErr(bt('bcx.snap.noteRequired')); return; }
    setBusy(true); setFormErr(null);
    posAiBusinessApi.center.signOffBranchSnapshot(id, { decision, note: text.trim() })
      .then((x) => { setD(x as SnapshotDetailView); setText(''); onChanged(); }).catch((e) => setFormErr(bzErr(e))).finally(() => setBusy(false));
  };
  const fin = !!d?.financialsIncluded;
  return (
    <FitDialog wide testId="bcx-snap-dlg" title={d ? (d.title || periodText(d)) : bt('bcx.snap.title')} onClose={onClose} busy={busy}
      footer={<button type="button" className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button>}>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="state">{bt('bzx.loading')}</div> : (<>
        <p className="sub" data-testid="bcx-snap-frozen">{bt('bcx.snap.frozen', { p: periodText(d), at: bzWhen(d.asOf), who: d.savedBy ?? '—' })}</p>
        <div className="rvw-table-wrap"><table className="tbl" data-testid="bcx-snap-table"><thead><tr>
          <th>{bt('pos.branch')}</th><th className="num">{bt('pos.net_sales')}</th><th className="num">{bt('pos.bookings_2')}</th><th className="num">{bt('pos.completed_2')}</th><th className="num">{bt('pos.completion')}</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={String(r.branchId)} data-testid="bcx-snap-trow"><td>{String(r.branchName ?? '')}</td><td className="num">{fin ? money(r.netSalesCents) : '—'}</td>
              <td className="num">{bzNum(r.totalBookings == null ? null : Number(r.totalBookings))}</td><td className="num">{bzNum(r.completed == null ? null : Number(r.completed))}</td>
              <td className="num">{r.completionRate == null ? bt('bcx.na') : `${r.completionRate}%`}</td></tr>))}</tbody></table></div>
        {!fin ? <p className="sub">{bt('bcx.snap.moneyHidden')}</p> : null}
        <div className="p-h" style={{ marginTop: 10 }}>{bt('bcx.snap.signoffs')}</div>
        {d.signOffList.length === 0 ? <div className="sub" data-testid="bcx-snap-nosign">{bt('bcx.snap.unreviewed')}</div> : (
          <ul className="rvw-list" data-testid="bcx-snap-signoffs">{d.signOffList.map((x) => (
            <li key={x.id} data-testid="bcx-snap-signoff"><span className={'chip ' + tone(x.decision)}>{bt('bcx.snap.d.' + x.decision)}</span> {x.note} <span className="sub">{bt('bcx.snap.by', { who: x.reviewer ?? '—', at: bzWhen(x.at) })}</span></li>))}</ul>)}
        {d.canSignOff ? (
          <div className="rvw-filters" data-testid="bcx-snap-signform" style={{ alignItems: 'flex-end' }}>
            <label className="rvw-f"><span>{bt('bcx.snap.decision')}</span><select data-testid="bcx-snap-decision" value={decision} onChange={(e) => setDecision(e.target.value)}>{DECISIONS.map((x) => <option key={x} value={x}>{bt('bcx.snap.d.' + x)}</option>)}</select></label>
            <label className="rvw-f" style={{ flex: 1 }}><span>{bt('bcx.snap.note')}</span><input className="rvw-search" data-testid="bcx-snap-text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} /></label>
            <button type="button" className="btn" data-testid="bcx-snap-sign" disabled={busy} onClick={sign}>{bt('bcx.snap.sign')}</button>
          </div>) : <p className="sub" data-testid="bcx-snap-cannot">{bt('bcx.snap.cannotSign')}</p>}
        {formErr ? <div className="err" role="alert">{formErr}</div> : null}
        <p className="sub">{bt('bcx.snap.rule')}</p>
      </>)}
    </FitDialog>
  );
}
