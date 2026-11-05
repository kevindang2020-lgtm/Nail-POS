// WebsiteLeadsScreen.tsx — Super-Admin Website Leads (replaces the basic LeadsScreen). Matches the design: KPI row,
// filter bar (URL-synced), the leads table with score/status/assignee/follow-up + actions, Leads-by-Source donut,
// Leads-by-Status bars, Top Lead Sources, recent activity, Add Lead modal, and a lead detail drawer. Everything is wired
// to /super-admin/website-leads/*; no fabricated data — empty states show when there are no leads yet.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { superAdminWebsiteLeadsApi as apiL, useSuperAdminWebsiteLeadsState, type WebsiteLead } from '../api/superAdminWebsiteLeadsApi';

const SOURCE_LABEL: Record<string, string> = { website_form: 'Website Form', live_chat: 'Live Chat', instagram: 'Instagram', facebook_ads: 'Facebook Ads', google_ads: 'Google Ads', referral: 'Referral', manual: 'Manual Entry', phone: 'Phone Call', email: 'Email' };
const SOURCE_COLOR: Record<string, string> = { website_form: '#3C7FB6', live_chat: '#3E8F57', instagram: '#C2569B', facebook_ads: '#D08A36', google_ads: '#E0B73C', referral: '#3FB6A8', manual: '#9A8C76', phone: '#7E73A8', email: '#6FA0B0' };
const STATUS_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', converted: 'Converted', unqualified: 'Unqualified', lost: 'Lost', spam: 'Spam', archived: 'Archived' };
const statusStyle = (s: string): React.CSSProperties => {
  const map: Record<string, [string, string]> = { new: ['#EAF1F8', '#3C7FB6'], contacted: ['#FFF6E5', '#B98427'], qualified: ['#EEF7EF', '#3E8F57'], converted: ['#F4ECDA', '#9A6F1E'], unqualified: ['#F6ECEA', '#B85B4D'], lost: ['#F6ECEA', '#B85B4D'], spam: ['#F6ECEA', '#B85B4D'], archived: ['#EFEDEA', '#857D70'] };
  const [bg, fg] = map[s] ?? ['#EFEDEA', '#857D70'];
  return { background: bg, color: fg, fontSize: 11.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' };
};
const scoreColor = (n: number | null) => (n == null || n <= 0 ? '#857D70' : n >= 80 ? '#3E8F57' : n >= 50 ? '#9A6F1E' : '#C0743C');
const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US')}`);
const initials = (s: string | null) => (s || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const ago = (iso: string) => { const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };

const KPI = ({ label, value, trend, icon, bg, fg }: { label: string; value: string; trend?: number; icon?: string; bg?: string; fg?: string }) => (
  <div
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
      <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {icon ? <span style={{ width: 26, height: 26, borderRadius: 7, background: bg || '#FFF9EF', color: fg || '#A96F22', display: 'grid', placeItems: 'center', fontSize: 13 }}>{icon}</span> : null}
    </div>
    <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    {trend != null ? (
      <div style={{ fontSize: 11, color: trend >= 0 ? '#3E8F57' : '#B85B4D', marginTop: 4, fontWeight: 700 }}>
        {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs last month
      </div>
    ) : (
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>0% vs last month</div>
    )}
  </div>
);

export function WebsiteLeadsScreen() {
  const [sp, setSp] = useSearchParams();
  const query = {
    search: sp.get('search') || '', source: sp.get('source') || 'all', status: sp.get('status') || 'all', scoreRange: sp.get('scoreRange') || 'all',
    dateFrom: sp.get('dateFrom') || '', dateTo: sp.get('dateTo') || '', page: Number(sp.get('page')) || 1, limit: 10,
  };
  const { state, loading, error, reload } = useSuperAdminWebsiteLeadsState(query);
  const [search, setSearch] = useState(query.search);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const setParam = (patch: Record<string, string>) => setSp((prev) => { const next = new URLSearchParams(prev); Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); }); if (!('page' in patch)) next.delete('page'); return next; }, { replace: true });
  const clearFilters = () => { setSearch(''); setSp(new URLSearchParams(), { replace: true }); };
  // debounce search → URL
  useEffect(() => { const t = setTimeout(() => { if (search !== query.search) setParam({ search }); }, 350); return () => clearTimeout(t); }, [search]);  

  const act = async (key: string, fn: () => Promise<any>) => { setBusy(key); setNote(null); setMenuId(null); try { await fn(); reload(); } catch (e: any) { setNote(e?.message || 'Action failed.'); } finally { setBusy(null); } };
  const doExport = async () => { setBusy('export'); setNote(null); try { await apiL.downloadCsv(query); } catch (e: any) { setNote(e?.message || 'Export failed. Please try again.'); } finally { setBusy(null); } };

  const k = state?.kpis;

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

  const sel = (name: string, value: string, opts: { v: string; t: string }[]) => (
    <select value={value} onChange={(e) => setParam({ [name]: e.target.value })} style={inpStyle}>
      {opts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
    </select>
  );

  return (
    <div className="work">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-3">
        <div className="vh" style={{ flex: 1, margin: 0 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0 }}>
            Website Leads <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Manage and convert website leads into tenant applications.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" disabled={busy === 'export'} onClick={doExport} style={{ minHeight: 36 }}>
            {busy === 'export' ? 'Exporting…' : '⤓ Export'}
          </button>
          <button className="btn ghost" onClick={reload} style={{ minHeight: 36 }}>
            ↻ Refresh
          </button>
          <button className="btn" onClick={() => { setShowAdd(true); setNote(null); }} style={{ minHeight: 36, fontWeight: 800 }}>
            + Add Lead
          </button>
        </div>
      </div>

      {note ? <div className="state" style={{ margin: '8px 0' }}>{note}</div> : null}
      {error ? <div className="err" style={{ margin: '10px 0' }}>{error} <button className="linkbtn" onClick={reload}>Retry</button></div> : null}

      {/* KPI row */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3 mt-3">
        <KPI label="Total Leads" value={(k?.totalLeads ?? 0).toLocaleString()} trend={k?.trends.totalLeads} icon="🎯" bg="#FFF6E5" fg="#B98427" />
        <KPI label="New Leads" value={(k?.newLeads ?? 0).toLocaleString()} trend={k?.trends.newLeads} icon="✨" bg="#EAF1FF" fg="#2F6FED" />
        <KPI label="Contacted" value={(k?.contacted ?? 0).toLocaleString()} trend={k?.trends.contacted} icon="📞" bg="#F3ECFB" fg="#7C3AED" />
        <KPI label="Qualified" value={(k?.qualified ?? 0).toLocaleString()} trend={k?.trends.qualified} icon="✓" bg="#E7F5EC" fg="#1F9254" />
        <KPI label="Converted" value={(k?.converted ?? 0).toLocaleString()} trend={k?.trends.converted} icon="🏢" bg="#FFF0F5" fg="#C2569B" />
        <KPI label="Conversion Rate" value={`${(k?.conversionRatePct ?? 0).toFixed(2)}%`} trend={k?.trends.conversionRatePct} icon="📈" bg="#EAF5EE" fg="#3E8F57" />
      </div>

      {/* Main grid: table + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
        <div className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          {/* Panel Header */}
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
              Leads Pipeline {state ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({state.pagination.totalItems.toLocaleString()})</span> : null}
            </h2>
            {loading ? <span className="muted" style={{ fontSize: 11 }}>updating…</span> : null}
          </div>

          {/* Integrated Filter bar */}
          <div className="filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: '#FFFDF8' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads by name, email, phone, salon name..." style={{ ...inpStyle, flex: 1, minWidth: 200 }} />
            {sel('source', query.source, [{ v: 'all', t: 'All Sources' }, ...Object.keys(SOURCE_LABEL).map((s) => ({ v: s, t: SOURCE_LABEL[s] }))])}
            {sel('status', query.status, [{ v: 'all', t: 'All Statuses' }, ...Object.keys(STATUS_LABEL).map((s) => ({ v: s, t: STATUS_LABEL[s] }))])}
            {sel('scoreRange', query.scoreRange, [{ v: 'all', t: 'All Scores' }, { v: 'hot', t: 'Hot 80–100' }, { v: 'warm', t: 'Warm 50–79' }, { v: 'cold', t: 'Cold 0–49' }, { v: 'none', t: 'No Score' }])}
            <input type="date" value={query.dateFrom} onChange={(e) => setParam({ dateFrom: e.target.value })} style={inpStyle} />
            <button className="btn ghost" onClick={clearFilters} style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}>⤺ Clear Filters</button>
          </div>

          {loading && !state ? <div className="state" style={{ padding: '60px 20px', textAlign: 'center' }}>Loading leads…</div>
            : (state?.leads.length ?? 0) === 0 ? (
              <div style={{ padding: '56px 20px', textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--cream2,#F7F2E9)', color: 'var(--gold,#A96F22)', display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 12px' }}>🎯</div>
                <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
                  {query.search || query.status !== 'all' || query.source !== 'all' ? 'No leads match your filters.' : 'No website leads yet.'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 360, margin: '0 auto 16px', lineHeight: 1.4 }}>
                  {query.search || query.status !== 'all' || query.source !== 'all' ? 'Try clearing or adjusting your search parameters.' : 'Inbound leads submitted through your marketing website and landing pages will show up here.'}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button className="btn" onClick={() => { setShowAdd(true); setNote(null); }} style={{ minHeight: 34, fontSize: 12 }}>
                    + Add Lead
                  </button>
                  {(query.search || query.status !== 'all' || query.source !== 'all') && (
                    <button className="btn ghost" onClick={clearFilters} style={{ minHeight: 34, fontSize: 12 }}>
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="ttable-wrap" style={{ overflowX: 'auto' }}>
                <table className="ttable" style={{ width: '100%' }}>
                  <thead style={{ background: '#FAF6F0' }}><tr>
                    <th style={{ padding: '11px 14px' }}>Lead / Salon Name</th>
                    <th style={{ padding: '11px 14px' }}>Contact Info</th>
                    <th style={{ padding: '11px 14px' }}>Source</th>
                    <th style={{ padding: '11px 14px' }}>Lead Score</th>
                    <th style={{ padding: '11px 14px' }}>Status</th>
                    <th style={{ padding: '11px 14px' }}>Next Follow Up</th>
                    <th style={{ padding: '11px 14px' }}>Created At</th>
                    <th style={{ padding: '11px 14px' }}>Assigned To</th>
                    <th style={{ padding: '11px 14px' }}></th>
                  </tr></thead>
                  <tbody>
                    {state!.leads.map((l) => (
                      <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(l.id)}>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--cream2)', color: 'var(--g8)', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{initials(l.salonName)}</span>
                            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700 }}>{l.salonName || '—'}</div><div style={{ fontSize: 12, color: 'var(--muted, #857D70)' }}>{l.contactName || '—'}</div></div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12 }}><div>{l.email || '—'}</div><div style={{ color: 'var(--muted, #857D70)' }}>{l.phone || '—'}</div></td>
                        <td style={{ padding: '11px 14px', fontSize: 12.5 }}><span style={{ color: SOURCE_COLOR[l.source || 'manual'], fontWeight: 700 }}>●</span> {SOURCE_LABEL[l.source || 'manual'] || l.source}</td>
                        <td style={{ padding: '11px 14px' }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 30, height: 24, borderRadius: 7, background: '#fff', border: `1.5px solid ${scoreColor(l.leadScore)}`, color: scoreColor(l.leadScore), fontWeight: 800, fontSize: 12 }}>{l.leadScore ?? '—'}</span></td>
                        <td style={{ padding: '11px 14px' }}><span style={statusStyle(l.status)}>{STATUS_LABEL[l.status] || l.status}</span></td>
                        <td style={{ padding: '11px 14px', fontSize: 12 }}>{fmtDate(l.nextFollowUpAt)}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12 }}>{fmtDate(l.createdAt)}<div style={{ color: 'var(--muted, #857D70)' }}>{fmtTime(l.createdAt)}</div></td>
                        <td style={{ padding: '11px 14px', fontSize: 12 }}>{l.assignedToName || <span style={{ color: 'var(--muted,#857D70)' }}>Unassigned</span>}</td>
                        <td style={{ padding: '11px 14px', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                          <button className="linkbtn" onClick={() => setMenuId(menuId === l.id ? null : l.id)} style={{ padding: '2px 8px' }}>⋮</button>
                          {menuId === l.id ? (
                            <div style={{ position: 'absolute', right: 8, top: 28, zIndex: 20, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 180, padding: 6 }}>
                              {[
                                ['View Lead', () => { setOpenId(l.id); setMenuId(null); }],
                                ['Mark Contacted', () => act('s' + l.id, () => apiL.setStatus(l.id, 'contacted'))],
                                ['Mark Qualified', () => act('q' + l.id, () => apiL.setStatus(l.id, 'qualified'))],
                                ['Convert to Application', () => act('c' + l.id, () => apiL.convert(l.id))],
                                ['Recalculate Score', () => act('r' + l.id, () => apiL.recalcScore(l.id))],
                                ['Archive', () => act('a' + l.id, () => apiL.setStatus(l.id, 'archived'))],
                                ['Mark Spam', () => act('sp' + l.id, () => apiL.setStatus(l.id, 'spam'))],
                              ].map(([label, fn]) => <button key={label as string} onClick={fn as any} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', borderRadius: 7, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>{label as string}</button>)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {state && state.pagination.totalItems > 0 ? (
            <div className="pgbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--line)', background: '#FFFDF8', fontSize: 12.5 }}>
              <span>Showing {(state.pagination.page - 1) * state.pagination.limit + 1} to {Math.min(state.pagination.page * state.pagination.limit, state.pagination.totalItems)} of {state.pagination.totalItems.toLocaleString()} leads</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn ghost" disabled={state.pagination.page <= 1} onClick={() => setParam({ page: String(state.pagination.page - 1) })} style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>‹ Prev</button>
                <span style={{ alignSelf: 'center', padding: '0 4px' }}>Page {state.pagination.page} of {state.pagination.totalPages}</span>
                <button className="btn ghost" disabled={state.pagination.page >= state.pagination.totalPages} onClick={() => setParam({ page: String(state.pagination.page + 1) })} style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>Next ›</button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right rail */}
        <div style={{ display: 'grid', gap: 14 }}>
          <RightPanel title="Leads by Source">
            <Donut data={state?.analytics.bySource ?? []} total={k?.totalLeads ?? 0} onPick={(s) => setParam({ source: s })} />
          </RightPanel>
          <RightPanel title="Leads by Status">
            {(state?.analytics.byStatus ?? []).map((s) => (
              <div key={s.status} style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => setParam({ status: s.status })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}><span>{STATUS_LABEL[s.status]}</span><span style={{ fontWeight: 700 }}>{s.count.toLocaleString()} ({s.pct}%)</span></div>
                <div style={{ height: 6, background: '#EFEDEA', borderRadius: 99 }}><div style={{ width: `${s.pct}%`, height: '100%', borderRadius: 99, background: statusStyle(s.status).color as string }} /></div>
              </div>
            ))}
            {(state?.analytics.byStatus ?? []).every((s) => s.count === 0) ? <div style={{ fontSize: 12, color: 'var(--muted,#857D70)' }}>No data yet.</div> : null}
          </RightPanel>
          <RightPanel title="Top Lead Sources">
            {(state?.analytics.topSources ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted,#857D70)' }}>No data yet.</div> :
              state!.analytics.topSources.map((s) => (
                <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => setParam({ source: s.source })}>
                  <span style={{ color: 'var(--muted,#857D70)', width: 14 }}>{s.rank}</span>
                  <span style={{ flex: 1 }}>{SOURCE_LABEL[s.source] || s.source}</span>
                  <span style={{ fontWeight: 700 }}>{s.count.toLocaleString()}</span>
                  <span style={{ color: s.growthPct >= 0 ? '#3E8F57' : '#B85B4D', minWidth: 44, textAlign: 'right', fontWeight: 700 }}>{s.growthPct >= 0 ? '▲' : '▼'} {Math.abs(s.growthPct)}%</span>
                </div>
              ))}
          </RightPanel>
        </div>
      </div>

      {/* Recent activity */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', marginTop: 16 }}>
        <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15, fontWeight: 700 }}>Recent Lead Activity</h2>
        </div>
        <div style={{ padding: 16 }}>
          {(state?.recentActivity ?? []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '18px 0', fontSize: 12.5, color: 'var(--muted,#857D70)' }}>
              Recent lead activity will appear here as leads are recorded and updated.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {state!.recentActivity.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: '#FFFDF8' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--cream2)', color: 'var(--g8)', display: 'grid', placeItems: 'center', fontSize: 13, flex: 'none' }}>•</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{a.title || a.activityType}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted,#857D70)' }}>{a.leadName || a.message || ''}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted,#857D70)', marginTop: 2 }}>{ago(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAdd ? <AddLeadModal users={state?.assignableUsers ?? []} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); reload(); }} /> : null}
      {openId ? <LeadDrawer id={openId} users={state?.assignableUsers ?? []} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}

const RightPanel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
    <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 14, fontWeight: 700 }}>{title}</h2>
      <button className="btn ghost" disabled title="A per-panel report is not available yet — Export downloads every lead with its source and status" style={{ minHeight: 26, padding: '0 8px', fontSize: 11, opacity: 0.6 }}>View Report</button>
    </div>
    <div style={{ padding: 14 }}>
      {children}
    </div>
  </div>
);

