import type { TenantHealth, IntegrationState } from '@aipowersalon/api-contracts/platform';
import type { MaskedPaymentGateway } from '@aipowersalon/api-contracts/tenant';
import type { AppLanguage, TenantPosLanguage } from '@aipowersalon/api-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi, type DirectoryOverview, type CredentialDeliveryMethod, type CredentialDeliveryResult } from '../api/superAdminApi';
import { superAdminOverviewApi, type OverviewState } from '../api/superAdminOverviewApi';
import { hwApi } from '../api/superAdminHardwarePackagesApi';
import { TenantDirectoryAnalytics, type TrendBadge } from '../components/TenantDirectoryAnalytics';
import { RevenueByTenantBars } from '../components/RevenueByTenantBars';
import { AppControlsPanel } from './AppControlsPanel';
import { useCan } from '../auth/useCan';

// Health vocabulary (Constitution 11 §293). UNKNOWN = not in use / no traffic yet — shown as such, never as healthy.
const HEALTH_LABEL: Record<IntegrationState, string> = { HEALTHY: 'Healthy', DEGRADED: 'Degraded', MISCONFIGURED: 'Misconfigured', RATE_LIMITED: 'Rate limited', OUTAGE: 'Outage', UNKNOWN: 'Not in use' };
const HEALTH_COLOR: Record<IntegrationState, [string, string]> = { HEALTHY: ['#EAF5EE', '#3E8F57'], DEGRADED: ['#FFF6E5', '#D09A36'], MISCONFIGURED: ['#FFF6E5', '#D09A36'], RATE_LIMITED: ['#FFF6E5', '#D09A36'], OUTAGE: ['#FBEFE9', '#B85B4D'], UNKNOWN: ['#F2EEE8', '#8A8175'] };
const HEALTH_COMPONENT: Record<keyof TenantHealth['components'], string> = { payments: 'Payments', messaging: 'Messaging', booking: 'Booking', devices: 'Devices', jobs: 'Background jobs' };
const PROCESSOR_LABEL: Record<string, string> = { fiserv: 'Fiserv', cardpointe: 'CardPointe', clover: 'Clover' };


// Super-Admin → Tenants / Salons (design parity). Reuses the REAL endpoints — no duplicate backend:
//   • GET /super-admin/tenants/state  (KPIs + rows + pagination + filters q/state/plan/pay/setup/tab/page)
//   • GET /super-admin/overview/state (Pending Applications + Monthly Card Volume + the 3 bottom cards)
//   • GET /super-admin/tenants/:id/payment-gateway (detail panel gateway)
//   • POST suspend / reactivate / reset-owner-password / create (lifecycle + create modal)
// Layout: 6 KPI cards · filter bar · tenants table (select → right detail panel) · promo banner · 3 analytics cards.

type Row = {
  id: string; n: string; code: string; owner: string; email: string; phone: string; city: string; state: string;
  plan: string; planTier: string; ai: string; rev: string; use: number; pay: string; paymentSetup: string; status: string; sl: string;
  aiEnabled: boolean; fiserv: boolean; last: string; created: string; payoff: string;
  branches: number; posDevices?: number | null; subscription?: string | null; cust: [number, number]; healthScore?: number | null; healthBand?: string; churnRisk?: string; commissionPct?: number;
};
type Kpi = { lab: string; val: string; d: string; dt: string };
type State = { kpis: Kpi[]; tenants: Row[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };

const STATUS_BADGE: Record<string, { t: string; bg: string; fg: string }> = {
  healthy: { t: 'Active', bg: '#EAF5EE', fg: '#3E8F57' },
  warning: { t: 'Trial', bg: '#EFE9FB', fg: '#7B5BB6' },
  pastdue: { t: 'Past Due', bg: '#FBEFE9', fg: '#B85B4D' },
  setup: { t: 'Pending', bg: '#FFF6E5', fg: '#D09A36' },
  suspended: { t: 'Paused', bg: '#FBF0E5', fg: '#C77A2A' },
  cancelled: { t: 'Cancelled', bg: '#EEF0F2', fg: '#6B7280' },
};
// Delivery status of a sent warning (set by the dispatch worker): honest about what actually went out.
const WARN_BADGE: Record<string, { t: string; bg: string; fg: string }> = {
  sent: { t: 'Sent', bg: '#EAF5EE', fg: '#3E8F57' },
  pending: { t: 'Pending', bg: '#FFF6E5', fg: '#D09A36' },
  skipped: { t: 'Skipped', bg: '#EEF0F2', fg: '#6B7280' },
  failed: { t: 'Failed', bg: '#FBEFE9', fg: '#B85B4D' },
  recorded: { t: 'Recorded', bg: '#EAF0F6', fg: '#3E6A8F' },
};
const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
};
const hwBadge = (payoff: string) => /paid/i.test(payoff) ? { t: 'Complete', bg: '#EAF5EE', fg: '#3E8F57', ic: '✓' }
  : /financ/i.test(payoff) ? { t: 'Shipped', bg: '#EAF2FB', fg: '#3C7FB6', ic: '🚚' }
  : /deposit/i.test(payoff) ? { t: 'Pending', bg: '#FFF6E5', fg: '#D09A36', ic: '◷' } : { t: 'Not Ordered', bg: '#FBEFE9', fg: '#B85B4D', ic: '○' };
// KPI deep-link ?status= → table tab key (and back). 'paused' is the friendly name for the 'suspended' tab.
const STATUS_PARAM_TO_TAB: Record<string, string> = { active: 'active', paused: 'suspended', trial: 'trial', pending: 'setup', suspended: 'suspended', cancelled: 'cancelled' };
const TAB_TO_STATUS_PARAM: Record<string, string> = { active: 'active', suspended: 'paused', trial: 'trial', setup: 'pending', cancelled: 'cancelled' };
// Real month-over-month trend (from the overview snapshot deltas). invert ⇒ a drop is the good outcome.
const momTrend = (v: number | null | undefined, invert?: boolean) =>
  v == null ? { d: '', good: true } : { d: `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}% vs last month`, good: invert ? v <= 0 : v >= 0 };
const avatarOf = (n: string) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// Tenant health band → dot colour (matches the Tenant Health & Alerts distribution).
const healthColor = (band?: string) => band === 'excellent' || band === 'good' ? '#3E8F57'
  : band === 'average' ? '#D09A36' : band === 'poor' ? '#C77A2A' : band === 'critical' ? '#B85B4D' : '#9B8B78';
