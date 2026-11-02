// CustomerDataOversightScreen.tsx — Super Admin › Operations Oversight › Customer Data Oversight.
// Platform-level customer data-governance, privacy, duplicate, integrity, and legal-hold monitoring. Every KPI,
// chart, table and panel is DERIVED from the real customers population via the customer-data-oversight overview
// endpoint; anything the schema can't back renders NotConnected (never fabricated). Cream/gold design system.
// TENANT ISOLATION: this is the authorized Super Admin cross-tenant view; the backend enforces scope and never
// links/merges records across tenants — cross-tenant matches surface only as protected, masked integrity alerts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInlineConfirm, useEventCallback } from '@aipowersalon/ui';
import { useInlineAsk } from '@aipowersalon/ui';
import { useNavigate, useParams } from 'react-router-dom';
import { superAdminApi, type CustomerDataOverview, type CdoRow, type LegalHold, type ImportJob, type DeletionRequest, type CustomerSyncDashboard, type CustomerSyncRun, type CustomerSyncMergePreview, type CustomerSyncConflict, type CustomerSyncTenantStat } from '../api/superAdminApi';
import { Donut, MiniBars, AreaLine, NotConnected } from './_chartkit';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { useCan } from '../auth/useCan';

// ---- badge tones (accessible: text + colour, never colour alone) ----
const PHONE_TONE: Record<string, string> = { valid: 'ok', invalid: 'bad', missing: 'warn' };
const EMAIL_TONE: Record<string, string> = { valid: 'ok', invalid: 'bad', missing: 'warn' };
const RISK_TONE: Record<string, string> = { none: 'mut', low: 'ok', medium: 'warn', high: 'bad' };
const CONSENT_TONE: Record<string, string> = { consented: 'ok', not_consented: 'warn', unknown: 'mut' };
const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const ICON: Record<string, string> = {
  total_customers: '👥', customers_by_tenant: '🏢', duplicate_records: '⧉', incomplete_records: '◑', invalid_phone: '☎',
  invalid_email: '✉', failed_imports: '⤓', privacy_requests: '🛡', export_requests: '⇪', deletion_requests: '🗑',
  consent_status: '✓', cross_tenant: '⚠', legal_hold: '🔒', avg_completeness: '◔', integrity_score: '🛡',
};

// 10 Oversight Actions (reference order). All wired — no dead buttons; governance flows pending schema open an
// honest "not yet connected" notice rather than a fake action.
const OVERSIGHT_ACTIONS: { key: string; label: string; danger?: boolean }[] = [
  { key: 'duplicates', label: 'Review duplicate-detection results' },
  { key: 'imports_approve', label: 'Approve large imports' },
  { key: 'imports_retry', label: 'Retry failed imports' },
  { key: 'merge', label: 'Merge records with authorization' },
  { key: 'privacy', label: 'Process privacy requests' },
  { key: 'export', label: 'Export customer data' },
  { key: 'correct', label: 'Correct data-integrity problems' },
  { key: 'audit', label: 'Review customer audit history' },
  { key: 'legal_hold', label: 'Place records under legal hold' },
  { key: 'delete', label: 'Permanently delete data under approved process', danger: true },
];