function Donut({ data, total, onPick }: { data: { source: string; count: number; pct: number }[]; total: number; onPick: (s: string) => void }) {
  if (data.length === 0) return <div style={{ fontSize: 12, color: 'var(--muted,#857D70)' }}>No data yet.</div>;
  let acc = 0;
  const stops = data.map((d) => { const start = acc; acc += d.pct; return `${SOURCE_COLOR[d.source] || '#9A8C76'} ${start}% ${acc}%`; }).join(', ');
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={{ width: 110, height: 110, borderRadius: '50%', background: `conic-gradient(${stops})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div><div style={{ fontWeight: 800, fontSize: 16 }}>{total.toLocaleString()}</div><div style={{ fontSize: 10, color: 'var(--muted,#857D70)' }}>Total Leads</div></div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {data.map((d) => (
          <div key={d.source} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0', cursor: 'pointer' }} onClick={() => onPick(d.source)}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: SOURCE_COLOR[d.source] || '#9A8C76' }} />
            <span style={{ flex: 1 }}>{SOURCE_LABEL[d.source] || d.source}</span>
            <span style={{ fontWeight: 700 }}>{d.count.toLocaleString()} ({d.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddLeadModal({ users, onClose, onCreated }: { users: { id: string; name: string }[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<any>({ salonName: '', contactName: '', phone: '', email: '', city: '', state: '', source: 'manual', message: '', assignedToUserId: '', nextFollowUpAt: '', technicianCount: '', monthlyCardVolume: '', currentPos: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const submit = () => {
    if (!f.salonName.trim() && !f.contactName.trim()) { setErr('Add at least a salon or contact name.'); return; }
    setBusy(true); setErr(null);
    apiL.create({ ...f, technicianCount: f.technicianCount || null, monthlyCardVolumeCents: f.monthlyCardVolume ? Math.round(Number(f.monthlyCardVolume) * 100) : null, assignedToUserId: f.assignedToUserId || null, nextFollowUpAt: f.nextFollowUpAt || null })
      .then(onCreated).catch((e: any) => setErr(e?.message || 'Could not create the lead.')).finally(() => setBusy(false));
  };
  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gline)', fontFamily: 'inherit', fontSize: 13, marginTop: 3 };
  const F = (label: string, k: string, type = 'text') => <LeadField key={k} label={label} type={type} value={String(f[k] ?? '')} onChange={(v) => set(k, v)} />;
  return (
    <div className="modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, width: 'min(620px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Add Lead</h2>
        {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {F('Salon Name','salonName')}{F('Contact Name','contactName')}
          {F('Phone','phone')}{F('Email','email')}
          {F('City','city')}{F('State','state')}
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted,#857D70)' }}>Source<select value={f.source} onChange={(e) => set('source', e.target.value)} style={inp}>{Object.keys(SOURCE_LABEL).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></label>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted,#857D70)' }}>Assign To<select value={f.assignedToUserId} onChange={(e) => set('assignedToUserId', e.target.value)} style={inp}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          {F('Current POS','currentPos')}{F('Technicians','technicianCount','number')}
          {F('Monthly Card Volume ($)','monthlyCardVolume','number')}{F('Next Follow Up','nextFollowUpAt','date')}
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted,#857D70)', display: 'block', marginTop: 10 }}>Message / Notes<textarea value={f.message} onChange={(e) => set('message', e.target.value)} style={{ ...inp, minHeight: 64 }} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Create Lead'}</button>
        </div>
      </div>
    </div>
  );
}

function LeadDrawer({ id, users, onClose, onChanged }: { id: string; users: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ lead: WebsiteLead; activities: any[]; followUps: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const load = () => { apiL.get(id).then(setData).catch((e: any) => setErr(e?.message || 'Failed to load lead.')); };
  useEffect(load, [id]);  
  const run = async (key: string, fn: () => Promise<any>) => { setBusy(key); try { await fn(); load(); onChanged(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); } };
  const l = data?.lead;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 'min(460px, 96vw)', background: '#fff', height: '100%', overflow: 'auto', padding: 20, boxShadow: '-8px 0 30px rgba(0,0,0,.12)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>Lead Detail</h2><button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button></div>
        {err ? <div className="err" style={{ margin: '8px 0' }}>{err}</div> : null}
        {!l ? <div className="state">Loading…</div> : (
          <>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{l.salonName || '—'}</div>
              <div style={{ color: 'var(--muted,#857D70)' }}>{l.contactName || '—'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <span style={statusStyle(l.status)}>{STATUS_LABEL[l.status] || l.status}</span>
                <span style={{ border: `1.5px solid ${scoreColor(l.leadScore)}`, color: scoreColor(l.leadScore), borderRadius: 7, padding: '1px 8px', fontWeight: 800, fontSize: 12 }}>Score {l.leadScore ?? '—'}</span>
                <span style={{ fontSize: 12.5, color: SOURCE_COLOR[l.source || 'manual'], fontWeight: 700 }}>● {SOURCE_LABEL[l.source || 'manual'] || l.source}</span>
              </div>
            </div>
            <Section title="Contact"><Row k="Email" v={l.email} /><Row k="Phone" v={l.phone} /><Row k="Location" v={[l.city, l.state].filter(Boolean).join(', ') || '—'} /></Section>
            <Section title="Salon"><Row k="Current POS" v={l.currentPos} /><Row k="Technicians" v={l.technicianCount != null ? String(l.technicianCount) : '—'} /><Row k="Monthly Volume" v={money(l.monthlyCardVolumeCents)} /></Section>
            <Section title="Assignment"><Row k="Assigned" v={l.assignedToName || 'Unassigned'} /><Row k="Next Follow-Up" v={fmtDate(l.nextFollowUpAt)} /><Row k="Created" v={`${fmtDate(l.createdAt)} ${fmtTime(l.createdAt)}`} /></Section>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('c', () => apiL.setStatus(l.id, 'contacted'))}>Mark Contacted</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('q', () => apiL.setStatus(l.id, 'qualified'))}>Mark Qualified</button>
              <button className="btn" disabled={!!busy || !!l.convertedApplicationId} onClick={() => run('v', () => apiL.convert(l.id))}>{l.convertedApplicationId ? 'Converted' : 'Convert to Application'}</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('r', () => apiL.recalcScore(l.id))}>Recalculate Score</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('a', () => apiL.setStatus(l.id, 'archived'))}>Archive</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => run('sp', () => apiL.setStatus(l.id, 'spam'))}>Mark Spam</button>
            </div>

            <Section title="Assign rep">
              <select defaultValue={l.assignedToUserId || ''} onChange={(e) => run('as', () => apiL.assign(l.id, e.target.value || null))} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--gline)', fontFamily: 'inherit', fontSize: 13 }}>
                <option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Section>

            <Section title="Add note">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note…" style={{ width: '100%', minHeight: 56, padding: 8, borderRadius: 8, border: '1px solid var(--gline)', fontFamily: 'inherit', fontSize: 13 }} />
              <button className="btn" disabled={!!busy || !noteText.trim()} style={{ marginTop: 6 }} onClick={() => run('n', async () => { await apiL.addNote(l.id, noteText); setNoteText(''); })}>Add Note</button>
            </Section>

            <Section title="Activity">
              {(data?.activities ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted,#857D70)' }}>No activity yet.</div> :
                data!.activities.map((a) => <div key={a.id} style={{ fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--line)' }}><strong>{a.title || a.activityType}</strong>{a.message ? ` — ${a.message}` : ''}<div style={{ color: 'var(--muted,#857D70)', fontSize: 11 }}>{ago(a.createdAt)}</div></div>)}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (<div style={{ marginTop: 14 }}><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--g7)', marginBottom: 6 }}>{title}</div>{children}</div>);
const Row = ({ k, v }: { k: string; v: string | null }) => (<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span style={{ color: 'var(--muted,#857D70)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span></div>);
const LeadField = ({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) => (
  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted,#857D70)' }}>{label}
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gline)', fontFamily: 'inherit', fontSize: 13, marginTop: 3 }} />
  </label>
);