// Churn risk → colour (derived by the health engine alongside the score).
const churnColor = (risk?: string) => risk === 'high' ? '#B85B4D' : risk === 'medium' ? '#C77A2A' : risk === 'low' ? '#3E8F57' : '#9B8B78';
const inp: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
// Application status → badge colour + label (matches the full Tenant Applications page vocabulary).
const appBadge = (s: string): { bg: string; fg: string; t: string } => {
  const v = (s || '').toLowerCase();
  if (/approved|qualified|converted/.test(v)) return { bg: '#EAF5EE', fg: '#3E8F57', t: label(v) };
  if (/reject|not_qualified/.test(v)) return { bg: '#FBEFE9', fg: '#B85B4D', t: label(v) };
  if (/waiting|document/.test(v)) return { bg: '#FBF0E5', fg: '#C77A2A', t: label(v) };
  if (/review|reviewing|demo/.test(v)) return { bg: '#FFF6E5', fg: '#D09A36', t: label(v) };
  if (/archiv/.test(v)) return { bg: '#EEEAE3', fg: '#8A8076', t: label(v) };
  return { bg: '#EFE9FB', fg: '#7B5BB6', t: label(v) || 'New' };   // new → purple
};
const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const agoLabel = (iso?: string) => {
  if (!iso) return '';
  const t = new Date(iso).getTime(); if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// Constitution 7 §18 — a suspension says why (the server refuses one without a code and a written reason).
const MIN_REASON = 10;
export const SUSPENSION_REASONS: Array<[string, string]> = [
  ['BILLING', 'Billing'], ['SECURITY', 'Security'], ['TERMS', 'Terms of service'], ['FRAUD', 'Fraud'],
  ['TENANT_REQUEST', 'Tenant request'], ['PLATFORM_OPERATION', 'Platform operation'], ['OTHER', 'Other'],
];
function ReasonCodeSelect({ value, onChange, inp }: { value: string; onChange: (v: string) => void; inp: React.CSSProperties }) {
  return (
    <label style={{ display: 'block', fontSize: 12, color: 'var(--soft)', marginBottom: 8 }}>Suspension reason (required)
      <select aria-label="Suspension reason" style={{ ...inp, width: '100%', marginTop: 4 }} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {SUSPENSION_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

// Constitution 7 §16 — the tenant's lifecycle state and the moves the server's transition table allows from it.
export const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: 'Draft', ONBOARDING: 'Onboarding', PENDING_APPROVAL: 'Pending approval', ACTIVE: 'Active', PAST_DUE: 'Past due',
  RESTRICTED: 'Restricted', SUSPENDED: 'Suspended', CLOSED: 'Closed', ARCHIVED: 'Archived',
};
const CAPABILITY_LABELS: Record<string, string> = { employeeLogin: 'Staff sign-in', customerBooking: 'Customer bookings', paymentSettlements: 'Payment settlements',
  scheduledCommunications: 'Scheduled messages', ownerBillingAccess: 'Owner billing access', dataExport: 'Data export' };
function LifecyclePanel({ tenantId, state, moves, inp, onChanged, policy, reasonCode }: { tenantId: string; state: string | null; moves: string[]; inp: React.CSSProperties; onChanged: (msg: string) => void;
    policy?: Array<{ capability: string; allowed: boolean; effective: boolean | null; enforced: boolean }> | null; reasonCode?: string | null }) {
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state) return null;                                   // repos without lifecycle (in-memory dev) show nothing, not a guess
  const needsCode = to === 'SUSPENDED' || to === 'RESTRICTED';
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await superAdminApi.changeLifecycle(tenantId, to, reason.trim() || undefined, needsCode ? code : undefined);
      if (r?.ok === false) { setErr(r.errors?.[0] || 'That change is not allowed.'); return; }
      // §20: reactivation reports integrations that stay disabled as compromised
      onChanged(`Lifecycle changed to ${LIFECYCLE_LABELS[to] ?? to}.${(r as any).warnings?.length ? ' ' + (r as any).warnings.join(' ') : ''}`); setTo(''); setCode(''); setReason('');
    } catch (e: any) { setErr(e?.message || 'That change is not allowed.'); } finally { setBusy(false); }
  };
  return (
    <div className="dsec" data-testid="tenant-lifecycle">
      <div className="dlabel">Lifecycle</div>
      <div className="dkv"><span>State</span><span className="badge">{LIFECYCLE_LABELS[state] ?? state}</span></div>
      {policy ? (
        <div data-testid="suspension-policy" style={{ margin: '6px 0', fontSize: 12 }}>
          <div className="muted">While suspended{reasonCode ? ` (${SUSPENSION_REASONS.find(([k]) => k === reasonCode)?.[1] ?? reasonCode})` : ''}:</div>
          {policy.map((l) => (
            <div key={l.capability} className="dkv">
              <span>{CAPABILITY_LABELS[l.capability] ?? l.capability}</span>
              <span>{l.allowed ? 'Allowed' : 'Stopped'}{l.enforced ? '' : <span className="muted"> · not yet enforced{l.effective === null ? ' (not gated)' : l.effective ? ' (still on)' : ' (currently stopped)'}</span>}</span>
            </div>
          ))}
        </div>
      ) : null}
      {moves.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No further changes (final state).</div> : (
        <>
          <select aria-label="Move lifecycle to" style={{ ...inp, width: '100%', marginTop: 6 }} value={to} onChange={(e) => { setTo(e.target.value); setErr(null); }}>
            <option value="">Change lifecycle…</option>
            {moves.map((m) => <option key={m} value={m}>{LIFECYCLE_LABELS[m] ?? m}</option>)}
          </select>
          {to ? (
            <>
              {needsCode ? <ReasonCodeSelect value={code} onChange={setCode} inp={inp} /> : null}
              <input aria-label="Lifecycle reason" style={{ ...inp, width: '100%', marginTop: 6 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (logged with the audit event)" />
              {err ? <div className="error" role="alert" style={{ marginTop: 6 }}>{err}</div> : null}
              <button className="btn" style={{ marginTop: 6 }} disabled={busy || (needsCode && (!code || reason.trim().length < MIN_REASON))} onClick={apply}>{busy ? 'Saving…' : 'Apply'}</button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Vietnamese POS mandate WP-A §93: the salon's DEFAULT POS language. Super Admin stays English — the options are labelled
 *  "English" / "Vietnamese" here. The owner can still change it in POS Settings; staff who picked their own language keep it.
 *  Saving is a step-up action (the API client re-prompts) and is audited with the optional reason. */
const POS_LANGUAGE_LABEL: Record<AppLanguage, string> = { en: 'English', vi: 'Vietnamese' };
function PosLanguagePanel({ tenantId, inp, canEdit, onChanged }: { tenantId: string; inp: React.CSSProperties; canEdit: boolean; onChanged: (msg: string) => void }) {
  const [cur, setCur] = useState<TenantPosLanguage | null | 'error'>(null);
  const [pick, setPick] = useState<AppLanguage | ''>('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    superAdminApi.tenantPosLanguage(tenantId).then((r) => { if (live) { setCur(r); setPick(r.language ?? ''); } }).catch(() => { if (live) setCur('error'); });
    return () => { live = false; };
  }, [tenantId]);
  const save = async () => {
    if (!pick) return;
    setBusy(true); setErr(null);
    try {
      const r = await superAdminApi.setTenantPosLanguage(tenantId, { language: pick, reason: reason.trim() || null });
      setCur(r); setReason('');
      onChanged(r.changed ? `Default POS language set to ${POS_LANGUAGE_LABEL[r.effective]}.` : `Default POS language is already ${POS_LANGUAGE_LABEL[r.effective]}.`);
    } catch (e: any) { setErr(e?.message || 'The default POS language could not be saved.'); } finally { setBusy(false); }
  };
  const own = cur && cur !== 'error' ? cur.staffWithOwnChoice.en + cur.staffWithOwnChoice.vi : 0;
  return (
    <div className="dsec" data-testid="tenant-pos-language">
      <div className="dlabel">Default POS Language</div>
      {cur === null ? <div className="mut">Loading…</div> : cur === 'error' ? <div className="mut">The POS language could not be read right now.</div> : (<>
        <div className="dkv"><span>Current</span><b>{cur.language ? POS_LANGUAGE_LABEL[cur.language] : 'Not set (English)'}</b></div>
        {own > 0 ? <div className="muted" style={{ fontSize: 11.5 }}>{own} staff member{own === 1 ? ' has' : 's have'} chosen their own language and keep it.</div> : null}
        {canEdit ? (<>
          <select aria-label="Default POS language" style={{ ...inp, width: '100%', marginTop: 6 }} value={pick} onChange={(e) => { setPick(e.target.value as AppLanguage); setErr(null); }}>
            {cur.language ? null : <option value="">Choose a language…</option>}
            <option value="en">English</option>
            <option value="vi">Vietnamese</option>
          </select>
          {pick && pick !== cur.language ? (<>
            <input aria-label="POS language change reason" style={{ ...inp, width: '100%', marginTop: 6 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, logged with the audit event)" />
            {err ? <div className="error" role="alert" style={{ marginTop: 6 }}>{err}</div> : null}
            <button className="btn" style={{ marginTop: 6 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Language'}</button>
          </>) : null}
        </>) : null}
      </>)}
    </div>
  );
}

const availablePlans = ['Starter', 'Professional', 'Enterprise', 'Unlimited', 'Standard', 'Custom'];
export function TenantsScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [s, setS] = useState<State | null>(null);
  const [ov, setOv] = useState<OverviewState | null>(null);
  const [dir, setDir] = useState<DirectoryOverview | null>(null);
  const [topPerf, setTopPerf] = useState<Awaited<ReturnType<typeof superAdminApi.topPerformingTenants>>['tenants'] | null>(null);
  const [topPerfErr, setTopPerfErr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  // ── RESET OWNER PASSWORD ──────────────────────────────────────────────────────────────────────────────
  //
  // The header comment at the top of THIS FILE says it does "suspend / reactivate / reset-owner-password /
  // create". It never did. `superAdminApi.resetOwnerPassword` existed, the route existed, and no screen has ever
  // called it — while owner-web had no forgot-password link either.
  //
  // A salon owner who forgot their password was locked out of their own business permanently: no self-serve
  // path, and no support path. Both are wired now.
  // Security Deep Scan C2: reason → POST reset-owner-password (step-up via the api client) → "sent to j***@x.com"
  const [ownerPw, setOwnerPw] = useState<{ id: string; tenant: string; reason: string; method: CredentialDeliveryMethod; busy: boolean; err: string | null; sent?: CredentialDeliveryResult } | null>(null);
  const sendOwnerReset = async () => {
    const cur = ownerPw; if (!cur) return;
    setOwnerPw({ ...cur, busy: true, err: null });
    try {
      const r = await superAdminApi.resetOwnerPassword(cur.id, { reason: cur.reason.trim(), deliveryMethod: cur.method });
      setOwnerPw({ ...cur, busy: false, err: null, sent: r });
    } catch (e: any) { setOwnerPw({ ...cur, busy: false, err: e?.message || 'The password could not be reset. Nothing was changed.' }); }
  };
  const [selId, setSelId] = useState<string | null>(null);
  const [gateway, setGateway] = useState<MaskedPaymentGateway | null>(null);
  // Constitution 11 §293 — the selected salon's health; 'error' = the read itself failed (shown, never as "healthy")
  const [health, setHealth] = useState<TenantHealth | 'error' | null>(null);
  const [hwCard, setHwCard] = useState<any | null>(null);
  const [warnings, setWarnings] = useState<Array<{ id: string; warningType: string; severity: string; subject: string; message: string; sendEmail: boolean; sendSms: boolean; deliveryStatus: string; createdAt: string }>>([]);
  // Quick Actions: confirm (pause/activate) + send-warning modals
  const [confirm, setConfirm] = useState<{ id: string; target: 'paused' | 'active'; name: string } | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmCode, setConfirmCode] = useState('');   // Constitution 7 §18: suspension reason code
  const [warnFor, setWarnFor] = useState<{ id: string; name: string } | null>(null);
  const [warn, setWarn] = useState({ warningType: 'payment_issue', severity: 'medium', subject: '', message: '', sendEmail: true, sendSms: false, showInTenantDashboard: true, internalNote: '' });
  const [sortBy, setSortBy] = useState<string>(''); const [sortDir, setSortDir] = useState<1 | -1>(1);
  // filters
  const [search, setSearch] = useState(params.get('search') || '');
  const [stateF, setStateF] = useState('');
  const [statusF, setStatusF] = useState(STATUS_PARAM_TO_TAB[params.get('status') || ''] || '');
  const [planF, setPlanF] = useState(params.get('plan') || '');
  const [setupF, setSetupF] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1); const pageSize = 10;
  // table reference for smooth scrolling on KPI card click
  const tableRef = useRef<HTMLDivElement>(null);

  const scrollToTable = () => {
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 80);
  };

  // create modal
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<{ target: 'paused' | 'active' } | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkCode, setBulkCode] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [c, setC] = useState({ name: '', code: '', first: '', last: '', email: '', phone: '', city: '', state: '', plan: 'Professional', ai: 'None', initialCommissionPercent: '50' });

  const [generatedCode, setGeneratedCode] = useState<{ code: string; tenantId: string } | null>(null);

  const [editCommTenant, setEditCommTenant] = useState<{ id: string; name: string } | null>(null);
  const [editCommVal, setEditCommVal] = useState<string>('50');

  const query = useMemo(() => ({
    tab: statusF || 'all', q: search || undefined, state: stateF || undefined, plan: planF || undefined,
    setup: (setupF || undefined) as any, page, pageSize,
  }), [statusF, search, stateF, planF, setupF, page]);

  const urlTenantId = useEventCallback(() => params.get('tenantId'));   // read at load time, not a reason to reload
  const load = useCallback(() => {
    setLoading(true);
    return (superAdminApi.state(query) as Promise<State>)
      .then((r) => { setS(r); if (!selId && r.tenants[0]) setSelId(urlTenantId() || r.tenants[0].id); })
      .catch((e: any) => setError(e?.message || 'Failed to load tenants.'))
      .finally(() => setLoading(false));
  }, [query, selId, urlTenantId]);

  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);
  useEffect(() => { if (!selId) { setHwCard(null); return; } let alive = true; hwApi.tenantHardware(selId).then((r) => { if (alive) setHwCard(r?.package ? r : null); }).catch(() => { if (alive) setHwCard(null); }); return () => { alive = false; }; }, [selId]);
  const can = useCan(); const mayAnalytics = can('super_admin.analytics.view'), mayOps = can('super_admin.system_operations.view');
  useEffect(() => { if (mayAnalytics) superAdminOverviewApi.state().then(setOv).catch(() => {}); }, [mayAnalytics]);
  const loadDir = useCallback(() => superAdminApi.directoryOverview().then(setDir).catch(() => {}), []);
  useEffect(() => { loadDir(); }, [loadDir]);
  const loadTopPerf = useCallback(() => mayAnalytics ? superAdminApi.topPerformingTenants(10).then((r) => { setTopPerf(r.tenants); setTopPerfErr(false); }).catch(() => setTopPerfErr(true)) : Promise.resolve(setTopPerfErr(true)), [mayAnalytics]);
  useEffect(() => { loadTopPerf(); }, [loadTopPerf]);
  useEffect(() => { if (!selId) { setGateway(null); return; } superAdminApi.getGateway(selId).then(setGateway).catch(() => setGateway(null)); }, [selId]);
  useEffect(() => {
    if (!selId) { setHealth(null); return; }
    let alive = true; setHealth(null);
    if (!mayOps) { setHealth('error'); return; }
    superAdminApi.tenantHealth(selId).then((h) => { if (alive) setHealth(h); }).catch(() => { if (alive) setHealth('error'); });
    return () => { alive = false; };
  }, [selId, mayOps]);
  const loadWarnings = useCallback((id: string | null) => { if (!id) { setWarnings([]); return; } superAdminApi.tenantWarnings(id).then(setWarnings).catch(() => setWarnings([])); }, []);
  useEffect(() => { loadWarnings(selId); }, [selId, loadWarnings]);

  const refetch = () => load();
  const act = async (id: string, fn: () => Promise<any>, kind: string, after?: (r: any) => void) => {
    setNote(null); setBusy(id + kind); setMenuId(null);
    try { const r = await fn(); if (after) after(r); await refetch(); }
    catch (e: any) { setNote(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const refreshOverview = () => mayAnalytics ? superAdminOverviewApi.state().then(setOv).catch(() => {}) : Promise.resolve();
  // Pause/Activate now go through a confirmation modal, then PATCH /status (audited tenant_paused/tenant_activated).
  const pause = (id: string, name = 'this tenant') => { setMenuId(null); setConfirmReason(''); setConfirmCode(''); setConfirm({ id, target: 'paused', name }); };
  const activate = (id: string, name = 'this tenant') => { setMenuId(null); setConfirmReason(''); setConfirm({ id, target: 'active', name }); };
  const doStatus = async (id: string, target: 'paused' | 'active', reason: string, reasonCode?: string) => {
    setConfirm(null); setNote(null); setBusy(id + target); setMenuId(null);
    try {
      const r = await superAdminApi.changeStatus(id, target, reason || undefined, target === 'paused' ? reasonCode : undefined);
      if (r?.ok === false) { setNote(r.errors?.[0] || 'Status change could not be applied from the current state.'); return; }
      setNote(r?.warning || (target === 'active' ? 'Tenant activated.' : 'Tenant paused.'));
      await refetch(); refreshOverview();                       // sync table row + KPI cards + recent activity
    } catch (e: any) { setNote(e?.message || 'Status change failed.'); } finally { setBusy(null); }
  };
  // Support Mode → create a time-limited, audited support session server-side (reason + step-up); the shell banner shows it.
  // Constitution 7 §74: entering a salon's POS is Support Mode — it needs a real reason (asked here) and step-up (the shared prompt)
  const [posAsk, setPosAsk] = useState<{ id: string; reason: string } | null>(null);
  const viewPos = (id: string) => { setMenuId(null); setNote(null); setPosAsk({ id, reason: '' }); };
  const openPos = async (id: string, reason: string) => {
    setPosAsk(null); setBusy(id + 'pos'); setNote(null);
    try {
      const r = await superAdminApi.supportAccess(id, { reason: reason.trim(), source: 'tenants_salons_quick_actions' });
      if (r?.ok) { setNote(`Support Mode started for this salon until ${r.expiresAt ? new Date(r.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'it expires'} — the banner at the top shows it; oversight screens now serve this support session.`); window.dispatchEvent(new CustomEvent('aps:support-mode-changed')); }
      else setNote(r?.errors?.[0] || 'Could not open POS.');
    } catch (e: any) { setNote(e?.message || 'Could not open POS.'); } finally { setBusy(null); }
  };
  const support = (id: string) => viewPos(id);
  const submitWarn = async () => {
    if (!warnFor) return;
    if (!warn.subject.trim() || !warn.message.trim()) { setNote('Subject and message are required.'); return; }
    setBusy(warnFor.id + 'warn');
    try {
      const r = await superAdminApi.sendWarning(warnFor.id, warn);
      if (r?.ok === false) { setNote(r.errors?.[0] || 'Could not send warning.'); return; }
      setNote(`Warning sent to ${warnFor.name} (${r?.deliveryStatus || 'recorded'}).`);
      setWarnFor(null);
      setWarn({ warningType: 'payment_issue', severity: 'medium', subject: '', message: '', sendEmail: true, sendSms: false, showInTenantDashboard: true, internalNote: '' });
      refreshOverview();                                        // recent activity reflects warning_sent
      loadWarnings(warnFor.id);                                 // surface the new warning + its delivery status
    } catch (e: any) { setNote(e?.message || 'Could not send warning.'); } finally { setBusy(null); }
  };

  const rowsSorted = useMemo(() => {
    const rows = s?.tenants ? [...s.tenants] : [];
    if (!sortBy) return rows;
    const get = (r: Row) => sortBy === 'n' ? r.n.toLowerCase() : sortBy === 'plan' ? r.plan : sortBy === 'status' ? r.sl
      : sortBy === 'rev' ? parseFloat(r.rev.replace(/[^0-9.]/g, '')) || 0 : sortBy === 'last' ? r.last
      : sortBy === 'branches' ? r.branches : sortBy === 'cust' ? (r.cust?.[0] || 0) : sortBy === 'health' ? (r.healthScore ?? -1) : '';
    return rows.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
  }, [s, sortBy, sortDir]);
  const sortOn = (k: string) => { if (sortBy === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortBy(k); setSortDir(1); } };
  const clearFilters = () => {
    setSearch('');
    setStateF('');
    setStatusF('');
    setPlanF('');
    setSetupF('');
    setPage(1);
    const p = new URLSearchParams(params);
    p.delete('status');
    p.delete('plan');
    p.delete('search');
    setParams(p, { replace: true });
  };

  // Refresh: refetch the summary KPIs + table (with current filters/sort/page/selection) AND the overview-fed
  // cards (Pending Apps, Monthly Card Volume, Recent Activity, Recent Applications, Top Performing Tenants).
  const doRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true); setNote(null);
    try { await Promise.all([refetch(), refreshOverview(), loadTopPerf(), loadDir()]); setNote('Tenants / Salons data refreshed.'); }
    catch { setNote('Unable to refresh Tenants / Salons data.'); }
    finally { setRefreshing(false); }
  };
  // KPI click → apply a status filter and sync ?status= (stay on this page); preserves search/plan/setup.
  const applyStatus = (tab: string) => {
    setStatusF(tab);
    setPage(1);
    const p = new URLSearchParams(params);
    const sp = TAB_TO_STATUS_PARAM[tab];
    if (sp) p.set('status', sp);
    else p.delete('status');
    setParams(p, { replace: true });
  };

  const sel = rowsSorted.find((r) => r.id === selId) || s?.tenants.find((r) => r.id === selId) || null;
  const pag = s?.pagination;

  // 12-KPI grid + analytics come from the directory-overview endpoint (TenantDirectoryAnalytics). KPI/legend/alert
  // clicks route here, reusing the existing filter + nav handlers (no new endpoints).
  const tr: Partial<Record<string, number | null>> = ov?.kpis.trends ?? {};
  const kpiTrends: Record<string, TrendBadge> = {
    all: momTrend(tr.totalTenants, false), active: momTrend(tr.activeSalons, false),
    suspended: momTrend(tr.pausedTenants, true), trial: momTrend(tr.trialTenants, false),
    pending: momTrend(tr.pendingApplications, true), revenue: momTrend(tr.monthlyCardVolume, false),
  };

  const activeKpi = useMemo(() => {
    if (statusF === 'active') return 'active';
    if (statusF === 'suspended') return 'suspended';
    if (statusF === 'trial') return 'trial';
    if (statusF === 'setup') return 'pending';
    if (planF.toLowerCase() === 'enterprise') return 'enterprise';
    if (!statusF && !planF && !search && !stateF && !setupF) return 'all';
    return undefined;
  }, [statusF, planF, search, stateF, setupF]);

  const handleKpi = (key: string) => {
    if (key === 'all') {
      clearFilters();
      scrollToTable();
      return;
    }
    if (key === 'active') {
      setStatusF('active');
      setPlanF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('status', 'active');
      p.delete('plan');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key === 'suspended' || key === 'paused') {
      setStatusF('suspended');
      setPlanF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('status', 'paused');
      p.delete('plan');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key === 'trial') {
      setStatusF('trial');
      setPlanF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('status', 'trial');
      p.delete('plan');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key === 'pending' || key === 'setup') {
      setStatusF('setup');
      setPlanF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('status', 'pending');
      p.delete('plan');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key === 'enterprise') {
      setPlanF('Enterprise');
      setStatusF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('plan', 'Enterprise');
      p.delete('status');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key.startsWith('plan:')) {
      const raw = key.slice(5).trim();
      const slice = dir?.planDistribution.find((pl) => pl.key.toLowerCase() === raw.toLowerCase() || pl.label.toLowerCase() === raw.toLowerCase());
      const matchedPlan = slice ? slice.label : (availablePlans.find((pl) => pl.toLowerCase() === raw.toLowerCase()) || raw);
      setPlanF(matchedPlan);
      setStatusF('');
      setPage(1);
      const p = new URLSearchParams(params);
      p.set('plan', matchedPlan);
      p.delete('status');
      setParams(p, { replace: true });
      scrollToTable();
      return;
    }
    if (key === 'onboarding' || key.startsWith('onboarding:') || key === 'alert:pending_onboarding') {
      nav('/tenant-applications?source=tenants-directory');
      return;
    }
    if (key === 'branches') { nav('/branches?source=tenants-directory'); return; }
    if (key === 'devices') { nav('/check-in-devices?source=tenants-directory'); return; }
    if (key === 'customers') { nav('/customer-data-oversight?source=tenants-directory'); return; }
    if (key === 'revenue' || key === 'plans') { nav('/platform-reports?report=tenant-performance&period=current-month&source=tenants-directory'); return; }
    if (key === 'alert:overdue_payments') { nav('/subscriptions?filter=past_due&source=tenants-directory'); return; }
    if (key === 'support') { nav('/alerts?source=tenants-directory'); return; }   // no support-center route exists — the platform's open issues live on Alerts (Oct 28 2026 dead-route scan)
    if (key === 'churn' || key === 'health' || key === 'alert:high_churn_risk') { nav('/platform-reports?report=tenant-health&source=tenants-directory'); return; }
    if (key === 'renewals' || key === 'alert:subscriptions_expiring_7d') { nav('/subscriptions?filter=expiring&source=tenants-directory'); return; }
    if (key.startsWith('tenant:')) { setSelId(key.slice(7)); return; }
  };

  // Export the current directory page (real client-side CSV — current rows/filters, no fabricated data). §38.
  const exportCsv = () => {
    const rows = rowsSorted;
    if (!rows.length) { setNote('Nothing to export for the current filters.'); return; }
    const headers = ['Tenant', 'Code', 'Owner', 'Email', 'City', 'State', 'Plan', 'Status', 'Monthly Volume', 'Last Active'];
    const esc = (v: string) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // formula-injection guard
    const body = rows.map((r) => [r.n, r.code, r.owner, r.email, r.city, r.state, r.plan, STATUS_BADGE[r.status]?.t || r.sl, r.rev, r.last].map(esc).join(','));
    const csv = [headers.join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `tenants-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url); setNote(`Exported ${rows.length} tenants (current view).`);
  };

  // ---- Bulk selection (Bulk Actions §27) ----
  const pageIds = rowsSorted.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleRow = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllOnPage = () => setSelected((prev) => { const n = new Set(prev); if (allOnPageSelected) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const selectedRows = () => rowsSorted.filter((r) => selected.has(r.id));
  const exportSelected = () => {
    const rows = selectedRows();
    if (!rows.length) { setNote('Select one or more tenants first.'); return; }
    const esc = (v: string) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [['Tenant', 'Code', 'Owner', 'Plan', 'Status', 'Revenue'].join(','), ...rows.map((r) => [r.n, r.code, r.owner, r.plan, STATUS_BADGE[r.status]?.t || r.sl, r.rev].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `tenants-selected-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url); setNote(`Exported ${rows.length} selected tenants.`);
  };
  const submitBulk = async () => {
    if (!bulkAction) return;
    const ids = Array.from(selected);
    if (bulkReason.trim().length < MIN_REASON || (bulkAction.target === 'paused' && !bulkCode)) { setNote('A reason code and a reason of at least 10 characters are required.'); return; }
    setBulkBusy(true); setNote(null);
    try {
      const r = await superAdminApi.bulkStatus(ids, bulkAction.target, bulkReason.trim() || undefined, bulkAction.target === 'paused' ? bulkCode : undefined);
      if (!r.ok && r.errors?.length) { setNote(r.errors[0]); return; }
      setNote(`Bulk ${bulkAction.target === 'paused' ? 'pause' : 'activation'}: ${r.succeeded} succeeded, ${r.failed} failed of ${r.total}.`);
      setBulkAction(null); setBulkReason(''); setSelected(new Set());
      await Promise.all([refetch(), refreshOverview(), loadDir()]);
    } catch (e: any) { setNote(e?.message || 'Bulk action failed.'); } finally { setBulkBusy(false); }
  };

  const [createErr, setCreateErr] = useState<string | null>(null);

  const submitCreate = async () => {
    setNote(null); setCreateErr(null);
    if (!c.name.trim() || !c.email.trim()) { setCreateErr('Salon name and owner email are required.'); return; }
    try {
      const res: any = await superAdminApi.createTenant({
        displayName: c.name,
        code: c.code || undefined,
        plan: c.plan,
        aiPackage: c.ai,
        city: c.city,
        state: c.state,
        initialCommissionPercent: Number(c.initialCommissionPercent || 50),
        owner: { firstName: c.first, lastName: c.last, email: c.email, phone: c.phone, initialCommissionPercent: Number(c.initialCommissionPercent || 50) as any }
      });
      if (res?.ok === false || res?.errors?.length) {
        const errMsg = res.errors?.[0] || 'Tenant creation failed.';
        setCreateErr(errMsg);
        return;
      }
      setCreateOpen(false); setNote('Tenant created.'); refetch();
    } catch (e: any) { setCreateErr(e?.message || 'Create failed.'); }
  };

  if (loading && !s) return <div className="work"><div className="state">Loading tenants…</div></div>;
  if (error) return <div className="work"><div className="err">{error} <button className="btn ghost" onClick={refetch} style={{ marginLeft: 10 }}>Retry</button></div></div>;

  return (
    <div className="work tnt">
      {/* Security Deep Scan C2 (Oct 23 2026): the temporary password is SENT to the owner (email / SMS) and never returned
          to this screen — the Super Admin states why (audited, step-up) and learns only where it went. */}
      {ownerPw ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={() => { if (!ownerPw.busy) setOwnerPw(null); }}>
          <div role="dialog" aria-label={`Reset owner password for ${ownerPw.tenant}`} onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: 440, maxWidth: '92vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Reset owner password · {ownerPw.tenant}</div>
            {ownerPw.sent ? (
              <>
                <div role="status" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
                  A temporary password was sent by {ownerPw.sent.delivery === 'sms' ? 'text message' : 'email'} to <b>{ownerPw.sent.sentTo}</b>
                  {ownerPw.sent.expiresAt ? <> (expires {new Date(ownerPw.sent.expiresAt).toLocaleString()})</> : null}. The owner must change it when they sign in.
                  <div style={{ opacity: 0.7, marginTop: 6 }}>It is never shown here — only the owner receives it.</div>
                </div>
                <button className="btn" onClick={() => setOwnerPw(null)}>Done</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.5, marginBottom: 10 }}>
                  A new temporary password is sent to the owner's own email or phone on file. You will not see it. The reason is recorded in the audit log.
                </div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>Reason (required, at least 10 characters)
                  <input aria-label="Reset reason" value={ownerPw.reason} onChange={(e) => setOwnerPw({ ...ownerPw, reason: e.target.value, err: null })}
                    style={{ width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #E3D8C6', borderRadius: 8, boxSizing: 'border-box' }} placeholder="e.g. Owner called support, verified by callback" />
                </label>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>Send it by
                  <select aria-label="Delivery method" value={ownerPw.method} onChange={(e) => setOwnerPw({ ...ownerPw, method: e.target.value as CredentialDeliveryMethod })}
                    style={{ width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid #E3D8C6', borderRadius: 8 }}>
                    <option value="auto">Email if on file, otherwise text message</option><option value="email">Email</option><option value="sms">Text message</option>
                  </select>
                </label>
                {ownerPw.err ? <div className="err" role="alert" style={{ marginBottom: 10 }}>{ownerPw.err}</div> : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" disabled={ownerPw.busy || ownerPw.reason.trim().length < 10} onClick={() => void sendOwnerReset()}>{ownerPw.busy ? 'Sending…' : 'Send temporary password'}</button>
                  <button className="btn ghost" disabled={ownerPw.busy} onClick={() => setOwnerPw(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      <div className=" flex flex-col lg:flex-row justify-between gap-3" >
        <div className="vh" style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0 }}>Tenants <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span></h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Centralized multi-tenant management for all AIPowerSalon salons.{pag ? ` ${pag.totalItems.toLocaleString()} on platform.` : ''}</div>
        </div>
        <div className="items-baseline whitespace-nowrap flex-wrap" style={{ display: 'flex', gap: 8, }}>
          <button className="btn ghost" onClick={exportCsv} title="Export the current directory view to CSV" style={{ minHeight: 36 }}>⤓ Export Report</button>
          <div style={{ position: 'relative' }}>
            <button className="btn ghost" onClick={() => setBulkOpen((o) => !o)} title="Bulk actions" style={{ minHeight: 36 }}>⚙ Bulk Actions{selected.size ? ` (${selected.size})` : ''} ▾</button>
            {bulkOpen ? (
              <div className="amenu" style={{ right: 0, zIndex: 60, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.2)', padding: 6 }} onClick={() => setBulkOpen(false)}>
                <button disabled={!selected.size} onClick={() => { setBulkReason(''); setBulkAction({ target: 'paused' }); }}>Pause selected{selected.size ? ` (${selected.size})` : ''}</button>
                <button disabled={!selected.size} onClick={() => { setBulkReason(''); setBulkAction({ target: 'active' }); }}>Activate selected{selected.size ? ` (${selected.size})` : ''}</button>
                <button disabled={!selected.size} onClick={exportSelected}>Export selected{selected.size ? ` (${selected.size})` : ''}</button>
                <button onClick={exportCsv}>Export current view</button>
                <button onClick={() => nav('/tenant-applications?source=tenants-directory-bulk')}>Approve pending tenants</button>
              </div>
            ) : null}
          </div>
          <button className="btn" onClick={() => setCreateOpen(true)} title="Add a tenant" style={{ minHeight: 36, fontWeight: 800 }}>＋ Add Tenant</button>
          <button className="btn ghost" onClick={doRefresh} disabled={refreshing} title="Refresh summary, table, and cards" style={{ minHeight: 36 }}>{refreshing ? '↻ Refreshing…' : '↻ Refresh'}</button>
        </div>
      </div>
      {note ? <div className="toast" onClick={() => setNote(null)}>{note}</div> : null}

      {/* 12-KPI grid + analytics (Health & Alerts, Plan/Status, Growth, Onboarding, Renewals) from the directory-overview endpoint */}
      {dir ? (
        <TenantDirectoryAnalytics data={dir} trends={kpiTrends} openSupportTickets={ov?.kpis.openSupportTickets ?? null} activeKpi={activeKpi} onKpi={handleKpi} />
      ) : (
        <div className="kpis k6"><div className="state">Loading analytics…</div></div>
      )}

      {/* MAIN: table (left) + detail panel (right) */}
      <div className="tgrid" ref={tableRef}>
        <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          {/* Table Header */}
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
              Salon Directory {pag ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({pag.totalItems.toLocaleString()})</span> : null}
            </h2>
            {loading ? <span className="muted" style={{ fontSize: 11 }}>updating…</span> : null}
          </div>

          {/* filter bar */}
          <div className="filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--line)', background: '#FFFDF8' }}>
            <input style={{ ...inp, flex: 1, minWidth: 180, height: 34, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} placeholder="Search tenants by name, owner, email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <select style={{ ...inp, height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={stateF} onChange={(e) => { setStateF(e.target.value); setPage(1); }}><option value="">All States</option>{['TX', 'FL', 'CA', 'GA', 'NY', 'IL', 'WA', 'AZ', 'NJ'].map((x) => <option key={x}>{x}</option>)}</select>
            <select style={{ ...inp, height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={statusF} onChange={(e) => { applyStatus(e.target.value); }}><option value="">All Statuses</option><option value="active">Active</option><option value="suspended">Paused</option><option value="trial">Trial</option><option value="setup">Pending</option><option value="cancelled">Cancelled</option></select>
            <select style={{ ...inp, height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={planF} onChange={(e) => {
              setPlanF(e.target.value);
              setPage(1);
              const p = new URLSearchParams(params);
              if (e.target.value) p.set('plan', e.target.value);
              else p.delete('plan');
              setParams(p, { replace: true });
            }}>
              <option value="">All Plans</option>
              {availablePlans.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select style={{ ...inp, height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, background: '#FFFDF8' }} value={setupF} onChange={(e) => { setSetupF(e.target.value); setPage(1); }}><option value="">Payment Setup</option><option value="complete">Complete</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="incomplete">Incomplete</option></select>
            <button className="btn ghost" onClick={clearFilters} style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}>⤺ Clear Filters</button>
          </div>

          {selected.size > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', background: 'var(--cream2,#F7F2E9)', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
              <b>{selected.size}</b> selected
              <button className="btn ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 11 }} onClick={() => setBulkOpen(true)}>Bulk actions…</button>
              <button className="linkbtn" onClick={() => setSelected(new Set())}>Clear selection</button>
            </div>
          )}

          {/* table */}
          <div className="ttable-wrap" style={{ overflowX: 'auto', width: '100%', maxHeight: 'none' }}>
            <table className="ttable" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 980 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ width: 30, padding: '12px 10px' }}><input type="checkbox" aria-label="Select all tenants on this page" checked={allOnPageSelected} onChange={toggleAllOnPage} /></th>
                  <th onClick={() => sortOn('n')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Tenant / Owner ⇅</th>
                  <th onClick={() => sortOn('plan')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Plan</th>
                  <th onClick={() => sortOn('branches')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Branches</th>
                  <th onClick={() => sortOn('status')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Status</th>
                  <th style={{ padding: '12px 10px' }}>Subscription</th>
                  <th style={{ padding: '12px 10px' }}>POS Devices</th>
                  <th onClick={() => sortOn('cust')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Customers</th>
                  <th onClick={() => sortOn('rev')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Revenue (MTD)</th>
                  <th onClick={() => sortOn('last')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Last Activity</th>
                  <th onClick={() => sortOn('health')} style={{ cursor: 'pointer', padding: '12px 10px' }}>Health</th>
                  <th style={{ textAlign: 'right', padding: '12px 14px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.length === 0 ? <tr><td colSpan={12} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No tenants match these filters.</td></tr> :
                  rowsSorted.map((r, idx) => {
                    const isSel = selId === r.id;
                    const sb = STATUS_BADGE[r.status] || STATUS_BADGE.setup;
                    return (
                      <tr
                        key={r.id}
                        style={{
                          borderBottom: '1px solid var(--line)',
                          background: isSel ? '#FFF5E1' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                          transition: 'background 0.15s ease',
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelId(r.id)}
                        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#FFF9EF'; }}
                        onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                      >
                        <td style={{ padding: '10px 10px' }} onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={'Select ' + r.n} checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} /></td>
                        <td style={{ padding: '10px 10px' }}><div className="cellname"><span className="tav">{avatarOf(r.n)}</span><div><div className="nm">{r.n}</div><div className="cd">{r.owner} · {r.code} <span style={{ background: '#FFF3E0', color: '#E65100', padding: '1px 6px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, marginLeft: 4 }}>{r.commissionPct ?? 50}% Comm</span></div></div></div></td>
                        <td style={{ padding: '10px 10px' }}>{r.plan}</td>
                        <td style={{ padding: '10px 10px' }}>{r.branches ?? '—'}</td>
                        <td style={{ padding: '10px 10px' }}><span className="badge" style={{ background: sb.bg, color: sb.fg }}>{sb.t}</span></td>
                        <td style={{ padding: '10px 10px', color: r.subscription == null ? 'var(--muted)' : 'inherit' }}>{r.subscription ?? '—'}</td>
                        <td style={{ padding: '10px 10px', color: r.posDevices == null ? 'var(--muted)' : 'inherit' }}>{r.posDevices == null ? '—' : r.posDevices.toLocaleString('en-US')}</td>
                        <td style={{ padding: '10px 10px' }}>{(r.cust?.[0] ?? 0).toLocaleString('en-US')}</td>
                        <td style={{ padding: '10px 10px' }}><b>{r.rev}</b></td>
                        <td style={{ padding: '10px 10px', color: 'var(--muted)' }}>{r.last}</td>
                        <td style={{ padding: '10px 10px' }} title={r.healthBand ? `Health: ${r.healthBand}` : 'Not yet calculated'}>
                          {r.healthScore == null
                            ? <span className="mut">—</span>
                            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><b>{r.healthScore}</b><span style={{ width: 8, height: 8, borderRadius: '50%', background: healthColor(r.healthBand) }} /></span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', padding: '10px 14px', position: 'relative' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                            <button className="btn ghost" title="View tenant" onClick={(e) => { e.stopPropagation(); setSelId(r.id); }} style={{ padding: '3px 8px', minHeight: 28, fontSize: 12 }}>👁 View</button>
                            <div style={{ position: 'relative' }}>
                              <button className="btn ghost" title="More actions" onClick={(e) => { e.stopPropagation(); setMenuId(menuId === r.id ? null : r.id); }} style={{ padding: '3px 10px', fontWeight: 800, minHeight: 28, fontSize: 12 }}>⋯</button>
                              {menuId === r.id && (
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
                                    minWidth: 190,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                    textAlign: 'left',
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setSelId(r.id); setMenuId(null); }}>View Details</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/subscriptions'); }}>Billing</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/payment-gateways'); }}>Payment Gateway</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/hardware-packages?tenantId=' + encodeURIComponent(r.id)); }}>Hardware Package</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/tenants/' + encodeURIComponent(r.id) + '/messaging'); }}>Twilio Setup</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/tenants/' + encodeURIComponent(r.id) + '/a2p'); }}>A2P Registration</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); support(r.id); }}>Support Access</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => {
                                    setMenuId(null);
                                    setNote(null); setOwnerPw({ id: r.id, tenant: r.n, reason: '', method: 'auto', busy: false, err: null });
                                  }}>Reset Owner Password</button>
                                  {r.status === 'suspended' ? (
                                    <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start', color: '#1F9254' }} onClick={() => { setMenuId(null); activate(r.id); }}>Activate</button>
                                  ) : (
                                    <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start', color: '#B85B4D' }} onClick={() => { setMenuId(null); pause(r.id); }}>Pause Tenant</button>
                                  )}
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); nav('/platform-reports'); }}>Open Reports</button>
                                  <button className="btn ghost" style={{ minHeight: 28, fontSize: 11.5, textAlign: 'left', padding: '6px 10px', justifyContent: 'flex-start' }} onClick={() => { setMenuId(null); act(r.id, () => superAdminApi.audit(r.id), 'aud', (x) => setNote(`Audit: ${(x?.entries || x?.events || []).length || 0} events`)); }}>View Audit Logs</button>
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

          {/* pagination */}
          {pag ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)', fontSize: 12, flexWrap: 'wrap', background: '#FFFDF8' }}>
              <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page" style={{ minHeight: 30, padding: '0 10px' }}>‹ Prev</button>
              {Array.from({ length: Math.min(5, pag.totalPages) }, (_, i) => i + 1).map((n) => (
                <button key={n} className={'btn ' + (n === page ? '' : 'ghost')} onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined} style={{ minWidth: 32, minHeight: 30, padding: '0 6px' }}>{n}</button>
              ))}
              {pag.totalPages > 5 ? <span className="muted">… {pag.totalPages}</span> : null}
              <button className="btn ghost" disabled={page >= pag.totalPages} onClick={() => setPage((p) => Math.min(pag.totalPages, p + 1))} aria-label="Next page" style={{ minHeight: 30, padding: '0 10px' }}>Next ›</button>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>Showing {(pag.page - 1) * pag.pageSize + 1} to {Math.min(pag.page * pag.pageSize, pag.totalItems)} of {pag.totalItems.toLocaleString()} tenants</span>
            </div>
          ) : null}
        </section>

        {/* DETAIL PANEL */}
        <aside className="panel detail" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          {!sel ? <div className="state">Select a tenant to see details.</div> : (() => {
            const sb = STATUS_BADGE[sel.status] || STATUS_BADGE.setup;
            const steps = [
              { l: 'Account Created', done: true },
              { l: 'Payment Setup', done: /current/i.test(sel.pay) },
              { l: 'Hardware Package', done: /paid|financ/i.test(sel.payoff) },
              { l: 'AI Packages Activated', done: parseInt(sel.ai, 10) > 0 },
              { l: 'Team Training', done: /current/i.test(sel.pay) && parseInt(sel.ai, 10) > 0 },
            ];
            const pct = Math.round((steps.filter((x) => x.done).length / steps.length) * 100);
            const aiChips = ['AI Receptionist', 'AI SMS Pro', 'AI Reviews', 'Marketing AI', 'AI Insights', 'AI Payroll'].slice(0, Math.max(0, Math.min(6, parseInt(sel.ai, 10) || 0)));
            return (
              <>
                <div className="dhead">
                  <span className="tav big">{avatarOf(sel.n)}</span>
                  <div style={{ flex: 1 }}><div className="dname">{sel.n}</div><div className="cd">{sel.code}</div></div>
                  <span className="badge" style={{ background: sb.bg, color: sb.fg }}>{sb.t}</span>
                </div>
                <div className="dsec">
                  <div className="dkv"><span>Owner</span><b>{sel.owner}</b></div>
                  <div className="dkv"><span>Phone</span><b>{sel.phone || '—'}</b></div>
                  <div className="dkv"><span>Email</span><b style={{ fontWeight: 600 }}>{sel.email || '—'}</b></div>
                  <div className="dkv"><span>Location</span><b>{[sel.city, sel.state].filter(Boolean).join(', ') || '—'}</b></div>
                  <div className="dkv"><span>Plan</span><b>{sel.plan}</b></div>
                  <div className="dkv" style={{ alignItems: 'center' }}>
                    <span>Default Commission</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ color: '#E65100', fontWeight: 700 }}>{sel.commissionPct ?? 50}%</b>
                      <button className="linkbtn" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => { setEditCommVal(String(sel.commissionPct ?? 50)); setEditCommTenant({ id: sel.id, name: sel.n }); }}>Edit</button>
                    </div>
                  </div>
                </div>

                <div className="dsec" style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: 8, padding: 10 }}>
                  <div className="dlabel" style={{ color: '#B45309', fontWeight: 700, margin: '0 0 4px' }}>Admin Authorization Code</div>
                  <div style={{ fontSize: 11.5, color: '#78350F', marginBottom: 8, lineHeight: 1.4 }}>
                    Share this authorization code with the salon owner to authorize commission changes.
                  </div>
                  {generatedCode?.tenantId === sel.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input readOnly value={generatedCode.code} style={{ ...inp, width: 140, fontWeight: 700, color: '#B45309', background: '#FFF' }} />
                      <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(generatedCode.code); setNote('Authorization code copied!'); }}>Copy Code</button>
                    </div>
                  ) : (
                    <button className="btn" style={{ padding: '5px 10px', fontSize: 11.5 }} onClick={async () => {
                      try {
                        const res = await superAdminApi.generateCommissionAuthCode({ tenantId: sel.id });
                        if (res?.code) setGeneratedCode({ code: res.code, tenantId: sel.id });
                      } catch (e: any) { setNote('Failed to generate auth code.'); }
                    }}>Generate Code for Owner</button>
                  )}
                </div>
                <div className="dsec">
                  <div className="dlabel">Tenant Health</div>
                  <div className="dkv"><span>Health Score</span><b>{sel.healthScore == null ? <span className="mut">Not yet calculated</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{sel.healthScore}<span style={{ width: 8, height: 8, borderRadius: '50%', background: healthColor(sel.healthBand) }} /></span>}</b></div>
                  {sel.healthBand ? <div className="dkv"><span>Band</span><b style={{ textTransform: 'capitalize' }}>{sel.healthBand}</b></div> : null}
                  <div className="dkv"><span>Churn Risk</span><b>{sel.churnRisk ? <span style={{ textTransform: 'capitalize', color: churnColor(sel.churnRisk) }}>{sel.churnRisk}</span> : <span className="mut">—</span>}</b></div>
                </div>
                <div className="dsec">
                  <div className="dlabel">Onboarding Progress <span style={{ float: 'right', color: 'var(--g7)' }}>{pct}%</span></div>
                  <div className="prog"><div style={{ width: pct + '%' }} /></div>
                  <div className="checks">{steps.map((x) => (<div key={x.l} className="chk"><span className={x.done ? 'on' : ''}>{x.done ? '✓' : '○'}</span>{x.l}</div>))}</div>
                </div>
                <div className="dsec">
                  <div className="dlabel">Payment Gateway</div>
                  {/* The card used to read last4/cardBrand/provider — fields this API never returns — and otherwise fell back to the
                      salon's SUBSCRIPTION payment status. It now shows the gateway itself. */}
                  {gateway && gateway.processorType && gateway.processorType !== 'none' ? (<>
                    <div className="dkv"><span>{PROCESSOR_LABEL[gateway.processorType] || gateway.processorType} · {gateway.environment === 'production' ? 'Live' : 'Sandbox'}</span><span className="badge" style={{ background: gateway.status === 'active' ? '#EAF5EE' : '#FFF6E5', color: gateway.status === 'active' ? '#3E8F57' : '#D09A36' }}>{String(gateway.status || '—').replace(/_/g, ' ')}</span></div>
                    <div className="dkv"><span>Merchant ID</span><b style={{ fontWeight: 600 }}>{gateway.merchantIdMasked || '—'}</b></div>
                    <div className="dkv"><span>Card terminal</span><b style={{ fontWeight: 600 }}>{gateway.terminalConfigured ? 'Configured' : 'Not set up'}</b></div>
                  </>) : <div className="mut">Not configured</div>}
                </div>
                <PosLanguagePanel key={'lang-' + sel.id} tenantId={sel.id} inp={inp} canEdit={can('super_admin.tenants.edit')} onChanged={setNote} />
                <LifecyclePanel key={sel.id} tenantId={sel.id} state={(sel as any).lifecycleState ?? null} moves={(sel as any).lifecycleMoves ?? []} inp={inp}
                  policy={(sel as any).suspensionPolicy ?? null} reasonCode={(sel as any).suspensionReasonCode ?? null}
                  onChanged={(msg) => { setNote(msg); refetch(); }} />
                <div className="dsec" data-testid="tenant-health">
                  <div className="dlabel" style={{ display: 'flex', alignItems: 'center' }}>Health
                    {health && health !== 'error' ? <span className="badge" style={{ marginLeft: 'auto', background: HEALTH_COLOR[health.overall][0], color: HEALTH_COLOR[health.overall][1] }}>{HEALTH_LABEL[health.overall]}</span> : null}
                  </div>
                  {health === null ? <div className="mut">Checking…</div>
                    : health === 'error' ? <div className="mut">Health could not be read right now.</div>
                    : (<>
                      {(Object.keys(health.components) as Array<keyof TenantHealth['components']>).map((k) => {
                        const c = health.components[k];
                        return <div key={k} className="dkv" title={c.reason}><span>{HEALTH_COMPONENT[k]}</span><span className="badge" style={{ background: HEALTH_COLOR[c.state][0], color: HEALTH_COLOR[c.state][1] }}>{HEALTH_LABEL[c.state]}</span></div>;
                      })}
                      {health.failedQueries.length ? <div className="mut" style={{ marginTop: 4 }}>Some checks could not run: {health.failedQueries.join(', ')}</div> : null}
                    </>)}
                </div>
                <div className="dsec">
                  <div className="dlabel" style={{ display: 'flex', alignItems: 'center' }}>Hardware Package<button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => nav(`/hardware-packages?tenantId=${encodeURIComponent(sel.id)}&source=tenants-salons-dashboard`)}>View All</button></div>
                  {hwCard?.package ? (() => {
                    const st = hwCard.normalizedStatus || hwCard.package.status || '';
                    const hum = (x: string) => String(x || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                    const good = ['delivered', 'installed', 'complete'].includes(st);
                    const warnIsh = ['shipped', 'ready_to_ship', 'ordered', 'processing'].includes(st);
                    const col = good ? ['#EAF5EE', '#3E8F57'] : warnIsh ? ['#FFF6E5', '#B98427'] : ['#EFEDEA', '#857D70'];
                    return (
                      <>
                        <div className="dkv"><span>{hwCard.package.packageName || 'Hardware Package'}</span><span className="badge" style={{ background: col[0], color: col[1] }}>{hum(st) || '—'}</span></div>
                        <div className="dkv"><span>Payment</span><b>{hum(hwCard.package.paymentStatus)}</b></div>
                        {hwCard.package.trackingNumber ? <div className="dkv"><span>Tracking</span><b style={{ fontWeight: 600 }}>{hwCard.package.trackingNumber}</b></div> : null}
                      </>
                    );
                  })() : (
                    <div className="dkv"><span>{hwBadge(sel.payoff).t}</span><span className="badge" style={{ background: '#EAF5EE', color: '#3E8F57' }}>{sel.payoff || '—'}</span></div>
                  )}
                </div>
                <div className="dsec">
                  <div className="dlabel">Active AI Subscriptions ({aiChips.length})</div>
                  {aiChips.length === 0 ? <div className="mut">No AI packages.</div> : <div className="chips">{aiChips.map((a) => <span key={a} className="chip">{a}</span>)}</div>}
                </div>
                <div className="dsec">
                  <div className="dlabel">Recent Warnings{warnings.length ? <span style={{ float: 'right', color: 'var(--g7)' }}>{warnings.length}</span> : null}</div>
                  {warnings.length === 0 ? <div className="mut">No warnings sent.</div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {warnings.slice(0, 5).map((w) => {
                        const wb = WARN_BADGE[w.deliveryStatus] || WARN_BADGE.recorded;
                        const chans = [w.sendEmail ? 'Email' : null, w.sendSms ? 'SMS' : null].filter(Boolean).join(' · ') || 'Dashboard';
                        return (
                          <div key={w.id} className="dkv" style={{ alignItems: 'flex-start', gap: 8 }} title={w.message}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <b style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.subject}</b>
                              <span className="mut" style={{ fontSize: 11.5 }}>{w.severity} · {chans} · {timeAgo(w.createdAt)}</span>
                            </span>
                            <span className="badge" style={{ background: wb.bg, color: wb.fg, flex: 'none' }}>{wb.t}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="dsec">
                  <div className="dlabel">Quick Actions</div>
                  <div className="qgrid">
                    <button className="qbtn" disabled={busy === sel.id + 'pos' || sel.status === 'cancelled'} title={sel.status === 'cancelled' ? 'Support access is disabled for cancelled tenants' : 'Start a time-limited, audited support session for this salon'} onClick={() => viewPos(sel.id)}>🛟 Support Mode</button>
                    <button className="qbtn" disabled={sel.status === 'suspended' || sel.status === 'cancelled' || busy === sel.id + 'paused'} title={sel.status === 'suspended' ? 'Tenant is already paused' : sel.status === 'cancelled' ? 'Cancelled tenants cannot be paused' : 'Pause this tenant'} onClick={() => pause(sel.id, sel.n)}>⏸ Pause Tenant</button>
                    <button className="qbtn" disabled={sel.status === 'healthy' || sel.status === 'cancelled' || busy === sel.id + 'active'} title={sel.status === 'healthy' ? 'Tenant is already active' : sel.status === 'cancelled' ? 'Cancelled tenants cannot be reactivated' : 'Activate this tenant'} onClick={() => activate(sel.id, sel.n)}>▶ Activate</button>
                    <button className="qbtn" disabled={busy === sel.id + 'warn'} title="Send a warning to this tenant" onClick={() => { setMenuId(null); setNote(null); setWarnFor({ id: sel.id, name: sel.n }); }}>⚠ Send Warning</button>
                    <button className="qbtn" title="Open tenant billing" onClick={() => nav('/subscriptions?tenant=' + encodeURIComponent(sel.id))}>🧾 Billing</button>
                    <button className="qbtn" title="Open tenant-performance report for this tenant" onClick={() => nav('/platform-reports?report=tenant-performance&tenantId=' + encodeURIComponent(sel.id) + '&source=tenants_salons_quick_actions')}>📈 Open Reports</button>
                  </div>
                </div>
                <div className="dsec">
                  <div className="dlabel">App Controls</div>
                  <AppControlsPanel tenantId={sel.id} />
                </div>
              </>
            );
          })()}
        </aside>
      </div>

      {/* PROMO BANNER */}
      <section className="hwbanner">
        <div className="hwcell"><div className="hwbig">FREE 24" iMac</div><div className="hwsub">Latest Model · Any Color You Want!</div><div className="swatches">{['#7FB5C9', '#9C7FC9', '#E58BB0', '#E0A24A', '#C9C2B4', '#7F9C8B'].map((x) => <span key={x} style={{ background: x }} />)}</div></div>
        <div className="hwcell"><div className="hwbig" style={{ fontSize: 18 }}>FREE Clover Flex</div><div className="hwsub">Card terminal</div></div>
        <div className="hwcell"><div className="hwbig" style={{ fontSize: 18 }}>FREE Customer Check-In Display</div><div className="hwsub">Kiosk display</div></div>
      </section>

      {/* REVENUE BY TENANT (Top 10) — reuses the ranked top-performing data */}
      <section className="panel" style={{ marginTop: 14, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <div className="phead" style={{ marginBottom: 12 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16 }}>Revenue by Tenant (Top 10)</h2><span className="pill" style={{ background: '#FFF9EF', borderColor: 'var(--line)' }}>This Month</span></div>
        {topPerfErr ? <div className="state">Unable to load tenant revenue. <button className="linkbtn" onClick={loadTopPerf} style={{ marginLeft: 6 }}>Retry</button></div>
          : topPerf === null ? <div className="state">Loading…</div>
          : <RevenueByTenantBars rows={topPerf.map((t) => ({ tenantId: t.tenantId, salonName: t.salonName, monthlyCardVolume: t.monthlyCardVolume, formattedMonthlyCardVolume: t.formattedMonthlyCardVolume, growthPercent: t.growthPercent }))} onTenant={(id) => setSelId(id)} />}
      </section>

      {/* 3 ANALYTICS CARDS (overview-sourced) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" style={{ marginTop: 14, alignItems: 'stretch' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Recent Tenant Activity</h2><button className="linkbtn" onClick={() => nav('/tenant-activity?source=tenants-salons-recent-activity')}>View All</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {!ov ? <div className="state">Loading…</div> : ov.recentActivity.length === 0 ? <div className="state">No recent activity.</div> : ov.recentActivity.map((a) => (
              <div key={a.id} className="arow" style={{ cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid var(--line,#eee)' }} onClick={() => nav('/tenant-activity?source=tenants-salons-recent-activity')} title="Open Tenant Activity"><span style={{ fontSize: 16, lineHeight: '20px', marginRight: 2 }}>{(a as any).icon || '📌'}</span><span className="sevdot" style={{ background: a.severity === 'error' ? 'var(--danger)' : a.severity === 'success' ? 'var(--ok)' : a.severity === 'warning' ? 'var(--warn)' : 'var(--info)' }} /><div style={{ flex: 1, minWidth: 0 }}><div className="at" style={{ fontSize: 12 }}>{a.title}</div><div className="am" style={{ fontSize: 11 }}>{a.tenantName ? a.tenantName + ' · ' : ''}{a.message}</div></div><div className="aage" style={{ fontSize: 10.5 }}>{a.ageLabel}</div></div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            Real-time tenant events
          </div>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Recent Applications</h2><button className="linkbtn" onClick={() => nav('/tenant-applications?source=tenants-salons-dashboard')}>View All</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {!ov ? <div className="state">Loading…</div> : ov.recentTenantApplications.length === 0 ? <div className="state">No applications yet.</div> : ov.recentTenantApplications.map((a, i) => {
              const b = appBadge(a.status);
              return (
                <div key={a.id} className="arow" style={{ cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid var(--line,#eee)' }} onClick={() => nav(`/tenant-applications?source=tenants-salons-dashboard&focus=${encodeURIComponent(a.id)}`)}>
                  <span className="rank">{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="at" style={{ fontSize: 12 }}>{a.salonName}</div><div className="am" style={{ fontSize: 11 }}>{a.owner} · {[a.city, a.state].filter(Boolean).join(', ')}</div></div>
                  {a.date ? <span className="am" style={{ marginRight: 8, whiteSpace: 'nowrap', fontSize: 10.5 }}>{agoLabel(a.date)}</span> : null}
                  <span className="badge" style={{ background: b.bg, color: b.fg, fontSize: 10.5 }}>{b.t}</span>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            Onboarding application queue
          </div>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Top Performing Tenants</h2><button className="linkbtn" onClick={() => nav('/platform-reports?report=tenant-performance&period=current-month&sortBy=monthlyCardVolume&sortDirection=desc&source=top-performing-tenants-card')}>View Full Report</button></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {topPerfErr ? <div className="state">Unable to load top performing tenants. <button className="linkbtn" onClick={loadTopPerf} style={{ marginLeft: 6 }}>Retry</button></div>
              : topPerf === null ? <div className="state">Loading…</div>
              : topPerf.length === 0 ? <div className="state">No volume yet.</div>
              : topPerf.map((t) => (
              <div key={t.tenantId} className="arow" style={{ cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid var(--line,#eee)' }} onClick={() => setSelId(t.tenantId)} title={t.salonName}>
                <span className="rank">{t.rank}</span><span className="tav">{avatarOf(t.salonName)}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div className="at" style={{ fontSize: 12 }}>{t.salonName}</div><div className="am" style={{ fontSize: 11 }}>{[t.city, t.state].filter(Boolean).join(', ')}</div></div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tvol" style={{ fontSize: 12 }}>{t.formattedMonthlyCardVolume}</div>
                  {t.growthPercent == null ? <div className="d flat" style={{ fontSize: 10.5 }}>New</div>
                    : <div className={'d ' + (t.growthPercent >= 0 ? 'up' : 'down')} style={{ fontSize: 10.5 }}>{t.growthPercent >= 0 ? '▲' : '▼'} {Math.abs(t.growthPercent)}%</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            Ranked by monthly card volume
          </div>
        </section>
      </div>

      {/* SUPPORT QUEUE BY TENANT — honest: no per-tenant support-case source is connected */}
      <section className="panel" style={{ marginTop: 14, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <div className="phead" style={{ marginBottom: 8 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Support Queue by Tenant</h2><button className="linkbtn" onClick={() => nav('/alerts?source=tenants-directory')}>View All Alerts</button></div>
        <div className="state" style={{ padding: '14px 16px' }}>
          Per-tenant support ticketing isn’t connected yet (NotConnected). Platform open tickets:{' '}
          <b>{ov ? ov.kpis.openSupportTickets.toLocaleString() : '—'}</b>. The per-tenant priority queue will populate here once a support system is wired.
        </div>
      </section>

      {/* QUICK ACTIONS (reference §23 — all wired, no dead buttons) */}
      <section className="panel" style={{ marginTop: 14, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <div className="phead" style={{ marginBottom: 10 }}><h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Quick Actions</h2></div>
        <div className="qgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <button className="qbtn" onClick={() => setCreateOpen(true)}>＋ Add Tenant</button>
          <button className="qbtn" onClick={() => nav('/tenant-applications?source=tenants-directory-quick')}>✓ Approve Tenant</button>
          <button className="qbtn" onClick={() => { clearFilters(); setSelId(null); }}>📋 Open Directory</button>
          <button className="qbtn" onClick={() => { if (sel) { setNote(null); setWarnFor({ id: sel.id, name: sel.n }); } else setNote('Select a tenant first to send a notice.'); }}>📣 Send Notice</button>
          <button className="qbtn" onClick={() => nav('/subscriptions?source=tenants-directory-plans')}>🗂 Manage Plans</button>
          <button className="qbtn" onClick={() => nav('/usage-limits?source=tenants-directory')}>🔑 Feature Access</button>
          <button className="qbtn" onClick={() => { if (sel) support(sel.id); else setNote('Select a tenant to enter controlled support mode.'); }}>🛟 Support Access</button>
          <button className="qbtn" onClick={exportCsv}>⤓ Export Data</button>
          <button className="qbtn" onClick={() => nav('/tenant-activity?source=tenants-directory-audit')}>📜 View Audit Logs</button>
        </div>
      </section>

      {/* BULK ACTION CONFIRM (impact summary + required reason, §27) */}
      {bulkAction ? (
        <div className="modal" onClick={() => !bulkBusy && setBulkAction(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="phead"><h2>{bulkAction.target === 'paused' ? 'Pause' : 'Activate'} {selected.size} Tenant{selected.size === 1 ? '' : 's'}</h2><button className="linkbtn" onClick={() => setBulkAction(null)}>Close</button></div>
            <p className="am" style={{ marginTop: 0 }}>
              {bulkAction.target === 'paused'
                ? `You're about to pause ${selected.size} tenant${selected.size === 1 ? '' : 's'}. POS access and active subscriptions may be limited per platform rules. Each tenant is validated and audited individually.`
                : `You're about to activate ${selected.size} tenant${selected.size === 1 ? '' : 's'}. Each tenant is validated and audited individually.`}
            </p>
            {bulkAction.target === 'paused' ? <ReasonCodeSelect value={bulkCode} onChange={setBulkCode} inp={inp} /> : null}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--soft)' }}>Reason (required, at least 10 characters)
              <input aria-label="Bulk reason" style={{ ...inp, width: '100%', marginTop: 4 }} value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Logged with each tenant's audit event" />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setBulkAction(null)} disabled={bulkBusy}>Cancel</button>
              <button className="btn" disabled={bulkBusy || bulkReason.trim().length < MIN_REASON || (bulkAction.target === 'paused' && !bulkCode)} onClick={submitBulk}>{bulkBusy ? 'Working…' : bulkAction.target === 'paused' ? `Pause ${selected.size}` : `Activate ${selected.size}`}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CREATE TENANT MODAL */}
      {createOpen ? (
        <div className="modal" onClick={() => { setCreateErr(null); setCreateOpen(false); }}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="phead"><h2>Create Tenant</h2><button className="linkbtn" onClick={() => { setCreateErr(null); setCreateOpen(false); }}>Close</button></div>
            {createErr && (
              <div style={{ fontSize: 12, marginBottom: 12, padding: '8px 12px', background: '#FDF2F2', border: '1px solid #F87171', borderRadius: 8, color: '#991B1B', fontWeight: 600 }}>
                ⚠️ {createErr}
              </div>
            )}
            <div className="fgrid">
              <label>Salon name<input style={inp} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
              <label>Salon code<input style={inp} placeholder="auto if blank" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} /></label>
              <label>Owner first<input style={inp} value={c.first} onChange={(e) => setC({ ...c, first: e.target.value })} /></label>
              <label>Owner last<input style={inp} value={c.last} onChange={(e) => setC({ ...c, last: e.target.value })} /></label>
              <label>Owner email<input style={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></label>
              <label>Owner phone<input style={inp} value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></label>
              <label>City<input style={inp} value={c.city} onChange={(e) => setC({ ...c, city: e.target.value })} /></label>
              <label>State<input style={inp} value={c.state} onChange={(e) => setC({ ...c, state: e.target.value })} /></label>
              <label>Plan<select style={inp} value={c.plan} onChange={(e) => setC({ ...c, plan: e.target.value })}>{['Starter', 'Professional', 'Enterprise', 'Custom'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>AI package<select style={inp} value={c.ai} onChange={(e) => setC({ ...c, ai: e.target.value })}>{['None', 'AI Starter', 'AI Pro'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Initial Commission %<input style={inp} type="number" min="0" max="100" value={c.initialCommissionPercent} onChange={(e) => setC({ ...c, initialCommissionPercent: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="btn" onClick={submitCreate}>Create Tenant</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CONFIRM PAUSE / ACTIVATE */}
      {posAsk ? (
        <div className="modal" onClick={() => setPosAsk(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }} data-testid="view-pos-reason">
            <div className="phead"><h2>Enter Support Mode</h2><button className="linkbtn" onClick={() => setPosAsk(null)}>Close</button></div>
            <p className="am" style={{ marginTop: 0 }}>A read-only support session for this salon: time-limited, shown in a banner on every page, every action audited.</p>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--soft)' }}>Why do you need access? (required, at least 10 characters)
              <input aria-label="Support reason" style={{ ...inp, width: '100%', marginTop: 4 }} value={posAsk.reason} onChange={(e) => setPosAsk({ ...posAsk, reason: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPosAsk(null)}>Cancel</button>
              <button className="btn" disabled={posAsk.reason.trim().length < MIN_REASON} onClick={() => openPos(posAsk.id, posAsk.reason)}>Start Support Mode</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="phead"><h2>{confirm.target === 'active' ? 'Activate Tenant' : 'Pause Tenant'}</h2><button className="linkbtn" onClick={() => setConfirm(null)}>Close</button></div>
            <p className="am" style={{ marginTop: 0 }}>
              {confirm.target === 'active'
                ? `Are you sure you want to activate ${confirm.name}?`
                : `Are you sure you want to pause ${confirm.name}? Their POS access and active subscriptions may be limited depending on platform rules.`}
            </p>
            {confirm.target === 'paused' ? <ReasonCodeSelect value={confirmCode} onChange={setConfirmCode} inp={inp} /> : null}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--soft)' }}>Reason (required, at least 10 characters)
              <input aria-label="Reason" style={{ ...inp, width: '100%', marginTop: 4 }} value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} placeholder="Logged with the audit event" />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn" disabled={busy === confirm.id + confirm.target || confirmReason.trim().length < MIN_REASON || (confirm.target === 'paused' && !confirmCode)} onClick={() => doStatus(confirm.id, confirm.target, confirmReason, confirmCode)}>{confirm.target === 'active' ? 'Activate' : 'Pause Tenant'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* SEND WARNING */}
      {warnFor ? (
        <div className="modal" onClick={() => setWarnFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="phead"><h2>Send Warning · {warnFor.name}</h2><button className="linkbtn" onClick={() => setWarnFor(null)}>Close</button></div>
            <div className="fgrid">
              <label>Warning type<select style={inp} value={warn.warningType} onChange={(e) => setWarn({ ...warn, warningType: e.target.value })}>{['payment_issue', 'policy_violation', 'overdue_balance', 'suspicious_activity', 'support_notice', 'custom'].map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></label>
              <label>Severity<select style={inp} value={warn.severity} onChange={(e) => setWarn({ ...warn, severity: e.target.value })}>{['low', 'medium', 'high', 'critical'].map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            <label style={{ display: 'block', marginTop: 8 }}>Subject<input style={{ ...inp, width: '100%' }} value={warn.subject} onChange={(e) => setWarn({ ...warn, subject: e.target.value })} /></label>
            <label style={{ display: 'block', marginTop: 8 }}>Message<textarea style={{ ...inp, width: '100%', height: 80, padding: 8 }} value={warn.message} onChange={(e) => setWarn({ ...warn, message: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={warn.sendEmail} onChange={(e) => setWarn({ ...warn, sendEmail: e.target.checked })} />Send email</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={warn.sendSms} onChange={(e) => setWarn({ ...warn, sendSms: e.target.checked })} />Send SMS</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={warn.showInTenantDashboard} onChange={(e) => setWarn({ ...warn, showInTenantDashboard: e.target.checked })} />Show in tenant dashboard</label>
            </div>
            <div className="mut" style={{ fontSize: 11.5, marginTop: 6 }} data-testid="warn-pref-rule">{['high', 'critical'].includes(warn.severity)
              ? 'High and critical warnings are always e-mailed / texted, even if the owner switched those off.'
              : 'Low and medium warnings follow the owner’s own e-mail / SMS settings (My Account → Notifications); choose “Show in tenant dashboard” so they still see it.'}</div>
            <label style={{ display: 'block', marginTop: 8 }}>Internal note<input style={{ ...inp, width: '100%' }} value={warn.internalNote} onChange={(e) => setWarn({ ...warn, internalNote: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setWarnFor(null)}>Cancel</button>
              <button className="btn" disabled={busy === warnFor.id + 'warn'} onClick={submitWarn}>Send Warning</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* EDIT TENANT DEFAULT COMMISSION MODAL */}
      {editCommTenant ? (
        <div className="modal" onClick={() => setEditCommTenant(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="phead">
              <h2>Edit Salon Baseline Commission</h2>
              <button className="linkbtn" onClick={() => setEditCommTenant(null)}>Close</button>
            </div>
            <p style={{ fontSize: 12.5, color: '#666', marginTop: 0 }}>
              Update baseline commission rate for <b>{editCommTenant.name}</b>. Newly created technicians at this salon will inherit this rate.
            </p>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Baseline Commission % (0–100)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              style={inp}
              value={editCommVal}
              onChange={(e) => setEditCommVal(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setEditCommTenant(null)}>Cancel</button>
              <button className="btn" onClick={async () => {
                const val = Number(editCommVal);
                if (!Number.isFinite(val) || val < 0 || val > 100) {
                  setNote('Commission % must be 0–100');
                  return;
                }
                try {
                  await superAdminApi.updateTenantCommission(editCommTenant.id, val);
                  setEditCommTenant(null);
                  setNote('Salon baseline commission updated.');
                  refetch();
                } catch (e: any) {
                  setNote(e?.message || 'Update failed.');
                }
              }}>Save Changes</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
