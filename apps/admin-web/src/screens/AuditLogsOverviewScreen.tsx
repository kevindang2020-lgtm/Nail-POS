// AuditLogsOverviewScreen.tsx — Super Admin → System Settings → Audit Logs. Read-only platform audit trail wired to
// GET /super-admin/audit-logs/overview. White/orange design; live background refresh; honest "Not tracked" for legal
// hold / investigations / evidence / retention (their tables arrive in later units). Reading never mutates the log.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminAuditLogsApi, type ALOverview, type ALKpi, type ALSegment, type ALLegalHold, type ALInvestigation, type ALTimelineEntry, type ALEvidencePack, type ALCustodyEntry, type ALTamperControl, type ALExportFlag, type ALRetentionPolicy } from '../api/superAdminAuditLogsApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const REFRESH_MS = 25_000;
const ORANGE = '#E07B39';
const LINE = '#ECE7DE';
const TEXT = '#2A2320';
const MUTED = '#8A7E6D';
const SEM: Record<string, string> = { good: '#3E8F57', warn: '#C08A2E', bad: '#D14343', neutral: '#6B7280' };
const RISK: Record<string, string> = { high: '#D14343', medium: '#C08A2E', low: '#6B7280' };
const CAT_COLORS = ['#3B82F6', '#E07B39', '#8B5CF6', '#3E8F57', '#C08A2E', '#D14343', '#0EA5E9', '#EC4899', '#64748B'];
const RESULT_COLORS: Record<string, string> = { success: '#3E8F57', warning: '#C08A2E', failed: '#D14343', under_review: '#6B7280' };
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' };
const fmt = (n: number) => n.toLocaleString();
function Dot({ color }: { color: string }) { return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />; }

