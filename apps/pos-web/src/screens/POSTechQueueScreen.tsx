import React, { useCallback, useEffect, useState } from 'react';
import { FaExpand } from 'react-icons/fa';
import { useRealtime } from '../realtime/useRealtime';
import { useNavigate } from 'react-router-dom';
import { posTechQueueApi } from '../api/posTechQueueApi';
import { useIPadView } from '../components/IPadViewProvider';
import { queueItemRequest } from '../components/ipad-modules';
import { posQueueApi } from '../api/posQueueApi';
import { dropEligibility } from './techQueueDnd';
import { posLiveTechnicianScheduleApi } from '../api/posLiveTechnicianScheduleApi';
import { isQueueConflict, queueConflictMessage } from '../lib/queueConflict';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import type { TechQueueSharedPart } from '@aipowersalon/api-contracts/tenant';
import { TURN_DECLINE_REASONS } from '@aipowersalon/api-contracts/tenant';
import { VisitPlanPanel } from '../components/VisitPlanPanel';
import { useCan } from '../components/usePermissions';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { pageTechQueueLanes, TECH_QUEUE_LANE_STATUS_GROUPS, type TechQueueLanePage } from '@aipowersalon/api-contracts/tenant';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { statusLabel } from '../i18n/status-label';
import { fmtMoney, fmtMonthDay } from '../i18n/format';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { posTechQueueScreenApi } from '../api/posTeamScreensApi';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, type PeriodState } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { pageOf, whenTime } from './technicianScreenParts';
import { hm12 } from './teamShared';

// Oct 30 2026 rebuild (Tech Queue guide): one vertical scroll on the Front Desk at 100% zoom, every original module kept
// (8 KPIs · A Live Technician Queue · B Workload Board · C AI Assignment Insights · Assigned Tickets · D1–D3 · E1–E4 · the
// seven Quick Actions) plus the mandatory additions: a LIVE QUEUE | HISTORY switch (history newest first, live in fair
// operational order — first assigned / first checked in, never newest-first), Assigned Tickets tabs (live, waiting,
// accepted, in service, delayed, service done today, checkout pending) with server paging and search, one scoped search
// (technician · live ticket · history), Technician Assignment Details (Close / Esc) with the actions her state allows, and
// a ticket timeline. The extra reads come from /pos/tech-queue-screen/*; every action is still the existing endpoint.
//
// POS Tech Queue — per-technician swimlanes from /pos/tech-queue/state. Quick actions: Accept, Move to Serving
// (idempotent), Notify Technician (honest {configured:false}). Per-ticket "Manage" drawer wires the supervisory,
// body-carrying actions with their exact shapes (tech-queue.service): Reassign ({technicianId, reason} — both
// required; picker from the lanes), Update Priority ({priority}), Report Delay ({reason, extraMinutes?}), Clear Delay
// ({note}), Decline ({reason}), Cancel ({reason}). A single reason/note field feeds the reason-bearing actions.
//
// BUILD_PLAN Phase 6 (audit bug 10): a drag-drop / tap / "Assign" to best match now sends the technician this board
// showed for the guest (`expectedTechnicianId`, + the queue version when known), so a guest another device assigned
// first is refused with 409 and the note says who has them — instead of being silently moved. "Best Match" and Auto
// Balance come from the AI engine (the queue routes delegate; the tech-queue's own scorer is gone). "Send Break" is
// real: it starts the technician's break through the live-schedule break API (it used to say "not connected yet").
//
// Multi-technician routing (contract §7): a shared (split) visit is one ticket PER technician part — a part row says
// "Part n of m · with <tech> (<services>)". A waiting guest whose best match is a split plan is never dropped onto one
// technician: drag / tap / Assign open the VisitPlanPanel so the whole plan is assigned at once.
type Svc = { serviceId?: string; serviceName?: string; name?: string };
type TQRow = {
  techQueueTicketId: string; customerName: string; isVip?: boolean; requestedServices: Svc[]; serviceCount: number; source?: string;
  priority: string; status: string; assignedTechnicianName: string; station?: string; assignedWaitMinutes?: number; quotedWaitMinutes?: number; delayStatus?: string;
  visitPart?: number | null; sharedWith?: TechQueueSharedPart[];
};
type Lane = { technicianId: string; technicianName: string; workingStatus: string; activeTicketCount: number; acceptedTicketCount: number; delayedTicketCount: number; estimatedWorkloadMinutes: number; tickets: TQRow[] };
type TechPerf = { technicianId: string; technicianName: string; services: number; revenueCents: number; tipCents: number; ratingAvg: number | null };
type TechRow = { rotationPosition: number; technicianId: string; technicianName: string; specialties: string[]; status: string; nextAppointmentInMinutes?: number | null; holdReason?: string | null; guests: number; currentServiceName?: string; currentServiceCustomer?: string; nextAvailableLabel: string; nextAvailable?: string; utilizationPercent: number | null; tipsTodayCents: number; revenueTodayCents: number };
type WaitGuest = { queueItemId?: string; customerName: string; serviceName: string; preferredTechName?: string; priority: string; waitMinutes: number; bestMatchTechnicianName?: string; bestMatchTechnicianId?: string; assignedTechnicianId?: string | null; version?: number; bestMatchMode?: 'single' | 'split'; bestMatchTechnicianNames?: string[] };
type AvailRow = { technicianId: string; technicianName: string; status: string; nextAvailableLabel: string; nextAvailable?: string; specialties: string[] };
type MixCol = { technicianId: string; technicianName: string; cells: { category: string; percent: number; count: number; revenueCents: number }[] };
type TQAnalytics = { utilizationTrend: { hour: number; utilizationPercent: number }[]; serviceMixByTechnician: MixCol[]; serviceCategories: string[]; assignmentSource: { source: string; code?: string; count: number; percent: number }[]; assignmentSourceTotal: number; topRevenueTechs: { technicianId: string; technicianName: string; revenueCents: number }[]; throughput?: TQThroughputView };
/** TECH QUEUE extras #11: the server's throughput for the salon day — every rate with its numerator / denominator; null rate = no data */
type TQThroughputView = { businessDate: string; timeZone: string; checkedInGuests: number; completedServices: number; servedRatePercent: number | null; serviceMinutes: number; timedServices: number; avgTurnMinutes: number | null };
type TQInsight = { id: string; text: string; sub?: string; action?: string; route?: string; severity?: 'info' | 'warn' | 'danger'; vars?: Record<string, string | number> };
type WorkloadCol = { count: number; items: TechRow[] };
type TQState = {
  kpis: { assignedTickets: number; waitingForAcceptance: number; acceptedTickets: number; readyToStart: number; delayedTickets: number; activeTechnicians: number; availableTechnicians: number; averageAssignedWaitMinutes: number; laborRevenueTodayCents: number; utilizationTodayPercent: number; upsellCapturePercent: number; scheduledTechnicians: number; servicesInProgress: number; waitingForAssignment: number; avgTurnTimeMinutes: number };
  kpiTrends?: Record<string, { deltaPercent: number | null; direction?: 'up' | 'down'; text?: string }>;
  technicianRows?: TechRow[];
  waitingGuests?: WaitGuest[];
  availableTechnicians?: AvailRow[];
  analytics?: TQAnalytics;
  insights?: TQInsight[];
  technicianLanes: Lane[];
  tickets: { items: TQRow[]; pagination: { totalItems: number } };
  techPerformanceToday?: (TechPerf & { utilizationPercent?: number | null })[];
  /** 200-technician §2: the server-paged lanes (technicianRows / technicianLanes are this page only) */
  lanes?: TechQueueLanePage;
  workload?: { available: WorkloadCol; inProgress: WorkloadCol; finishing: WorkloadCol; breakOffline: WorkloadCol };
  availableTechniciansTotal?: number;
  filters?: { statuses?: string[]; technicians?: string[]; serviceCategories?: string[]; sources?: string[]; priorityLevels?: string[]; stations?: string[] };
};
const PRIORITIES = ['normal', 'high', 'vip', 'urgent'];
/** 200-technician mandate §33: the Live Technician Queue table pages (it showed the first 6 of however many there were). */
export const TQ_LANE_PAGE_SIZE = 10;
/** §33 status groups over the lane statuses the server reports (Hold = the Fair Turn ledger's HOLD; Appointment Soon =
 *  ready, next appointment within the Fair Turn board's window). One definition, shared with the server's lane pager. */
export const TQ_STATUS_GROUPS: Record<string, string[]> = TECH_QUEUE_LANE_STATUS_GROUPS;
/** Pure (exported for tests): search by name / specialty (accent-insensitive) / "#rotation", filter by status group, then
 *  one page — the server's rule (pageTechQueueLanes), used here only when an older server sends every lane. */
export function filterTechRows<T extends { technicianName: string; specialties: string[]; status: string; rotationPosition: number }>(rows: T[], q: string, group: string, page: number, pageSize = TQ_LANE_PAGE_SIZE): { items: T[]; total: number; page: number; totalPages: number } {
  return pageTechQueueLanes(rows, q, group, page, pageSize);
}

const svcNames = (r: Svc[]) => r.map((x) => x.serviceName || x.name || '').filter(Boolean).join(', ');
/** "Part 1 of 2 · with Leo Chen (Manicure, Nail Art)" — a technician's part of a shared visit */
const partLabel = (t: { visitPart?: number | null; sharedWith?: TechQueueSharedPart[] }): string | null => {
  if (!t.sharedWith?.length) return null;
  const of = t.sharedWith.length + 1;
  const others = t.sharedWith.map((o) => `${o.technicianName || tx('pos.another_technician')}${o.serviceNames.length ? ` (${o.serviceNames.join(', ')})` : ''}`).join('; ');
  return tx('pos.part_v0_of_of_with_others', { v0: String(t.visitPart ?? '?'), of: String(of), others: String(others) });
};

/** TECH QUEUE extras #11: "Salon day 2026-11-12: 3 of 4 checked-in guests served (75%) · Avg turn 45 min = 90 min ÷ 2 timed services" */
function ThroughputLine({ t }: { t: TQThroughputView }) {
  if (!t.checkedInGuests && !t.completedServices) return <p className="fk-hint" data-testid="tq-throughput">{tx('tq.thru.none', { d: t.businessDate })}</p>;
  const rate = t.servedRatePercent == null ? '—' : `${t.servedRatePercent}%`;
  return <p className="fk-hint" data-testid="tq-throughput" title={tx('tq.thru.rule', { tz: t.timeZone })}>
    {tx('tq.thru.served', { d: t.businessDate, done: String(t.completedServices), n: String(t.checkedInGuests), p: rate })}
    {' · '}{t.avgTurnMinutes == null ? tx('tq.thru.turnNone') : tx('tq.thru.turn', { a: String(t.avgTurnMinutes), m: String(t.serviceMinutes), n: String(t.timedServices) })}
  </p>;
}

