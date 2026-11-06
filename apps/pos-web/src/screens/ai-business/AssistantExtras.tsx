// AssistantExtras.tsx — A4 AI Business Assistant (Nov 6 2026): record search results, profit & expenses, growth advice and
// the stored, searchable history (with a CSV download — never a print). Server: ai-business-assistant-extras.ts.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiBusinessApi } from '../../api/posAiBusinessApi';
import { Pager, ErrorRetry, downloadCsv } from '../../components/FitKit';
import { fmtInZone, fmtMoney, fmtNumber } from '../../i18n/format';

export function RecordResults({ s }: { s: any }) {
  const customers: any[] = s?.customers ?? [], tickets: any[] = s?.tickets ?? [];
  return (
    <section className="panel" style={{ marginTop: 12, padding: 14 }} data-testid="aib-records">
      <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('aib.rec.title')}</div>
      {!s?.query ? <div className="sub">{t('aib.rec.how')}</div> : customers.length + tickets.length === 0 ? <div className="sub">{t('aib.rec.none')}</div> : (
        <ul style={{ paddingLeft: 18 }}>
          {customers.map((c) => <li key={c.id}><Link to={c.route} style={{ color: 'var(--aps-orange)' }}>{c.name}</Link></li>)}
          {tickets.map((x) => <li key={x.id}><Link to={x.route} style={{ color: 'var(--aps-orange)' }}>{t('aib.rec.ticket', { n: x.number })}</Link> · {fmtMoney(x.totalCents)} · {x.at ? fmtInZone(x.at, { month: 'short', day: 'numeric' }) : ''}</li>)}
        </ul>)}
      {(s?.hidden ?? []).length ? <div className="sub">{t('aib.rec.hidden')}</div> : null}
      <div className="sub">{t('aib.rec.private')}</div>
    </section>
  );
}

export function ProfitResults({ s }: { s: any }) {
  if (!s || s.expensesCents == null) return null;
  return (
    <section className="panel" style={{ marginTop: 12, padding: 14 }} data-testid="aib-profit">
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.net_sales')}</div><div className="v">{fmtMoney(s.netSalesCents)}</div></div>
        <div className="kpi"><div className="l">{t('aib.p.expenses')}</div><div className="v">{fmtMoney(s.expensesCents)}</div></div>
        <div className="kpi"><div className="l">{t('aib.p.result')}</div><div className="v" data-testid="aib-profit-result">{fmtMoney(s.operatingResultCents)}</div></div>
        <div className="kpi"><div className="l">{t('aib.p.margin')}</div><div className="v">{s.marginPercent == null ? t('bcx.na') : `${s.marginPercent}%`}</div></div>
      </div>
      {s.byCategory?.length ? <table className="tbl" style={{ marginTop: 8 }}><tbody>{s.byCategory.map((c: any) => <tr key={c.category}><td>{c.category}</td><td className="num">{fmtMoney(c.cents)}</td><td className="num">{fmtNumber(c.count)}</td></tr>)}</tbody></table> : null}
      {s.notYetApproved?.count ? <div className="sub">{t('aib.p.pending', { n: s.notYetApproved.count, v: fmtMoney(s.notYetApproved.cents) })}</div> : null}
      <div className="sub">{t('aib.p.note')}</div>
    </section>
  );
}

const TIP_PARAMS = (tip: any) => ({ ...tip.basis, abs: Math.abs(Number(tip.basis?.trendPercent ?? 0)) });
export function GrowthResults({ s }: { s: any }) {
  if (!s?.tips) return null;
  return (
    <section className="panel" style={{ marginTop: 12, padding: 14 }} data-testid="aib-growth">
      <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('aib.g.title')}</div>
      {s.tips.length === 0 ? <div className="sub">{t('aib.g.none')}</div> : <ul style={{ paddingLeft: 18 }}>{s.tips.map((x: any) => (
        <li key={x.kind} style={{ marginBottom: 4 }}>{t('aib.g.' + x.kind, TIP_PARAMS(x))} <Link to={x.route} style={{ color: 'var(--aps-orange)' }}>{t('bcx.a.go')}</Link></li>))}</ul>}
    </section>
  );
}

