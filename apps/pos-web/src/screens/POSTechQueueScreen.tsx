import React, { useCallback, useEffect, useState } from 'react';
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
type TQAnalytics = { utilizationTrend: { hour: number; utilizationPercent: number }[]; serviceMixByTechnician: MixCol[]; serviceCategories: string[]; assignmentSource: { source: string; code?: string; count: number; percent: number }[]; assignmentSourceTotal: number; topRevenueTechs: { technicianId: string; technicianName: string; revenueCents: number }[] };
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
const inputStyle: React.CSSProperties = { height: 30, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 11.5, color: 'var(--text)' };
const tinyBtn: React.CSSProperties = { padding: '5px 8px', fontSize: 11 };

export function POSTechQueueScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<TQState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a key + vars, translated at render (a language switch re-labels it)
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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

  // 200-technician §2 (Oct 27 2026): the server pages the lanes (search / status group / page) and never sends the roster —
  // at 1,000 technicians the board used to download 1,000 lane rows, 1,000 lanes and every name on each refresh.
  const load = useCallback(() => posTechQueueApi.state({ ...(serviceFilter ? { serviceCategory: serviceFilter } : {}), lanePage, lanePageSize: TQ_LANE_PAGE_SIZE, laneSearch: laneQ || undefined, laneStatus: laneStatus || undefined, roster: 'none' })
    .then((d) => { setS(d as TQState); setError(null); })
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_tech_queue'))), [serviceFilter, lanePage, laneQ, laneStatus]);

  useEffect(() => { load(); }, [load]);
  useRealtime('tech-queue', load);

  const act = async (tid: string, fn: () => Promise<any>, kind: string, closeDrawer?: boolean) => {
    setNote(null); setBusyId(tid + kind);
    try {
      const r = await fn();
      if (kind === 'notify' && r && r.configured === false) setNote(r.disabledReason || msg('pos.notifications_are_not_configured'));
      if (closeDrawer) { setOpenId(null); setReason(''); setTechSel(''); setPrioSel(''); setDelayMin(''); }
      await load();
    } catch (e: any) { setNote(e?.message || msg('pos.action_failed')); }
    finally { setBusyId(null); }
  };

  const toggleDrawer = (t: TQRow) => {
    if (openId === t.techQueueTicketId) { setOpenId(null); return; }
    setOpenId(t.techQueueTicketId); setNote(null); setReason(''); setTechSel(''); setPrioSel(t.priority || ''); setDelayMin('');
  };
  const doReassign = (tid: string) => { if (!techSel) { setNote(msg('pos.pick_a_technician_2')); return; } if (!reason.trim()) { setNote(msg('pos.reassigning_requires_a_reason')); return; } act(tid, () => posTechQueueApi.reassignTechnician(tid, { technicianId: techSel, reason: reason.trim() }), 'reassign', true); };
  const doPriority = (tid: string) => { if (!prioSel) { setNote(msg('pos.pick_a_priority')); return; } act(tid, () => posTechQueueApi.updatePriority(tid, { priority: prioSel }), 'prio', true); };
  const doReportDelay = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.a_delay_reason_is_required')); return; } const extra = parseInt(delayMin, 10); act(tid, () => posTechQueueApi.reportDelay(tid, { reason: reason.trim(), ...(Number.isFinite(extra) && extra > 0 ? { extraMinutes: extra } : {}) }), 'delay', true); };
  const doClearDelay = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.clearing_a_delay_requires_a_note')); return; } act(tid, () => posTechQueueApi.clearDelay(tid, { note: reason.trim() }), 'cleardelay', true); };
  const doDecline = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.declining_requires_a_reason')); return; } act(tid, () => posTechQueueApi.decline(tid, { reason: reason.trim(), ...(declineCode ? { reasonCode: declineCode } : {}) }), 'decline', true); };
  const doCancel = (tid: string) => { if (!reason.trim()) { setNote(msg('pos.cancelling_requires_a_reason')); return; } act(tid, () => posTechQueueApi.cancel(tid, { reason: reason.trim() }), 'cancel', true); };

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_tech_queue')}</div></div>;
  const k = s.kpis;
  const a = s.analytics;
  const O = 'var(--aps-orange)';
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

  const ICONS: Record<string, { bg: string; fg: string; d: string }> = {
    techs: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M7 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm6 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 17a4 4 0 018 0M11 17a4 4 0 016 0' },
    avail: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0M14 8l2 2 3-3' },
    service: { bg: '#FDEFE0', fg: '#E8852B', d: 'M4 10l4 4 8-9' },
    assign: { bg: '#E8F0FB', fg: '#3C7FB6', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0M15 4l2 2-2 2' },
    clock: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v3l2 2' },
    util: { bg: '#FDEFE0', fg: '#E8852B', d: 'M4 16V8M9 16V4M14 16v-6' },
    revenue: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 3v14M7 6h5a2 2 0 010 4H8a2 2 0 000 4h5' },
    upsell: { bg: '#FBE9F1', fg: '#C2569A', d: 'M10 17S3 12 3 7.5A3.5 3.5 0 0110 5a3.5 3.5 0 017 2.5C17 12 10 17 10 17z' },
  };
  const kpis: { key: string; l: string; v: string; ico: string; downGood?: boolean }[] = [
    { key: 'active', l: tx('pos.active_technicians'), v: `${k.activeTechnicians} / ${k.scheduledTechnicians}`, ico: 'techs' },
    { key: 'available', l: tx('pos.available_now_3'), v: String(k.availableTechnicians), ico: 'avail' },
    { key: 'inProgress', l: tx('pos.services_in_progress'), v: String(k.servicesInProgress), ico: 'service' },
    { key: 'waiting', l: tx('pos.waiting_for_assignment'), v: String(k.waitingForAssignment), ico: 'assign', downGood: true },
    { key: 'avgTurn', l: tx('pos.avg_turn_time'), v: k.avgTurnTimeMinutes > 0 ? tx('pos.avgturntimeminutes_min', { avgTurnTimeMinutes: String(k.avgTurnTimeMinutes) }) : '—', ico: 'clock', downGood: true },
    { key: 'utilization', l: tx('pos.utilization_today_2'), v: `${k.utilizationTodayPercent}%`, ico: 'util' },
    { key: 'laborRevenue', l: tx('pos.labor_revenue_today'), v: m2(k.laborRevenueTodayCents), ico: 'revenue' },
    { key: 'upsell', l: tx('pos.upsell_capture'), v: `${k.upsellCapturePercent}%`, ico: 'upsell' },
  ];

  const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
    in_service: { bg: '#E9F6EC', fg: '#2E9E54', label: tx('pos.in_service_3') }, finishing_soon: { bg: '#FBF1E6', fg: '#B5821F', label: tx('pos.finishing_soon') },
    available: { bg: '#E9F6EC', fg: '#2E9E54', label: tx('pos.available') }, on_break: { bg: '#E8F0FB', fg: '#3C7FB6', label: tx('pos.break') },
    off_today: { bg: '#F1ECE2', fg: '#8A7A66', label: tx('pos.offline_4') }, scheduled_later: { bg: '#F1ECE2', fg: '#8A7A66', label: tx('pos.scheduled') },
    appointment_soon: { bg: '#FBF1E6', fg: '#B5821F', label: tx('pos.appointment_soon') }, hold: { bg: '#F3E8F5', fg: '#7A4A8C', label: tx('pos.on_hold') },
  };
  const st = (x: string) => STATUS_TONE[x] || STATUS_TONE.available;
  const PRIO_TONE: Record<string, { bg: string; fg: string }> = { high: { bg: '#FBE9E7', fg: '#C0392B' }, urgent: { bg: '#FBE9E7', fg: '#C0392B' }, medium: { bg: '#FBF1E6', fg: '#B5821F' }, normal: { bg: '#FBF1E6', fg: '#B5821F' }, low: { bg: '#E9F6EC', fg: '#2E9E54' } };
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

  const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 };
  const h2: React.CSSProperties = { font: '700 13px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
  const chip = (txt: string, tn: { bg: string; fg: string }) => <span style={{ background: tn.bg, color: tn.fg, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{txt}</span>;
  const skillChip = (txt: string, key?: string) => <span key={key || txt} style={{ background: '#F3EEE4', color: '#7A6A54', borderRadius: 5, padding: '1px 5px', fontSize: 8, fontWeight: 600 }}>{txt}</span>;
  const ghostBtn: React.CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
  const orangeBtn: React.CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
  const iconBtn = (d: string, onClick?: () => void, title?: string) => <button title={title} onClick={onClick} style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${O}`, background: 'var(--card)', color: O, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.6"><path d={d} /></svg></button>;

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
    { l: tx('pos.reassign_tech'), d: 'M5 8a3 3 0 116 0M14 12a3 3 0 11-6 0M4 6v3h3M16 14v-3h-3', fn: () => setNote(msg('pos.reassign_from_the_guest_s_row_kkw4')) },
    { l: tx('pos.start_service'), d: 'M6 4l10 6-10 6z', fn: () => nav('/serving') },
    { l: tx('pos.send_break'), d: 'M5 11h8a2 2 0 010 4H5zM13 11V7M9 4v2M11 4v2', fn: () => { setBreakOpen(true); setNote(null); } },
    { l: tx('pos.message_tech'), d: 'M4 5h12v8H8l-4 3z', fn: () => nav('/messages') },
    { l: tx('pos.view_schedule'), d: 'M4 5h12v11H4zM4 8h12M8 3v3M12 3v3', fn: () => nav('/tenant/team/members') },
    { l: tx('pos.open_team_report'), d: 'M4 16V8M9 16V4M14 16v-6', fn: () => nav('/tenant/reports/technicians') },
  ];

  return (
    <div className="techqueue-page h-full overflow-auto p-5 flex flex-col gap-[10px] bg-[var(--page)]">
        <div className=" flex flex-col lg:flex-row gap-3 justify-between ">
        <div style={{ flex: 1 }}>
          <h1 style={{ font: '700 22px/1.1 "Playfair Display",serif', margin: 0, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>{tx('pos.tech_queue')}{' '}<span style={{ width: 15, height: 15, borderRadius: 99, border: '1.4px solid var(--muted)', color: 'var(--muted)', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'serif' }}>i</span></h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{tx('pos.real_time_technician_workload_assignments_performance_1mmo')}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap ">
          <select aria-label={tx('pos.service_filter')} value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 9px', fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}><option value="">{tx('pos.all_services')}</option>{(s.filters?.serviceCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <span aria-label={tx('pos.tech_queue_date')} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 9px', fontSize: 12, background: 'var(--card)' }}>{tx('pos.today_v0', { v0: fmtMonthDay(new Date()) })}</span>
          <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 9px', fontSize: 12, background: 'var(--card)', color: O, cursor: 'pointer', fontWeight: 600 }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.8"><path d="M4 10a6 6 0 0110-4.5M16 10a6 6 0 01-10 4.5M14 3v3h-3M6 17v-3h3" /></svg>{tx('pos.auto_refresh')}</button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#2E9E54', fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: '#2E9E54' }} />{tx('pos.live')}</span>
        </div>
      </div>
      {note ? <div style={{ ...card, padding: '8px 12px', borderColor: O, fontSize: 12.5 }}>{renderMsg(note)}</div> : null}
      {planFor ? <VisitPlanPanel key={planFor.queueItemId} queueItemId={planFor.queueItemId} customerName={planFor.customerName} can={can}
        roster={knownTechs.map((r) => ({ technicianId: r.technicianId, displayName: r.technicianName }))} pickFromServer
        onChanged={() => { void load(); }} onClose={() => setPlanFor(null)} /> : null}
      {breakOpen ? (
        <div style={{ ...card, borderColor: O, padding: 12, display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} aria-label={tx('pos.send_a_technician_on_break')}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.technician')}</span>
            <TechnicianPickerButton value={breakTech} valueName={breakTechName || undefined} emptyLabel={tx('pos.select_technician')} ariaLabel={tx('pos.break_technician')} workingOnlyDefault
              onChange={(id, t) => { setBreakTech(id); setBreakTechName(t?.name || ''); }} style={{ height: 30, fontSize: 11.5 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.reason_optional')}</span>
            <input aria-label={tx('pos.break_reason')} value={breakReason} onChange={(e) => setBreakReason(e.target.value)} placeholder={tx('pos.e_g_lunch')} style={inputStyle} />
          </label>
          <button disabled={breakBusy} onClick={sendBreak} style={{ ...orangeBtn, padding: '6px 12px' }}>{breakBusy ? tx('pos.starting') : tx('pos.start_break_2')}</button>
          <button disabled={breakBusy} onClick={() => setBreakOpen(false)} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>{tx('pos.cancel')}</button>
        </div>
      ) : null}
    
      {abPreview ? (
        <div style={{ ...card, borderColor: O, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{tx('pos.auto_balance_preview')}{' '}{abPreview.summary.proposed} {tx('pos.proposed_assignment')}{enPlural(abPreview.summary.proposed === 1 ? '' : 's')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled={abBusy} onClick={applyAutoBalance} style={{ ...orangeBtn, padding: '6px 12px' }}>{abBusy ? tx('pos.applying') : tx('pos.apply_proposed', { proposed: String(abPreview.summary.proposed) })}</button>
              <button disabled={abBusy} onClick={() => setAbPreview(null)} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>{tx('pos.cancel')}</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{tx('pos.review_before_applying_nothing_is_moved_il39')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{[tx('pos.guest'), tx('pos.proposed_technician'), tx('pos.why'), tx('pos.waiting_2')].map((hh) => <th key={hh} style={{ padding: '3px 4px', fontWeight: 600, fontSize: 10, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {abPreview.proposals.map((p: any) => (
                <tr key={p.queueItemId} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px', fontWeight: 600 }}>{p.customerName}</td>
                  <td style={{ padding: '4px' }}>{p.technicianName}</td>
                  <td style={{ padding: '4px', color: 'var(--soft)' }}>{p.reason || '—'}</td>
                  <td style={{ padding: '4px', color: 'var(--soft)' }}>{p.addressesWaitMinutes} {tx('pos.min')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {abPreview.unassignable?.length ? <div style={{ fontSize: 11, color: '#B5821F', marginTop: 6 }}>{tx('ops.techQueue.unassignableLeft', { count: String(abPreview.unassignable.length) })}</div> : null}
        </div>
      ) : null}

      {/* Header */}
    

      {/* 8 KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
        {kpis.map((c) => { const tr = trend(c.key); const ic = ICONS[c.ico]; return (
          <div key={c.key} style={{ ...card, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, background: ic.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke={ic.fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ic.d} /></svg></span>
              <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600, lineHeight: 1.1 }}>{c.l}</span>
            </div>
            <div style={{ font: '700 18px/1 "Playfair Display",serif', color: 'var(--text)' }}>{c.v}</div>
            <div style={{ fontSize: 9, marginTop: 3 }}>
              {tr && (tr.text || tr.deltaPercent != null) ? (() => { const down = tr.direction === 'down'; const good = c.downGood ? down : !down; return <span style={{ color: good ? '#2E9E54' : '#C0392B', fontWeight: 700 }}>{down ? '▼' : '▲'} {tr.text || `${Math.abs(tr.deltaPercent!)}`} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_yesterday')}</span></span>; })()
                : <span style={{ color: 'var(--muted)' }} />}
            </div>
          </div>
        ); })}
      </div>

      {/* Main row: Live Tech Queue | Workload Board | AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[1.45fr_1.5fr_0.82fr] gap-[10px] items-start">
        {/* A. Live Technician Queue */}
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 8 }}>{tx('pos.a_live_technician_queue')}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <ImeSafeInput type="search" aria-label={tx('pos.find_technician')} placeholder={tx('pos.tq_search_placeholder')} value={laneSearch} onValue={setLaneSearch} style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }} />
            <select aria-label={tx('pos.tq_status_filter')} value={laneStatus} onChange={(e) => setLaneStatus(e.target.value)} style={inputStyle}>
              <option value="">{tx('pos.tq_all_statuses')}</option>
              <option value="ready">{tx('pos.tq_status_ready')}</option>
              <option value="serving">{tx('pos.tq_status_serving')}</option>
              <option value="soon">{tx('pos.appointment_soon')}</option>
              <option value="break">{tx('pos.tq_status_break')}</option>
              <option value="hold">{tx('pos.on_hold')}</option>
              <option value="off">{tx('pos.tq_status_off')}</option>
            </select>
          </div>
          <div className="w-full max-w-full min-w-0 overflow-x-auto pb-1">
            <table
              className="w-full min-w-0 max-[800px]:min-w-[650px]"
              style={{ borderCollapse: 'collapse', fontSize: 9.5 }}
            >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{['#', tx('pos.technician'), tx('pos.specialties'), tx('pos.status'), tx('pos.guests'), tx('pos.current_service'), tx('pos.next'), tx('pos.util_2'), tx('pos.tips'), tx('pos.revenue'), ''].map((hh, i) => <th key={i} style={{ padding: '3px 2px', fontWeight: 600, fontSize: 8.5, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {lanePg.items.map((r) => (
                <tr key={r.technicianId} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 2px', color: 'var(--muted)', fontWeight: 700 }}>{r.rotationPosition}</td>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{avatar(r.technicianName, 15, 'technician', (r as any).avatarUrl)}<span style={{ fontWeight: 600 }}>{r.technicianName}</span></div></td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{r.specialties.join(', ')}</td>
                  <td style={{ padding: '4px 2px' }}>{chip(st(r.status).label, st(r.status))}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)', textAlign: 'center' }}>{r.guests}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{r.currentServiceName ? `${r.currentServiceName} — ${r.currentServiceCustomer || ''}` : '—'}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{nextLabel(r)}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{r.utilizationPercent != null ? `${r.utilizationPercent}%` : '—'}</td>
                  <td style={{ padding: '4px 2px', textAlign: 'right' }}>{m2(r.tipsTodayCents)}</td>
                  <td style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>{m2(r.revenueTodayCents)}</td>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', gap: 3 }}>{iconBtn('M10 4a6 6 0 100 12 6 6 0 000-12zm0 4v4', () => nav('/tenant/team/members'), tx('pos.details'))}{iconBtn('M4 5h12v8H8l-4 3z', () => nav('/messages'), tx('ops.common.messageName', { name: r.technicianName }))}</div></td>
                </tr>
              ))}
              {(s.lanes ? s.lanes.totalAll === 0 : rows.length === 0) ? <tr><td colSpan={11} style={{ padding: 14, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_technicians_clocked_in')}</td></tr> : null}
              {(s.lanes ? s.lanes.totalAll > 0 : rows.length > 0) && lanePg.total === 0 ? <tr><td colSpan={11} style={{ padding: 14, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_technician_matches')}</td></tr> : null}
            </tbody>
            </table>
            </div>
          {lanePg.total > 0 ? (
            <div data-testid="tq-lane-pager" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--muted)' }}>{tx('pos.tq_showing_x_of_y', { shown: String(lanePg.items.length), total: String(lanePg.total) })}</span>
              {lanePg.totalPages > 1 ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button type="button" className="btn ghost" style={tinyBtn} disabled={lanePg.page <= 1} onClick={() => setLanePage(1)}>{tx('pos.first_page')}</button>
                  <button type="button" className="btn ghost" style={tinyBtn} disabled={lanePg.page <= 1} onClick={() => setLanePage(Math.max(1, lanePg.page - 1))}>{tx('pos.previous')}</button>
                  <span>{tx('pos.page_x_of_y', { page: String(lanePg.page), pages: String(lanePg.totalPages) })}</span>
                  <button type="button" className="btn ghost" style={tinyBtn} disabled={lanePg.page >= lanePg.totalPages} onClick={() => setLanePage(lanePg.page + 1)}>{tx('pos.next')}</button>
                  <button type="button" className="btn ghost" style={tinyBtn} disabled={lanePg.page >= lanePg.totalPages} onClick={() => setLanePage(lanePg.totalPages)}>{tx('pos.last_page')}</button>
                </span>
              ) : null}
            </div>
          ) : null}
          <button style={{ ...ghostBtn, border: 'none', color: O, marginTop: 6, padding: '4px 0' }} onClick={load}>{tx('pos.view_full_tech_queue')}</button>
        </section>

        {/* B. Technician Workload Board */}
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 8 }}>{tx('pos.b_technician_workload_board')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[5px]">
            {[
              { title: tx('pos.available_now_3'), bg: '#EAF5EE', count: wl.available.count, kind: 'tech', list: wl.available.items, drop: true },
              { title: tx('pos.ready_for_assignment'), bg: '#FBF1E6', count: readyGuests.length, kind: 'guest', list: readyGuests, drop: true },
              { title: tx('pos.in_progress'), bg: '#E9F1FA', count: wl.inProgress.count, kind: 'svc', list: wl.inProgress.items, drop: false },
              { title: tx('pos.finishing_soon'), bg: '#FBF1E6', count: wl.finishing.count, kind: 'svc', list: wl.finishing.items, drop: true },
              { title: tx('pos.break_offline'), bg: '#F3EEE4', count: wl.breakOffline.count, kind: 'off', list: wl.breakOffline.items, drop: false },
            ].map((col) => (
              <div key={col.title} style={{ background: col.bg, borderRadius: 9, padding: 5, minHeight: 150 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}><span style={{ fontSize: 8, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{col.title}</span><span style={{ fontSize: 9, fontWeight: 800, color: 'var(--muted)' }}>{col.count}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {col.list.slice(0, 2).map((it: any, idx: number) => {
                    const isTechTarget = col.kind === 'tech' || col.kind === 'svc';
                    const elig = isTechTarget ? dropEligibility(it.status) : { ok: false };
                    const isDropHover = dropTech === (it.technicianId) && dragGuest;
                    const isGuestPending = col.kind === 'guest' && it.queueItemId === pendingAssign;
                    // TOUCH PATH (Dell touchscreen): tap a guest to select it, then tap an eligible technician to
                    // assign — the exact same state machine and assign call the mouse drag uses. Drag still works.
                    const isArmedGuest = col.kind === 'guest' && dragGuest && (dragGuest as any).queueItemId === it.queueItemId;
                    const isArmedTarget = !!dragGuest && isTechTarget && elig.ok;
                    const tapAction = col.kind === 'guest'
                      ? () => setDragGuest((cur: any) => (cur && cur.queueItemId === it.queueItemId ? null : it))
                      : (isTechTarget && dragGuest && elig.ok ? () => { assignByDrop(dragGuest, it.technicianId, it.technicianName, it.status); setDragGuest(null); setDropTech(null); } : undefined);
                    return (
                    <div key={idx}
                      draggable={col.kind === 'guest'}
                      onClick={tapAction}
                      onDragStart={col.kind === 'guest' ? () => setDragGuest(it) : undefined}
                      onDragEnd={col.kind === 'guest' ? () => { setDragGuest(null); setDropTech(null); } : undefined}
                      onDragOver={isTechTarget && elig.ok ? (e) => { e.preventDefault(); setDropTech(it.technicianId); } : undefined}
                      onDragLeave={isTechTarget ? () => setDropTech((cur) => (cur === it.technicianId ? null : cur)) : undefined}
                      onDrop={isTechTarget && dragGuest ? (e) => { e.preventDefault(); assignByDrop(dragGuest, it.technicianId, it.technicianName, it.status); } : undefined}
                      title={isTechTarget ? (elig.ok ? tx('pos.tap_or_drop_a_guest_to_sc0l', { technicianName: String(it.technicianName) }) : '') : col.kind === 'guest' ? tx('pos.tap_to_select_then_tap_a_opd9') : undefined}
                      style={{ background: 'var(--card)', border: (isDropHover && elig.ok) || isArmedGuest ? `1.5px solid ${O}` : isArmedTarget ? `1px dashed ${O}` : '1px solid var(--line)', borderRadius: 6, padding: '4px 5px', cursor: col.kind === 'guest' ? 'pointer' : isTechTarget && elig.ok ? (dragGuest ? 'pointer' : 'copy') : 'default', opacity: isGuestPending ? 0.45 : 1, boxShadow: (isDropHover && elig.ok) || isArmedGuest ? `0 0 0 2px #F3D58C` : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>{avatar(col.kind === 'guest' ? it.customerName : it.technicianName, 12, col.kind === 'guest' ? 'customer' : 'technician', (it as any).avatarUrl)}<span style={{ fontSize: 8.5, fontWeight: 700, lineHeight: 1.05 }}>{col.kind === 'guest' ? it.customerName : it.technicianName}</span></div>
                      {col.kind === 'tech' ? <><div style={{ fontSize: 7.5, color: '#2E9E54', fontWeight: 600 }}>{tx('pos.available')}</div><div style={{ fontSize: 7.5, color: 'var(--soft)' }}>{tx('pos.no_current_guest_next_any')}</div><div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>{it.specialties.slice(0, 3).map((sp: string) => skillChip(sp, sp))}</div></> : null}
                      {col.kind === 'guest' ? <><div style={{ fontSize: 7.5, color: 'var(--soft)' }}>{tx('pos.waiting_2')}{' '}{it.waitMinutes} {tx('pos.min')}</div><div style={{ fontSize: 7.5 }}>{it.serviceName}</div></> : null}
                      {col.kind === 'svc' ? <><div style={{ fontSize: 7.5, color: 'var(--soft)' }}>{it.currentServiceName}</div><div style={{ fontSize: 7.5 }}>{it.currentServiceCustomer || ''}</div></> : null}
                      {col.kind === 'off' ? <><div style={{ fontSize: 7.5, color: it.status === 'on_break' ? '#3C7FB6' : 'var(--muted)', fontWeight: 600 }}>{st(it.status).label}</div>{it.status === 'on_break' ? <button style={{ ...ghostBtn, padding: '1px 5px', fontSize: 8, marginTop: 2 }} onClick={(e) => { e.stopPropagation(); endBreak(it.technicianId, it.technicianName); }}>{tx('pos.end_break_2')}</button> : null}</> : null}
                    </div>
                  ); })}
                  {col.drop ? <div onDragOver={dragGuest ? (e) => e.preventDefault() : undefined} style={{ border: `1px dashed ${dragGuest ? O : 'var(--gline)'}`, borderRadius: 6, padding: '6px 4px', textAlign: 'center', fontSize: 7.5, color: dragGuest ? O : 'var(--muted)' }}>{dragGuest ? tx('pos.tap_or_drop_onto_a_technician_112c') : tx('pos.tap_a_guest_then_a_technician_15cd')}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* C. AI Assignment Insights */}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><h2 style={h2}>{tx('pos.c_ai_assignment_insights')}</h2><span style={{ background: '#EFEAFA', color: '#6E59C7', borderRadius: 6, padding: '1px 6px', fontSize: 9, fontWeight: 800 }}>{tx('pos.new')}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {insights.map((ins) => { const it = insightText(ins); return (
              <div key={ins.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: ins.severity === 'warn' ? '#FBEAE8' : '#FDEFE0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}><svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke={ins.severity === 'warn' ? '#C0392B' : O} strokeWidth="1.7"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.25 }}>{it.text}</div>{it.sub ? <div style={{ fontSize: 9, color: 'var(--muted)' }}>{it.sub}</div> : null}</div>
                {ins.action ? <button style={{ ...orangeBtn, padding: '2px 7px', fontSize: 9 }} onClick={() => ins.route && nav(ins.route)}>{it.actionText}</button> : null}
              </div>
            ); })}
            {insights.length === 0 ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.no_insights_right_now')}</div> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
            <button style={{ ...orangeBtn, width: '100%', padding: '6px 0' }} disabled={abBusy} onClick={runAutoBalance}>{abBusy ? tx('pos.balancing') : tx('pos.auto_balance_queue')}</button>
            <div style={{ display: 'flex', gap: 5 }}><button style={{ ...ghostBtn, flex: 1, padding: '5px 0' }} onClick={() => nav('/queue')}>{tx('pos.view_suggestions')}</button><button style={{ ...ghostBtn, flex: 1, padding: '5px 0' }} onClick={() => nav('/messages')}>{tx('pos.send_alert')}</button></div>
          </div>
        </section>
      </div>

      {/* Assigned Tickets — supervisory management table + per-ticket Manage drawer (reassign / priority / delay /
          decline / cancel), all wired to the real tech-queue endpoints. Rows come from the live state's tickets. */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={h2}>{tx('pos.assigned_tickets')}</h2>
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)' }}>{tickets.length} {tx('pos.in_queue')}</span>
        </div>
        {tickets.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 2px' }}>{tx('pos.no_assigned_tickets_right_now')}</div> : (
          <div className="w-full max-w-full min-w-0 overflow-x-auto pb-1">
      <table
        className="min-w-[700px] w-full"
        style={{ borderCollapse: 'collapse', fontSize: 11 }}
      >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{[tx('pos.guest'), tx('pos.services'), tx('pos.technician'), tx('pos.priority'), tx('pos.status'), tx('pos.wait'), ''].map((hh) => <th key={hh} style={{ padding: '4px 4px', fontWeight: 600, fontSize: 9.5, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {tickets.map((t) => (
                <React.Fragment key={t.techQueueTicketId}>
                  <tr style={{ borderBottom: openId === t.techQueueTicketId ? 'none' : '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{avatar(t.customerName, 14, 'customer', (t as any).customerAvatarUrl || (t as any).avatarUrl)}<span>{t.customerName}</span>{t.isVip ? chip(statusLabel('priority', 'vip'), PRIO_TONE.vip || { bg: '#FBE9E7', fg: '#C0392B' }) : null}</div></td>
                    <td style={{ padding: '5px 4px', color: 'var(--soft)' }}>{svcNames(t.requestedServices) || tx('pos.servicecount_service_plural', { serviceCount: String(t.serviceCount), plural: String(t.serviceCount === 1 ? '' : 's') })}{partLabel(t) ? <div data-testid={`part-${t.techQueueTicketId}`} style={{ marginTop: 2 }}>{chip(partLabel(t)!, { bg: '#EFEAFA', fg: '#6E59C7' })}</div> : null}</td>
                    <td style={{ padding: '5px 4px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{t.assignedTechnicianName ? avatar(t.assignedTechnicianName, 14, 'technician', (t as any).assignedTechnicianAvatarUrl) : null}<span>{t.assignedTechnicianName || '—'}</span></div></td>
                    <td style={{ padding: '5px 4px' }}>{chip(prioLabel(t.priority), PRIO_TONE[t.priority] || PRIO_TONE.normal)}</td>
                    <td style={{ padding: '5px 4px' }}>{chip(statusLabel('techTicket', t.status), st(t.status))}</td>
                    <td style={{ padding: '5px 4px', color: 'var(--soft)' }}>{t.assignedWaitMinutes != null ? tx('ops.common.minutesShort', { n: String(t.assignedWaitMinutes) }) : '—'}</td>
                    <td style={{ padding: '5px 4px', textAlign: 'right' }}><button style={{ ...ghostBtn, ...tinyBtn }} onClick={() => toggleDrawer(t)}>{openId === t.techQueueTicketId ? tx('pos.close') : tx('pos.manage')}</button></td>
                  </tr>
                  {openId === t.techQueueTicketId ? (
                    <tr style={{ borderBottom: '1px solid var(--line)', background: '#FBF7EF' }}>
                      <td colSpan={7} style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, alignItems: 'end' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.reassign_to_technician')}</span>
                            <TechnicianPickerButton value={techSel} emptyLabel={tx('pos.select_technician')} ariaLabel={tx('pos.reassign_to_technician')}
                              serviceIds={t.requestedServices.map((x) => x.serviceId || '').filter(Boolean)} onChange={(id) => setTechSel(id)} style={{ height: 30, fontSize: 11.5, maxWidth: '100%' }} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.priority')}</span>
                            <select value={prioSel} onChange={(e) => setPrioSel(e.target.value)} style={inputStyle}><option value="">{tx('pos.keep_current')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{prioLabel(p)}</option>)}</select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.reason_note_required_for_reason_bearing_1ivf')}</span>
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.e_g_guest_requested_a_different_4mgh')} style={inputStyle} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.decline_reason_turn_rule')}</span>
                            <select aria-label={tx('pos.decline_reason')} value={declineCode} onChange={(e) => setDeclineCode(e.target.value)} style={inputStyle}><option value="">{tx('pos.not_specified')}</option>{TURN_DECLINE_REASONS.map((r) => <option key={r} value={r}>{statusLabel('turnReason', r)}</option>)}</select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.extra_delay_minutes_optional')}</span>
                            <input value={delayMin} onChange={(e) => setDelayMin(e.target.value)} placeholder={tx('ops.common.egMinutes')} inputMode="numeric" style={inputStyle} />
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          <button disabled={busyId === t.techQueueTicketId + 'reassign'} style={{ ...orangeBtn, ...tinyBtn }} onClick={() => doReassign(t.techQueueTicketId)}>{tx('pos.reassign')}</button>
                          <button disabled={busyId === t.techQueueTicketId + 'prio'} style={{ ...ghostBtn, ...tinyBtn }} onClick={() => doPriority(t.techQueueTicketId)}>{tx('pos.update_priority')}</button>
                          <button disabled={busyId === t.techQueueTicketId + 'delay'} style={{ ...ghostBtn, ...tinyBtn }} onClick={() => doReportDelay(t.techQueueTicketId)}>{tx('pos.report_delay')}</button>
                          <button disabled={busyId === t.techQueueTicketId + 'cleardelay'} style={{ ...ghostBtn, ...tinyBtn }} onClick={() => doClearDelay(t.techQueueTicketId)}>{tx('pos.clear_delay')}</button>
                          <button disabled={busyId === t.techQueueTicketId + 'decline'} style={{ ...ghostBtn, ...tinyBtn, borderColor: '#C0392B', color: '#C0392B' }} onClick={() => doDecline(t.techQueueTicketId)}>{tx('pos.decline')}</button>
                          <button disabled={busyId === t.techQueueTicketId + 'cancel'} style={{ ...ghostBtn, ...tinyBtn, borderColor: '#C0392B', color: '#C0392B' }} onClick={() => doCancel(t.techQueueTicketId)}>{tx('pos.cancel_ticket')}</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
            </div>
        )}
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[1.45fr_1.5fr_0.82fr] gap-[10px] items-start">
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 8 }}>{tx('pos.d1_waiting_guests_by_skill_match')}</h2>
          <div className="w-full max-w-full min-w-0 overflow-x-auto pb-1">
            <table
              className="w-full min-w-0 max-[800px]:min-w-[650px]"
              style={{ borderCollapse: 'collapse', fontSize: 10 }}
            >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{[tx('pos.guest'), tx('pos.service_3'), tx('pos.pref_tech'), tx('pos.priority'), tx('pos.wait'), tx('pos.best_match_3'), ''].map((hh) => <th key={hh} style={{ padding: '3px 2px', fontWeight: 600, fontSize: 9, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {waiting.slice(0, 5).map((g, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 2px', fontWeight: 600 }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{avatar(g.customerName, 14, 'customer', (g as any).avatarUrl || (g as any).customerAvatarUrl)}<span>{g.customerName}</span></div></td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{g.serviceName}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{g.preferredTechName || tx('pos.any')}</td>
                  <td style={{ padding: '4px 2px' }}>{chip(prioLabel(g.priority), PRIO_TONE[g.priority] || PRIO_TONE.normal)}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{g.waitMinutes} {tx('pos.min')}</td>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{g.bestMatchTechnicianName ? avatar(g.bestMatchTechnicianName, 14, 'technician', (g as any).bestMatchAvatarUrl) : null}<span style={{ color: 'var(--soft)' }}>{g.bestMatchMode === 'split' && g.bestMatchTechnicianNames?.length ? g.bestMatchTechnicianNames.join(' + ') : g.bestMatchTechnicianName || '—'}</span></div></td>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>{g.queueItemId ? <button style={ghostBtn} title={tx('pos.open_full_ipad_view')} onClick={() => openIPad(queueItemRequest({ queueItemId: g.queueItemId!, customerName: g.customerName, requestedServices: [{ serviceId: '', serviceName: g.serviceName }], priority: g.priority, actualWaitMinutes: g.waitMinutes, requestedTechnicianName: g.preferredTechName, bestMatchTechnicianName: g.bestMatchTechnicianName }))}>{tx('pos.full_view')}</button> : null}<button style={ghostBtn} disabled={!!g.queueItemId && pendingAssign === g.queueItemId} onClick={() => assignToBestMatch(g)}>{g.queueItemId && pendingAssign === g.queueItemId ? tx('pos.assigning') : tx('pos.assign')}</button></div></td>
                </tr>
              ))}
              {waiting.length === 0 ? <tr><td colSpan={7} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_customers_waiting')}</td></tr> : null}
            </tbody>
            </table>
            </div>
          <button style={{ ...ghostBtn, border: 'none', color: O, marginTop: 6, padding: '4px 0' }} onClick={() => nav('/queue')}>{tx('pos.view_all_waiting_guests')}</button>
        </section>

        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 8 }}>{tx('pos.d2_tech_performance_today')}</h2>
          <div className="w-full max-w-full min-w-0 overflow-x-auto pb-1">
            <table
              className="w-full min-w-0 max-[800px]:min-w-[650px]"
              style={{ borderCollapse: 'collapse', fontSize: 10 }}
            >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{['#', tx('pos.technician'), tx('pos.services'), tx('pos.revenue'), tx('pos.tips'), tx('pos.util_2'), tx('pos.rating')].map((hh) => <th key={hh} style={{ padding: '3px 2px', fontWeight: 600, fontSize: 9, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {perf.slice(0, 6).map((p, i) => { const tr = p.utilizationPercent !== undefined ? { utilizationPercent: p.utilizationPercent } : rows.find((r) => r.technicianId === p.technicianId); return (
                <tr key={p.technicianId} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 2px', color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{avatar(p.technicianName, 14, 'technician', (p as any).avatarUrl)}<span style={{ fontWeight: 600 }}>{p.technicianName}</span></div></td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)', textAlign: 'center' }}>{p.services}</td>
                  <td style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>{m2(p.revenueCents)}</td>
                  <td style={{ padding: '4px 2px', textAlign: 'right' }}>{m2(p.tipCents)}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{tr?.utilizationPercent != null ? `${tr.utilizationPercent}%` : '—'}</td>
                  <td style={{ padding: '4px 2px' }}>{p.ratingAvg != null ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><svg width="10" height="10" viewBox="0 0 20 20" fill={O}><path d="M10 2l2.4 5 5.6.6-4.2 3.8 1.2 5.6L10 14.8 4.99 17l1.2-5.6L2 7.6 7.6 7z" /></svg>{p.ratingAvg}</span> : '—'}</td>
                </tr>
              ); })}
              {perf.length === 0 ? <tr><td colSpan={7} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_completed_services_yet')}</td></tr> : null}
            </tbody>
            </table>
            </div>
        </section>

        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 8 }}>{tx('pos.d3_available_technicians')}</h2>
          <div className="w-full max-w-full min-w-0 overflow-x-auto pb-1">
            <table
              className="w-full min-w-0 max-[800px]:min-w-[650px]"
              style={{ borderCollapse: 'collapse', fontSize: 10 }}
            >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{[tx('pos.technician'), tx('pos.status'), tx('pos.next'), tx('pos.specialties'), ''].map((hh) => <th key={hh} style={{ padding: '3px 2px', fontWeight: 600, fontSize: 8.5, borderBottom: '1px solid var(--line)' }}>{hh}</th>)}</tr></thead>
            <tbody>
              {avail.slice(0, 4).map((t) => (
                <tr key={t.technicianId} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 2px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{avatar(t.technicianName, 22, 'technician', (t as any).avatarUrl)}<span style={{ fontWeight: 600 }}>{t.technicianName}</span></div></td>
                  <td style={{ padding: '4px 2px' }}>{chip(st(t.status).label, st(t.status))}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{nextLabel(t)}</td>
                  <td style={{ padding: '4px 2px', color: 'var(--soft)' }}>{t.specialties.join(', ')}</td>
                  <td style={{ padding: '4px 2px' }}>{iconBtn('M4 5h12v8H8l-4 3z', () => nav('/messages'), tx('ops.common.messageName', { name: t.technicianName }))}</td>
                </tr>
              ))}
              {avail.length === 0 ? <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_available_technicians')}</td></tr> : null}
            </tbody>
            </table>
            </div>
          <button style={{ ...ghostBtn, border: 'none', color: O, marginTop: 6, padding: '4px 0' }} onClick={() => nav('/tenant/team/members')}>{tx('pos.view_full_team_schedule')}</button>
        </section>
      </div>

      {/* Analytics row: E1 trend | E2 service mix | E3 source | E4 top revenue */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-[10px]">
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.e1_utilization_trend')}{' '}<span style={{ color: 'var(--muted)', fontWeight: 600 }}>{tx('pos.today_7')}</span></h2><span style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.avg')}{' '}{k.utilizationTodayPercent}%</span></div>
          {(() => { const pts = a?.utilizationTrend || []; if (!pts.length) return <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.hourly_trend_builds_through_the_day')}</div>; const w = 240, h = 92, max = 100; const xs = (i: number) => pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w; const ys = (v: number) => h - (v / max) * (h - 8) - 4; const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.utilizationPercent).toFixed(1)}`).join(' '); return (
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 100, marginTop: 4 }}>
              {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
              <path d={dd} fill="none" stroke={O} strokeWidth="2" />
              {pts.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.utilizationPercent)} r="2.2" fill={O} />)}
            </svg>
          ); })()}
        </section>
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 6 }}>{tx('pos.e2_service_mix_by_technician')}</h2>
          {(() => { const cols = a?.serviceMixByTechnician || []; const cats = a?.serviceCategories || []; const COLORS = ['#A96F22', '#7B9FD4', '#6BAF92', '#D08C8C', '#B0A0C8', '#E0A85B']; if (!cols.length) return <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.mix_builds_from_completed_services')}</div>; return (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, flex: 1 }}>
                {cols.slice(0, 6).map((col) => (
                  <div key={col.technicianId} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '70%', height: 92, display: 'flex', flexDirection: 'column-reverse', borderRadius: 3, overflow: 'hidden' }}>
                      {col.cells.map((c) => <div key={c.category} title={`${c.category} ${c.percent}%`} style={{ height: `${c.percent}%`, background: COLORS[cats.indexOf(c.category) % COLORS.length] }} />)}
                    </div>
                    <div style={{ fontSize: 7.5, color: 'var(--muted)', marginTop: 2 }}>{col.technicianName.split(' ')[0]}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 8 }}>{cats.slice(0, 6).map((c, i) => <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: COLORS[i % COLORS.length] }} />{c}</span>)}</div>
            </div>
          ); })()}
        </section>
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 6 }}>{tx('pos.e3_assignment_source')}</h2>
          {(() => { const sl = a?.assignmentSource || []; const total = a?.assignmentSourceTotal || 0; if (!total) return <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_assignments_yet')}</div>; const COLORS = ['#7B9FD4', '#6BAF92', '#E0843B', '#C89B5A']; let acc = 0; const R = 38, C = 2 * Math.PI * R; return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="92" height="92" viewBox="0 0 92 92"><g transform="rotate(-90 46 46)">{sl.map((s2, i) => { const frac = s2.count / total; const dash = frac * C; const el = <circle key={i} cx="46" cy="46" r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="13" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} />; acc += dash; return el; })}</g><text x="46" y="42" textAnchor="middle" style={{ fontSize: 8, fill: 'var(--muted)' }}>{tx('pos.total')}</text><text x="46" y="54" textAnchor="middle" style={{ fontSize: 15, fontWeight: 800, fill: 'var(--text)' }}>{total}</text></svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 9, flex: 1 }}>{sl.map((s2, i) => <span key={s2.source} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}><span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: COLORS[i % COLORS.length] }} />{s2.code ? tx(`ops.techQueue.sourceMix.${s2.code}`) : statusLabel('source', s2.source)}</span><span style={{ color: 'var(--muted)' }}>{s2.count} ({s2.percent}%)</span></span>)}</div>
            </div>
          ); })()}
        </section>
        <section style={card}>
          <h2 style={{ ...h2, marginBottom: 6 }}>{tx('pos.e4_top_revenue_techs')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(a?.topRevenueTechs || []).slice(0, 5).map((t, i) => (
              <div key={t.technicianId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                <span style={{ width: 16, height: 16, borderRadius: 99, background: i < 3 ? O : '#ECE3D5', color: i < 3 ? '#fff' : 'var(--muted)', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</span>
                {avatar(t.technicianName, 15)}
                <span style={{ flex: 1, fontWeight: 600 }}>{t.technicianName}</span>
                <span style={{ fontWeight: 700 }}>{m2(t.revenueCents)}</span>
              </div>
            ))}
            {(a?.topRevenueTechs || []).length === 0 ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.no_revenue_yet')}</div> : null}
          </div>
          <button style={{ ...ghostBtn, border: 'none', color: O, marginTop: 8, padding: '4px 0' }} onClick={() => nav('/tenant/reports/technicians')}>{tx('pos.view_full_report')}</button>
        </section>
      </div>

      {/* Quick Actions */}
      <div
        style={{ ...card, padding: '12px 10px' }}
        className="dash-qa mb-3"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-2">
          {QA.map((q) => (
            <button
              key={q.l}
              type="button"
              onClick={q.fn}
              className="group dqa flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg border border-[#e5d8c3]/70 bg-white text-center cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#fbf7ee] hover:border-[#a96f22] hover:shadow-md active:translate-y-0 active:shadow-sm"
            >
              <svg
                className="dqa-ic transition-transform duration-200 ease-out group-hover:scale-110"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke={O || 'var(--aps-orange, #a96f22)'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={q.d} />
              </svg>
              <span className="text-[11px] font-semibold text-[#2c251e] leading-tight transition-colors duration-200 group-hover:text-[#a96f22]">
                {q.l}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
