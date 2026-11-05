import { MembershipChip, useMemberStatusMap } from './MembershipChip';
import { ProfileAvatarWithPreview, useEventCallback } from '@aipowersalon/ui';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posQueueApi, type QueueFilters } from '../api/posQueueApi';
import { posCheckInApi } from '../api/posCheckInApi';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { api } from '../api/client';
import { AssignTechSheet, type AssignGuest } from '../components/AssignTechSheet';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { QuickCheckInPanel } from '../components/QuickCheckInPanel';
import { useIPadView } from '../components/IPadViewProvider';
import { queueItemRequest } from '../components/ipad-modules';
import { useInlineAsk } from '@aipowersalon/ui';
import { useCan } from '../components/usePermissions';
import { isQueueConflict, queueConflictMessage } from '../lib/queueConflict';
import { VisitPlanPanel } from '../components/VisitPlanPanel';
import { PartyPlanPanel } from '../components/PartyPlanPanel';
import type { QueueGroupView, TechnicianAvailabilityRow, QueueHistoryRow } from '@aipowersalon/api-contracts/tenant';
import { TURN_OVERRIDE_REASONS } from '@aipowersalon/api-contracts/tenant';
import { posTurnQueueApi } from '../api/posTurnQueueApi';
import { t as tx, enPlural, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtNumber, fmtTime as fmtClock } from '../i18n/format';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { statusLabel } from '../i18n/status-label';

// POS Customer Queue — reads /pos/queue/state and wires the front-desk lifecycle.
//
// Customer Queue 27-inch mandate (Oct 28 2026): ONE screen at 1920×1080 with the browser bars and the taskbar (a 1920×945
// page), on the shared Checkout / Service Done / Serving shell (styles.css: .customer-queue-page) — title + filters · 9
// KPIs · Live Customer Queue | Queue Flow Board | AI Queue Insights · Waiting Guests by Priority | Customer Profile
// Preview | Available Technicians · 6 analytics cards · 8 Quick Actions. Every list scrolls INSIDE its fixed panel; a row
// tap selects (the preview fills) and Manage opens a fixed overlay — no row ever expands and pushes the page (§17–§19).
// The board columns are the canonical queue statuses with the server's counts (§20 — the browser derived "Arrived" /
// "Lounge" stages from wait minutes); the priority panel is the server's rankQueue order (§22 — the browser ranked VIP
// above Urgent on its own); the technician panel is the server's on-duty projection from real signals (§25–§29); the
// insights are advisory and open a guest / a preview (§21); KPIs with nothing to measure read "—" (§15). Live / Auto
// Refresh are real (§46–§49); the filters and the selected guest survive a trip to Customers and back (§45).
// Quick Actions all do real work (§50–§57): New Walk-In → Check-In; Add to Queue → the canonical walk-in check-in (one
// idempotency key per submit, the server keeps one active entry per guest); Assign Tech → the assign sheet / visit plan;
// Send Wait Alert → the guest's Customer App through the notification domain; Start Service → the server-validated,
// idempotent start; View Customer → the guest's record; Add Note → the guest's queue note (audited); Open Queue Report.
//
// Kept from before (BUILD_PLAN Phase 6 + Fair Turn): "Best Match" and the Auto Balance preview from the AI engine; every
// assign sends the technician (and version) this board showed, so a stale view is refused with 409 and explained; drag /
// Move up-down reorder; manager locks; parties; split visits (VisitPlanPanel / PartyPlanPanel); history; the override
// reason; Guest declined; Unassign; Cancel with a reason; the iPad full view; ?assign=1 / ?status= deep links.
type QueueItem = {
  queueItemId: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean; source: string;
  requestedServices: { serviceId?: string; serviceName?: string; name?: string; priceCents?: number; isAddon?: boolean; parentServiceId?: string }[]; serviceCount: number; priority: string; status: string; requestedTechnicianName?: string; bestMatchTechnicianName?: string;
  assignedTechnicianName?: string | null; station?: string; checkedInAt: string; quotedWaitMinutes?: number; actualWaitMinutes?: number;
  assignedTechnicianId?: string | null; waitLevel?: 'delayed' | 'normal';
  bestMatchMode?: 'single' | 'split'; bestMatchTechnicianNames?: string[]; sharedVisit?: boolean;
  version?: number; lock?: { technicianId: string | null; reason?: string | null } | null; groupId?: string | null; position?: number | null;
  customerAvatarUrl?: string | null; avatarUrl?: string | null;
};
type QDetail = {
  queueItemId: string; customerId?: string; customerName: string; customerPhone?: string; email?: string; isVip?: boolean; priority?: string; status?: string;
  requestedServices: { serviceId?: string; serviceName?: string; name?: string; isAddon?: boolean }[]; assignedTechnicianName?: string | null; assignedTechnicianId?: string | null;
  loyaltyPoints?: number; visitCount?: number; totalSpendCents?: number; birthday?: string | null; preferredTechName?: string; notes?: string; allergies?: string;
  version?: number; serviceAssignments?: { serviceId: string; serviceName?: string; technicianId: string | null }[]; customerAvatarUrl?: string | null; avatarUrl?: string | null;
};
type QStaff = { technicianId?: string; name: string; specialty?: string; currentLoad?: number; nextAvailable?: string; status: string; avatarUrl?: string | null };
type QInsight = { id: string; text: string; sub?: string; action?: string; route?: string; severity?: 'info' | 'warn' | 'danger'; vars?: Record<string, string | number> };
type QueueState = {
  kpis: { waitingGuests: number; averageWaitMinutes: number | null; longestWaitMinutes: number; vipWaiting: number; appointmentsWaiting: number; walkInsWaiting: number; readyForTech: number; assignedTechnicians: number; delayedQueueItems: number; readyForAssignment: number; estQueueRevenueCents: number; readyForService: number; noShowRisk: number; returnRatePercent: number | null };
  kpiTrends?: Record<string, { deltaPercent: number | null; direction?: 'up' | 'down'; text?: string }>;
  analytics?: { queueTrend: { hour: number; count: number }[]; customerTypeMix: { label: string; sharePercent: number; count: number }[]; visitSourceMix: { label: string; sharePercent: number; count: number }[]; topWaitingServices: { service: string; count: number; sharePercent: number }[]; conversion: { percent: number | null; goalPercent: number; deltaPercent: number | null }; potentialRevenueByService: { service: string; revenueCents: number }[]; potentialRevenueTotalCents: number; potentialRevenueDeltaPercent: number | null };
  staff?: QStaff[];
  staffSummary?: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number };
  insights?: QInsight[];
  flow?: { counts: Record<string, number>; top: Record<string, QueueItem[]> };
  waitingByPriority?: QueueItem[];
  priorityCounts?: Record<string, number>;
  queue: { items: QueueItem[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  filters: { statuses: string[]; sources: string[]; technicians: string[]; serviceCategories: string[]; priorityLevels: string[]; stations: string[] };
};
type Tech = { technicianId: string; displayName: string };
type SvcOpt = { serviceId: string; name: string; durationMinutes?: number; isAddon?: boolean; priceCents?: number };
type Overlay = { kind: 'manage'; id: string } | { kind: 'queue' } | { kind: 'board' } | { kind: 'priority' } | { kind: 'insights' } | { kind: 'balance' } | { kind: 'add' } | { kind: 'note' } | { kind: 'upsell' } | null;
const PRIORITIES = ['normal', 'high', 'vip', 'urgent'];
/** §20: the board's columns — the canonical active queue statuses (the server's QUEUE_FLOW_STAGES) */
const FLOW = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue'] as const;
const FLOW_BG: Record<string, string> = { waiting: '#FBF7EC', called: '#FBF1E6', assigned: '#E9F1FA', ready_for_tech: '#EAF5EE', moved_to_tech_queue: '#F3EEFB' };
const PANEL_ROWS = 50;          // §17: the queue panel holds 50 rows (internal scroll); View Full Queue pages the rest
const CTX_KEY = 'aps.queue.ctx';
const readCtx = (): { search?: string; status?: string; source?: string; service?: string; selId?: string } => { try { return JSON.parse(sessionStorage.getItem(CTX_KEY) || '{}') || {}; } catch { return {}; } };
const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#1F7A3F', RECONNECTING: '#8C5A00', DEGRADED: '#8C5A00', OFFLINE: '#A8321F' };

const svcNames = (r: QueueItem['requestedServices']) => {
  const roots = r.filter(x => !x.isAddon).map((x) => x.serviceName || x.name || '').filter(Boolean);
  const addonsCount = r.filter(x => x.isAddon).length;
  if (!roots.length && !addonsCount) return '';
  const firstRoot = roots[0] || tx('pos.add_on_only');
  const extraCount = Math.max(0, roots.length - 1) + addonsCount;
  return extraCount > 0 ? `${firstRoot} (+${extraCount})` : firstRoot;
};
const inputStyle: CSSProperties = { height: 38, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, minWidth: 0 }}>
      <svg viewBox="0 0 140 140" style={{ width: 'var(--co-chart)', height: 'var(--co-chart)', flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <text x="70" y="78" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: '#4A4032' }}>{total}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>{items.slice(0, 4).map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '0', minWidth: 0 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66', flex: 'none' }}>{Math.round((it.count / total) * 100)}%</span></div>))}</div>
    </div>
  );
};

