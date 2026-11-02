// OnboardingScreen.tsx — Super-Admin "Onboarding & Approvals" → All Applications. Header (title + actions), the 12
// KPI cards, and the All Onboarding Pipeline table (server-side search / filter / sort / pagination) — all on the
// cream/gold + Mac-fit system (fixed shell, the table scrolls inside its own card). Renders only real backend rows;
// where the backend does not yet compute a value (e.g. KPI trends) the card shows no fabricated percentage. The
// remaining reference modules (health, workflow strip, donuts, etc.) land in the next unit; this screen never shows
// placeholder/fake data for them.
import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Donut } from './_chartkit';
import { useOnboardingOverview, onboardingApi, type OnboardingQuery, type OnboardingState, type OnboardingRow, type OnboardingKpis, type OnboardingOverview, type OnboardingExportFormat, type ApprovalRow, type OnboardingHistoryRow, type OnboardingNote, type OnboardingDocument } from '../api/onboardingApi';

// Each submenu sub-route renders this same screen pre-filtered to its slice (real filtered views, not dead links).
export type OnboardingView = 'all' | 'business-info' | 'identity' | 'legal' | 'merchant' | 'bank' | 'hardware' | 'data-import' | 'training' | 'final-review' | 'activations' | 'approvals';

const VIEW_QUERY: Record<OnboardingView, OnboardingQuery> = {
  all: {},
  'business-info': { stage: 'business_info_submitted' },
  identity: { stage: 'identity_verification' },
  legal: { stage: 'legal_documents_submitted' },
  merchant: { stage: 'merchant_account_approved' },
  bank: { stage: 'bank_account_verified' },
  hardware: { stage: 'hardware_assigned' },
  'data-import': { stage: 'data_imported' },
  training: { stage: 'training_completed' },
  'final-review': { stage: 'final_review' },
  activations: { stage: 'tenant_activated' },
  approvals: {},
};

const STAGE_OK: ReadonlySet<string> = new Set(['merchant_account_approved', 'bank_account_verified', 'data_imported', 'training_completed', 'tenant_activated']);
const STAGE_BAD: ReadonlySet<string> = new Set(['rejected', 'cancelled', 'expired', 'returned_for_correction', 'blocked']);
function stagePill(stage: string): string {
  if (STAGE_OK.has(stage)) return 'pill ok';
  if (STAGE_BAD.has(stage)) return 'pill danger';
  return 'pill';
}
const STATUS_OK = new Set(['approved', 'verified', 'delivered', 'completed', 'completed_with_warnings']);
const STATUS_BAD = new Set(['declined', 'failed', 'cancelled', 'delayed', 'rejected', 'returned_for_correction', 'expired']);
function statusPill(status: string): string {
  if (STATUS_OK.has(status)) return 'pill ok';
  if (STATUS_BAD.has(status)) return 'pill danger';
  if (status === 'not_started' || status === 'not_submitted' || status === 'not_ordered') return 'pill';
  return 'pill warn';
}
const humanize = (s: string | null | undefined) => (s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—');
const lastUpdate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

type Sem = 'good' | 'bad' | 'neutral';
interface KpiDef { key: keyof OnboardingKpis; label: string; ico: string; tint: string; to?: string; sem: Sem }
const KPIS: KpiDef[] = [
  { key: 'applicationsReceived', label: 'Applications Received', ico: '📥', tint: '#EAF1FB', to: '/onboarding', sem: 'neutral' },
  { key: 'inProgress', label: 'In Progress', ico: '⏳', tint: '#FBF1E3', to: '/onboarding', sem: 'neutral' },
  { key: 'pendingApprovals', label: 'Pending Approvals', ico: '🛡️', tint: '#F4ECFB', to: '/onboarding', sem: 'bad' },
  { key: 'identityVerificationPending', label: 'Identity Verification Pending', ico: '🪪', tint: '#FDEEEE', to: '/onboarding/identity', sem: 'bad' },
  { key: 'merchantApproved', label: 'Merchant Approved', ico: '🏦', tint: '#E9F6EE', to: '/onboarding/merchant', sem: 'good' },
  { key: 'bankVerified', label: 'Bank Verified', ico: '🏛️', tint: '#E9F6EE', to: '/onboarding/bank', sem: 'good' },
  { key: 'hardwareAssigned', label: 'Hardware Assigned', ico: '📦', tint: '#EAF1FB', to: '/onboarding/hardware', sem: 'good' },
  { key: 'dataImportsCompleted', label: 'Data Imports Completed', ico: '🗄️', tint: '#E9F6EE', to: '/onboarding/data-import', sem: 'good' },
  { key: 'usersInvited', label: 'Users Invited', ico: '👥', tint: '#EAF1FB', to: '/onboarding', sem: 'good' },
  { key: 'trainingCompleted', label: 'Training Completed', ico: '🎓', tint: '#E9F6EE', to: '/onboarding/training', sem: 'good' },
  { key: 'finalReviewsPending', label: 'Final Reviews Pending', ico: '📝', tint: '#F4ECFB', to: '/onboarding/final-review', sem: 'bad' },
  { key: 'tenantsActivated', label: 'Tenants Activated', ico: '✅', tint: '#E9F6EE', to: '/onboarding/activations', sem: 'good' },
];

const SORTABLE: { col: string; field: string }[] = [
  { col: 'Tenant / Owner', field: 'tenant' }, { col: 'Branches', field: 'branches' }, { col: 'Current Stage', field: 'stage' },
  { col: 'Completion %', field: 'completion' }, { col: 'Assigned Specialist', field: 'specialist' }, { col: 'Missing Docs', field: 'missingDocs' },
  { col: 'Merchant Underwriting', field: 'merchant' }, { col: 'Hardware Shipment', field: 'hardware' }, { col: 'Data Import', field: 'dataImport' },
  { col: 'Training', field: 'training' }, { col: 'Last Update', field: 'updated' }, { col: 'Actions', field: '' },
];

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'var(--ok)' : pct >= 50 ? 'var(--g7,#A96F22)' : 'var(--warn)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <span style={{ fontWeight: 700, fontSize: 12, width: 34 }}>{pct}%</span>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--line)' }} aria-hidden>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: color }} />
      </div>
    </div>
  );
}

