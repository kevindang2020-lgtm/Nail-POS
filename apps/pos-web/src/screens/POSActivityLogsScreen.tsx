// POSActivityLogsScreen.tsx — /tenant/account/activity-logs. The full audit trail behind the Account screen's
// "View Full Audit Log" link. Backed entirely by the real tenant-scoped feed GET /pos/audit/events
// (permission audit.view) via posAuditApi, with server-side filtering (search, module, severity, status, date range)
// and pagination. No sample data: honest loading / empty / no-permission states.
import { useEffect, useMemo, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { useNavigate } from 'react-router-dom';
import { posAuditApi, type AuditEventRow, type AuditPage } from '../api/posAuditApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { auditActionLabel, auditModuleLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';

const G = '#A96F22';
const PAGE_SIZE = 12;
const cardBox: React.CSSProperties = { background: 'var(--card, #FFFDF8)', border: '1px solid var(--line)', borderRadius: 16 };

const humanize = (a: string) => auditActionLabel(a);
const fmtWhen = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; return `${d.toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' })} — ${d.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' })}`; };
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const statusPill = (s: string) => (({ success: 'ok', warning: 'warn', failed: 'mut' } as Record<string, string>)[s] || 'mut');
const sevColor = (s: string) => (({ low: '#8A7A66', medium: '#A96F22', high: '#C0392B', critical: '#C0392B' } as Record<string, string>)[s] || '#8A7A66');

const emptyPage: AuditPage = { items: [], pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 } };