// Overlays are MODULE-LEVEL components: one declared inside the screen is a new component type on every render, so React
// remounted it on each keystroke — a text field inside lost focus after one letter and a panel inside lost its state.
const OV_H2: CSSProperties = { font: '700 15px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
const OV_CLOSE: CSSProperties = { background: 'var(--card)', border: '1px solid var(--aps-orange)', color: 'var(--aps-orange)', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 'auto', minHeight: 44, padding: '0 16px', flex: 'none', whiteSpace: 'nowrap' };
function OverlayBox({ title, sub, wide, children, testId, onClose }: { title: string; sub?: string; wide?: boolean; children: ReactNode; testId?: string; onClose: () => void }) {
  return (
    <div className="co-overlay" role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={onClose}>
      <div className="co-card" style={wide ? undefined : { width: 'min(760px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><h2 style={OV_H2}>{title}</h2>{sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}<button style={OV_CLOSE} onClick={onClose}>{tx('pos.close')}</button></div>
        <div className="co-scroll">{children}</div>
      </div>
    </div>
  );
}
/** the visit-plan / party-plan editors keep their own Close — they float above the page instead of pushing it down */
function Floating({ children }: { children: ReactNode }) { return <div className="co-overlay" role="dialog" aria-modal="true"><div className="co-card" style={{ width: 'min(980px, 96vw)' }}><div className="co-scroll">{children}</div></div></div>; }

export function POSQueueScreen() {
  const nav = useNavigate();
  const saved0 = readCtx();
  const [s, setS] = useState<QueueState | null>(null);
  const [roster, setRoster] = useState<Tech[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a key + vars, translated at render (a language switch re-labels it)
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState(saved0.search || '');
  const [status, setStatus] = useState(saved0.status || '');
  const [source, setSource] = useState(saved0.source || '');
  const [serviceFilter, setServiceFilter] = useState(saved0.service || '');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [techSel, setTechSel] = useState('');
  // Fair Turn §69: assigning someone other than the recommended technician needs a reason — asked inline after the 400
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideCode, setOverrideCode] = useState('');
  const [prioSel, setPrioSel] = useState('');
  const [prioReason, setPrioReason] = useState('');
  const [reason, setReason] = useState('');
  const can = useCan();
  const { ask, askUi } = useInlineAsk();
  const [groups, setGroups] = useState<QueueGroupView[]>([]);
  const [partyMode, setPartyMode] = useState(false);
  const [partySel, setPartySel] = useState<string[]>([]);
  const [partyLabel, setPartyLabel] = useState('');
  const [partyTogether, setPartyTogether] = useState(true);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [lockTech, setLockTech] = useState('__nobody__');
  const [lockReason, setLockReason] = useState('');
  const [planFor, setPlanFor] = useState<{ queueItemId: string; customerName: string } | null>(null);
  const [partyPlanFor, setPartyPlanFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<QueueHistoryRow[] | null>(null);
  const [avail, setAvail] = useState<Record<string, TechnicianAvailabilityRow>>({});
  const [full, setFull] = useState<{ items: QueueItem[]; page: number; totalPages: number; total: number } | null>(null);
  const [svcCatalog, setSvcCatalog] = useState<SvcOpt[] | null>(null);
  const [noteText, setNoteText] = useState('');
  // §46–§49: the Live chip is the realtime connection's REAL state; Auto Refresh decides whether a pushed event refetches
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => { try { return localStorage.getItem('aps.queue.autoRefresh') !== 'off'; } catch { return true; } });
  const toggleAutoRefresh = () => setAutoRefresh((v) => { try { localStorage.setItem('aps.queue.autoRefresh', v ? 'off' : 'on'); } catch { /* per-viewer convenience only */ } return !v; });

  const filters = (): QueueFilters => ({ search: search || undefined, status: status || undefined, source: source || undefined, serviceCategory: serviceFilter || undefined, pageSize: PANEL_ROWS });
  const load = useCallback((f: QueueFilters) => {
    // parties are display data — a failure there must never block the queue itself
    posQueueApi.groups().then((g) => setGroups(Array.isArray(g) ? g : [])).catch(() => { /* keep what we had */ });
    // when each technician frees up (current service end, breaks, next appointment) — the same inputs the engine uses
    posQueueApi.availability().then((a) => setAvail(Array.isArray(a) ? Object.fromEntries(a.map((x) => [x.technicianId, x])) : {})).catch(() => { /* optional */ });
    return posQueueApi.state(f)
      .then((d) => { setS(d as QueueState); setError(null); })
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_queue')));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load({ search: search || undefined, status: status || undefined, source: source || undefined, serviceCategory: serviceFilter || undefined, pageSize: PANEL_ROWS }); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, status, source, serviceFilter]);

  const refetch = () => load(filters());
  // Realtime: a queue / check-in event for this salon refreshes the board in place (§47) — unless Auto Refresh is off
  useRealtime('queue', () => (autoRefresh ? refetch() : undefined));
  const [selId, setSelId] = useState<string | null>(saved0.selId || null);
  const [detail, setDetail] = useState<QDetail | null>(null);
  const loadDetail = useCallback(async (qid: string) => { try { setDetail(await posQueueApi.item(qid) as QDetail); } catch { /* keep */ } }, []);
  const selectItem = useEventCallback((qid: string) => { setSelId(qid); loadDetail(qid); });
  // the first queued guest fills the preview on load (a guest restored from §45 context is kept)
  useEffect(() => { if (!selId && s?.queue?.items?.length) selectItem(s.queue.items[0].queueItemId); else if (selId && !detail) void loadDetail(selId); }, [s, selId, selectItem, detail, loadDetail]);
  const [changeReqId, setChangeReqId] = useState<string | null>(null);

  // technician roster (ids) for the assign picker — queue facets only carry names
  useEffect(() => {
    (api.get('/pos/technicians/state') as Promise<{ rows: { items: Tech[] } }>)
      .then((d) => setRoster((d?.rows?.items || []).map((t) => ({ technicianId: t.technicianId, displayName: (t as Tech).displayName }))))
      .catch(() => setRoster([]));
  }, []);

  const [quickAssign, setQuickAssign] = useState(false);
  const [quickGuestId, setQuickGuestId] = useState<string>('');
  // Deep-link from the Overview "Assign Tech" quick action: open the assign sheet directly, then clear the param
  // so a refresh or back-navigation doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const assign = searchParams.get('assign');
    const st = searchParams.get('status');
    if (assign !== '1' && !st) return;
    if (assign === '1') setQuickAssign(true);          // Overview "Assign Tech"
    if (st) setStatus(st);                              // Overview "Start Service" → filter to ready-to-start
    const sp = new URLSearchParams(searchParams); sp.delete('assign'); sp.delete('status');
    setSearchParams(sp, { replace: true });
  }, [searchParams, setSearchParams]);
  const [abPreview, setAbPreview] = useState<{ proposals: any[]; unassignable: any[]; summary: any } | null>(null);
  const [abBusy, setAbBusy] = useState(false);
  const { open: openIPad } = useIPadView();
  const runAutoBalance = async () => {
    setNote(null); setAbBusy(true);
    // the preview is the AI engine's `balance` (BUILD_PLAN Phase 6 — contract §A QUEUE_RECOMMENDER); nothing moves until Apply
    try { const p = await posQueueApi.autoBalancePreview(); if (!p.proposals?.length) { setNote(msg(p.unassignable?.length ? 'pos.no_assignable_guests_right_now_waiting_d5xa' : 'pos.nothing_to_balance_no_guests_are_19q5')); setAbPreview(null); } else { setAbPreview(p); setOverlay({ kind: 'balance' }); } }
    catch (e: any) { setNote(e?.message || msg('pos.could_not_compute_a_balance_preview')); }
    finally { setAbBusy(false); }
  };
  const applyAutoBalance = async () => {
    if (!abPreview?.proposals?.length) return;
    setAbBusy(true); setNote(null);
    try {
      // every proposal is for an UNASSIGNED waiting guest: say so, so a guest someone assigned meanwhile is refused (bug 5)
      const r = await posQueueApi.autoBalanceApply(abPreview.proposals.map((p: any) => { const cur = s?.queue?.items?.find((x) => x.queueItemId === p.queueItemId); return { queueItemId: p.queueItemId, technicianId: p.technicianId, expectedTechnicianId: null, ...(cur?.version != null ? { expectedVersion: cur.version } : {}) }; }));
      setNote(msg('pos.auto_balance_applied_applied_assigned_v1', { applied: String(r.applied), v1: r.failures?.length ? msg('pos.length_could_not_be_assigned', { length: String(r.failures.length) }) : '' }));
      setAbPreview(null); setOverlay(null); await refetch();
    } catch (e: any) { setNote(e?.message || msg('pos.apply_failed_no_changes_were_made')); }
    finally { setAbBusy(false); }
  };
  // Names learned from the server-paged pickers (a 200-technician salon: the roster above is one page, so a technician
  // picked from page 9 is not in it).
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({});
  const learnName = (id: string, name?: string) => { if (id && name) setPickedNames((m) => (m[id] === name ? m : { ...m, [id]: name })); };
  const techNameOf = (tid: string) => roster.find((t) => t.technicianId === tid)?.displayName || pickedNames[tid] || null;
  const knownItems = (): QueueItem[] => { const all = [...(s?.queue?.items ?? []), ...(s?.waitingByPriority ?? []), ...Object.values(s?.flow?.top ?? {}).flat(), ...(full?.items ?? [])]; const seen = new Set<string>(); return all.filter((x) => (seen.has(x.queueItemId) ? false : (seen.add(x.queueItemId), true))); };
  const itemById = (qid: string | null) => (qid ? knownItems().find((x) => x.queueItemId === qid) ?? null : null);
  const act = async (qid: string, fn: () => Promise<any>, kind: string, closeDrawer?: boolean, okNote?: (r: any) => Msg | null) => {
    setNote(null); setBusyId(qid + kind);
    try {
      const r = await fn();
      if (kind === 'notify' && r && r.configured === false) setNote(r.disabledReason || msg('pos.notifications_are_not_configured'));
      else if (okNote) { const n = okNote(r); if (n) setNote(n); }
      if (closeDrawer) { setOverlay(null); setReason(''); setTechSel(''); setPrioSel(''); setPrioReason(''); setOverrideFor(null); setOverrideCode(''); }
      await refetch(); if (selId === qid) void loadDetail(qid);
    } catch (e: any) {
      // spec §77 / BUILD_PLAN Phase 6: another device changed the guest first — say who has them now, in plain words
      if (e?.code === 'MANUAL_OVERRIDE_REASON_REQUIRED') { setOverrideFor(qid); setNote(e?.message || msg('pos.choose_a_reason_for_this_override')); }
      else if (isQueueConflict(e)) { setNote(queueConflictMessage(e, itemById(qid)?.customerName, techNameOf)); void refetch(); }
      // §52: the message is already worded from the server's code in the user's language (posHttp → error-text); a 409 means
      // the guest moved on another device — show the fresh board
      else { setNote(e?.message || msg('pos.action_failed')); if (e?.status === 409) void refetch(); }
    }
    finally { setBusyId(null); }
  };
  /** what this board showed for the guest — sent with every assign so a stale view is refused, never applied */
  const expectedFor = (qid: string) => { const shown = itemById(qid); return shown ? { expectedTechnicianId: shown.assignedTechnicianId ?? null, ...(shown.version != null ? { expectedVersion: shown.version } : {}) } : {}; };

  const doStart = (qid: string) => act(qid, () => posQueueApi.startService(qid), 'start', false, (r) => (r?.duplicate ? tx('ops.serving.alreadyStarted') : tx('ops.serving.started')));
  const doNotify = (qid: string) => act(qid, () => posQueueApi.notifyCustomer(qid, { channel: 'sms' }), 'notify');
  const doSendToTech = (qid: string) => act(qid, () => posQueueApi.moveToTechQueue(qid), 'tech', false, (r) => (r?.duplicate ? tx('ops.queue.alreadySentToTech') : tx('ops.queue.sentToTech')));
  const openManage = (it: QueueItem) => {
    setNote(null); setOverrideFor(null); setOverrideCode(''); setReason(''); setTechSel(''); setPrioSel(it.priority || ''); setPrioReason('');
    setLockTech('__nobody__'); setLockReason(''); setHistoryFor(null); setHistory(null);
    if (selId !== it.queueItemId) { setSelId(it.queueItemId); void loadDetail(it.queueItemId); }   // services for the per-service editor
    setOverlay({ kind: 'manage', id: it.queueItemId });
  };
  const doAssign = (qid: string) => {
    if (!techSel) { setNote(msg('pos.pick_a_technician_to_assign')); return; }
    // Smooth Refresh spec §77: say which assignee this board showed; if another device changed it first the server
    // answers 409 VERSION_CONFLICT (handled in act) instead of silently reassigning the guest.
    if (overrideFor === qid && !overrideCode) { setNote(msg('pos.choose_why_you_are_assigning_someone_98k2')); return; }
    act(qid, () => posQueueApi.assignTechnician(qid, { technicianId: techSel, ...expectedFor(qid), ...(overrideFor === qid && overrideCode ? { overrideReasonCode: overrideCode } : {}) }), 'assign', true);
  };
  // ── BUILD_PLAN Phase 6: reorder (drag a row onto another, or Move up / down), locks, parties, per-service techs, history ──
  const filtered = !!(search || status || source || serviceFilter);
  const reorderTo = (fromId: string, toId: string) => {
    if (fromId === toId || !s) return;
    if (filtered) { setNote(msg('pos.clear_the_search_and_filters_to_10wi')); return; }
    const list = [...s.queue.items]; const from = list.findIndex((x) => x.queueItemId === fromId); const to = list.findIndex((x) => x.queueItemId === toId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1); list.splice(to, 0, moved);
    act(fromId, () => posQueueApi.reorder(list.map((x) => ({ queueItemId: x.queueItemId, ...(x.version != null ? { expectedVersion: x.version } : {}) }))), 'reorder');
  };
  const moveBy = (qid: string, d: -1 | 1) => { const list = s?.queue?.items || []; const i = list.findIndex((x) => x.queueItemId === qid); const j = i + d; if (i < 0 || j < 0 || j >= list.length) return; reorderTo(qid, list[j].queueItemId); };
  const doLock = (qid: string) => {
    if (!lockReason.trim()) { setNote(msg('pos.a_lock_needs_a_reason')); return; }
    act(qid, () => posQueueApi.lock(qid, { technicianId: lockTech === '__nobody__' ? null : lockTech, reason: lockReason.trim() }), 'lock', true);
  };
  const doUnlock = (qid: string) => ask(tx('ops.queue.unlockWhy'), (why) => { act(qid, () => posQueueApi.unlock(qid, { reason: why }), 'unlock', true); }, { confirmLabel: tx('pos.unlock') });
  const createParty = async () => {
    if (partySel.length < 2) { setNote(msg('pos.pick_at_least_two_guests_for_ss9c')); return; }
    if (!partyLabel.trim()) { setNote(msg('pos.give_the_party_a_name_e_alao')); return; }
    await act(partySel[0], () => posQueueApi.createGroup({ label: partyLabel.trim(), queueItemIds: partySel, together: partyTogether }), 'party');
    setPartyMode(false); setPartySel([]); setPartyLabel('');
  };
  const groupLabel = (gid?: string | null) => (gid ? groups.find((g) => g.groupId === gid)?.label || tx('ops.queue.party') : null);
  const servicesOf = (qid: string): { serviceId: string; serviceName: string; technicianId: string | null }[] => {
    if (!detail || detail.queueItemId !== qid) return [];
    if (detail.serviceAssignments?.length) return detail.serviceAssignments.map((x) => ({ serviceId: x.serviceId, serviceName: x.serviceName || tx('pos.service_3'), technicianId: x.technicianId }));
    return (detail.requestedServices || []).filter((x) => x.serviceId).map((x) => ({ serviceId: x.serviceId!, serviceName: x.serviceName || x.name || tx('pos.service_3'), technicianId: null }));
  };
  /** a split best match (or a visit already split) is planned as a whole — never assigned to one technician */
  const isSplit = (it: QueueItem) => it.bestMatchMode === 'split' || !!it.sharedVisit;
  const openPlan = (it: { queueItemId: string; customerName: string }) => { setNote(null); setPartyPlanFor(null); setOverlay(null); setPlanFor({ queueItemId: it.queueItemId, customerName: it.customerName }); };
  const bestMatchLabel = (it: QueueItem) => (it.bestMatchMode === 'split' && it.bestMatchTechnicianNames?.length ? it.bestMatchTechnicianNames.join(' + ') : it.bestMatchTechnicianName || it.assignedTechnicianName || '—');
  const toggleHistory = async (qid: string) => {
    if (historyFor === qid) { setHistoryFor(null); setHistory(null); return; }
    setHistoryFor(qid); setHistory(null);
    try { const r = await posQueueApi.history(qid); setHistory(Array.isArray(r?.history) ? r.history : []); } catch (e: any) { setHistory([]); setNote(e?.message || msg('pos.could_not_load_the_history')); }
  };
  // Fair Turn §67: the GUEST declined this technician — the technician keeps her place and is not offered this guest again
  const doGuestDeclined = (qid: string, technicianId: string) => ask(tx('ops.queue.guestDeclinedNote'), (why) => { act(qid, () => posTurnQueueApi.customerDeclined({ queueItemId: qid, technicianId, ...(why ? { reason: why } : {}) }), 'gdecl'); }, { confirmLabel: tx('pos.record'), optional: true });
  // Unassign — the undo for Assign (it had none: a wrong or sick technician meant cancelling the guest's place in line)
  const doUnassign = (qid: string) => act(qid, () => posQueueApi.unassignTechnician(qid, {}), 'unassign', true);
  // §23: moving a guest above Normal changes the line's fairness — permission (server), a reason, the audit row
  const doPriority = (qid: string) => {
    if (!prioSel) { setNote(msg('pos.pick_a_priority')); return; }
    const cur = itemById(qid)?.priority;
    if (prioSel !== 'normal' && prioSel !== cur && !prioReason.trim()) { setNote(tx('errors.PRIORITY_REASON_REQUIRED')); return; }
    act(qid, () => posQueueApi.updatePriority(qid, { priority: prioSel, ...(prioReason.trim() ? { reason: prioReason.trim() } : {}) }), 'prio', true);
  };
  const doCancel = (qid: string) => { if (!reason.trim()) { setNote(msg('pos.a_reason_is_required_to_cancel')); return; } act(qid, () => posQueueApi.cancel(qid, { reason: reason.trim() }), 'cancel', true); };

  // One batch member-status request for everyone in the queue; non-members are absent from the map. Called before the
  // early returns (optional-chained off `s`) so hook order stays stable while the queue loads.
  const memberStatus = useMemberStatusMap((s?.queue?.items ?? []).map((it) => it.customerId));

  const O = 'var(--aps-orange)';
  const h2: CSSProperties = { font: '700 13px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const ghostBtn: CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 9, padding: '0 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 32, whiteSpace: 'nowrap' };
  const orangeBtn: CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 9, padding: '0 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', minHeight: 40, whiteSpace: 'nowrap' };
  const linkBtn: CSSProperties = { ...ghostBtn, border: 'none', padding: '0 2px', minHeight: 30, background: 'transparent' };
  const off: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
  const sel = (v: string, on: (x: string) => void, label: string, opts: ReactNode) => <select aria-label={label} value={v} onChange={(e) => on(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 8px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', maxWidth: 150 }}>{opts}</select>;
  const closeOverlay = () => setOverlay(null);
  const titleRow = (
    <div className="co-title">
      <h1>{tx('pos.customer_queue')}</h1>
      <div className="co-sub">{tx('pos.real_time_guest_flow_waitlist_assignment_izhi')}</div>
      <div className="co-filters">
        <ImeSafeInput type="search" enterKeyHint="search" aria-label={tx('pos.search_queue')} value={search} onValue={setSearch} placeholder={tx('pos.search_guest_phone')} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', width: 160 }} />
        {sel(serviceFilter, setServiceFilter, tx('pos.service_filter'), <><option value="">{tx('pos.all_services')}</option>{(s?.filters?.serviceCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}</>)}
        {sel(source, setSource, tx('pos.source_filter'), <><option value="">{tx('pos.all_sources_2')}</option>{(s?.filters?.sources || []).map((sc) => <option key={sc} value={sc}>{visitType(sc)}</option>)}</>)}
        {sel(status, setStatus, tx('pos.queue_status'), <><option value="">{tx('pos.queue_status')}</option>{(s?.filters?.statuses || []).map((st) => <option key={st} value={st}>{statusLabel('queueItem', st)}</option>)}</>)}
        <span data-testid="queue-live" data-live={live} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: LIVE_TONE[live], fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 99, background: LIVE_TONE[live] }} />{tx(`payment.board.live.${live}`)}</span>
        <button aria-pressed={autoRefresh} data-testid="queue-auto-refresh" title={tx('payment.board.autoRefreshHint')} onClick={toggleAutoRefresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${autoRefresh ? O : 'var(--line)'}`, borderRadius: 9, padding: '0 10px', fontSize: 12, background: autoRefresh ? '#FCF3E4' : 'var(--card)', color: autoRefresh ? O : 'var(--muted)', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{tx('pos.auto_refresh')}</button>
        <button aria-label={tx('pos.refresh')} title={tx('pos.refresh')} onClick={refetch} style={{ border: '1px solid var(--line)', borderRadius: 9, width: 38, background: 'var(--card)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.8"><path d="M4 10a6 6 0 0110-4.5M16 10a6 6 0 01-10 4.5M14 3v3h-3M6 17v-3h3" /></svg></button>
      </div>
    </div>
  );
  // the visit's source code → a short label in the user's language (the code stays the filter value)
  function visitType(src: string) { return src === 'appointment' ? tx('pos.appt_2') : src === 'ai' ? tx('ops.common.ai') : src === 'online' ? tx('ops.queue.app') : tx('glossary.action.walkIn'); }

  // §80: the loading state is the board's own skeleton — the same fixed modules, so nothing shifts when data arrives;
  // a failure stays inside the queue panel with Retry
  if (!s) return (
    <div className="customer-queue-page" data-testid="queue-page" aria-busy={!error}>
      {titleRow}
      <div className="co-kpis">{Array.from({ length: 9 }, (_, i) => <div key={i} className="co-card co-kpi" />)}</div>
      <div className="sd-main">{['pos.live_customer_queue', 'pos.queue_flow_board', 'pos.ai_queue_insights', 'pos.waiting_guests_by_priority', 'pos.customer_profile_preview', 'pos.available_technicians_for_queue'].map((key, i) => (
        <section key={key} className="co-card co-panel"><div className="co-head"><h2 style={h2}>{tx(key)}</h2></div>
          {i === 0 ? <div className="err" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: error ? '#A8321F' : 'var(--muted)', fontSize: 12, background: 'transparent', border: 'none' }}>{error ? <>{error}<button style={ghostBtn} onClick={refetch}>{tx('pos.retry')}</button></> : tx('pos.loading_queue')}</div> : null}
        </section>))}</div>
      <div className="co-ana">{Array.from({ length: 6 }, (_, i) => <section key={i} className="co-card" />)}</div>
      <div className="co-qa">{Array.from({ length: 8 }, (_, i) => <div key={i} className="co-card" />)}</div>
    </div>
  );

  const k = s.kpis;
  const a = s.analytics;
  const nowMs = Date.now();
  const items = s.queue.items;
  const pg = s.queue.pagination;
  const memberChip = (cid?: string) => (cid && memberStatus[cid] ? <MembershipChip planName={memberStatus[cid].planName} status={memberStatus[cid].status} compact /> : null);
  const m0 = (c?: number) => fmtMoney(c || 0, { whole: true });
  const hhmm = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtClock(d); };
  // §36: the wait is the server's (actualWaitMinutes, server clock) — the browser clock is only a fallback for an old row
  const waitOf = (it: QueueItem) => it.actualWaitMinutes ?? Math.max(0, Math.floor((nowMs - new Date(it.checkedInAt).getTime()) / 60000));
  const trend = (key: string) => s.kpiTrends?.[key];
  const reqTech = (it: QueueItem) => it.requestedTechnicianName || it.assignedTechnicianName || tx('pos.any');
  const prioLabel = (p: string) => statusLabel('priority', p);
  const NED = tx('ops.serviceDone.notEnoughData');
  // the server's insight (id + vars) in the user's language; its English text for an id this screen does not know
  const hourLabel = (h: number) => { try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h)); } catch { return String(h); } };
  const insightText = (ins: QInsight): { text: string; sub?: string } => {
    const v = ins.vars; if (!v) return ins;
    const V = (x: unknown) => String(x ?? '');
    if (ins.id === 'peak') return { text: tx('ops.queue.insight.peak', { window: `${hourLabel(Number(v.fromHour))} – ${hourLabel(Number(v.toHour))}` }), sub: tx('ops.queue.insight.peakSub') };
    if (ins.id === 'vip') return { text: tx('ops.queue.insight.vip', { name: V(v.name), minutes: V(v.minutes) }), sub: tx('ops.queue.insight.vipSub') };
    if (ins.id === 'longWait') return { text: tx('ops.queue.insight.longWait', { name: V(v.name), minutes: V(v.minutes) }), sub: tx('ops.queue.insightSub.longWait') };
    if (ins.id === 'unassigned') return { text: tx('ops.queue.insight.unassigned', { count: V(v.count), free: V(v.free) }), sub: tx('ops.queue.insightSub.unassigned') };
    if (ins.id === 'noShow') return { text: tx('ops.queue.insight.noShow', { count: V(v.count) }), sub: tx('ops.queue.insightSub.noShow') };
    if (ins.id === 'upsell') return { text: tx('ops.queue.insight.upsell', { count: V(v.count) }), sub: tx('ops.queue.insight.upsellSub') };
    return ins;
  };
  // the server's action names (English) are the routing keys; their labels are translated
  const insightAction = (x: string) => (x === 'Auto Balance Queue' ? tx('pos.auto_balance_queue') : x === 'Assign VIP Now' ? tx('ops.queue.insight.assignVip') : x === 'View Suggestions' ? tx('pos.view_suggestions') : x === 'Open' ? tx('ops.insight.open') : x);
  // §21: advisory — an insight opens a guest, the assign sheet or the Auto Balance PREVIEW; it never changes the queue itself
  const insightAct = (ins: QInsight) => {
    const r = ins.route || '';
    if (ins.action === 'Auto Balance Queue' || r === 'balance') { void runAutoBalance(); return; }
    if (r.startsWith('guest:')) { setOverlay(null); selectItem(r.slice(6)); return; }
    if (r.startsWith('assign:')) { const id = r.slice(7); const it = itemById(id); setOverlay(null); selectItem(id); if (it && isSplit(it)) openPlan(it); else { setQuickGuestId(id); setQuickAssign(true); } return; }
    if (r && r !== '/queue') { saveCtx(); nav(r); }
  };
  // the analytics mixes arrive as a fixed English label set (customer type / visit source) — labelled here
  const MIX_LABEL: Record<string, () => string> = { Returning: () => tx('pos.returning'), New: () => tx('pos.new'), VIP: () => statusLabel('priority', 'vip'), 'Walk-In': () => tx('glossary.action.walkIn'),
    App: () => tx('ops.queue.app'), Phone: () => tx('pos.phone'), 'AI Receptionist': () => tx('pos.ai_receptionist'), 'In Person': () => tx('ops.checkIn.source.inPerson') };
  const mixLabel = (l: string) => MIX_LABEL[l]?.() ?? l;
  // the server's staff status / next-available words (English) → labels; a number is "in N min"
  const STAFF_LABEL: Record<string, () => string> = { Available: () => tx('pos.available'), Busy: () => tx('pos.busy'), Break: () => tx('pos.break'), 'Finishing Soon': () => tx('pos.finishing_soon'), Now: () => tx('pos.now'), Soon: () => tx('ops.techQueue.next.soon') };
  const staffWord = (w: string) => (/^\d+$/.test(w) ? tx('pos.in_availableinminutes_min', { availableInMinutes: w }) : STAFF_LABEL[w]?.() ?? w);

  const ICONS: Record<string, { bg: string; fg: string; d: string }> = {
    guests: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M7 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm6 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 17a4 4 0 018 0M11 17a4 4 0 016 0' },
    walk: { bg: '#EFEAFA', fg: '#6E59C7', d: 'M10 5a2 2 0 100-2 2 2 0 000 2zM9 8l-2 9M11 8l3 3M9 8l3 1' },
    vip: { bg: '#FBF1DC', fg: '#C9971B', d: 'M3 7l3 3 4-5 4 5 3-3v7H3z' },
    assign: { bg: '#FDEFE0', fg: '#E8852B', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0M15 4l2 2-2 2' },
    clock: { bg: '#E8F0FB', fg: '#3C7FB6', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v3l2 2' },
    revenue: { bg: '#FBF1DC', fg: '#C9971B', d: 'M10 3v14M7 6h5a2 2 0 010 4H8a2 2 0 000 4h5' },
    service: { bg: '#FDEFE0', fg: '#E8852B', d: 'M4 10l4 4 8-9' },
    risk: { bg: '#FBE9E7', fg: '#C0392B', d: 'M10 3l8 14H2zM10 8v4M10 15h.01' },
    heart: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 17S3 12 3 7.5A3.5 3.5 0 0110 5a3.5 3.5 0 017 2.5C17 12 10 17 10 17z' },
  };
  // §13–§15: the server's KPIs and definitions (QUEUE_KPI_DEFINITIONS); a KPI with nothing to measure is "—", never 0
  const kpis: { key: string; l: string; v: string; ico: string; downGood?: boolean; note?: string; noTrend?: boolean }[] = [
    { key: 'waiting', l: tx('pos.guests_waiting'), v: String(k.waitingGuests), ico: 'guests' },
    { key: 'walkIns', l: tx('pos.walk_ins_2'), v: String(k.walkInsWaiting), ico: 'walk' },
    { key: 'vip', l: tx('pos.vip_guests'), v: String(k.vipWaiting), ico: 'vip' },
    { key: 'readyForAssignment', l: tx('pos.ready_for_assignment'), v: String(k.readyForAssignment), ico: 'assign' },
    { key: 'avgWait', l: tx('pos.avg_wait_time'), v: k.averageWaitMinutes != null ? tx('pos.averagewaitminutes_min', { averageWaitMinutes: String(k.averageWaitMinutes) }) : '—', ico: 'clock', downGood: true, note: k.averageWaitMinutes == null ? NED : undefined, noTrend: k.averageWaitMinutes == null },
    { key: 'estRevenue', l: tx('pos.est_queue_revenue'), v: m0(k.estQueueRevenueCents), ico: 'revenue', note: tx('ops.queue.projected') },
    { key: 'readyForService', l: tx('pos.ready_for_service'), v: String(k.readyForService), ico: 'service' },
    { key: 'noShowRisk', l: tx('pos.no_show_risk'), v: String(k.noShowRisk), ico: 'risk', downGood: true },
    { key: 'returnRate', l: tx('pos.return_rate'), v: k.returnRatePercent != null ? `${k.returnRatePercent}%` : '—', ico: 'heart', note: k.returnRatePercent == null ? NED : undefined, noTrend: k.returnRatePercent == null },
  ];

  // §20: the Guest Flow Board = canonical status columns with the SERVER's counts and first rows (fallback: this page's rows)
  const flowCount = (st: string) => s.flow?.counts?.[st] ?? items.filter((x) => x.status === st).length;
  const flowRows = (st: string) => s.flow?.top?.[st] ?? items.filter((x) => x.status === st).slice(0, 3);
  // §22: the priority panel is the server's rankQueue order (fallback: the server's queue order)
  const byPriority = s.waitingByPriority ?? items.filter((it) => ['waiting', 'called', 'assigned'].includes(it.status)).slice(0, 8);
  const pc = s.priorityCounts;

  const PRIO_TONE: Record<string, { bg: string; fg: string }> = { vip: { bg: '#EFEAFA', fg: '#6E59C7' }, urgent: { bg: '#FBE9E7', fg: '#C0392B' }, high: { bg: '#FBE9E7', fg: '#C0392B' }, normal: { bg: '#F1ECE2', fg: '#8A7A66' } };
  const STATUS_TONE: Record<string, { bg: string; fg: string }> = { waiting: { bg: '#FBF1E6', fg: '#8C5A00' }, vip: { bg: '#EFEAFA', fg: '#553FB0' }, ready: { bg: '#E9F6EC', fg: '#1F7A3F' }, assigned: { bg: '#E9F1FA', fg: '#2F6699' }, notified: { bg: '#E9F1FA', fg: '#2F6699' } };
  // the chip is a CODE (colour key); its words come from ns/status at render (Vietnamese POS mandate §62)
  const chipCode = (it: QueueItem) => (it.isVip || it.priority === 'vip' ? 'vip' : it.status === 'ready_for_tech' ? 'ready' : it.status === 'assigned' ? 'assigned' : it.status === 'called' ? 'notified' : 'waiting');
  // the row's action is a CODE (what the button does); its words are read at render
  const rowAction = (it: QueueItem): 'start' | 'notify' | 'sendToTech' | 'assign' => (it.status === 'ready_for_tech' ? 'start' : it.isVip || it.priority === 'vip' ? (it.assignedTechnicianId ? 'sendToTech' : 'notify') : it.status === 'assigned' ? 'sendToTech' : 'assign');
  const rowActionLabel = (x: ReturnType<typeof rowAction>) => (x === 'start' ? tx('pos.start') : x === 'notify' ? tx('pos.notify') : x === 'sendToTech' ? tx('ops.queue.sendToTech') : tx('pos.assign'));
  const runRowAction = (it: QueueItem) => { const x = rowAction(it); selectItem(it.queueItemId); if (x === 'start') void doStart(it.queueItemId); else if (x === 'notify') void doNotify(it.queueItemId); else if (x === 'sendToTech') void doSendToTech(it.queueItemId); else if (isSplit(it)) openPlan(it); else { setQuickGuestId(it.queueItemId); setQuickAssign(true); } };

  const staff = (s.staff || []).slice(0, 8);   // §29: never 200 rows — the server's top on-duty technicians + the summary
  const sum = s.staffSummary;
  const STAFF_TONE: Record<string, { bg: string; fg: string }> = { Available: { bg: '#E9F6EC', fg: '#1F7A3F' }, 'Finishing Soon': { bg: '#FFF4E0', fg: '#8C5A00' }, Busy: { bg: '#FBF1E6', fg: '#8C5A00' }, Break: { bg: '#E8F0FB', fg: '#2F6699' } };
  const allInsights = s.insights || [];
  const insights = allInsights.slice(0, 4);   // §21: the top items; View All for the rest
  const ctMix = a?.customerTypeMix || [];
  const vsMix = a?.visitSourceMix || [];
  const topSvc = a?.topWaitingServices || [];
  const qTrend = a?.queueTrend || [];
  const conv = a?.conversion || { percent: null, goalPercent: 70, deltaPercent: null };
  const potBy = a?.potentialRevenueByService || [];
  const chip = (txt: string, tn: { bg: string; fg: string }) => <span className="sv-chip" style={{ background: tn.bg, color: tn.fg }}>{txt}</span>;
  const avatar = (name: string, size = 20, type: 'customer' | 'technician' = 'technician', url?: string | null) => <ProfileAvatarWithPreview name={name} url={url} size={size} type={type} />;

  const selItem = itemById(selId);
  const ctxOff = !selId;   // contextual Quick Actions are off with no guest selected
  const saveCtx = () => { try { sessionStorage.setItem(CTX_KEY, JSON.stringify({ search, status, source, service: serviceFilter, selId })); } catch { /* per-viewer convenience */ } };
  const needGuest = () => { setNote(tx('ops.queue.selectGuest')); };
  const guestName = detail?.customerName || selItem?.customerName || '';
  const canStart = !!selItem && (selItem.status === 'assigned' || selItem.status === 'ready_for_tech' || selItem.status === 'in_service');
  const startSelected = () => { if (!selId) return needGuest(); if (selItem && !selItem.assignedTechnicianId && selItem.status !== 'in_service') { setNote(tx('ops.queue.needTech')); return; } void doStart(selId); };
  const assignSelected = () => { if (!selId) return needGuest(); const it = selItem; if (it && isSplit(it)) { openPlan(it); return; } setQuickGuestId(selId); setQuickAssign(true); };
  const alertSelected = () => {
    if (!selId) return needGuest();
    const name = guestName;
    void act(selId, () => posQueueApi.notifyCustomer(selId, { channel: 'app' }), 'alert', false, (r) => (r?.delivered ? tx('ops.queue.alertSent', { name }) : tx('ops.queue.alertNoApp', { name })));
  };
  const openCustomer = () => { if (!selId) return needGuest(); saveCtx(); const q = new URLSearchParams(); if (guestName) q.set('q', guestName); const cid = detail?.customerId || selItem?.customerId; if (cid) q.set('customerId', cid); nav('/customers' + (q.toString() ? '?' + q.toString() : '')); };
  const openNote = () => { if (!selId) return needGuest(); setNoteText(detail?.queueItemId === selId ? detail.notes || '' : ''); setOverlay({ kind: 'note' }); };
  const saveNote = () => { if (!selId) return; const text = noteText.trim(); void act(selId, () => posQueueApi.update(selId, { notes: text }), 'note', true, () => tx('ops.queue.noteSaved')); };
  const ensureCatalog = () => { if (svcCatalog) return; posCheckInApi.state().then((d: any) => setSvcCatalog(Array.isArray(d?.services) ? d.services : [])).catch(() => setSvcCatalog([])); };
  const openAdd = () => { ensureCatalog(); setOverlay({ kind: 'add' }); };
  const openUpsell = () => { if (!selId) return needGuest(); ensureCatalog(); setOverlay({ kind: 'upsell' }); };
  const addUpsell = (svc: SvcOpt) => {
    if (!selId) return;
    const have = (detail?.queueItemId === selId ? detail.requestedServices : selItem?.requestedServices || []).map((x) => x.serviceId).filter((x): x is string => !!x);
    if (have.includes(svc.serviceId)) { setNote(tx('ops.serving.addOnDuplicate')); return; }
    void act(selId, () => posQueueApi.updateServices(selId, { serviceIds: [...have, svc.serviceId] }), 'upsell', true, () => tx('ops.serving.addedAddOn', { name: svc.name }));
  };
  const callGuest = () => { const ph = detail?.customerPhone || selItem?.customerPhone; if (!ph) { setNote(tx('ops.queue.noPhone')); return; } window.location.href = 'tel:' + ph.replace(/[^\d+]/g, ''); };
  const openFull = async (kind: 'queue' | 'board', page = 1) => {
    setOverlay({ kind });
    if (page === 1) setFull(null);
    try {
      const d = await posQueueApi.state({ search: search || undefined, status: kind === 'board' ? 'all' : status || undefined, source: source || undefined, serviceCategory: serviceFilter || undefined, page, pageSize: 100 }) as QueueState;
      setFull((f) => ({ items: [...(page > 1 && f ? f.items : []), ...d.queue.items], page, totalPages: d.queue.pagination.totalPages, total: d.queue.pagination.totalItems }));
    } catch (e: any) { setNote(e?.message || msg('pos.failed_to_load_queue')); }
  };

  const QA: { l: string; d: string; fn: () => void; enabled: boolean }[] = [
    { l: tx('pos.new_walk_in'), d: 'M9 5a2 2 0 100-2 2 2 0 000 2zM8 8l-2 9M10 8l3 3M16 4v4M14 6h4', fn: () => { saveCtx(); nav('/booking/walk-in'); }, enabled: true },   // the canonical walk-in screen (it pointed at /checkin — no such route)
    { l: tx('pos.add_to_queue'), d: 'M10 4v12M4 10h12', fn: openAdd, enabled: true },
    { l: tx('pos.assign_tech'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0M15 4l2 2-2 2', fn: assignSelected, enabled: !ctxOff },
    { l: tx('pos.send_wait_alert'), d: 'M10 3a4 4 0 014 4c0 5 2 6 2 6H4s2-1 2-6a4 4 0 014-4zM9 17h2', fn: alertSelected, enabled: !ctxOff },
    { l: tx('pos.start_service'), d: 'M6 4l10 6-10 6z', fn: startSelected, enabled: !ctxOff && canStart },
    { l: tx('pos.view_customer'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0', fn: openCustomer, enabled: !ctxOff },
    { l: tx('pos.add_note_2'), d: 'M5 3h7l3 3v11H5zM12 3v4h4', fn: openNote, enabled: !ctxOff },
    { l: tx('pos.open_queue_report'), d: 'M4 16V8M9 16V4M14 16v-6', fn: () => { saveCtx(); nav('/reports'); }, enabled: true },
  ];

  // §16–§19: compact fixed rows (40 px), long names truncate (full text on hover / in the preview), a tap selects, Manage
  // opens the overlay. # is the guest's place in the server's order (it counted down from the page length).
  const queueTable = (rows: QueueItem[], offset: number, inOverlay = false) => (
    <table className="co-tbl cq-q" style={{ tableLayout: 'fixed' }}>
      <colgroup><col style={{ width: 50 }} /><col /><col className="cq-col-type" style={{ width: 62 }} /><col className="cq-col-req" style={{ width: '15%' }} /><col style={{ width: 54 }} /><col style={{ width: 62 }} /><col className="cq-col-st" style={{ width: 74 }} /><col style={{ width: 132 }} /></colgroup>
      <thead><tr>{['#', tx('pos.guest'), tx('pos.type'), tx('pos.req_tech'), tx('pos.wait'), tx('pos.priority'), tx('pos.status'), ''].map((hh, i) => <th key={i} className={i === 2 ? 'cq-col-type' : i === 3 ? 'cq-col-req' : i === 6 ? 'cq-col-st' : undefined}>{hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((it, i) => { const isSel = it.queueItemId === selId; const late = it.waitLevel === 'delayed'; return (
          <tr key={it.queueItemId} onClick={() => { selectItem(it.queueItemId); if (inOverlay) setOverlay(null); }} data-testid={inOverlay ? undefined : `queue-row-${it.queueItemId}`} className={`co-row${late ? ' cq-delayed' : ''}`}
            draggable={!partyMode && !inOverlay}
            onDragStart={() => setDragRow(it.queueItemId)}
            onDragEnd={() => setDragRow(null)}
            onDragOver={dragRow && dragRow !== it.queueItemId ? (e) => e.preventDefault() : undefined}
            onDrop={dragRow ? (e) => { e.preventDefault(); const from = dragRow; setDragRow(null); reorderTo(from, it.queueItemId); } : undefined}
            style={{ background: isSel ? '#FCF3E4' : 'transparent', outline: dragRow && dragRow !== it.queueItemId ? '1px dashed var(--gline, #E5D8C3)' : undefined }}>
            <td style={{ color: 'var(--muted)', fontWeight: 600 }}>{partyMode && !inOverlay ? <input type="checkbox" aria-label={tx('pos.add_customername_to_party', { customerName: String(it.customerName) })} checked={partySel.includes(it.queueItemId)} onClick={(e) => e.stopPropagation()} onChange={(e) => setPartySel(e.target.checked ? [...partySel, it.queueItemId] : partySel.filter((x) => x !== it.queueItemId))} style={{ width: 22, height: 22 }} /> : `Q-${String(offset + i + 1).padStart(3, '0')}`}</td>
            <td style={{ lineHeight: 1.2 }} title={`${it.customerName} · ${svcNames(it.requestedServices)}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(it.customerName, 15, 'customer', it.customerAvatarUrl || it.avatarUrl)}<span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.customerName}</span>{memberChip(it.customerId)}{it.lock ? <span style={{ flex: 'none' }} title={it.lock.technicianId ? tx('pos.locked_to_v0_v1', { v0: String(techNameOf(it.lock.technicianId) || tx('pos.a_technician')), v1: String(it.lock.reason ? ` — ${it.lock.reason}` : '') }) : tx('pos.locked_as_unassigned_v0', { v0: String(it.lock.reason ? ` — ${it.lock.reason}` : '') })}>{chip(tx('pos.locked_2'), { bg: '#F4E6D0', fg: '#8A5A12' })}</span> : null}{it.sharedVisit ? chip(tx('ops.queue.splitVisit'), { bg: '#EFEAFA', fg: '#553FB0' }) : null}{it.groupId ? <button type="button" title={tx('pos.open_the_party_plan')} onClick={(e) => { e.stopPropagation(); setPlanFor(null); setPartyPlanFor(it.groupId!); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flex: 'none' }}>{chip(groupLabel(it.groupId) || tx('ops.queue.party'), { bg: '#F3EEFB', fg: '#553FB0' })}</button> : null}</div>
              <div style={{ fontSize: 10, color: 'var(--soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svcNames(it.requestedServices) || '—'}<span className="cq-narrow"> · {visitType(it.source)} · {reqTech(it)}</span></div>
            </td>
            <td className="cq-col-type" style={{ color: 'var(--soft)' }}>{visitType(it.source)}</td>
            <td className="cq-col-req" style={{ color: 'var(--soft)' }}><button title={tx('pos.change_requested_technician')} style={{ background: 'none', border: 'none', color: 'var(--soft)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline dotted', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 30 }} onClick={(e) => { e.stopPropagation(); selectItem(it.queueItemId); setChangeReqId(it.queueItemId); }}>{reqTech(it)}</button></td>
            <td style={{ color: late ? '#A8321F' : 'var(--soft)', fontWeight: late ? 700 : 400 }} title={late ? tx('ops.queue.waitDelayed') : hhmm(it.checkedInAt)}>{late ? '⚠ ' : ''}{waitOf(it)} {tx('pos.min')}</td>
            <td>{it.priority === 'normal' ? <span style={{ color: 'var(--soft)' }}>{tx('pos.normal')}</span> : chip(prioLabel(it.priority), PRIO_TONE[it.priority] || PRIO_TONE.normal)}</td>
            <td className="cq-col-st">{chip(statusLabel('queueChip', chipCode(it)), STATUS_TONE[chipCode(it)] || STATUS_TONE.waiting)}</td>
            <td style={{ paddingRight: 0 }}><div className="co-actions pos-row-acts" style={{ display: 'flex', gap: 3 }}>
              <button disabled={!!busyId && busyId.startsWith(it.queueItemId)} style={ghostBtn} onClick={(e) => { e.stopPropagation(); if (inOverlay) setOverlay(null); runRowAction(it); }}>{busyId && busyId.startsWith(it.queueItemId) ? '…' : rowActionLabel(rowAction(it))}</button>
              <button style={{ ...ghostBtn, borderColor: 'var(--line)' }} onClick={(e) => { e.stopPropagation(); openManage(it); }}>{tx('pos.manage')}</button>
            </div></td>
          </tr>
        ); })}
        {rows.length === 0 ? <tr><td colSpan={8} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_customers_waiting')}</td></tr> : null}
      </tbody>
    </table>
  );
  const boardCard = (it: QueueItem) => (
    <div key={it.queueItemId} className="sd-card" data-queue-item={it.queueItemId} onClick={() => { selectItem(it.queueItemId); if (overlay?.kind === 'board') setOverlay(null); }} style={it.queueItemId === selId ? { borderColor: O, boxShadow: `0 0 0 1px ${O}` } : undefined} title={`${it.customerName} · ${svcNames(it.requestedServices)}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(it.customerName, 14, 'customer', it.customerAvatarUrl || it.avatarUrl)}<span className="nm">{it.customerName}</span>{it.waitLevel === 'delayed' ? <span style={{ marginLeft: 'auto', color: '#A8321F', fontSize: 10, fontWeight: 800, flex: 'none' }} title={tx('ops.queue.waitDelayed')}>⚠</span> : null}</div>
      <div className="sub">{svcNames(it.requestedServices) || '—'}</div>
      <div className="sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}><span>{waitOf(it)} {tx('pos.min')}</span>{it.priority !== 'normal' ? <span style={{ color: PRIO_TONE[it.priority]?.fg, fontWeight: 700 }}>{prioLabel(it.priority)}</span> : it.assignedTechnicianName ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.assignedTechnicianName.split(' ')[0]}</span> : null}</div>
    </div>
  );
  const manageIt = overlay?.kind === 'manage' ? itemById(overlay.id) : null;
  const fieldL: CSSProperties = { fontSize: 10, color: 'var(--muted)', fontWeight: 700 };

  return (
    <div className="customer-queue-page" data-testid="queue-page">
      {askUi}
      {/* §80: notes float over the board — they never push the layout */}
      {note ? <div role="status" className="co-toast"><span data-testid="queue-note" style={{ flex: 1 }}>{renderMsg(note)}</span><button aria-label={tx('pos.close')} onClick={() => setNote(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', minWidth: 32, minHeight: 32 }}>×</button></div> : null}
      {error ? <div role="alert" className="co-toast" style={{ top: 48, borderColor: '#C0392B' }}><span style={{ flex: 1 }}>{error}</span><button style={ghostBtn} onClick={refetch}>{tx('pos.retry')}</button></div> : null}

      {titleRow}

      {/* 9 KPIs (§13–§15) */}
      <div className="co-kpis" data-testid="queue-kpis">
        {kpis.map((c) => { const tr = c.noTrend ? undefined : trend(c.key); const ic = ICONS[c.ico]; return (
          <div key={c.key} className="co-card co-kpi">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: ic.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ic.fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ic.d} /></svg></span>
              <span className="co-kpi-l">{c.l}</span>
            </div>
            <div className="co-kpi-v">{c.v}</div>
            <div className="co-kpi-n">
              {tr && (tr.text || tr.deltaPercent != null) ? (() => { const down = tr.direction === 'down'; const good = c.downGood ? down : !down; return <span style={{ color: good ? '#1F7A3F' : '#A8321F', fontWeight: 700 }}>{down ? '▼' : '▲'} {tr.text || `${Math.abs(tr.deltaPercent!)}%`} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_yesterday')}</span></span>; })()
                : <span style={{ color: 'var(--muted)' }}>{c.note || ''}</span>}
            </div>
          </div>
        ); })}
      </div>

      <div className="sd-main">
        {/* Live Customer Queue — fixed panel, internal scroll, top rows + View Full Queue (§16–§19) */}
        <section className="co-card co-panel" data-testid="cq-queue">
          <div className="co-head">
            <h2 style={h2}>{tx('pos.live_customer_queue')}</h2>
            <span data-testid="cq-queue-count" style={{ background: '#FDEFE0', color: '#8C5A00', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800, flex: 'none' }}>{pg?.totalItems ?? items.length}</span>
            <span className="cq-hint" style={{ fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{tx('pos.drag_a_row_onto_another_to_ioub')}</span>
            <button style={{ ...ghostBtn, marginLeft: 'auto', flex: 'none' }} onClick={() => { setPartyMode(!partyMode); setPartySel([]); }}>{partyMode ? tx('pos.cancel_party') : tx('pos.make_a_party')}</button>
          </div>
          {partyMode ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, background: '#FBF7EF', borderRadius: 8, padding: 5, flex: 'none' }}>
              <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{partySel.length} {tx('pos.selected')}</span>
              <input aria-label={tx('pos.party_name')} value={partyLabel} onChange={(e) => setPartyLabel(e.target.value)} placeholder={tx('pos.party_name')} style={{ ...inputStyle, height: 34, fontSize: 11.5, flex: 1, minWidth: 0 }} />
              <label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={partyTogether} onChange={(e) => setPartyTogether(e.target.checked)} /> {tx('pos.serve_together')}</label>
              <button style={{ ...orangeBtn, minHeight: 34 }} disabled={busyId === (partySel[0] || '') + 'party'} onClick={createParty}>{tx('pos.create_party')}</button>
            </div>
          ) : null}
          <div className="co-scroll">{queueTable(items, ((pg?.page ?? 1) - 1) * (pg?.pageSize ?? PANEL_ROWS))}</div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4, flex: 'none' }} onClick={() => void openFull('queue')}>{tx('pos.view_full_queue')}</button>
        </section>

        {/* Queue Flow Board — canonical status columns, the server's counts, first rows + View Full Board (§20) */}
        <section className="co-card co-panel" data-testid="cq-board">
          <div className="co-head"><h2 style={h2}>{tx('pos.queue_flow_board')}</h2><button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => void openFull('board')}>{tx('pos.view_full_board')}</button></div>
          <div className="sd-board cq-board">
            {FLOW.map((st) => { const list = flowRows(st); const n = flowCount(st); return (
              <div key={st} className="sd-col" data-stage={st} style={{ background: FLOW_BG[st], outline: selItem?.status === st ? `2px solid ${O}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flex: 'none', gap: 4 }}><span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={statusLabel('queueItem', st)}>{statusLabel('queueItem', st)}</span><span data-testid={`cq-count-${st}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)' }}>{n}</span></div>
                <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{list.map(boardCard)}{n > list.length ? <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', flex: 'none' }}>+{n - list.length} {tx('pos.more')}</div> : null}</div>
              </div>
            ); })}
          </div>
        </section>

        {/* AI Queue Insights — advisory, top items + View All (§21) */}
        <section className="co-card co-panel" data-testid="cq-insights">
          <div className="co-head"><h2 style={h2}>{tx('pos.ai_queue_insights')}</h2><span style={{ background: '#EFEAFA', color: '#553FB0', borderRadius: 6, padding: '1px 7px', fontSize: 9.5, fontWeight: 800, flex: 'none' }}>{tx('pos.new')}</span>{allInsights.length > insights.length ? <button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setOverlay({ kind: 'insights' })}>{tx('pos.view_all')}</button> : null}</div>
          <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {insights.map((ins) => insightRow(ins))}
            {insights.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_insights_right_now')}</div> : null}
          </div>
        </section>

        {/* Waiting Guests by Priority — the server's rankQueue order and counts (§22) */}
        <section className="co-card co-panel" data-testid="cq-priority">
          <div className="co-head"><h2 style={h2}>{tx('pos.waiting_guests_by_priority')}</h2>{pc ? <span data-testid="cq-priority-counts" style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{tx('ops.queue.priorityCounts', { urgent: String(pc.urgent ?? 0), vip: String(pc.vip ?? 0), high: String(pc.high ?? 0), normal: String(pc.normal ?? 0) })}</span> : null}</div>
          <div className="co-scroll">
            <table className="co-tbl cq-q" style={{ tableLayout: 'fixed' }}>
              <colgroup><col /><col style={{ width: 54 }} /><col style={{ width: 64 }} /><col className="cq-col-req" style={{ width: '24%' }} /><col style={{ width: 92 }} /></colgroup>
              <thead><tr>{[tx('pos.guest'), tx('pos.wait'), tx('pos.priority'), tx('pos.best_match_3'), ''].map((hh, i) => <th key={i} className={i === 3 ? 'cq-col-req' : undefined}>{hh}</th>)}</tr></thead>
              <tbody>
                {byPriority.map((it) => (
                  <tr key={it.queueItemId} className="co-row" onClick={() => selectItem(it.queueItemId)} style={{ background: it.queueItemId === selId ? '#FCF3E4' : 'transparent' }}>
                    <td style={{ lineHeight: 1.2 }} title={`${it.customerName} · ${svcNames(it.requestedServices)} · ${reqTech(it)}`}><div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(it.customerName, 15, 'customer', it.customerAvatarUrl || it.avatarUrl)}<span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.customerName}</span>{memberChip(it.customerId)}</div><div style={{ fontSize: 10, color: 'var(--soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svcNames(it.requestedServices) || '—'} · {tx('pos.pref_tech')} {reqTech(it)}</div></td>
                    <td style={{ color: it.waitLevel === 'delayed' ? '#A8321F' : 'var(--soft)', fontWeight: it.waitLevel === 'delayed' ? 700 : 400 }}>{it.waitLevel === 'delayed' ? '⚠ ' : ''}{waitOf(it)} {tx('pos.min')}</td>
                    <td>{chip(prioLabel(it.priority), PRIO_TONE[it.priority] || PRIO_TONE.normal)}</td>
                    <td className="cq-col-req" style={{ color: 'var(--soft)' }}>{it.bestMatchMode === 'split' ? <button type="button" title={tx('pos.open_the_multi_technician_plan')} style={{ background: 'none', border: 'none', color: O, cursor: 'pointer', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline dotted', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={(e) => { e.stopPropagation(); openPlan(it); }}>{bestMatchLabel(it)}</button> : bestMatchLabel(it)}</td>
                    <td style={{ paddingRight: 0 }}><button style={ghostBtn} onClick={(e) => { e.stopPropagation(); selectItem(it.queueItemId); if (it.assignedTechnicianId) { void doSendToTech(it.queueItemId); } else if (isSplit(it)) { openPlan(it); } else { setQuickGuestId(it.queueItemId); setQuickAssign(true); } }}>{it.assignedTechnicianId ? tx('ops.queue.sendToTech') : tx('pos.assign')}</button></td>
                  </tr>
                ))}
                {byPriority.length === 0 ? <tr><td colSpan={5} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_waiting_guests')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4, flex: 'none' }} onClick={() => setOverlay({ kind: 'priority' })}>{tx('pos.view_all_waiting_guests')}</button>
        </section>

        {/* Customer Profile Preview — fixed height, operational fields only, internal scroll (§24) */}
        <section className="co-card co-panel" data-testid="cq-profile">
          <div className="co-head"><h2 style={h2}>{tx('pos.customer_profile_preview')}</h2>{selItem ? <span style={{ marginLeft: 'auto', flex: 'none' }}>{chip(statusLabel('queueChip', chipCode(selItem)), STATUS_TONE[chipCode(selItem)] || STATUS_TONE.waiting)}</span> : null}</div>
          {!detail ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{tx('pos.select_a_guest_to_preview_their_1f6b')}</div> : (
            <>
              <div className="co-scroll">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {avatar(detail.customerName, 34, 'customer', detail.customerAvatarUrl || detail.avatarUrl)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail.customerName}>{detail.customerName}</span>{detail.isVip ? chip(prioLabel('vip'), { bg: '#EFEAFA', fg: '#553FB0' }) : null}{memberChip(detail.customerId)}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail.customerPhone || '—'}{detail.email ? ` · ${detail.email}` : ''}</div>
                  </div>
                  {selItem ? <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.wait')}</div><div style={{ font: '700 16px/1.1 "Playfair Display",serif', color: selItem.waitLevel === 'delayed' ? '#A8321F' : O }}>{waitOf(selItem)} {tx('pos.min')}</div></div> : null}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 5, marginBottom: 6 }}>
                  {[{ l: tx('pos.loyalty_points'), v: detail.loyaltyPoints != null ? tx('pos.v0_pts_2', { v0: fmtNumber(detail.loyaltyPoints) }) : '—' }, { l: tx('pos.visit_count'), v: detail.visitCount != null ? String(detail.visitCount) : '—' }, { l: tx('pos.total_spend'), v: detail.totalSpendCents != null ? m0(detail.totalSpendCents) : '—' }].map((b) => (
                    <div key={b.l} style={{ background: 'var(--page)', borderRadius: 8, padding: '4px 6px', textAlign: 'center', minWidth: 0 }}><div style={{ fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.l}</div><div style={{ fontWeight: 800, fontSize: 12.5, color: O }}>{b.v}</div></div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 6, fontSize: 11, marginBottom: 4 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.service_3')}{': '}</span><b>{svcNames((detail.requestedServices || []) as QueueItem['requestedServices']) || '—'}</b></div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.preferred_tech_2')}{' '}</span><b>{detail.preferredTechName || selItem?.requestedTechnicianName || '—'}</b></div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.birthday_2')}{' '}</span><b>{detail.birthday || '—'}</b></div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.best_match_3')}{': '}</span><b>{selItem ? bestMatchLabel(selItem) : '—'}</b></div>
                </div>
                {detail.notes ? <div style={{ fontSize: 11, marginBottom: 3 }}><span style={{ color: 'var(--muted)' }}>{tx('pos.notes_2')}{' '}</span>{detail.notes}</div> : null}
                {detail.allergies ? <div style={{ fontSize: 11, color: '#A8321F' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.allergies_preferences')}{' '}</span>{detail.allergies}</div> : null}
              </div>
              <div className="co-actions" style={{ display: 'flex', gap: 5, marginTop: 6, flex: 'none' }}>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={() => selId && doNotify(selId)}>{tx('pos.text')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={callGuest}>{tx('pos.call_2')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={openNote}>{tx('pos.add_note_2')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={openUpsell}>{tx('pos.add_upsell')}</button>
                <button style={{ ...orangeBtn, flex: 1.1 }} onClick={() => { const it = selItem; if (it) openManage(it); else needGuest(); }}>{tx('pos.move_queue')}</button>
              </div>
            </>
          )}
        </section>

        {/* Available Technicians for Queue — the server's on-duty projection from real signals, capped + summary (§25–§29) */}
        <section className="co-card co-panel" data-testid="cq-staff">
          <div className="co-head"><h2 style={h2}>{tx('pos.available_technicians_for_queue')}</h2></div>
          {sum ? <div data-testid="cq-staff-summary" style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tx('ops.serving.staffSummary', { available: String(sum.available), finishing: String(sum.finishing), busy: String(sum.busy), onBreak: String(sum.onBreak), onDuty: String(sum.onDuty) })}>{tx('ops.serving.staffSummary', { available: String(sum.available), finishing: String(sum.finishing), busy: String(sum.busy), onBreak: String(sum.onBreak), onDuty: String(sum.onDuty) })}</div> : null}
          <div className="co-scroll">
            <table className="co-tbl" style={{ tableLayout: 'fixed' }}>
              <colgroup><col /><col style={{ width: 36 }} /><col style={{ width: 64 }} /><col style={{ width: 86 }} /></colgroup>
              <thead><tr>{[tx('pos.technician'), tx('pos.load'), tx('pos.next'), tx('pos.status')].map((hh, i) => <th key={hh} style={{ textAlign: i === 1 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
              <tbody>
                {staff.map((st, i) => (
                  <tr key={st.technicianId || i}>
                    <td title={`${st.name}${st.specialty ? ' · ' + st.specialty : ''}`} style={{ lineHeight: 1.15 }}><div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(st.name, 15, 'technician', st.avatarUrl)}<span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</span></div>{st.specialty ? <div style={{ fontSize: 9.5, color: 'var(--soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.specialty}</div> : null}</td>
                    <td style={{ color: 'var(--soft)', textAlign: 'right' }}>{st.currentLoad != null ? st.currentLoad : '—'}</td>
                    <td style={{ color: 'var(--soft)' }}>{st.nextAvailable ? staffWord(st.nextAvailable) : (st.technicianId && avail[st.technicianId] ? (avail[st.technicianId].onBreak ? tx('pos.on_break') : avail[st.technicianId].availableInMinutes ? tx('pos.in_availableinminutes_min', { availableInMinutes: String(avail[st.technicianId].availableInMinutes) }) : tx('pos.now')) : '—')}</td>
                    <td>{chip(staffWord(st.status), STAFF_TONE[st.status] || { bg: '#F1ECE2', fg: '#6E5E48' })}</td>
                  </tr>
                ))}
                {staff.length === 0 ? <tr><td colSpan={4} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)', whiteSpace: 'normal' }}>{tx('pos.availability_syncs_from_the_team_status_1j38')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4, flex: 'none' }} onClick={() => { saveCtx(); nav('/tenant/team/members'); }}>{tx('pos.view_full_tech_board')}</button>
        </section>
      </div>

      {/* Analytics row — six compact cards; detail lives in Reports (§37–§42) */}
      <div className="co-ana">
        <section className="co-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}><h2 style={h2}>{tx('pos.queue_trend_today')}</h2><span style={{ fontSize: 11, fontWeight: 700, flex: 'none' }}>{k.waitingGuests}</span></div>
          {(() => { const pts = qTrend; if (!pts.length) return <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_data_yet')}</div>; const w = 220, h = 70, max = Math.max(1, ...pts.map((p) => p.count)); const xs = (i: number) => pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w; const ys = (v: number) => h - (v / max) * (h - 10) - 4; const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.count).toFixed(1)}`).join(' '); return (
            <svg className="co-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ marginTop: 4 }}>
              {[0.33, 0.66].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
              <path d={dd} fill="none" stroke={O} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          ); })()}
        </section>
        <section className="co-card"><h2 style={h2}>{tx('pos.customer_type_mix')}</h2><Donut items={ctMix.map((m) => ({ label: mixLabel(m.label), count: m.count }))} /></section>
        <section className="co-card"><h2 style={h2}>{tx('pos.visit_source_mix')}</h2><Donut items={vsMix.map((m) => ({ label: mixLabel(m.label), count: m.count }))} /></section>
        <section className="co-card">
          <h2 style={{ ...h2, marginBottom: 3 }}>{tx('pos.top_waiting_services')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {topSvc.slice(0, 4).map((b) => (
              <div key={b.service}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, fontSize: 10 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.service}>{b.service}</span><span style={{ color: 'var(--muted)', flex: 'none' }}>{b.count} ({b.sharePercent}%)</span></div>
                <div style={{ height: 4, background: 'var(--page)', borderRadius: 4 }}><div style={{ width: `${b.sharePercent}%`, height: '100%', background: '#7B9FD4', borderRadius: 4 }} /></div>
              </div>
            ))}
            {topSvc.length === 0 ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.no_data_yet')}</div> : null}
          </div>
        </section>
        <section className="co-card">
          <h2 style={h2}>{tx('pos.queue_conversion')}</h2>
          {(() => { const pct = conv.percent; const shown = pct != null ? pct : 0; const ang = Math.PI * (1 - shown / 100); const cx = 60, cy = 58, r = 46; const x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang); return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <svg viewBox="0 0 120 64" style={{ width: '52%', height: 'var(--co-chart)', flex: 'none' }}>
                <path d={`M14 ${cy} A ${r} ${r} 0 0 1 106 ${cy}`} fill="none" stroke="var(--line)" strokeWidth="10" strokeLinecap="round" />
                {pct != null ? <path d={`M14 ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={O} strokeWidth="10" strokeLinecap="round" /> : null}
              </svg>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '700 17px/1 "Playfair Display",serif', color: 'var(--text)' }}>{pct != null ? `${pct}%` : '—'}</div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx('pos.waiting_to_service')}</div>
                {conv.deltaPercent != null ? <div style={{ fontSize: 9.5, color: conv.deltaPercent >= 0 ? '#1F7A3F' : '#A8321F', fontWeight: 700 }}>{conv.deltaPercent >= 0 ? '▲' : '▼'} {Math.abs(conv.deltaPercent)}{tx('pos.vs_yesterday_2')}</div> : null}
                <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{tx('pos.goal_2')}{' '}{conv.goalPercent}%</div>
              </div>
            </div>
          ); })()}
        </section>
        <section className="co-card">
          {/* §42: projected value of the guests waiting — approved overrides, cancelled visits excluded — NOT earned revenue */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}><h2 style={h2}>{tx('pos.potential_revenue_by_queue')}</h2><b style={{ font: '700 15px/1 "Playfair Display",serif', color: '#1F7A3F', flex: 'none' }}>{m0(a?.potentialRevenueTotalCents)}</b></div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', marginBottom: 2 }}>{tx('ops.queue.projected')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 10.5 }}>
            {potBy.slice(0, 3).map((p) => <div key={p.service} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}><span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.service}>{p.service}</span><b style={{ flex: 'none' }}>{m0(p.revenueCents)}</b></div>)}
            {potBy.length === 0 ? <div style={{ color: 'var(--muted)' }}>{tx('pos.no_data_yet')}</div> : null}
          </div>
        </section>
      </div>

      {/* Quick Actions — always visible; contextual ones are off with no guest selected (§50–§57) */}
      <div className="co-qa" data-testid="queue-quick-actions">
        {QA.map((q) => (
          <button key={q.l} type="button" onClick={q.enabled ? q.fn : () => (ctxOff ? needGuest() : q.fn())} aria-disabled={!q.enabled} className="dqa co-card" style={q.enabled ? undefined : off}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={q.d} /></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{q.l}</span>
          </button>
        ))}
      </div>

      {/* ---- overlays: the page never grows (§19) ---- */}
      {planFor ? <Floating><VisitPlanPanel key={planFor.queueItemId} queueItemId={planFor.queueItemId} customerName={planFor.customerName} roster={roster} pickFromServer can={can} onChanged={() => { void refetch(); if (selId) void loadDetail(selId); }} onClose={() => setPlanFor(null)} /></Floating> : null}
      {partyPlanFor ? <Floating><PartyPlanPanel key={partyPlanFor} groupId={partyPlanFor} label={groupLabel(partyPlanFor) || tx('ops.queue.party')} group={groups.find((g) => g.groupId === partyPlanFor) || null} roster={roster} can={can} onChanged={() => { void refetch(); }} onClose={() => setPartyPlanFor(null)} /></Floating> : null}

      {overlay?.kind === 'manage' && manageIt ? (() => { const it = manageIt; return (
        <OverlayBox onClose={closeOverlay} title={`${tx('pos.manage')} · ${it.customerName}`} sub={`${statusLabel('queueItem', it.status)} · ${waitOf(it)} ${tx('pos.min')}`} testId="cq-manage">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={fieldL}>{tx('pos.assign_reassign_technician')}</span>
              <TechnicianPickerButton value={techSel} valueName={techSel ? techNameOf(techSel) ?? undefined : undefined} emptyLabel={tx('pos.select_technician')} ariaLabel={tx('pos.assign_reassign_technician')} workingOnlyDefault
                onChange={(id, t) => { learnName(id, t?.name); setTechSel(id); }} style={{ height: 40, fontSize: 12, minWidth: 0, maxWidth: '100%' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={fieldL}>{tx('pos.priority')}</span>
              <select value={prioSel} onChange={(e) => setPrioSel(e.target.value)} style={{ ...inputStyle, height: 40 }}><option value="">{tx('pos.keep_current')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{prioLabel(p)}</option>)}</select>
            </label>
            <div className="co-actions" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button disabled={busyId === it.queueItemId + 'assign'} style={orangeBtn} onClick={() => doAssign(it.queueItemId)}>{tx('pos.assign')}</button>
              {/* Only offered when somebody IS assigned — an undo for an action that had none. */}
              {it.assignedTechnicianName ? <button disabled={busyId === it.queueItemId + 'unassign'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => doUnassign(it.queueItemId)}>{tx('pos.unassign')}</button> : null}
              {it.assignedTechnicianId && can('turn_queue.assign') ? <button disabled={busyId === it.queueItemId + 'gdecl'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => doGuestDeclined(it.queueItemId, it.assignedTechnicianId!)}>{tx('pos.guest_declined_tech')}</button> : null}
              <button disabled={busyId === it.queueItemId + 'prio'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => doPriority(it.queueItemId)}>{tx('pos.priority')}</button>
            </div>
            {overrideFor === it.queueItemId ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, gridColumn: '1 / -1' }}><span style={fieldL}>{tx('pos.override_reason_not_the_recommended_technician')}</span>
                <select aria-label={tx('pos.override_reason_2')} value={overrideCode} onChange={(e) => setOverrideCode(e.target.value)} style={{ ...inputStyle, height: 40 }}><option value="">{tx('pos.choose_a_reason')}</option>{TURN_OVERRIDE_REASONS.map((r) => <option key={r} value={r}>{statusLabel('turnReason', r)}</option>)}</select>
              </label>
            ) : null}
            {prioSel && prioSel !== 'normal' && prioSel !== it.priority ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, gridColumn: '1 / -1' }}><span style={fieldL}>{tx('ops.queue.priorityReason')}</span>
                <input aria-label={tx('ops.queue.priorityReason')} value={prioReason} onChange={(e) => setPrioReason(e.target.value)} maxLength={300} style={inputStyle} />
              </label>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}><span style={fieldL}>{tx('pos.cancel_reason_2')}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.reason_required_to_cancel')} style={inputStyle} />
            </label>
            <button disabled={busyId === it.queueItemId + 'cancel'} style={{ ...ghostBtn, minHeight: 40, borderColor: '#C0392B', color: '#C0392B' }} onClick={() => doCancel(it.queueItemId)}>{tx('pos.cancel_from_queue')}</button>
          </div>
          {/* BUILD_PLAN Phase 6 — line order (touch path for drag), lock, per-service technicians, history, iPad view */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={fieldL}>{tx('pos.line')}</span>
            <button disabled={busyId === it.queueItemId + 'reorder'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => moveBy(it.queueItemId, -1)}>{tx('pos.move_up')}</button>
            <button disabled={busyId === it.queueItemId + 'reorder'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => moveBy(it.queueItemId, 1)}>{tx('pos.move_down')}</button>
            <button style={{ ...ghostBtn, minHeight: 40 }} onClick={() => toggleHistory(it.queueItemId)}>{historyFor === it.queueItemId ? tx('pos.hide_history') : tx('pos.history')}</button>
            <button style={{ ...ghostBtn, minHeight: 40, borderColor: 'var(--line)' }} title={tx('pos.open_full_ipad_view')} onClick={() => { setOverlay(null); openIPad(queueItemRequest(it as any, refetch)); }}>{tx('pos.full_view')}</button>
          </div>
          {can('ai_queue_assignment.override') ? (
            it.lock ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 11.5 }}>{tx('pos.locked_2')}{' '}{it.lock.technicianId ? tx('pos.to_v0_2', { v0: String(techNameOf(it.lock.technicianId) || tx('pos.a_technician')) }) : tx('pos.as_unassigned')}{it.lock.reason ? ` — ${it.lock.reason}` : ''}</span>
                <button disabled={busyId === it.queueItemId + 'unlock'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => doUnlock(it.queueItemId)}>{tx('pos.unlock')}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={fieldL}>{tx('pos.lock_to')}</span>
                  <TechnicianPickerButton value={lockTech === '__nobody__' ? '' : lockTech} valueName={lockTech !== '__nobody__' ? techNameOf(lockTech) ?? undefined : undefined}
                    emptyLabel={tx('pos.nobody_keep_unassigned')} anyLabel={tx('pos.nobody_keep_unassigned')} ariaLabel={tx('pos.lock_to')}
                    onChange={(id, t) => { learnName(id, t?.name); setLockTech(id || '__nobody__'); }} style={{ height: 40, fontSize: 12 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}><span style={fieldL}>{tx('pos.lock_reason')}</span>
                  <input aria-label={tx('pos.lock_reason')} value={lockReason} onChange={(e) => setLockReason(e.target.value)} style={inputStyle} />
                </label>
                <button disabled={busyId === it.queueItemId + 'lock'} style={{ ...ghostBtn, minHeight: 40 }} onClick={() => doLock(it.queueItemId)}>{tx('pos.lock')}</button>
              </div>
            )
          ) : null}
          {servicesOf(it.queueItemId).length > 1 || isSplit(it) ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={fieldL}>{tx('pos.technician_per_service')}</span>
              <button style={{ ...ghostBtn, minHeight: 40 }} onClick={() => openPlan(it)}>{tx('pos.plan_technicians_per_service')}</button>
            </div>
          ) : null}
          {historyFor === it.queueItemId ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 3 }} aria-label={tx('pos.guest_history')}>
              {history == null ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.loading_history')}</span>
                : history.length === 0 ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.no_history_yet')}</span>
                  : history.map((h, hi) => (
                    <div key={`${h.version}-${hi}`} style={{ fontSize: 11 }}>
                      <span style={{ color: 'var(--muted)' }}>{hhmm(h.createdAt)} · </span>
                      {h.fromStatus !== h.toStatus ? `${statusLabel('queueItem', h.fromStatus || 'new')} → ${statusLabel('queueItem', h.toStatus)}` : statusLabel('queueAction', h.action)}
                      {h.toTechnicianId ? ` · ${techNameOf(h.toTechnicianId) || tx('pos.a_technician')}` : h.fromTechnicianId ? tx('pos.unassigned_3') : ''}
                      {h.source ? <span style={{ color: 'var(--muted)' }}> · {statusLabel('source', h.source)}</span> : null}
                      {h.reason ? <span style={{ color: 'var(--muted)' }}> · {h.reason}</span> : null}
                    </div>
                  ))}
            </div>
          ) : null}
        </OverlayBox>
      ); })() : null}

      {overlay?.kind === 'queue' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.queue.fullQueueTitle')} sub={full ? String(full.total) : undefined} wide testId="cq-full-queue">
          {full == null ? <div style={{ padding: 16, color: 'var(--muted)' }}>{tx('pos.loading_queue')}</div> : <>{queueTable(full.items, 0, true)}{full.page < full.totalPages ? <button style={{ ...ghostBtn, minHeight: 44, marginTop: 8 }} onClick={() => void openFull('queue', full.page + 1)}>{tx('pos.load_more')}</button> : null}</>}
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'board' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.queue.fullBoardTitle')} sub={full ? String(full.total) : undefined} wide testId="cq-full-board">
          {full == null ? <div style={{ padding: 16, color: 'var(--muted)' }}>{tx('pos.loading_queue')}</div> : (
            <div className="sd-board cq-board" style={{ minHeight: 360 }}>
              {FLOW.map((st) => { const list = full.items.filter((x) => x.status === st); return (
                <div key={st} className="sd-col" style={{ background: FLOW_BG[st] }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, fontWeight: 800 }}><span>{statusLabel('queueItem', st)}</span><span style={{ color: 'var(--muted)' }}>{list.length}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{list.map(boardCard)}</div>
                </div>
              ); })}
            </div>
          )}
          {full && full.page < full.totalPages ? <button style={{ ...ghostBtn, minHeight: 44, marginTop: 8 }} onClick={() => void openFull('board', full.page + 1)}>{tx('pos.load_more')}</button> : null}
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'priority' ? (
        <OverlayBox onClose={closeOverlay} title={tx('pos.waiting_guests_by_priority')} sub={pc ? tx('ops.queue.priorityCounts', { urgent: String(pc.urgent ?? 0), vip: String(pc.vip ?? 0), high: String(pc.high ?? 0), normal: String(pc.normal ?? 0) }) : undefined} wide>
          {queueTable(byPriority, 0, true)}
          <button style={{ ...ghostBtn, minHeight: 44, marginTop: 8 }} onClick={() => void openFull('queue')}>{tx('pos.view_full_queue')}</button>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'insights' ? <OverlayBox onClose={closeOverlay} title={tx('pos.ai_queue_insights')}><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{allInsights.map((ins) => insightRow(ins))}</div></OverlayBox> : null}
      {overlay?.kind === 'balance' && abPreview ? (
        <OverlayBox onClose={closeOverlay} title={`${tx('pos.auto_balance_preview')} ${abPreview.summary?.proposed ?? abPreview.proposals.length} ${tx('pos.proposed_assignment')}${enPlural((abPreview.summary?.proposed ?? abPreview.proposals.length) === 1 ? '' : 's')}`} sub={tx('pos.review_before_applying_nothing_is_moved_il39')} wide testId="cq-balance">
          <table className="co-tbl">
            <thead><tr>{[tx('pos.guest'), tx('pos.proposed_technician'), tx('pos.why'), tx('pos.waiting_2')].map((hh) => <th key={hh}>{hh}</th>)}</tr></thead>
            <tbody>
              {abPreview.proposals.map((p: any) => (
                <tr key={p.queueItemId}>
                  <td style={{ fontWeight: 600 }}>{p.customerName || itemById(p.queueItemId)?.customerName || tx('pos.guest')}</td>
                  <td>{p.technicianName}{typeof p.confidence === 'number' ? <span style={{ color: 'var(--muted)' }}> · {Math.round(p.confidence * 100)}%</span> : null}</td>
                  <td style={{ color: 'var(--soft)', whiteSpace: 'normal' }}>{p.reason || (Array.isArray(p.reasons) && p.reasons.length ? p.reasons.join(' · ') : '—')}</td>
                  <td style={{ color: 'var(--soft)' }}>{p.addressesWaitMinutes != null ? tx('pos.addresseswaitminutes_min', { addressesWaitMinutes: String(p.addressesWaitMinutes) }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {abPreview.unassignable?.length ? <div style={{ fontSize: 11, color: '#8C5A00', marginTop: 6 }}>{tx('ops.techQueue.unassignableLeft', { count: String(abPreview.unassignable.length) })}</div> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button disabled={abBusy} onClick={applyAutoBalance} style={{ ...orangeBtn, minHeight: 44 }}>{abBusy ? tx('pos.applying') : tx('pos.apply_v0', { v0: String(abPreview.summary?.proposed ?? abPreview.proposals.length) })}</button>
            <button disabled={abBusy} onClick={() => { setAbPreview(null); setOverlay(null); }} style={{ ...ghostBtn, minHeight: 44, borderColor: 'var(--line)' }}>{tx('pos.cancel')}</button>
          </div>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'add' ? (
        <OverlayBox onClose={closeOverlay} title={tx('pos.add_to_queue')} sub={tx('ops.queue.addSub')} testId="cq-add">
          {svcCatalog == null ? <div style={{ padding: 16, color: 'var(--muted)' }}>{tx('pos.loading_queue')}</div>
            : <QuickCheckInPanel services={svcCatalog} onComplete={() => { setOverlay(null); void refetch(); }} />}
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'note' && selId ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.queue.noteTitle', { name: guestName })} testId="cq-note">
          <textarea aria-label={tx('pos.note_for_this_guest')} placeholder={tx('pos.add_a_note_for_this_guest')} value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={2000} rows={5} style={{ ...inputStyle, height: 'auto', width: '100%', padding: 10, boxSizing: 'border-box', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button style={{ ...orangeBtn, minHeight: 44 }} disabled={busyId === selId + 'note'} onClick={saveNote}>{tx('pos.save_note')}</button></div>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'upsell' && selId ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.queue.upsellTitle', { name: guestName })} sub={tx('ops.queue.upsellSub')} testId="cq-upsell">
          {svcCatalog == null ? <div style={{ padding: 16, color: 'var(--muted)' }}>{tx('pos.loading_queue')}</div> : (() => { const addOns = svcCatalog.filter((x) => x.isAddon); return addOns.length === 0 ? <div style={{ padding: 12, color: 'var(--muted)' }}>{tx('ops.serving.noAddOns')}</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>
              {addOns.map((x) => <button key={x.serviceId} disabled={busyId === selId + 'upsell'} onClick={() => addUpsell(x)} style={{ ...ghostBtn, minHeight: 48, justifyContent: 'space-between', display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--line)', color: 'var(--text)' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span><b style={{ color: O }}>{x.priceCents != null ? fmtMoney(x.priceCents) : ''}</b></button>)}
            </div>
          ); })()}
        </OverlayBox>
      ) : null}

      {quickAssign ? (() => {
        const guests: AssignGuest[] = items.map((it) => ({ id: it.queueItemId, name: it.customerName, meta: svcNames(it.requestedServices), isVip: it.isVip }));
        const extra = itemById(quickGuestId); if (extra && !guests.some((g) => g.id === extra.queueItemId)) guests.unshift({ id: extra.queueItemId, name: extra.customerName, meta: svcNames(extra.requestedServices), isVip: extra.isVip });
        const gid = quickGuestId || guests[0]?.id || '';
        return (
          <AssignTechSheet open={quickAssign} title={tx('pos.add_to_queue_assign')} guests={guests} selectedGuestId={gid} onSelectGuest={setQuickGuestId} roster={roster} paged onClose={() => setQuickAssign(false)}
            onAssign={async (tid) => { setQuickAssign(false); if (gid && tid) await act(gid, () => posQueueApi.assignTechnician(gid, { technicianId: tid, ...expectedFor(gid) }), 'assign'); }} />
        );
      })() : null}
      {changeReqId ? (() => {
        const it = itemById(changeReqId);
        return (
          <AssignTechSheet open={!!changeReqId} title={tx('pos.change_requested_technician_2')} context={it ? `${it.customerName} · ${svcNames(it.requestedServices)}` : undefined} allowUnassign confirmLabel={tx('pos.set_requested')} currentTechName={it?.requestedTechnicianName || tx('pos.any_available')} roster={roster} paged onClose={() => setChangeReqId(null)}
            onAssign={async (tid) => { const qid = changeReqId; setChangeReqId(null); if (qid) await act(qid, () => posQueueApi.changeRequestedTechnician(qid, { technicianId: tid }), 'reqtech'); }} />
        );
      })() : null}
    </div>
  );

  function insightRow(ins: QInsight) {
    const it = insightText(ins); const hot = ins.severity === 'warn' || ins.severity === 'danger';
    return (
      <div key={ins.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: hot ? '#FBEAE8' : '#FDEFE0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={hot ? '#A8321F' : O} strokeWidth="1.7"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg></span>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.25 }}>{it.text}</div>{it.sub ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{it.sub}</div> : null}</div>
        {ins.action ? <button style={ghostBtn} disabled={abBusy && ins.action === 'Auto Balance Queue'} onClick={() => { setOverlay(null); insightAct(ins); }}>{insightAction(ins.action)}</button> : null}
      </div>
    );
  }
}
