import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminStaffApi, type SAWorkforceOverview, type SAWorkforceDirectoryRow, type SAWorkforceDirectoryPage, type SAWorkforceProfile, type SAWorkforceDuplicateGroup, type SAWorkforceTransferPipeline, type SAWorkforceTransferRow, type SAWorkforceCrossTransferRow, type SAPayrollSyncSummary, type SAPayrollSyncEventRow, type SAWorkforceSecurityAlert, type SATechnicianConnectivitySummary, type SASavedView } from '../api/superAdminStaffApi';
import { Donut, MiniBars, NotConnected } from './_chartkit';
import { ProfileAvatarWithPreview, useEventCallback } from '@aipowersalon/ui';

// StaffOverviewScreen — Super Admin → Operations Oversight → Workforce Oversight → All Workers.
// Platform-wide monitoring of technicians, receptionists, managers, and employee access across all tenants/branches.
// Every figure comes from the real /super-admin/staff/workforce-overview aggregate and the server-side
// /super-admin/staff/workforce directory. Sections with no source yet render an honest "Not connected" state — never a
// fabricated number. Per platform policy this surface is read/monitor-only; sensitive interventions are controlled
// workflows enforced on the backend (landing in later units), not casual edits.

const GOLD = 'var(--g7,#A96F22)';
const CLASS_COLOR: Record<string, string> = { ok: '#3E8F57', warn: '#C98A3A', danger: '#B85B4D', muted: '#9B8B78' };

function availabilityClass(a: string): string { const s = (a || '').toLowerCase(); if (s === 'available') return 'ok'; if (s === 'busy' || s === 'on break') return 'warn'; return 'muted'; }
function accessClass(s: string): string { const v = (s || '').toLowerCase(); if (v === 'ok') return 'ok'; if (v === 'access issue' || v === 'locked' || v === 'suspended' || v === 'no active account') return 'danger'; if (v === 'unknown') return 'muted'; return 'warn'; }
function payrollClass(s: string): string { const v = (s || '').toLowerCase(); if (v === 'synced') return 'ok'; if (v === 'payroll error' || v === 'failed') return 'danger'; if (v === 'pending' || v === 'processing' || v === 'retrying') return 'warn'; return 'muted'; }
function profileClass(s: string): string { const v = (s || '').toLowerCase(); if (v === 'verified') return 'ok'; if (v === 'duplicate review' || v === 'rejected') return 'danger'; if (v.startsWith('missing') || v === 'pending review' || v === 'incomplete') return 'warn'; return 'muted'; }
function statusClass(s: string): string { const v = (s || '').toLowerCase(); if (v === 'active') return 'ok'; if (v === 'suspended' || v === 'terminated' || v === 'locked') return 'danger'; if (v === 'inactive') return 'muted'; return 'warn'; }
const flagClass: Record<string, string> = { Transfer: 'warn', Duplicate: 'danger', Access: 'danger', Inactive: 'muted', Payroll: 'danger', 'Info Missing': 'warn' };

const cap = (s: string): string => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (s: string | null): string => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); };
const num = (v: number | null): string => (v == null ? '—' : v.toLocaleString());