export function AssistantHistory({ tick, onReplay }: { tick: number; onReplay: (h: any) => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q: string; page: number }>({ q: '', page: 1 });
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setErr(null); posAiBusinessApi.center.assistantHistory({ q: f.q || undefined, page: f.page, limit: 10 }).then(setList).catch(() => setErr(t('aib.h.loadFailed'))); }, [f]);
  useEffect(() => { load(); }, [load, tick]);
  const remove = (id: string) => { setBusy(true); posAiBusinessApi.center.assistantHistoryDelete(id).then(load).catch(() => setErr(t('aib.h.deleteFailed'))).finally(() => setBusy(false)); };
  const csv = async () => {
    setBusy(true);
    try {
      const rows: unknown[][] = [];
      for (let page = 1; page <= 50; page++) {
        const r = await posAiBusinessApi.center.assistantHistory({ q: f.q || undefined, page, limit: 100 });
        for (const x of r.items) rows.push([x.at, x.question, x.intent, x.preset, x.period?.from ?? '', x.period?.to ?? '', x.answeredBy, x.answer]);
        if (page >= r.totalPages) break;
      }
      downloadCsv('ai-business-assistant-history.csv', [t('aib.h.c.at'), t('aib.h.c.question'), t('aib.h.c.topic'), t('aib.h.c.period'), t('aib.h.c.from'), t('aib.h.c.to'), t('aib.h.c.by'), t('aib.h.c.answer')], rows);
    } catch { setErr(t('aib.h.loadFailed')); } finally { setBusy(false); }
  };
  return (
    <section className="panel" style={{ marginTop: 12, padding: 14 }} data-testid="aib-history">
      <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('aib.h.title')}</div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); setF({ q: draft.trim(), page: 1 }); }}>
        <input className="rvw-search" type="search" data-testid="aib-h-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('aib.h.search')} aria-label={t('aib.h.search')} />
        <button className="btn" type="submit">{t('bzx.search')}</button>
        <button className="btn ghost" type="button" data-testid="aib-h-csv" disabled={busy || !list?.total} onClick={() => void csv()}>{t('aib.h.csv')}</button>
      </form>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('pos.loading')}</div> : list.items.length === 0 ? <div className="sub">{t('aib.h.none')}</div> : (
        <ul style={{ paddingLeft: 0, listStyle: 'none' }}>{list.items.map((h: any) => (
          <li key={h.id} data-testid="aib-h-row" style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <b>{h.question || t('aib.h.topic.' + (h.intent ?? 'none'))}</b> <span className="sub">· {h.period ? `${h.period.from} – ${h.period.to}` : h.preset ? t('bzx.period.' + h.preset) : ''} · {h.at ? fmtInZone(h.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
            {h.answer ? <div className="sub" style={{ whiteSpace: 'pre-wrap' }}>{h.answer.length > 280 ? h.answer.slice(0, 280) + '…' : h.answer}</div> : null}
            <div className="rvw-actions">
              {h.intent ? <button type="button" className="btn ghost" data-testid="aib-h-replay" onClick={() => onReplay(h)}>{t('aib.h.again')}</button> : null}
              <button type="button" className="btn ghost" data-testid="aib-h-delete" disabled={busy} onClick={() => remove(h.id)}>{t('pos.delete')}</button>
            </div>
          </li>))}</ul>)}
      {list ? <Pager info={{ page: list.page, pageSize: list.limit, totalItems: list.total, totalPages: list.totalPages }} onPage={(p) => setF({ ...f, page: p })} /> : null}
      <div className="sub">{t('aib.h.note', { n: list?.retentionDays ?? 365 })}</div>
    </section>
  );
}