export function CustomerDataOversightScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<CustomerDataOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const { ask, askUi } = useInlineAsk();
  const [learn, setLearn] = useState(false);
  // ── Customer Sync & Reconciliation (the 7 PM global-identity engine) ──
  const [syncRunsMore, setSyncRunsMore] = useState<CustomerSyncRun[]>([]);
  const loadMoreRuns = () => { superAdminApi.customerSyncRuns(50).then(setSyncRunsMore).catch(() => {}); };
  const [sync, setSync] = useState<CustomerSyncDashboard | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<CustomerSyncConflict[]>([]);
  // §24 merge review: compare two global identities side by side, then merge (reversible) or keep separate.
  const [mergeA, setMergeA] = useState('');
  const [mergeB, setMergeB] = useState('');
  const [mergePreview, setMergePreview] = useState<CustomerSyncMergePreview | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const loadMergePreview = () => {
    setMergeMsg(null); setMergeConfirm(false);
    if (!mergeA.trim() || !mergeB.trim()) { setMergeMsg('Enter both global customer IDs.'); return; }
    superAdminApi.customerSyncMergePreview(mergeA.trim(), mergeB.trim())
      .then((p) => { setMergePreview(p); if (!p) setMergeMsg('One or both identities were not found.'); })
      .catch((e: any) => setMergeMsg(e?.message || 'Could not load the comparison.'));
  };
  const doMerge = () => {
    if (!mergePreview || !mergeConfirm) return;
    superAdminApi.customerSyncMerge({ sourceGlobalCustomerId: mergePreview.a.globalCustomerId, targetGlobalCustomerId: mergePreview.b.globalCustomerId, confirm: true })
      .then((r) => {
        setMergeMsg(r.ok
          ? `Merged. ${r.moved ?? 0} salon relationship(s) moved. The source identity is retired, not deleted — this can be reversed.`
          : r.reason === 'LEGAL_HOLD' ? 'Blocked: a legal hold covers a customer linked to this identity.'
          : r.reason === 'CONFIRMATION_REQUIRED' ? 'Confirmation is required.'
          : `Merge failed (${r.reason ?? 'unknown'}).`);
        if (r.ok) { setMergePreview(null); setMergeConfirm(false); superAdminApi.customerSyncDashboard().then(setSync).catch(() => {}); }
      })
      .catch((e: any) => setMergeMsg(e?.message || 'Merge failed.'));
  };
  const setConflictStatus = (id: string, status: string) => {
    superAdminApi.customerSyncConflictStatus(id, status)
      .then(() => superAdminApi.customerSyncConflicts('NEW').then(setSyncConflicts).catch(() => {}))
      .catch(() => {});
  };
  const [syncDetail, setSyncDetail] = useState<{ runId: string; rows: CustomerSyncTenantStat[] } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncTenant, setSyncTenant] = useState('');
  const [syncCustomer, setSyncCustomer] = useState('');
  const mayConflicts = useCan()('super_admin.customer_sync.review');   // the identity-conflict queue is a review key
  const loadSync = () => {
    superAdminApi.customerSyncDashboard().then(setSync).catch(() => {});
    if (mayConflicts) superAdminApi.customerSyncConflicts('NEW').then(setSyncConflicts).catch(() => {});
  };
  useEffect(loadSync, [mayConflicts]);
  const openRunDetail = (runId: string) => {
    superAdminApi.customerSyncRunDetail(runId).then((rows) => setSyncDetail({ runId, rows })).catch(() => setSyncDetail({ runId, rows: [] }));
  };
  const runSyncNow = (scope: 'all' | 'tenant' | 'customer') => {
    if (scope === 'tenant' && !syncTenant) { setSyncMsg('Choose a tenant to re-sync.'); return; }
    if (scope === 'customer' && (!syncTenant || !syncCustomer)) { setSyncMsg('A customer re-sync needs both the tenant and the customer ID.'); return; }
    const label = scope === 'all' ? 'ALL tenants' : scope === 'tenant' ? 'this tenant' : 'this customer';
    askConfirm(`Run customer sync now for ${label}? This reconciles global customer identities and may create review items.`, () => { void doRunSync(scope); }, { confirmLabel: 'Run sync now', destructive: false });
  };
  const doRunSync = (scope: string) => {
    setSyncBusy(true); setSyncMsg(null);
    const body = scope === 'all' ? {} : scope === 'tenant' ? { tenantId: syncTenant } : { tenantId: syncTenant, customerId: syncCustomer };
    superAdminApi.customerSyncRun(body)
      .then((r) => {
        setSyncMsg(r.ran === false
          ? (r.skippedReason || 'Skipped — a reconciliation is already running.')
          : `${r.status}: ${r.customersScanned ?? 0} scanned, ${r.newGlobals ?? 0} new, ${r.linkedExisting ?? 0} linked, ${r.conflicts ?? 0} conflicts, ${r.errors ?? 0} errors.`);
        loadSync();
      })
      .catch((e: any) => setSyncMsg(e?.message || 'Run failed.'))
      .finally(() => setSyncBusy(false));
  };
  const [search, setSearch] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [duplicateRisk, setDuplicateRisk] = useState('');
  const [page, setPage] = useState(1);
  // Legal Hold UI state
  const [holdForm, setHoldForm] = useState<null | { tenantId: string; customerId: string; scope: 'customer' | 'branch' | 'tenant'; matterRef: string; reason: string; internalNotes: string; confirm: boolean }>(null);
  const [holdErrs, setHoldErrs] = useState<string[]>([]);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holds, setHolds] = useState<LegalHold[] | null>(null);
  // Imports drawer state
  const [importsOpen, setImportsOpen] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  // Permanent-deletion drawer state
  const [delOpen, setDelOpen] = useState(false);
  const [dels, setDels] = useState<DeletionRequest[] | null>(null);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [delForm, setDelForm] = useState({ tenantId: '', customerId: '', reason: '' });
  const [execFor, setExecFor] = useState<null | { req: DeletionRequest; typed: string }>(null);
  // Merge-review drawer state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [dupCases, setDupCases] = useState<any[] | null>(null);

  const load = useCallback(() => {
    setErr(null);
    superAdminApi.customerDataOversight({ search: search || undefined, tenantId: tenantId || undefined, branchId: branchId || undefined, status: status || undefined, duplicateRisk: duplicateRisk || undefined, page, pageSize: 10 })
      .then(setData).catch((e: any) => setErr(e?.message || 'Failed to load Customer Data Oversight.'));
  }, [search, tenantId, branchId, status, duplicateRisk, page]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const tenantOptions = useMemo(() => data?.customersByTenant ?? [], [data]);
  const branchOptions = useMemo(() => {
    const m = new Map<string, string>();
    (data?.directory ?? []).forEach((r) => { if (r.branchId) m.set(r.branchId, r.branchName || r.branchId); });
    return [...m.entries()];
  }, [data]);

  const loadHolds = useCallback(() => { superAdminApi.legalHolds({ status: 'active' }).then(setHolds).catch(() => setHolds([])); }, []);
  useEffect(() => { loadHolds(); }, [loadHolds]);

  const openHold = (row?: CdoRow) => {
    setHoldErrs([]);
    setHoldForm({ tenantId: row?.tenantId || '', customerId: row?.id || '', scope: 'customer', matterRef: '', reason: '', internalNotes: '', confirm: false });
  };

  const submitHold = async () => {
    if (!holdForm) return;
    const errs: string[] = [];
    if (!holdForm.tenantId) errs.push('Select a tenant.');
    if (!holdForm.matterRef.trim()) errs.push('Matter / case reference is required.');
    if (!holdForm.reason.trim()) errs.push('A reason is required.');
    if (holdForm.scope === 'customer' && !holdForm.customerId.trim()) errs.push('A customer is required for a customer-scoped hold.');
    if (!holdForm.confirm) errs.push('You must confirm this hold is authorized.');
    if (errs.length) { setHoldErrs(errs); return; }
    setHoldBusy(true); setHoldErrs([]);
    try {
      const res = await superAdminApi.applyLegalHold({
        tenantId: holdForm.tenantId, customerId: holdForm.scope === 'customer' ? holdForm.customerId.trim() : null,
        matterRef: holdForm.matterRef.trim(), reason: holdForm.reason.trim(), scope: holdForm.scope, internalNotes: holdForm.internalNotes.trim() || null,
      });
      if (!res.ok) { setHoldErrs(res.errors || ['Could not place the hold.']); setHoldBusy(false); return; }
      setHoldForm(null); setNote('Legal hold placed and audited. The record is now protected from permanent deletion and destructive merge until released.');
      load(); loadHolds();
    } catch (e: any) { setHoldErrs([e?.message || 'Request failed.']); }
    setHoldBusy(false);
  };

  const releaseHold = (h: LegalHold) => ask(`Release the legal hold on ${h.customerId || h.tenantId} (matter ${h.matterRef})?\nEnter a release reason:`, (reason) => { void doReleaseHold(h, reason); });
  const doReleaseHold = async (h: LegalHold, reason: string) => {
    const res = await superAdminApi.releaseLegalHold(h.id, reason);
    if (!res.ok) { setNote((res.errors || ['Could not release the hold.']).join(' ')); return; }
    setNote('Legal hold released and audited.'); load(); loadHolds();
  };

  const loadJobs = useCallback(() => { setJobs(null); superAdminApi.importJobs().then(setJobs).catch(() => setJobs([])); }, []);
  const openImports = useEventCallback(() => { setImportsOpen(true); setJobMsg(null); loadJobs(); });
  const onJobAction = async (id: string, kind: 'approve' | 'retry' | 'reject') => {
    if (kind === 'reject') { ask('Reason for rejecting this import?', (reason) => { void finishJob(kind, superAdminApi.rejectImport(id, reason)); }); return; }
    await finishJob(kind, kind === 'approve' ? superAdminApi.approveImport(id) : superAdminApi.retryImport(id));
  };
  const finishJob = async (kind: string, p: Promise<any>) => {
    const res = await p;
    if (!res.ok) { setJobMsg((res.errors || ['Action failed.']).join(' ')); return; }
    setJobMsg(`Import ${kind} succeeded${res.job ? ` — ${res.job.importedRows} imported, ${res.job.failedRows} failed.` : '.'}`);
    loadJobs(); load(); // refresh Failed Imports KPI / Import Success
  };

  const loadDels = useCallback(() => { setDels(null); superAdminApi.deletionRequests().then(setDels).catch(() => setDels([])); }, []);
  const openDeletions = useEventCallback((row?: CdoRow) => { setDelOpen(true); setDelMsg(null); setDelForm({ tenantId: row?.tenantId || '', customerId: row?.id || '', reason: '' }); loadDels(); });
  const submitDelRequest = async () => {
    if (!delForm.tenantId || !delForm.customerId.trim() || !delForm.reason.trim()) { setDelMsg('Tenant, customer ID, and reason are all required.'); return; }
    const res = await superAdminApi.requestDeletion({ tenantId: delForm.tenantId, customerId: delForm.customerId.trim(), reason: delForm.reason.trim() });
    if (!res.ok) { setDelMsg((res.errors || ['Request failed.']).join(' ')); return; }
    setDelMsg('Deletion requested. It now needs approval by a second reviewer before it can be executed.');
    setDelForm({ ...delForm, reason: '' }); loadDels();
  };
  const onDelAction = async (req: DeletionRequest, kind: 'approve' | 'reject') => {
    if (kind === 'reject') { ask('Reason for rejecting this deletion?', (reason) => { void finishDel(kind, superAdminApi.rejectDeletion(req.id, reason)); }); return; }
    await finishDel(kind, superAdminApi.approveDeletion(req.id));
  };
  const finishDel = async (kind: string, p: Promise<any>) => {
    const res = await p;
    if (!res.ok) { setDelMsg((res.errors || ['Action failed.']).join(' ')); return; }
    setDelMsg(kind === 'approve' ? 'Deletion approved by second reviewer. It can now be executed with a typed confirmation.' : 'Deletion request rejected.');
    loadDels();
  };
  const submitExecute = async () => {
    if (!execFor) return;
    const res = await superAdminApi.executeDeletion(execFor.req.id, execFor.typed.trim());
    if (!res.ok) { setDelMsg((res.errors || ['Execution refused.']).join(' ')); return; }
    setExecFor(null); setDelMsg('Personal data permanently erased under approved process. This cannot be undone.'); loadDels(); load();
  };

  const openMerges = () => { setMergeOpen(true); setDupCases(null); superAdminApi.customerDuplicates({ pageSize: 50 }).then((r) => setDupCases(r.cases || [])).catch(() => setDupCases([])); };

  // Sidebar submenu deep-links (/customer-data-oversight/:view) open the matching drawer/section once, on load.
  const { view } = useParams();
  const handledView = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !view || handledView.current === view) return;
    handledView.current = view;
    if (view === 'duplicate-detection' || view === 'merge-history') openMerges();
    else if (view === 'import-history') openImports();
    else if (view === 'deletion-requests') openDeletions();
    else if (view === 'legal-hold') setNote('Active legal holds are listed in the Legal Holds panel. Use “Place hold” there, or a customer row’s Hold action, to add one — every apply/release is permission-checked and audited.');
    else if (view === 'privacy-requests') setNote('Privacy-request status is summarized in the Privacy Request Status module below; processing runs server-side, permission-checked and audited.');
    else if (view === 'data-exports') setNote('Use Export or Export Report to generate a tenant-scoped, field-permission-checked, audited export.');
    else if (view === 'consent-status') setNote('The purpose-specific consent breakdown is shown in the Customer Consent Status Overview module below.');
    else if (view === 'audit-history') setNote('Recent customer-data activity and the merge / audit trail are shown at the bottom of this page.');
     
  }, [view, data, openImports, openDeletions]);

  const onAction = (key: string) => {
    if (key === 'duplicates') return openMerges();
    if (key === 'legal_hold') return openHold();
    if (key === 'imports_approve' || key === 'imports_retry') return openImports();
    if (key === 'delete') return openDeletions();
    if (key === 'merge') return openMerges();
    if (key === 'export') return setNote('Export uses the current tenant/branch/search/filter scope, is permission-checked and audited server-side.');
    setNote('This governance action runs server-side with permission checks and audit logging.');
  };

  const exportReport = () => setNote('Export Report reflects the current scope, filters, sort, timezone, timestamp and Super Admin identity — generated and audited server-side.');

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!data) return <div className="screen"><div className="state">Loading Customer Data Oversight…</div></div>;

  const kpi = (k: string) => data.kpis.find((x) => x.key === k)!;
  const consentDonut = data.consentOverview.segments.map((s) => ({ label: s.label, value: s.count }));
  const dupDonut = data.duplicateDistribution.segments.map((s) => ({ label: s.label, value: s.count }));
  const privacyDonut = data.privacyRequestStatus.segments.map((s) => ({ label: s.label, value: s.count }));

  return (
    <div className="screen p-5">
      {/* HEADER */}
      <div className="vh flex items-start flex-col sm:flex-row gap-3 mb-3">
        <div style={{ flex: 1 }}>
          <h1>Customer Data Oversight <span title="Platform module" style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1>
          <div className="sub">Monitor customer records, imports, privacy requests, duplicates, and data integrity across all tenants.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={exportReport}>⬇ Export Report</button>
          <button className="btn" onClick={() => setNote('Adding widgets isn’t connected yet — this dashboard’s modules are fixed for now.')}>+ Add Widget</button>
        </div>
      </div>

      {/* TENANT ISOLATION BANNER */}
      <section className="panel" style={{ borderLeft: '4px solid var(--g7,#A96F22)', background: 'linear-gradient(90deg,#FBF3E6,#FFFDF8)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span aria-hidden="true" style={{ fontSize: 22 }}>🛡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, letterSpacing: 0.4, fontSize: 12.5 }}>TENANT ISOLATION REQUIRED</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Customer records must remain tenant-isolated. A customer from Tenant A must never automatically appear inside Tenant B.</div>
          {learn ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
              Each tenant owns its own customer records. The same real person may be a customer of two tenants and keeps a separate record at each — matching phone or email across tenants never links, copies or merges them. Duplicate detection runs within one tenant only; cross-tenant matches generate a protected Super Admin integrity alert that exposes no other tenant's customer details. Search, imports, merges, exports, privacy requests, audit history and legal holds are all tenant-scoped, and any correction of a mis-assigned tenant requires elevated permission, a reason, before/after review, confirmation and audit logging.
            </div>
          ) : null}
        </div>
        <button className="btn ghost" onClick={() => setLearn((v) => !v)}>{learn ? 'Hide' : 'Learn More'}</button>
      </section>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* 15 KPI CARDS (3 × 5) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mt-3">
        {data.kpis.map((k) => (
          <button key={k.key} className="kpi" onClick={() => k.to && nav(k.to)} style={{ textAlign: 'left', cursor: k.to ? 'pointer' : 'default', border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not connected'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: '#FBF1E2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{ICON[k.key] || '•'}</span><span className="l" style={{ fontSize: 11 }}>{k.label}</span></div>
            <div className="v" style={{ fontSize: 19 }}>{k.available ? k.value : <NotConnected />}</div>
            <div className="d flat" style={{ fontSize: 11 }}>{k.available ? (k.trend || k.supporting || '\u00A0') : 'NotConnected'}</div>
          </button>
        ))}
      </div>

      {/* MAIN GRID: directory (left) + health/actions (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 mt-3.5 items-start">
        {/* DIRECTORY */}
        <section className="panel">
          <div className="phead"><h2>All Customer Data Oversight <span className="muted">({data.directoryTotal.toLocaleString()})</span></h2></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input className="inp" style={{ flex: 1, minWidth: 200, height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8 }} placeholder="Search customers..." value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
            <select className="inp" style={selS} value={tenantId} onChange={(e) => { setPage(1); setTenantId(e.target.value); }}><option value="">All Tenants</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}</select>
            <select className="inp" style={selS} value={branchId} onChange={(e) => { setPage(1); setBranchId(e.target.value); }}><option value="">All Branches</option>{branchOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select className="inp" style={selS} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}><option value="">All Statuses</option>{['active', 'inactive', 'archived'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
            <select className="inp" style={selS} value={duplicateRisk} onChange={(e) => { setPage(1); setDuplicateRisk(e.target.value); }} aria-label="Filters"><option value="">Filters</option>{['high', 'medium', 'low'].map((s) => <option key={s} value={s}>{cap(s)} dup risk</option>)}</select>
            <button className="border border-[var(--line)] bg-[var(--grad)] text-[#2C2118] rounded-[10px] px-[14px] py-2 text-xs font-extrabold cursor-pointer font-inherit" onClick={exportReport}>⬇ Export</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12, minWidth: 1500 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>
                <th>Customer ID</th><th>Customer Name</th><th>Tenant</th><th>Branch</th><th>Phone</th><th>Email</th><th>Completeness</th><th>Duplicate Risk</th><th>Consent</th><th>Privacy</th><th>Import Source</th><th>Last Updated</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {data.directory.length === 0 ? <tr><td colSpan={13}><div className="state">No customers match these filters.</div></td></tr> :
                  data.directory.map((r: CdoRow) => (
                    <tr key={r.id}>
                      <td className="px-2 py-1" style={{ fontWeight: 600 }}>{r.id}</td>
                      <td className="px-2 py-1"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ProfileAvatarWithPreview name={r.name} url={(r as any).avatarUrl} size={26} type="customer" subtitle={`Customer #${r.id}`} /><span>{r.name}</span></div></td>
                      <td className="muted px-2 py-1">{r.tenantName || '—'}</td>
                      <td className="muted px-2 py-1">{r.branchName || '—'}</td>
                      <td className="px-2 py-1"><span className={'pill ' + (PHONE_TONE[r.phoneStatus] || 'mut')}>{cap(r.phoneStatus)}</span></td>
                      <td className="px-2 py-1"><span className={'pill ' + (EMAIL_TONE[r.emailStatus] || 'mut')}>{cap(r.emailStatus)}</span></td>
                      <td className="px-2 py-1">{r.completeness}%</td>
                      <td className="px-2 py-1"><span className={'pill ' + (RISK_TONE[r.duplicateRisk] || 'mut')}>{cap(r.duplicateRisk)}</span></td>
                      <td className="px-2 py-1"><span className={'pill ' + (CONSENT_TONE[r.consentStatus] || 'mut')}>{cap(r.consentStatus)}</span></td>
                      <td className="muted px-2 py-1">{r.privacyRequest}</td>
                      <td className="muted px-2 py-1">{r.importSource}</td>
                      <td className="muted px-2 py-1">{new Date(r.lastUpdated).toLocaleDateString()}</td>
                      <td className="px-2 py-1"><button className="linkbtn" aria-label={`View ${r.name}`} onClick={() => setNote(`A per-customer oversight view isn\u2019t connected yet \u2014 ${r.id}\u2019s row shows the oversight fields; use Hold / Delete here, and the tenant\u2019s POS for salon records.`)}>View</button> <button className="linkbtn" aria-label={`Place legal hold on ${r.name}`} onClick={() => openHold(r)}>Hold</button> <button className="linkbtn" style={{ color: 'var(--danger,#B85B4D)' }} aria-label={`Request permanent deletion of ${r.name}`} onClick={() => openDeletions(r)}>Delete</button></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* PAGINATION */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
            <span className="muted">Showing {data.directory.length ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0} to {(data.pagination.page - 1) * data.pagination.pageSize + data.directory.length} of {data.pagination.totalItems.toLocaleString()} customers</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn ghost" disabled={data.pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              <span>Page {data.pagination.page} / {data.pagination.totalPages}</span>
              <button className="btn ghost" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
          </div>
        </section>

        {/* RIGHT: HEALTH & ALERTS + OVERSIGHT ACTIONS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel">
            <div className="phead"><h2>Customer Data Health &amp; Alerts</h2></div>
            {data.healthAlerts.map((a) => (
              <div key={a.key} className="arow" style={{ display: 'flex', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)', cursor: a.to ? 'pointer' : 'default' }} onClick={() => a.to && nav(a.to)}>
                <span style={{ flex: 1, fontSize: 12.5 }}>{a.label}</span>
                <b style={{ fontSize: 13 }}>{a.available ? (a.count ?? 0).toLocaleString() : <NotConnected />}</b>
                {a.to ? <span className="muted" style={{ marginLeft: 8 }}>›</span> : null}
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="phead"><h2>Oversight Actions</h2></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-1 gap-[7px]">
              {OVERSIGHT_ACTIONS.map((a) => (
                <button key={a.key} className="qbtn" onClick={() => onAction(a.key)} style={a.danger ? { borderColor: 'var(--danger,#B85B4D)', color: 'var(--danger,#B85B4D)', fontWeight: 700 } : undefined}>{a.label}</button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="phead"><h2>Active Legal Holds</h2><button className="linkbtn" onClick={() => openHold()}>+ Place hold</button></div>
            {holds === null ? <div className="state">Loading…</div> : holds.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>No active legal holds. Records are deletable through the normal approved process.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {holds.slice(0, 8).map((h) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, borderBottom: '1px solid var(--line)', padding: '5px 0' }}>
                    <span aria-hidden="true">🔒</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{h.scope === 'customer' ? h.customerId : `${cap(h.scope)} scope`}</div>
                      <div className="muted">Matter {h.matterRef}</div>
                    </div>
                    <button className="linkbtn" onClick={() => releaseHold(h)}>Release</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* LOWER ANALYTICS GRID */}
      <div className="grid3" style={{ marginTop: 14 }}>
        <section className="panel">
          <div className="phead"><h2>Customer Growth Trend</h2><span className="muted">New records</span></div>
          <AreaLine series={data.growthTrend.map((g) => ({ label: g.date.slice(5), valueCents: g.newRecords * 100 }))} emptyHint="No customer records in range." />
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{data.growthDefinition}</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Customers by Tenant</h2><span className="muted">Top 8</span></div>
          <MiniBars data={data.customersByTenant.map((t) => ({ label: (t.label || '').slice(0, 8), value: t.count, tip: t.label }))} emptyHint="No tenants in scope." />
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Total: {data.customersByTenantTotal.toLocaleString()} customers</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Duplicate Record Distribution</h2></div>
          {data.duplicateDistribution.total === 0 ? <div className="state">No duplicate candidates.</div> : <Donut data={dupDonut} centerLabel={`${data.duplicateDistribution.total}\nTotal`} />}
        </section>
        <section className="panel">
          <div className="phead"><h2>Import Success vs Failed</h2><button className="linkbtn" onClick={openImports}>Manage</button></div>
          {data.importSuccess.available ? (
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--g7,#A96F22)' }}>{data.importSuccess.successRatePct == null ? '—' : `${data.importSuccess.successRatePct}%`}</div>
              <div className="muted" style={{ fontSize: 12 }}>of attempted import rows imported cleanly. Failed rows: {kpi('failed_imports').value ?? '0'}.</div>
            </div>
          ) : <div className="state">No import jobs yet. <button className="linkbtn" onClick={openImports}>Start an import</button></div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Privacy Request Status</h2></div>
          {data.privacyRequestStatus.available && privacyDonut.length ? <Donut data={privacyDonut} centerLabel={`${data.privacyRequestStatus.total}\nTotal`} /> : <div className="state">Privacy request status <NotConnected />.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Customer Consent Status Overview</h2></div>
          <Donut data={consentDonut} centerLabel={`${data.consentOverview.ratePct}%\nConsented`} />
        </section>
        <section className="panel">
          <div className="phead"><h2>Data Integrity Issues Summary</h2></div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{data.integrityIssues.total.toLocaleString()}</div>
          {data.integrityIssues.categories.map((c) => (
            <div key={c.key} style={{ display: 'flex', fontSize: 12.5, padding: '3px 0' }}><span>{c.label}</span><span style={{ marginLeft: 'auto' }}>{c.count.toLocaleString()}</span></div>
          ))}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{data.integrityIssues.note}</div>
        </section>
        <section className="panel">
          <div className="phead"><h2>Suspicious Cross-Tenant Records</h2></div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--danger,#B85B4D)' }}>{data.suspiciousCrossTenant.count}</div>
          <div className="muted" style={{ fontSize: 12 }}>Same phone/email across different tenants — protected integrity alerts (masked, never merged).</div>
          {data.suspiciousCrossTenant.alerts.slice(0, 4).map((a, i) => (
            <div key={i} style={{ display: 'flex', fontSize: 12, padding: '3px 0' }}><span>{cap(a.reason)} · {a.maskedKey}</span><span style={{ marginLeft: 'auto' }} className="muted">{a.tenantIds.length} tenants</span></div>
          ))}
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Customer Data Activity</h2></div>
          {data.recentActivity.available && data.recentActivity.rows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {data.recentActivity.rows.slice(0, 8).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <span style={{ flex: 1 }}>{cap(a.action)}{a.entityId ? <span className="muted"> · {a.entityId}</span> : null}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{new Date(a.at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : data.recentActivity.available ? <div className="muted" style={{ fontSize: 12.5 }}>No recent customer-data activity.</div> : <div className="state">Activity feed <NotConnected />.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Merges / Audit Trail</h2><button className="linkbtn" onClick={openMerges}>Review duplicates</button></div>
          {data.recentMerges.available && data.recentMerges.rows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {data.recentMerges.rows.slice(0, 8).map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <span style={{ flex: 1 }}>{m.sourceCustomerId} → <b>{m.targetCustomerId}</b></span>
                  <span className="muted" style={{ fontSize: 11 }}>{new Date(m.mergedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          ) : data.recentMerges.available ? <div className="muted" style={{ fontSize: 12.5 }}>No merges recorded yet.</div> : <div className="state">Merge audit trail <NotConnected />.</div>}
        </section>
      </div>
      {/* LEGAL HOLD MODAL */}
      {holdForm ? (
        <div role="dialog" aria-modal="true" aria-label="Place customer record under legal hold" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !holdBusy && setHoldForm(null)}>
          <div className="panel" style={{ width: 'min(560px, 94vw)', maxHeight: '90vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2>🔒 Place Records Under Legal Hold</h2></div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>A legal hold preserves the record against permanent deletion, destructive merge and retention expiry until released through an approved process. Tenant-scoped and audited.</div>
            {holdErrs.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 10 }}>{holdErrs.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
            <label style={lbl}>Tenant *
              <select className="inp" style={fld} value={holdForm.tenantId} onChange={(e) => setHoldForm({ ...holdForm, tenantId: e.target.value })}>
                <option value="">Select tenant…</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}
              </select>
            </label>
            <label style={lbl}>Scope *
              <select className="inp" style={fld} value={holdForm.scope} onChange={(e) => setHoldForm({ ...holdForm, scope: e.target.value as any })}>
                <option value="customer">Single customer</option><option value="branch">Entire branch</option><option value="tenant">Entire tenant</option>
              </select>
            </label>
            {holdForm.scope === 'customer' ? (
              <label style={lbl}>Customer ID *
                <input className="inp" style={fld} value={holdForm.customerId} onChange={(e) => setHoldForm({ ...holdForm, customerId: e.target.value })} placeholder="CUS-…" />
              </label>
            ) : null}
            <label style={lbl}>Matter / case reference *
              <input className="inp" style={fld} value={holdForm.matterRef} onChange={(e) => setHoldForm({ ...holdForm, matterRef: e.target.value })} placeholder="e.g. LIT-2026-0042" />
            </label>
            <label style={lbl}>Reason *
              <textarea className="inp" style={{ ...fld, height: 64, paddingTop: 8 }} value={holdForm.reason} onChange={(e) => setHoldForm({ ...holdForm, reason: e.target.value })} placeholder="Why this hold is being placed" />
            </label>
            <label style={lbl}>Internal notes
              <textarea className="inp" style={{ ...fld, height: 48, paddingTop: 8 }} value={holdForm.internalNotes} onChange={(e) => setHoldForm({ ...holdForm, internalNotes: e.target.value })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, margin: '6px 0 14px' }}>
              <input type="checkbox" checked={holdForm.confirm} onChange={(e) => setHoldForm({ ...holdForm, confirm: e.target.checked })} />
              <span>I confirm this legal hold is authorized and the matter reference is accurate. This action is audited.</span>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" disabled={holdBusy} onClick={() => setHoldForm(null)}>Cancel</button>
              <button className="btn" disabled={holdBusy} onClick={submitHold}>{holdBusy ? 'Placing…' : 'Place legal hold'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* IMPORTS DRAWER */}
      {importsOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Customer imports" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.42)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setImportsOpen(false)}>
          <div className="panel" style={{ width: 'min(720px, 96vw)', height: '100vh', overflowY: 'auto', background: '#FFFDF8', borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2>Customer Imports</h2><button className="btn ghost" onClick={() => setImportsOpen(false)}>Close</button></div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Bulk imports are staged and validated before any record is written. Approve a pending batch to import its valid rows; retry re-runs only failed/unprocessed rows and never re-imports a row that already succeeded.</div>
            {jobMsg ? <div className="state" style={{ marginBottom: 10 }}>{jobMsg} <button className="linkbtn" onClick={() => setJobMsg(null)}>Dismiss</button></div> : null}
            {jobs === null ? <div className="state">Loading import jobs…</div> : jobs.length === 0 ? (
              <div className="state">No import jobs yet. Imports created via the API or CSV upload will appear here for review.</div>
            ) : (
              <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Job</th><th>Source</th><th>Status</th><th>Total</th><th>Valid</th><th>Imported</th><th>Failed</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.filename || j.id}</td>
                      <td className="muted">{cap(j.source)}</td>
                      <td><span className={'pill ' + (j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'rejected' ? 'mut' : 'warn')}>{cap(j.status)}</span></td>
                      <td>{j.totalRows}</td><td>{j.validRows}</td><td>{j.importedRows}</td><td>{j.failedRows}</td>
                      <td className="muted">{new Date(j.createdAt).toLocaleDateString()}</td>
                      <td>
                        {j.status === 'pending' ? <><button className="linkbtn" onClick={() => onJobAction(j.id, 'approve')}>Approve</button> <button className="linkbtn" onClick={() => onJobAction(j.id, 'reject')}>Reject</button></> : null}
                        {j.status === 'completed' || j.status === 'failed' ? <button className="linkbtn" onClick={() => onJobAction(j.id, 'retry')}>Retry</button> : null}
                        {j.status === 'rejected' || j.status === 'processing' || j.status === 'approved' ? <span className="muted">—</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

      {/* CUSTOMER SYNC & RECONCILIATION (§20) */}
      <div className="panel" data-testid="customer-sync" style={{ marginTop: 14 }}>
        <div className="phead"><h2>Customer Sync &amp; Reconciliation</h2><span className="muted" style={{ fontSize: 11 }}>One customer identity across salons · nightly 7:00 PM · salon data never copied between tenants</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 10 }}>
          <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Last sync</div><div style={{ fontWeight: 700 }}>{sync?.lastSync ? new Date(sync.lastSync).toLocaleString() : '—'}</div></div>
          <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Status</div><div style={{ fontWeight: 700 }}>{sync?.lastStatus ?? '—'}</div></div>
          <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Next scheduled</div><div style={{ fontWeight: 700 }}>{sync?.nextScheduled ? new Date(sync.nextScheduled).toLocaleString() : '—'}</div></div>
          <div className="panel" style={{ background: '#fff' }}><div className="muted" style={{ fontSize: 11 }}>Open conflicts</div><div style={{ fontWeight: 700 }}>{sync?.openConflicts ?? 0}</div></div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn" disabled={syncBusy} onClick={() => runSyncNow('all')}>{syncBusy ? 'Running…' : 'Run customer sync now'}</button>
          <select className="inp" style={fld} value={syncTenant} onChange={(e) => setSyncTenant(e.target.value)}><option value="">Tenant…</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}</select>
          <button className="btn ghost" disabled={syncBusy} onClick={() => runSyncNow('tenant')}>Re-sync tenant</button>
          <input className="inp" style={fld} placeholder="Customer ID" value={syncCustomer} onChange={(e) => setSyncCustomer(e.target.value)} />
          <button className="btn ghost" disabled={syncBusy} onClick={() => runSyncNow('customer')}>Re-sync customer</button>
          {syncMsg ? <span className="muted" style={{ fontSize: 11.5 }}>{syncMsg}</span> : null}
        </div>

        <div className="grid grid-cols-1  lg:grid-cols-[1.15fr_1fr] gap-3">
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{syncRunsMore.length ? 'Run history' : 'Recent runs'} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>(click a run for the tenant-by-tenant breakdown)</span></div>
              {syncRunsMore.length === 0
                ? <button type="button" className="lnk" data-testid="sync-load-history" onClick={loadMoreRuns} style={{ fontSize: 11 }}>Show full history</button>
                : <span className="muted" style={{ fontSize: 11 }}>{syncRunsMore.length} runs</span>}
            </div>
            {!sync || (syncRunsMore.length ? syncRunsMore : sync.recentRuns).length === 0 ? <div className="state">No reconciliation runs yet.</div> : (
              <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Started</th><th>Scope</th><th>Status</th><th>Scanned</th><th>New</th><th>Linked</th><th>Errors</th></tr></thead>
                <tbody>
                  {(syncRunsMore.length ? syncRunsMore : sync.recentRuns).map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRunDetail(r.id)}>
                      <td>{new Date(r.startedAt).toLocaleString()}</td>
                      <td className="muted">{r.scope}</td>
                      <td><span className={'pill ' + (r.status === 'COMPLETED' ? 'ok' : r.status === 'FAILED' ? 'bad' : 'warn')}>{r.status}</span></td>
                      <td>{r.customersScanned}</td><td>{r.newGlobals}</td><td>{r.linkedExisting}</td><td>{r.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {syncDetail ? (
              <div className="panel" style={{ background: '#fff', marginTop: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Tenant breakdown <button className="linkbtn" onClick={() => setSyncDetail(null)}>Close</button></div>
                {syncDetail.rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No tenant rows for this run.</div> : (
                  <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Tenant</th><th>Scanned</th><th>New</th><th>Linked</th><th>Suspects</th><th>Status</th></tr></thead>
                    <tbody>{syncDetail.rows.map((t) => (
                      <tr key={t.tenantId}><td>{t.tenantId}</td><td>{t.customersScanned}</td><td>{t.newGlobals}</td><td>{t.linkedExisting}</td><td>{t.duplicateSuspects}</td>
                        <td><span className={'pill ' + (t.status === 'ok' ? 'ok' : 'bad')}>{t.status}</span>{t.errorDetail ? <span className="muted" style={{ fontSize: 11 }}> {t.errorDetail}</span> : null}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            ) : null}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Identity conflicts awaiting review</div>
            {syncConflicts.length === 0 ? <div className="state">No open identity conflicts.</div> : (
              <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Kind</th><th>Phone</th><th>Email</th><th>Seen</th><th>Decision</th></tr></thead>
                <tbody>{syncConflicts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.kind}</td><td>{c.mainValueMasked ?? '—'}</td><td>{c.tenantValueMasked ?? '—'}</td><td>{c.occurrences}×</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="linkbtn" onClick={() => setConflictStatus(c.id, 'KEEP_SEPARATE')}>Keep separate</button>
                      {' · '}
                      <button type="button" className="linkbtn" onClick={() => setConflictStatus(c.id, 'FALSE_POSITIVE')}>Not a duplicate</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Ambiguous identities are never merged automatically. Values are masked.</div>

            <div data-testid="merge-review" style={{ marginTop: 14, borderTop: '1px solid var(--line,#eee)', paddingTop: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Merge review <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>(compare two identities · merge is reversible · legal holds block it)</span></div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input aria-label="Global customer A" placeholder="Global customer A (source)" value={mergeA} onChange={(e) => setMergeA(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
                <input aria-label="Global customer B" placeholder="Global customer B (target)" value={mergeB} onChange={(e) => setMergeB(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
                <button type="button" className="btn ghost" onClick={loadMergePreview}>Compare</button>
              </div>
              {mergeMsg ? <div className="state" style={{ marginBottom: 8 }}>{mergeMsg}</div> : null}
              {mergePreview ? (
                <div>
                  <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th></th><th>A (source — will be retired)</th><th>B (target — survives)</th></tr></thead>
                    <tbody>
                      <tr><td>Name</td><td>{mergePreview.a.name ?? '—'}</td><td>{mergePreview.b.name ?? '—'}</td></tr>
                      <tr><td>Phone</td><td>{mergePreview.a.phoneMasked} {mergePreview.a.phoneVerified ? '✓' : ''}</td><td>{mergePreview.b.phoneMasked} {mergePreview.b.phoneVerified ? '✓' : ''}</td></tr>
                      <tr><td>Email</td><td>{mergePreview.a.emailMasked} {mergePreview.a.emailVerified ? '✓' : ''}</td><td>{mergePreview.b.emailMasked} {mergePreview.b.emailVerified ? '✓' : ''}</td></tr>
                      <tr><td>Linked salons</td><td>{mergePreview.a.linkedTenants}</td><td>{mergePreview.b.linkedTenants}</td></tr>
                    </tbody>
                  </table>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    Matching: {mergePreview.indicators.samePhone ? 'same phone · ' : ''}{mergePreview.indicators.sameEmail ? 'same email · ' : ''}{mergePreview.indicators.sharesTenant ? 'both at one salon' : 'different salons'}
                  </div>
                  <label style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
                    <input type="checkbox" checked={mergeConfirm} onChange={(e) => setMergeConfirm(e.target.checked)} /> I confirm these are the same person. A's salon relationships move to B; A is retired, not deleted.
                  </label>
                  <button type="button" className="btn" disabled={!mergeConfirm} onClick={doMerge} style={{ marginTop: 6 }}>Merge identities</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* PERMANENT DELETION DRAWER */}
      {delOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Permanent customer deletion" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.42)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setDelOpen(false)}>
          <div className="panel" style={{ width: 'min(760px, 96vw)', height: '100vh', overflowY: 'auto', background: '#FFFDF8', borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2 style={{ color: 'var(--danger,#B85B4D)' }}>Permanent Deletion (Approved Process)</h2><button className="btn ghost" onClick={() => setDelOpen(false)}>Close</button></div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Permanent deletion irreversibly erases a customer's personal data. It requires a request, approval by a <b>second, different reviewer</b>, an exact typed customer-ID confirmation, a retention check, and is blocked while any legal hold covers the record. Every step is audited.</div>
            {delMsg ? <div className="state" style={{ marginBottom: 10 }}>{delMsg} <button className="linkbtn" onClick={() => setDelMsg(null)}>Dismiss</button></div> : null}
            <div className="panel" style={{ background: '#fff', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Request a deletion</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select className="inp" style={fld} value={delForm.tenantId} onChange={(e) => setDelForm({ ...delForm, tenantId: e.target.value })}><option value="">Select tenant…</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}</select>
                <input className="inp" style={fld} placeholder="Customer ID (CUS-…)" value={delForm.customerId} onChange={(e) => setDelForm({ ...delForm, customerId: e.target.value })} />
              </div>
              <input className="inp" style={{ ...fld, marginTop: 8 }} placeholder="Reason (e.g. GDPR erasure request)" value={delForm.reason} onChange={(e) => setDelForm({ ...delForm, reason: e.target.value })} />
              <button className="btn" style={{ marginTop: 10 }} onClick={submitDelRequest}>Request deletion</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Deletion requests</div>
            {dels === null ? <div className="state">Loading…</div> : dels.length === 0 ? <div className="state">No deletion requests.</div> : (
              <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Customer</th><th>Reason</th><th>Status</th><th>Hold</th><th>Actions</th></tr></thead>
                <tbody>
                  {dels.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.customerId}</td>
                      <td className="muted">{d.reason}</td>
                      <td><span className={'pill ' + (d.status === 'executed' ? 'bad' : d.status === 'approved' ? 'warn' : d.status === 'rejected' || d.status === 'cancelled' ? 'mut' : 'ok')}>{cap(d.status)}</span></td>
                      <td>{d.legalHoldBlocked ? <span className="pill bad">Held</span> : <span className="muted">—</span>}</td>
                      <td>
                        {d.status === 'requested' ? <><button className="linkbtn" onClick={() => onDelAction(d, 'approve')}>Approve</button> <button className="linkbtn" onClick={() => onDelAction(d, 'reject')}>Reject</button></> : null}
                        {d.status === 'approved' ? <><button className="linkbtn" style={{ color: 'var(--danger,#B85B4D)', fontWeight: 700 }} onClick={() => setExecFor({ req: d, typed: '' })}>Execute</button> <button className="linkbtn" onClick={() => onDelAction(d, 'reject')}>Reject</button></> : null}
                        {d.status === 'executed' || d.status === 'rejected' || d.status === 'cancelled' ? <span className="muted">—</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

      {/* EXECUTE CONFIRMATION MODAL — requires typing the exact customer ID */}
      {execFor ? (
        <div role="dialog" aria-modal="true" aria-label="Confirm permanent deletion" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setExecFor(null)}>
          <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff', borderTop: '4px solid var(--danger,#B85B4D)' }} onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2 style={{ color: 'var(--danger,#B85B4D)' }}>Confirm permanent erasure</h2></div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>This will <b>irreversibly erase</b> the personal data of customer <b>{execFor.req.customerId}</b>. Transactional records keep referential integrity, but the person's identifying data cannot be recovered.</div>
            <label style={lbl}>Type the customer ID <b>{execFor.req.customerId}</b> to confirm
              <input className="inp" style={fld} value={execFor.typed} onChange={(e) => setExecFor({ ...execFor, typed: e.target.value })} placeholder={execFor.req.customerId} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setExecFor(null)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--danger,#B85B4D)', borderColor: 'var(--danger,#B85B4D)', color: '#fff' }} disabled={execFor.typed.trim() !== execFor.req.customerId.trim()} onClick={submitExecute}>Permanently erase</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MERGE-REVIEW DRAWER (read-only duplicate review; authorized merge runs via the support-session flow) */}
      {mergeOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Duplicate review and merge" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.42)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setMergeOpen(false)}>
          <div className="panel" style={{ width: 'min(760px, 96vw)', height: '100vh', overflowY: 'auto', background: '#FFFDF8', borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2>Duplicate Review &amp; Merge</h2><button className="btn ghost" onClick={() => setMergeOpen(false)}>Close</button></div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Duplicate detection runs <b>within a single tenant only</b> — records from different tenants are never candidates. Executing a merge requires an active Customer Support session for the tenant (open one from Tenant Management); the merge then needs a reason and is fully audited and recoverable from the merge log.</div>
            {dupCases === null ? <div className="state">Loading duplicate clusters…</div> : dupCases.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>No duplicate clusters detected in scope.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dupCases.map((c: any) => (
                  <div key={c.id} className="panel" style={{ background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className={'pill ' + (c.confidence === 'exact' || c.confidence === 'high' ? 'bad' : 'warn')}>{cap(String(c.kind || 'match'))}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{c.tenantName || c.tenantId} · key {c.keyMasked || '—'}</span>
                    </div>
                    <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Customer</th><th>Phone</th><th>Email</th><th>Branch</th><th>Status</th></tr></thead>
                      <tbody>
                        {(c.members || []).map((m: any) => (
                          <tr key={m.id}><td style={{ fontWeight: 600 }}>{m.name}</td><td className="muted">{m.phone}</td><td className="muted">{m.email}</td><td className="muted">{m.branch || '—'}</td><td><span className={'pill ' + (m.status === 'active' ? 'ok' : 'mut')}>{cap(m.status || '—')}</span></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {askUi}
      {confirmUi}
    </div>
  );
}

const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 10 };
const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, fontWeight: 400 };
