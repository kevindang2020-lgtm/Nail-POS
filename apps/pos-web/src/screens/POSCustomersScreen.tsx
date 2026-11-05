import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useInlineConfirm, useEventCallback } from '@aipowersalon/ui';
import { POSCustomerPhoneEditor } from './POSCustomerPhoneEditor';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posCustomersApi } from '../api/posCustomersApi';
import { authApi } from '../api/authApi';
import { useIPadView } from '../components/IPadViewProvider';
import { customerRequest } from '../components/ipad-modules';
import { api } from '../api/client';
import { useRealtime } from '../realtime/useRealtime';
import { SYNC_POLICY } from '@aipowersalon/realtime-client';
import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCan } from '../components/usePermissions';
import { posCommunicationsApi, newRequestKey } from '../api/posCommunicationsApi';
import { posDuplicateReviewApi } from '../api/posDuplicateReviewApi';
import { CompareOverlay } from './POSAICustomerDuplicateReviewScreen';
import { FitDialog } from '../components/FitKit';
import { MembershipChip, useMemberStatusMap } from './MembershipChip';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { CUSTOMER_LANGUAGES, customerLanguageCode } from '../components/customerLanguage';
import { codeLabel, customerStatusLabel, customerSegmentLabel, membershipStatusLabel } from '../components/peopleLabels';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { serverText } from '../i18n/server-text';   // WP-E §40: Telex / VNI typing never searches mid-composition

// POS Customers — the salon's complete CRM directory (reference layout, 1:1). Consumes the canonical rich
// /pos/customers/state (KPIs + analytics + paginated rows + filter facets) behind TenantAuthGuard + RolePermissionGuard;
// tenant/branch/role are derived server-side from the session (never the browser). Every visible module binds to real
// state data: 8 KPIs, 6 summary cards, 5 category tabs, the directory table, server-side pagination, demographics,
// tags, sources, CLV, RFM, retention, and recent activity. Filters/tabs/pagination round-trip to the backend
// (CustomerFilters: search/status/segment/source/tag/loyaltyTier/spendBand/page/pageSize). Add Customer → POST create,
// Export → GET export (CSV download), Edit → PATCH update, CSV import + duplicate-merge are wired under "More".

type Row = {
  customerId: string; displayName: string; phone?: string; email?: string; status: string; source: string; avatarUrl?: string; birthday?: string;
  visitCount: number; lastVisitAt?: string | null; nextAppointmentAt?: string | null; totalSpendCents: number; averageSpendCents: number;
  loyaltyPoints: number; loyaltyTier?: string; isVip: boolean; tags: string[]; duplicateRisk?: string; marketingOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean;
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null;   // Decision 1 (profile, not notes)
};
type Pg = { page: number; pageSize: number; totalItems: number; totalPages: number };
type CustomersState = {
  kpisFull: { totalCustomers: number; newCustomersToday: number; returningCustomersToday: number; vipCustomers: number; birthdayThisMonth: number; inactiveCustomers: number; duplicateProfiles: number; loyaltyMembers: number; averageSpendCents: number; newThisMonth?: number; returningThisMonth?: number; atRiskCustomers?: number; riskDays?: number };
  analytics?: { ageGroups: { label: string; count: number }[]; lifetimeValue: { totalRevenueCents: number; totalCustomers: number; repeatRatePercent: number; avgClvCents: number }; rfm: { segment: string; count: number }[]; retentionRatePercent: number };
  rows: { items: Row[]; pagination: Pg };
  filterFacets: { segments: string[]; statuses: string[]; loyaltyTiers: string[]; visitRanges: string[]; spendRanges: string[]; sources: string[]; tags: string[] };
  trends?: { totalCustomers: number | null; newCustomers: number | null; avgSpend: number | null; inactive: number | null; retention: number | null; clv: number | null };
  directory?: { topTags: { name: string; count: number }[]; allTags?: { name: string; count: number }[]; sources: { name: string; count: number }[]; topSpendersCount: number };
  unavailable?: string[];
  segmentCounts?: Partial<Record<'all' | 'never' | 'new' | 'returning' | 'vip' | 'at_risk', number>>;
  retentionSeries?: { month: string; date: string | null; ratePercent: number | null; reason: string | null }[];
  recentActivity?: { customerId: string; displayName: string; avatarUrl?: string; kind: 'visit' | 'added' | 'booked' | 'loyalty'; at: string }[];
};
type ImpSampleRow = { rowNumber: number; firstName: string; lastName: string; phone?: string; email?: string; birthday?: string; action: 'create' | 'update' | 'duplicate' | 'error'; reason?: string };
type ImpPreview = { totalRows: number; toCreate: number; toUpdate: number; duplicates: number; errors: number; invalidEmailsDropped: number; detectedColumns: Record<string, string | undefined>; sample: ImpSampleRow[] };
type ImpResult = { created: number; updated: number; duplicatesSkipped: number; errors: number; invalidEmailsDropped: number; totalRows: number; errorSamples: { rowNumber: number; reason: string }[] };

