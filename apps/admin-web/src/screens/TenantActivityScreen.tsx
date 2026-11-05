// Super-Admin → Tenant Activity (the "View All" target of the Recent Tenant Activity card). A faceted, dashboard-friendly
// read-model over audit_logs: summary cards, search + event-type/severity/category/date filters, a paginated table, and a
// detail panel. Reads GET /super-admin/tenant-activity(/summary). No new table — every row is an audit_logs entry.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

type Item = {
  id: string; eventType: string; category: string; icon: string; title: string;
  tenantId: string | null; tenantName: string | null; salonCode: string | null;
  description: string; severity: 'info' | 'success' | 'warning' | 'error';
  actorUserId: string | null; actorRole: string | null; relatedRecordId: string | null;
  createdAt: string; ageLabel: string;
};

const SEV_BADGE: Record<string, { bg: string; fg: string }> = {
  error: { bg: '#FBEFE9', fg: '#B85B4D' }, warning: { bg: '#FFF6E5', fg: '#D09A36' },
  success: { bg: '#EAF5EE', fg: '#3E8F57' }, info: { bg: '#EAF2FB', fg: '#3C7FB6' },
};
const CATEGORIES = ['tenant', 'payment', 'hardware', 'ai', 'application', 'support', 'other'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TenantActivityScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState(params.get('category') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tenantId] = useState(params.get('tenantId') || '');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [data, setData] = useState<{ items: Item[]; total: number; pageCount: number } | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const query = useMemo(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(eventType ? { eventType } : {}),
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(tenantId ? { tenantId } : {}),
  }), [search, eventType, severity, category, from, to, tenantId]);

  const load = () => {
    setLoading(true); setErr(null);
    superAdminApi.tenantActivity({ ...query, page, limit })
      .then((r: any) => setData(r))
      .catch((e: any) => setErr(e?.message || 'Unable to load tenant activity.'))
      .finally(() => setLoading(false));
  };
  const loadSummary = () => superAdminApi.tenantActivitySummary(query).then(setSum).catch(() => setSum(null));

  // filters change → reset to page 1
  useEffect(() => { setPage(1); }, [search, eventType, severity, category, from, to]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t);   }, [query, page, limit]);
  useEffect(() => { loadSummary();   }, [query]);

  const clearFilters = () => { setSearch(''); setEventType(''); setSeverity(''); setCategory(''); setFrom(''); setTo(''); };
  const hasFilters = !!(search || eventType || severity || category || from || to || tenantId);
  const open = data?.items.find((i) => i.id === openId) || null;
  const KPIS = [
    { l: 'Total Events', v: sum?.total, icon: '⚡', bg: '#FFF6E5', fg: '#B98427' },
    { l: 'Tenant', v: sum?.tenant, icon: '🏢', bg: '#EAF1FF', fg: '#2F6FED' },
    { l: 'Payment', v: sum?.payment, icon: '💳', bg: '#E7F5EC', fg: '#1F9254' },
    { l: 'Hardware', v: sum?.hardware, icon: '🖥️', bg: '#F3ECFB', fg: '#7C3AED' },
    { l: 'AI', v: sum?.ai, icon: '✨', bg: '#FFF0F5', fg: '#C2569B' },
    { l: 'Warning / Error', v: sum?.warningError, icon: '⚠️', bg: '#FBE7E4', fg: '#C0392B' },
  ];
  const start = data && data.total ? (page - 1) * limit + 1 : 0;
  const end = data ? Math.min(page * limit, data.total) : 0;

  const exportCsv = () => {
    if (!data?.items?.length) return;
    const headers = ['Event', 'Category', 'Tenant', 'Salon Code', 'Description', 'Severity', 'Actor', 'Timestamp'];
    const esc = (v: string) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = data.items.map((a) => [a.title, a.category, a.tenantName || '', a.salonCode || '', a.description, a.severity, a.actorRole || (a.actorUserId ? 'User' : 'System'), a.createdAt].map(esc).join(','));
    const csv = [headers.join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `tenant-activity-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const inpStyle: React.CSSProperties = {
    height: 34,
    border: '1px solid var(--line)',
    borderRadius: 9,
    padding: '0 10px',
    background: '#FFFDF8',
    fontFamily: 'inherit',
    fontSize: 12.5,
    color: 'var(--text)',
    outline: 'none',
  };

  return (
    <div className="work">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-3">
        <div className="vh" style={{ flex: 1, margin: 0 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0 }}>
            Tenant Activity <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Track recent tenant onboarding, payment, hardware, AI, support, and platform events{tenantId ? ' · filtered to one tenant' : ''}.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={exportCsv} disabled={!data?.items?.length} title="Export current view to CSV" style={{ minHeight: 36 }}>
            ⤓ Export
          </button>
          <button className="btn ghost" onClick={() => { load(); loadSummary(); }} disabled={loading} title="Refresh activity feed" style={{ minHeight: 36 }}>
            {loading ? '↻ Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '0 0 16px' }}>
        {KPIS.map((k) => (
          <div
            key={k.l}
            className="kpi"
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '12px 14px',
              boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.l}</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center', fontSize: 13 }}>{k.icon}</span>
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
              {k.v != null ? Number(k.v).toLocaleString() : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Main Activity Table Panel */}
      <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        {/* Panel Header */}
        <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
            Activity Feed {data ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({data.total.toLocaleString()} total events)</span> : null}
          </h2>
          {loading ? <span className="muted" style={{ fontSize: 11 }}>updating…</span> : null}
        </div>

        {/* Filter bar */}
        <div className="filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: '#FFFDF8' }}>
          <input placeholder="Search tenant, salon code, event, actor…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inpStyle, flex: 1, minWidth: 220 }} />
          <input placeholder="Event type" value={eventType} onChange={(e) => setEventType(e.target.value)} style={{ ...inpStyle, width: 140 }} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inpStyle}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={inpStyle}><option value="">All severities</option>{['info', 'success', 'warning', 'error'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" style={inpStyle} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" style={inpStyle} />
          {hasFilters ? <button className="btn ghost" onClick={clearFilters} style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}>⤺ Clear</button> : null}
        </div>

        {err ? (
          <div style={{ padding: 20 }}>
            <div className="err">{err} <button className="btn ghost" onClick={load} style={{ marginLeft: 10 }}>Retry</button></div>
          </div>
        ) : loading && !data ? (
          <div className="state" style={{ padding: '60px 20px', textAlign: 'center' }}>Loading tenant activity…</div>
        ) : !data || data.items.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--cream2,#F7F2E9)', color: 'var(--gold,#A96F22)', display: 'grid', placeItems: 'center', fontSize: 22, margin: '0 auto 12px' }}>⚡</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>No tenant activity matches these filters.</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 380, margin: '0 auto 14px' }}>
              {hasFilters ? 'Try clearing or adjusting your search parameters.' : 'Activity will be logged here as tenants onboard, process payments, and interact with the platform.'}
            </div>
            {hasFilters && (
              <button className="btn ghost" onClick={clearFilters} style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}>
                ⤺ Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="ttable-wrap" style={{ overflowX: 'auto' }}>
            <table className="ttable" style={{ width: '100%' }}>
              <thead style={{ background: '#FAF6F0' }}>
                <tr>
                  <th style={{ padding: '11px 14px' }}>Event</th>
                  <th style={{ padding: '11px 14px' }}>Tenant / Salon</th>
                  <th style={{ padding: '11px 14px' }}>Description</th>
                  <th style={{ padding: '11px 14px' }}>Severity</th>
                  <th style={{ padding: '11px 14px' }}>Actor</th>
                  <th style={{ padding: '11px 14px' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setOpenId(openId === a.id ? null : a.id)}
                    style={{
                      cursor: 'pointer',
                      background: openId === a.id ? '#FBF4E6' : undefined,
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 7, background: '#F5EFE6', display: 'grid', placeItems: 'center', fontSize: 13, flex: 'none' }}>
                          {a.icon}
                        </span>
                        <span style={{ fontWeight: 600 }}>{a.title}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontWeight: 600 }}>{a.tenantName || '—'}</span>
                      {a.salonCode ? <span className="muted"> · {a.salonCode}</span> : null}
                    </td>
                    <td style={{ padding: '11px 14px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.description || '—'}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span
                        className="badge"
                        style={{
                          background: SEV_BADGE[a.severity]?.bg || '#EAF2FB',
                          color: SEV_BADGE[a.severity]?.fg || '#3C7FB6',
                          border: `1px solid ${SEV_BADGE[a.severity]?.fg || '#3C7FB6'}30`,
                        }}
                      >
                        {cap(a.severity)}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {a.actorRole ? cap(a.actorRole.replace(/_/g, ' ').toLowerCase()) : a.actorUserId ? 'User' : 'System'}
                    </td>
                    <td style={{ padding: '11px 14px' }} title={new Date(a.createdAt).toLocaleString()}>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{a.ageLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {data && data.total > 0 ? (
          <div className="pgbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--line)', background: '#FFFDF8', fontSize: 12.5 }}>
            <span className="muted">Showing {start}–{end} of {data.total.toLocaleString()} events</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select value={limit} onChange={(e) => { setLimit(+e.target.value); setPage(1); }} style={{ ...inpStyle, height: 30, padding: '0 6px', fontSize: 12 }}>
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>
                  ‹ Prev
                </button>
                <span className="muted" style={{ padding: '0 4px' }}>Page {page} of {data.pageCount}</span>
                <button className="btn ghost" disabled={page >= data.pageCount} onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))} style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>
                  Next ›
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Selected Event Details Inspector */}
      {open ? (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', marginTop: 14 }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{open.icon}</span> {open.title}
            </h2>
            <button className="btn ghost" onClick={() => setOpenId(null)} style={{ minHeight: 28, padding: '0 8px', fontSize: 11 }}>
              ✕ Close
            </button>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 8, columnGap: 14, fontSize: 13 }}>
              <div className="muted" style={{ fontWeight: 600 }}>Tenant</div><div>{open.tenantName || '—'}{open.salonCode ? ` · ${open.salonCode}` : ''}</div>
              <div className="muted" style={{ fontWeight: 600 }}>Event type</div><div><code style={{ fontSize: 12, background: '#F5EFE6', padding: '2px 6px', borderRadius: 4 }}>{open.eventType}</code></div>
              <div className="muted" style={{ fontWeight: 600 }}>Category</div><div>{cap(open.category)}</div>
              <div className="muted" style={{ fontWeight: 600 }}>Severity</div><div><span className="badge" style={{ background: SEV_BADGE[open.severity]?.bg, color: SEV_BADGE[open.severity]?.fg }}>{cap(open.severity)}</span></div>
              <div className="muted" style={{ fontWeight: 600 }}>Description</div><div>{open.description || '—'}</div>
              <div className="muted" style={{ fontWeight: 600 }}>Actor</div><div>{open.actorRole ? cap(open.actorRole.replace(/_/g, ' ').toLowerCase()) : open.actorUserId || 'System'}</div>
              <div className="muted" style={{ fontWeight: 600 }}>Related record</div><div>{open.relatedRecordId || '—'}</div>
              <div className="muted" style={{ fontWeight: 600 }}>Timestamp</div><div>{new Date(open.createdAt).toLocaleString()}</div>
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => nav(`/audit-logs?tenantId=${encodeURIComponent(open.tenantId || '')}`)} style={{ minHeight: 34, fontSize: 12 }}>
                View in Audit Logs
              </button>
              {open.tenantId ? (
                <button className="btn ghost" onClick={() => nav(`/tenants?focus=${encodeURIComponent(open.tenantId!)}`)} style={{ minHeight: 34, fontSize: 12 }}>
                  Open tenant
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