export function POSActivityLogsScreen() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [module, setModule] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, module, severity, status, from, to]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    posAuditApi.events({ page, pageSize: PAGE_SIZE, search: debounced || undefined, module: module || undefined, severity: severity || undefined, status: status || undefined, from: from || undefined, to: to || undefined })
      .then((d) => { if (alive) setData(d || emptyPage); })
      .catch(() => { if (alive) { setData(emptyPage); setError(tx('pos.unable_to_load_the_activity_log_qpyk')); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, debounced, module, severity, status, from, to]);

  const items: AuditEventRow[] = useMemo(() => data?.items || [], [data]);
  const pg = data?.pagination;
  const totalItems = pg?.totalItems ?? 0;
  const totalPages = pg?.totalPages || 1;
  const curPage = pg?.page ?? 1;

  // module options derived from the current results (backend has no list endpoint) + any active selection
  const moduleOpts = useMemo(() => { const set = new Set<string>(); items.forEach((e) => e.module && set.add(e.module)); if (module) set.add(module); return Array.from(set).sort(); }, [items, module]);
  const anyFilter = !!(debounced || module || severity || status || from || to);
  const clear = () => { setSearch(''); setDebounced(''); setModule(''); setSeverity(''); setStatus(''); setFrom(''); setTo(''); };

  const sel: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)', outline: 'none' };
  const cols = '152px 1.3fr 0.9fr 1fr 104px 1.5fr';
  const headStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' };

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
  <div className="vh flex flex-col md:flex-row items-start md:items-end justify-between gap-3">
        <div><h1>{tx('pos.activity_log')}</h1><div className="sub">{tx('pos.full_audit_trail_of_account_security_1qq0')}</div></div>
        <button className="btn ghost" onClick={() => nav('/tenant/account/overview')}>{tx('pos.back_to_account')}</button>
      </div>

      <div className="kpis" style={{ margin: 0 }}>
        {[
          { l: tx('pos.total_events'), v: totalItems.toLocaleString(), d: anyFilter ? tx('pos.matching_filters') : tx('pos.all_time') },
          { l: tx('pos.on_this_page'), v: String(items.length), d: tx('pos.page_curpage_of_totalpages', { curPage: String(curPage), totalPages: String(totalPages) }) },
          { l: tx('pos.filters_active'), v: anyFilter ? tx('admin.logs.filtersYes') : tx('admin.logs.filtersNone'), d: anyFilter ? tx('pos.narrowed_view') : tx('pos.showing_everything') },
        ].map((k) => (
          <div className="kpi" key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="l">{k.l}</div>
            <div className="v" style={{ color: G, fontSize: 20 }}>{k.v}</div>
            <div className="d" style={{ color: G }}>{k.d}</div>
          </div>
        ))}
      </div>

      <div style={{ ...cardBox, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
        <ImeSafeInput type="search" enterKeyHint="search" value={search} onValue={setSearch} placeholder={tx('pos.search_events_people_details')} style={{ ...sel, flex: '1 1 240px', minWidth: 200 }} />
        <select value={module} onChange={(e) => setModule(e.target.value)} style={sel} aria-label={tx('pos.module')}><option value="">{tx('pos.all_modules')}</option>{moduleOpts.map((m) => <option key={m} value={m}>{cap(m)}</option>)}</select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={sel} aria-label={tx('pos.severity_2')}><option value="">{tx('pos.any_severity')}</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel} aria-label={tx('pos.status')}><option value="">{tx('pos.any_status')}</option>{['success', 'warning', 'failed'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>{tx('pos.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={sel} /></label>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>{tx('pos.to_2')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={sel} /></label>
        {anyFilter ? <button className="btn ghost" onClick={clear}>{tx('pos.clear')}</button> : null}
      </div>

      <section style={{ ...cardBox, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="overflow-x-auto w-full" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ minWidth: 900, width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...headStyle, borderBottom: '1px solid var(--line)' }}><div>{tx('pos.time')}</div><div>{tx('pos.event')}</div><div>{tx('pos.module')}</div><div>{tx('pos.actor')}</div><div>{tx('pos.status')}</div><div>{tx('pos.details')}</div></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? (
            <div className="muted" style={{ padding: '28px 16px', textAlign: 'center' }}>{tx('pos.loading_activity')}</div>
          ) : items.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '44px 16px', textAlign: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{error ? tx('pos.activity_log_unavailable') : anyFilter ? tx('pos.no_events_match_these_filters') : tx('pos.no_account_activity_yet')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{error || (anyFilter ? tx('pos.try_widening_your_search_or_clearing_3uvk') : tx('pos.events_will_appear_here_as_they_lqyv'))}</div>
              </div>
            </div>
          ) : (
            items.map((e) => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)', fontSize: 11.5, alignItems: 'center' }}>
                <div style={{ color: 'var(--muted)' }}>{fmtWhen(e.occurredAt)}</div>
                <div style={{ fontWeight: 700 }}>{humanize(e.action)}</div>
                <div style={{ color: 'var(--muted)' }}>{auditModuleLabel(e.module)}</div>
                <div>{e.actorName || tx('pos.system')}{e.actorRole ? <span style={{ color: 'var(--muted)', fontSize: 10 }}> · {statusLabel('role', e.actorRole)}</span> : null}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className={'pill ' + statusPill(e.status)}>{cap(e.status)}</span>{e.severity && e.severity !== 'low' ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: sevColor(e.severity), flex: '0 0 auto' }} title={cap(e.severity)} /> : null}</div>
                <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.summary || '—'}{e.ip ? <span style={{ fontSize: 10, opacity: 0.7 }}> · {e.ip}</span> : null}</div>
              </div>
            ))
          )}
        </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{totalItems > 0 ? tx('pos.showing_v0_v1_of_v2', { v0: String((curPage - 1) * (pg!.pageSize) + 1), v1: String(Math.min(curPage * pg!.pageSize, totalItems)), v2: String(totalItems.toLocaleString()) }) : '—'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn ghost" disabled={loading || curPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{tx('pos.prev')}</button>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{tx('pos.page')}{' '}{curPage} / {totalPages}</div>
            <button className="btn ghost" disabled={loading || curPage >= totalPages} onClick={() => setPage((p) => p + 1)}>{tx('pos.next')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
