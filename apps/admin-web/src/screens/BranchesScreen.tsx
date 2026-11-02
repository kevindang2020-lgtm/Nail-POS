import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type BranchesDashboard, type BranchDirectoryRow, type BranchesDirectoryPage } from '../api/superAdminApi';
import { Donut, MiniBars, NotConnected, money } from './_chartkit';
import { useCan } from '../auth/useCan';

// BranchesScreen.tsx — Super Admin › Tenant Management › Branches › All Branches.
// Centralized, platform-wide branch MONITORING surface (configure/monitor/audit/troubleshoot — never daily POS ops).
// Every module is fed by the real GET /super-admin/platform/branches-dashboard aggregate (KPIs, per-branch directory
// with a documented health score, status/device distributions, performance trend, revenue-by-city, queue/upcoming
// monitors, onboarding pipeline, hours availability, at-a-glance). Fields the schema can't source per-branch
// (per-branch device counts, per-branch "today" customer counts, technician utilization) are shown as honest gaps
// ("—" / "not connected"), never fabricated.

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—');

// Status → badge tone. Active healthy (green), pending/opening neutral, paused/maintenance amber, suspended/closed red.
function statusStyle(status: string): { cls: string; style?: React.CSSProperties } {
  const v = (status || '').toLowerCase();
  if (v === 'active') return { cls: 'pill ok' };
  if (['paused', 'maintenance', 'closing', 'temporarily_closed'].includes(v)) return { cls: 'pill warn' };
  if (['suspended', 'closed', 'inactive', 'rejected'].includes(v)) return { cls: 'pill', style: { background: '#FBEAE7', color: 'var(--danger,#B85B4D)', borderColor: '#F0C9C2' } };
  return { cls: 'pill', style: { background: 'var(--cream2,#F7F2E9)', color: 'var(--muted)' } }; // pending / opening / draft
}
// Health score → color band (Excellent/Good green, Average gold, Poor/Critical red). Null = not yet calculated.
function healthColor(score: number | null): string {
  if (score == null) return 'var(--muted)';
  if (score >= 70) return 'var(--ok,#3E8F57)';
  if (score >= 50) return 'var(--gold,#A96F22)';
  return 'var(--danger,#B85B4D)';
}

// Client-side mirror of the lifecycle rules for UX (the server re-validates every transition + typed-confirmation).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  active: ['paused', 'suspended', 'maintenance', 'closing'], paused: ['active', 'suspended', 'closing'],
  suspended: ['active', 'closing'], maintenance: ['active', 'suspended'], closing: ['closed', 'active'], ready_to_launch: ['active'],
};
const HIGH_RISK_STATUS = new Set(['suspended', 'closing', 'closed']);
const STATUS_IMPACT: Record<string, string[]> = {
  paused: ['Staff login blocked', 'Online booking paused', 'Existing appointments retained', 'Payment processing paused', 'Data & reports preserved'],
  suspended: ['Staff login blocked', 'POS devices deactivated', 'Booking & AI receptionist disabled', 'Payments & settlement halted', 'Customer/financial history preserved (not deleted)'],
  closing: ['New bookings stopped', 'Complete/reassign existing appointments', 'Devices & integrations remain until closed', 'Financial history preserved with original ownership'],
  closed: ['Closed to all operations', 'Devices released, integrations disconnected', 'History retained for legal/reporting', 'Reopening requires a new activation'],
  maintenance: ['Temporarily offline for maintenance', 'Booking paused; login may be restricted', 'Data, devices & settlement preserved'],
  active: ['Returns to normal operation', 'Login, booking & payments re-enabled', 'No data is changed by reactivation'],
};

// Small tinted circular KPI icon.