export function POSTechQueueScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<TQState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a key + vars, translated at render (a language switch re-labels it)
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // extras (TECH QUEUE 13): what the ticket looked like when its drawer opened — a live update that changes it shows a
  // warning in the drawer (typed text kept); a live update that removes it closes the drawer with a note, never a stale act
  const [openSnap, setOpenSnap] = useState<{ status: string; tech: string; priority: string } | null>(null);
  const [techSel, setTechSel] = useState('');
  const [prioSel, setPrioSel] = useState('');
  const [reason, setReason] = useState('');
  const [declineCode, setDeclineCode] = useState('');   // Fair Turn §64–66: safety / eligibility reasons never cost a turn
  const [delayMin, setDelayMin] = useState('');
  const [dragGuest, setDragGuest] = useState<WaitGuest | null>(null);
  const { open: openIPad } = useIPadView();
  const [dropTech, setDropTech] = useState<string | null>(null);
  const [pendingAssign, setPendingAssign] = useState<string | null>(null);
  const [abPreview, setAbPreview] = useState<{ proposals: any[]; unassignable: any[]; summary: any } | null>(null);
  const [abBusy, setAbBusy] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('');
  const [breakOpen, setBreakOpen] = useState(false);
  const [breakTech, setBreakTech] = useState('');
  const [breakTechName, setBreakTechName] = useState('');
  const [breakReason, setBreakReason] = useState('');
  const [breakBusy, setBreakBusy] = useState(false);
  const [planFor, setPlanFor] = useState<{ queueItemId: string; customerName: string } | null>(null);
  const [laneSearch, setLaneSearch] = useState('');
  const [laneQ, setLaneQ] = useState('');
  const [laneStatus, setLaneStatus] = useState('');
  const [lanePage, setLanePage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setLaneQ(laneSearch.trim()); setLanePage(1); }, 250); return () => clearTimeout(h); }, [laneSearch]);
  useEffect(() => { setLanePage(1); }, [laneStatus]);
  const can = useCan();
  // ── Oct 30 2026: Live Queue / History · tabs · scoped search · details overlays ─────────────────────────────────────────
  const [mode, setMode] = useState<'live' | 'history'>('live');
  const [tab, setTab] = useState('live');
  const [uq, setUq] = useState(''); const uqQ = useDebounced(uq.trim(), 300);
  const [tSearchRaw, setTSearchRaw] = useState(''); const tSearch = useDebounced(tSearchRaw.trim(), 300);
  const [hPeriod, setHPeriod] = useState<PeriodState>({ preset: 'week' }); const [hField, setHField] = useState('closed'); const [tPage, setTPage] = useState(1);
  const [techId, setTechId] = useState<string | null>(null); const [ticketId, setTicketId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const srvTab = mode === 'history' ? 'history' : tab;
  const hKey = JSON.stringify(hPeriod);
  useEffect(() => setTPage(1), [srvTab, tSearch, hKey, hField]);
  const listQ = useLoad(() => (srvTab === 'live' && !tSearch ? Promise.resolve(null) : posTechQueueScreenApi.tickets({ tab: srvTab, q: tSearch || undefined, page: tPage, pageSize: 10, ...(mode === 'history' ? { ...periodQuery(hPeriod), dateField: hField } : {}) })), [srvTab, tSearch, tPage, JSON.stringify(hPeriod), hField, tick]);
  const counts = useLoad(() => posTechQueueScreenApi.tabCounts(), [tick]);
  const found = useLoad(() => (uqQ.length >= 2 ? posTechQueueScreenApi.search({ q: uqQ }) : Promise.resolve(null)), [uqQ]);


  // 200-technician §2 (Oct 27 2026): the server pages the lanes (search / status group / page) and never sends the roster —
  // at 1,000 technicians the board used to download 1,000 lane rows, 1,000 lanes and every name on each refresh.
  const load = useCallback(() => posTechQueueApi.state({ ...(serviceFilter ? { serviceCategory: serviceFilter } : {}), lanePage, lanePageSize: TQ_LANE_PAGE_SIZE, laneSearch: laneQ || undefined, laneStatus: laneStatus || undefined, roster: 'none' })
    .then((d) => { setS(d as TQState); setError(null); })
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_tech_queue'))), [serviceFilter, lanePage, laneQ, laneStatus]);

  useEffect(() => { load(); }, [load]);
  const refreshAll = useCallback(() => { void load(); setTick((n) => n + 1); }, [load]);
  useRealtime('tech-queue', refreshAll);
  useEffect(() => {
    if (!openId || !s) return;
    const now = (s.tickets?.items || []).find((x) => x.techQueueTicketId === openId);
    if (!now || !TQ_LIVE.includes(now.status)) { setOpenId(null); setOpenSnap(null); setNote(msg('tq.live.gone')); }
  }, [s, openId]);

  const act = async (tid: string, fn: () => Promise<any>, kind: string, closeDrawer?: boolean) => {
    setNote(null); setBusyId(tid + kind);
    try {
      const r = await fn();
      if (kind === 'notify' && r && r.configured === false) setNote(r.disabledReason || msg('pos.notifications_are_not_configured'));
      if (closeDrawer) { setOpenId(null); setReason(''); setTechSel(''); setPrioSel(''); setDelayMin(''); }
      await load(); setTick((n) => n + 1);
    } catch (e: any) { setNote(e?.message || msg('pos.action_failed')); }
    finally { setBusyId(null); }
  };

  const toggleDrawer = (t: TQRow) => {
    if (openId === t.techQueueTicketId) { setOpenId(null); return; }
    setOpenId(t.techQueueTicketId); setOpenSnap({ status: t.status, tech: t.assignedTechnicianName || '', priority: t.priority }); setNote(null); setReason(''); setTechSel(''); setPrioSel(t.priority || ''); setDelayMin('');
  };
  const doReassign = (tid: string) => { if (!techSel) { setNote(msg('pos.pick_a_technician_2')); return; } if (!reason.trim()) { setNote(msg('pos.reassigning_requires_a_reason')); return; } act(tid, () => posTechQueueApi.reassignTechnician(tid, { technicianId: techSel, reason: reason.trim() }), 'reassign', true); };
  const doPriority = (tid: string) => { if (!prioSel) { setNote(msg('pos.pick_a_priority')); return; } act(tid, () => posTechQueueApi.updatePriority(tid, { priority: prioSel }), 'prio', true); };
  const doReportDelay = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.a_delay_reason_is_required')); return; } const extra = parseInt(delayMin, 10); act(tid, () => posTechQueueApi.reportDelay(tid, { reason: reason.trim(), ...(Number.isFinite(extra) && extra > 0 ? { extraMinutes: extra } : {}) }), 'delay', true); };
  const doClearDelay = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.clearing_a_delay_requires_a_note')); return; } act(tid, () => posTechQueueApi.clearDelay(tid, { note: reason.trim() }), 'cleardelay', true); };
  const doDecline = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.declining_requires_a_reason')); return; } act(tid, () => posTechQueueApi.decline(tid, { reason: reason.trim(), ...(declineCode ? { reasonCode: declineCode } : {}) }), 'decline', true); };
  const doCancel = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.cancelling_requires_a_reason')); return; } act(tid, () => posTechQueueApi.cancel(tid, { reason: reason.trim() }), 'cancel', true); };


  if (error && !s) return <div className="work mos tqs" data-testid="tech-queue-screen"><h1>{tx('pos.tech_queue')}</h1><div className="fk-note bad" role="alert"><span>{error}</span></div></div>;
  if (!s) return <div className="work mos tqs" data-testid="tech-queue-screen"><div className="fk-loading">{tx('pos.loading_tech_queue')}</div></div>;
  const k = s.kpis;
  const a = s.analytics;
  const m2 = (c?: number) => fmtMoney(c || 0);
  const rows = s.technicianRows || [];
  // server-paged (rows = this page); an older server sends every lane and the page is cut here
  const lanePg = s.lanes ? { items: rows, total: s.lanes.total, page: s.lanes.page, totalPages: s.lanes.totalPages } : filterTechRows(rows, laneQ, laneStatus, lanePage);
  const waiting = s.waitingGuests || [];
  const tickets = s.tickets?.items || [];
  const avail = s.availableTechnicians || [];
  const perf = s.techPerformanceToday || [];
  const insights = (s.insights || []).slice(0, 5);
  const trend = (key: string) => s.kpiTrends?.[key];
  const avatar = (name: string, size = 18, type: 'customer' | 'technician' = 'technician', url?: string | null) => (
    <ProfileAvatarWithPreview name={name} url={url} size={size} type={type} />
  );


  const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
    in_service: { bg: '#E9F6EC', fg: '#2E9E54', label: tx('pos.in_service_3') }, finishing_soon: { bg: '#FBF1E6', fg: '#B5821F', label: tx('pos.finishing_soon') },
    available: { bg: '#E9F6EC', fg: '#2E9E54', label: tx('pos.available') }, on_break: { bg: '#E8F0FB', fg: '#3C7FB6', label: tx('pos.break') },
    off_today: { bg: '#F1ECE2', fg: '#8A7A66', label: tx('pos.offline_4') }, scheduled_later: { bg: '#F1ECE2', fg: '#8A7A66', label: tx('pos.scheduled') },
    appointment_soon: { bg: '#FBF1E6', fg: '#B5821F', label: tx('pos.appointment_soon') }, hold: { bg: '#F3E8F5', fg: '#7A4A8C', label: tx('pos.on_hold') },
  };
  const st = (x: string) => STATUS_TONE[x] || STATUS_TONE.available;
  // the code is the authority; only the label is translated (urgent has always shown as "High" here)
  const prioLabel = (p: string) => statusLabel('priority', p === 'urgent' ? 'high' : p);
  // the server's "next available" code → a label in the user's language (its English label only for an older server)
  const nextLabel = (r: { nextAvailable?: string; nextAvailableLabel: string }) => { const k = `ops.techQueue.next.${r.nextAvailable}`; const v = r.nextAvailable ? tx(k) : k; return v !== k ? v : r.nextAvailableLabel; };   // an unknown code: the server's label
  // the server's insight code + numbers → the sentence in the user's language (its English text for an unknown code)
  const insightText = (ins: TQInsight) => {
    const v = ins.vars || {};
    if (ins.id === 'ot') return { text: tx('ops.techQueue.insight.ot', { count: String(v.count ?? '') }), sub: tx('ops.techQueue.insight.otSub'), actionText: tx('ops.techQueue.insight.reviewNow') };
    if (ins.id === 'up') return { text: tx('ops.techQueue.insight.up', { name: String(v.name ?? '') }), sub: tx('ops.techQueue.insight.upSub', { revenue: m2(Number(v.revenueCents ?? 0)), services: String(v.services ?? '') }), actionText: tx('pos.view') };
    if (ins.id === 'wait') return { text: tx('ops.techQueue.insight.wait', { count: String(v.count ?? '') }), sub: tx('ops.techQueue.insight.waitSub'), actionText: tx('pos.auto_balance_queue') };
    return { text: ins.text, sub: ins.sub, actionText: ins.action };   // an insight this screen has no text for: the server's words
  };

  // Workload board columns: counted by the server over EVERY technician (a few rows each); an older server sends every
  // lane row and they are derived here
  const derive = (pred: (r: TechRow) => boolean): WorkloadCol => { const hit = rows.filter(pred); return { count: hit.length, items: hit }; };
  const wl = s.workload ?? {
    available: derive((r) => r.status === 'available'), inProgress: derive((r) => r.status === 'in_service' && !!r.currentServiceName),
    finishing: derive((r) => r.status === 'finishing_soon'), breakOffline: derive((r) => r.status === 'on_break' || r.status === 'hold' || r.status === 'off_today'),   // §33: Hold sits with Break (as on the Fair Turn board)
  };
  const knownTechs = [...rows, ...wl.available.items, ...wl.inProgress.items, ...wl.finishing.items, ...wl.breakOffline.items];
  const readyGuests = waiting.slice(0, 3);

  // ---- Workload Board drag-and-drop assignment (waiting guest → technician); drag state declared with other hooks above ----
  const assignByDrop = async (guest: WaitGuest, techId: string, techName: string, techStatus: string) => {
    // a split best match is planned as a whole (contract §7) — never dropped onto one technician
    if (guest.bestMatchMode === 'split' && guest.queueItemId) {
      setNote(msg('pos.customername_needs_several_technicians_review_the_1rmh', { customerName: String(guest.customerName) }));
      setPlanFor({ queueItemId: guest.queueItemId, customerName: guest.customerName }); setDragGuest(null); setDropTech(null);
      return;
    }
    const elig = dropEligibility(techStatus);
    if (!elig.ok) { setNote(msg('pos.can_t_assign_customername_to_techname_1anj', { customerName: String(guest.customerName), techName: String(techName), reason: elig.reasonKey ? msg(elig.reasonKey) : String(elig.reason) })); return; }
    if (!guest.queueItemId) { setNote(msg('pos.this_guest_has_no_active_queue_3e12')); return; }
    setPendingAssign(guest.queueItemId); // optimistic: dim the card until the server confirms
    try {
      // bug 10: say what this board showed — a waiting guest has nobody yet; a stale view is refused, never applied
      await posQueueApi.assignTechnician(guest.queueItemId, { technicianId: techId, expectedTechnicianId: guest.assignedTechnicianId ?? null, ...(guest.version != null ? { expectedVersion: guest.version } : {}) });
      setNote(msg(elig.mode === 'next' ? 'ops.techQueue.queuedNextFor' : 'ops.techQueue.assignedTo', { customer: guest.customerName, tech: techName }));
      load(); // refresh authoritative state (and roll the optimistic UI into real data)
    } catch (e: any) {
      if (isQueueConflict(e)) { setNote(queueConflictMessage(e, guest.customerName, (t) => knownTechs.find((r) => r.technicianId === t)?.technicianName || (s?.technicianLanes || []).find((l) => l.technicianId === t)?.technicianName)); load(); }   // spec §77: another device assigned first
      else setNote(msg('pos.assignment_failed_v0_the_guest_stays_90qk', { v0: e?.message || msg('pos.please_retry') })); // rollback = no state change
    } finally {
      setPendingAssign(null); setDragGuest(null); setDropTech(null);
    }
  };
  const runAutoBalance = async () => {
    setNote(null); setAbBusy(true);
    try { const p = await posQueueApi.autoBalancePreview(); if (!p.proposals?.length) { setNote(msg(p.unassignable?.length ? 'pos.no_assignable_guests_right_now_waiting_d5xa' : 'pos.nothing_to_balance_no_guests_are_19q5')); setAbPreview(null); } else { setAbPreview(p); } }
    catch (e: any) { setNote(e?.message || msg('pos.could_not_compute_a_balance_preview')); }
    finally { setAbBusy(false); }
  };
  const applyAutoBalance = async () => {
    if (!abPreview?.proposals?.length) return;
    setAbBusy(true); setNote(null);
    try {
      // proposals are for unassigned waiting guests only (bug 5): one assigned meanwhile is refused, not overwritten
      const r = await posQueueApi.autoBalanceApply(abPreview.proposals.map((p: any) => ({ queueItemId: p.queueItemId, technicianId: p.technicianId, expectedTechnicianId: null })));
      setNote(msg('pos.auto_balance_applied_applied_assigned_v1', { applied: String(r.applied), v1: r.failures?.length ? msg('pos.length_could_not_be_assigned', { length: String(r.failures.length) }) : '' }));
      setAbPreview(null); load();
    } catch (e: any) { setNote(e?.message || msg('pos.apply_failed_no_changes_were_made')); }
    finally { setAbBusy(false); }
  };


  // ---- D1 one-click assign: send the waiting guest to their computed best-match technician (same endpoint +
  // eligibility as drag-drop). Falls back to the queue screen only when there is no best match or no queue record. ----
  const assignToBestMatch = (guest: WaitGuest) => {
    if (guest.bestMatchMode === 'split' && guest.queueItemId) { setNote(null); setPlanFor({ queueItemId: guest.queueItemId, customerName: guest.customerName }); return; }
    if (!guest.bestMatchTechnicianId) { nav('/queue'); return; }
    const tech = knownTechs.find((r) => r.technicianId === guest.bestMatchTechnicianId);
    assignByDrop(guest, guest.bestMatchTechnicianId, guest.bestMatchTechnicianName || tx('pos.best_match_4'), tech?.status || 'available');
  };

  // ---- Send Break (bug 10): the real break API; a technician mid-service is refused by the server (409, plain words).
  // 200-technician §2: the technician is picked through the server-paged picker (working today), never a roster <select>.
  const sendBreak = async () => {
    if (!breakTech) { setNote(msg('pos.pick_the_technician_who_is_going_9sfw')); return; }
    const name = breakTechName || knownTechs.find((r) => r.technicianId === breakTech)?.technicianName || msg('pos.the_technician');
    setBreakBusy(true); setNote(null);
    try {
      await posLiveTechnicianScheduleApi.startBreak(breakTech, breakReason.trim() ? { reason: breakReason.trim() } : {});
      setNote(msg('pos.name_is_on_break_new_guests_14md', { name }));
      setBreakOpen(false); setBreakTech(''); setBreakTechName(''); setBreakReason(''); load();
    } catch (e: any) { setNote(e?.status === 409 ? msg('pos.name_can_t_start_a_break_1dqp', { name, message: String(e.message) }) : msg('pos.could_not_start_the_break_v0', { v0: e?.message || msg('pos.please_retry') })); }
    finally { setBreakBusy(false); }
  };
  const endBreak = async (tid: string, name: string) => {
    setNote(null);
    try { await posLiveTechnicianScheduleApi.endBreak(tid); setNote(msg('pos.name_is_back_from_break', { name: String(name) })); load(); }
    catch (e: any) { setNote(msg('pos.could_not_end_the_break_v0', { v0: e?.message || msg('pos.please_retry') })); }
  };

  const QA: { l: string; d: string; fn: () => void }[] = [
    { l: tx('pos.assign_guest'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0M15 4l2 2-2 2', fn: () => nav('/queue') },
    { l: tx('pos.reassign_tech'), d: 'M5 8a3 3 0 116 0M14 12a3 3 0 11-6 0M4 6v3h3M16 14v-3h-3', fn: () => { setMode('live'); setTab('live'); setNote(msg('pos.reassign_from_the_guest_s_row_kkw4')); document.querySelector('[data-testid="assigned-tickets"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    { l: tx('pos.start_service'), d: 'M6 4l10 6-10 6z', fn: () => nav('/serving') },
    { l: tx('pos.send_break'), d: 'M5 11h8a2 2 0 010 4H5zM13 11V7M9 4v2M11 4v2', fn: () => { setBreakOpen(true); setNote(null); } },
    { l: tx('pos.message_tech'), d: 'M4 5h12v8H8l-4 3z', fn: () => nav('/messages') },
    { l: tx('pos.view_schedule'), d: 'M4 5h12v11H4zM4 8h12M8 3v3M12 3v3', fn: () => nav('/technicians/schedule') },
    { l: tx('pos.open_team_report'), d: 'M4 16V8M9 16V4M14 16v-6', fn: () => nav('/tenant/reports/technicians') },
  ];


  const TONE: Record<string, string> = { in_service: 'info', finishing_soon: 'warn', available: 'ok', on_break: 'warn', off_today: 'mut', scheduled_later: 'mut', appointment_soon: 'warn', hold: 'mut',
    assigned: 'info', waiting_for_acceptance: 'warn', accepted: 'ok', ready_to_start: 'ok', paused: 'warn', delayed: 'bad', expired: 'bad', cancelled: 'bad', declined: 'bad', no_show: 'bad', service_done: 'ok' };
  const PRIO: Record<string, string> = { high: 'bad', urgent: 'bad', vip: 'gold', normal: 'mut' };
  const chip = (txt: string, tone = 'mut') => <span className={'fk-chip ' + tone}>{txt}</span>;
  const live = mode === 'live';
  const liveTickets = tickets.filter((t) => TQ_LIVE.includes(t.status));
  const kv = (n: number | null | undefined) => (n == null ? '—' : String(n));
  const KPIS: { key: string; l: string; v: string; sub: string; tone?: 'ok' | 'warn' | 'bad' }[] = [
    { key: 'active', l: tx('pos.active_technicians'), v: `${kv(k.activeTechnicians)} / ${kv(k.scheduledTechnicians)}`, sub: tx('tq.k.active') },
    { key: 'available', l: tx('pos.available_now_3'), v: String(k.availableTechnicians ?? 0), sub: tx('tq.k.available'), tone: k.availableTechnicians ? 'ok' : undefined },
    { key: 'inProgress', l: tx('pos.services_in_progress'), v: String(k.servicesInProgress ?? 0), sub: tx('tq.k.inProgress') },
    { key: 'waiting', l: tx('pos.waiting_for_assignment'), v: String(k.waitingForAssignment ?? 0), sub: tx('tq.k.waiting'), tone: k.waitingForAssignment ? 'warn' : undefined },
    { key: 'avgTurn', l: tx('pos.avg_turn_time'), v: k.avgTurnTimeMinutes > 0 ? tx('pos.avgturntimeminutes_min', { avgTurnTimeMinutes: String(k.avgTurnTimeMinutes) }) : '—', sub: tx('tq.k.avgTurn') },
    { key: 'utilization', l: tx('pos.utilization_today_2'), v: `${k.utilizationTodayPercent ?? 0}%`, sub: tx('tq.k.utilization') },
    { key: 'laborRevenue', l: tx('pos.labor_revenue_today'), v: m2(k.laborRevenueTodayCents), sub: tx('tq.k.revenue') },
    { key: 'upsell', l: tx('pos.upsell_capture'), v: k.upsellCapturePercent == null || counts.data?.done_today === 0 ? tx('tq.na') : `${k.upsellCapturePercent}%`, sub: tx('tq.k.upsell') },
  ];
  const trendSub = (key: string, base: string) => { const tr = trend(key); return tr && (tr.text || tr.deltaPercent != null) ? `${tr.direction === 'down' ? '▼' : '▲'} ${tr.text || `${Math.abs(tr.deltaPercent ?? 0)}% ${tx('pos.vs_yesterday')}`}` : base; };
  const tabCount = (t: string) => (counts.data && typeof counts.data[t] === 'number' ? counts.data[t] : t === 'live' ? liveTickets.length : null);
  const listItems: any[] = Array.isArray(listQ.data?.items) ? listQ.data.items : [];
  const openTech = (id: string) => { setTechId(id); setNote(null); };
  const COLORS = ['#A96F22', '#7B9FD4', '#6BAF92', '#D08C8C', '#B0A0C8', '#E0A85B'];

  return (
    <div className="work mos tqs" data-testid="tech-queue-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.tech_queue')}</h1><div className="sub">{tx('pos.real_time_technician_workload_assignments_performance_1mmo')}</div></div>
        <div className="fk-head-actions">
          <div className="fk-seg tq-mode" aria-label={tx('tq.mode')}>{(['live', 'history'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setNote(null); }} data-testid={'mode-' + m}>{tx('tq.mode.' + m)}</button>)}</div>
          <select className="fk-select" aria-label={tx('pos.service_filter')} value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} data-testid="service-filter"><option value="">{tx('pos.all_services')}</option>{(s.filters?.serviceCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <span className="fk-hint tq-date" aria-label={tx('pos.tech_queue_date')}>{tx('pos.today_v0', { v0: fmtMonthDay(new Date()) })}</span>
          <button type="button" className="fk-btn" onClick={refreshAll} data-testid="refresh">{tx('pos.auto_refresh')}</button>
          <span className="tq-live" data-testid="live-dot"><span aria-hidden="true" />{tx('pos.live')}</span>
        </div>
      </header>
      {note ? <div className="fk-note info" role="status" data-testid="note"><span>{renderMsg(note)}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {error ? <div className="fk-note bad" role="alert"><span>{error}</span></div> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={uq} onChange={(e) => setUq(e.target.value)} placeholder={tx('tq.searchPh')} aria-label={tx('tq.searchPh')} data-testid="search" />
          {uq ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setUq('')} data-testid="search-clear">✕</button> : null}</div>
      </div>
      {found.data && Array.isArray(found.data.live?.items) ? <FitPanel testId="search-results" title={tx('tq.results', { q: found.data.q })}>
        {found.data.technicians.totalItems + found.data.live.totalItems + found.data.history.totalItems === 0 ? <Empty title={tx('cg.noMatchSearch', { q: found.data.q })} /> : <div className="mos-row three cg-row">
          <div><h3 className="fk-h3">{tx('tq.scope.tech', { n: String(found.data.technicians.totalItems) })}</h3><ul className="fk-list dense">{found.data.technicians.items.map((t: any) => <li key={t.technicianId} className="fk-li"><button type="button" className="ls-hit" onClick={() => openTech(t.technicianId)} data-testid="hit-tech">{avatar(t.name, 28, 'technician', t.avatarUrl)}<span className="fk-li-t">{t.name}<span className="fk-li-s">{codeLabel('tq.q.' + String(t.queue).toLowerCase(), t.queue)}</span></span></button></li>)}</ul></div>
          <div><h3 className="fk-h3">{tx('tq.scope.live', { n: String(found.data.live.totalItems) })}</h3><ul className="fk-list dense">{found.data.live.items.map((t: any) => <li key={t.id} className="fk-li"><button type="button" className="ls-hit" onClick={() => setTicketId(t.id)} data-testid="hit-live"><span className="fk-li-t">{t.customer ?? '—'} · {statusLabel('techTicket', t.status)}<span className="fk-li-s">{t.services.join(', ')} · {t.technician ?? '—'}{t.phone ? ` · ${t.phone}` : ''}</span></span></button></li>)}</ul></div>
          <div><h3 className="fk-h3">{tx('tq.scope.history', { n: String(found.data.history.totalItems) })}</h3><ul className="fk-list dense">{found.data.history.items.map((t: any) => <li key={t.id} className="fk-li"><button type="button" className="ls-hit" onClick={() => setTicketId(t.id)} data-testid="hit-history"><span className="fk-li-t">{t.customer ?? '—'} · {statusLabel('techTicket', t.status)}<span className="fk-li-s">{whenTime(t.updatedAt)} · {t.services.join(', ')} · {t.technician ?? '—'}</span></span></button></li>)}</ul></div>
        </div>}
      </FitPanel> : null}

      {planFor ? <VisitPlanPanel key={planFor.queueItemId} queueItemId={planFor.queueItemId} customerName={planFor.customerName} can={can}
        roster={knownTechs.map((r) => ({ technicianId: r.technicianId, displayName: r.technicianName }))} pickFromServer
        onChanged={() => { void load(); }} onClose={() => setPlanFor(null)} /> : null}
      {breakOpen ? (
        <div className="fk-panel tq-inline" aria-label={tx('pos.send_a_technician_on_break')} data-testid="break-panel">
          <label className="fk-field">{tx('pos.technician')}
            <TechnicianPickerButton value={breakTech} valueName={breakTechName || undefined} emptyLabel={tx('pos.select_technician')} ariaLabel={tx('pos.break_technician')} workingOnlyDefault
              onChange={(id, t) => { setBreakTech(id); setBreakTechName(t?.name || ''); }} style={{ maxWidth: '100%' }} /></label>
          <label className="fk-field">{tx('pos.reason_optional')}<input aria-label={tx('pos.break_reason')} value={breakReason} onChange={(e) => setBreakReason(e.target.value)} placeholder={tx('pos.e_g_lunch')} /></label>
          <div className="cg-acts"><button type="button" className="fk-btn primary" disabled={breakBusy} onClick={sendBreak}>{breakBusy ? tx('pos.starting') : tx('pos.start_break_2')}</button>
            <button type="button" className="fk-btn ghost" disabled={breakBusy} onClick={() => setBreakOpen(false)}>{tx('pos.cancel')}</button></div>
        </div>
      ) : null}
      {abPreview ? (
        <FitPanel testId="auto-balance" title={<>{tx('pos.auto_balance_preview')}{' '}{abPreview.summary.proposed} {tx('pos.proposed_assignment')}{enPlural(abPreview.summary.proposed === 1 ? '' : 's')}</>}
          actions={<><button type="button" className="fk-btn primary" disabled={abBusy} onClick={applyAutoBalance}>{abBusy ? tx('pos.applying') : tx('pos.apply_proposed', { proposed: String(abPreview.summary.proposed) })}</button>
            <button type="button" className="fk-btn ghost" disabled={abBusy} onClick={() => setAbPreview(null)}>{tx('pos.cancel')}</button></>}>
          <p className="fk-hint">{tx('pos.review_before_applying_nothing_is_moved_il39')} {tx('tq.fairNote')}</p>
          <table className="fk-table fn-table cg-table"><thead><tr><th>{tx('pos.guest')}</th><th>{tx('pos.proposed_technician')}</th><th>{tx('pos.why')}</th><th>{tx('pos.waiting_2')}</th></tr></thead>
            <tbody>{abPreview.proposals.map((p: any) => <tr key={p.queueItemId}><td><b>{p.customerName}</b></td><td>{p.technicianName}</td><td>{p.reason || '—'}</td><td>{p.addressesWaitMinutes} {tx('pos.min')}</td></tr>)}</tbody></table>
          {abPreview.unassignable?.length ? <p className="fk-hint warn">{tx('ops.techQueue.unassignableLeft', { count: String(abPreview.unassignable.length) })}</p> : null}
        </FitPanel>
      ) : null}

      <div className="fk-kpis eight cg-kpis" data-testid="kpis">
        {KPIS.map((c) => <KpiCard key={c.key} testId={'kpi-' + c.key} tone={c.tone} label={c.l} value={c.v} sub={trendSub(c.key, c.sub)} />)}
      </div>
      <p className="fk-hint" title={tx('tq.kpiRule')}>{tx('tq.kpiRule')}</p>

      {live ? <>
        <div className="mos-row tq-ac">
          {/* A. Live Technician Queue */}
          <FitPanel testId="live-queue" title={tx('pos.a_live_technician_queue')} footer={<button type="button" className="fk-link" onClick={refreshAll}>{tx('pos.view_full_tech_queue')}</button>}>
            <div className="mos-tools">
              <div className="fn-search mos-search"><ImeSafeInput type="search" className="fk-search" aria-label={tx('pos.find_technician')} placeholder={tx('pos.tq_search_placeholder')} value={laneSearch} onValue={setLaneSearch} /></div>
              <select className="fk-select" aria-label={tx('pos.tq_status_filter')} value={laneStatus} onChange={(e) => setLaneStatus(e.target.value)}>
                <option value="">{tx('pos.tq_all_statuses')}</option><option value="ready">{tx('pos.tq_status_ready')}</option><option value="serving">{tx('pos.tq_status_serving')}</option>
                <option value="soon">{tx('pos.appointment_soon')}</option><option value="break">{tx('pos.tq_status_break')}</option><option value="hold">{tx('pos.on_hold')}</option><option value="off">{tx('pos.tq_status_off')}</option>
              </select>
            </div>
            <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table" data-testid="lane-table">
              <thead><tr><th>#</th><th>{tx('pos.technician')}</th><th className="t-opt">{tx('pos.specialties')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.guests')}</th><th>{tx('pos.current_service')}</th><th>{tx('pos.next')}</th><th className="num">{tx('pos.util_2')}</th><th className="num t-opt">{tx('pos.tips')}</th><th className="num">{tx('pos.revenue')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>
                {lanePg.items.map((r) => (
                  <tr key={r.technicianId} data-testid="lane-row">
                    <td className="fk-muted">{r.rotationPosition}</td>
                    <td><button type="button" className="tq-who" onClick={() => openTech(r.technicianId)} data-testid="lane-tech">{avatar(r.technicianName, 26, 'technician', (r as any).avatarUrl)}<b>{r.technicianName}</b></button></td>
                    <td className="t-opt fk-muted">{r.specialties.join(', ')}</td>
                    <td>{chip(st(r.status).label, TONE[r.status])}{r.status === 'hold' && r.holdReason ? <span className="fk-li-s">{codeLabel('tq.hold.' + r.holdReason, r.holdReason)}</span> : null}</td>
                    <td className="num">{r.guests}</td>
                    <td className="tq-clip" title={r.currentServiceName ? `${r.currentServiceName} — ${r.currentServiceCustomer || ''}` : undefined}>{r.currentServiceName ? `${r.currentServiceName} — ${r.currentServiceCustomer || ''}` : '—'}</td>
                    <td className="tq-clip" title={String(nextLabel(r) ?? '')}>{nextLabel(r)}</td>
                    <td className="num">{r.utilizationPercent != null ? `${r.utilizationPercent}%` : '—'}</td>
                    <td className="num t-opt">{m2(r.tipsTodayCents)}</td>
                    <td className="num"><b>{m2(r.revenueTodayCents)}</b></td>
                    <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => openTech(r.technicianId)} data-testid="lane-details">{tx('pos.details')}</button></td>
                  </tr>
                ))}
                {(s.lanes ? s.lanes.totalAll === 0 : rows.length === 0) ? <tr><td colSpan={11} className="fk-empty-cell">{tx('pos.no_technicians_clocked_in')}</td></tr> : null}
                {(s.lanes ? s.lanes.totalAll > 0 : rows.length > 0) && lanePg.total === 0 ? <tr><td colSpan={11} className="fk-empty-cell">{tx('pos.no_technician_matches')}</td></tr> : null}
              </tbody>
            </table></div>
            {lanePg.total > 0 ? (
              <div data-testid="tq-lane-pager" className="tq-pager">
                <span className="fk-muted">{tx('pos.tq_showing_x_of_y', { shown: String(lanePg.items.length), total: String(lanePg.total) })}</span>
                {lanePg.totalPages > 1 ? <span className="tq-pager-b">
                  <button type="button" className="fk-btn ghost sm" disabled={lanePg.page <= 1} onClick={() => setLanePage(1)}>{tx('pos.first_page')}</button>
                  <button type="button" className="fk-btn ghost sm" disabled={lanePg.page <= 1} onClick={() => setLanePage(Math.max(1, lanePg.page - 1))}>{tx('pos.previous')}</button>
                  <span>{tx('pos.page_x_of_y', { page: String(lanePg.page), pages: String(lanePg.totalPages) })}</span>
                  <button type="button" className="fk-btn ghost sm" disabled={lanePg.page >= lanePg.totalPages} onClick={() => setLanePage(lanePg.page + 1)}>{tx('pos.next')}</button>
                  <button type="button" className="fk-btn ghost sm" disabled={lanePg.page >= lanePg.totalPages} onClick={() => setLanePage(lanePg.totalPages)}>{tx('pos.last_page')}</button>
                </span> : null}
              </div>
            ) : null}
            <p className="fk-hint" title={tx('tq.rotationRule')}>{tx('tq.rotationRule')}</p>
          </FitPanel>

          {/* C. AI Assignment Insights */}
          <FitPanel testId="ai-insights" title={<>{tx('pos.c_ai_assignment_insights')} <span className="fk-chip gold">{tx('pos.new')}</span></>}>
            <ul className="fk-list tq-ins">{insights.map((ins) => { const it = insightText(ins); return (
              <li key={ins.id} className={'fk-li ' + (ins.severity === 'warn' ? 'warn' : '')}><span className="fk-li-t">{it.text}{it.sub ? <span className="fk-li-s">{it.sub}</span> : null}</span>
                {ins.action ? <button type="button" className="fk-btn ghost sm" onClick={() => ins.route && nav(ins.route)}>{it.actionText}</button> : null}</li>); })}
              {insights.length === 0 ? <li className="fk-li"><span className="fk-muted">{tx('pos.no_insights_right_now')}</span></li> : null}</ul>
            <div className="tq-ai-acts">
              <button type="button" className="fk-btn primary" disabled={abBusy} onClick={runAutoBalance} data-testid="auto-balance-run">{abBusy ? tx('pos.balancing') : tx('pos.auto_balance_queue')}</button>
              <div className="cg-acts"><button type="button" className="fk-btn ghost" onClick={() => nav('/queue')}>{tx('pos.view_suggestions')}</button><button type="button" className="fk-btn ghost" onClick={() => nav('/messages')}>{tx('pos.send_alert')}</button></div>
            </div>
            <p className="fk-hint" title={tx('tq.aiRule')}>{tx('tq.aiRule')}</p>
          </FitPanel>
        </div>

        {/* B. Technician Workload Board */}
        <FitPanel testId="workload" title={tx('pos.b_technician_workload_board')}>
          <div className="tq-board">
            {[
              { title: tx('pos.available_now_3'), cls: 'ok', count: wl.available.count, kind: 'tech', list: wl.available.items, drop: true },
              { title: tx('pos.ready_for_assignment'), cls: 'warn', count: readyGuests.length, kind: 'guest', list: readyGuests, drop: true },
              { title: tx('pos.in_progress'), cls: 'info', count: wl.inProgress.count, kind: 'svc', list: wl.inProgress.items, drop: false },
              { title: tx('pos.finishing_soon'), cls: 'warn', count: wl.finishing.count, kind: 'svc', list: wl.finishing.items, drop: true },
              { title: tx('pos.break_offline'), cls: 'mut', count: wl.breakOffline.count, kind: 'off', list: wl.breakOffline.items, drop: false },
            ].map((col) => (
              <div key={col.title} className={'tq-col ' + col.cls}>
                <div className="tq-col-h"><b>{col.title}</b><span className="tq-n">{col.count}</span></div>
                {col.list.slice(0, 2).map((it: any, idx: number) => {
                  const isTechTarget = col.kind === 'tech' || col.kind === 'svc';
                  const elig = isTechTarget ? dropEligibility(it.status) : { ok: false };
                  const isDropHover = dropTech === (it.technicianId) && dragGuest;
                  const isGuestPending = col.kind === 'guest' && it.queueItemId === pendingAssign;
                  // TOUCH PATH: tap a guest to select it, then tap an eligible technician — the same assign call the drag uses
                  const isArmedGuest = col.kind === 'guest' && dragGuest && (dragGuest as any).queueItemId === it.queueItemId;
                  const isArmedTarget = !!dragGuest && isTechTarget && elig.ok;
                  const tapAction = col.kind === 'guest'
                    ? () => setDragGuest((cur: any) => (cur && cur.queueItemId === it.queueItemId ? null : it))
                    : (isTechTarget && dragGuest && elig.ok ? () => { assignByDrop(dragGuest, it.technicianId, it.technicianName, it.status); setDragGuest(null); setDropTech(null); } : undefined);
                  return (
                    <div key={idx} className={'tq-card' + ((isDropHover && elig.ok) || isArmedGuest ? ' hot' : isArmedTarget ? ' armed' : '') + (isGuestPending ? ' pending' : '')}
                      draggable={col.kind === 'guest'} onClick={tapAction}
                      onDragStart={col.kind === 'guest' ? () => setDragGuest(it) : undefined}
                      onDragEnd={col.kind === 'guest' ? () => { setDragGuest(null); setDropTech(null); } : undefined}
                      onDragOver={isTechTarget && elig.ok ? (e) => { e.preventDefault(); setDropTech(it.technicianId); } : undefined}
                      onDragLeave={isTechTarget ? () => setDropTech((cur) => (cur === it.technicianId ? null : cur)) : undefined}
                      onDrop={isTechTarget && dragGuest ? (e) => { e.preventDefault(); assignByDrop(dragGuest, it.technicianId, it.technicianName, it.status); } : undefined}
                      title={isTechTarget ? (elig.ok ? tx('pos.tap_or_drop_a_guest_to_sc0l', { technicianName: String(it.technicianName) }) : '') : col.kind === 'guest' ? tx('pos.tap_to_select_then_tap_a_opd9') : undefined}>
                      <div className="tq-card-h">{avatar(col.kind === 'guest' ? it.customerName : it.technicianName, 24, col.kind === 'guest' ? 'customer' : 'technician', it.avatarUrl)}<b>{col.kind === 'guest' ? it.customerName : it.technicianName}</b></div>
                      {col.kind === 'tech' ? <span className="fk-li-s">{tx('pos.no_current_guest_next_any')}{it.specialties?.length ? ` · ${it.specialties.slice(0, 3).join(', ')}` : ''}</span> : null}
                      {col.kind === 'guest' ? <span className="fk-li-s">{tx('pos.waiting_2')} {it.waitMinutes} {tx('pos.min')} · {it.serviceName}</span> : null}
                      {col.kind === 'svc' ? <span className="fk-li-s">{it.currentServiceName}{it.currentServiceCustomer ? ` · ${it.currentServiceCustomer}` : ''}</span> : null}
                      {col.kind === 'off' ? <span className="fk-li-s">{st(it.status).label}{it.status === 'on_break' ? <button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); endBreak(it.technicianId, it.technicianName); }}>{tx('pos.end_break_2')}</button> : null}</span> : null}
                    </div>
                  ); })}
                {col.drop ? <div className={'tq-drop' + (dragGuest ? ' on' : '')} onDragOver={dragGuest ? (e) => e.preventDefault() : undefined}>{dragGuest ? tx('pos.tap_or_drop_onto_a_technician_112c') : tx('pos.tap_a_guest_then_a_technician_15cd')}</div> : null}
              </div>
            ))}
          </div>
          <p className="fk-hint" title={tx('tq.boardRule')}>{tx('tq.boardRule')}</p>
        </FitPanel>
      </> : <div className="fk-note info" data-testid="history-banner"><span>{tx('tq.historyBanner')}</span></div>}

      {/* Assigned Tickets — Live tabs in operational order (first assigned first), History newest first */}
      <FitPanel testId="assigned-tickets" title={<>{live ? tx('pos.assigned_tickets') : tx('tq.historyTitle')}{live && srvTab === 'live' && !tSearch ? <span className="fk-muted"> · {liveTickets.length} {tx('pos.in_queue')}</span> : listQ.data ? <span className="fk-muted"> · {tx('cg.matching', { n: String(listQ.data.totalItems ?? 0) })}</span> : null}</>}
        footer={srvTab !== 'live' || tSearch ? <Pager info={pageOf(listQ.data)} onPage={setTPage} label={tx('pos.assigned_tickets')} /> : undefined}>
        {live ? <div className="fk-tabs tq-tabs" data-hscroll role="tablist" aria-label={tx('pos.assigned_tickets')}>{TQ_TAB_KEYS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>
          {tx('tq.tab.' + t)}{tabCount(t) != null ? <span className="tq-n">{tabCount(t)}</span> : null}</button>)}</div> : null}
        <div className="mos-tools">
          <div className="fn-search mos-search"><input className="fk-search" type="search" value={tSearchRaw} onChange={(e) => setTSearchRaw(e.target.value)} placeholder={tx('tq.ticketSearchPh')} aria-label={tx('tq.ticketSearchPh')} data-testid="ticket-search" /></div>
          {!live ? <select className="fk-select" value={hField} onChange={(e) => setHField(e.target.value)} aria-label={tx('tq.dateField')} data-testid="history-field">{['closed', 'created', 'assigned', 'started'].map((f) => <option key={f} value={f}>{tx('tq.df.' + f)}</option>)}</select> : null}
        </div>
        {!live ? <PeriodBar value={hPeriod} onChange={(p) => { setHPeriod(p); setTPage(1); }} server={listQ.data?.period} allowAll compact basis={hField} basisOptions={['closed', 'created', 'assigned', 'started'].map((f) => ({ value: f, label: tx('tq.df.' + f) }))} onBasis={setHField} /> : null}
        {live && srvTab === 'live' && !tSearch ? (liveTickets.length === 0 ? <Empty title={tx('pos.no_assigned_tickets_right_now')} /> : (
          <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table" data-testid="tickets-table">
            <thead><tr><th>#</th><th>{tx('pos.guest')}</th><th>{tx('pos.services')}</th><th>{tx('pos.technician')}</th><th>{tx('pos.priority')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.wait')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>
              {liveTickets.map((t, i) => (
                <React.Fragment key={t.techQueueTicketId}>
                  <tr data-testid="ticket-row" className={openId === t.techQueueTicketId ? 'tq-open' : ''}>
                    <td className="fk-muted">{i + 1}</td>
                    <td><span className="tq-who">{avatar(t.customerName, 24, 'customer', (t as any).customerAvatarUrl || (t as any).avatarUrl)}<b>{t.customerName}</b>{t.isVip ? chip('VIP', 'gold') : null}</span></td>
                    <td>{svcNames(t.requestedServices) || tx('pos.servicecount_service_plural', { serviceCount: String(t.serviceCount), plural: String(t.serviceCount === 1 ? '' : 's') })}{partLabel(t) ? <span className="fk-li-s" data-testid={`part-${t.techQueueTicketId}`}>{partLabel(t)}</span> : null}</td>
                    <td>{t.assignedTechnicianName || '—'}</td>
                    <td>{chip(prioLabel(t.priority), PRIO[t.priority] ?? 'mut')}</td>
                    <td>{chip(statusLabel('techTicket', t.status), TONE[t.status])}</td>
                    <td className="num">{t.assignedWaitMinutes != null ? tx('ops.common.minutesShort', { n: String(t.assignedWaitMinutes) }) : '—'}</td>
                    <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => toggleDrawer(t)}>{openId === t.techQueueTicketId ? tx('pos.close') : tx('pos.manage')}</button>
                      <button type="button" className="fk-btn ghost sm" onClick={() => setTicketId(t.techQueueTicketId)} data-testid="ticket-timeline">{tx('tq.timeline')}</button></td>
                  </tr>
                  {openId === t.techQueueTicketId ? (
                    <tr className="tq-drawer"><td colSpan={8}>
                      {openSnap && (openSnap.status !== t.status || openSnap.tech !== (t.assignedTechnicianName || '') || openSnap.priority !== t.priority)
                        ? <div className="fk-note warn" role="status" data-testid="tq-live-changed">{tx('tq.live.changed', { s: statusLabel('techTicket', t.status), t: t.assignedTechnicianName || '—', p: prioLabel(t.priority) })}
                          {' '}<button type="button" className="fk-link" onClick={() => setOpenSnap({ status: t.status, tech: t.assignedTechnicianName || '', priority: t.priority })} data-testid="tq-live-ack">{tx('tq.live.ack')}</button></div> : null}
                      <div className="cg-form">
                        <label className="fk-field">{tx('pos.reassign_to_technician')}<TechnicianPickerButton value={techSel} emptyLabel={tx('pos.select_technician')} ariaLabel={tx('pos.reassign_to_technician')}
                          serviceIds={t.requestedServices.map((x) => x.serviceId || '').filter(Boolean)} onChange={(id) => setTechSel(id)} style={{ maxWidth: '100%' }} /></label>
                        <label className="fk-field">{tx('pos.priority')}<select value={prioSel} onChange={(e) => setPrioSel(e.target.value)}><option value="">{tx('pos.keep_current')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{prioLabel(p)}</option>)}</select></label>
                        <label className="fk-field">{tx('pos.reason_note_required_for_reason_bearing_1ivf')}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.e_g_guest_requested_a_different_4mgh')} /></label>
                        <label className="fk-field">{tx('pos.decline_reason_turn_rule')}<select aria-label={tx('pos.decline_reason')} value={declineCode} onChange={(e) => setDeclineCode(e.target.value)}><option value="">{tx('pos.not_specified')}</option>{TURN_DECLINE_REASONS.map((r) => <option key={r} value={r}>{tx(`ops.techQueue.declineReason.${r}`)}</option>)}</select></label>
                        <label className="fk-field">{tx('pos.extra_delay_minutes_optional')}<input value={delayMin} onChange={(e) => setDelayMin(e.target.value)} placeholder={tx('ops.common.egMinutes')} inputMode="numeric" /></label>
                      </div>
                      <div className="cg-acts tq-drawer-acts">
                        <button type="button" className="fk-btn primary" disabled={busyId === t.techQueueTicketId + 'reassign'} onClick={() => doReassign(t.techQueueTicketId)}>{tx('pos.reassign')}</button>
                        <button type="button" className="fk-btn ghost" disabled={busyId === t.techQueueTicketId + 'prio'} onClick={() => doPriority(t.techQueueTicketId)}>{tx('pos.update_priority')}</button>
                        <button type="button" className="fk-btn ghost" disabled={busyId === t.techQueueTicketId + 'delay'} onClick={() => doReportDelay(t.techQueueTicketId)}>{tx('pos.report_delay')}</button>
                        <button type="button" className="fk-btn ghost" disabled={busyId === t.techQueueTicketId + 'cleardelay'} onClick={() => doClearDelay(t.techQueueTicketId)}>{tx('pos.clear_delay')}</button>
                        <button type="button" className="fk-btn danger" disabled={busyId === t.techQueueTicketId + 'decline'} onClick={() => doDecline(t.techQueueTicketId)}>{tx('pos.decline')}</button>
                        <button type="button" className="fk-btn danger" disabled={busyId === t.techQueueTicketId + 'cancel'} onClick={() => doCancel(t.techQueueTicketId)}>{tx('pos.cancel_ticket')}</button>
                      </div>
                    </td></tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table></div>)) : listQ.error ? <StateBlock error={listQ.error} onRetry={listQ.reload} /> : !listQ.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : listItems.length === 0 ? <Empty title={tSearch ? tx('cg.noMatchSearch', { q: tSearch }) : live ? tx('pos.no_assigned_tickets_right_now') : tx('tq.noHistory')} />
          : <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table" data-testid="server-tickets">
            <thead><tr><th>{live ? '#' : tx('tm.col.when')}</th><th>{tx('pos.guest')}</th><th>{tx('pos.services')}</th><th>{tx('pos.technician')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.wait')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{listItems.map((t, i) => <tr key={t.id} data-testid="server-ticket-row">
              <td className="fk-muted">{live ? ((listQ.data.page ?? 1) - 1) * (listQ.data.pageSize ?? 10) + i + 1 : whenTime(t.updatedAt)}</td>
              <td><b>{t.customer ?? '—'}</b>{t.vip ? <> {chip('VIP', 'gold')}</> : null}<span className="fk-li-s">{t.phone ?? ''}{t.matchedVia ? ` · ${tx('tq.via.' + t.matchedVia)}` : ''}</span></td>
              <td>{t.services.join(', ') || '—'}{t.ticketNumber ? <span className="fk-li-s">{tx('tq.ticketNo', { n: t.ticketNumber })}{t.paid ? '' : ` · ${tx('tq.unpaid')}`}</span> : null}</td>
              <td>{t.technician ?? '—'}</td>
              <td>{chip(statusLabel('techTicket', t.status), TONE[t.status])}{t.delay ? <> {chip(codeLabel('tq.delay.' + t.delay, t.delay), 'bad')}</> : null}</td>
              <td className="num">{tx('ops.common.minutesShort', { n: String(t.waitMinutes) })}{t.waitFrozen ? <span className="fk-li-s">{tx('tq.waitFrozen')}</span> : null}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setTicketId(t.id)} data-testid="server-ticket-open">{tx('pos.details')}</button></td></tr>)}</tbody></table></div>}
        <p className="fk-hint" title={live ? tx('tq.liveRule') : tx('tq.historyRule')}>{live ? tx('tq.liveRule') : tx('tq.historyRule')}</p>
      </FitPanel>

      <div className={'mos-row cg-row ' + (live ? 'three' : 'one')}>
        {live ? <FitPanel testId="waiting-guests" title={tx('pos.d1_waiting_guests_by_skill_match')} footer={<button type="button" className="fk-link" onClick={() => nav('/queue')}>{tx('pos.view_all_waiting_guests')}</button>}>
          <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table" style={{ tableLayout: 'fixed', width: '100%' }}>{/* fixed layout (Nov 6 2026): on a busy floor the names and chips widened the table and pushed "Phân công" past the panel */}<colgroup><col style={{ width: 28 }} /><col /><col className="t-opt" style={{ width: '17%' }} /><col style={{ width: 58 }} /><col style={{ width: '20%' }} /><col style={{ width: 142 }} /></colgroup><thead><tr><th>#</th><th>{tx('pos.guest')}</th><th className="t-opt">{tx('pos.pref_tech')}</th><th className="num">{tx('pos.wait')}</th><th>{tx('pos.best_match_3')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{waiting.slice(0, 5).map((g, i) => <tr key={g.queueItemId ?? i} data-testid="waiting-row">
              <td className="fk-muted" title={tx('tq.positionTitle')}>{i + 1}</td>
              {/* §79 one-screen (Nov 6 2026): the service sits under the guest — a column of its own pushed the actions 33–86 px past the panel */}
              <td><b>{g.customerName}</b>{g.priority !== 'normal' ? <> {chip(prioLabel(g.priority), PRIO[g.priority] ?? 'mut')}</> : null}<span className="fk-li-s" title={g.serviceName}>{g.serviceName}</span></td>
              <td className="t-opt">{g.preferredTechName || tx('pos.any')}</td><td className="num">{g.waitMinutes} {tx('pos.min')}</td>
              <td>{g.bestMatchMode === 'split' && g.bestMatchTechnicianNames?.length ? g.bestMatchTechnicianNames.join(' + ') : g.bestMatchTechnicianName || '—'}</td>
              <td className="fn-acts">{g.queueItemId ? <button type="button" className="fk-btn ghost sm" style={{ width: 36, padding: 0 }} title={tx('pos.open_full_ipad_view')} aria-label={tx('pos.full_view')} onClick={() => openIPad(queueItemRequest({ queueItemId: g.queueItemId!, customerName: g.customerName, requestedServices: [{ serviceId: '', serviceName: g.serviceName }], priority: g.priority, actualWaitMinutes: g.waitMinutes, requestedTechnicianName: g.preferredTechName, bestMatchTechnicianName: g.bestMatchTechnicianName }))}><FaExpand aria-hidden="true" /></button> : null}
                <button type="button" className="fk-btn sm" disabled={!!g.queueItemId && pendingAssign === g.queueItemId} onClick={() => assignToBestMatch(g)}>{g.queueItemId && pendingAssign === g.queueItemId ? tx('pos.assigning') : tx('pos.assign')}</button></td></tr>)}
              {waiting.length === 0 ? <tr><td colSpan={6} className="fk-empty-cell">{tx('pos.no_customers_waiting')}</td></tr> : null}</tbody></table></div>
          <p className="fk-hint" title={tx('tq.fairRule')}>{tx('tq.fairRule')}</p>
        </FitPanel> : null}
        <FitPanel testId="tech-performance" title={tx('pos.d2_tech_performance_today')} footer={<button type="button" className="fk-link" onClick={() => nav('/tenant/team/performance')}>{tx('tq.teamPerformance')}</button>}>
          <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table"><thead><tr><th>#</th><th>{tx('pos.technician')}</th><th className="num">{tx('pos.services')}</th><th className="num">{tx('pos.revenue')}</th><th className="num">{tx('pos.tips')}</th><th className="num">{tx('pos.util_2')}</th><th className="num">{tx('pos.rating')}</th></tr></thead>
            <tbody>{perf.slice(0, 6).map((p, i) => { const tr = p.utilizationPercent !== undefined ? { utilizationPercent: p.utilizationPercent } : rows.find((r) => r.technicianId === p.technicianId); return (
              <tr key={p.technicianId}><td className="fk-muted">{i + 1}</td><td><button type="button" className="tq-who" onClick={() => openTech(p.technicianId)}>{avatar(p.technicianName, 24, 'technician', (p as any).avatarUrl)}<b>{p.technicianName}</b></button></td>
                <td className="num">{p.services}</td><td className="num"><b>{m2(p.revenueCents)}</b></td><td className="num">{m2(p.tipCents)}</td><td className="num">{tr?.utilizationPercent != null ? `${tr.utilizationPercent}%` : '—'}</td>
                <td className="num">{p.ratingAvg != null ? `★ ${p.ratingAvg.toFixed(1)}` : '—'}</td></tr>); })}
              {perf.length === 0 ? <tr><td colSpan={7} className="fk-empty-cell">{tx('pos.no_completed_services_yet')}</td></tr> : null}</tbody></table></div>
        </FitPanel>
        {live ? <FitPanel testId="available-technicians" title={tx('pos.d3_available_technicians')} footer={<button type="button" className="fk-link" onClick={() => nav('/technicians/schedule')}>{tx('pos.view_full_team_schedule')}</button>}>
          <div className="tq-scroll"><table className="fk-table fn-table cg-table tq-table" style={{ tableLayout: 'fixed', width: '100%' }}>{/* fixed layout (Nov 6 2026): the Vietnamese status / next labels pushed "Nhắn tin" 11 px past the panel */}<colgroup><col /><col style={{ width: 116 }} /><col style={{ width: 96 }} /><col className="t-opt" style={{ width: '22%' }} /><col style={{ width: 96 }} /></colgroup><thead><tr><th>{tx('pos.technician')}</th><th>{tx('pos.status')}</th><th>{tx('pos.next')}</th><th className="t-opt">{tx('pos.specialties')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{avail.slice(0, 5).map((t) => <tr key={t.technicianId}><td><button type="button" className="tq-who" onClick={() => openTech(t.technicianId)}>{avatar(t.technicianName, 24, 'technician', (t as any).avatarUrl)}<b>{t.technicianName}</b></button></td>
              <td>{chip(st(t.status).label, TONE[t.status])}</td><td>{nextLabel(t)}</td><td className="t-opt">{t.specialties.join(', ')}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => nav('/messages')} title={tx('ops.common.messageName', { name: t.technicianName })}>{tx('tq.message')}</button></td></tr>)}
              {avail.length === 0 ? <tr><td colSpan={5} className="fk-empty-cell">{tx('pos.no_available_technicians')}</td></tr> : null}</tbody></table></div>
          <p className="fk-hint" title={tx('tq.availRule')}>{tx('tq.availRule')}</p>
        </FitPanel> : null}
      </div>

      <div className="mos-row four cg-row tq-e">
        <FitPanel testId="e1" title={<>{tx('pos.e1_utilization_trend')} <span className="fk-muted">{tx('pos.today_7')}</span></>} actions={<span className="fk-hint">{tx('pos.avg')} {k.utilizationTodayPercent ?? 0}%</span>}
          footer={a?.throughput ? <ThroughputLine t={a.throughput} /> : undefined}>
          {(() => { const pts = a?.utilizationTrend || []; if (!pts.length) return <Empty title={tx('pos.hourly_trend_builds_through_the_day')} />; const w = 240, h = 92; const xs = (i: number) => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w); const ys = (v: number) => h - (v / 100) * (h - 8) - 4;
            const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.utilizationPercent).toFixed(1)}`).join(' ');
            return <svg viewBox={`0 0 ${w} ${h}`} className="tq-spark" role="img" aria-label={tx('pos.e1_utilization_trend')}>{[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}<path d={dd} fill="none" stroke="#A96F22" strokeWidth="2" />{pts.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.utilizationPercent)} r="2.6" fill="#A96F22"><title>{`${p.hour}:00 · ${p.utilizationPercent}%`}</title></circle>)}</svg>; })()}
        </FitPanel>
        <FitPanel testId="e2" title={tx('pos.e2_service_mix_by_technician')}>
          {(() => { const cols = a?.serviceMixByTechnician || []; const cats = a?.serviceCategories || []; if (!cols.length) return <Empty title={tx('pos.mix_builds_from_completed_services')} />; return <>
            <div className="tq-mix">{cols.slice(0, 6).map((col) => <div key={col.technicianId} className="tq-mix-c" title={col.technicianName ?? undefined}><div className="tq-mix-bar">{col.cells.map((c) => <span key={c.category} title={`${c.category} ${c.percent}% (${c.count})`} style={{ height: `${c.percent}%`, background: COLORS[cats.indexOf(c.category) % COLORS.length] }} />)}</div><span className="fk-li-s">{(col.technicianName ?? '').split(' ')[0] || '—'}</span></div>)}</div>
            <div className="tq-legend">{cats.slice(0, 6).map((c, i) => <span key={c}><i style={{ background: COLORS[i % COLORS.length] }} />{c}</span>)}</div></>; })()}
        </FitPanel>
        <FitPanel testId="e3" title={tx('pos.e3_assignment_source')}>
          {(() => { const sl = a?.assignmentSource || []; const total = a?.assignmentSourceTotal || 0; if (!total) return <Empty title={tx('pos.no_assignments_yet')} />; return <ul className="fk-list dense tq-src">{sl.map((s2, i) => <li key={s2.source} className="fk-li">
            <span className="fk-li-t"><i style={{ background: COLORS[i % COLORS.length] }} />{s2.code ? tx(`ops.techQueue.sourceMix.${s2.code}`) : statusLabel('source', s2.source)}</span><span className="tq-src-bar"><span style={{ width: `${s2.percent}%`, background: COLORS[i % COLORS.length] }} /></span><span className="num">{s2.count} ({s2.percent}%)</span></li>)}
            <li className="fk-li"><span className="fk-li-t">{tx('pos.total')}</span><b>{total}</b></li></ul>; })()}
          <p className="fk-hint" title={tx('tq.sourceRule')}>{tx('tq.sourceRule')}</p>
        </FitPanel>
        <FitPanel testId="e4" title={tx('pos.e4_top_revenue_techs')} footer={<button type="button" className="fk-link" onClick={() => nav('/tenant/reports/technicians')}>{tx('pos.view_full_report')}</button>}>
          <ol className="fk-list dense tq-top">{(a?.topRevenueTechs || []).slice(0, 5).map((t, i) => <li key={t.technicianId} className="fk-li"><span className={'tq-rank' + (i < 3 ? ' g' : '')}>{i + 1}</span>{avatar(t.technicianName, 24)}<span className="fk-li-t">{t.technicianName}</span><b>{m2(t.revenueCents)}</b></li>)}</ol>
          {(a?.topRevenueTechs || []).length === 0 ? <Empty title={tx('pos.no_revenue_yet')} /> : null}
        </FitPanel>
      </div>

      <div className="fk-panel tq-qa" data-testid="quick-actions">
        {QA.map((q) => <button key={q.l} type="button" className="tq-qa-b" onClick={q.fn}><svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="#A96F22" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={q.d} /></svg><span>{q.l}</span></button>)}
      </div>

      {techId ? <TechAssignmentDetails id={techId} row={knownTechs.find((r) => r.technicianId === techId) ?? null} waiting={waiting} onClose={() => setTechId(null)}
        onAssign={(g) => { const r = knownTechs.find((x) => x.technicianId === techId); void assignByDrop(g, techId, r?.technicianName ?? '', r?.status ?? 'available'); setTechId(null); }}
        onBreak={() => { setBreakTech(techId); setBreakTechName(knownTechs.find((x) => x.technicianId === techId)?.technicianName ?? ''); setBreakOpen(true); setTechId(null); }}
        onEndBreak={(name) => { void endBreak(techId, name); setTechId(null); }} onTicket={(id) => { setTechId(null); setTicketId(id); }} onChanged={refreshAll} /> : null}
      {ticketId ? <TicketTimeline id={ticketId} onClose={() => setTicketId(null)} /> : null}
    </div>
  );
}

const TQ_LIVE = ['assigned', 'waiting_for_acceptance', 'accepted', 'ready_to_start', 'in_service', 'paused', 'delayed'];
const TQ_TAB_KEYS = ['live', 'waiting', 'accepted', 'in_service', 'delayed', 'done_today', 'checkout_pending'];

/** Technician Assignment Details (Close / Esc): who she is, what she is doing, what is next, the actions her state allows */
function TechAssignmentDetails({ id, row, waiting, onClose, onAssign, onBreak, onEndBreak, onTicket, onChanged }: { id: string; row: TechRow | null; waiting: WaitGuest[]; onClose: () => void;
  onAssign: (g: WaitGuest) => void; onBreak: () => void; onEndBreak: (name: string) => void; onTicket: (id: string) => void; onChanged: () => void }) {
  const nav = useNavigate(); const can = useCan(); const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const d = useLoad(() => posTechQueueScreenApi.technician(id, { page, pageSize: 6 }), [id, page]);
  const x: any = d.data && typeof d.data === 'object' && 'technicianId' in d.data ? d.data : null;
  const next = x?.next?.[0] ?? null;
  const start = async () => { if (!next) return; setBusy(true); setErr(null); try { await posTechQueueApi.startService(next.id, {}); onChanged(); d.reload(); } catch (e: any) { setErr(e?.message || tx('pos.action_failed')); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={x?.name ?? row?.technicianName ?? tx('tq.details')} subtitle={x ? <>{x.role ?? ''}{x.branch ? ` · ${x.branch}` : ''} · {row ? `#${row.rotationPosition} ${tx('tq.inRotation')}` : ''}</> : undefined} onClose={onClose} testId="dlg-tech" busy={busy}
      footer={<button type="button" className="fk-btn primary" onClick={onClose} data-testid="tech-close">{tx('pos.close')}</button>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl mo-dl" data-testid="tech-summary">
          <dt>{tx('pos.status')}</dt><dd>{codeLabel('tq.q.' + String(x.queue).toLowerCase(), x.queue)} · {codeLabel('tq.clock.' + String(x.clock).toLowerCase(), x.clock)}{x.onBreak && x.breakSince ? ` · ${tx('tq.breakSince', { t: whenTime(x.breakSince) })}` : ''}</dd>
          <dt>{tx('tq.assignable')}</dt><dd data-testid="tech-assignable">{x.assignable ? tx('tq.yesNow') : tx(x.onBreak ? 'tq.noBreak' : x.current ? 'tq.noServing' : 'tq.noOff')}</dd>
          <dt>{tx('tq.current')}</dt><dd>{x.current ? <button type="button" className="fk-link" onClick={() => onTicket(x.current.id)}>{x.current.customer ?? '—'} · {x.current.services.join(', ')}{x.current.startedAt ? ` · ${tx('tq.since', { t: whenTime(x.current.startedAt) })}` : ''}</button> : tx('tm.none')}</dd>
          <dt>{tx('tq.nextUp')}</dt><dd>{x.next.length ? x.next.map((n: any, i: number) => <span key={n.id}>{i ? ' · ' : ''}<button type="button" className="fk-link" onClick={() => onTicket(n.id)}>{n.customer ?? '—'} ({statusLabel('techTicket', n.status)})</button></span>) : tx('tm.none')}</dd>
          <dt>{tx('tq.nextAppt')}</dt><dd>{x.nextAppointment ? `${hm12(x.nextAppointment.start)} · ${x.nextAppointment.customer ?? ''} · ${x.nextAppointment.services.join(', ')}` : tx('tm.none')}</dd>
          <dt>{tx('tq.qualified')}</dt><dd>{x.qualifiedCount ? x.qualifiedServices.join(', ') : tx('tq.noQualified')}</dd>
          {row ? <><dt>{tx('pos.next')}</dt><dd>{row.nextAvailableLabel}</dd></> : null}
        </dl>
        <div className="cg-acts tm-acts" data-testid="tech-actions">
          {x.assignable && waiting.length ? waiting.slice(0, 3).map((g) => <button key={g.queueItemId ?? g.customerName} type="button" className="fk-btn primary" disabled={!can('booking.manage') && !can('services.view')} onClick={() => onAssign(g)} data-testid="tech-assign">{tx('tq.assignGuest', { name: g.customerName })}</button>) : null}
          {next && ['accepted', 'ready_to_start'].includes(next.status) ? <button type="button" className="fk-btn" disabled={busy} onClick={start} data-testid="tech-start">{tx('pos.start_service')}</button> : null}
          {x.onBreak ? <button type="button" className="fk-btn" onClick={() => onEndBreak(x.name ?? '')} data-testid="tech-end-break">{tx('pos.end_break_2')}</button>
            : x.clock === 'CLOCKED_IN' && !x.current ? <button type="button" className="fk-btn ghost" onClick={onBreak} data-testid="tech-break">{tx('tq.sendOnBreak')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => nav('/messages')}>{tx('pos.message_tech')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/technicians/schedule')}>{tx('pos.view_schedule')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav(`/technicians/${encodeURIComponent(x.technicianId)}`)}>{tx('tq.profile')}</button>
        </div>
        {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
        <h3 className="fk-h3">{tx('tq.recent')}</h3>
        {x.recent.items.length === 0 ? <Empty title={tx('tq.noRecent')} /> : <table className="fk-table fn-table cg-table" data-testid="tech-recent"><thead><tr><th>{tx('tm.col.when')}</th><th>{tx('pos.guest')}</th><th>{tx('pos.services')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.wait')}</th></tr></thead>
          <tbody>{x.recent.items.map((r: any) => <tr key={r.id} className="inv2-click" onClick={() => onTicket(r.id)}><td>{whenTime(r.at)}</td><td>{r.customer ?? '—'}</td><td>{r.services.join(', ')}</td><td>{statusLabel('techTicket', r.status)}</td><td className="num">{tx('ops.common.minutesShort', { n: String(r.waitMinutes) })}</td></tr>)}</tbody></table>}
        <Pager info={pageOf(x.recent)} onPage={setPage} compact />
      </>}
    </FitDialog>
  );
}

/** a ticket's own timestamps, the queue status history (newest first) and its checkout */
function TicketTimeline({ id, onClose }: { id: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const d = useLoad(() => posTechQueueScreenApi.ticket(id), [id]);
  const x: any = d.data && typeof d.data === 'object' && 'timeline' in d.data ? d.data : null;
  return (
    <FitDialog wide title={x ? `${x.customer ?? '—'} · ${statusLabel('techTicket', x.status)}` : tx('tq.timeline')} subtitle={x ? <>{x.services.map((s: any) => s.name).join(', ')} · {x.technician ?? '—'}{x.phone ? ` · ${x.phone}` : ''}</> : undefined} onClose={onClose} testId="dlg-ticket"
      footer={<button type="button" className="fk-btn primary" onClick={onClose} data-testid="ticket-close">{tx('pos.close')}</button>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl mo-dl">
          <dt>{tx('pos.priority')}</dt><dd>{statusLabel('priority', x.priority === 'urgent' ? 'high' : x.priority)}</dd>
          <dt>{tx('tm.source')}</dt><dd>{statusLabel('source', x.source)}</dd>
          {x.delay ? <><dt>{tx('tq.delay')}</dt><dd>{codeLabel('tq.delay.' + x.delay.status, x.delay.status)}{x.delay.reason ? ` · ${x.delay.reason}` : ''}</dd></> : null}
          <dt>{tx('tq.checkout')}</dt><dd>{x.checkout ? `${tx('tq.ticketNo', { n: x.checkout.number ?? '—' })} · ${x.checkout.paidAt ? tx('tq.paidAt', { t: whenTime(x.checkout.paidAt) }) : tx('tq.unpaid')}` : tx('tm.none')}</dd>
          {x.notes ? <><dt>{tx('tq.notes')}</dt><dd>{x.notes}</dd></> : null}
        </dl>
        <h3 className="fk-h3">{tx('tq.timeline')}</h3>
        <ul className="fk-list dense" data-testid="ticket-events">{x.timeline.map((e: any) => <li key={e.kind + e.at} className="fk-li"><span className="tt-time">{whenTime(e.at)}</span><span className="fk-li-t">{codeLabel('tq.ev.' + e.kind, e.kind)}</span></li>)}</ul>
        {x.history.length ? <><h3 className="fk-h3">{tx('tq.statusHistory')}</h3><ul className="fk-list dense" data-testid="ticket-history">{x.history.map((h: any) => <li key={h.id} className="fk-li"><span className="tt-time">{whenTime(h.at)}</span>
          <span className="fk-li-t">{h.from ?? '—'} → {h.to ?? '—'}{h.toTech ? ` · ${h.fromTech ?? '—'} → ${h.toTech}` : ''}<span className="fk-li-s">{[h.action, h.reason, h.actor].filter(Boolean).join(' · ')}</span></span></li>)}</ul></> : null}
      </>}
    </FitDialog>
  );
}