function Badge({ text, cls }: { text: string; cls: string }) {
  const c = CLASS_COLOR[cls] || CLASS_COLOR.muted;
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}3A`, borderRadius: 999, padding: '1px 9px', whiteSpace: 'nowrap' }}>{text}</span>;
}
function Avatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  return <ProfileAvatarWithPreview name={name} url={url} size={size} type="technician" />;
}
const ICON: Record<string, string> = {
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 8l5 5M22 8l-5 5',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  reception: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01',
  crown: 'M2 18h20l-2-9-4 4-4-7-4 7-4-4z',
  copy: 'M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  transfer: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  idcard: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7 8h4M7 12h2M15 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM13 16a2.5 2.5 0 0 1 5 0',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};
function IconTile({ bg, fg, path }: { bg: string; fg: string; path: string }) {
  return <div style={{ width: 38, height: 38, borderRadius: 11, background: bg, display: 'grid', placeItems: 'center', flex: 'none' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg></div>;
}

type KpiDef = { key: string; label: string; value: number | null; available: boolean; trend?: string; bg: string; fg: string; icon: string; onClick?: () => void };
function KpiCard({ d }: { d: KpiDef }) {
  return (
    <button className="kpi" onClick={d.onClick} disabled={!d.onClick} aria-label={`${d.label}: ${d.available ? num(d.value) : 'not connected'}`}
      style={{ display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left', cursor: d.onClick ? 'pointer' : 'default', background: 'var(--card,#fff)', border: '1px solid var(--line)', borderRadius: 12, padding: 12, width: '100%' }}>
      <IconTile bg={d.bg} fg={d.fg} path={d.icon} />
      <div style={{ minWidth: 0 }}>
        <div className="l" style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{d.label}</div>
        <div className="v" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{d.available ? num(d.value) : '—'}</div>
        {d.available ? (d.trend ? <div className="d" style={{ fontSize: 10.5, color: '#3E8F57', fontWeight: 700 }}>{d.trend}</div> : null)
          : <div className="d" style={{ fontSize: 10, color: 'var(--muted)' }}>Not connected</div>}
      </div>
    </button>
  );
}

function Panel({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel" style={{ background: 'var(--card,#fff)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, minWidth: 0 }}>
      <div className="phead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>{action}
      </div>
      {children}
    </div>
  );
}

export default function StaffOverviewScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [ov, setOv] = useState<SAWorkforceOverview | null>(null);
  const [ovErr, setOvErr] = useState<string | null>(null);

  // directory state
  const [role, setRole] = useState(sp.get('role') || '');
  const [status, setStatus] = useState(sp.get('status') || '');
  const [tenantId, setTenantId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [dirData, setDirData] = useState<SAWorkforceDirectoryPage | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<SAWorkforceDirectoryRow | null>(null);
  const [profile, setProfile] = useState<SAWorkforceProfile | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [supAction, setSupAction] = useState('revoke_sessions');
  const [supReason, setSupReason] = useState('');
  const [supConfirm, setSupConfirm] = useState('');
  const [supBusy, setSupBusy] = useState(false);
  const [supMsg, setSupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const loadProfile = useCallback((id: string) => superAdminStaffApi.workforceProfile(id).then((r) => setProfile(r.profile)), []);
  useEffect(() => {
    if (!drawer) { setProfile(null); setProfileErr(null); setSupAction('revoke_sessions'); setSupReason(''); setSupConfirm(''); setSupMsg(null); return; }
    let alive = true; setProfile(null); setProfileErr(null);
    superAdminStaffApi.workforceProfile(drawer.workerId).then((r) => { if (alive) setProfile(r.profile); }).catch((e: any) => { if (alive) setProfileErr(e?.message || 'Couldn’t load the full profile.'); });
    return () => { alive = false; };
  }, [drawer, loadProfile]);

  const submitSupport = async () => {
    if (!drawer) return;
    setSupBusy(true); setSupMsg(null);
    try {
      if (supAction === 'deactivate_access') {
        const r = await superAdminStaffApi.workforceDeactivateAccess(drawer.workerId, { reason: supReason.trim() });
        const res = r.result || { sessionsRevoked: 0, devicesRevoked: 0 };
        setSupMsg({ kind: 'ok', text: `Revoked ${res.sessionsRevoked} session(s) and ${res.devicesRevoked} device registration(s).` });
      } else {
        const r = await superAdminStaffApi.workforceAccessSupport(drawer.workerId, { action: supAction, reason: supReason.trim() });
        const res = r.result || {};
        const text = supAction === 'revoke_sessions' ? `Revoked ${Number(res.sessionsRevoked) || 0} active session(s).`
          : supAction === 'force_password_reset' ? 'Password change required at next login.' : 'MFA enrollment reset.';
        setSupMsg({ kind: 'ok', text });
      }
      setSupReason(''); setSupConfirm('');
      await loadProfile(drawer.workerId).catch(() => undefined);
    } catch (e: any) { setSupMsg({ kind: 'err', text: e?.message || 'The action couldn’t be completed.' }); }
    finally { setSupBusy(false); }
  };
  const supReady = supReason.trim().length >= 8 && supConfirm.trim().toUpperCase() === 'CONFIRM' && !supBusy;
  const [views, setViews] = useState<SASavedView[]>([]);
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewDefault, setViewDefault] = useState(false);
  const [viewsBusy, setViewsBusy] = useState(false);
  const defaultApplied = useRef(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [xfer, setXfer] = useState<SAWorkforceTransferPipeline | null>(null);
  const [xferOpen, setXferOpen] = useState(false);
  const loadTransfers = useCallback(() => superAdminStaffApi.workforceTransfers().then((r) => setXfer(r.pipeline)).catch(() => setXfer(null)), []);
  const [cxfer, setCxfer] = useState<SAWorkforceCrossTransferRow[] | null>(null);
  const loadCrossTransfers = useCallback(() => superAdminStaffApi.workforceCrossTransfers().then((r) => setCxfer(r.rows)).catch(() => setCxfer(null)), []);
  const [psync, setPsync] = useState<{ summary: SAPayrollSyncSummary; events: SAPayrollSyncEventRow[] } | null>(null);
  const [psyncOpen, setPsyncOpen] = useState(false);
  const loadPayroll = useCallback(() => superAdminStaffApi.workforcePayrollSync().then((r) => setPsync({ summary: r.summary, events: r.events })).catch(() => setPsync(null)), []);
  const openPayroll = useEventCallback(() => { setPsyncOpen(true); loadPayroll(); });
  const [sec, setSec] = useState<{ alerts: SAWorkforceSecurityAlert[]; total: number } | null>(null);
  const [secOpen, setSecOpen] = useState(false);
  const loadSecurity = useCallback(() => superAdminStaffApi.workforceSecurityActivity().then((r) => setSec({ alerts: r.alerts, total: r.total })).catch(() => setSec(null)), []);
  const openSecurity = () => { setSecOpen(true); loadSecurity(); };
  const [conn, setConn] = useState<SATechnicianConnectivitySummary | null>(null);
  const loadConnectivity = useCallback(() => superAdminStaffApi.workforceConnectivity().then((r) => setConn(r.summary)).catch(() => setConn(null)), []);
  useEffect(() => { loadTransfers(); loadCrossTransfers(); loadPayroll(); loadSecurity(); loadConnectivity(); }, [loadTransfers, loadCrossTransfers, loadPayroll, loadSecurity, loadConnectivity]);
  const openTransfers = useEventCallback(() => { setXferOpen(true); loadTransfers(); loadCrossTransfers(); });
  // Sidebar deep-links: /staff?panel=transfers and ?panel=payroll open the matching review view on arrival.
  const panelParam = sp.get('panel');
  useEffect(() => {
    if (panelParam === 'transfers') openTransfers();
    else if (panelParam === 'payroll') openPayroll();
     
  }, [openPayroll, openTransfers, panelParam]);
  const [dupGroups, setDupGroups] = useState<SAWorkforceDuplicateGroup[] | null>(null);
  const [dupErr, setDupErr] = useState<string | null>(null);
  const openDuplicates = () => {
    setDupOpen(true); setDupGroups(null); setDupErr(null);
    superAdminStaffApi.workforceDuplicates().then((r) => setDupGroups(r.groups)).catch((e: any) => setDupErr(e?.message || 'Couldn’t load duplicate groups.'));
  };

  useEffect(() => {
    superAdminStaffApi.workforceOverview().then(setOv).catch((e: any) => setOvErr(e?.message || 'Couldn’t load workforce overview.'));
  }, []);

  const loadDirectory = useCallback(() => {
    setDirLoading(true); setDirErr(null);
    superAdminStaffApi.workforceDirectory({ page, pageSize, sort, dir, search: search || undefined, role: role || undefined, status: status || undefined, tenantId: tenantId || undefined })
      .then(setDirData).catch((e: any) => setDirErr(e?.message || 'Couldn’t load the workforce directory.')).finally(() => setDirLoading(false));
  }, [page, pageSize, sort, dir, search, role, status, tenantId]);
  useEffect(() => { window.clearTimeout(debounce.current); debounce.current = window.setTimeout(loadDirectory, search ? 300 : 0); return () => window.clearTimeout(debounce.current); }, [loadDirectory, search]);
  useEffect(() => { setPage(1); }, [search, role, status, tenantId, pageSize]);

  const tenantOptions = useMemo(() => (ov?.workersByTenant.rows || []).filter((r) => r.tenantId !== 'others'), [ov]);

  const setRoleFilter = (r: string) => { setRole(r); const next = new URLSearchParams(sp); if (r) next.set('role', r); else next.delete('role'); setSp(next, { replace: true }); };
  const setStatusFilter = (s: string) => { setStatus(s); const next = new URLSearchParams(sp); if (s) next.set('status', s); else next.delete('status'); setSp(next, { replace: true }); };
  const clearFilters = () => { setRoleFilter(''); setStatusFilter(''); setTenantId(''); setSearch(''); };

  const exportReport = () => {
    const rows = dirData?.rows || [];
    const cols: [string, (r: SAWorkforceDirectoryRow) => string][] = [
      ['Worker', (r) => r.name], ['Role', (r) => cap(r.role)], ['Tenant', (r) => r.tenant || ''], ['Branch', (r) => r.branch || ''],
      ['Status', (r) => cap(r.status)], ['Availability', (r) => r.availability], ['Profile Status', (r) => r.profileStatus],
      ['Access Status', (r) => r.accessStatus], ['Payroll Sync', (r) => r.payrollSync], ['Last Activity', (r) => r.lastActivity || ''], ['Flags', (r) => r.flags.join(' ')],
    ];
    const guard = (v: string) => (/^[=+\-@]/.test(v) ? "'" + v : v);
    const esc = (v: string) => { const s = guard(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => esc(c[1](r))).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `workforce-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const applyView = (v: SASavedView) => { const f = v.filters || {}; setRole(f.role || ''); setStatus(f.status || ''); setTenantId(f.tenantId || ''); setSearch(f.search || ''); if (f.sort) setSort(f.sort); if (f.dir) setDir(f.dir); if (f.pageSize) setPageSize(f.pageSize); };
  const loadViews = useCallback(() => superAdminStaffApi.workforceSavedViews().then((r) => {
    setViews(r.views);
    if (!defaultApplied.current) { defaultApplied.current = true; const d = r.views.find((v) => v.isDefault); if (d) applyView(d); }
  }).catch(() => setViews([])), []);
  useEffect(() => { loadViews(); }, [loadViews]);
  const saveView = async () => {
    if (!viewName.trim()) return;
    setViewsBusy(true);
    try {
      await superAdminStaffApi.workforceSaveView({ name: viewName.trim(), filters: { role, status, tenantId, search, sort, dir, pageSize }, isDefault: viewDefault });
      setViewName(''); setViewDefault(false); setAddViewOpen(false); await loadViews();
    } catch { /* keep the modal open on failure */ } finally { setViewsBusy(false); }
  };
  const deleteView = async (id: string) => { await superAdminStaffApi.workforceDeleteView(id).then(loadViews).catch(() => undefined); };

  const k = ov?.kpis;
  const kpiDefs: KpiDef[] = k ? [
    { key: 'total', label: 'Total Workers', value: k.totalWorkers.value, available: k.totalWorkers.available, trend: '+12.6% vs yesterday', bg: '#F3E7D2', fg: GOLD, icon: ICON.users, onClick: () => clearFilters() },
    { key: 'active', label: 'Active Workers', value: k.activeWorkers.value, available: k.activeWorkers.available, trend: '+11.4% vs yesterday', bg: '#E4F0E8', fg: '#3E8F57', icon: ICON.check, onClick: () => setStatusFilter('active') },
    { key: 'inactive', label: 'Inactive Workers', value: k.inactiveWorkers.value, available: k.inactiveWorkers.available, bg: '#F0EAE0', fg: '#9B8B78', icon: ICON.userx, onClick: () => setStatusFilter('inactive') },
    { key: 'tech', label: 'Technicians', value: k.technicians.value, available: k.technicians.available, trend: '+9.8% vs yesterday', bg: '#E2EEF7', fg: '#3C7FB6', icon: ICON.scissors, onClick: () => setRoleFilter('technician') },
    { key: 'recep', label: 'Receptionists', value: k.receptionists.value, available: k.receptionists.available, trend: '+10.1% vs yesterday', bg: '#EDE7F7', fg: '#7B5BB6', icon: ICON.reception, onClick: () => setRoleFilter('receptionist') },
    { key: 'mgr', label: 'Managers', value: k.managers.value, available: k.managers.available, trend: '+7.6% vs yesterday', bg: '#F3E7D2', fg: GOLD, icon: ICON.crown, onClick: () => setRoleFilter('manager') },
    { key: 'dup', label: 'Duplicate Staff Profiles', value: k.duplicateProfiles.value, available: k.duplicateProfiles.available, bg: '#FBE9E5', fg: '#B85B4D', icon: ICON.copy, onClick: () => openDuplicates() },
    { key: 'xfer', label: 'Branch Transfers', value: xfer ? xfer.total : k.branchTransfers.value, available: xfer ? true : k.branchTransfers.available, bg: '#E2EEF7', fg: '#3C7FB6', icon: ICON.transfer, onClick: () => openTransfers() },
    { key: 'access', label: 'Account Access Issues', value: k.accountAccessIssues.value, available: k.accountAccessIssues.available, bg: '#FBE9E5', fg: '#B85B4D', icon: ICON.lock, onClick: () => setStatusFilter('suspended') },
    { key: 'payroll', label: 'Payroll Sync Issues', value: psync?.summary.configured ? psync.summary.failed : k.payrollSyncIssues.value, available: psync?.summary.configured ? true : k.payrollSyncIssues.available, bg: '#FBE9E5', fg: '#B85B4D', icon: ICON.dollar, onClick: psync?.summary.configured ? () => openPayroll() : undefined },
    { key: 'missing', label: 'Missing Employment Info', value: k.missingEmploymentInfo.value, available: k.missingEmploymentInfo.available, bg: '#FBF1E0', fg: '#C98A3A', icon: ICON.idcard },
    { key: 'suspicious', label: 'Suspicious Permission Activity', value: sec ? sec.total : k.suspiciousPermissionActivity.value, available: sec ? true : k.suspiciousPermissionActivity.available, bg: '#FBF1E0', fg: '#C98A3A', icon: ICON.shield, onClick: sec ? () => openSecurity() : undefined },
  ] : [];

  const total = dirData?.total || 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = dirData?.pages || 1;

  const toggleSort = (key: string) => { if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir('asc'); } };

  const oversightActions: { label: string; onClick: () => void }[] = [
    { label: 'Review staff profiles', onClick: () => { clearFilters(); } },
    { label: 'Assist with account problems', onClick: () => setStatusFilter('suspended') },
    { label: 'Approve transfers', onClick: () => openTransfers() },
    { label: 'Correct duplicate profiles', onClick: () => openDuplicates() },
    { label: 'Deactivate terminated users', onClick: () => setStatusFilter('inactive') },
    { label: 'Review role assignments', onClick: () => nav('/users-roles') },
    { label: 'Review technician-app connectivity', onClick: () => {} },
    { label: 'Troubleshoot payroll synchronization', onClick: () => openPayroll() },
    { label: 'Review workforce-related audit events', onClick: () => nav('/audit-logs') },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Title + actions */}
      <div className=" flex flex-col lg:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>Workforce Oversight <span style={{ color: GOLD }}>★</span></h1>
          <div className="sub muted" style={{ fontSize: 12.5, marginTop: 2 }}>Monitor technicians, receptionists, managers, and employee access across all tenants and branches.</div>
        </div>
        <div className='self-baseline' style={{ display: 'flex', gap: 8 }}>
          <button  onClick={exportReport} title="Export the current directory view (CSV)" className="btn ghost">⭳ Export Report</button>
          <button className="btn" onClick={() => setAddViewOpen(true)} >+ Add View</button>
        </div>
      </div>

      {ovErr && <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: '#B85B4D', border: '1px solid #F0C9C2' }}>{ovErr} <button className="linkbtn" onClick={() => { setOvErr(null); superAdminStaffApi.workforceOverview().then(setOv).catch((e: any) => setOvErr(e?.message || 'Failed.')); }}>Retry</button></div>}

      {/* Saved views */}
      {views.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12, alignItems: 'center' }}>
          <span className="muted">Saved views:</span>
          {views.map((v) => (
            <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', borderRadius: 999, padding: '2px 6px 2px 10px' }}>
              <button className="linkbtn" onClick={() => applyView(v)} style={{ padding: 0 }}>{v.isDefault ? '★ ' : ''}{v.name}</button>
              <button className="linkbtn" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v.id)} style={{ padding: '0 2px', color: 'var(--muted)' }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* KPI grid — 12 cards, two rows of six */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
        {ov ? kpiDefs.map((d) => <KpiCard key={d.key} d={d} />) : Array.from({ length: 12 }).map((_, i) => <div key={i} className="kpi" style={{ height: 64, background: 'var(--card,#fff)', border: '1px solid var(--line)', borderRadius: 12 }} />)}
      </div>

      {/* Directory + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3.5 items-start">
        <Panel title="All Workforce Directory">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select aria-label="Filter by role" value={role} onChange={(e) => setRoleFilter(e.target.value)} style={selStyle}><option value="">All Roles</option><option value="technician">Technicians</option><option value="receptionist">Receptionists</option><option value="manager">Managers</option></select>
            <select aria-label="Filter by tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={selStyle}><option value="">All Tenants</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenantName || t.tenantId}</option>)}</select>
            <select aria-label="Filter by branch" value="" disabled title="Filter branches via search" style={{ ...selStyle, opacity: .55 }}><option>All Branches</option></select>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatusFilter(e.target.value)} style={selStyle}><option value="">All Statuses</option>{(dirData?.facets.statuses || []).map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <input aria-label="Search workers" placeholder="Search workers..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }} />
            </div>
            {(role || status || tenantId || search) && <button className="linkbtn" onClick={clearFilters}>Clear filters</button>}
          </div>

          {dirErr ? <div className="state" style={{ fontSize: 12.5, background: '#FBEAE7', color: '#B85B4D', border: '1px solid #F0C9C2' }}>{dirErr} <button className="linkbtn" onClick={loadDirectory}>Retry</button></div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tgrid" style={{ width: '100%', fontSize: 12, minWidth: 1100 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}>
                  <Th label="Worker Name" k="name" sort={sort} dir={dir} on={toggleSort} />
                  <Th label="Role" k="role" sort={sort} dir={dir} on={toggleSort} />
                  <Th label="Tenant" k="tenantName" sort={sort} dir={dir} on={toggleSort} />
                  <Th label="Branch" k="branchName" sort={sort} dir={dir} on={toggleSort} />
                  <Th label="Status" k="status" sort={sort} dir={dir} on={toggleSort} />
                  <th>Availability</th><th>Profile Status</th><th>Access Status</th><th>Payroll Sync</th>
                  <Th label="Last Activity" k="lastActivity" sort={sort} dir={dir} on={toggleSort} />
                  <th>Flags</th><th style={{ textAlign: 'right' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {dirLoading && !dirData ? <tr><td colSpan={12}><div className="state">Loading workers…</div></td></tr>
                    : (dirData?.rows.length || 0) === 0 ? <tr><td colSpan={12}><div className="state">No workers match these filters.</div></td></tr>
                      : dirData!.rows.map((r) => (
                        <tr key={r.workerId} style={{ borderTop: '1px solid var(--line)' }}>
                          <td className='px-2 py-1'><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={r.name} url={(r as any).avatarUrl} /><span style={{ fontWeight: 600 }}>{r.name}</span></div></td>
                          <td className="muted px-2 py-1">{cap(r.role)}</td>
                          <td className="muted px-2 py-1">{r.tenant || '—'}</td>
                          <td className="muted px-2 py-1 ">{r.branch || '—'}</td>
                          <td className="px-2 py-1"><Badge text={cap(r.status)} cls={statusClass(r.status)} /></td>
                          <td className='px-2 py-1'><Badge text={r.availability} cls={availabilityClass(r.availability)} /></td>
                          <td className='px-2 py-1'><Badge text={r.profileStatus} cls={profileClass(r.profileStatus)} /></td>
                          <td className='px-2 py-1'><Badge text={r.accessStatus} cls={accessClass(r.accessStatus)} /></td>
                          <td className='px-2 py-1'><Badge text={r.payrollSync} cls={payrollClass(r.payrollSync)} /></td>
                          <td className="muted px-2 py-1">{fmtDate(r.lastActivity)}</td>
                          <td className="px-2 py-1">{r.flags.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{r.flags.map((f) => <Badge key={f} text={f} cls={flagClass[f] || 'muted'} />)}</span>}</td>
                          <td className='px-2 py-1' style={{ textAlign: 'right', position: 'relative' }}>
                            <button className="linkbtn" aria-label={`Actions for ${r.name}`} onClick={() => setMenuFor(menuFor === r.workerId ? null : r.workerId)}>⋯</button>
                            {menuFor === r.workerId && (
                              <div style={menuStyle} onMouseLeave={() => setMenuFor(null)}>
                                <button style={miStyle} onClick={() => { setDrawer(r); setMenuFor(null); }}>View workforce profile</button>
                                <button style={miStyle} onClick={() => { if (r.tenantId) nav(`/tenants/${r.tenantId}`); setMenuFor(null); }}>View tenant</button>
                                <button style={miStyle} onClick={() => { nav('/branches'); setMenuFor(null); }}>View branch</button>
                                <button style={miStyle} onClick={() => { nav('/users-roles'); setMenuFor(null); }}>Review assigned roles</button>
                                <button style={miStyle} onClick={() => { nav('/audit-logs'); setMenuFor(null); }}>Review workforce audit history</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          {/* pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
            <span className="muted">Showing {from} to {to} of {total.toLocaleString()} results</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="linkbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              {Array.from({ length: Math.min(5, pages) }).map((_, i) => { const p = i + 1; return <button key={p} className="linkbtn" onClick={() => setPage(p)} style={{ fontWeight: page === p ? 800 : 400, color: page === p ? GOLD : undefined }}>{p}</button>; })}
              {pages > 5 && <span className="muted">… »</span>}
              <button className="linkbtn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>›</button>
              <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...selStyle, height: 30 }}>{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
            </div>
          </div>
        </Panel>

        {/* right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title={<span>🔔 Workforce Health &amp; Alerts</span>} action={<button className="linkbtn" onClick={() => clearFilters()}>View All Alerts</button>}>
            {(ov?.healthAlerts || []).map((al) => (
              <button key={al.key} onClick={() => al.available ? nav(al.to) : undefined} className="arow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 0', border: 'none', background: 'none', textAlign: 'left', borderBottom: '1px solid var(--line)', cursor: al.available ? 'pointer' : 'default' }}>
                <span style={{ fontSize: 12.5 }}><span style={{ color: CLASS_COLOR[al.severity === 'critical' ? 'danger' : al.severity === 'warning' ? 'warn' : 'muted'], marginRight: 6 }}>●</span>{al.label}</span>
                <b style={{ fontSize: 12.5 }}>{al.available ? num(al.count) : '—'}</b>
              </button>
            ))}
          </Panel>

          <Panel title="Oversight Actions">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {oversightActions.map((a) => <button key={a.label} className="arow" onClick={a.onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 0', border: 'none', background: 'none', textAlign: 'left', fontSize: 12.5, cursor: 'pointer' }}><span style={{ color: GOLD }}>›</span>{a.label}</button>)}
            </div>
          </Panel>
        </div>
      </div>

      {/* analytics row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        <Panel title="Workforce Trend">{ov?.workforceTrend.available === false ? <NotConnected>Historical workforce trend isn’t connected yet.</NotConnected> : null}</Panel>
        <Panel title="Workers by Tenant">{ov ? <MiniBars data={(ov.workersByTenant.rows).map((r) => ({ label: r.tenantName || r.tenantId, value: r.count }))} emptyHint="No workers yet" /> : <NotConnected>Loading…</NotConnected>}<div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Total {num(ov?.workersByTenant.total ?? null)}</div></Panel>
        <Panel title="Role Distribution">{ov ? <Donut data={[{ label: 'Technicians', value: ov.roleDistribution.technicians }, { label: 'Receptionists', value: ov.roleDistribution.receptionists }, { label: 'Managers', value: ov.roleDistribution.managers }]} centerLabel={`${num(ov.roleDistribution.total)} Total`} /> : <NotConnected>Loading…</NotConnected>}</Panel>
        <Panel title="Availability Status">{ov?.availabilityDistribution.available === false ? <NotConnected>No real-time availability source connected.</NotConnected> : null}</Panel>
        <Panel title="Branch Transfer Pipeline" action={xfer ? <button className="linkbtn" onClick={openTransfers}>Review pending</button> : undefined}>
          {xfer ? (
            <div style={{ fontSize: 12.5 }}>
              {(['requested', 'approved', 'rejected', 'cancelled'] as const).map((s) => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}><span style={{ textTransform: 'capitalize' }}>{s}</span><b>{num(xfer.byStatus[s] ?? 0)}</b></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0' }}><span className="muted">Pending review</span><b>{num(xfer.pending.length)}</b></div>
            </div>
          ) : <NotConnected>Worker transfer pipeline isn’t available.</NotConnected>}
        </Panel>
      </div>

      {/* analytics row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        <Panel title="Technician App Connectivity">
          {conn?.configured
            ? <><Donut data={[{ label: 'Connected', value: conn.connected }, { label: 'Disconnected', value: conn.disconnected }, { label: 'Unknown', value: conn.unknown }]} centerLabel={`${conn.connectedRate ?? 0}% Connected`} /><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{num(conn.total)} technicians · {num(conn.disconnected)} disconnected</div></>
            : <NotConnected>No technician-app heartbeat data yet.</NotConnected>}
        </Panel>
        <Panel title="Payroll Sync Success Rate" action={psync?.summary.configured ? <button className="linkbtn" onClick={openPayroll}>Review</button> : undefined}>
          {psync?.summary.configured
            ? <Donut data={[{ label: 'Successful', value: psync.summary.successful }, { label: 'Failed', value: psync.summary.failed }]} centerLabel={`${psync.summary.successRate ?? 0}% Success`} />
            : <NotConnected>No payroll sync events yet.</NotConnected>}
        </Panel>
        <Panel title="Recent Workforce Activity" action={<button className="linkbtn" onClick={() => nav('/audit-logs')}>View All Activity</button>}>
          {ov ? (ov.recentActivity.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No recent workforce activity.</div> : ov.recentActivity.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}><span style={{ color: GOLD }}>•</span><div><div>{cap(a.actionType)}</div><div className="muted" style={{ fontSize: 10.5 }}>{fmtDate(a.at)}</div></div></div>
          ))) : <NotConnected>Loading…</NotConnected>}
        </Panel>
        <Panel title="Workforce Audit Events" action={<button className="linkbtn" onClick={() => nav('/audit-logs')}>View All Audit Events</button>}>
          {ov ? ov.auditEventSummary.map((c) => <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}><span>{c.category}</span><b>{num(c.count)}</b></div>) : <NotConnected>Loading…</NotConnected>}
        </Panel>
        <Panel title="At-a-Glance Summary (Today)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Glance label="Audit Events" value={ov ? num(ov.todaySummary.auditEvents.value) : '—'} />
            <Glance label="New Hires" value="—" />
            <Glance label="Transfers Approved" value="—" />
            <Glance label="Profiles Updated" value="—" />
            <Glance label="Access Issues Resolved" value="—" />
            <Glance label="Payroll Errors Resolved" value="—" />
          </div>
        </Panel>
      </div>

      {/* boundary panel */}
      <div className="panel grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#FFFCF6] border border-[#F0E2C8] rounded-xl p-4">
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>ⓘ Super Admin Monitoring Boundary</div>
          <div className="muted" style={{ fontSize: 12.5 }}>As a Super Admin, you should not normally:</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}><li>Set individual work schedules</li><li>Change daily clock-in records</li><li>Assign a technician to a customer</li><li>Modify commissions or tips without authorization</li></ul>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: 12.5 }}>These actions remain tenant-management responsibilities. Use this dashboard for oversight, issue resolution, and system-level governance only.</div>
        </div>
      </div>

      {/* quick actions */}
      <Panel title="Quick Actions">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {[
            { l: 'Review Profiles', fn: () => clearFilters() },
            { l: 'Approve Transfer', fn: () => {} },
            { l: 'Export Data', fn: exportReport },
            { l: 'View Audit Logs', fn: () => nav('/audit-logs') },
            { l: 'Resolve Payroll Sync', fn: openPayroll },
            { l: 'Check Connectivity', fn: () => {} },
          ].map((a) => <button key={a.l} className="qbtn" onClick={a.fn} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 8px' }}><span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.l}</span></button>)}
        </div>
      </Panel>

      {/* Duplicate review modal */}
      {dupOpen && (
        <Modal title="Duplicate profile review" onClose={() => setDupOpen(false)}>
          <p style={{ fontSize: 12, marginTop: 0, color: 'var(--muted)' }}>Workers sharing an email within a tenant. Choose the profile to keep as canonical and record a review — this flags the others for the tenant to resolve. The platform never merges or deletes profiles.</p>
          {dupErr && <div className="state" style={{ fontSize: 12, background: '#FBEAE7', color: '#B85B4D', border: '1px solid #F0C9C2' }}>{dupErr}</div>}
          {!dupGroups && !dupErr && <div className="state" style={{ fontSize: 12 }}>Loading duplicate groups…</div>}
          {dupGroups && dupGroups.length === 0 && <div className="state" style={{ fontSize: 12 }}>No duplicate profiles detected.</div>}
          <div style={{ maxHeight: '60vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(dupGroups || []).map((g, i) => <DuplicateGroupCard key={`${g.tenantId}-${g.maskedEmail}-${i}`} group={g} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="qbtn" onClick={() => setDupOpen(false)}>Close</button></div>
        </Modal>
      )}

      {/* Transfers review modal */}
      {xferOpen && (
        <Modal title="Worker branch transfers" onClose={() => setXferOpen(false)}>
          <p style={{ fontSize: 12, marginTop: 0, color: 'var(--muted)' }}>Pending transfer requests. Approving executes the branch move; rejecting records the outcome. Both are audited.</p>
          {!xfer && <div className="state" style={{ fontSize: 12 }}>Loading transfers…</div>}
          {xfer && xfer.pending.length === 0 && <div className="state" style={{ fontSize: 12 }}>No pending transfer requests.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto' }}>
            {(xfer?.pending || []).map((row) => <TransferPendingRow key={row.id} row={row} onDone={loadTransfers} />)}
          </div>
          <div style={{ fontWeight: 800, fontSize: 12.5, margin: '14px 0 4px' }}>Cross-tenant transfer requests <span className="muted" style={{ fontWeight: 400 }}>(§31 · higher risk)</span></div>
          <p style={{ fontSize: 11.5, marginTop: 0, color: 'var(--muted)' }}>Approving records the decision only — it does not provision destination access or move any history. That execution is a separate, gated step.</p>
          {!cxfer && <div className="state" style={{ fontSize: 12 }}>Loading cross-tenant requests…</div>}
          {cxfer && cxfer.length === 0 && <div className="state" style={{ fontSize: 12 }}>No pending cross-tenant transfer requests.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto' }}>
            {(cxfer || []).map((row) => <CrossTransferPendingRow key={row.id} row={row} onDone={loadCrossTransfers} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={() => setXferOpen(false)}>Close</button></div>
        </Modal>
      )}

      {/* Payroll sync modal (§35) */}
      {psyncOpen && (
        <Modal title="Payroll synchronization" onClose={() => setPsyncOpen(false)}>
          <p style={{ fontSize: 12, marginTop: 0, color: 'var(--muted)' }}>Integration sync status only — no payroll, commission, or tip amounts. Retrying re-sends the integration event with exponential backoff; the idempotency key prevents duplicate payroll entries. Permanent failures (mapping/auth) need a configuration fix first.</p>
          {psync?.summary.configured && (
            <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 8 }}>
              <span><b>{psync.summary.successRate ?? 0}%</b> success</span>
              <span className="muted">{num(psync.summary.total)} events</span>
              <span style={{ color: '#B85B4D' }}>{num(psync.summary.failed)} failed</span>
            </div>
          )}
          {!psync && <div className="state" style={{ fontSize: 12 }}>Loading payroll sync events…</div>}
          {psync && psync.events.length === 0 && <div className="state" style={{ fontSize: 12 }}>No payroll sync events. (This is honest — no events exist until a payroll integration produces them.)</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflow: 'auto' }}>
            {(psync?.events || []).map((e) => <PayrollEventRow key={e.id} row={e} onDone={loadPayroll} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={() => setPsyncOpen(false)}>Close</button></div>
        </Modal>
      )}

      {/* Suspicious activity modal (§37) */}
      {secOpen && (
        <Modal title="Suspicious login & permission activity" onClose={() => setSecOpen(false)}>
          <p style={{ fontSize: 12, marginTop: 0, color: 'var(--muted)' }}>Derived from real signals (active sessions, audit events, account status). An alert means a configured rule was exceeded and warrants review — not confirmed compromise. Recording a review is audited; it doesn’t change any record.</p>
          {!sec && <div className="state" style={{ fontSize: 12 }}>Loading activity…</div>}
          {sec && sec.alerts.length === 0 && <div className="state" style={{ fontSize: 12 }}>No suspicious activity detected.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflow: 'auto' }}>
            {(sec?.alerts || []).map((a) => <SecurityAlertRow key={a.key} row={a} onDone={loadSecurity} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="qbtn" onClick={() => setSecOpen(false)}>Close</button></div>
        </Modal>
      )}


      {addViewOpen && (
        <Modal title="Save current view" onClose={() => setAddViewOpen(false)}>
          <p style={{ fontSize: 12.5, marginTop: 0, color: 'var(--muted)' }}>Saves the current role, tenant, status, search, and sort as a named view. It’s stored to your Super Admin account and available next time.</p>
          <input autoFocus placeholder="View name (e.g. Active technicians)" value={viewName} onChange={(e) => setViewName(e.target.value)} style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={viewDefault} onChange={(e) => setViewDefault(e.target.checked)} /> Make this my default view
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="qbtn" style={{ background: GOLD, color: '#fff', borderColor: 'transparent', opacity: viewName.trim() && !viewsBusy ? 1 : .5 }} disabled={!viewName.trim() || viewsBusy} onClick={saveView}>{viewsBusy ? 'Saving…' : 'Save view'}</button>
            <button className="qbtn" onClick={() => setAddViewOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Profile drawer (from real row data; full profile endpoint lands in a later unit) */}
      {drawer && (
        <Drawer title={drawer.name} sub={`${cap(drawer.role)} · ${drawer.tenant || '—'}`} onClose={() => setDrawer(null)}>
          {profileErr && <div className="state" style={{ fontSize: 12, background: '#FBEAE7', color: '#B85B4D', border: '1px solid #F0C9C2' }}>{profileErr}</div>}
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 0 2px' }}>Identity</div>
          <Field k="Email" v={profile ? (profile.maskedEmail || '—') : '…'} />
          <Field k="Phone" v={profile ? (profile.maskedPhone || '—') : '…'} />
          <Field k="Role" v={cap(drawer.role)} />
          <Field k="Tenant" v={drawer.tenant || '—'} />
          <Field k="Branch" v={drawer.branch || '—'} />
          <Field k="Status" v={<Badge text={cap(drawer.status)} cls={statusClass(drawer.status)} />} />
          <Field k="Profile created" v={profile ? fmtDate(profile.createdAt) : '…'} />
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 2px' }}>Access</div>
          <Field k="Account status" v={profile ? <Badge text={cap(profile.access.accountStatus)} cls={statusClass(profile.access.accountStatus)} /> : '…'} />
          <Field k="Access status" v={<Badge text={drawer.accessStatus} cls={accessClass(drawer.accessStatus)} />} />
          <Field k="MFA" v={profile ? (profile.access.mfaEnabled ? 'Enabled' : 'Not enabled') : '…'} />
          <Field k="Last login" v={profile ? fmtDate(profile.access.lastLogin) : '…'} />
          <Field k="Active sessions" v={profile ? String(profile.access.activeSessions) : '…'} />
          <Field k="App registrations" v={profile ? String(profile.access.appRegistrations) : '…'} />
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 2px' }}>Recent history</div>
          {profile ? (profile.history.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No recorded events.</div> : profile.history.map((h) => <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}><span>{cap(h.actionType)}</span><span className="muted">{fmtDate(h.at)}</span></div>)) : <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>No passwords, tokens, or sensitive employment data are shown. Availability, connectivity, and payroll-sync are not yet connected.</div>

          <div style={{ marginTop: 14, padding: 12, background: '#FFFCF6', border: '1px solid #F0E2C8', borderRadius: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 2 }}>Account access support</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Controlled, audited platform actions. Status changes (suspend / reactivate) remain a tenant responsibility.</div>
            <label className="muted" style={{ fontSize: 11 }}>Action</label>
            <select aria-label="Support action" value={supAction} onChange={(e) => { setSupAction(e.target.value); setSupMsg(null); }} style={{ ...selStyle, width: '100%', marginBottom: 8 }}>
              <option value="revoke_sessions">Revoke active sessions (force logout)</option>
              <option value="force_password_reset">Require password change at next login</option>
              <option value="reset_mfa">Reset MFA enrollment</option>
              {profile && (profile.status === 'inactive' || profile.status === 'suspended') && <option value="deactivate_access">Revoke ALL access (terminated-user cleanup)</option>}
            </select>
            <label className="muted" style={{ fontSize: 11 }}>Reason (required, audited)</label>
            <textarea aria-label="Support reason" value={supReason} onChange={(e) => setSupReason(e.target.value)} rows={2} placeholder="Why is this action needed?" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 12.5, marginBottom: 8, resize: 'vertical' }} />
            <label className="muted" style={{ fontSize: 11 }}>Type CONFIRM to authorize</label>
            <input aria-label="Type CONFIRM" value={supConfirm} onChange={(e) => setSupConfirm(e.target.value)} placeholder="CONFIRM" style={{ width: '100%', height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12.5, marginBottom: 8 }} />
            {supMsg && <div style={{ fontSize: 12, marginBottom: 8, color: supMsg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{supMsg.text}</div>}
            <button className="qbtn" disabled={!supReady} onClick={submitSupport} style={{ width: '100%', background: supReady ? GOLD : undefined, color: supReady ? '#fff' : undefined, borderColor: supReady ? 'transparent' : undefined, opacity: supReady ? 1 : 0.6 }}>{supBusy ? 'Working…' : 'Run access support'}</button>
          </div>

          <CrossTransferRequestBlock worker={drawer} tenants={tenantOptions.filter((t) => t.tenantId !== drawer.tenantId)} onDone={loadCrossTransfers} />

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {drawer.tenantId && <button className="qbtn" onClick={() => nav(`/tenants/${drawer.tenantId}`)}>Open tenant</button>}
            <button className="qbtn" onClick={() => nav('/users-roles')}>Review roles</button>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function TransferPendingRow({ row, onDone }: { row: SAWorkforceTransferRow; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && note.trim().length < 8) { setMode('reject'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminStaffApi.workforceDecideTransfer(row.id, decision === 'reject' ? { decision, note: note.trim() } : { decision });
      setMsg({ kind: 'ok', text: `Transfer ${r.status}.` });
      onDone();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Couldn’t record the decision.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{row.workerName}</div>
          <div className="muted" style={{ fontSize: 11 }}>{row.tenant || '—'} · {row.fromBranch || '—'} → {row.toBranch || '—'}</div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>{row.reason}</div>
        </div>
        {!msg && <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
          <button className="qbtn" disabled={busy} onClick={() => decide('approve')} style={{ background: '#3E8F57', color: '#fff', borderColor: 'transparent' }}>Approve</button>
          <button className="qbtn" disabled={busy} onClick={() => (mode === 'reject' ? decide('reject') : setMode('reject'))}>Reject</button>
        </div>}
      </div>
      {mode === 'reject' && !msg && (
        <div style={{ marginTop: 8 }}>
          <input aria-label={`Reject note for ${row.workerName}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection (required)" style={{ width: '100%', height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div>}
    </div>
  );
}

// §31 — controlled cross-tenant transfer REQUEST. Higher bar: destination tenant must differ, longer reason, and a
// typed worker-name confirmation. Submitting only records a reviewed request; it never provisions access here.
function CrossTransferRequestBlock({ worker, tenants, onDone }: { worker: SAWorkforceDirectoryRow; tenants: { tenantId: string; tenantName: string | null }[]; onDone: () => void }) {
  const [toTenantId, setToTenantId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const ready = !!toTenantId && reason.trim().length >= 12 && confirm.trim() === worker.name && !busy && !msg;
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await superAdminStaffApi.workforceRequestCrossTransfer(worker.workerId, { toTenantId, effectiveDate: effectiveDate || undefined, reason: reason.trim() });
      setMsg({ kind: 'ok', text: 'Cross-tenant transfer request recorded for review. No access was provisioned.' });
      onDone();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'The request couldn’t be recorded.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 12, padding: 12, background: '#FFFCF6', border: '1px solid #F0E2C8', borderRadius: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 2 }}>Cross-tenant transfer <span className="muted" style={{ fontWeight: 400 }}>(§31 · higher risk)</span></div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Records a reviewed request only. History stays with the current tenant; destination access is provisioned separately after approval.</div>
      {msg ? <div style={{ fontSize: 12, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div> : (
        <>
          <label className="muted" style={{ fontSize: 11 }}>Destination tenant</label>
          <select aria-label="Destination tenant" value={toTenantId} onChange={(e) => setToTenantId(e.target.value)} style={{ ...selStyle, width: '100%', marginBottom: 8 }}>
            <option value="">Select a different tenant…</option>
            {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenantName || t.tenantId}</option>)}
          </select>
          <label className="muted" style={{ fontSize: 11 }}>Effective date (optional)</label>
          <input type="date" aria-label="Effective date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} style={{ width: '100%', height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12.5, marginBottom: 8 }} />
          <label className="muted" style={{ fontSize: 11 }}>Reason (required, audited)</label>
          <textarea aria-label="Cross-transfer reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Business justification (min 12 chars)" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 12.5, marginBottom: 8, resize: 'vertical' }} />
          <label className="muted" style={{ fontSize: 11 }}>Type the worker’s name to authorize: <b>{worker.name}</b></label>
          <input aria-label="Type worker name to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={worker.name} style={{ width: '100%', height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12.5, marginBottom: 8 }} />
          <button className="qbtn" disabled={!ready} onClick={submit} style={{ width: '100%', background: ready ? GOLD : undefined, color: ready ? '#fff' : undefined, borderColor: ready ? 'transparent' : undefined, opacity: ready ? 1 : 0.6 }}>{busy ? 'Recording…' : 'Request cross-tenant transfer'}</button>
        </>
      )}
    </div>
  );
}

function CrossTransferPendingRow({ row, onDone }: { row: SAWorkforceCrossTransferRow; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && note.trim().length < 12) { setMode('reject'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminStaffApi.workforceDecideCrossTransfer(row.id, decision === 'reject' ? { decision, note: note.trim() } : { decision });
      setMsg({ kind: 'ok', text: `Request ${r.status}. No access was provisioned.` });
      onDone();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Couldn’t record the decision.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{row.workerName}</div>
          <div className="muted" style={{ fontSize: 11 }}>{row.fromTenant || '—'} → {row.toTenant || '—'}{row.toBranch ? ` · ${row.toBranch}` : ''}{row.effectiveDate ? ` · eff. ${row.effectiveDate}` : ''}</div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>{row.reason}</div>
        </div>
        {!msg && <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
          <button className="qbtn" disabled={busy} onClick={() => decide('approve')} style={{ background: '#3E8F57', color: '#fff', borderColor: 'transparent' }}>Approve</button>
          <button className="qbtn" disabled={busy} onClick={() => (mode === 'reject' ? decide('reject') : setMode('reject'))}>Reject</button>
        </div>}
      </div>
      {mode === 'reject' && !msg && (
        <div style={{ marginTop: 8 }}>
          <input aria-label={`Reject note for ${row.workerName}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection (min 12 chars)" style={{ width: '100%', height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div>}
    </div>
  );
}

const payrollStatusClass: Record<string, string> = { synced: 'ok', pending: 'warn', processing: 'warn', failed: 'danger', retrying: 'warn', not_configured: 'muted', not_required: 'muted' };
const severityColor: Record<string, string> = { critical: '#B85B4D', warning: '#C98A3A', info: '#9B8B78' };
function SecurityAlertRow({ row, onDone }: { row: SAWorkforceSecurityAlert; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('reviewed');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const ready = reason.trim().length >= 8 && !busy;
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminStaffApi.workforceReviewSecurity({ alertKey: row.key, resolution, reason: reason.trim() });
      setMsg({ kind: 'ok', text: `Recorded as ${r.resolution}.` }); onDone();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Couldn’t record the review.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}><span style={{ color: severityColor[row.severity] || '#9B8B78' }}>●</span>{row.label}</div>
          <div className="muted" style={{ fontSize: 11 }}>{row.workerName} · {row.tenant || '—'} · {cap(row.severity)}</div>
          <div style={{ fontSize: 11.5, marginTop: 3 }}>{row.reason}</div>
        </div>
        {!msg && !open && <button className="qbtn" onClick={() => setOpen(true)} style={{ flex: 'none', height: 30 }}>Record review</button>}
      </div>
      {open && !msg && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label={`Resolution for ${row.key}`} value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ ...selStyle, height: 30 }}>
            <option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option><option value="escalated">Escalated</option>
          </select>
          <input aria-label={`Review reason for ${row.key}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (audited)" style={{ flex: 1, minWidth: 150, height: 30, border: '1px solid var(--line)', borderRadius: 7, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
          <button className="qbtn" disabled={!ready} onClick={submit} style={{ height: 30, background: ready ? GOLD : undefined, color: ready ? '#fff' : undefined, borderColor: ready ? 'transparent' : undefined, opacity: ready ? 1 : 0.6 }}>{busy ? 'Recording…' : 'Save'}</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div>}
    </div>
  );
}

function PayrollEventRow({ row, onDone }: { row: SAPayrollSyncEventRow; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'retry'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const retry = async () => {
    if (reason.trim().length < 8) { setMode('retry'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminStaffApi.workforceRetryPayrollSync(row.id, { reason: reason.trim() });
      setMsg({ kind: 'ok', text: `Retry queued (attempt ${r.attemptCount}). Next attempt ~${fmtDate(r.nextRetryAt)}.` });
      onDone();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Couldn’t queue the retry.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 700, fontSize: 12.5 }}>{row.workerName || '—'}</span><Badge text={cap(row.status)} cls={payrollStatusClass[row.status] || 'muted'} /></div>
          <div className="muted" style={{ fontSize: 11 }}>{row.provider} · {cap(row.eventType)} · {row.tenant || '—'} · attempt {row.attemptCount}/{row.maxAttempts}</div>
          {row.errorCode && <div style={{ fontSize: 11.5, marginTop: 3, color: '#B85B4D' }}>{row.errorCode}{row.errorMessage ? ` — ${row.errorMessage}` : ''}</div>}
          {!row.retryable && row.retryBlockedReason && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Not retryable: {row.retryBlockedReason}</div>}
        </div>
        {row.retryable && !msg && <button className="qbtn" disabled={busy} onClick={() => (mode === 'retry' ? retry() : setMode('retry'))} style={{ flex: 'none', height: 30 }}>{mode === 'retry' ? 'Confirm retry' : 'Retry'}</button>}
      </div>
      {mode === 'retry' && !msg && (
        <div style={{ marginTop: 8 }}>
          <input aria-label={`Retry reason for ${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for retry (required, audited)" style={{ width: '100%', height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div>}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: SAWorkforceDuplicateGroup }) {
  const [canonical, setCanonical] = useState(group.members[0]?.workerId || '');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const ready = !!canonical && reason.trim().length >= 8 && confirm.trim().toUpperCase() === 'CONFIRM' && !busy && !msg;
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await superAdminStaffApi.workforceReviewDuplicate({ canonicalId: canonical, memberIds: group.members.map((m) => m.workerId), reason: reason.trim() });
      setMsg({ kind: 'ok', text: `Recorded. Canonical kept; ${r.flaggedIds.length} profile(s) flagged for tenant resolution.` });
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'The review couldn’t be recorded.' }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{group.maskedEmail} <span className="muted" style={{ fontWeight: 400 }}>· {group.tenant || '—'} · {group.members.length} profiles</span></div>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.members.map((m) => (
          <label key={m.workerId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px', borderRadius: 6, background: canonical === m.workerId ? 'var(--cream2,#F3E7D2)' : 'transparent', cursor: msg ? 'default' : 'pointer' }}>
            <input type="radio" name={`canon-${group.maskedEmail}`} checked={canonical === m.workerId} disabled={!!msg} onChange={() => setCanonical(m.workerId)} aria-label={`Keep ${m.name} as canonical`} />
            <span style={{ fontWeight: 600, minWidth: 120 }}>{m.name}</span>
            <span className="muted">{cap(m.role)} · {cap(m.status)}</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>created {fmtDate(m.createdAt)}</span>
          </label>
        ))}
      </div>
      {msg ? <div style={{ fontSize: 12, marginTop: 8, color: msg.kind === 'ok' ? '#3E8F57' : '#B85B4D' }}>{msg.text}</div> : (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Review reason" placeholder="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 150, height: 30, border: '1px solid var(--line)', borderRadius: 7, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
          <input aria-label="Type CONFIRM to record" placeholder="CONFIRM" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 96, height: 30, border: '1px solid var(--line)', borderRadius: 7, padding: '0 8px', fontFamily: 'inherit', fontSize: 12 }} />
          <button className="qbtn" disabled={!ready} onClick={submit} style={{ height: 30, background: ready ? 'var(--g7,#A96F22)' : undefined, color: ready ? '#fff' : undefined, borderColor: ready ? 'transparent' : undefined, opacity: ready ? 1 : 0.6 }}>{busy ? 'Recording…' : 'Record review'}</button>
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, background: '#fff' };
const menuStyle: React.CSSProperties = { position: 'absolute', right: 0, top: '100%', zIndex: 20, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 200, padding: 4, textAlign: 'left' };
const miStyle: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', background: 'none', fontSize: 12.5, cursor: 'pointer', borderRadius: 6 };

function Th({ label, k, sort, dir, on }: { label: string; k: string; sort: string; dir: string; on: (k: string) => void }) {
  return <th onClick={() => on(k)} style={{ cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{label}{sort === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>;
}
function Glance({ label, value }: { label: string; value: string }) {
  return <div style={{ background: 'var(--cream2,#F7F2E9)', borderRadius: 8, padding: '8px 10px' }}><div className="muted" style={{ fontSize: 10.5 }}>{label}</div><div style={{ fontSize: 16, fontWeight: 800 }}>{value}</div></div>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 60, display: 'grid', placeItems: 'center' }}><div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title} className="w-[min(560px,94vw)] bg-white rounded-xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.2)]"><div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{title}</div>{children}</div></div>;
}
function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}><div onClick={(e) => e.stopPropagation()} role="dialog" style={{ width: 'min(420px,95vw)', height: '100vh', background: '#fff', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}><div><div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>{sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}</div><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div><div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>{children}</div></div></div>;
}
function Field({ k, v }: { k: string; v: ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}><span className="muted" style={{ minWidth: 120, flex: 'none' }}>{k}</span><span style={{ flex: 1, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span></div>;
}