// Dual-series line chart: orange revenue + blue appointments, independently scaled, with hover titles. Accessible summary below.
function TrendLines({ data }: { data: BranchesDashboard['performanceTrend'] }) {
  if (!data.length) return <div className="state" style={{ fontSize: 12 }}>No trend data yet.</div>;
  const W = 520, H = 150, pad = 28;
  const xs = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, data.length - 1);
  const maxRev = Math.max(1, ...data.map((d) => d.revenueCents));
  const maxAppt = Math.max(1, ...data.map((d) => d.appointments));
  const yR = (v: number) => H - pad - (v / maxRev) * (H - pad * 2);
  const yA = (v: number) => H - pad - (v / maxAppt) * (H - pad * 2);
  const path = (acc: (d: BranchesDashboard['performanceTrend'][number]) => number) => data.map((d, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${acc(d).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Branch performance trend over ${data.length} months: revenue and appointments`}>
        <path d={path((d) => yR(d.revenueCents))} fill="none" stroke="#A96F22" strokeWidth={2} />
        <path d={path((d) => yA(d.appointments))} fill="none" stroke="#3C7FB6" strokeWidth={2} />
        {data.map((d, i) => (<g key={i}><circle cx={xs(i)} cy={yR(d.revenueCents)} r={2.5} fill="#A96F22"><title>{`${d.month}: ${money(d.revenueCents)} revenue`}</title></circle><circle cx={xs(i)} cy={yA(d.appointments)} r={2.5} fill="#3C7FB6"><title>{`${d.month}: ${d.appointments} appointments`}</title></circle><text x={xs(i)} y={H - 8} fontSize={9} textAnchor="middle" fill="var(--muted)">{d.month}</text></g>))}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
        <span><b style={{ color: '#A96F22' }}>●</b> Revenue</span><span><b style={{ color: '#3C7FB6' }}>●</b> Appointments</span>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,.34)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card,#fff)', border: '1px solid var(--line)', borderRadius: 14, width: 'min(560px,96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: 'var(--aps-shadow,0 12px 40px rgba(0,0,0,.18))' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, margin: 0 }}>{title}</h2>
          <button className="linkbtn" aria-label="Close" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export function BranchesScreen() {
  const nav = useNavigate();
  const [bd, setBd] = useState<BranchesDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // directory controls (client-side over the returned set; server-side paging is the next backend unit)
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [tenantF, setTenantF] = useState('');
  const [cityF, setCityF] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [healthMax, setHealthMax] = useState<number | ''>('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'revenueMtdCents', dir: -1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<null | 'add' | 'bulk' | 'notice'>(null);
  const [reason, setReason] = useState('');
  const [addForm, setAddForm] = useState({ tenantId: '', name: '', city: '', state: '', address: '', latitude: '', longitude: '', managerName: '', managerEmail: '', managerPhone: '', timezone: '', openingStatus: 'planned' });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statusTarget, setStatusTarget] = useState<{ id: string; name: string; from: string } | null>(null);
  const [statusTo, setStatusTo] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [statusConfirm, setStatusConfirm] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mgrTarget, setMgrTarget] = useState<{ id: string; name: string } | null>(null);
  const [mgrList, setMgrList] = useState<{ id: string; name: string; email: string | null; role: string; currentBranchId: string | null }[] | null>(null);
  const [mgrPick, setMgrPick] = useState('');
  const [mgrDate, setMgrDate] = useState('');
  const [mgrReason, setMgrReason] = useState('');
  const [mgrBusy, setMgrBusy] = useState(false);
  const [mgrError, setMgrError] = useState<string | null>(null);
  const [mgrOk, setMgrOk] = useState<string | null>(null);
  const [xferTarget, setXferTarget] = useState<{ id: string; name: string } | null>(null);
  const [xferOpts, setXferOpts] = useState<{ branch: { id: string; name: string; currentTenantName: string | null }; destinations: { id: string; name: string; status: string }[] } | null>(null);
  const [xferDest, setXferDest] = useState('');
  const [xferPre, setXferPre] = useState<{ impact: { staff: number; appointments: number; serviceRecords: number; supportTickets: number; queueItems: number }; blockers: string[] } | null>(null);
  const [xferReason, setXferReason] = useState('');
  const [xferDate, setXferDate] = useState('');
  const [xferConfirm, setXferConfirm] = useState('');
  const [xferBusy, setXferBusy] = useState(false);
  const [xferError, setXferError] = useState<string | null>(null);
  const [xferOk, setXferOk] = useState<string | null>(null);
  const [hrsTarget, setHrsTarget] = useState<{ id: string; name: string } | null>(null);
  const [hrsDays, setHrsDays] = useState<{ dayOfWeek: number; label: string; isClosed: boolean; opensAt: string; closesAt: string }[] | null>(null);
  const [hrsBusy, setHrsBusy] = useState(false);
  const [hrsError, setHrsError] = useState<string | null>(null);
  const [hrsOk, setHrsOk] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<{ id: string; name: string; ok: boolean; message: string }[] | null>(null);
  const [devTarget, setDevTarget] = useState<{ id: string; name: string } | null>(null);
  const [devData, setDevData] = useState<{ tenantId: string; devices: { id: string; category: string; deviceType: string; name: string; status: string; currentBranchName: string | null; onThisBranch: boolean; allocatable: boolean }[] } | null>(null);
  const [devBusyId, setDevBusyId] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const [devOk, setDevOk] = useState<string | null>(null);
  const [branchMenuId, setBranchMenuId] = useState<string | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  const mayAnalytics = useCan()('super_admin.analytics.view');   // the branch dashboard is an analytics read
  const load = () => {
    if (!mayAnalytics) { setError('Branch analytics need the Analytics permission (super_admin.analytics.view).'); setLoading(false); return; }
    setLoading(true);
    superAdminApi.branchesDashboard().then((d) => { setBd(d); setError(null); setRefreshedAt(new Date()); }).catch((e: any) => setError(e?.message || 'Failed to load branches.')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [mayAnalytics]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Server-side directory: the KPI cards and analytics panels come from branchesDashboard (bd); the table itself is a
  // real paginated/filtered/sorted page from GET /super-admin/platform/branches, so the client only holds one page.
  const dir = useMemo(() => bd?.directory || [], [bd]); // full set, kept only for the (filtered) CSV export below
  const [dirPage, setDirPage] = useState<BranchesDirectoryPage | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const sortApi = useMemo(() => ({ sort: sort.key, dir: (sort.dir === 1 ? 'asc' : 'desc') as 'asc' | 'desc' }), [sort]);
  useEffect(() => {
    setDirLoading(true);
    const t = window.setTimeout(() => {
      superAdminApi.branchesDirectory({ page, pageSize, search: q, status: statusF || undefined, tenant: tenantF || undefined, city: cityF || undefined, healthMax: healthMax === '' ? undefined : healthMax, sort: sortApi.sort, dir: sortApi.dir })
        .then(setDirPage).catch(() => setDirPage(null)).finally(() => setDirLoading(false));
    }, 180);
    return () => window.clearTimeout(t);
  }, [page, pageSize, q, statusF, tenantF, cityF, healthMax, sortApi, refreshNonce]);
  useEffect(() => { setPage(1); }, [q, statusF, tenantF, cityF, healthMax, pageSize]);

  const facets = dirPage?.facets || {
    statuses: Array.from(new Set(dir.map((d) => (d.status || '').toLowerCase()).filter(Boolean))).sort(),
    tenants: Array.from(new Set(dir.map((d) => d.tenantName).filter(Boolean))).sort() as string[],
    cities: Array.from(new Set(dir.map((d) => d.city).filter(Boolean))).sort() as string[],
  };
  const pageRows = dirPage?.rows || [];
  const totalRows = dirPage?.total ?? 0;
  const pages = dirPage?.pages ?? 1;
  const onSearch = (v: string) => { window.clearTimeout(debounce.current); debounce.current = window.setTimeout(() => setQ(v), 200); };
  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: -1 }));

  // Real CSV export of the current (filtered + sorted) directory. Formula-injection guarded; no secrets/PII beyond the
  // monitoring columns. Server-side authorized/audited export is the next backend unit.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportCsv = async () => {
    setExportError(null); setExportBusy(true);
    try {
      const r = await superAdminApi.branchesExport({ search: q, status: statusF || undefined, tenant: tenantF || undefined, city: cityF || undefined, healthMax: healthMax === '' ? undefined : healthMax, sort: sortApi.sort, dir: sortApi.dir });
      const blob = new Blob([r.content], { type: `${r.mime};charset=utf-8;` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(e?.message || 'Export failed.');
    } finally {
      setExportBusy(false);
    }
  };

  // Tenant options for Add Branch (real {id,name} pairs from the loaded directory).
  const tenantOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dir) if (d.tenantId && !m.has(d.tenantId)) m.set(d.tenantId, d.tenantName || d.tenantId);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [dir]);

  const submitAddBranch = async () => {
    if (!addForm.tenantId) { setAddError('Select a parent tenant.'); return; }
    if (addForm.name.trim().length < 2) { setAddError('Enter a branch name (at least 2 characters).'); return; }
    if (!reason.trim()) { setAddError('Enter a reason for audit logging.'); return; }
    setAddBusy(true); setAddError(null); setAddOk(null);
    try {
      const lat = addForm.latitude.trim() ? parseFloat(addForm.latitude) : null;
      const lng = addForm.longitude.trim() ? parseFloat(addForm.longitude) : null;
      const created = await superAdminApi.createBranch({
        ...addForm,
        latitude: lat != null && !isNaN(lat) ? lat : null,
        longitude: lng != null && !isNaN(lng) ? lng : null,
        reason: reason.trim()
      });
      setAddOk(`Branch "${created.name}" created successfully (${created.status}).`);
      setAddForm({ tenantId: '', name: '', city: '', state: '', address: '', latitude: '', longitude: '', managerName: '', managerEmail: '', managerPhone: '', timezone: '', openingStatus: 'planned' });
      setReason('');
      load();
    } catch (e: any) { setAddError(e?.message || 'Failed to create branch.'); }
    finally {
      setAddBusy(false);
    }
  };

  const openStatus = (b: BranchDirectoryRow) => { setStatusTarget({ id: b.id, name: b.name, from: (b.status || '').toLowerCase() }); setStatusTo(''); setStatusReason(''); setStatusConfirm(''); setStatusError(null); };
  const submitStatus = async () => {
    if (!statusTarget) return;
    setStatusError(null);
    if (!statusTo) { setStatusError('Choose a new status.'); return; }
    if (statusReason.trim().length < 3) { setStatusError('A reason is required (at least 3 characters).'); return; }
    if (HIGH_RISK_STATUS.has(statusTo) && statusConfirm.trim().toLowerCase() !== statusTarget.name.toLowerCase()) { setStatusError('Type the exact branch name to confirm this high-risk action.'); return; }
    setStatusBusy(true);
    try {
      await superAdminApi.changeBranchStatus(statusTarget.id, { status: statusTo, reason: statusReason.trim(), confirmName: statusConfirm.trim() || undefined });
      setStatusTarget(null);
      load(); setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setStatusError(e?.message || 'Could not change the branch status.');
    } finally {
      setStatusBusy(false);
    }
  };

  const openManager = (b: BranchDirectoryRow) => {
    setMgrTarget({ id: b.id, name: b.name }); setMgrList(null); setMgrPick(''); setMgrDate(''); setMgrReason(''); setMgrError(null); setMgrOk(null);
    superAdminApi.assignableManagers(b.id).then((r) => setMgrList(r.managers)).catch((e: any) => setMgrError(e?.message || 'Could not load assignable managers.'));
  };
  const submitManager = async () => {
    if (!mgrTarget) return;
    setMgrError(null); setMgrOk(null);
    if (!mgrPick) { setMgrError('Select a manager.'); return; }
    if (mgrReason.trim().length < 3) { setMgrError('A reason is required (at least 3 characters).'); return; }
    setMgrBusy(true);
    try {
      const r = await superAdminApi.assignBranchManager(mgrTarget.id, { managerUserId: mgrPick, reason: mgrReason.trim(), effectiveDate: mgrDate || undefined });
      setMgrOk(`${r.manager.name} assigned to ${r.branch.name}${r.movedFromBranchId ? ' (moved from another branch)' : ''}.`);
      load(); setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setMgrError(e?.message || 'Could not assign the manager.');
    } finally {
      setMgrBusy(false);
    }
  };

  const openTransfer = (b: BranchDirectoryRow) => {
    setXferTarget({ id: b.id, name: b.name }); setXferOpts(null); setXferDest(''); setXferPre(null); setXferReason(''); setXferDate(''); setXferConfirm(''); setXferError(null); setXferOk(null);
    superAdminApi.branchTransferOptions(b.id).then(setXferOpts).catch((e: any) => setXferError(e?.message || 'Could not load transfer options.'));
  };
  const pickDest = (destId: string) => {
    setXferDest(destId); setXferPre(null);
    if (!destId || !xferTarget) return;
    superAdminApi.branchTransferPreflight(xferTarget.id, destId).then((r) => setXferPre({ impact: r.impact, blockers: r.blockers })).catch((e: any) => setXferError(e?.message || 'Preflight failed.'));
  };
  const submitTransfer = async () => {
    if (!xferTarget) return;
    setXferError(null); setXferOk(null);
    if (!xferDest) { setXferError('Select a destination tenant.'); return; }
    if (xferReason.trim().length < 10) { setXferError('A detailed reason (at least 10 characters) is required.'); return; }
    if (xferConfirm.trim().toLowerCase() !== xferTarget.name.toLowerCase()) { setXferError('Type the exact branch name to confirm this transfer.'); return; }
    setXferBusy(true);
    try {
      const r = await superAdminApi.requestBranchTransfer(xferTarget.id, { destinationTenantId: xferDest, reason: xferReason.trim(), confirmName: xferConfirm.trim(), effectiveDate: xferDate || undefined });
      setXferOk(`Transfer request ${r.status} (id ${r.id.slice(0, 8)}). Recorded for review — the data move is a separate reviewed job and was NOT executed.`);
      load(); setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setXferError(e?.message || 'Could not record the transfer request.');
    } finally {
      setXferBusy(false);
    }
  };

  const openHours = (b: BranchDirectoryRow) => {
    setHrsTarget({ id: b.id, name: b.name }); setHrsDays(null); setHrsError(null); setHrsOk(null);
    superAdminApi.branchHours(b.id).then((r) => setHrsDays(r.days.map((d) => ({ dayOfWeek: d.dayOfWeek, label: d.label, isClosed: d.isClosed, opensAt: d.opensAt || '09:00', closesAt: d.closesAt || '17:00' })))).catch((e: any) => setHrsError(e?.message || 'Could not load hours.'));
  };
  const setHrsDay = (dow: number, patch: Partial<{ isClosed: boolean; opensAt: string; closesAt: string }>) => setHrsDays((prev) => prev ? prev.map((d) => d.dayOfWeek === dow ? { ...d, ...patch } : d) : prev);
  const submitHours = async () => {
    if (!hrsTarget || !hrsDays) return;
    setHrsError(null); setHrsOk(null);
    const bad = hrsDays.find((d) => !d.isClosed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.closesAt) || d.opensAt >= d.closesAt));
    if (bad) { setHrsError(`${bad.label}: opening time must be a valid time before the closing time.`); return; }
    setHrsBusy(true);
    try {
      await superAdminApi.setBranchHours(hrsTarget.id, { days: hrsDays.map((d) => ({ dayOfWeek: d.dayOfWeek, isClosed: d.isClosed, opensAt: d.isClosed ? null : d.opensAt, closesAt: d.isClosed ? null : d.closesAt })) });
      setHrsOk('Operating hours saved.');
      load(); setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setHrsError(e?.message || 'Could not save hours.');
    } finally {
      setHrsBusy(false);
    }
  };

  const toggleSel = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelPage = (ids: string[], on: boolean) => setSel((prev) => { const n = new Set(prev); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const clearSel = () => setSel(new Set());
  const openBulk = () => { setBulkOpen(true); setBulkStatus(''); setBulkReason(''); setBulkError(null); setBulkResults(null); };
  const submitBulk = async () => {
    setBulkError(null); setBulkResults(null);
    if (!bulkStatus) { setBulkError('Select a target status.'); return; }
    if (bulkReason.trim().length < 3) { setBulkError('A reason is required (at least 3 characters).'); return; }
    setBulkBusy(true);
    try {
      const r = await superAdminApi.bulkBranchStatus({ branchIds: [...sel], status: bulkStatus, reason: bulkReason.trim() });
      setBulkResults(r.results);
      load(); setRefreshNonce((n) => n + 1);
      if (r.summary.failed === 0) clearSel();
    } catch (e: any) {
      setBulkError(e?.message || 'Bulk status change failed.');
    } finally {
      setBulkBusy(false);
    }
  };
  const exportSelected = async () => {
    setExportError(null); setExportBusy(true);
    try {
      const r = await superAdminApi.branchesExport({ ids: [...sel].join(','), sort: sortApi.sort, dir: sortApi.dir });
      const blob = new Blob([r.content], { type: `${r.mime};charset=utf-8;` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(e?.message || 'Export failed.');
    } finally {
      setExportBusy(false);
    }
  };

  const openDevices = (b: BranchDirectoryRow) => {
    setDevTarget({ id: b.id, name: b.name }); setDevData(null); setDevError(null); setDevOk(null);
    superAdminApi.branchDevices(b.id).then((r) => setDevData({ tenantId: r.tenantId, devices: r.devices })).catch((e: any) => setDevError(e?.message || 'Could not load devices.'));
  };
  const allocateDev = async (deviceId: string, category: string) => {
    if (!devTarget) return;
    setDevError(null); setDevOk(null); setDevBusyId(deviceId);
    try {
      const r = await superAdminApi.allocateDevice(devTarget.id, { deviceId, category });
      setDevOk(`${r.device.name} allocated to ${devTarget.name}${r.movedFromBranchId ? ' (moved from another branch)' : ''}.`);
      const refreshed = await superAdminApi.branchDevices(devTarget.id);
      setDevData({ tenantId: refreshed.tenantId, devices: refreshed.devices });
      load(); setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setDevError(e?.message || 'Could not allocate the device.');
    } finally {
      setDevBusyId(null);
    }
  };

  if (error) return <div className="screen"><div className="vh"><h1>Branches</h1></div><div className="state">{error} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (loading && !bd) return <div className="screen"><div className="vh"><h1>Branches</h1></div><div className="state">Loading branches…</div></div>;
  if (!bd) return <div className="screen"><div className="state">No data.</div></div>;

  const k = bd.kpis;
  const sd = bd.statusDistribution;
  const hd = bd.healthDistribution;
  const ds = bd.deviceStatus;
  // 10 KPI cards (reference order). Trends require a prior-period baseline the backend doesn't compute yet → we show a
  // neutral context caption instead of a fabricated percentage (honest). `bad` flips the value color for unfavorable KPIs.
  const kpis: { l: string; v: string; cap: string; glyph: string; tint: string; to: string; bad?: boolean }[] = [
    { l: 'Total Branches', v: fmt(k.totalBranches), cap: 'across all tenants', glyph: '🏢', tint: '#A96F22', to: '/branches' },
    { l: 'Active Branches', v: fmt(k.activeBranches), cap: 'currently active', glyph: '✓', tint: '#3E8F57', to: '/branches?status=active' },
    { l: 'Pending Openings', v: fmt(k.pendingOpenings), cap: 'in onboarding', glyph: '◷', tint: '#C98A3A', to: '/branches?openingStatus=pending' },
    { l: 'Suspended Branches', v: fmt(k.suspendedBranches), cap: 'need attention', glyph: '⚠', tint: '#B85B4D', to: '/branches?status=suspended', bad: k.suspendedBranches > 0 },
    { l: 'Open Today', v: fmt(k.openTodayBranches), cap: 'open per hours config', glyph: '◐', tint: '#3C7FB6', to: '/branches' },
    { l: 'POS Devices', v: fmt(k.posDevices), cap: 'fleet (platform-wide)', glyph: '▣', tint: '#3C7FB6', to: '/devices-management' },
    { l: "Today's Appointments", v: fmt(k.todaysAppointments), cap: 'monitoring only', glyph: '🗓', tint: '#7B5BB6', to: '/appointment-oversight' },
    { l: "Today's Revenue", v: money(k.todaysRevenueCents), cap: 'service sales, today', glyph: '$', tint: '#3E8F57', to: '/payments-transactions' },
    { l: 'Customers Checked In', v: fmt(k.customersCheckedIn), cap: 'today (check-ins)', glyph: '☺', tint: '#5BA8A0', to: '/booking-checkin' },
    { l: 'Open Support Tickets', v: fmt(k.openSupportTickets), cap: 'branch tickets', glyph: '🎧', tint: '#B85B4D', to: '/help-center', bad: k.openSupportTickets > 0 },
  ];

  const Th = ({ id, label, num }: { id: string; label: string; num?: boolean }) => (
    <th onClick={() => toggleSort(id)} style={{ cursor: 'pointer', textAlign: num ? 'right' : 'left', whiteSpace: 'nowrap', userSelect: 'none', padding: '12px 10px' }} aria-sort={sort.key === id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === id ? <span style={{ color: 'var(--gold,#A96F22)' }}>{sort.dir === 1 ? ' ▲' : ' ▼'}</span> : ''}
    </th>
  );

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Title + main actions */}
      <div className=" flex flex-col lg:flex-row justify-between gap-3" >
        <div className="vh" style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0 }}>Branches <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span></h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Centralized branch management with full operational visibility across all tenants.</div>
        </div>
        <div className="self-baseline flex-wrap whitespace-nowrap" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" style={{ minHeight: 36, opacity: exportBusy ? .6 : 1 }} disabled={exportBusy} onClick={exportCsv} title={exportError || 'Export the filtered directory (server-side, audited)'}>{exportBusy ? 'Exporting…' : '⤓ Export Report'}</button>
          <button className="btn ghost" style={{ minHeight: 36 }} onClick={() => setModal('bulk')}>⚙ Bulk Actions</button>
          <button className="btn" style={{ minHeight: 36, fontWeight: 800 }} onClick={() => setModal('add')}>+ Add Branch</button>
        </div>
      </div>
      {refreshedAt && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -6 }}>Last updated {refreshedAt.toLocaleTimeString()}{loading ? ' · refreshing…' : ''}</div>}

      {/* 10 KPI cards (5 per row) */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        {kpis.map((c) => (
          <button
            key={c.l}
            onClick={() => nav(c.to)}
            style={{
              textAlign: 'left',
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '12px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
              minWidth: 0,
              font: 'inherit',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(169, 111, 34, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.borderColor = 'var(--line)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(169, 111, 34, 0.04)';
            }}
            aria-label={`${c.l}: ${c.v}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.l}
              </span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: c.tint + '18', color: c.tint, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>
                {c.glyph === '⚠' ? '!' : c.glyph}
              </span>
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 21, fontWeight: 700, color: c.bad ? 'var(--danger,#B85B4D)' : 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>
              {c.v}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, fontWeight: 600 }}>
              {c.cap}
            </div>
          </button>
        ))}
      </div>

      {/* Main split: directory (left) + health/alerts/distributions (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
        {/* Directory */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
              All Branches Directory <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({totalRows.toLocaleString()})</span>
            </h2>
            {dirLoading ? <span className="muted" style={{ fontSize: 11 }}>updating…</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: '#FFFDF8' }}>
            <select aria-label="Filter by status" className="inp" style={{ height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={statusF} onChange={(e) => setStatusF(e.target.value)}><option value="">All Status</option>{facets.statuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
            <select aria-label="Filter by tenant" className="inp" style={{ height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={tenantF} onChange={(e) => setTenantF(e.target.value)}><option value="">All Tenants</option>{facets.tenants.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select aria-label="Filter by city" className="inp" style={{ height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={cityF} onChange={(e) => setCityF(e.target.value)}><option value="">All Cities</option>{facets.cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input aria-label="Search branches" className="inp" style={{ flex: 1, minWidth: 200, height: 34, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} placeholder="Search branch name, manager..." defaultValue={q} onChange={(e) => onSearch(e.target.value)} />
            <button className="btn ghost" style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>⚲ Filters</button>
          </div>
          {showFilters && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, background: '#FFFDF8' }}>
              <label style={{ fontWeight: 600 }}>Health ≤ <input type="number" min={0} max={100} value={healthMax} onChange={(e) => setHealthMax(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 64, height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', marginLeft: 4 }} /></label>
              <button className="linkbtn" onClick={() => { setHealthMax(''); setStatusF(''); setTenantF(''); setCityF(''); }}>Clear filters</button>
            </div>
          )}
          {sel.size > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', background: 'var(--cream2,#F7F2E9)', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
              <b>{sel.size}</b> selected
              <button className="btn ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={openBulk}>Bulk status…</button>
              <button className="btn ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 11, opacity: exportBusy ? .6 : 1 }} disabled={exportBusy} onClick={exportSelected}>{exportBusy ? 'Exporting…' : 'Export selected'}</button>
              <button className="linkbtn" onClick={clearSel}>Clear selection</button>
              {exportError && <span style={{ color: 'var(--danger,#B85B4D)' }}>{exportError}</span>}
            </div>
          )}
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 960 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ width: 28, padding: '12px 10px' }}><input type="checkbox" aria-label="Select all on page" checked={pageRows.length > 0 && pageRows.every((b) => sel.has(b.id))} ref={(el) => { if (el) el.indeterminate = pageRows.some((b) => sel.has(b.id)) && !pageRows.every((b) => sel.has(b.id)); }} onChange={(e) => toggleSelPage(pageRows.map((b) => b.id), e.target.checked)} /></th>
                  <Th id="name" label="Branch Name" />
                  <Th id="tenantName" label="Parent Tenant" />
                  <Th id="city" label="City / Location" />
                  <Th id="manager" label="Manager" />
                  <Th id="status" label="Status" />
                  <Th id="staff" label="Techs" num />
                  <Th id="todaysAppts" label="Appts Today" num />
                  <th style={{ textAlign: 'right', padding: '12px 10px' }}>Customers Today</th>
                  <Th id="revenueMtdCents" label="Revenue (MTD)" num />
                  <th style={{ textAlign: 'right', padding: '12px 10px' }}>Devices</th>
                  <Th id="healthScore" label="Health" num />
                  <th style={{ textAlign: 'right', padding: '12px 14px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? <tr><td colSpan={13} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No branches match.</td></tr> : pageRows.map((b, idx) => {
                  const ss = statusStyle(b.status);
                  return (
                    <tr
                      key={b.id}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF9EF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                    >
                      <td style={{ padding: '10px 10px' }}><input type="checkbox" aria-label={`Select ${b.name}`} checked={sel.has(b.id)} onChange={() => toggleSel(b.id)} /></td>
                      <td style={{ padding: '10px 10px', fontWeight: 600, color: 'var(--text)' }}>
                        <div>{b.name}</div>
                        <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>{b.id.slice(0, 8)}</div>
                      </td>
                      <td style={{ padding: '10px 10px', color: 'var(--text)', fontWeight: 500 }}>{b.tenantName || '—'}</td>
                      <td style={{ padding: '10px 10px', color: 'var(--muted)' }}>
                        {[b.city, b.state].filter(Boolean).join(', ') || '—'}
                        {(b as any).latitude != null && (b as any).longitude != null && (
                          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span>📍 {Number((b as any).latitude).toFixed(4)}, {Number((b as any).longitude).toFixed(4)}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px', color: 'var(--muted)' }}>{b.manager || '—'}</td>
                      <td style={{ padding: '10px 10px' }}><span className={ss.cls} style={ss.style}>{cap(b.status)}</span></td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(b.staff)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(b.todaysAppts)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }} className="muted">—</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{money(b.revenueMtdCents)}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }} className="muted">—</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: healthColor(b.healthScore) }}>{b.healthScore == null ? '—' : b.healthScore}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', position: 'relative' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button className="linkbtn" title="View branch" aria-label={`View ${b.name}`} onClick={() => nav(`/tenants/${b.tenantId}`)}>View</button>
                          <button className="linkbtn" title="View monitoring" aria-label={`Monitor ${b.name}`} onClick={() => nav(`/appointment-oversight`)}>Monitor</button>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              className="linkbtn"
                              title="More branch actions"
                              aria-label={`More actions for ${b.name}`}
                              onClick={(e) => { e.stopPropagation(); setBranchMenuId(branchMenuId === b.id ? null : b.id); }}
                              style={{ padding: '3px 8px', fontWeight: 800 }}
                            >
                              ⋯ Actions ▾
                            </button>
                            {branchMenuId === b.id && (
                              <div
                                role="menu"
                                style={{
                                  position: 'absolute',
                                  right: 0,
                                  top: 'calc(100% + 4px)',
                                  zIndex: 60,
                                  background: '#FFFDF8',
                                  border: '1px solid var(--line)',
                                  borderRadius: 12,
                                  boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
                                  padding: 6,
                                  minWidth: 170,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 4,
                                  textAlign: 'left',
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setBranchMenuId(null); openStatus(b); }}>⚙ Change Status</button>
                                <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setBranchMenuId(null); openManager(b); }}>👤 Assign Manager</button>
                                <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setBranchMenuId(null); openTransfer(b); }}>⇄ Transfer Branch</button>
                                <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setBranchMenuId(null); openHours(b); }}>🕒 Operating Hours</button>
                                <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setBranchMenuId(null); openDevices(b); }}>📱 Device Allocation</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)', fontSize: 12, flexWrap: 'wrap', background: '#FFFDF8' }}>
            <span className="muted">Showing {totalRows === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalRows)} of {totalRows.toLocaleString()} branches</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="linkbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
              <span>Page {page} / {pages}</span>
              <button className="linkbtn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next ›</button>
              <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 6px', background: '#fff' }}>{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
            </div>
          </div>
        </section>

        {/* Right column: health, alerts, status donut, device donut */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Health &amp; Alerts</h2><button className="linkbtn" onClick={() => nav('/branches')}>View All</button></div>
            {([['Excellent (90–100)', hd.excellent, 'var(--ok,#3E8F57)'], ['Good (70–89)', hd.good, '#6BBF59'], ['Average (50–69)', hd.average, 'var(--gold,#A96F22)'], ['Poor (30–49)', hd.poor, '#C98A3A'], ['Critical (0–29)', hd.critical, 'var(--danger,#B85B4D)']] as [string, number, string][]).map(([label, val, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: color }} /><span>{label}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{fmt(val)}</span><span className="muted" style={{ width: 46, textAlign: 'right' }}>{pct(val, hd.scored)}%</span>
              </div>
            ))}
            {hd.unscored > 0 && <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>{fmt(hd.unscored)} pre-operational branch(es) not yet scored.</div>}
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Operational Alerts</h2><button className="linkbtn" onClick={() => nav('/alerts')}>View All</button></div>
            {bd.operationalAlerts.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No active alerts.</div> : bd.operationalAlerts.map((a) => (
              <button key={a.key} className="arow" onClick={() => nav(a.to)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '8px 0', cursor: 'pointer', font: 'inherit' }}>
                <span aria-hidden style={{ color: a.severity === 'critical' ? 'var(--danger,#B85B4D)' : a.severity === 'warning' ? 'var(--gold,#A96F22)' : 'var(--info,#3C7FB6)' }}>●</span>
                <span style={{ fontSize: 12 }}><b>{a.count}</b> {a.label}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>›</span>
              </button>
            ))}
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <h2 style={{ margin: '0 0 8px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Status Distribution</h2>
            <Donut centerLabel={`${fmt(sd.total)} Total`} data={[{ label: 'Active', value: sd.active }, { label: 'Pending', value: bd.kpis.pendingOpenings }, { label: 'Suspended', value: bd.kpis.suspendedBranches }, { label: 'Other', value: Math.max(0, sd.total - sd.active - bd.kpis.pendingOpenings - bd.kpis.suspendedBranches) }].filter((d) => d.value > 0)} />
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <h2 style={{ margin: '0 0 8px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Device Status Overview</h2>
            <Donut centerLabel={`${fmt(ds.total)} Devices`} data={[{ label: 'Online', value: ds.online }, { label: 'Offline', value: ds.offline }, { label: 'Maintenance', value: ds.maintenance }, { label: 'Inactive', value: ds.inactive }].filter((d) => d.value > 0)} />
            <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Online = device reporting active/connected state.</div>
          </section>
        </div>
      </div>

      {/* Analytics row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" style={{ alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead"><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Performance Trend</h2><span className="muted" style={{ fontSize: 11 }}>Last 6 mo</span></div>
          <TrendLines data={bd.performanceTrend} />
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 6 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Top Performing Branches</h2><span className="muted" style={{ fontSize: 11 }}>MTD</span></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {bd.topBranches.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No revenue yet.</div> : bd.topBranches.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, borderBottom: '1px solid var(--line)' }}>
                <span className="muted" style={{ width: 14 }}>{i + 1}</span><span style={{ flex: 1, fontWeight: 600 }}>{t.name}</span><span style={{ fontWeight: 700 }}>{money(t.revenueMtdCents)}</span>
              </div>
            ))}
          </div>
          <button className="linkbtn" style={{ marginTop: 'auto', paddingTop: 6 }} onClick={() => nav('/platform-reports')}>View All Rankings</button>
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead"><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Revenue by City</h2><span className="muted" style={{ fontSize: 11 }}>MTD</span></div>
          <MiniBars data={bd.revenueByCity.map((c) => ({ label: `${c.city}${c.state ? ', ' + c.state : ''}`, value: Math.round(c.cents / 100), tip: money(c.cents) }))} emptyHint="No city revenue yet." />
          <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => nav('/platform-reports')}>View All Cities</button>
        </section>
      </div>

      {/* Analytics row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2  gap-3" style={{ alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 260, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 6 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Live Queue Monitor by Branch</h2><button className="linkbtn" onClick={() => nav('/queue-management')}>View Live Monitor</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {bd.queueByBranch.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No active queues.</div> : bd.queueByBranch.map((qB) => (
              <button key={qB.branchId} className="arow" onClick={() => nav('/queue-management')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '6px 0', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}>
                <span aria-hidden style={{ color: qB.count >= 6 ? 'var(--danger,#B85B4D)' : qB.count >= 3 ? 'var(--gold,#A96F22)' : 'var(--ok,#3E8F57)' }}>●</span><span style={{ flex: 1 }}>{qB.name}</span><b>{qB.count}</b>
              </button>
            ))}
          </div>
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 260, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 6 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Upcoming Appointments by Branch</h2><button className="linkbtn" onClick={() => nav('/appointment-oversight')}>View All Appointments</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {bd.upcomingByBranch.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No upcoming appointments.</div> : bd.upcomingByBranch.map((u) => (
              <button key={u.branchId} className="arow" onClick={() => nav('/appointment-oversight')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '6px 0', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{u.name}</span><b>{u.count}</b>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Analytics row 3 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" style={{ alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 6 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Recent Branch Activity</h2><button className="linkbtn" onClick={() => nav('/audit-logs')}>View All Activity</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {bd.recentActivity.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No recent branch activity.</div> : bd.recentActivity.slice(0, 10).map((a, i) => (
              <div key={i} style={{ fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontWeight: 600 }}>{cap(a.action)}</span>{a.actorName ? <span className="muted"> · {a.actorName}</span> : null}
                <div className="muted" style={{ fontSize: 10.5 }}>{a.at ? new Date(a.at).toLocaleString() : '—'}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 6px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Onboarding Pipeline</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {([['Requests Received', bd.onboardingPipeline.received], ['Under Review', bd.onboardingPipeline.underReview], ['Site Verified', bd.onboardingPipeline.siteVerified], ['Setup in Progress', bd.onboardingPipeline.setupInProgress], ['Ready to Launch', bd.onboardingPipeline.readyToLaunch]] as [string, number][]).map(([label, val]) => (
              <button key={label} className="arow" onClick={() => nav('/branches?openingStatus=pending')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '5px 0', cursor: 'pointer', font: 'inherit', fontSize: 12 }}>
                <span style={{ flex: 1 }}>{label}</span><b>{fmt(val)}</b>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Conversion Rate: <b>{bd.onboardingPipeline.conversionRate}%</b></div>
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 6px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Hours &amp; Availability</h2>
          <Donut centerLabel={`${bd.hoursAvailability.avgAvailabilityPct}% Avg`} data={[{ label: 'Full Hours', value: bd.hoursAvailability.full }, { label: 'Partial Hours', value: bd.hoursAvailability.partial }, { label: 'Limited Hours', value: bd.hoursAvailability.limited }].filter((d) => d.value > 0)} />
          <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => nav('/branches')}>View Details</button>
        </section>
      </div>

      {/* Analytics row 4 */}
      <div className="grid grid-cols-1 md:grid-cols-2  gap-3" style={{ alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 210, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 6px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Tech Utilization Overview</h2>
          <div className="state" style={{ fontSize: 12, padding: '20px 0' }}>Technician utilization requires a per-branch scheduled-capacity / booking-slot model that isn't in the schema yet — <NotConnected>not connected</NotConnected>. Tracked as a documented gap; the formula (productive service minutes ÷ scheduled technician minutes) is specified for the future capacity unit.</div>
        </section>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, minHeight: 210, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 6px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>At-a-Glance Summary</h2>
          <div>
            {([['Total Branches', fmt(bd.atAGlance.totalBranches)], ['Total Techs', fmt(bd.atAGlance.totalTechs)], ['Total Customers Today', fmt(bd.atAGlance.customersToday)], ['Total Appointments Today', fmt(bd.atAGlance.apptsToday)], ['Total Revenue Today', money(bd.atAGlance.revenueTodayCents)]] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ display: 'flex', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}><span style={{ flex: 1 }} className="muted">{label}</span><b>{val}</b></div>
            ))}
          </div>
          <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => nav('/platform-reports')}>View Full Summary</button>
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <h2 style={{ margin: '0 0 10px 0', fontFamily: 'Playfair Display, serif', fontSize: 16 }}>Quick Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {[
            { l: '＋ Add Branch', fn: () => setModal('add') },
            { l: '⚙ Bulk Update', fn: () => setModal('bulk') },
            { l: '👤 Assign Manager', fn: () => nav('/users-roles') },
            { l: '📊 View Reports', fn: () => nav('/platform-reports') },
            { l: '⤓ Export Data', fn: exportCsv },
            { l: '🩺 Branch Health', fn: () => nav('/branches') },
            { l: '📱 Device Allocation', fn: () => nav('/devices-management') },
            { l: '⏱ Opening Requests', fn: () => nav('/branches?openingStatus=pending') },
            { l: '✉ Send Notice', fn: () => setModal('notice') },
            { l: '🕒 Manage Hours', fn: () => nav('/branches') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn} style={{ minHeight: 36, padding: '6px 12px', fontSize: 12 }}>{a.l}</button>)}
        </div>
      </section>

      {modal === 'add' && (
        <Modal title="Add Branch — controlled creation" onClose={() => { setModal(null); setReason(''); setAddError(null); setAddOk(null); }}>
          <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Creates a branch under the selected tenant in one transaction (duplicate name/address is rejected, tenant is validated, an audit event is written). It opens pre-operational unless you set the opening status to Active.</p>
          {addOk && <div className="state" style={{ fontSize: 12.5, background: 'var(--ok-bg,#E8F5EC)', color: 'var(--ok,#3E8F57)', border: '1px solid #BFE3C6' }}>{addOk}</div>}
          {addError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{addError}</div>}
          {(() => {
            const inp: React.CSSProperties = { width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 };
            const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '8px 0 4px' };
            const set = (k: keyof typeof addForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setAddForm((f) => ({ ...f, [k]: e.target.value }));
            return (
              <div>
                <label style={lbl}>Parent tenant *</label>
                <select style={inp} value={addForm.tenantId} onChange={set('tenantId')}><option value="">Select tenant…</option>{tenantOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <label style={lbl}>Branch name *</label>
                <input style={inp} value={addForm.name} onChange={set('name')} placeholder="e.g. Glamour Studio — Downtown" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 2 }}><label style={lbl}>City</label><input style={inp} value={addForm.city} onChange={set('city')} /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>State</label><input style={inp} value={addForm.state} onChange={set('state')} /></div>
                </div>
                <label style={lbl}>Street address</label>
                <input style={inp} value={addForm.address} onChange={set('address')} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Latitude</label><input style={inp} value={addForm.latitude} onChange={set('latitude')} placeholder="e.g. 37.7749" /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Longitude</label><input style={inp} value={addForm.longitude} onChange={set('longitude')} placeholder="e.g. -122.4194" /></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Manager name</label><input style={inp} value={addForm.managerName} onChange={set('managerName')} /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Manager email</label><input style={inp} value={addForm.managerEmail} onChange={set('managerEmail')} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Timezone</label><input style={inp} value={addForm.timezone} onChange={set('timezone')} placeholder="America/New_York" /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Opening status</label><select style={inp} value={addForm.openingStatus} onChange={set('openingStatus')}><option value="planned">Planned (pending)</option><option value="active">Active (open now)</option></select></div>
                </div>
                <label style={lbl}>Reason / context *</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...inp, height: 'auto', padding: 8 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: 'var(--grad,#A96F22)', color: '#fff', borderColor: 'transparent', opacity: addBusy ? .6 : 1 }} disabled={addBusy} onClick={submitAddBranch}>{addBusy ? 'Creating…' : 'Create Branch'}</button>
                  <button className="qbtn" disabled={addBusy} onClick={() => { setModal(null); setReason(''); setAddError(null); setAddOk(null); }}>Close</button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
      {modal === 'bulk' && (
        <Modal title="Bulk Actions — controlled" onClose={() => setModal(null)}>
          <p style={{ fontSize: 13, marginTop: 0 }}>Bulk operations (send notice, assign manager, change operating status, update hours, assign devices/merchant, export selected, move to review) require explicit branch selection, a confirmation + impact summary, a required reason, permission verification, and audit logging. Select branches in the directory first.</p>
          <button className="qbtn" onClick={() => setModal(null)}>Close</button>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Selection + bulk command endpoints are the next build unit; dangerous bulk changes will not run without confirmation, reason, and audit.</div>
        </Modal>
      )}
      {modal === 'notice' && (
        <Modal title="Send Branch Notice" onClose={() => { setModal(null); setReason(''); }}>
          <p style={{ fontSize: 13, marginTop: 0 }}>Send an authorized notice to one branch, selected branches, a tenant's branches, a city/region, or all branches. Platform-wide delivery requires confirmation.</p>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Message (required)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="qbtn" style={{ opacity: reason.trim() ? 1 : .5 }} disabled={!reason.trim()} onClick={() => { setModal(null); setReason(''); nav('/communications'); }}>Continue in Communications</button>
            <button className="qbtn" onClick={() => { setModal(null); setReason(''); }}>Cancel</button>
          </div>
        </Modal>
      )}

      {statusTarget && (() => {
        const allowed = STATUS_TRANSITIONS[statusTarget.from] || [];
        const highRisk = HIGH_RISK_STATUS.has(statusTo);
        const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, marginTop: 4 };
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '8px 0 0' };
        return (
          <Modal title={`Change status — ${statusTarget.name}`} onClose={() => setStatusTarget(null)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Current status: <b style={{ color: 'var(--text)' }}>{cap(statusTarget.from)}</b>. Audit-logged; no data is deleted.</p>
            {statusError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{statusError}</div>}
            {allowed.length === 0 ? <div className="state" style={{ fontSize: 12.5 }}>This branch's status can't be changed from this page.</div> : (
              <div>
                <label style={lbl}>New status *</label>
                <select style={inp} value={statusTo} onChange={(e) => { setStatusTo(e.target.value); setStatusConfirm(''); }}><option value="">Select…</option>{allowed.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
                {statusTo && (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--cream2,#F7F2E9)', borderRadius: 8, fontSize: 12 }}>
                    <b style={{ fontSize: 11 }}>Impact summary</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>{(STATUS_IMPACT[statusTo] || []).map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                )}
                <label style={lbl}>Reason *</label>
                <textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} rows={2} style={inp} />
                {highRisk && (
                  <>
                    <label style={lbl}>Type “{statusTarget.name}” to confirm *</label>
                    <input style={inp} value={statusConfirm} onChange={(e) => setStatusConfirm(e.target.value)} placeholder={statusTarget.name} />
                  </>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: highRisk ? 'var(--danger,#B85B4D)' : 'var(--grad,#A96F22)', color: '#fff', borderColor: 'transparent', opacity: statusBusy ? .6 : 1 }} disabled={statusBusy} onClick={submitStatus}>{statusBusy ? 'Applying…' : `Apply ${statusTo ? cap(statusTo) : 'change'}`}</button>
                  <button className="qbtn" disabled={statusBusy} onClick={() => setStatusTarget(null)}>Cancel</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {mgrTarget && (() => {
        const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, marginTop: 4 };
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '8px 0 0' };
        const movesAway = !!mgrList?.find((m) => m.id === mgrPick && m.currentBranchId && m.currentBranchId !== mgrTarget.id);
        return (
          <Modal title={`Assign manager — ${mgrTarget.name}`} onClose={() => setMgrTarget(null)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Assigns a manager/owner from this branch's tenant. Audit-logged. A user belongs to one branch, so moving a manager replaces their prior assignment.</p>
            {mgrOk && <div className="state" style={{ fontSize: 12.5, background: 'var(--ok-bg,#E8F5EC)', color: 'var(--ok,#3E8F57)', border: '1px solid #BFE3C6' }}>{mgrOk}</div>}
            {mgrError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{mgrError}</div>}
            {mgrList === null && !mgrError ? <div className="state" style={{ fontSize: 12.5 }}>Loading managers…</div> : mgrList && mgrList.length === 0 ? (
              <div className="state" style={{ fontSize: 12.5 }}>No active managers or owners exist in this tenant yet. Create one in Users &amp; Roles first.</div>
            ) : mgrList && (
              <div>
                <label style={lbl}>Manager *</label>
                <select style={inp} value={mgrPick} onChange={(e) => setMgrPick(e.target.value)}><option value="">Select…</option>{mgrList.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}{m.email ? ` · ${m.email}` : ''}{m.currentBranchId === mgrTarget.id ? ' (current)' : ''}</option>)}</select>
                {movesAway && <div className="muted" style={{ fontSize: 11, marginTop: 6, color: 'var(--gold,#A96F22)' }}>This manager currently leads another branch — assigning here removes that prior assignment.</div>}
                <label style={lbl}>Effective date (optional)</label>
                <input style={inp} type="date" value={mgrDate} onChange={(e) => setMgrDate(e.target.value)} />
                <label style={lbl}>Reason *</label>
                <textarea value={mgrReason} onChange={(e) => setMgrReason(e.target.value)} rows={2} style={inp} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: 'var(--grad,#A96F22)', color: '#fff', borderColor: 'transparent', opacity: mgrBusy ? .6 : 1 }} disabled={mgrBusy} onClick={submitManager}>{mgrBusy ? 'Assigning…' : 'Assign Manager'}</button>
                  <button className="qbtn" disabled={mgrBusy} onClick={() => setMgrTarget(null)}>Close</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {xferTarget && (() => {
        const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, marginTop: 4 };
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '8px 0 0' };
        return (
          <Modal title={`Transfer branch — ${xferTarget.name}`} onClose={() => setXferTarget(null)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>High-risk, reviewed process. This records a transfer <b>request</b> with a pre-transfer impact snapshot and an audit entry — it does <b>not</b> move data. Completed payments, settlements, and historical reporting are retained with original ownership; the cross-tenant migration is a separate reviewed job.</p>
            {xferOk && <div className="state" style={{ fontSize: 12.5, background: 'var(--ok-bg,#E8F5EC)', color: 'var(--ok,#3E8F57)', border: '1px solid #BFE3C6' }}>{xferOk}</div>}
            {xferError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{xferError}</div>}
            {xferOpts === null && !xferError ? <div className="state" style={{ fontSize: 12.5 }}>Loading…</div> : xferOpts && !xferOk && (
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Current tenant: <b style={{ color: 'var(--text)' }}>{xferOpts.branch.currentTenantName || '—'}</b></div>
                <label style={lbl}>Destination tenant *</label>
                <select style={inp} value={xferDest} onChange={(e) => pickDest(e.target.value)}><option value="">Select…</option>{xferOpts.destinations.map((d) => <option key={d.id} value={d.id} disabled={d.status !== 'active'}>{d.name}{d.status !== 'active' ? ` (${d.status})` : ''}</option>)}</select>
                {xferPre && (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--cream2,#F7F2E9)', borderRadius: 8, fontSize: 12 }}>
                    <b style={{ fontSize: 11 }}>Impact snapshot (branch-keyed)</b>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
                      <span>Staff: <b>{xferPre.impact.staff}</b></span><span>Appointments: <b>{xferPre.impact.appointments}</b></span><span>Service records: <b>{xferPre.impact.serviceRecords}</b></span><span>Support tickets: <b>{xferPre.impact.supportTickets}</b></span><span>Queue: <b>{xferPre.impact.queueItems}</b></span>
                    </div>
                    {xferPre.blockers.length > 0 && <div style={{ marginTop: 6, color: 'var(--danger,#B85B4D)' }}>{xferPre.blockers.join(' ')}</div>}
                  </div>
                )}
                <label style={lbl}>Business reason * (min 10 chars)</label>
                <textarea value={xferReason} onChange={(e) => setXferReason(e.target.value)} rows={2} style={inp} />
                <label style={lbl}>Effective date (optional)</label>
                <input style={inp} type="date" value={xferDate} onChange={(e) => setXferDate(e.target.value)} />
                <label style={lbl}>Type “{xferTarget.name}” to confirm *</label>
                <input style={inp} value={xferConfirm} onChange={(e) => setXferConfirm(e.target.value)} placeholder={xferTarget.name} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: 'var(--danger,#B85B4D)', color: '#fff', borderColor: 'transparent', opacity: xferBusy ? .6 : 1 }} disabled={xferBusy} onClick={submitTransfer}>{xferBusy ? 'Recording…' : 'Request Transfer'}</button>
                  <button className="qbtn" disabled={xferBusy} onClick={() => setXferTarget(null)}>Cancel</button>
                </div>
              </div>
            )}
            {xferOk && <button className="qbtn" style={{ marginTop: 10 }} onClick={() => setXferTarget(null)}>Close</button>}
          </Modal>
        );
      })()}

      {hrsTarget && (() => {
        const ti: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 6, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12.5 };
        return (
          <Modal title={`Operating hours — ${hrsTarget.name}`} onClose={() => setHrsTarget(null)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Branch-local weekly hours. Audit-logged. Times are 24-hour; mark a day closed to clear its hours.</p>
            {hrsOk && <div className="state" style={{ fontSize: 12.5, background: 'var(--ok-bg,#E8F5EC)', color: 'var(--ok,#3E8F57)', border: '1px solid #BFE3C6' }}>{hrsOk}</div>}
            {hrsError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{hrsError}</div>}
            {hrsDays === null && !hrsError ? <div className="state" style={{ fontSize: 12.5 }}>Loading hours…</div> : hrsDays && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 70px 1fr 1fr', gap: '6px 8px', alignItems: 'center', fontSize: 12.5 }}>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>Day</div><div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>Closed</div><div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>Opens</div><div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>Closes</div>
                  {hrsDays.map((d) => (
                    <Fragment key={d.dayOfWeek}>
                      <div>{d.label}</div>
                      <div><input type="checkbox" aria-label={`${d.label} closed`} checked={d.isClosed} onChange={(e) => setHrsDay(d.dayOfWeek, { isClosed: e.target.checked })} /></div>
                      <div><input type="time" aria-label={`${d.label} opens`} style={{ ...ti, opacity: d.isClosed ? .4 : 1 }} disabled={d.isClosed} value={d.opensAt} onChange={(e) => setHrsDay(d.dayOfWeek, { opensAt: e.target.value })} /></div>
                      <div><input type="time" aria-label={`${d.label} closes`} style={{ ...ti, opacity: d.isClosed ? .4 : 1 }} disabled={d.isClosed} value={d.closesAt} onChange={(e) => setHrsDay(d.dayOfWeek, { closesAt: e.target.value })} /></div>
                    </Fragment>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: 'var(--grad,#A96F22)', color: '#fff', borderColor: 'transparent', opacity: hrsBusy ? .6 : 1 }} disabled={hrsBusy} onClick={submitHours}>{hrsBusy ? 'Saving…' : 'Save Hours'}</button>
                  <button className="qbtn" disabled={hrsBusy} onClick={() => setHrsTarget(null)}>Close</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {bulkOpen && (() => {
        const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, marginTop: 4 };
        const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '8px 0 0' };
        const TARGETS = ['active', 'maintenance', 'suspended', 'closing', 'closed'];
        const failed = bulkResults ? bulkResults.filter((r) => !r.ok) : [];
        return (
          <Modal title={`Bulk status — ${sel.size} branch${sel.size === 1 ? '' : 'es'}`} onClose={() => setBulkOpen(false)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Applies a status change to each selected branch. Per-branch transition rules are enforced individually — branches that can't make the change are reported, not forced. Audit-logged.</p>
            {bulkError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{bulkError}</div>}
            {bulkResults ? (
              <div>
                <div className="state" style={{ fontSize: 12.5, background: failed.length ? '#FBF3E7' : 'var(--ok-bg,#E8F5EC)', color: failed.length ? 'var(--gold,#A96F22)' : 'var(--ok,#3E8F57)', border: '1px solid #E5D9C3' }}>{bulkResults.length - failed.length} of {bulkResults.length} updated{failed.length ? `, ${failed.length} skipped` : ''}.</div>
                {failed.length > 0 && (
                  <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 8, fontSize: 12 }}>
                    {failed.map((r) => <div key={r.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}><b>{r.name}</b> — {r.message}</div>)}
                  </div>
                )}
                <button className="qbtn" style={{ marginTop: 12 }} onClick={() => setBulkOpen(false)}>Done</button>
              </div>
            ) : (
              <div>
                <label style={lbl}>Target status *</label>
                <select style={inp} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}><option value="">Select…</option>{TARGETS.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
                <label style={lbl}>Reason *</label>
                <textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} rows={2} style={inp} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="qbtn" style={{ background: 'var(--grad,#A96F22)', color: '#fff', borderColor: 'transparent', opacity: bulkBusy ? .6 : 1 }} disabled={bulkBusy} onClick={submitBulk}>{bulkBusy ? 'Applying…' : `Apply to ${sel.size}`}</button>
                  <button className="qbtn" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {devTarget && (() => {
        return (
          <Modal title={`Devices — ${devTarget.name}`} onClose={() => setDevTarget(null)}>
            <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Tenant device fleet. Allocate a terminal, display, or kiosk to this branch. Leased hardware is tenant-level and not branch-allocatable. Audit-logged.</p>
            {devOk && <div className="state" style={{ fontSize: 12.5, background: 'var(--ok-bg,#E8F5EC)', color: 'var(--ok,#3E8F57)', border: '1px solid #BFE3C6' }}>{devOk}</div>}
            {devError && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: 'var(--danger,#B85B4D)', border: '1px solid #F0C9C2' }}>{devError}</div>}
            {devData === null && !devError ? <div className="state" style={{ fontSize: 12.5 }}>Loading devices…</div> : devData && (
              devData.devices.length === 0 ? <div className="state" style={{ fontSize: 12.5 }}>This tenant has no modelled devices yet.</div> : (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Device</th><th>Category</th><th>Status</th><th>Current branch</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
                    <tbody>
                      {devData.devices.map((d) => (
                        <tr key={`${d.deviceType}-${d.id}`} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ fontWeight: 600 }}>{d.name}</td>
                          <td className="muted">{d.category}</td>
                          <td>{cap(d.status)}</td>
                          <td className="muted">{d.onThisBranch ? <b style={{ color: 'var(--ok,#3E8F57)' }}>This branch</b> : (d.currentBranchName || '—')}</td>
                          <td style={{ textAlign: 'right' }}>
                            {!d.allocatable ? <span className="muted" title="Tenant-level hardware">Not allocatable</span>
                              : d.onThisBranch ? <span className="muted">Allocated</span>
                                : <button className="linkbtn" disabled={devBusyId === d.id} onClick={() => allocateDev(d.id, d.deviceType)}>{devBusyId === d.id ? 'Allocating…' : (d.currentBranchName ? 'Move here' : 'Allocate here')}</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            <button className="qbtn" style={{ marginTop: 12 }} onClick={() => setDevTarget(null)}>Close</button>
          </Modal>
        );
      })()}
    </div>
  );
}