export function OnboardingScreen({ view = 'all' }: { view?: OnboardingView }) {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState('updated');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const query: OnboardingQuery = useMemo(() => ({
    ...VIEW_QUERY[view], page, pageSize: 10, sort, direction, ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
  }), [view, page, sort, direction, searchTerm]);

  const { data, loading, error, reload } = useOnboardingOverview(query);

  const toggleSort = (field: string) => {
    if (!field) return;
    if (sort === field) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(field); setDirection('desc'); }
    setPage(1);
  };

  const k = data?.kpis;
  const pendingTotal = data?.pendingApprovals.total ?? 0;
  const rows = data?.applications.rows ?? [];
  const pg = data?.applications;
  const from = pg && pg.total > 0 ? (pg.page - 1) * pg.pageSize + 1 : 0;
  const to = pg ? Math.min(pg.page * pg.pageSize, pg.total) : 0;

  return (
    <div className="work">
      <div className="page-hd flex flex-col xl:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Onboarding &amp; Approvals <span aria-hidden style={{ color: 'var(--g7,#A96F22)' }}>★</span>
          </h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 13 }}>Manage the complete onboarding process for new tenants and branches across the platform.</p>
        </div>
        <div className="items-baseline flex-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ExportMenu query={query} />
          <button className="btn ghost" onClick={() => nav('/onboarding/approvals')} style={{ position: 'relative' }}>
            🛡 Approval Queue {pendingTotal > 0 ? <span className="nbadge" style={{ marginLeft: 6 }}>{pendingTotal}</span> : null}
          </button>
          <button className="btn" onClick={() => setAddOpen(true)}>+ Add Application</button>
        </div>
      </div>

      {error ? (
        <div className="err" role="alert" style={{ marginTop: 12 }}>{error} <button className="btn ghost" onClick={reload} style={{ marginLeft: 10 }}>Retry</button></div>
      ) : null}

      {view === 'approvals' ? <ApprovalQueue reload={reload} /> : <>
      {/* 12 KPI cards (two rows of six) */}
        <div className="grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3 mt-3" aria-busy={loading}>
        {KPIS.map((kp) => {
          const value = k ? k[kp.key] : null;
          return (
            <div
              key={kp.key}
              className="kpi"
              role={kp.to ? 'button' : undefined}
              tabIndex={kp.to ? 0 : undefined}
              onClick={() => kp.to && nav(kp.to)}
              onKeyDown={(e) => { if (kp.to && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nav(kp.to); } }}
              aria-label={`${kp.label}: ${value ?? '—'}`}
              style={{ cursor: kp.to ? 'pointer' : 'default' }}
            >
              <div className="top">
                <span className="ico" style={{ background: kp.tint }} aria-hidden>{kp.ico}</span>
                <span className="l">{kp.label}</span>
              </div>
              <div className="v">{loading && value == null ? '…' : (value ?? '—')}</div>
            </div>
          );
        })}
      </div>

      {/* All Onboarding Pipeline */}
      <section className="card" style={{ marginTop: 6 }}>
          <div className="hd flex flex-col sm:flex-row  sm:items-center justify-between gap-2.5 px-3 py-2">
          <h2 style={{ margin: 0, fontSize: 15 }}>All Onboarding Pipeline</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={'btn ghost' + (sort === 'stageAge' ? ' active' : '')}
              aria-pressed={sort === 'stageAge'}
              title="Sort by longest time in current stage (most stalled first)"
              onClick={() => { if (sort === 'stageAge') { setSort('updated'); setDirection('desc'); } else { setSort('stageAge'); setDirection('asc'); } setPage(1); }}
              style={{ fontSize: 12 }}
            >⏱ Stalled first{sort === 'stageAge' ? ' ✓' : ''}</button>
            <div className="search" style={{ maxWidth: 240 }}>
              <input
                placeholder="Search tenant, owner, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setSearchTerm(search); setPage(1); } }}
                aria-label="Search the onboarding pipeline"
              />
              <button className="searchbtn" aria-label="Search" onClick={() => { setSearchTerm(search); setPage(1); }}>⏎</button>
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="dtable" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {SORTABLE.map((h) => (
                  <th
                    key={h.col}
                    onClick={() => toggleSort(h.field)}
                    style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', cursor: h.field ? 'pointer' : 'default', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}
                    aria-sort={sort === h.field ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {h.col}{sort === h.field ? (direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={12} className="state" style={{ padding: 24, textAlign: 'center' }}>Loading the onboarding pipeline…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="state" style={{ padding: 24, textAlign: 'center' }}>No onboarding applications match this view yet.</td></tr>
              ) : rows.map((r: OnboardingRow) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="av" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--g2,#F7EFE3)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: 'var(--g7,#A96F22)' }}>{(r.salonName ?? '?').charAt(0)}</span>
                      <div>
                        <button onClick={() => setDetailId(r.id)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'var(--g7,#A96F22)' }} aria-label={`Open ${r.salonName ?? 'application'} details`}>{r.salonName ?? '—'}</button>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.ownerEmail ?? r.ownerName ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.branchCount}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={stagePill(r.currentStage)}>{humanize(r.currentStage)}</span>
                      <SlaBadge band={r.slaBand} ageHours={r.stageAgeHours} />
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px' }}><CompletionBar pct={r.completionPct} /></td>
                  <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.specialistName ?? <span style={{ color: 'var(--muted)' }}>Unassigned</span>}</td>
                  <td style={{ padding: '8px 10px' }}>{r.missingDocsCount > 0 ? <span className="pill warn">{r.missingDocsCount}</span> : <span className="pill ok">0</span>}</td>
                  <td style={{ padding: '8px 10px' }}><span className={statusPill(r.merchant)}>{humanize(r.merchant)}</span></td>
                  <td style={{ padding: '8px 10px' }}><span className={statusPill(r.hardware)}>{humanize(r.hardware)}</span></td>
                  <td style={{ padding: '8px 10px' }}><span className={statusPill(r.dataImport)}>{humanize(r.dataImport)}</span></td>
                  <td style={{ padding: '8px 10px' }}><span className={statusPill(r.training)}>{humanize(r.training)}</span></td>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{lastUpdate(r.updatedAt)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <button className="btn ghost" aria-label={`Details for ${r.salonName ?? 'application'}`} title="Details" onClick={() => setDetailId(r.id)} style={{ padding: '2px 8px' }}>⋮</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* pagination footer */}
          <div className="hd flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3 py-2 border-t border-[var(--line)]">
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Showing {from} to {to} of {pg?.total ?? 0} entries</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn ghost" disabled={!pg || pg.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">‹ Prev</button>
            <span style={{ fontSize: 12 }}>Page {pg?.page ?? 1} of {pg?.totalPages ?? 1}</span>
            <button className="btn ghost" disabled={!pg || pg.page >= (pg.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} aria-label="Next page">Next ›</button>
          </div>
        </div>
      </section>

      {data ? <OnboardingModules data={data} reload={reload} /> : null}
      </>}
      {addOpen ? <AddApplicationModal onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); reload(); }} /> : null}
      {detailId ? <ApplicationDetailDrawer id={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

async function onboardingExport(query: OnboardingQuery, format: OnboardingExportFormat): Promise<string | null> {
  // Mirrors the platform reports.export() convention: CSV is generated server-side (audited, injection-guarded,
  // no sensitive columns) and downloaded here; Excel/PDF are not configured platform-wide and return an honest
  // disabledReason which the caller surfaces — no fabricated binary.
  try {
    const res = await onboardingApi.exportReport(query, format);
    if (res.disabledReason || !res.csv) return res.disabledReason ?? 'Export is not available.';
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null; // non-browser (tests)
    const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = res.filename || `onboarding-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Export failed';
  }
}

const EXPORT_FORMATS: { key: OnboardingExportFormat; label: string }[] = [
  { key: 'csv', label: 'CSV (.csv)' }, { key: 'excel', label: 'Excel (.xlsx)' }, { key: 'pdf', label: 'PDF (.pdf)' },
];

function ExportMenu({ query }: { query: OnboardingQuery }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<OnboardingExportFormat | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fmt: OnboardingExportFormat) => {
    setBusy(fmt); setNote(null);
    const msg = await onboardingExport(query, fmt);
    setBusy(null);
    if (msg) setNote(msg); else setOpen(false); // success closes; disabled/error keeps menu open with the reason
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen((o) => !o); setNote(null); }}>⬇ Export Report ▾</button>
      {open ? (
        <div role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--card,#fff)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 200, zIndex: 40, padding: 6 }}>
          {EXPORT_FORMATS.map((f) => (
            <button key={f.key} role="menuitem" className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }} disabled={busy != null} onClick={() => void run(f.key)}>
              {busy === f.key ? 'Working…' : f.label}
            </button>
          ))}
          {note ? <div className="state" style={{ padding: '6px 8px', fontSize: 11.5, color: 'var(--muted)' }}>{note}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------
// Dashboard modules — all fed by the same overview payload, all reconciling, with click-through filters.
// ----------------------------------------------------------------------------------------------------------------

const SEV_CLASS: Record<string, string> = { critical: 'pill danger', warning: 'pill warn', info: 'pill', ok: 'pill ok' };
const donutData = (d: { slices: { label: string; count: number }[] }) => d.slices.map((s) => ({ label: s.label, value: s.count }));

function Card({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="hd" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>{title}</h2>
        {subtitle ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</div> : null}
      </div>
      <div style={{ padding: 12, flex: 1 }}>{children}</div>
      {footer ? <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: 12 }}>{footer}</div> : null}
    </section>
  );
}

function WorkflowStrip({ data }: { data: OnboardingOverview }) {
  return (
    <Card title="Onboarding Workflow">
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 6 }}>
        {data.workflow.map((s, i) => (
          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
            <div style={{ textAlign: 'center', minWidth: 78 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, color: s.count > 0 ? '#fff' : 'var(--muted)', background: s.count > 0 ? 'var(--g7,#A96F22)' : 'var(--line)' }}>{s.count}</div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.15 }}>{s.label}</div>
            </div>
            {i < data.workflow.length - 1 ? <div style={{ width: 14, height: 2, background: 'var(--line)' }} aria-hidden /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TrendChart({ data }: { data: OnboardingOverview }) {
  const t = data.completionTrend;
  const max = Math.max(1, ...t.map((p) => Math.max(p.applications, p.completions)));
  const W = 320, H = 120, pad = 6;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, t.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const path = (sel: (p: { applications: number; completions: number }) => number) => t.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ');
  const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Card title="Onboarding Completion Trend" subtitle="This Week">
      {t.length === 0 ? <div className="state">No trend data yet.</div> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Applications vs completions by day">
            <path d={path((p) => p.applications)} fill="none" stroke="#2C5B93" strokeWidth={2} />
            <path d={path((p) => p.completions)} fill="none" stroke="var(--g7,#A96F22)" strokeWidth={2} />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)' }}>
            {t.map((p) => <span key={p.date}>{dayLabel(p.date)}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 3, background: '#2C5B93', display: 'inline-block' }} />Applications</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 3, background: 'var(--g7,#A96F22)', display: 'inline-block' }} />Completions</span>
          </div>
        </>
      )}
    </Card>
  );
}

function HealthAlerts({ data }: { data: OnboardingOverview }) {
  return (
    <Card title="Onboarding Health & Alerts">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.onboardingHealth.map((h) => (
          <div key={h.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>{h.label}</span>
            <span className={SEV_CLASS[h.severity] ?? 'pill'} aria-label={`${h.label}: ${h.count} (${h.severity})`}>{h.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const APPROVAL_LABELS: Record<string, string> = {
  merchant_application: 'Merchant Applications', bank_verification: 'Bank Verifications', hardware_assignment: 'Hardware Assignments',
  data_import: 'Data Imports', user_invitation: 'User Invitations', training_completion: 'Training Completions', final_review: 'Final Reviews',
  identity_verification: 'Identity Verifications', step: 'Step Approvals',
};
function PendingApprovals({ data }: { data: OnboardingOverview }) {
  const entries = Object.entries(data.pendingApprovals.byType).filter(([, n]) => n > 0);
  return (
    <Card title="Pending Approvals" footer={<div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>Total Pending</span><span style={{ color: 'var(--g7,#A96F22)' }}>{data.pendingApprovals.total}</span></div>}>
      {entries.length === 0 ? <div className="state">No pending approvals.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map(([k, n]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5 }}>{APPROVAL_LABELS[k] ?? k}</span><span className="pill">{n}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SpecialistWorkload({ data }: { data: OnboardingOverview }) {
  const rows = data.specialistWorkload;
  const maxLoad = Math.max(1, ...rows.map((r) => r.active + r.completed));
  return (
    <Card title="Specialist Workload">
      {rows.length === 0 ? <div className="state">No specialists assigned yet.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Specialist', 'Active', 'Completed', 'Capacity'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 10.5, color: 'var(--muted)', padding: '2px 6px' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const cap = Math.round(((r.active + r.completed) / maxLoad) * 100);
              return (
                <tr key={r.specialistUserId}>
                  <td style={{ padding: '4px 6px', fontSize: 12.5 }}>{r.specialistName ?? r.specialistUserId.slice(0, 8)}</td>
                  <td style={{ padding: '4px 6px', fontSize: 12.5 }}>{r.active}</td>
                  <td style={{ padding: '4px 6px', fontSize: 12.5 }}>{r.completed}</td>
                  <td style={{ padding: '4px 6px', minWidth: 90 }}>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--line)' }}><div style={{ width: `${cap}%`, height: '100%', borderRadius: 999, background: cap >= 80 ? 'var(--danger)' : 'var(--g7,#A96F22)' }} /></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const rel = (iso: string) => { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };
const hum = (s: string | null | undefined) => (s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—');

function RecentActivity({ data }: { data: OnboardingOverview }) {
  return (
    <Card title="Recent Onboarding Activity">
      {data.recentActivity.length === 0 ? <div className="state">No recent activity.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {data.recentActivity.map((a) => (
            <div key={a.id} style={{ fontSize: 12.5 }}>
              <span>{hum(a.from)} → <strong>{hum(a.to)}</strong></span>
              <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{rel(a.at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ApprovalNotes({ data }: { data: OnboardingOverview }) {
  return (
    <Card title="Approval Notes / Review">
      {data.approvalNotes.length === 0 ? <div className="state">No notes yet.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.approvalNotes.map((n) => (
            <div key={n.id} style={{ fontSize: 12 }}>
              <div>{n.body}</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>{n.authorName ?? 'Staff'} · {hum(n.noteType)} · {rel(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivationSummary({ data }: { data: OnboardingOverview }) {
  const a = data.activationSummary;
  return (
    <Card title="Tenant Activation Summary" subtitle="This Month">
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 30 }}>{a.total} <span style={{ fontSize: 13, color: 'var(--muted)' }}>Activated</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: 12.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>New Tenants</span><strong>{a.newTenants}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Upgraded Tenants</span><strong>{a.upgraded}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Reactivated Tenants</span><strong>{a.reactivated}</strong></div>
      </div>
    </Card>
  );
}

function RejectedExpired({ data }: { data: OnboardingOverview }) {
  const r = data.rejectedExpired;
  const items: [string, number][] = [
    ['Rejected Applications', r.rejectedApplications], ['Expired Identity Verifications', r.expiredIdentityVerifications],
    ['Expired Applications', r.expiredApplications], ['Cancelled Onboarding', r.cancelledOnboarding],
  ];
  return (
    <Card title="Rejected / Expired Items">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(([label, n]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5 }}>{label}</span><span className={n > 0 ? 'pill danger' : 'pill'}>{n}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OnboardingModules({ data, reload }: { data: OnboardingOverview; reload: () => void }) {
  return (
    <>
      <div style={{ marginTop: 10 }}><WorkflowStrip data={data} /></div>
      <div className=" grid  grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 mt-3">
        <TrendChart data={data} />
        <Card title="Stage Distribution" subtitle="Current Pipeline">
          {data.stageDistribution.total === 0 ? <div className="state">No active pipeline.</div> : <Donut data={data.stageDistribution.buckets.map((b) => ({ label: b.label, value: b.count }))} centerLabel={String(data.stageDistribution.total)} />}
        </Card>
        <Card title="Merchant Underwriting Status" subtitle="Today">
          {data.merchantStatus.total === 0 ? <div className="state">No merchant data.</div> : <Donut data={donutData(data.merchantStatus)} centerLabel={String(data.merchantStatus.total)} />}
        </Card>
        <Card title="Hardware Shipment Tracker" subtitle="Today">
          {data.shipmentStatus.total === 0 ? <div className="state">No shipments.</div> : <Donut data={donutData(data.shipmentStatus)} centerLabel={String(data.shipmentStatus.total)} />}
        </Card>
        <Card title="Data Import Status">
          {data.dataImportStatus.total === 0 ? <div className="state">No imports.</div> : <Donut data={donutData(data.dataImportStatus)} centerLabel={String(data.dataImportStatus.total)} />}
        </Card>
        <Card title="Training Progress">
          {data.trainingProgress.total === 0 ? <div className="state">No training records.</div> : <Donut data={donutData(data.trainingProgress)} centerLabel={String(data.trainingProgress.total)} />}
        </Card>
        <HealthAlerts data={data} />
        <PendingApprovals data={data} />
        <SpecialistWorkload data={data} />
        <RecentActivity data={data} />
        <ApprovalNotes data={data} />
        <ActivationSummary data={data} />
        <RejectedExpired data={data} />
      </div>
      <QuickActions rows={data.applications.rows} specialists={data.specialistWorkload} reload={reload} />
    </>
  );
}

// ----------------------------------------------------------------------------------------------------------------
// Quick Actions — 9 working, safeguarded actions. Each targets a selected application; dangerous actions (Activate /
// Reject) require a typed tenant-name confirmation, and Reject / Return require a reason. No dead buttons.
// ----------------------------------------------------------------------------------------------------------------

const STAGE_ORDER: OnboardingState[] = [
  'application_received', 'business_info_submitted', 'identity_verification', 'legal_documents_submitted',
  'subscription_selected', 'merchant_application_submitted', 'merchant_account_approved', 'bank_account_verified',
  'hardware_assigned', 'data_imported', 'users_invited', 'training_completed', 'final_review', 'tenant_activated',
];
const nextStage = (s: OnboardingState): OnboardingState | null => {
  const i = STAGE_ORDER.indexOf(s);
  if (i < 0) return 'application_received'; // Reset/Reopen from rejected or holding state
  return i >= STAGE_ORDER.length - 1 ? null : STAGE_ORDER[i + 1];
};

type ActionKey = 'approve' | 'reject' | 'request_info' | 'assign' | 'review_docs' | 'track_hardware' | 'approve_import' | 'activate' | 'return' | 'add';
const QUICK_ACTIONS: { key: ActionKey; label: string; danger?: boolean }[] = [
  { key: 'approve', label: 'Approve Step' },
  { key: 'reject', label: 'Reject Step', danger: true },
  { key: 'request_info', label: 'Request Info' },
  { key: 'assign', label: 'Assign Specialist' },
  { key: 'review_docs', label: 'Review Documents' },
  { key: 'track_hardware', label: 'Track Hardware' },
  { key: 'approve_import', label: 'Approve Data Import' },
  { key: 'activate', label: 'Activate Tenant', danger: true },
  { key: 'return', label: 'Return for Correction' },
];

interface SpecialistOpt { specialistUserId: string; specialistName: string | null }

export function QuickActions({ rows, specialists, reload }: { rows: OnboardingRow[]; specialists: SpecialistOpt[]; reload: () => void }) {
  const [open, setOpen] = useState<ActionKey | null>(null);
  return (
    <section className="card" style={{ marginTop: 10 }}>
      <div className="hd" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 14 }}>Quick Actions</h2></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
        {QUICK_ACTIONS.map((a) => (
          <button key={a.key} className={'btn' + (a.danger ? '' : ' ghost')} onClick={() => setOpen(a.key)}>{a.label}</button>
        ))}
      </div>
      {open ? <ActionModal action={open} rows={rows} specialists={specialists} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} /> : null}
    </section>
  );
}

function ActionModal({ action, rows, specialists, onClose, onDone }: { action: ActionKey; rows: OnboardingRow[]; specialists: SpecialistOpt[]; onClose: () => void; onDone: () => void }) {
  const [appId, setAppId] = useState(rows[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [corrections, setCorrections] = useState('');
  const [message, setMessage] = useState('');
  const [specialistId, setSpecialistId] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [docs, setDocs] = useState<unknown[] | null>(null);

  const app = rows.find((r) => r.id === appId) ?? null;
  const needsReason = action === 'reject' || action === 'return';
  const needsTyped = action === 'activate' || action === 'reject';
  const typedOk = !needsTyped || (!!app && typed.trim() === (app.salonName ?? '').trim());
  const reasonOk = !needsReason || reason.trim().length > 0;
  const correctionsOk = action !== 'return' || corrections.trim().length > 0;
  const messageOk = action !== 'request_info' || message.trim().length > 0;
  const canConfirm = !!appId && typedOk && reasonOk && correctionsOk && messageOk && !busy;

  const TITLES: Record<ActionKey, string> = {
    approve: 'Approve Current Step', reject: 'Reject Step', request_info: 'Request Information', assign: 'Assign Specialist',
    review_docs: 'Review Documents', track_hardware: 'Track Hardware', approve_import: 'Approve Data Import',
    activate: 'Activate Tenant', return: 'Return for Correction', add: 'Add Application',
  };

  const submit = async () => {
    if (!app) return;
    setBusy(true); setErr(null);
    try {
      switch (action) {
        case 'approve': {
          const ns = nextStage(app.currentStage);
          if (!ns) throw new Error('No further step to approve from this stage.');
          await onboardingApi.transition(app.id, { toState: ns });
          break;
        }
        case 'reject': await onboardingApi.transition(app.id, { toState: 'rejected', reason }); break;
        case 'return': await onboardingApi.returnForCorrection(app.id, reason, corrections); break;
        case 'request_info': await onboardingApi.requestInfo(app.id, message); break;
        case 'assign': await onboardingApi.assign(app.id, specialistId || null); break;
        case 'approve_import': await onboardingApi.transition(app.id, { toState: 'data_imported' }); break;
        case 'activate': await onboardingApi.activate(app.id, { note: reason || 'Activated via Quick Actions' }); break;
        case 'review_docs': case 'track_hardware': case 'add': break;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      setBusy(false);
    }
  };

  // read-only actions load on demand
  const loadDocs = async () => { try { setDocs(await onboardingApi.documents(appId)); } catch { setDocs([]); } };

  return (
    <div role="dialog" aria-modal="true" aria-label={TITLES[action]} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="card" style={{ width: 'min(480px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ padding: '14px 16px', background: '#FFF9EF', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{TITLES[action]}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close" style={{ padding: '2px 8px', minHeight: 32 }}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Application
            <select value={appId} onChange={(e) => { setAppId(e.target.value); setDocs(null); }} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}>
              {rows.length === 0 ? <option value="">No applications on this page</option> : null}
              {rows.map((r) => <option key={r.id} value={r.id}>{r.salonName ?? r.id} — {humanizeQA(r.currentStage)}</option>)}
            </select>
          </label>

          {action === 'approve' ? <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Advances {app?.salonName ?? 'the application'} to <strong>{humanizeQA(app ? (nextStage(app.currentStage) ?? app.currentStage) : '')}</strong>. The server re-validates prerequisites.</p> : null}
          {action === 'approve_import' ? <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Approves the validated data import and advances to <strong>Data Imported</strong>. Blocking errors are rejected server-side.</p> : null}

          {needsReason ? (
            <label style={{ fontSize: 12, fontWeight: 700 }}>Reason <span style={{ color: 'var(--danger)' }}>*</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Required — recorded in the audit trail" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
            </label>
          ) : null}
          {action === 'return' ? (
            <label style={{ fontSize: 12, fontWeight: 700 }}>Correction requirements <span style={{ color: 'var(--danger)' }}>*</span>
              <textarea value={corrections} onChange={(e) => setCorrections(e.target.value)} rows={2} placeholder="What the applicant must fix (sent to them)" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
            </label>
          ) : null}
          {action === 'request_info' ? (
            <label style={{ fontSize: 12, fontWeight: 700 }}>Message to applicant <span style={{ color: 'var(--danger)' }}>*</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="What additional information is needed" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
            </label>
          ) : null}
          {action === 'assign' ? (
            <label style={{ fontSize: 12, fontWeight: 700 }}>Specialist
              <select value={specialistId} onChange={(e) => setSpecialistId(e.target.value)} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }}>
                <option value="">Unassign</option>
                {specialists.map((s) => <option key={s.specialistUserId} value={s.specialistUserId}>{s.specialistName ?? s.specialistUserId}</option>)}
              </select>
            </label>
          ) : null}
          {action === 'activate' ? <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>This activates the tenant for real. The server validates every mandatory prerequisite and refuses duplicates. An optional note is recorded.
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Activation note (optional)" style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} /></p> : null}

          {needsTyped ? (
            <label style={{ fontSize: 12, fontWeight: 700 }}>Type the tenant name to confirm: <code>{app?.salonName ?? '—'}</code>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={app?.salonName ?? ''} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
            </label>
          ) : null}

          {action === 'review_docs' ? (
            <div>
              <button className="btn ghost" onClick={loadDocs} disabled={!appId}>Load documents</button>
              {docs ? (docs.length === 0 ? <div className="state" style={{ marginTop: 8 }}>No documents on file for this application.</div> : <div style={{ marginTop: 8, fontSize: 12 }}>{docs.length} document(s) on file. Secure review opens per-document with short-lived access.</div>) : null}
            </div>
          ) : null}
          {action === 'track_hardware' ? <div style={{ fontSize: 13 }}>Hardware shipment status: <span className="pill">{humanizeQA(app?.hardware ?? 'not_ordered')}</span></div> : null}

          {err ? <div className="err" role="alert">{err}</div> : null}
        </div>
        {action !== 'review_docs' && action !== 'track_hardware' ? (
          <div className="hd" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!canConfirm} onClick={submit}>{busy ? 'Working…' : 'Confirm'}</button>
          </div>
        ) : (
          <div className="hd" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

const humanizeQA = (s: string | null | undefined) => (s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—');

// Add Application — attaches onboarding to an approved tenant_application (the spine). The full business-info intake
// form is a deeper unit; this captures the real fields the backend createApplication accepts and creates the record.
function AddApplicationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [applicationId, setApplicationId] = useState('');
  const [applicationType, setApplicationType] = useState<'new_tenant' | 'new_branch'>('new_tenant');
  const [branchCount, setBranchCount] = useState('1');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!applicationId.trim()) { setErr('An approved application ID is required'); return; }
    setBusy(true); setErr(null);
    try {
      await onboardingApi.create({ applicationId: applicationId.trim(), applicationType, branchCount: Number(branchCount) || 0, priority });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not create application'); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add Application" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={onClose}>
      <div className="card" style={{ width: 'min(460px, 92vw)', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ padding: '14px 16px', background: '#FFF9EF', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Add Application</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close" style={{ padding: '2px 8px', minHeight: 32 }}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Approved Application ID <span style={{ color: 'var(--danger)' }}>*</span>
            <input value={applicationId} onChange={(e) => setApplicationId(e.target.value)} placeholder="tenant_applications.id" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Application Type
            <select value={applicationType} onChange={(e) => setApplicationType(e.target.value as 'new_tenant' | 'new_branch')} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }}>
              <option value="new_tenant">New Tenant</option>
              <option value="new_branch">New Branch for Existing Tenant</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Branches
              <input type="number" min={0} value={branchCount} onChange={(e) => setBranchCount(e.target.value)} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }}>
                {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          {err ? <div className="err" role="alert">{err}</div> : null}
        </div>
        <div className="hd" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !applicationId.trim()} onClick={submit}>{busy ? 'Creating…' : 'Create Application'}</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------
// Approval Queue — the dedicated two-person approval surface. Shows pending approvals; first approval of a
// two-person item moves it to "awaiting second approval", which a DIFFERENT admin must complete (enforced server-side
// and by the DB CHECK). Reject/return require a reason. Honest empty/loading/error states.
// ----------------------------------------------------------------------------------------------------------------

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  merchant_application: 'Merchant Application', bank_verification: 'Bank Verification', hardware_assignment: 'Hardware Assignment',
  data_import: 'Data Import', user_invitation: 'User Invitation', training_completion: 'Training Completion',
  final_review: 'Final Review', identity_verification: 'Identity Verification', step: 'Step Approval',
};
const awaitingSecond = (a: ApprovalRow) => a.requiresSecondApproval && a.status === 'pending' && a.decidedByUserId != null && a.secondApproverUserId == null;

function ApprovalQueue({ reload }: { reload: () => void }) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await onboardingApi.approvals({ status: 'pending' })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the approval queue'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (a: ApprovalRow, status: string, reason?: string) => {
    setBusyId(a.id); setError(null);
    try { await onboardingApi.decideApproval(a.id, status, reason ?? null); await load(); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Decision failed'); }
    finally { setBusyId(null); setRejecting(null); }
  };

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Approval Queue</h2>
        <button className="btn ghost" onClick={() => void load()}>↻ Refresh</button>
      </div>
      {error ? <div className="err" role="alert" style={{ margin: 12 }}>{error}</div> : null}
      {rows == null ? (
        <div className="state" style={{ padding: 24, textAlign: 'center' }}>Loading the approval queue…</div>
      ) : rows.length === 0 ? (
        <div className="state" style={{ padding: 24, textAlign: 'center' }}>No pending approvals. The queue is clear.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Type', 'Stage', 'Requested', 'Status', 'Actions'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--muted)', padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((a) => {
              const aw = awaitingSecond(a);
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 12px', fontSize: 13 }}>
                    {APPROVAL_TYPE_LABELS[a.approvalType] ?? a.approvalType}
                    {a.requiresSecondApproval ? <span className="pill" style={{ marginLeft: 6, fontSize: 10 }}>two-person</span> : null}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12.5 }}>{humanizeQA(a.stage)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--muted)' }}>{rel(a.createdAt)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12.5 }}>
                    {aw ? <span className="pill warn">Awaiting 2nd approval</span> : <span className="pill">Pending</span>}
                    {aw ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>1st by {a.decidedByUserId?.slice(0, 8)}</div> : null}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" disabled={busyId === a.id} onClick={() => void decide(a, 'approved')}>
                        {busyId === a.id ? '…' : aw ? 'Second Approve' : a.requiresSecondApproval ? 'First Approve' : 'Approve'}
                      </button>
                      <button className="btn ghost" disabled={busyId === a.id} onClick={() => setRejecting(a)}>Reject</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rejecting ? <RejectApprovalModal approval={rejecting} busy={busyId === rejecting.id} onCancel={() => setRejecting(null)} onConfirm={(reason) => void decide(rejecting, 'rejected', reason)} /> : null}
    </section>
  );
}

function RejectApprovalModal({ approval, busy, onCancel, onConfirm }: { approval: ApprovalRow; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div role="dialog" aria-modal="true" aria-label="Reject Approval" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'grid', placeItems: 'center', zIndex: 110 }} onClick={onCancel}>
      <div className="card" style={{ width: 'min(440px, 92vw)', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ padding: '14px 16px', background: '#FFF9EF', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reject {APPROVAL_TYPE_LABELS[approval.approvalType] ?? approval.approvalType}</h2></div>
        <div style={{ padding: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Reason <span style={{ color: 'var(--danger)' }}>*</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Required — recorded in the audit trail" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
          </label>
        </div>
        <div className="hd" style={{ padding: '12px 16px', background: '#FFF9EF', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{busy ? 'Working…' : 'Reject'}</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------------------
// Application Detail Drawer — read-only inspect view for a single application: header summary, the full stage-history
// timeline (the audit trail), notes/communication, and documents (with virus-scan + expiry). Mutations stay in Quick
// Actions / Approval Queue; this is the "drill in and inspect" surface. Loads all sections in parallel, honest states.
// ----------------------------------------------------------------------------------------------------------------

function ApplicationDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [record, setRecord] = useState<OnboardingRow | null>(null);
  const [history, setHistory] = useState<OnboardingHistoryRow[] | null>(null);
  const [notes, setNotes] = useState<OnboardingNote[] | null>(null);
  const [docs, setDocs] = useState<OnboardingDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadDocs = useCallback(async () => { try { setDocs(await onboardingApi.documents(id)); } catch { /* keep prior docs */ } }, [id]);

  useEffect(() => {
    let live = true;
    setError(null); setRecord(null); setHistory(null); setNotes(null); setDocs(null);
    (async () => {
      try {
        const [rec, hist, nts, dcs] = await Promise.all([
          onboardingApi.record(id), onboardingApi.history(id), onboardingApi.notes(id), onboardingApi.documents(id),
        ]);
        if (!live) return;
        setRecord(rec); setHistory(hist); setNotes(nts); setDocs(dcs);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not load application details'); }
    })();
    return () => { live = false; };
  }, [id]);

  const loading = record == null && error == null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Application details" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.6)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'flex', justifyContent: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <div className="card" style={{ width: 'min(580px, 96vw)', height: '100vh', overflow: 'auto', borderRadius: 0, background: '#FFFDF8', borderLeft: '1px solid var(--line)', boxShadow: '-12px 0 45px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ position: 'sticky', top: 0, background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{record?.salonName ?? (loading ? 'Loading…' : 'Application')}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close" style={{ padding: '2px 8px', minHeight: 32 }}>✕</button>
        </div>
        {error ? <div className="err" role="alert" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? <div className="state" style={{ padding: 24, textAlign: 'center' }}>Loading application details…</div> : null}

        {record ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={stagePill(record.currentStage)}>{humanize(record.currentStage)}</span>
                <CompletionBar pct={record.completionPct} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{record.specialistName ? `Specialist: ${record.specialistName}` : 'Unassigned'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10, fontSize: 12.5 }}>
                <div><span style={{ color: 'var(--muted)' }}>Owner:</span> {record.ownerName ?? '—'}</div>
                <div><span style={{ color: 'var(--muted)' }}>Email:</span> {record.ownerEmail ?? '—'}</div>
                <div><span style={{ color: 'var(--muted)' }}>Branches:</span> {record.branchCount}</div>
                <div><span style={{ color: 'var(--muted)' }}>Missing docs:</span> {record.missingDocsCount}</div>
              </div>
            </section>

            <DrawerSection title={`Stage History (${history?.length ?? 0})`}>
              {history == null ? <div className="state">Loading…</div> : history.length === 0 ? <div className="state">No stage transitions recorded yet.</div> : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
                  {history.map((h, i) => (
                    <li key={h.id} style={{ display: 'flex', gap: 10, paddingBottom: i < history.length - 1 ? 14 : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--g7,#A96F22)', marginTop: 4 }} />
                        {i < history.length - 1 ? <span style={{ width: 2, flex: 1, background: 'var(--line)' }} /> : null}
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        <div><strong>{humanize(h.toState)}</strong>{h.fromState ? <span style={{ color: 'var(--muted)' }}> — from {humanize(h.fromState)}</span> : null}</div>
                        {h.reason ? <div style={{ color: 'var(--muted)' }}>{h.reason}</div> : null}
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{rel(h.createdAt)}{h.actorRole ? ` · ${humanize(h.actorRole)}` : ''}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </DrawerSection>

            <DrawerSection title={`Notes (${notes?.length ?? 0})`}>
              {notes == null ? <div className="state">Loading…</div> : notes.length === 0 ? <div className="state">No notes yet.</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {notes.map((n) => (
                    <div key={n.id} style={{ fontSize: 12.5 }}>
                      <div>{n.body}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{n.authorName ?? 'Staff'} · {humanize(n.noteType)} · {humanize(n.visibility)} · {rel(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            <DrawerSection title={`Documents (${docs?.length ?? 0})`}>
              <DocumentReview docs={docs} onReviewed={reloadDocs} setError={setError} />
            </DrawerSection>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 13.5, fontWeight: 700, borderBottom: '1px solid var(--line)', paddingBottom: 8, color: 'var(--text)' }}>{title}</h3>
      {children}
    </section>
  );
}

// Document review actions inside the drawer — approve (only when scan is clean) / reject (reason required). Mirrors the
// server guards client-side so disabled affordances explain themselves; the server is authoritative.
function DocumentReview({ docs, onReviewed, setError }: { docs: OnboardingDocument[] | null; onReviewed: () => void; setError: (m: string | null) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OnboardingDocument | null>(null);

  const review = async (d: OnboardingDocument, status: string, rejectionReason?: string) => {
    setBusyId(d.id); setError(null);
    try { await onboardingApi.reviewDocument(d.id, status, rejectionReason ?? null); onReviewed(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review failed'); }
    finally { setBusyId(null); setRejecting(null); }
  };

  if (docs == null) return <div className="state">Loading…</div>;
  if (docs.length === 0) return <div className="state">No documents on file.</div>;
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Document', 'Status', 'Scan', 'Expires', ''].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 10.5, color: 'var(--muted)', padding: '2px 4px' }}>{h}</th>)}</tr></thead>
        <tbody>
          {docs.map((d) => {
            const reviewable = d.status === 'pending' || d.status === 'under_review';
            const canApprove = d.virusScanStatus === 'clean';
            return (
              <tr key={d.id}>
                <td style={{ padding: '4px', fontSize: 12 }}>{d.fileName ?? humanize(d.category)}</td>
                <td style={{ padding: '4px' }}><span className={d.status === 'approved' ? 'pill ok' : d.status === 'rejected' ? 'pill danger' : 'pill'}>{humanize(d.status)}</span></td>
                <td style={{ padding: '4px' }}><span className={d.virusScanStatus === 'clean' ? 'pill ok' : d.virusScanStatus === 'infected' ? 'pill danger' : 'pill warn'}>{humanize(d.virusScanStatus)}</span></td>
                <td style={{ padding: '4px', fontSize: 11.5, color: 'var(--muted)' }}>{d.expirationDate ? new Date(d.expirationDate).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '4px', whiteSpace: 'nowrap' }}>
                  {reviewable ? (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button className="btn" style={{ padding: '1px 7px', fontSize: 11 }} disabled={busyId === d.id || !canApprove} title={canApprove ? 'Approve document' : 'Cannot approve until the virus scan is clean'} onClick={() => void review(d, 'approved')}>Approve</button>
                      <button className="btn ghost" style={{ padding: '1px 7px', fontSize: 11 }} disabled={busyId === d.id} onClick={() => setRejecting(d)}>Reject</button>
                    </span>
                  ) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.rejectionReason ? `Rejected: ${d.rejectionReason}` : 'Reviewed'}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rejecting ? <RejectDocumentModal doc={rejecting} busy={busyId === rejecting.id} onCancel={() => setRejecting(null)} onConfirm={(reason) => void review(rejecting, 'rejected', reason)} /> : null}
    </>
  );
}

function RejectDocumentModal({ doc, busy, onCancel, onConfirm }: { doc: OnboardingDocument; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div role="dialog" aria-modal="true" aria-label="Reject Document" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'grid', placeItems: 'center', zIndex: 110 }} onClick={onCancel}>
      <div className="card" style={{ width: 'min(420px, 92vw)', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
        <div className="hd" style={{ padding: '14px 16px', background: '#FFF9EF', borderBottom: '1px solid var(--line)' }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reject {doc.fileName ?? humanize(doc.category)}</h2></div>
        <div style={{ padding: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Reason <span style={{ color: 'var(--danger)' }}>*</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Required — shown to the applicant and recorded in the audit trail" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
          </label>
        </div>
        <div className="hd" style={{ padding: '12px 16px', background: '#FFF9EF', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{busy ? 'Working…' : 'Reject'}</button>
        </div>
      </div>
    </div>
  );
}

// SLA / time-in-stage badge: shows how long a row has sat in its current stage, colored by band. Only renders when the
// row is aging or breached (ok rows stay clean). "Days in stage" is the operational signal for stalled applications.
function SlaBadge({ band, ageHours }: { band: 'ok' | 'aging' | 'breached'; ageHours: number }) {
  if (band === 'ok') return null;
  const days = ageHours / 24;
  const label = days >= 1 ? `${Math.round(days)}d` : `${Math.round(ageHours)}h`;
  const cls = band === 'breached' ? 'pill danger' : 'pill warn';
  return <span className={cls} title={`In this stage ${days >= 1 ? `${days.toFixed(1)} days` : `${Math.round(ageHours)} hours`} — ${band === 'breached' ? 'SLA breached' : 'aging'}`} style={{ fontSize: 10 }}>⏱ {label}</span>;
}