const money = (c: number) => fmtMoney(c || 0);
const nf = (x: number) => fmtNumber(x || 0);
const fmtTrend = (t: number | null | undefined) => {
  if (t == null) return null;
  const up = t >= 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(t)}%`, up };
};
const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric' }) || iso; } catch { return iso; } };
const stTone = (s: string) => (/active/i.test(s) ? 'ok' : /at.?risk/i.test(s) ? 'warn' : /block/i.test(s) ? 'bad' : /inactive|archiv/i.test(s) ? 'warn' : 'mut');
const tierColor = (t?: string) => (/platinum/i.test(t || '') ? '#6E59C7' : /gold/i.test(t || '') ? '#C9971B' : /silver/i.test(t || '') ? '#8A8F98' : /bronze/i.test(t || '') ? '#B07A3C' : '#8A7A66');

// 8 KPI icons (colored circular) — dedicated to this screen.
const KI: Record<string, JSX.Element> = {
  group: <><circle cx="8" cy="8" r="3" /><path d="M2 19c0-3 2.7-5 6-5M15 8.5a3 3 0 100-5M16 14c2.8.3 5 2.2 5 5" /></>,
  userplus: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-6 6-6M16 10v6M13 13h6" /></>,
  repeat: <><path d="M4 9a8 8 0 0113-3l3 3M20 15a8 8 0 01-13 3l-3-3" /><path d="M20 5v4h-4M4 19v-4h4" /></>,
  crown: <><path d="M4 18h16M3 7l4 4 5-6 5 6 4-4-2 9H5z" /></>,
  userx: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-6 6-6M15 9l5 5M20 9l-5 5" /></>,
  dollar: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.5 9.2c-.5-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.4-2.5-1.2" /></>,
  card: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.4" /><path d="M2.5 9.8h19M6 14.5h4" /></>,
  loyalty: <><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" /></>,
};
function KIcon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" width={17} height={17} aria-hidden>{KI[name]}</svg>; }

const PALETTE = ['#6E59C7', '#2C6BB0', '#E8852B', '#2E7D32', '#C0392B', '#B0A0C8'];
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 112, height: 112, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" strokeLinecap="butt" />; acc += dash; return seg; })}
        <circle cx="70" cy="70" r="36" fill="#fff" />
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66', fontWeight: 600 }}>{Math.round((it.count / total) * 1000) / 10}%</span></div>))}</div>
    </div>
  );
};

// F1 §38/§67: RFM segment names come from the server in English; the POS shows them in its language
const RFM_KEY: Record<string, string> = { Champions: 'cd.rfm.champions', 'Loyal Customers': 'cd.rfm.loyal', 'Potential Loyalists': 'cd.rfm.potential', 'At Risk': 'cd.rfm.atRisk', 'Cannot Lose Them': 'cd.rfm.cannotLose', Hibernating: 'cd.rfm.hibernating', 'No Visits Yet': 'cd.rfm.noVisits' };
const srcLabel = (s: string) => statusLabel('source', s);   // every source code has a canonical label in ns/status (WP-D1)

const ipt: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const sel: React.CSSProperties = { ...ipt, minWidth: 118 };
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '11px 13px' };

export function POSCustomersScreen() {
  const can = useCan();
  const nav = useNavigate();
  const [s, setS] = useState<CustomersState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // filters / paging (all round-trip to the backend)
  // Checkout One-Screen mandate §59 (Oct 28 2026): Checkout's "Open Customer" hands over ?q=<name>&customerId=<id> — the
  // list opens filtered to that guest and their profile opens once their row arrives (context kept, no re-search).
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get('q') || '');
  const pendingProfileId = useRef<string | null>(urlParams.get('customerId'));
  const [status, setStatus] = useState('');
  const [segment, setSegment] = useState(''); // drives tabs + Groups
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const [loyaltyTier, setLoyaltyTier] = useState('');
  const [spendBand, setSpendBand] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);   // F1 §28: 10 / 25 / 50 rows
  const [moreOpen, setMoreOpen] = useState(false);
  // profile drawer
  const [profileRow, setProfileRow] = useState<Row | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  // F1 §30: the row's Message action opens this customer's conversation in the inbox (starting one if none exists) —
  // it used to open a blank send-a-message page with no customer
  const [railOverlay, setRailOverlay] = useState<null | 'tags' | 'sources'>(null);   // F1 §32: View All on the rail cards
  const [msgBusy, setMsgBusy] = useState<string | null>(null); const [actionErr, setActionErr] = useState<string | null>(null);
  const msgKey = useRef<{ id: string; key: string } | null>(null);
  const messageCustomer = (customerId: string) => {
    if (msgKey.current?.id !== customerId) msgKey.current = { id: customerId, key: newRequestKey() };
    setMsgBusy(customerId); setActionErr(null);
    posCommunicationsApi.inbox.start({ customerId }, msgKey.current.key)
      .then((r) => { msgKey.current = null; nav(`/tenant/communications/sms?thread=${encodeURIComponent(r.threadId)}`); })
      .catch((e: any) => { msgKey.current = null; setActionErr(e?.message || tx('cd.msg.failed')); })
      .finally(() => setMsgBusy(null));
  };
  // F1 §31/§64: the drawer is an overlay over the list, so search / filters / page / scroll stay as they were; on close
  // focus goes back to the control that opened it (touch and keyboard users land where they were)
  const profileOpener = useRef<HTMLElement | null>(null);
  const closeProfile = () => { setProfileRow(null); const el = profileOpener.current; profileOpener.current = null; if (el && el.isConnected) setTimeout(() => el.focus(), 0); };
  const openProfile = (row: Row) => {
    profileOpener.current = (document.activeElement as HTMLElement | null) ?? null;
    setProfileRow(row); setProfile(null); setProfileBusy(true);
    (posCustomersApi.getDetail(row.customerId) as Promise<any>).then((d) => setProfile(d)).catch(() => setProfile(null)).finally(() => setProfileBusy(false));
  };
  // edit drawer
  const [editId, setEditId] = useState<string | null>(null);
  // Smooth Refresh spec §14/§49: the version the edit form was OPENED on. A background refetch may bring a newer row
  // while the receptionist types; the save still says which copy it was based on, so a concurrent change elsewhere is
  // reported (VERSION_CONFLICT) instead of silently overwritten — and the unsaved form is never reset by the refetch.
  const [editVersion, setEditVersion] = useState<number | undefined>(undefined);
  const [eEmail, setEEmail] = useState(''); const [eStatus, setEStatus] = useState('active');
  // Decision 1: preferred name / language / branch are profile fields edited with the profile (pos.customers.edit).
  const [ePrefName, setEPrefName] = useState(''); const [ePrefLang, setEPrefLang] = useState(''); const [ePrefBranch, setEPrefBranch] = useState('');
  const [branchOptions, setBranchOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { authApi.branches().then((r: any) => setBranchOptions((r?.branches || []).map((b: any) => ({ id: b.id, name: b.name || b.city || tx('pos.branch') })))).catch(() => {}); }, []);
  const [eVip, setEVip] = useState(false); const [eSms, setESms] = useState(false); const [eEmailOpt, setEEmailOpt] = useState(false); const [eMkt, setEMkt] = useState(false);
  // add customer
  const [addOpen, setAddOpen] = useState(false);
  const [aFirst, setAFirst] = useState(''); const [aLast, setALast] = useState(''); const [aPhone, setAPhone] = useState(''); const [aEmail, setAEmail] = useState(''); const [aSms, setASms] = useState(true); const [aEmailOpt, setAEmailOpt] = useState(false); const [aMkt, setAMkt] = useState(false);
  // duplicates + csv import
  const [importCsv, setImportCsv] = useState('');
  const [impPreview, setImpPreview] = useState<ImpPreview | null>(null);
  const [impResult, setImpResult] = useState<ImpResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);

  const buildQ = useEventCallback(() => ({ search: search || undefined, status: status || undefined, segment: segment || undefined, source: source || undefined, tag: tag || undefined, loyaltyTier: loyaltyTier || undefined, spendBand: spendBand || undefined, page, pageSize }));
  const load = useCallback((q: Record<string, unknown>) => (api.get('/pos/customers/state', q) as Promise<CustomersState>).then((d) => setS(d)).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_customers'))), []);
  const refetch = () => load(buildQ());
  // Smooth Refresh spec §28/§62: a customer created or edited on another device appears on this list — refetch on
  // customer events (routed to the 'customers' screen) and every 45 s while visible (the §81 detail class). The list
  // keeps its search/filters (buildQ) and the open edit form survives (state lives in this component, not the rows).
  useRealtime('customers', () => { void load(buildQ()); }, { intervalMs: SYNC_POLICY.detailMs });
  useEffect(() => {
    const t = setTimeout(() => load(buildQ()), search ? 250 : 0);
    return () => clearTimeout(t);
     
  }, [load, search, status, segment, source, tag, loyaltyTier, spendBand, page, pageSize, buildQ]);

  const [dupOpenCount, setDupOpenCount] = useState(0); const [dupOverlay, setDupOverlay] = useState(false);
  const loadDups = useCallback(() => posDuplicateReviewApi.summary().then((r: any) => setDupOpenCount(Number(r?.kpis?.open ?? 0))).catch(() => setDupOpenCount(0)), []);
  useEffect(() => { loadDups(); }, [loadDups]);

  // when any filter changes, return to page 1
  const setFilter = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const pickTab = (segId: string) => { setSegment(segId); setPage(1); };

  const openEdit = (c: Row) => {
    if (editId === c.customerId) { setEditId(null); return; }
    setEditId(c.customerId); setEditVersion((c as any).version); setNote(null);
    setEEmail(c.email || ''); setEStatus(c.status || 'active');
    setEPrefName(c.preferredName || ''); setEPrefLang(customerLanguageCode(c.preferredLanguage)); setEPrefBranch(c.preferredBranchId || '');
    setEVip(!!c.isVip); setESms(!!c.smsOptIn); setEEmailOpt(!!c.emailOptIn); setEMkt(!!c.marketingOptIn);
  };
  // Phone changes are a FLOW, not a field: enter → duplicate-check → SMS code → the customer proves it. The number
  // does not change until somebody proves they hold it.
  const [phoneEditFor, setPhoneEditFor] = useState<{ id: string; name: string; masked: string | null } | null>(null);

  const saveEdit = async (id: string) => {
    setNote(null); setBusy(id);
    try {
      // NOTE what is NOT sent: `phone`.
      //
      // The generic customer update no longer writes the phone number — it used to, with no E.164 normalization, no
      // duplicate check, no verification and no audit, which meant a receptionist could point a customer's booking
      // codes and appointment reminders at any handset in one PATCH.
      //
      // Sending `phone` here would now be a SILENT NO-OP: the receptionist types a new number, sees no error, and
      // the number never changes. That is worse than the hole. Phone changes go through Edit Phone Number, which
      // verifies by SMS before the number becomes real.
      await posCustomersApi.update(id, { isVip: eVip, smsOptIn: eSms, emailOptIn: eEmailOpt, marketingOptIn: eMkt, status: eStatus, preferredName: ePrefName.trim(), preferredLanguage: ePrefLang.trim(), preferredBranchId: ePrefBranch || null, ...(eEmail.trim() ? { email: eEmail.trim() } : {}) , ...(editVersion != null ? { expectedVersion: editVersion } : {}) });
      setEditId(null); await refetch();
    } catch (e: any) {
      if (e?.status === 409 && e?.code === 'VERSION_CONFLICT') {
        // Keep the form open with what they typed; load the newer copy so they can re-apply and save against it.
        setNote(tx('pos.this_customer_was_changed_on_another_1fnz'));
        setEditVersion(typeof e?.details?.currentVersion === 'number' ? e.details.currentVersion : undefined);
        await refetch();
      } else setNote(e?.message || tx('pos.save_failed'));
    } finally { setBusy(null); }
  };
  const doAdd = async () => {
    if (!aFirst.trim() || !aPhone.trim()) { setNote(tx('pos.first_name_and_mobile_phone_are_1ege')); return; }
    setNote(null); setBusy('add');
    try {
      await posCustomersApi.create({ firstName: aFirst.trim(), lastName: aLast.trim() || undefined, phone: aPhone.trim(), email: aEmail.trim() || undefined, smsOptIn: aSms, emailOptIn: aEmailOpt, marketingOptIn: aMkt });
      setAddOpen(false); setAFirst(''); setALast(''); setAPhone(''); setAEmail(''); setASms(true); setAEmailOpt(false); setAMkt(false);
      await Promise.all([refetch(), loadDups()]);
    } catch (e: any) { setNote(e?.message || tx('pos.could_not_add_customer_possible_duplicate_ntur')); } finally { setBusy(null); }
  };
  const doExport = async () => {
    setNote(null); setBusy('export');
    try {
      const r = await posCustomersApi.exportCsv(buildQ());
      const blob = new Blob([r.csv || ''], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = r.filename || 'customers.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) { setNote(e?.message || tx('pos.export_failed_permission_required')); } finally { setBusy(null); }
  };
  const onImportFile = (e: { target: HTMLInputElement }) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { setImportCsv(String(reader.result || '')); setImpPreview(null); setImpResult(null); setNote(null); }; reader.readAsText(file); };
  const doImportPreview = async () => { if (!importCsv.trim()) { setNote(tx('pos.paste_csv_or_load_a_csv_6rl1')); return; } setNote(null); setImpResult(null); setBusy('imp-preview'); try { setImpPreview(await posCustomersApi.importPreview(importCsv, updateExisting) as ImpPreview); } catch (e: any) { setNote(e?.message || tx('pos.preview_failed')); } finally { setBusy(null); } };
  const doImportCommit = async () => { if (!importCsv.trim()) { setNote(tx('pos.nothing_to_import')); return; } setNote(null); setBusy('imp-commit'); try { const r = await posCustomersApi.importCommit(importCsv, updateExisting) as ImpResult; setImpResult(r); setImpPreview(null); setImportCsv(''); await Promise.all([refetch(), loadDups()]); } catch (e: any) { setNote(e?.message || tx('pos.import_failed')); } finally { setBusy(null); } };
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();

  // One batch member-status request for the whole roster page; non-members are absent from the map. Called before the
  // early returns (optional-chained off `s`) so the hook order stays stable while customers are still loading.
  useEffect(() => {
    const want = pendingProfileId.current; if (!want || !s) return;
    const row = (s.rows?.items ?? []).find((r) => r.customerId === want);
    if (row) { pendingProfileId.current = null; openProfile(row); }
  }, [s]);    
  const memberStatus = useMemberStatusMap((s?.rows?.items ?? []).map((r) => r.customerId));

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_customers')}</div></div>;

  const k = s.kpisFull; const an = s.analytics; const rows = s.rows.items;
  const tr = s.trends;
  const pg: Pg = Object.assign({ page: 1, pageSize, totalItems: rows.length, totalPages: 1 }, s.rows.pagination || {});
  const pct = (n: number) => (k.totalCustomers ? Math.round((n / k.totalCustomers) * 1000) / 10 : 0);
  // F1 §11-12: one server definition per number (docs/customer-directory-metrics.md) — no client-side substitutes
  const atRisk = k.atRiskCustomers ?? an?.rfm.find((x) => /at.?risk/i.test(x.segment))?.count ?? k.inactiveCustomers;
  const sc = s.segmentCounts;
  const topSpenders = s.directory?.topSpendersCount ?? rows.filter((r) => r.totalSpendCents >= 100000).length; // full-base top 5%, else page-scoped ($1k+)

  const kpis8 = [
    { l: tx('pos.total_customers'), v: nf(k.totalCustomers), sub: tx('pos.all_profiles'), trend: tr?.totalCustomers, ic: 'group', color: '#2E7D32', bg: '#EAF4EC' },
    { l: tx('pos.new_customers'), v: nf(k.newCustomersToday), sub: tx('people.customers.kpi.recent'), trend: tr?.newCustomers, ic: 'userplus', color: '#6E59C7', bg: '#EFEAFA' },
    { l: tx('pos.returning_customers_2'), v: nf(k.returningCustomersToday), sub: tx('pos.returningcustomerstoday_of_total', { returningCustomersToday: String(pct(k.returningCustomersToday)) }), trend: undefined, ic: 'repeat', color: '#2C6BB0', bg: '#E9F1FA' },
    { l: tx('pos.vip_customers'), v: nf(k.vipCustomers), sub: tx('pos.vipcustomers_of_total', { vipCustomers: String(pct(k.vipCustomers)) }), trend: undefined, ic: 'crown', color: '#E8852B', bg: '#FDEFE0' },
    { l: tx('pos.inactive_customers_2'), v: nf(k.inactiveCustomers), sub: tx('pos.needs_attention_2'), trend: undefined, ic: 'userx', color: '#C0392B', bg: '#FBEAE8' },
    { l: tx('pos.retention_rate'), v: an ? `${an.retentionRatePercent}%` : '—', sub: tx('pos.repeat_rate_2'), trend: undefined, ic: 'dollar', color: '#2E7D32', bg: '#EAF4EC' },
    { l: tx('pos.avg_spend_per_customer'), v: money(k.averageSpendCents), sub: tx('pos.per_customer_2'), trend: tr?.avgSpend, ic: 'card', color: '#2C6BB0', bg: '#E9F1FA' },
    { l: tx('pos.loyalty_members'), v: nf(k.loyaltyMembers), sub: tx('pos.loyaltymembers_of_total', { loyaltyMembers: String(pct(k.loyaltyMembers)) }), trend: undefined, ic: 'loyalty', color: '#C0392B', bg: '#FBEAE8' },
  ];
  const summary6 = [
    { l: tx('pos.total_customers'), v: nf(k.totalCustomers), sub: tx('pos.all_profiles'), trend: tr?.totalCustomers, seg: '' },
    { l: tx('pos.new_this_month'), v: nf(k.newThisMonth ?? k.newCustomersToday), sub: tx('pos.recent_additions'), trend: tr?.newCustomers, seg: '' },
    { l: tx('pos.returning_this_month'), v: nf(k.returningThisMonth ?? k.returningCustomersToday), sub: tx('pos.returningcustomerstoday_of_total', { returningCustomersToday: String(pct(k.returningThisMonth ?? k.returningCustomersToday)) }), trend: undefined, seg: 'returning' },
    { l: tx('pos.vip_customers'), v: nf(k.vipCustomers), sub: tx('pos.vipcustomers_of_total', { vipCustomers: String(pct(k.vipCustomers)) }), trend: undefined, seg: 'vip' },
    { l: tx('pos.at_risk_customers'), v: nf(atRisk), sub: tx('pos.needs_attention_2'), trend: undefined, seg: 'at_risk' },
    { l: tx('pos.top_spenders'), v: nf(topSpenders), sub: s.directory ? tx('pos.5_of_total_revenue') : tx('pos.on_this_page_1k'), trend: undefined, seg: '' },
  ];
  const tabs = [
    // F1 §15: each tab's count is the server count for exactly what that tab lists (with the other filters applied)
    { id: '', l: tx('pos.all_customers'), n: sc?.all ?? k.totalCustomers },
    { id: 'new', l: tx('pos.new_customers'), n: sc?.new ?? k.newCustomersToday },
    { id: 'returning', l: tx('pos.returning'), n: sc?.returning ?? k.returningCustomersToday },
    { id: 'vip', l: tx('pos.vip_customers'), n: sc?.vip ?? k.vipCustomers },
    { id: 'at_risk', l: tx('pos.at_risk'), n: sc?.at_risk ?? atRisk },
  ];

  // right-rail derivations — prefer full-base backend aggregations; fall back to page-scoped if absent
  const dir = s.directory;
  const tally = (arr: string[]): [string, number][] => { const m = new Map<string, number>(); for (const x of arr) { const key = (x || '').trim(); if (key) m.set(key, (m.get(key) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const srcCounts: [string, number][] = dir?.sources?.length ? dir.sources.map((x) => [x.name, x.count] as [string, number]) : tally(rows.map((r) => r.source).filter(Boolean) as string[]);
  const srcMax = Math.max(1, ...srcCounts.map(([, n]) => n));
  const srcTotal = Math.max(1, srcCounts.reduce((a, [, n]) => a + n, 0));
  const tagCounts: [string, number][] = dir?.topTags?.length ? dir.topTags.map((x) => [x.name, x.count] as [string, number]) : tally(rows.flatMap((r) => r.tags || []));
  const recentActivity = s.recentActivity ?? [];   // F1 §39: whole-salon feed from the server, not the visible page
  const retSeries = s.retentionSeries ?? [];
  const rfmMax = an ? Math.max(1, ...an.rfm.map((x) => x.count)) : 1;

  // pagination window
  const from = pg.totalItems === 0 ? 0 : (pg.page - 1) * pg.pageSize + 1;
  const to = Math.min(pg.page * pg.pageSize, pg.totalItems);
  const pageBtns: (number | '…')[] = [];
  if (pg.totalPages <= 7) { for (let i = 1; i <= pg.totalPages; i++) pageBtns.push(i); }
  else { for (let i = 1; i <= 5; i++) pageBtns.push(i); pageBtns.push('…'); pageBtns.push(pg.totalPages); }

  return (
    <div className="work" style={{ paddingBottom: 16 }}>
      <div className="vh" style={{ marginBottom: 10 }}>
        <h1>{tx('pos.customers')}</h1>
        <div className="sub">{tx('pos.manage_and_grow_your_customer_relationships')}</div>
      </div>
      {confirmUi}

      {/* 8 KPI cards */}
      <div className="grid mb-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
        {kpis8.map((c) => (
          <div key={c.l} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: c.bg, color: c.color, display: 'grid', placeItems: 'center', flex: 'none' }}><KIcon name={c.ic} /></span>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, lineHeight: 1.1 }}>{c.l}</span>
            </div>
            <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 21, fontWeight: 800, marginTop: 7 }}>{c.v}</div>
            {(() => { const tt = fmtTrend(c.trend); return tt ? <div style={{ fontSize: 10.5, marginTop: 2, color: tt.up ? '#2E7D32' : '#C0392B', fontWeight: 700 }}>{tt.text} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_last_month')}</span></div> : <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{c.sub}</div>; })()}
          </div>
        ))}
      </div>

      {/* Header */}


      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <ImeSafeInput type="search" enterKeyHint="search" placeholder={tx('pos.search_by_name_phone_email_loyalty_smpn')} value={search} onValue={(v) => { setSearch(v); setPage(1); }} style={{ ...ipt, flex: 1, minWidth: 240, height: 36 }} />
        <select value={status} onChange={(e) => setFilter(setStatus)(e.target.value)} style={sel}><option value="">{tx('pos.all_status')}</option>{s.filterFacets.statuses.map((x) => <option key={x} value={x}>{customerStatusLabel(x)}</option>)}</select>
        <select value={tag} onChange={(e) => setFilter(setTag)(e.target.value)} style={sel}><option value="">{tx('pos.all_tags')}</option>{s.filterFacets.tags.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select value={segment} onChange={(e) => setFilter(setSegment)(e.target.value)} style={sel}><option value="">{tx('pos.all_groups')}</option>{s.filterFacets.segments.map((x) => <option key={x} value={x}>{customerSegmentLabel(x)}</option>)}</select>
        <select value={source} onChange={(e) => setFilter(setSource)(e.target.value)} style={sel}><option value="">{tx('pos.all_sources_2')}</option>{s.filterFacets.sources.map((x) => <option key={x} value={x}>{srcLabel(x)}</option>)}</select>
        <button className="btn ghost" onClick={() => setMoreOpen((v) => !v)}>{tx('pos.more_filters')}</button>
        <button className="btn ghost" disabled={busy === 'export'} onClick={doExport}>{busy === 'export' ? tx('pos.exporting') : tx('pos.export_2')}</button>
        <button className="btn" style={{ background: '#A9824C', borderColor: '#A9824C', color: '#fff' }} onClick={() => { setAddOpen((v) => !v); setNote(null); }}>{tx('pos.add_customer')}</button>
      </div>

      {moreOpen ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={loyaltyTier} onChange={(e) => setFilter(setLoyaltyTier)(e.target.value)} style={sel}><option value="">{tx('pos.any_loyalty_tier')}</option>{s.filterFacets.loyaltyTiers.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <select value={spendBand} onChange={(e) => setFilter(setSpendBand)(e.target.value)} style={sel}><option value="">{tx('pos.any_spend_band')}</option>{s.filterFacets.spendRanges.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <button className="btn ghost" onClick={() => { setStatus(''); setTag(''); setSegment(''); setSource(''); setLoyaltyTier(''); setSpendBand(''); setSearch(''); setPage(1); }}>{tx('pos.clear_all')}</button>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <label className="btn ghost" style={{ cursor: 'pointer' }}>{tx('pos.import_csv')}<input type="file" accept=".csv,text/csv" onChange={onImportFile} style={{ display: 'none' }} /></label>
            </span>
          </div>
          {importCsv || impPreview || impResult ? (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="s" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={updateExisting} onChange={(e) => { setUpdateExisting(e.target.checked); setImpPreview(null); setImpResult(null); }} /> {tx('pos.update_existing')}</label>
                <button className="btn ghost" disabled={busy === 'imp-preview' || !importCsv.trim()} onClick={doImportPreview}>{busy === 'imp-preview' ? tx('pos.checking') : tx('pos.preview')}</button>
                <button className="btn" disabled={busy === 'imp-commit' || !impPreview || ((impPreview.toCreate ?? 0) === 0 && (!updateExisting || (impPreview.toUpdate ?? 0) === 0))} onClick={doImportCommit}>{busy === 'imp-commit' ? tx('pos.importing') : impPreview ? tx('pos.import_tocreate_v1', { toCreate: String(impPreview.toCreate), v1: String(updateExisting && (impPreview.toUpdate ?? 0) > 0 ? tx('pos.update_toupdate', { toUpdate: String(impPreview.toUpdate) }) : '') }) : tx('pos.import')}</button>
                <span className="s muted">{tx('pos.handles_large_lists_50k_duplicates_matched_b1xv')}</span>
              </div>
              {impPreview ? (() => {
                const cols = impPreview.detectedColumns || {};
                const COLS: { k: string; l: string }[] = [{ k: 'firstName', l: tx('pos.first_name_2') }, { k: 'lastName', l: tx('pos.last_name') }, { k: 'fullName', l: tx('pos.full_name') }, { k: 'phone', l: tx('pos.phone') }, { k: 'email', l: tx('pos.email') }, { k: 'birthday', l: tx('pos.birthday') }];
                const tile = (n: number, label: string, bg: string, fg: string) => (
                  <div style={{ background: bg, color: fg, borderRadius: 8, padding: '6px 10px', minWidth: 78 }}><div style={{ fontFamily: '"Playfair Display",serif', fontWeight: 800, fontSize: 17 }}>{nf(n)}</div><div style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</div></div>
                );
                const aTone = (a: string) => a === 'create' ? { bg: '#EAF4EC', fg: '#2E7D32' } : a === 'update' ? { bg: '#E9F1FA', fg: '#2C6BB0' } : a === 'duplicate' ? { bg: '#EFEAFA', fg: '#6E59C7' } : { bg: '#FBEAE8', fg: '#C0392B' };
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 800, letterSpacing: '.04em', marginBottom: 5 }}>{tx('pos.detected_columns')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {COLS.map((c) => { const mapped = (cols as any)[c.k] !== undefined; return <span key={c.k} className="pill" style={{ background: mapped ? '#EAF4EC' : '#F2ECE0', color: mapped ? '#2E7D32' : '#8A7A66' }}>{c.l}: {mapped ? tx('pos.mapped') : tx('pos.not_found_2')}</span>; })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {tile(impPreview.totalRows, 'rows', '#F4ECDD', '#5a4413')}
                      {tile(impPreview.toCreate, 'to create', '#EAF4EC', '#2E7D32')}
                      {updateExisting ? tile(impPreview.toUpdate, 'to update', '#E9F1FA', '#2C6BB0') : null}
                      {tile(impPreview.duplicates, 'duplicates', '#EFEAFA', '#6E59C7')}
                      {tile(impPreview.errors, 'errors', '#FBEAE8', '#C0392B')}
                      {impPreview.invalidEmailsDropped ? tile(impPreview.invalidEmailsDropped, 'bad emails', '#FFF6E5', '#B5821F') : null}
                    </div>
                    {impPreview.sample?.length ? (
                      <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                          <thead><tr style={{ background: 'var(--page)', textAlign: 'left' }}>{['#', tx('pos.name'), tx('pos.phone'), tx('pos.email'), tx('pos.action'), tx('pos.note')].map((h) => <th key={h} style={{ padding: '5px 8px', color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {impPreview.sample.slice(0, 8).map((r) => {
                              const t = aTone(r.action); return (
                                <tr key={r.rowNumber} style={{ borderBottom: '1px solid var(--line)' }}>
                                  <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{r.rowNumber}</td>
                                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}</td>
                                  <td style={{ padding: '5px 8px' }}>{r.phone || '—'}</td>
                                  <td style={{ padding: '5px 8px' }}>{r.email || '—'}</td>
                                  <td style={{ padding: '5px 8px' }}><span className="pill" style={{ background: t.bg, color: t.fg, textTransform: 'capitalize' }}>{codeLabel(`people.customer.importAction.${r.action}`, r.action)}</span></td>
                                  <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{r.reason || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {impPreview.sample.length > 8 ? <div className="s muted" style={{ padding: '5px 8px' }}>+ {impPreview.sample.length - 8} {tx('pos.more_rows_in_the_file')}</div> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })() : null}
              {impResult ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ background: '#EAF4EC', color: '#2E7D32', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 600 }}>{tx('pos.imported')}{' '}{nf(impResult.created)}{(impResult.updated ?? 0) > 0 ? tx('pos.updated_updated', { updated: String(nf(impResult.updated)) }) : ''}{impResult.duplicatesSkipped ? tx('pos.skipped_duplicatesskipped_duplicate_plural', { duplicatesSkipped: String(nf(impResult.duplicatesSkipped)), plural: String(impResult.duplicatesSkipped === 1 ? '' : 's') }) : ''}{impResult.errors ? tx('pos.errors_error_plural', { errors: String(nf(impResult.errors)), plural: String(impResult.errors === 1 ? '' : 's') }) : ''} {tx('pos.of')}{' '}{nf(impResult.totalRows)} {tx('pos.rows')}</div>
                  {impResult.errorSamples?.length ? (
                    <div style={{ marginTop: 6, border: '1px solid #E8B7B0', borderRadius: 8, padding: '7px 10px', background: '#FFFCFB' }}>
                      <div style={{ fontSize: 11, color: '#9B2C20', fontWeight: 800, marginBottom: 3 }}>{tx('pos.error_report')}</div>
                      {impResult.errorSamples.slice(0, 6).map((e) => <div key={e.rowNumber} className="s" style={{ fontSize: 11.5 }}>{tx('pos.row')}{' '}{e.rowNumber}: {e.reason}</div>)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {addOpen ? (
        <section className="panel" style={{ marginBottom: 12, borderColor: 'var(--gline)' }}>
          <h2 style={{ marginTop: 0 }}>{tx('pos.add_customer_2')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, alignItems: 'center' }}>
            <input placeholder={tx('pos.first_name')} value={aFirst} onChange={(e) => setAFirst(e.target.value)} style={ipt} />
            <input placeholder={tx('pos.last_name')} value={aLast} onChange={(e) => setALast(e.target.value)} style={ipt} />
            <input type="tel" inputMode="tel" placeholder={tx('pos.mobile_phone')} value={aPhone} onChange={(e) => setAPhone(e.target.value)} style={ipt} />
            <input type="email" placeholder={tx('pos.email')} value={aEmail} onChange={(e) => setAEmail(e.target.value)} style={ipt} />
            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={aSms} onChange={(e) => setASms(e.target.checked)} /> {tx('pos.sms_consent')}</label>
            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={aEmailOpt} onChange={(e) => setAEmailOpt(e.target.checked)} /> {tx('pos.email_consent')}</label>
            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={aMkt} onChange={(e) => setAMkt(e.target.checked)} /> {tx('pos.marketing')}</label>
            <button className="btn" disabled={busy === 'add'} onClick={doAdd}>{busy === 'add' ? tx('pos.adding') : tx('pos.create_customer')}</button>
          </div>
          <div className="s muted" style={{ marginTop: 6 }}>{tx('pos.phone_is_normalized_and_checked_for_1sv9')}</div>
        </section>
      ) : null}

      {/* F1 Customer Directory §17-18 (Nov 5 2026): a compact, conditional duplicate alert — the full comparison lives in the
          safe review overlay (the Duplicate Review centre's own compare / keep-separate / preview / merge), never inline */}
      {dupOpenCount > 0 ? (
        <div className="panel cd-dup-alert" role="status" data-testid="dup-alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10, borderColor: 'var(--gline)' }}>
          <strong>{tx('cd.dup.title')}</strong>
          <span className="s muted">{tx('cd.dup.count', { n: nf(dupOpenCount) })}</span>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setDupOverlay(true)} data-testid="dup-review-open">{tx('cd.dup.review')}</button>
        </div>
      ) : null}
      {actionErr ? <div className="err" role="alert" data-testid="cd-action-err" style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>{actionErr}<button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setActionErr(null)}>{tx('pos.close')}</button></div> : null}
      {railOverlay ? (
        <div role="dialog" aria-modal="true" aria-label={tx(railOverlay === 'tags' ? 'pos.top_customer_tags' : 'pos.customer_sources')} data-testid="cd-rail-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRailOverlay(null)}>
          <div className="panel" style={{ width: 420, maxWidth: '94vw', maxHeight: '80vh', overflowY: 'auto', margin: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><h2 style={{ margin: 0 }}>{tx(railOverlay === 'tags' ? 'pos.top_customer_tags' : 'pos.customer_sources')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setRailOverlay(null)}>{tx('pos.close')}</button></div>
            <div className="s muted" style={{ marginBottom: 8 }}>{tx('cd.rail.pick')}</div>
            {(railOverlay === 'tags' ? (s.directory?.allTags ?? s.directory?.topTags ?? []) : (s.directory?.sources ?? [])).map((x) => (
              <button key={x.name} className="btn ghost" data-testid="cd-rail-item" style={{ display: 'flex', width: '100%', minHeight: 44, alignItems: 'center' }}
                onClick={() => { if (railOverlay === 'tags') setFilter(setTag)(x.name); else setFilter(setSource)(x.name); setRailOverlay(null); }}>
                <span>{railOverlay === 'tags' ? x.name : srcLabel(x.name)}</span><span className="muted" style={{ marginLeft: 'auto' }}>{nf(x.count)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {dupOverlay ? <DuplicateQueueOverlay canEdit={can('pos.customers.edit')} canMerge={can('pos.customers.merge')} onClose={() => setDupOverlay(false)} onChanged={() => { loadDups(); refetch(); }} /> : null}

      {/* 6 summary cards */}
      <div className="grid mb-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6  gap-2">
        {summary6.map((c) => (
          <button key={c.l} onClick={() => { setSegment(c.seg); setPage(1); }} style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: segment === c.seg && c.seg ? 'var(--aps-orange)' : 'var(--line)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{c.l}</div>
            <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 20, fontWeight: 800, marginTop: 5 }}>{c.v}</div>
            {(() => { const tt = fmtTrend(c.trend); return tt ? <div style={{ fontSize: 10, marginTop: 2, color: tt.up ? '#2E7D32' : '#C0392B', fontWeight: 700 }}>{tt.text} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_last_month')}</span></div> : <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{c.sub}</div>; })()}
          </button>
        ))}
      </div>

      {/* main split: directory (left) + analytics rail (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_312px] gap-3 items-start">
        <div>
          <div className="overflow-x-auto wi-full mb-3">
            <div className="flex whitespace-nowrap gap-1 border-b border-(--line)  min-w-125">
              {tabs.map((t) => {
                const on = segment === t.id;
                return <button key={t.l} onClick={() => pickTab(t.id)} style={{ background: 'none', border: 'none', borderBottom: on ? '2px solid var(--aps-orange)' : '2px solid transparent', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? 'var(--text)' : 'var(--muted)' }}>{t.l} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{nf(t.n)}</span></button>;
              })}
            </div>
          </div>

          {/* directory table */}
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 850 }}>
                <thead>
                  <tr style={{ background: '#FBF5EA', color: 'var(--muted)', textAlign: 'left' }}>
                    {[tx('pos.customer'), tx('pos.contact'), tx('pos.loyalty'), tx('pos.last_visit_3'), tx('pos.total_visits_2'), tx('pos.total_spent_2'), tx('pos.avg_spent'), tx('pos.status'), tx('pos.actions')].map((h, i) => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.03em', textAlign: i >= 4 && i <= 6 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={9} style={{ padding: 20, color: 'var(--muted)' }}>{tx('pos.no_matching_customers')}</td></tr> : rows.map((c) => (
                    <Fragment key={c.customerId}>
                      <tr key={c.customerId} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <ProfileAvatarWithPreview name={c.displayName} url={c.avatarUrl} size={32} type="customer" subtitle={c.phone || c.email || undefined} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 800, cursor: 'pointer' }} onClick={() => openProfile(c)} title={tx('pos.open_profile')}>{c.displayName} {c.isVip ? <span className="pill warn" style={{ marginLeft: 2 }}>VIP</span> : null} {memberStatus[c.customerId] ? <MembershipChip planName={memberStatus[c.customerId].planName} status={memberStatus[c.customerId].status} compact /> : null}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>#{c.customerId}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px' }}><div>{c.phone || '—'}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.email || '—'}</div></td>
                        <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 700, color: tierColor(c.loyaltyTier) }}>{c.loyaltyTier || '—'}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{nf(c.loyaltyPoints)} {tx('pos.pts')}</div></td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(c.lastVisitAt)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{c.visitCount}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{money(c.totalSpendCents)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{money(c.averageSpendCents)}</td>
                        <td style={{ padding: '8px 12px' }}><span className={'pill ' + stTone(c.status)} style={{ textTransform: 'capitalize' }}>{customerStatusLabel(c.status)}</span></td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn ghost hover:!bg-[#C69A4E] hover:!text-white !border-none" title={can('pos.communications.send') ? tx('pos.message') : tx('cd.msg.noPerm')} aria-label={tx('pos.message')} data-testid="cd-row-message" disabled={!can('pos.communications.send') || msgBusy === c.customerId} onClick={() => messageCustomer(c.customerId)}>✉</button>
                            <button className="btn ghost hover:!bg-[#C69A4E] hover:!text-white !border-none" title={tx('pos.profile_activity')} onClick={() => openProfile(c)}>▦</button>
                            <button className="btn ghost hover:!bg-[#C69A4E] hover:!text-white !border-none" title={tx('pos.edit')} onClick={() => openEdit(c)}>⋯</button>
                          </div>
                        </td>
                      </tr>
                      {editId === c.customerId ? (
                        <tr><td colSpan={9} style={{ background: '#FFFDF8', borderTop: '1px solid var(--line)' }}>
                          <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, alignItems: 'center' }}>
                            {/* NOT a text input any more.
                                Typing here used to change — immediately and silently — where every booking code and
                                appointment reminder went, with no validation, no duplicate check, and no proof the
                                customer held the number. Now it opens a flow that verifies by SMS first. */}
                            <button
                              className="btn"
                              onClick={() => setPhoneEditFor({ id: c.customerId, name: c.displayName || tx('pos.this_customer'), masked: c.phone || null })}
                              style={{ justifySelf: 'start' }}
                            >
                              {tx('pos.edit_phone_number')}
                            </button>
                            <input type="email" placeholder={tx('pos.email')} value={eEmail} onChange={(e) => setEEmail(e.target.value)} style={ipt} />
                            <input aria-label={tx('pos.preferred_name')} placeholder={tx('pos.preferred_name_what_they_like_to_1kgy')} maxLength={60} value={ePrefName} onChange={(e) => setEPrefName(e.target.value)} style={ipt} />
                            <select aria-label={tx('pos.preferred_language_2')} value={ePrefLang} onChange={(e) => setEPrefLang(e.target.value)} style={ipt}>
                              <option value="">{tx('people.customer.language.notSet')}</option>
                              {CUSTOMER_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                            </select>
                            <select aria-label={tx('pos.preferred_branch_2')} value={ePrefBranch} onChange={(e) => setEPrefBranch(e.target.value)} style={ipt}>
                              <option value="">{tx('pos.no_preferred_branch')}</option>
                              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} style={ipt}><option value="active">{tx('pos.active')}</option><option value="inactive">{tx('pos.inactive')}</option><option value="archived">{tx('pos.archived')}</option></select>
                            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eVip} onChange={(e) => setEVip(e.target.checked)} /> VIP</label>
                            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eSms} onChange={(e) => setESms(e.target.checked)} /> SMS</label>
                            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eEmailOpt} onChange={(e) => setEEmailOpt(e.target.checked)} /> {tx('pos.email')}</label>
                            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eMkt} onChange={(e) => setEMkt(e.target.checked)} /> {tx('pos.marketing')}</label>
                            <button className="btn" disabled={busy === c.customerId} onClick={() => saveEdit(c.customerId)}>{busy === c.customerId ? tx('pos.saving_2') : tx('pos.save_2')}</button>
                          </div>

                          {phoneEditFor?.id === c.customerId ? (
                            <div style={{ padding: '0 10px 12px' }}>
                              <POSCustomerPhoneEditor
                                customerId={phoneEditFor.id}
                                customerName={phoneEditFor.name}
                                currentMasked={phoneEditFor.masked}
                                onDone={() => { setPhoneEditFor(null); void refetch(); }}
                                onCancel={() => setPhoneEditFor(null)}
                              />
                            </div>
                          ) : null}
                        </td></tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {/* pagination */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--line)', gap: 8, flexWrap: 'wrap' }}>
              <div className="s muted" data-testid="cd-showing">{tx('cd.page.showing', { from: nf(from), to: nf(to), total: nf(pg.totalItems) })}</div>
              <label className="s muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{tx('cd.page.rows')}
                <select aria-label={tx('cd.page.rows')} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ height: 28 }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="btn ghost" disabled={pg.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                {pageBtns.map((b, i) => b === '…' ? <span key={'e' + i} className="s muted" style={{ padding: '0 4px' }}>…</span> : (
                  <button key={b} onClick={() => setPage(b)} className={'btn' + (b === pg.page ? '' : ' ghost')} style={{ padding: '4px 15px', ...(b === pg.page ? { background: 'var(--aps-orange)', borderColor: 'var(--aps-orange)', color: '#fff' } : {}) }}>{b}</button>
                ))}
                <button className="btn ghost" disabled={pg.page >= pg.totalPages} onClick={() => setPage((p) => Math.min(pg.totalPages, p + 1))}>›</button>
              </div>
            </div>
          </section>
        </div>

        {/* right analytics rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.customer_demographics')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/reports/customers')}>{tx('pos.view_report')}</button></div>
            <div className="s muted" style={{ marginBottom: 8 }}>{tx('pos.age_groups')}</div>
            {an && an.ageGroups.length > 0 ? <Donut items={an.ageGroups} /> : <div className="muted">{tx('pos.no_birthdays_on_file_yet')}</div>}
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.top_customer_tags')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} data-testid="cd-tags-all" onClick={() => setRailOverlay('tags')}>{tx('pos.view_all_4')}</button></div>
            {tagCounts.length === 0 ? <div className="muted">{tx('pos.no_tags_on_this_page')}</div> : tagCounts.slice(0, 6).map(([t, n]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}><span className="pill" style={{ background: '#FCEFD8', color: '#8B5A18' }}>{t}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>{nf(n)} {tx('pos.customers_2')}</span></div>
            ))}
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.customer_sources')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} data-testid="cd-sources-all" onClick={() => setRailOverlay('sources')}>{tx('pos.view_report')}</button></div>
            {srcCounts.length === 0 ? <div className="muted">{tx('pos.no_source_data_on_this_page')}</div> : srcCounts.slice(0, 6).map(([src, n]) => (
              <div key={src} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', fontSize: 11.5, marginBottom: 3 }}><span>{srcLabel(src)}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{nf(n)} · {Math.round((n / srcTotal) * 1000) / 10}%</span></div>
                <div style={{ height: 7, background: '#EFE6D6', borderRadius: 4 }}><div style={{ width: `${Math.round((n / srcMax) * 100)}%`, height: 7, background: 'var(--aps-orange)', borderRadius: 4 }} /></div>
              </div>
            ))}
          </section>
        </div>
      </div>

      {/* bottom analytics: CLV · Retention Trend · RFM · Recent Activity */}
   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-14">
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.customer_lifetime_value')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/reports/customers')}>{tx('pos.view_report')}</button></div>
          {!an ? <div className="muted">{tx('pos.loading')}</div> : (
            <div>
              <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 24, fontWeight: 800, color: '#A96F22' }}>{money(an.lifetimeValue.avgClvCents)}</div>
              <div className="s muted" style={{ marginBottom: 10 }}>{tx('pos.average_clv')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div><div className="s muted">{tx('pos.total_revenue')}</div><div style={{ fontWeight: 700, fontSize: 12 }}>{money(an.lifetimeValue.totalRevenueCents)}</div></div>
                <div><div className="s muted">{tx('pos.customers')}</div><div style={{ fontWeight: 700, fontSize: 12 }}>{nf(an.lifetimeValue.totalCustomers)}</div></div>
                <div><div className="s muted">{tx('pos.repeat_rate')}</div><div style={{ fontWeight: 700, fontSize: 12 }}>{an.lifetimeValue.repeatRatePercent}%</div></div>
              </div>
            </div>
          )}
        </section>
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.customer_retention_trend')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/customers/retention')}>{tx('pos.view_report')}</button></div>
          {an ? (
            <div>
              <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 24, fontWeight: 800 }}>{an.retentionRatePercent}%</div>
              <div className="s muted">{tx('pos.retention_rate_current_repeat_rate')}</div>
              {retSeries.some((m) => m.ratePercent != null) ? (
                <div data-testid="cd-ret-series" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 70, marginTop: 10 }}>
                  {retSeries.map((m) => (
                    <div key={m.month} style={{ flex: 1, textAlign: 'center' }} title={m.ratePercent == null ? tx(m.reason === 'no_branch_data' ? 'cd.ret.noBranch' : 'cd.ret.noData') : `${m.ratePercent}%`}>
                      <div style={{ height: m.ratePercent == null ? 2 : Math.max(3, Math.round((m.ratePercent / 100) * 50)), background: m.ratePercent == null ? '#E5DCCB' : 'var(--aps-orange)', borderRadius: 3 }} />
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{m.ratePercent == null ? '—' : `${m.ratePercent}%`}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{m.month.slice(5)}/{m.month.slice(2, 4)}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="s muted" style={{ marginTop: 10 }} data-testid="cd-ret-empty">{tx(s.unavailable?.includes('retentionSeries') ? 'cd.unavailable' : 'cd.ret.empty')}</div>}
            </div>
          ) : <div className="muted">{tx('pos.loading')}</div>}
        </section>
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.rfm_analysis')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/reports/customers')}>{tx('pos.view_report')}</button></div>
          {an && an.rfm.length > 0 ? an.rfm.map((x) => (
            <div key={x.segment} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', fontSize: 11.5 }}><span>{RFM_KEY[x.segment] ? tx(RFM_KEY[x.segment]) : serverText(x.segment)}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{nf(x.count)} · {an.lifetimeValue.totalCustomers ? Math.round((x.count / an.lifetimeValue.totalCustomers) * 1000) / 10 : 0}%</span></div>
              <div style={{ height: 7, background: '#EFE6D6', borderRadius: 4, marginTop: 3 }}><div style={{ width: `${Math.round((x.count / rfmMax) * 100)}%`, height: 7, background: '#A96F22', borderRadius: 4 }} /></div>
            </div>
          )) : <div className="muted">{tx('pos.no_customers_to_segment_yet')}</div>}
        </section>
      </div>
      {/* F1 §35/§39-41 (Nov 5 2026): last row — Recent Customer Activity (≈72%) beside a compact AI Customer Profile Assistant
          card (≈28%); the large top AI banner is gone */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,28%)] gap-3 items-start" style={{ marginTop: 12 }} data-testid="cd-bottom-row">
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.recent_customer_activity')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/customers/appointment-history')}>{tx('pos.view_all_4')}</button></div>
          {s.unavailable?.includes('recentActivity') && recentActivity.length === 0 ? <div className="muted" data-testid="cd-act-unavailable">{tx('cd.unavailable')}</div> : recentActivity.length === 0 ? <div className="muted">{tx('cd.act.empty')}</div> : recentActivity.map((r) => (
            <div key={r.kind + r.customerId} data-testid="cd-activity-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }} onClick={() => openProfile(rows.find((x) => x.customerId === r.customerId) ?? ({ customerId: r.customerId, displayName: r.displayName, avatarUrl: r.avatarUrl, tags: [] } as unknown as Row))}>
              <ProfileAvatarWithPreview name={r.displayName} url={r.avatarUrl} size={28} type="customer" />
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{r.displayName}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('cd.act.' + r.kind)}</div></div>
              <span className="s muted" style={{ marginLeft: 'auto' }}>{fmtDate(r.at)}</span>
            </div>
          ))}
        </section>
        <section className="panel cd-ai-card" style={{ margin: 0 }} data-testid="cd-ai-card">
          <AiAssistantPanel packageCode="ai_customer_profile_assistant" cta={tx('pos.summarize_customer')} action="profile" buildPrompt={() => "Summarize this nail-salon customer's preferences and flag VIP or churn risk. Be brief."} />
        </section>
      </div>
      {profileRow ? <CustomerDrawer row={profileRow} detail={profile} busy={profileBusy} onClose={closeProfile} nav={nav} /> : null}
    </div>
  );
}

function CustomerDrawer({ row, detail, busy, onClose, nav }: { row: Row; detail: any; busy: boolean; onClose: () => void; nav: (to: string) => void }) {
  const { open: openIPad } = useIPadView();
  const [tab, setTab] = useState<'overview' | 'loyalty' | 'visits' | 'notes'>('overview');
  const d = detail;
  // editable state (synced from the detail payload)
  const [eNotes, setENotes] = useState<any>(null);
  const [eTags, setETags] = useState<string[]>(row.tags || []);
  const [newTag, setNewTag] = useState('');
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjPts, setAdjPts] = useState(0);
  const [adjReason, setAdjReason] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (d?.notes) setENotes({ ...d.notes }); }, [d]);
  const flash = (kk: string) => { setSaved(kk); setTimeout(() => setSaved((s) => (s === kk ? null : s)), 1800); };
  const saveNotes = async () => { if (!eNotes) return; setSaving('notes'); try { await posCustomersApi.setNotes(row.customerId, eNotes); flash('notes'); } catch { /* surfaced via no flash */ } finally { setSaving(null); } };
  const saveTags = async (next: string[]) => { setETags(next); setSaving('tags'); try { await posCustomersApi.setTags(row.customerId, next); flash('tags'); } catch { /* */ } finally { setSaving(null); } };
  const saveLoyalty = async () => { setSaving('loyalty'); try { await posCustomersApi.setLoyalty(row.customerId, { ...(d?.loyalty || {}), points: adjPts, tier: d?.loyalty?.tier || row.loyaltyTier || 'Regular', reason: adjReason }); flash('loyalty'); setAdjOpen(false); setAdjReason(''); } catch { /* */ } finally { setSaving(null); } };
  const st = row.status;
  const loy = d?.loyalty as { points: number; earned: number; redeemed: number; tier: string; tierThresholdPoints: number } | undefined;
  const mem = d?.membership as { plan: string; status: string; renewalDate?: string; benefits: string[]; billingStatus: string } | undefined;
  const gcs = (d?.giftCards as { giftCardId: string; maskedCode: string; balanceCents: number; status: string }[]) || [];
  const visits = (d?.recentVisits as { visitId: string; date: string; serviceName: string; technicianName: string; totalCents: number; tipCents: number }[]) || [];
  const TABS: { id: typeof tab; l: string }[] = [
    { id: 'overview', l: tx('pos.overview') }, { id: 'loyalty', l: tx('pos.loyalty_membership') }, { id: 'visits', l: tx('pos.visits') }, { id: 'notes', l: tx('pos.notes_preferences') },
  ];
  const Row3 = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'flex', padding: '14px 0', borderBottom: '1px solid #F1ECE4', fontSize: 14 }}>
      <span style={{ color: '#8A7A6D' }}>{k}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#2C2A29', textAlign: 'right' }}>{v}</span>
    </div>
  );
  const H = ({ t }: { t: string }) => <h3 style={{ margin: '24px 0 12px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t}</h3>;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,8,.28)', zIndex: 60 }} />
      <aside role="dialog" aria-label={tx('pos.displayname_profile', { displayName: String(row.displayName) })} className="no-scrollbar" style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 540, maxWidth: '94vw', background: '#FFFFFF', borderLeft: '1px solid #EFEAE1', boxShadow: '-24px 0 80px rgba(0,0,0,0.08)', zIndex: 61, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '32px', background: '#FAFAF9', borderBottom: '1px solid #EFEAE1' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <ProfileAvatarWithPreview name={row.displayName} url={row.avatarUrl} size={64} type="customer" subtitle={row.phone || row.email || undefined} />
            <div style={{ minWidth: 0, flex: 1, marginTop: 4 }}>
              <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 26, fontWeight: 800, color: '#2C2A29' }}>{row.displayName} {row.isVip ? <span style={{ background: '#FDEFE0', color: '#C26A12', fontSize: 11, padding: '3px 8px', borderRadius: 12, verticalAlign: 'middle', marginLeft: 6 }}>VIP</span> : null}</div>
              <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4 }}>#{row.customerId.split('-')[0]}{row.loyaltyTier ? ` · ${row.loyaltyTier}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => openIPad(customerRequest((detail || row) as any))} style={{ background: '#FFFFFF', border: '1px solid #EADBB6', borderRadius: 20, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#2C2A29', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }} onMouseOver={e => e.currentTarget.style.background = '#F8F6F3'} onMouseOut={e => e.currentTarget.style.background = '#FFFFFF'}>{tx('pos.full_view')}</button>
              <button onClick={onClose} aria-label={tx('pos.close')} style={{ background: '#FFFFFF', border: '1px solid #EFEAE1', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#8A7A6D', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#FDF0EE'; e.currentTarget.style.color = '#C0392B'; }} onMouseOut={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#8A7A6D'; }}>✕</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center' }}>
            <span style={{ textTransform: 'capitalize', background: st === 'active' ? '#EEF7EF' : '#F8F6F3', color: st === 'active' ? '#2E7D32' : '#8A7A6D', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid', borderColor: st === 'active' ? '#A5D6A7' : '#EFEAE1' }}>• {customerStatusLabel(st)}</span>
            {row.loyaltyTier ? <span style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F1ECE4 100%)', color: '#B5821F', borderRadius: 20, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid #EADBB6' }}>{nf(row.loyaltyPoints)} {tx('pos.pts')}</span> : null}
            <button style={{ marginLeft: 'auto', background: '#F8F6F3', border: '1px solid #EFEAE1', borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 600, color: '#2C2A29', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => nav('/messages')}>{tx('pos.message_2')}</button>
            <button style={{ background: '#2C2A29', border: '1px solid #2C2A29', borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => nav('/booking')}>{tx('pos.booking_2')}</button>
          </div>
        </div>
        <div className="no-scrollbar" style={{ display: 'flex', gap: 24, padding: '0 32px', borderBottom: '1px solid #EFEAE1', overflowX: 'auto', background: '#FAFAF9' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #D4AF37' : '2px solid transparent', padding: '16px 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? '#2C2A29' : '#8A7A6D', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>{t.l}</button>
          ))}
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
          {busy && !d ? <div style={{ fontSize: 14, color: '#8A7A6D', textAlign: 'center', padding: 40 }}>{tx('pos.loading_profile')}</div> : null}

          {tab === 'overview' ? (<>
            <H t={tx('pos.contact_2')} />
            <Row3 k={tx('pos.phone')} v={row.phone || '—'} />
            <Row3 k={tx('pos.email')} v={row.email || '—'} />
            <Row3 k={tx('pos.birthday')} v={row.birthday ? fmtDate(row.birthday) : '—'} />
            <Row3 k={tx('pos.source')} v={row.source ? statusLabel('source', row.source) : '—'} />
            <H t={tx('pos.lifetime_2')} />
            <Row3 k={tx('pos.total_visits_3')} v={nf(row.visitCount)} />
            <Row3 k={tx('pos.total_spent')} v={money(row.totalSpendCents)} />
            <Row3 k={tx('pos.avg_spent_2')} v={money(row.averageSpendCents)} />
            <Row3 k={tx('pos.last_visit')} v={fmtDate(row.lastVisitAt)} />
            <Row3 k={tx('pos.next_appointment')} v={fmtDate(row.nextAppointmentAt)} />
            <H t={tx('pos.communication_consent_2')} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {[['SMS', row.smsOptIn], [tx('pos.email'), row.emailOptIn], [tx('pos.marketing'), row.marketingOptIn]].map(([l, on]) => (
                <span key={l as string} style={{ background: on ? '#EEF7EF' : '#F8F6F3', color: on ? '#2E7D32' : '#8A7A6D', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid', borderColor: on ? '#A5D6A7' : '#EFEAE1' }}>{l as string}: {on ? tx('pos.on') : tx('pos.off')}</span>
              ))}
            </div>
            <H t={tx('pos.tags').toUpperCase()} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
              {eTags.map((tg) => (
                <span key={tg} style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F1ECE4 100%)', color: '#B5821F', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid #EADBB6', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{tg}
                  <button aria-label={tx('pos.remove_tg', { tg: String(tg) })} onClick={() => saveTags(eTags.filter((x) => x !== tg))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B5A18', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', padding: 0 }}>×</button>
                </span>
              ))}
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) { saveTags([...new Set([...eTags, newTag.trim()])]); setNewTag(''); } }} placeholder={tx('pos.add_tag')} style={{ border: '1px dashed #D2C4B3', borderRadius: 20, padding: '6px 14px', fontSize: 13, width: 100, background: '#FAFAF9', outline: 'none' }} />
              {saving === 'tags' ? <span style={{ fontSize: 12, color: '#8A7A6D' }}>{tx('pos.saving')}</span> : saved === 'tags' ? <span style={{ fontSize: 12, color: '#2E7D32' }}>{tx('pos.saved_3')}</span> : null}
            </div>
          </>) : null}

          {tab === 'loyalty' ? (<>
            <div style={{ display: 'flex', alignItems: 'center' }}><H t={tx('pos.loyalty_2')} />
              <button style={{ marginLeft: 'auto', background: '#F8F6F3', border: '1px solid #EFEAE1', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: '#2C2A29', cursor: 'pointer' }} onClick={() => { setAdjPts(loy?.points ?? row.loyaltyPoints); setAdjOpen((v) => !v); }}>{tx('pos.adjust_points_2')}</button>
            </div>
            {adjOpen ? (
              <div style={{ border: '1px solid #EADBB6', borderRadius: 16, padding: 16, marginBottom: 16, background: '#FAFAF9' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <label style={{ width: 100, fontSize: 13, color: '#8A7A6D', fontWeight: 600 }}>{tx('pos.new_balance')}</label>
                  <input type="number" min={0} value={adjPts} onChange={(e) => setAdjPts(Math.max(0, Number(e.target.value) || 0))} style={{ flex: 1, border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                  <label style={{ width: 100, fontSize: 13, color: '#8A7A6D', fontWeight: 600 }}>{tx('pos.reason_2')}</label>
                  <input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder={tx('pos.e_g_service_recovery')} style={{ flex: 1, border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ background: '#2C2A29', color: '#FFFFFF', border: 'none', padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer' }} disabled={saving === 'loyalty' || !adjReason.trim()} onClick={saveLoyalty}>{saving === 'loyalty' ? tx('pos.saving_2') : tx('pos.save_adjustment_2')}</button>
                  <button style={{ background: '#F8F6F3', color: '#2C2A29', border: '1px solid #EFEAE1', padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => setAdjOpen(false)}>{tx('pos.cancel')}</button>
                  {saved === 'loyalty' ? <span style={{ color: '#2E7D32', alignSelf: 'center', fontSize: 13, fontWeight: 600, marginLeft: 8 }}>{tx('pos.saved_3')}</span> : null}
                </div>
              </div>
            ) : null}
            <Row3 k={tx('pos.tier')} v={loy?.tier || row.loyaltyTier || '—'} />
            <Row3 k={tx('pos.points_balance')} v={nf(loy?.points ?? row.loyaltyPoints)} />
            {loy ? <Row3 k={tx('pos.lifetime_earned_2')} v={nf(loy.earned)} /> : null}
            {loy ? <Row3 k={tx('pos.lifetime_redeemed')} v={nf(loy.redeemed)} /> : null}
            <H t={tx('pos.membership_4')} />
            {mem && mem.status !== 'none' ? (<>
              <Row3 k={tx('pos.plan')} v={mem.plan} />
              <Row3 k={tx('pos.status')} v={<span style={{ textTransform: 'capitalize' }}>{membershipStatusLabel(mem.status)}</span>} />
              <Row3 k={tx('pos.renewal')} v={fmtDate(mem.renewalDate)} />
              <Row3 k={tx('pos.billing')} v={mem.billingStatus || '—'} />
            </>) : <div style={{ fontSize: 14, color: '#8A7A6D', padding: '12px 0' }}>{tx('pos.no_active_membership')}</div>}
            <H t={tx('pos.gift_cards_3')} />
            {gcs.length ? gcs.map((g) => <Row3 key={g.giftCardId} k={g.maskedCode} v={<>{money(g.balanceCents)} <span style={{ color: '#8A7A6D', fontWeight: 400, fontSize: 12 }}>· {codeLabel(`people.giftCard.status.${g.status}`, g.status)}</span></>} />) : <div style={{ fontSize: 14, color: '#8A7A6D', padding: '12px 0' }}>{tx('pos.no_gift_cards')}</div>}
          </>) : null}

          {tab === 'visits' ? (<>
            <H t={tx('pos.recent_visits')} />
            {visits.length ? visits.map((v) => (
              <div key={v.visitId} style={{ display: 'flex', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #F1ECE4' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#2C2A29' }}>{v.serviceName || tx('pos.service_3')}</div>
                  <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4 }}>{fmtDate(v.date)}{v.technicianName ? ` · ${v.technicianName}` : ''}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#2C2A29' }}>{money(v.totalCents)}</div>
                  {v.tipCents ? <div style={{ fontSize: 12, color: '#B5821F', fontWeight: 600, marginTop: 2 }}>{tx('pos.tip')}{' '}{money(v.tipCents)}</div> : null}
                </div>
              </div>
            )) : <div style={{ fontSize: 14, color: '#8A7A6D', padding: '20px 0', textAlign: 'center' }}>{tx('pos.no_visit_history_yet')}</div>}
            <div style={{ marginTop: 24, fontSize: 13, color: '#8A7A6D', textAlign: 'center', background: '#FAFAF9', padding: '16px', borderRadius: 12, border: '1px dashed #D2C4B3' }}>{tx('pos.full_visit_appointment_and_transaction_history_s27e')}</div>
          </>) : null}

          {tab === 'notes' ? (eNotes ? (<>
            <H t={tx('pos.safety')} />
            <label style={{ display: 'block', marginBottom: 6, color: '#C0392B', fontWeight: 700, fontSize: 13 }}>{tx('pos.warnings_critical_shown_across_booking_check_xwcb')}</label>
            <textarea value={eNotes.warnings || ''} onChange={(e) => setENotes({ ...eNotes, warnings: e.target.value })} rows={2} style={{ width: '100%', border: '1px solid #FADEDC', borderRadius: 12, padding: '12px 16px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#FDF0EE', outline: 'none' }} />
            <label style={{ display: 'block', margin: '20px 0 6px', color: '#B5821F', fontWeight: 700, fontSize: 13 }}>{tx('pos.allergies_sensitivities')}</label>
            <textarea value={eNotes.allergyNotes || ''} onChange={(e) => setENotes({ ...eNotes, allergyNotes: e.target.value })} rows={2} style={{ width: '100%', border: '1px solid #EADBB6', borderRadius: 12, padding: '12px 16px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#FFFDF8', outline: 'none' }} />

            <H t={tx('pos.preferences')} />
            {([['preferredTechnician', 'pos.preferred_technician'], ['preferredStyle', 'people.customer.notes.preferredStyle'], ['servicePreferences', 'people.customer.notes.servicePreferences']] as const).map(([key, labelKey]) => (
              <div key={key} style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                <label style={{ width: 140, fontSize: 13, color: '#8A7A6D', fontWeight: 600 }}>{tx(labelKey)}</label>
                <input value={eNotes[key] || ''} onChange={(e) => setENotes({ ...eNotes, [key]: e.target.value })} style={{ flex: 1, border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 14, outline: 'none' }} />
              </div>
            ))}

            <H t={tx('pos.salon_notes_2')} />
            <textarea value={eNotes.salonNotes || ''} onChange={(e) => setENotes({ ...eNotes, salonNotes: e.target.value })} rows={3} style={{ width: '100%', border: '1px solid #EFEAE1', borderRadius: 12, padding: '12px 16px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 24, padding: '20px', background: '#FAFAF9', borderRadius: 16, border: '1px dashed #D2C4B3' }}>
              <button style={{ background: '#2C2A29', color: '#FFFFFF', border: 'none', padding: '10px 20px', borderRadius: 24, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }} disabled={saving === 'notes'} onClick={saveNotes}>{saving === 'notes' ? tx('pos.saving_2') : tx('pos.save_notes_2')}</button>
              {saved === 'notes' ? <span style={{ color: '#2E7D32', fontSize: 14, fontWeight: 600 }}>{tx('pos.saved_3')}</span> : null}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8A7A6D' }}>{tx('pos.safety_notes_are_preserved_in_audit_h77k')}</span>
            </div>
          </>) : <div style={{ fontSize: 14, color: '#8A7A6D', textAlign: 'center', padding: 40 }}>{tx('pos.loading_notes')}</div>) : null}
        </div>
      </aside>
    </>
  );
}

/** F1 §18 (Nov 5 2026): the open duplicate groups in a viewport-bounded overlay; a group opens the Duplicate Review centre's
 *  own compare overlay (select primary · keep separate · preview merge · confirm merge — nothing merges from this list) */
function DuplicateQueueOverlay({ canEdit, canMerge, onClose, onChanged }: { canEdit: boolean; canMerge: boolean; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; posDuplicateReviewApi.groups({ status: 'open', sort: 'confidence', page, pageSize: 10 }).then((r) => { if (live) setList(r); }).catch((e: any) => { if (live) setErr(e?.message || tx('cd.dup.loadFailed')); }); return () => { live = false; }; }, [page, tick]);
  if (open) return <CompareOverlay groupId={open} canEdit={canEdit} canMerge={canMerge} onClose={() => setOpen(null)} onChanged={() => { setTick((n) => n + 1); onChanged(); }} />;
  return <FitDialog wide title={tx('cd.dup.title')} subtitle={list ? tx('cd.dup.count', { n: nf(list.total ?? 0) }) : undefined} onClose={onClose} testId="dup-queue">
    {err ? <div className="fk-err" role="alert">{err}</div> : !list ? <div className="muted">{tx('pos.loading')}</div>
      : list.items.length === 0 ? <div className="muted" data-testid="dup-queue-empty">{tx('cd.dup.none')}</div>
      : <table className="tbl w-full" data-testid="dup-queue-table"><thead><tr><th>{tx('pos.customer')}</th><th>{tx('cd.dup.why')}</th><th /></tr></thead>
        <tbody>{list.items.map((g: any) => <tr key={g.id} data-testid="dup-queue-row">
          <td>{g.members.map((m: any) => m.name || '—').join(' · ')}</td>
          <td>{tx('dup.conf.' + g.confidence)} · {g.reasons.map((r: string) => tx('dup.reasonChip.' + r)).join(', ')}</td>
          <td style={{ textAlign: 'right' }}><button className="btn ghost sm" onClick={() => setOpen(g.id)} data-testid="dup-queue-compare">{tx('dup.compare')}</button></td></tr>)}</tbody></table>}
    {list && list.totalPages > 1 ? <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tx('pos.prev')}</button>
      <button className="btn ghost sm" disabled={page >= list.totalPages} onClick={() => setPage(page + 1)}>{tx('pos.next')}</button></div> : null}
    <p className="s muted" style={{ marginTop: 8 }}>{tx('dup.noAutoMerge')}</p>
  </FitDialog>;
}