function KpiCard({ k }: { k: ALKpi }) {
  const tint = k.available ? (SEM[k.semantic] || MUTED) : MUTED;
  return (
    <div style={{ ...card, padding: 13, display: 'flex', flexDirection: 'column', gap: 5 }} tabIndex={0} aria-label={`${k.label}: ${k.available ? k.display : 'Not tracked'}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 28, height: 28, borderRadius: '50%', background: `${tint}1A`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Dot color={tint} /></span><span style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{k.label}</span></div>
      <div style={{ fontSize: 20, fontWeight: 800, color: k.available ? TEXT : '#B8AE9E' }}>{k.available ? k.display : 'Not tracked'}</div>
      {k.available
        ? (k.direction === 'flat' && k.deltaPct === 0 ? <div style={{ fontSize: 11, color: MUTED }}>—</div> : <div style={{ fontSize: 11, color: SEM[k.semantic] || MUTED, fontWeight: 600 }}>{k.direction === 'up' ? '▲' : k.direction === 'down' ? '▼' : ''} {Math.abs(k.deltaPct)}% vs prior</div>)
        : <div style={{ fontSize: 10.5, color: '#B8AE9E' }}>No source modelled yet</div>}
    </div>
  );
}

function Donut({ segments, total, centerLabel, colorAt }: { segments: ALSegment[]; total: number; centerLabel: string; colorAt: (k: string, i: number) => string }) {
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.filter((s) => s.count > 0).map((s, i) => { const frac = total > 0 ? s.count / total : 0; const el = { dashArray: `${frac * C} ${C - frac * C}`, offset: -acc * C, color: colorAt(s.key, i) }; acc += frac; return el; });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="124" height="124" viewBox="0 0 128 128" role="img" aria-label={`${centerLabel}: ${total}`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="#F1ECE3" strokeWidth="16" />
        {arcs.map((a, i) => (<circle key={i} cx="64" cy="64" r={R} fill="none" stroke={a.color} strokeWidth="16" strokeDasharray={a.dashArray} strokeDashoffset={a.offset} transform="rotate(-90 64 64)" />))}
        <text x="64" y="60" textAnchor="middle" fontSize="17" fontWeight="800" fill={TEXT}>{fmt(total)}</text>
        <text x="64" y="78" textAnchor="middle" fontSize="9" fill={MUTED}>{centerLabel}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, maxHeight: 130, overflowY: 'auto' }}>
        {segments.length === 0 ? <span style={{ color: MUTED }}>No data yet</span> : segments.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Dot color={colorAt(s.key, i)} /><span style={{ color: TEXT }}>{s.label}</span><span style={{ color: MUTED, marginLeft: 'auto' }}>{fmt(s.count)} · {s.pct}%</span></div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ days }: { days: ALOverview['eventVolumeTrend'] }) {
  const W = 520, H = 150, pad = 24;
  const max = Math.max(1, ...days.map((d) => d.count));
  const x = (i: number) => pad + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  if (days.length === 0) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>No events in this period.</div>;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Event volume trend">
      <polyline fill="none" stroke={ORANGE} strokeWidth="2" points={days.map((d, i) => `${x(i)},${y(d.count)}`).join(' ')} />
      {days.map((d, i) => (<circle key={i} cx={x(i)} cy={y(d.count)} r="2.5" fill={ORANGE} />))}
      {days.map((d, i) => (<text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{d.day.slice(5)}</text>))}
    </svg>
  );
}

const FILTERS = ['User', 'Role', 'Tenant', 'Branch', 'Action Type', 'Result', 'IP Address', 'Device'];
const QUICK_ROW = ['Search Logs', 'Filter by User / Tenant / Action / Date', 'Export Audit Evidence', 'Investigate Suspicious Activity', 'Place Logs Under Legal Hold', 'Review Before-and-After Values', 'Open Investigation', 'Chain of Custody Report'];
const QUICK_ACTIONS = ['Open Investigation', 'Export Evidence', 'Legal Hold', 'View Security Logs', 'View AI Config Changes', 'Review Data Exports'];

export function AuditLogsOverviewScreen() {
  const nav = useNavigate();
  const [logSearch, setLogSearch] = useState('');
  const applyLogSearch = () => { const q = logSearch.trim(); nav(q ? `/audit-logs/browse?action=${encodeURIComponent(q)}` : '/audit-logs/browse'); };
  const [data, setData] = useState<ALOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const { ask, askUi } = useInlineAsk();
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback((signal: AbortSignal, background = false) => {
    if (background && inFlight.current) return;
    inFlight.current = true;
    if (!background) { setLoading(true); setError(null); }
    superAdminAuditLogsApi.overview({})
      .then((d) => { if (!signal.aborted) { setData(d); setError(null); setLastUpdated(new Date()); setStale(false); if (!background) setLoading(false); } })
      .catch((e: unknown) => { if (signal.aborted) return; if (background) setStale(true); else { setError(e instanceof Error ? e.message : 'Failed to load audit logs'); setLoading(false); } })
      .finally(() => { inFlight.current = false; });
  }, []);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);
  useAutoRefresh((signal) => load(signal, true), REFRESH_MS);

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdForm, setHoldForm] = useState({ scopeType: 'tenant', scopeValue: '', reason: '', legalAuthority: '' });
  const [holds, setHolds] = useState<ALLegalHold[]>([]);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdErr, setHoldErr] = useState<string | null>(null);
  const [holdMsg, setHoldMsg] = useState<string | null>(null);
  const loadHolds = useCallback(() => { superAdminAuditLogsApi.listHolds().then((r) => setHolds(r.holds)).catch(() => setHolds([])); }, []);
  const openHold = () => { setHoldOpen(true); setHoldErr(null); setHoldMsg(null); setHoldForm({ scopeType: 'tenant', scopeValue: '', reason: '', legalAuthority: '' }); loadHolds(); };
  const placeHold = () => {
    if (holdForm.reason.trim().length < 3) { setHoldErr('A reason is required to place a legal hold.'); return; }
    if (holdForm.scopeType !== 'global' && !holdForm.scopeValue.trim()) { setHoldErr(`A scope value is required for a ${holdForm.scopeType} hold.`); return; }
    setHoldBusy(true); setHoldErr(null); setHoldMsg(null);
    superAdminAuditLogsApi.placeHold({ scopeType: holdForm.scopeType, scopeValue: holdForm.scopeValue.trim() || undefined, reason: holdForm.reason.trim(), legalAuthority: holdForm.legalAuthority.trim() || undefined })
      .then((r) => { setHoldMsg(`Hold ${r.hold.holdRef} placed — protecting ${r.protectedCount.toLocaleString()} event(s). Logs are unchanged.`); setHoldForm((f) => ({ ...f, reason: '', scopeValue: '' })); loadHolds(); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setHoldErr(e instanceof Error ? e.message : 'Failed to place hold'))
      .finally(() => setHoldBusy(false));
  };
  const releaseHold = (h: ALLegalHold) => ask(`Release hold ${h.holdRef}? Enter a reason (required):`, (reason) => {
    superAdminAuditLogsApi.releaseHold(h.id, { reason }).then(() => { loadHolds(); const ac = new AbortController(); load(ac.signal, true); }).catch(() => {});
  }, { minLength: 3 });

  const [invOpen, setInvOpen] = useState(false);
  const [invForm, setInvForm] = useState({ title: '', severity: 'medium', assignee: '', description: '' });
  const [invList, setInvList] = useState<ALInvestigation[]>([]);
  const [invSelected, setInvSelected] = useState<{ investigation: ALInvestigation; timeline: ALTimelineEntry[] } | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const [invMsg, setInvMsg] = useState<string | null>(null);
  const loadInvestigations = useCallback(() => { superAdminAuditLogsApi.listInvestigations().then((r) => setInvList(r.investigations)).catch(() => setInvList([])); }, []);
  const openInv = () => { setInvOpen(true); setInvErr(null); setInvMsg(null); setInvSelected(null); setInvForm({ title: '', severity: 'medium', assignee: '', description: '' }); loadInvestigations(); };
  const createInvestigation = () => {
    if (invForm.title.trim().length < 3) { setInvErr('An investigation title is required.'); return; }
    setInvBusy(true); setInvErr(null); setInvMsg(null);
    superAdminAuditLogsApi.openInvestigation({ title: invForm.title.trim(), severity: invForm.severity, assignee: invForm.assignee.trim() || undefined, description: invForm.description.trim() || undefined })
      .then((r) => { setInvMsg(`Investigation ${r.investigation.caseRef} opened.`); setInvForm({ title: '', severity: 'medium', assignee: '', description: '' }); loadInvestigations(); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setInvErr(e instanceof Error ? e.message : 'Failed to open investigation'))
      .finally(() => setInvBusy(false));
  };
  const viewInvestigation = (i: ALInvestigation) => { superAdminAuditLogsApi.getInvestigation(i.id).then(setInvSelected).catch(() => {}); };
  const changeInvStatus = (i: ALInvestigation, status: string) => { superAdminAuditLogsApi.setInvestigationStatus(i.id, { status }).then(() => { loadInvestigations(); viewInvestigation(i); const ac = new AbortController(); load(ac.signal, true); }).catch(() => {}); };
  const addInvNote = (i: ALInvestigation) => ask('Add a note (appended to the immutable timeline):', (note) => { superAdminAuditLogsApi.addInvestigationNote(i.id, { note }).then(() => viewInvestigation(i)).catch(() => {}); });

  const [evOpen, setEvOpen] = useState(false);
  const [evPacks, setEvPacks] = useState<ALEvidencePack[]>([]);
  const [evCustody, setEvCustody] = useState<{ packId: string; entries: ALCustodyEntry[] } | null>(null);
  const [evBusy, setEvBusy] = useState(false);
  const [evMsg, setEvMsg] = useState<string | null>(null);
  const loadPacks = useCallback(() => { superAdminAuditLogsApi.listEvidence().then((r) => setEvPacks(r.packs)).catch(() => setEvPacks([])); }, []);
  const openEvidence = () => { setEvOpen(true); setEvMsg(null); setEvCustody(null); loadPacks(); };
  const downloadCsv = (content: string, mimeType: string, filename: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const exportEvidence = () => {
    setEvBusy(true); setEvMsg(null);
    superAdminAuditLogsApi.exportEvidence({})
      .then((r) => { downloadCsv(r.content, r.mimeType, r.filename); setEvMsg(`Pack ${r.pack.packRef} generated — ${r.pack.eventCount} event(s), SHA-256 ${r.checksum.slice(0, 16)}…`); if (!evOpen) return; loadPacks(); const ac = new AbortController(); load(ac.signal, true); })
      .catch(() => setEvMsg('Export failed.'))
      .finally(() => setEvBusy(false));
  };
  const viewCustody = (p: ALEvidencePack) => { superAdminAuditLogsApi.getEvidence(p.id).then((r) => setEvCustody({ packId: p.id, entries: r.custody })).catch(() => {}); };
  const verifyPack = (p: ALEvidencePack) => { superAdminAuditLogsApi.verifyEvidence(p.id).then((r) => { setEvMsg(r.verified ? `Pack ${p.packRef}: integrity verified ✓` : `Pack ${p.packRef}: INTEGRITY FAILED — mismatch flagged`); viewCustody(p); }).catch(() => {}); };

  const [tcOpen, setTcOpen] = useState(false);
  const [tcForm, setTcForm] = useState({ controlKey: 'worm_storage', value: '', status: 'compliant', detail: '' });
  const [tcBusy, setTcBusy] = useState(false);
  const [tcErr, setTcErr] = useState<string | null>(null);
  const [tcMsg, setTcMsg] = useState<string | null>(null);
  const openTamper = () => { setTcOpen(true); setTcErr(null); setTcMsg(null); setTcForm({ controlKey: 'worm_storage', value: '', status: 'compliant', detail: '' }); };
  const controls = data?.retentionStatus.controls ?? [];
  const saveControl = () => {
    if (!tcForm.value.trim()) { setTcErr('A value is required.'); return; }
    setTcBusy(true); setTcErr(null); setTcMsg(null);
    superAdminAuditLogsApi.setTamperControl({ controlKey: tcForm.controlKey, value: tcForm.value.trim(), status: tcForm.status, detail: tcForm.detail.trim() || undefined })
      .then((r) => { setTcMsg(`${r.control.label}: ${r.control.value} (${r.control.status}).`); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setTcErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setTcBusy(false));
  };
  const verifyControl = (c: ALTamperControl) => { superAdminAuditLogsApi.verifyTamperControl(c.key).then(() => { setTcMsg(`${c.label} re-verified.`); const ac = new AbortController(); load(ac.signal, true); }).catch(() => {}); };

  const retentionPolicies = data?.retentionStatus.retention?.policies ?? [];
  const [rpForm, setRpForm] = useState({ category: 'auth', hotDays: '90', archiveDays: '275' });
  const [rpBusy, setRpBusy] = useState(false);
  const saveRetention = () => {
    const hot = Number(rpForm.hotDays), arch = Number(rpForm.archiveDays);
    if (!Number.isInteger(hot) || hot < 0 || !Number.isInteger(arch) || arch < 0) { setTcErr('Hot and archive days must be non-negative integers.'); return; }
    setRpBusy(true); setTcErr(null); setTcMsg(null);
    superAdminAuditLogsApi.setRetentionPolicy({ category: rpForm.category, hotDays: hot, archiveDays: arch })
      .then((r) => { setTcMsg(`Retention for ${r.policy.category}: ${r.policy.hotDays}d hot + ${r.policy.archiveDays}d archive (v${r.policy.version}).`); const ac = new AbortController(); load(ac.signal, true); })
      .catch((e: unknown) => setTcErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setRpBusy(false));
  };

  const [flOpen, setFlOpen] = useState(false);
  const [flags, setFlags] = useState<ALExportFlag[]>([]);
  const [flBusy, setFlBusy] = useState(false);
  const [flMsg, setFlMsg] = useState<string | null>(null);
  const loadFlags = useCallback(() => { superAdminAuditLogsApi.listExportFlags('open').then((r) => setFlags(r.flags)).catch(() => setFlags([])); }, []);
  const openFlags = () => { setFlOpen(true); setFlMsg(null); loadFlags(); };
  const scanFlags = () => {
    setFlBusy(true); setFlMsg(null);
    superAdminAuditLogsApi.scanExportFlags()
      .then((r) => { setFlMsg(`Scanned ${r.scanned} export event(s) — ${r.created} new flag(s).`); loadFlags(); const ac = new AbortController(); load(ac.signal, true); })
      .catch(() => setFlMsg('Scan failed.'))
      .finally(() => setFlBusy(false));
  };
  const submitFlagReview = (f: ALExportFlag, dismiss: boolean, note?: string) => {
    superAdminAuditLogsApi.reviewExportFlag(f.id, { status: dismiss ? 'dismissed' : 'reviewed', note }).then(() => { loadFlags(); const ac = new AbortController(); load(ac.signal, true); }).catch(() => {});
  };
  const reviewFlag = (f: ALExportFlag, dismiss: boolean) => {
    if (!dismiss) { submitFlagReview(f, false); return; }
    ask('Dismiss as a false positive — reason (required):', (note) => submitFlagReview(f, true, note), { minLength: 3 });
  };

  const row1 = useMemo(() => data?.kpis.slice(0, 5) ?? [], [data]);
  const row2 = useMemo(() => data?.kpis.slice(5, 10) ?? [], [data]);

  if (loading) return <div style={{ padding: 24 }}><div style={{ height: 20, width: 200, background: '#eee', borderRadius: 6 }} /><div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>{Array.from({ length: 10 }).map((_, i) => <div key={i} style={{ ...card, height: 90 }} />)}</div></div>;
  if (error) return <div style={{ padding: 24 }}><div style={{ ...card, padding: 24, textAlign: 'center' }}><div style={{ color: SEM.bad, fontWeight: 700, marginBottom: 8 }}>Couldn’t load Audit Logs</div><div style={{ color: MUTED, fontSize: 13, marginBottom: 14 }}>{error}</div><button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Retry</button></div></div>;
  if (!data) return null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#FBFAF7' }}>
      <div className='work'>
        <div className="flex flex-col lg:flex-row justify-between gap-3" >
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: TEXT, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>Audit Logs <span style={{ color: '#DCB056' }}>★</span></h1>
            <div style={{ color: MUTED, fontSize: 12.5, marginTop: 2 }}>Records every important action performed throughout the platform.</div>
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, fontSize: 11.5, color: stale ? '#B8860B' : '#7A9E86' }}>
              <Dot color={stale ? '#D09A36' : '#3E8F57'} />
              {stale ? <span>Reconnecting — showing last known data{lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ''}.</span> : <span>{lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} · auto-refresh {REFRESH_MS / 1000}s</span>}
            </div>
          </div>
          <div className='items-baseline whitespace-nowrap flex-wrap' style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportEvidence} disabled={evBusy} className='btn ghost'>⭳ {evBusy ? 'Exporting…' : 'Export Audit Evidence'}</button>
            <button onClick={openInv} className='btn'>+ Investigate Logs</button>
          </div>
        </div>

        <div style={{ ...card, padding: '10px 14px', marginTop: 12, background: '#EEF4FB', border: '1px solid #D6E4F2', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#2C4A63' }}>
          <span aria-hidden>ℹ️</span><span>{data.tamperResistance.note} Logs can be placed under legal hold for compliance and investigations.</span>
        </div>

        {evMsg && !evOpen ? (
          <div style={{ ...card, padding: '8px 14px', marginTop: 10, background: evMsg.includes('FAILED') ? '#FBECEC' : '#EDF7F0', border: `1px solid ${evMsg.includes('FAILED') ? '#E4C4C4' : '#CDE7D6'}`, fontSize: 12, color: evMsg.includes('FAILED') ? '#8A3333' : '#2E6B45', fontWeight: 600 }}>{evMsg}</div>
        ) : null}

        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">{row1.map((k) => <KpiCard key={k.key} k={k} />)}</div>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">{row2.map((k) => <KpiCard key={k.key} k={k} />)}</div>

        {/* filter bar — the search is the paged browser's "action contains" filter; Apply opens the browser with it. The
            browser cannot filter by these dimensions, so the selects say so rather than pretend (SCAN, Oct 12). */}
        <div style={{ ...card, padding: 12, marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input aria-label="Search logs" placeholder="Search logs…" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyLogSearch(); }} style={{ height: 32, flex: '1 1 180px', borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', fontSize: 12 }} />
          {FILTERS.map((f) => (<select key={f} aria-label={f} disabled title={`Filtering by ${f.toLowerCase()} is not available yet — search by action, or filter by tenant and dates in the full audit-log browser`} style={{ height: 32, borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 12, color: MUTED, opacity: 0.6 }}><option>{`All ${f}s`}</option></select>))}
          <button onClick={applyLogSearch} style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 8, background:'#DCB056', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Apply Filters</button>
          <button onClick={() => setLogSearch('')} style={{ height: 32, padding: '0 12px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Reset Filters</button>
        </div>

        {/* quick action row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2 mt-3">
          {QUICK_ROW.map((a) => (<button key={a} onClick={() => (a === 'Place Logs Under Legal Hold' ? openHold() : a === 'Open Investigation' ? openInv() : a === 'Investigate Suspicious Activity' ? openInv() : a === 'Export Audit Evidence' ? openEvidence() : a === 'Chain of Custody Report' ? openEvidence() : setModal(a))} style={{ ...card, boxShadow: 'none', padding: '10px 6px', textAlign: 'center', cursor: 'pointer', fontSize: 10.5, fontWeight: 600, color: TEXT, minHeight: 50 }}>{a}</button>))}
        </div>

        {/* platform audit trail */}
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <TableInner title="Platform Audit Trail" headers={['Date & Time', 'User', 'Role', 'Tenant', 'Action', 'Previous Value', 'New Value', 'IP Address', 'Device', 'Reason', 'Result']}
            rows={data.auditTrail.map((r) => [new Date(r.time).toLocaleString(), r.user, r.role, r.tenant, r.action, r.previous, r.next, r.ip, r.device, r.reason, r.result])} empty="No audit events in this period." />
        </div>

        {/* analytics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Audit Events by Category</div><Donut segments={data.eventsByCategory.segments} total={data.eventsByCategory.total} centerLabel="Events" colorAt={(_k, i) => CAT_COLORS[i % CAT_COLORS.length]} /></div>
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Event Volume Trend (Last 7 Days)</div><LineChart days={data.eventVolumeTrend} /></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Result Breakdown</div><Donut segments={data.resultBreakdown.segments} total={data.resultBreakdown.total} centerLabel="Total" colorAt={(k) => RESULT_COLORS[k] || '#9CA3AF'} /></div>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Top Users by Logged Activity</div>
            {data.topUsers.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No activity.</div> : data.topUsers.map((u, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12 }}><span style={{ color: MUTED, width: 16 }}>{i + 1}</span><span style={{ color: TEXT }}>{u.user}</span><span style={{ marginLeft: 'auto', color: MUTED }}>{fmt(u.events)}</span></div>))}
          </div>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>Suspicious Activity Queue</div>
            {data.suspiciousQueue.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>Nothing flagged.</div> : data.suspiciousQueue.map((s, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 11.5 }}><span style={{ color: TEXT }}>{s.user}</span><span style={{ color: MUTED }}>{s.event}</span><span style={{ marginLeft: 'auto', fontWeight: 700, color: RISK[s.risk] }}>{s.riskLabel}</span></div>))}
          </div>
        </div>

        {/* lower panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontWeight: 800, fontSize: 13, color: TEXT }}>Legal Hold Records</span><button onClick={openHold} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', fontSize: 10.5, fontWeight: 700, color: ORANGE, padding: '3px 8px', cursor: 'pointer' }}>+ Place / Manage</button></div>
            {data.legalHoldRecords.records.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No legal holds in place. Placing a hold protects a slice of events from retention purges without altering any log.</div> : data.legalHoldRecords.records.map((h, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 11.5 }}><span style={{ fontWeight: 700, color: TEXT }}>{h.holdRef}</span><span style={{ color: MUTED }}>{h.scope}</span><span style={{ marginLeft: 'auto', fontWeight: 700, color: h.status === 'active' ? SEM.warn : MUTED }}>{h.status}</span></div>))}
          </div>
          <Table title="Recent Data Export Events" headers={['Time', 'User', 'Scope']} rows={data.recentExports.map((e) => [new Date(e.time).toLocaleTimeString(), e.user, e.scope])} empty="No export events." />
          <Table title="Before-and-After Review" headers={['Action', 'Previous', 'New']} rows={data.beforeAfterReview.map((b) => [b.action, b.previous, b.next])} empty="No changes with recorded values." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 mt-4">
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontWeight: 800, fontSize: 13, color: TEXT }}>Open Investigations</span><button onClick={openInv} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', fontSize: 10.5, fontWeight: 700, color: ORANGE, padding: '3px 8px', cursor: 'pointer' }}>+ Open / Manage</button></div>
            {data.openInvestigations.investigations.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No open investigations. Opening a case links flagged events on an append-only, immutable timeline.</div> : data.openInvestigations.investigations.map((iv, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 11.5 }}><span style={{ fontWeight: 700, color: TEXT }}>{iv.caseRef}</span><span style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{iv.title}</span><span style={{ marginLeft: 'auto', fontWeight: 700, color: RISK[iv.severity] || MUTED }}>{iv.severity}</span></div>))}
          </div>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontWeight: 800, fontSize: 13, color: TEXT }}>Tamper-Resistance &amp; Retention Status</span><button onClick={openTamper} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', fontSize: 10.5, fontWeight: 700, color: ORANGE, padding: '3px 8px', cursor: 'pointer' }}>Manage</button></div>
            <div style={{ fontSize: 12, color: TEXT, marginBottom: 6 }}>Append-only: <strong style={{ color: SEM.good }}>{data.retentionStatus.appendOnly ? 'Yes' : '—'}</strong> · Admin-editable: <strong style={{ color: SEM.good }}>{data.retentionStatus.adminEditable === false ? 'No' : '—'}</strong></div>
            {controls.length === 0 ? <div style={{ color: MUTED, fontSize: 11.5 }}>Controls not configured yet.</div> : controls.map((c) => {
              const col = c.status === 'not_configured' ? MUTED : c.status === 'failed' || c.status === 'degraded' ? SEM.bad : SEM.good;
              return (<div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11.5 }}><span style={{ color: TEXT }}>{c.label}</span><span style={{ color: MUTED, marginLeft: 'auto' }}>{c.value}</span><span style={{ fontWeight: 700, color: col, minWidth: 74, textAlign: 'right' }}>{c.status.replace(/_/g, ' ')}</span></div>);
            })}
            {data.retentionStatus.lastVerifiedAt ? <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>Last verified {new Date(data.retentionStatus.lastVerifiedAt).toLocaleString()}</div> : null}
          </div>
          <div style={{ ...card, padding: 16 }}><div style={{ fontWeight: 800, fontSize: 13, color: TEXT, marginBottom: 10 }}>Access Source Summary</div><Donut segments={data.accessSourceSummary.segments} total={data.accessSourceSummary.total} centerLabel="Accesses" colorAt={(_k, i) => CAT_COLORS[i % CAT_COLORS.length]} /></div>
        </div>

        {/* quick actions */}
        <div style={{ ...card, padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>Quick Actions</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6  gap-2 ">{QUICK_ACTIONS.map((a) => (<button key={a} onClick={() => (a === 'Legal Hold' ? openHold() : a === 'Open Investigation' ? openInv() : a === 'Export Evidence' ? openEvidence() : a === 'Review Data Exports' ? openFlags() : setModal(a))} style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: '10px 6px', background: '#fff', fontSize: 11, fontWeight: 600, color: TEXT, cursor: 'pointer', minHeight: 50 }}>{a}</button>))}</div>
        </div>

        {/* at a glance */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 10 }}>At-a-Glance Summary (Today)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6  gap-2 ">
            <Glance label="Events Today" value={fmt(data.atAGlance.eventsToday)} color={ORANGE} />
            <Glance label="Failed Logins Today" value={fmt(data.atAGlance.failedLoginsToday)} color="#D14343" />
            <Glance label="High-Risk Events" value={fmt(data.atAGlance.highRiskToday)} color="#C08A2E" />
            <Glance label="Open Investigations" value={data.atAGlance.openInvestigations.available ? fmt(data.atAGlance.openInvestigations.value ?? 0) : 'Not tracked'} color={ORANGE} muted={!data.atAGlance.openInvestigations.available} />
            <Glance label="Legal Holds Active" value={data.atAGlance.legalHoldsActive.available ? fmt(data.atAGlance.legalHoldsActive.value ?? 0) : 'Not tracked'} color="#C08A2E" muted={!data.atAGlance.legalHoldsActive.available} />
            <Glance label="Exports Flagged" value={data.atAGlance.exportsFlagged.available ? fmt(data.atAGlance.exportsFlagged.value ?? 0) : 'Not tracked'} color="#D14343" muted={!data.atAGlance.exportsFlagged.available} />
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 12 }}>
          <button onClick={() => nav('/audit-logs/browse')} style={{ border: 'none', background: 'none', color: ORANGE, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Open the full paged audit log browser →</button>
        </div>
      </div>

      {flOpen ? (
        <div role="dialog" aria-label="Flagged Data Exports" onClick={() => setFlOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 600, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: TEXT }}>Flagged Data Exports</span>
              <button onClick={scanFlags} disabled={flBusy} style={{ marginLeft: 'auto', height: 32, padding: '0 14px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, fontSize: 12, cursor: flBusy ? 'default' : 'pointer', opacity: flBusy ? 0.7 : 1 }}>{flBusy ? 'Scanning…' : 'Scan recent exports'}</button>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Flags come from documented, versioned rules — content signals (large export, sensitive scope, failed export, off-hours) plus per-user behavioral signals (export velocity, and volume spikes vs the user's own baseline). They are recommendations — confirm (reviewed) or dismiss as a false positive with a reason. Nothing is auto-actioned.</div>
            {flMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700, marginBottom: 8 }}>{flMsg}</div> : null}
            {flags.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No open export flags. Run a scan to evaluate recent export activity.</div> : flags.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 11.5 }}>
                <span style={{ fontWeight: 700, color: RISK[f.risk] || MUTED, minWidth: 54 }}>{f.risk}</span>
                <span style={{ color: TEXT }}>{f.ruleKey}</span>
                <span style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{f.reason}</span>
                <button onClick={() => reviewFlag(f, false)} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: TEXT, padding: '2px 8px', cursor: 'pointer' }}>Reviewed</button>
                <button onClick={() => reviewFlag(f, true)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: SEM.bad, padding: '2px 8px', cursor: 'pointer' }}>Dismiss</button>
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 12 }}><button onClick={() => setFlOpen(false)} style={{ height: 34, padding: '0 16px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button></div>
          </div>
        </div>
      ) : null}

      {tcOpen ? (
        <div role="dialog" aria-label="Tamper-Resistance and Retention" onClick={() => setTcOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Tamper-Resistance &amp; Retention Status</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Record each control's configured value + verification status. Unset controls read “not configured” — the panel reflects recorded configuration, never a hardcoded state.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Control<select aria-label="Tamper control" value={tcForm.controlKey} onChange={(e) => setTcForm((f) => ({ ...f, controlKey: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{[['worm_storage', 'WORM Storage'], ['retention_policy', 'Retention Policy'], ['digital_signature', 'Digital Signature Validation'], ['backup_replication', 'Backup Replication'], ['encryption', 'Encryption']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Status<select aria-label="Control status" value={tcForm.status} onChange={(e) => setTcForm((f) => ({ ...f, status: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['compliant', 'active', 'enabled', 'degraded', 'failed', 'not_configured'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
            </div>
            <label style={{ fontSize: 11.5, color: '#5C5240', display: 'block', marginTop: 8 }}>Value<input aria-label="Control value" value={tcForm.value} onChange={(e) => setTcForm((f) => ({ ...f, value: e.target.value }))} placeholder="e.g. Enabled / 7 Years / AES-256 / Geo-Redundant" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
            {tcMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700, marginTop: 8 }}>{tcMsg}</div> : null}
            {tcErr ? <div style={{ fontSize: 11.5, color: SEM.bad, marginTop: 8 }}>{tcErr}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button onClick={() => setTcOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
              <button onClick={saveControl} disabled={tcBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: tcBusy ? 'default' : 'pointer', opacity: tcBusy ? 0.7 : 1 }}>{tcBusy ? 'Saving…' : 'Save control'}</button>
            </div>
            {controls.length ? (
              <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT, marginBottom: 6 }}>Current controls</div>
                {controls.map((c) => (<div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: `1px solid ${LINE}` }}><span style={{ color: TEXT }}>{c.label}</span><span style={{ color: MUTED, marginLeft: 'auto' }}>{c.value}</span><span style={{ fontWeight: 700, color: c.status === 'not_configured' ? MUTED : c.status === 'failed' || c.status === 'degraded' ? SEM.bad : SEM.good }}>{c.status.replace(/_/g, ' ')}</span>{c.status !== 'not_configured' ? <button onClick={() => verifyControl(c)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: ORANGE, padding: '2px 6px', cursor: 'pointer' }}>Verify</button> : null}</div>))}
              </div>
            ) : null}

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT }}>Per-category retention policies</div>
              <div style={{ fontSize: 10.5, color: MUTED, margin: '2px 0 8px' }}>{data?.retentionStatus.retention?.note ?? 'Retention is previewed only — never a delete. Legal holds always override retention.'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
                <label style={{ fontSize: 11, color: '#5C5240' }}>Category<select aria-label="Retention category" value={rpForm.category} onChange={(e) => setRpForm((f) => ({ ...f, category: e.target.value }))} style={{ height: 32, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['auth', 'tenants', 'customers', 'payments', 'devices', 'integrations', 'security', 'ai', 'communications', 'smart-reminders', 'audit-logs', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
                <label style={{ fontSize: 11, color: '#5C5240' }}>Hot days<input aria-label="Hot days" value={rpForm.hotDays} onChange={(e) => setRpForm((f) => ({ ...f, hotDays: e.target.value }))} style={{ height: 32, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                <label style={{ fontSize: 11, color: '#5C5240' }}>Archive days<input aria-label="Archive days" value={rpForm.archiveDays} onChange={(e) => setRpForm((f) => ({ ...f, archiveDays: e.target.value }))} style={{ height: 32, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 8px' }} /></label>
                <button onClick={saveRetention} disabled={rpBusy} style={{ height: 32, padding: '0 12px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, fontSize: 11, cursor: rpBusy ? 'default' : 'pointer', opacity: rpBusy ? 0.7 : 1 }}>{rpBusy ? '…' : 'Set'}</button>
              </div>
              {retentionPolicies.length ? (
                <div style={{ marginTop: 8 }}>
                  {retentionPolicies.map((p: ALRetentionPolicy) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', borderBottom: `1px solid ${LINE}` }}>
                      <span style={{ color: TEXT, minWidth: 96 }}>{p.category}</span>
                      <span style={{ color: MUTED }}>{p.hotDays}d hot + {p.archiveDays}d archive</span>
                      <span style={{ color: MUTED }}>v{p.version}</span>
                      <span style={{ marginLeft: 'auto', color: p.purgeEligible > 0 ? SEM.bad : MUTED, fontWeight: 700 }}>{fmt(p.purgeEligible)} eligible</span>
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>No retention policies configured yet.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {evOpen ? (
        <div role="dialog" aria-label="Audit Evidence" onClick={() => setEvOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 640, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: TEXT }}>Audit Evidence &amp; Chain of Custody</span>
              <button onClick={exportEvidence} disabled={evBusy} style={{ marginLeft: 'auto', height: 32, padding: '0 14px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, fontSize: 12, cursor: evBusy ? 'default' : 'pointer', opacity: evBusy ? 0.7 : 1 }}>{evBusy ? 'Generating…' : '⭳ Export new evidence'}</button>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Evidence packets are redacted (no secrets), carry a SHA-256 checksum + manifest, and every generation / access / download / verification is appended to an immutable chain of custody.</div>
            {evMsg ? <div style={{ fontSize: 11.5, color: evMsg.includes('FAILED') ? SEM.bad : '#3E8F57', fontWeight: 700, marginBottom: 8 }}>{evMsg}</div> : null}
            {evPacks.length === 0 ? <div style={{ color: MUTED, fontSize: 12 }}>No evidence packets yet. Generate one above.</div> : evPacks.map((p) => (
              <div key={p.id} style={{ padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ fontWeight: 700, color: TEXT }}>{p.packRef}</span>
                  <span style={{ color: MUTED }}>{p.eventCount} events</span>
                  <span style={{ color: MUTED, fontFamily: 'monospace', fontSize: 10 }}>sha256 {p.checksum.slice(0, 12)}…</span>
                  <span style={{ marginLeft: 'auto', color: p.status === 'ready' ? SEM.good : MUTED, fontWeight: 700 }}>{p.status}</span>
                  <button onClick={() => viewCustody(p)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: TEXT, padding: '2px 6px', cursor: 'pointer' }}>Custody</button>
                  <button onClick={() => verifyPack(p)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: ORANGE, padding: '2px 6px', cursor: 'pointer' }}>Verify</button>
                </div>
                {evCustody && evCustody.packId === p.id ? (
                  <div style={{ marginTop: 6, background: '#F7F4EE', borderRadius: 8, padding: 8, fontSize: 10.5 }}>
                    <div style={{ fontWeight: 700, color: TEXT, marginBottom: 4 }}>Chain of custody ({evCustody.entries.length})</div>
                    {evCustody.entries.map((c, i) => (<div key={i} style={{ color: c.entryType === 'verification_failed' ? SEM.bad : MUTED, padding: '1px 0' }}>· {new Date(c.at).toLocaleTimeString()} — {c.entryType}{c.actor ? ` (${c.actor})` : ''}</div>))}
                  </div>
                ) : null}
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 12 }}><button onClick={() => setEvOpen(false)} style={{ height: 34, padding: '0 16px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button></div>
          </div>
        </div>
      ) : null}

      {invOpen ? (
        <div role="dialog" aria-label="Investigations" onClick={() => setInvOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 620, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Investigations</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Open a case to link flagged events. Notes and linked events are append-only; the case timeline is immutable evidence and never rewrites the audit log.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr', gap: 8 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Title<input aria-label="Investigation title" value={invForm.title} onChange={(e) => setInvForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Suspicious export pattern" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Severity<select aria-label="Investigation severity" value={invForm.severity} onChange={(e) => setInvForm((f) => ({ ...f, severity: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Assignee (optional)<input aria-label="Investigation assignee" value={invForm.assignee} onChange={(e) => setInvForm((f) => ({ ...f, assignee: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Description (optional)<input aria-label="Investigation description" value={invForm.description} onChange={(e) => setInvForm((f) => ({ ...f, description: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
            </div>
            {invMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700, marginTop: 8 }}>{invMsg}</div> : null}
            {invErr ? <div style={{ fontSize: 11.5, color: SEM.bad, marginTop: 8 }}>{invErr}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button onClick={() => setInvOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
              <button onClick={createInvestigation} disabled={invBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: invBusy ? 'default' : 'pointer', opacity: invBusy ? 0.7 : 1 }}>{invBusy ? 'Opening…' : 'Open investigation'}</button>
            </div>
            {invList.length ? (
              <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT, marginBottom: 6 }}>Open cases</div>
                {invList.map((iv) => (
                  <div key={iv.id} style={{ padding: '5px 0', borderBottom: `1px solid ${LINE}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <button onClick={() => viewInvestigation(iv)} style={{ border: 'none', background: 'none', color: ORANGE, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{iv.caseRef}</button>
                      <span style={{ color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{iv.title}</span>
                      <span style={{ color: RISK[iv.severity] || MUTED, fontWeight: 700 }}>{iv.severity}</span>
                      <span style={{ marginLeft: 'auto', color: MUTED }}>{iv.status}</span>
                      <button onClick={() => addInvNote(iv)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: TEXT, padding: '2px 6px', cursor: 'pointer' }}>+ Note</button>
                      <select aria-label={`Status ${iv.caseRef}`} value={iv.status} onChange={(e) => changeInvStatus(iv, e.target.value)} style={{ height: 24, borderRadius: 6, border: `1px solid ${LINE}`, fontSize: 10 }}>{['open', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    </div>
                    {invSelected && invSelected.investigation.id === iv.id ? (
                      <div style={{ marginTop: 6, background: '#F7F4EE', borderRadius: 8, padding: 8, fontSize: 10.5 }}>
                        <div style={{ fontWeight: 700, color: TEXT, marginBottom: 4 }}>Immutable timeline ({invSelected.timeline.length})</div>
                        {invSelected.timeline.map((t) => (<div key={t.id} style={{ color: MUTED, padding: '1px 0' }}>· {new Date(t.createdAt).toLocaleTimeString()} — {t.entryType}{t.entryType === 'status_change' ? `: ${t.payload.from} → ${t.payload.to}` : t.entryType === 'note' ? `: ${t.payload.note}` : t.entryType === 'event_linked' ? `: ${t.payload.eventRef}` : ''}</div>))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {holdOpen ? (
        <div role="dialog" aria-label="Place Logs Under Legal Hold" onClick={() => setHoldOpen(false)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 520, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: TEXT }}>Place Logs Under Legal Hold</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>A hold protects a defined slice of audit events from retention purges. It never edits or deletes any log row. A reason is required.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Scope<select aria-label="Hold scope type" value={holdForm.scopeType} onChange={(e) => setHoldForm((f) => ({ ...f, scopeType: e.target.value }))} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}` }}>{['tenant', 'user', 'action', 'date_range', 'global'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                <label style={{ fontSize: 11.5, color: '#5C5240' }}>Scope value {holdForm.scopeType === 'global' ? '(not needed)' : ''}<input aria-label="Hold scope value" value={holdForm.scopeValue} disabled={holdForm.scopeType === 'global'} onChange={(e) => setHoldForm((f) => ({ ...f, scopeValue: e.target.value }))} placeholder={holdForm.scopeType === 'date_range' ? 'startISO|endISO' : holdForm.scopeType === 'action' ? 'e.g. export' : 'tenant/user id'} style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
              </div>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Reason (required)<textarea aria-label="Hold reason" value={holdForm.reason} onChange={(e) => setHoldForm((f) => ({ ...f, reason: e.target.value }))} rows={2} placeholder="e.g. Litigation preservation — Case 24-CV-1187" style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: 8, resize: 'vertical', fontFamily: 'inherit' }} /></label>
              <label style={{ fontSize: 11.5, color: '#5C5240' }}>Legal authority (optional)<input aria-label="Legal authority" value={holdForm.legalAuthority} onChange={(e) => setHoldForm((f) => ({ ...f, legalAuthority: e.target.value }))} placeholder="Court order / case reference" style={{ height: 34, width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px' }} /></label>
              {holdMsg ? <div style={{ fontSize: 11.5, color: '#3E8F57', fontWeight: 700 }}>{holdMsg}</div> : null}
              {holdErr ? <div style={{ fontSize: 11.5, color: SEM.bad }}>{holdErr}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setHoldOpen(false)} style={{ height: 34, padding: '0 14px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button>
                <button onClick={placeHold} disabled={holdBusy} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: holdBusy ? 'default' : 'pointer', opacity: holdBusy ? 0.7 : 1 }}>{holdBusy ? 'Placing…' : 'Place hold'}</button>
              </div>
              {holds.length ? (
                <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT, marginBottom: 6 }}>Existing holds</div>
                  {holds.map((h) => (<div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: `1px solid ${LINE}` }}><span style={{ fontWeight: 700, color: TEXT }}>{h.holdRef}</span><span style={{ color: MUTED }}>{h.scopeType}{h.scopeValue ? ':' + h.scopeValue : ''}</span><span style={{ color: h.status === 'active' ? SEM.warn : MUTED }}>{h.status}</span>{h.status === 'active' ? <button onClick={() => releaseHold(h)} style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 10, fontWeight: 700, color: SEM.bad, padding: '2px 8px', cursor: 'pointer' }}>Release</button> : null}</div>))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div role="dialog" aria-label={modal} onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: '#00000055', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, width: 420, maxWidth: '92vw' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: TEXT }}>{modal}</div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>This is a permissioned, tamper-resistant workflow — audit logs are append-only and can never be edited or deleted here. The oversight dashboard is live and reconciles from real audit data; this specific workflow is delivered in an upcoming unit of the Audit Logs build.</div>
            <div style={{ marginTop: 16, textAlign: 'right' }}><button onClick={() => setModal(null)} style={{ height: 34, padding: '0 16px', border: 'none', borderRadius: 8, background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Close</button></div>
          </div>
        </div>
      ) : null}
      {askUi}
    </div>
  );
}

function Table({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return <div style={{ ...card, padding: 16 }}><TableInner title={title} headers={headers} rows={rows} empty={empty} /></div>;
}
function TableInner({ title, headers, rows, empty }: { title: string; headers: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: TEXT, marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? <div style={{ color: MUTED, fontSize: 12, padding: '12px 0' }}>{empty}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr>{headers.map((h) => <th key={h} style={{ textAlign: 'left', color: MUTED, fontWeight: 600, padding: '6px 8px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '6px 8px', borderBottom: `1px solid ${LINE}`, color: TEXT, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</td>)}</tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function Glance({ label, value, color, muted }: { label: string; value: string; color: string; muted?: boolean }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}1A`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Dot color={color} /></span><span style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{label}</span></div>
      <div style={{ fontSize: 19, fontWeight: 800, color: muted ? '#B8AE9E' : TEXT }}>{value}</div>
    </div>
  );
}
