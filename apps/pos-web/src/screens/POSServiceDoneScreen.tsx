import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { useNavigate } from 'react-router-dom';
import { posServiceDoneApi, type ServiceDoneFilters } from '../api/posServiceDoneApi';
import { MembershipBadge } from './MembershipBadge';
import { MembershipRedeemPanel } from './MembershipRedeemPanel';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { floorLabel, floorInsight } from './opsStatus';
import { fmtTime, fmtMoney, displayLocale } from '../i18n/format';
// POS Service Done — the controlled completion / handoff layer between Serving and Checkout (Service Done mandate, Oct 28
// 2026). One fixed 1920×1080 screen: title · KPIs · Completed Service Queue | Service Done Board | AI Insights ·
// Technician Performance | Guest Completion Details | Ready / Finishing Technicians · analytics · Quick Actions. Every list
// scrolls inside its own panel; full lists, the manage panel, the guest detail, the service summary and the Auto Balance
// recommendation open as overlays — the page never grows (§9, §19, §24, §78, §92).
// The board is a PROJECTION of the server's canonical state (§23): stage = sent → ready → review → just, from the ticket's
// checkout / quality status; nothing here keeps its own workflow truth. Move to Checkout is the server's idempotent
// handoff (§35): a repeated or concurrent tap answers "already in Checkout". Quality decisions send the version the
// reviewer saw (§108). No action marks money paid (§101).
type Ticket = {
  ticketId: string; ticketNumber: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean; station?: string; serviceCount: number; serviceNames: string[]; addOnsLabel?: string; tipCents?: number;
  primaryTechnicianName?: string; helperTechnicianName?: string; completedAt: string; durationMinutes?: number; subtotalCents: number;
  qualityStatus: string; checkoutStatus: string; customerNotifiedAt?: string | null; status: string;
};
type SDDetail = {
  ticketId: string; ticketNumber: string;
  customer: { customerId?: string; fullName: string; phone?: string; isVip?: boolean; loyaltyPoints?: number; visitCount?: number; totalSpendCents?: number };
  services: { serviceLineId: string; serviceName: string; category?: string; technicianName?: string; priceCents: number; isAddOn?: boolean }[];
  primaryTechnician?: { technicianId: string; name: string }; helperTechnician?: { technicianId: string; name: string } | null; subtotalCents: number; tipCents?: number;
  notes?: string; customerVisibleNotes?: string; rebooking?: { label: string; window: string } | null; serviceDoneLocked?: boolean;
  qualityStatus?: string; checkoutStatus?: string; status?: string; durationMinutes?: number; completedAt?: string; version?: number;
  qualityChecklist?: Record<string, boolean>;
};
type TechPerf = { technicianId?: string; name: string; completedGuests: number; revenueCents: number; tipsCents: number; avgMinutes: number; rating: number | null };
type ReadyTech = { technicianId?: string; name: string; specialty?: string; currentLoadBusy?: number; currentLoadCap?: number; nextAvailable?: string; status: string };
type SDInsight = { id: string; text: string; sub?: string; action?: string; route?: string; severity?: 'info' | 'warn' | 'danger'; vars?: Record<string, string | number> };
type ServiceDoneState = {
  kpis: { completedServicesToday: number; ticketsReadyForReview: number; ticketsReadyForCheckout: number; qualityIssuesCount: number; reopenedServicesToday: number; averageServiceDurationMinutes: number; estimatedSalesCents: number; estimatedCommissionCents: number | null; addOnRevenueCents: number; averageTurnaroundSeconds: number; customerSatisfactionAvg: number | null; customerSatisfactionCount?: number; tipsCapturedCents: number; rebookingRatePercent: number | null; rebookingEligible?: number; completionAccuracyPercent?: number | null };
  kpiTrends?: Record<string, { deltaPercent: number | null; direction?: 'up' | 'down'; text?: string }>;
  analytics?: { completionTrend: { hour: number; count: number }[]; serviceMix: { category: string; sharePercent: number; count: number }[]; addOnMix: { label: string; sharePercent: number; count: number }[]; funnel: { completed: number; inReview: number; readyForCheckout: number; sentToFrontDesk: number }; potentialRevenue: { totalCents: number; serviceCents: number; addOnCents: number; tipsEstCents: number; taxesEstCents: number }; completionTrendDeltaPercent?: number | null; potentialRevenueDeltaPercent?: number | null };
  techPerformance?: TechPerf[];
  staff?: ReadyTech[];
  staffSummary?: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number };
  insights?: SDInsight[];
  tickets: { items: Ticket[]; pagination: { totalItems: number } };
  filters: { statuses: string[]; technicians: string[]; serviceCategories: string[]; qualityStatuses: string[]; stations: string[] };
  workflowSettings?: { requireQualityCheckBeforeCheckout?: boolean };
};
type Stage = 'just' | 'review' | 'ready' | 'sent';
type Overlay = null | { kind: 'queue' } | { kind: 'board' } | { kind: 'insights' } | { kind: 'manage'; id: string } | { kind: 'guest' } | { kind: 'summary' } | { kind: 'upsell' } | { kind: 'balance' };

const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted" style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{tx('pos.no_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
      <svg viewBox="0 0 140 140" style={{ width: 'var(--co-chart)', height: 'var(--co-chart)', flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <text x="70" y="78" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: '#4A4032' }}>{total}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>{items.slice(0, 4).map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '1px 0' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66', whiteSpace: 'nowrap' }}>{Math.round((it.count / total) * 100)}%</span></div>))}</div>
    </div>
  );
};

// Overlays are MODULE-LEVEL components (Customer Queue mandate review, Oct 28 2026): declared inside the screen, the box was
// a new component type on every render, so React remounted it on each keystroke — a reason / note field inside lost focus
// after one letter. Same look as before.
const OV_H2: CSSProperties = { font: '700 15px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
const OV_CLOSE: CSSProperties = { background: 'var(--card)', border: '1px solid var(--aps-orange)', color: 'var(--aps-orange)', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 'auto', minHeight: 44, padding: '0 16px', whiteSpace: 'nowrap' };
function OverlayBox({ title, sub, wide, children, onClose }: { title: string; sub?: string; wide?: boolean; children: ReactNode; onClose: () => void }) {
  return (
    <div className="co-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="co-card" style={wide ? undefined : { width: 'min(760px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><h2 style={OV_H2}>{title}</h2>{sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}<button style={OV_CLOSE} onClick={onClose}>{tx('pos.close')}</button></div>
        <div className="co-scroll">{children}</div>
      </div>
    </div>
  );
}

export function POSServiceDoneScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<ServiceDoneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [quality, setQuality] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [text, setText] = useState('');
  const [notesDraft, setNotesDraft] = useState({ notes: '', visible: '' });
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SDDetail | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());   // Auto Balance: the tickets the manager confirmed
  // §73–§74: Live = the real connection state; Auto Refresh is a real switch (on = live events + the safety sync refresh
  // the board in place; off = only Refresh does). Never a page reload.
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => { try { return localStorage.getItem('aps.serviceDone.autoRefresh') !== 'off'; } catch { return true; } });
  const toggleAutoRefresh = () => setAutoRefresh((v) => { try { localStorage.setItem('aps.serviceDone.autoRefresh', v ? 'off' : 'on'); } catch { /* per-viewer convenience only */ } return !v; });
  const detailFor = useRef<string | null>(null);

  const loadDetail = useCallback(async (tid: string) => {
    detailFor.current = tid;
    try { const d = await posServiceDoneApi.ticket(tid) as SDDetail; if (detailFor.current === tid) setDetail(d); } catch { /* keep prior */ }
  }, []);
  const selectTicket = useEventCallback((tid: string) => { setSelId(tid); loadDetail(tid); });

  const filters = (): ServiceDoneFilters => ({ search: search || undefined, status: status || undefined, qualityStatus: quality || undefined, serviceCategory: serviceFilter || undefined });
  const load = useCallback((f: ServiceDoneFilters) => {
    return posServiceDoneApi.state(f)
      .then((d) => { setS(d as ServiceDoneState); setError(null); })
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_service_done')));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { load(filters()); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, status, quality, serviceFilter]);   // eslint-disable-line react-hooks/exhaustive-deps -- filters() reads these
  // §76–§77: snapshot first, then live events + the silent safety sync; the open guest is reconciled too
  const refetch = () => { void load(filters()); if (selId) void loadDetail(selId); };
  useRealtime('service-done', () => (autoRefresh ? refetch() : undefined));
  // Auto-select the first completed guest so Guest Completion Details is populated on load.
  useEffect(() => { if (!selId && s?.tickets?.items?.length) selectTicket(s.tickets.items[0].ticketId); }, [s, selId, selectTicket]);

  const act = async (tid: string, fn: () => Promise<any>, kind: string, after?: (r: any) => void) => {
    setNote(null); setBusyId(tid + kind);
    try {
      const r = await fn();
      if (kind === 'notify' && r && r.configured === false) setNote(r.disabledReason || tx('pos.notifications_are_not_configured'));
      if (kind === 'send') setNote(r?.duplicate ? tx('ops.serviceDone.alreadyMoved') : tx('ops.serviceDone.moved'));
      after?.(r);
      refetch();                                   // reconcile with the server — never an optimistic move
    } catch (e: any) {
      setNote(e?.message || tx('pos.action_failed'));
    } finally { setBusyId(null); }
  };
  const sendToCheckout = (tid: string) => act(tid, () => posServiceDoneApi.sendToCheckout(tid), 'send');
  const markReady = (tid: string) => act(tid, () => posServiceDoneApi.markReadyForCheckout(tid), 'ready');
  const notifyCustomer = (tid: string) => act(tid, () => posServiceDoneApi.notifyCustomer(tid, { channel: 'sms' }), 'notify');
  const openManage = (tid: string) => { selectTicket(tid); setText(''); setOverlay({ kind: 'manage', id: tid }); };
  const doQuality = (tid: string, result: 'approved' | 'issue_found' | 'needs_review') => act(tid, () => posServiceDoneApi.qualityCheck(tid, { result, ...(text.trim() ? { note: text.trim() } : {}), ...(detail?.ticketId === tid && detail.version != null ? { expectedVersion: detail.version } : {}) }), 'qc', () => { setOverlay(null); setText(''); });
  const doReopen = (tid: string, then?: () => void) => { if (!text.trim()) { setNote(tx('pos.reopening_requires_a_reason')); return; } void act(tid, () => posServiceDoneApi.reopenService(tid, { reason: text.trim() }), 'reopen', () => { setOverlay(null); setText(''); if (selId === tid) { setSelId(null); setDetail(null); } then?.(); }); };
  const saveNotes = (tid: string) => act(tid, () => posServiceDoneApi.updateNotes(tid, { notes: notesDraft.notes, customerVisibleNotes: notesDraft.visible }), 'notes', () => setNote(tx('ops.serviceDone.notesSaved')));
  useEffect(() => { if (overlay?.kind === 'manage' && detail?.ticketId === overlay.id) setNotesDraft({ notes: detail.notes || '', visible: detail.customerVisibleNotes || '' }); }, [overlay, detail]);

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_service_done')}</div></div>;
  const k = s.kpis;
  const a = s.analytics;
  const O = 'var(--aps-orange)';
  const money2 = (c?: number) => fmtMoney(c || 0);
  const hhmm = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtTime(d); };
  const minAgo = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000)); return tx('pos.m_min_ago', { m: String(m) }); };
  const trend = (key: string) => s.kpiTrends?.[key];

  const ICONS: Record<string, { bg: string; fg: string; d: string }> = {
    done: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M4 10l4 4 8-9' },
    cart: { bg: '#FDEFE0', fg: '#E8852B', d: 'M3 5h2l2 9h9l2-6H6M8 18a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z' },
    clock: { bg: '#E8F0FB', fg: '#3C7FB6', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v3l2 2' },
    stop: { bg: '#EFEAFA', fg: '#6E59C7', d: 'M10 5a5 5 0 100 10 5 5 0 000-10zm0 0V3m-2 0h4' },
    tag: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M4 4h6l6 6-6 6-6-6zM7 7h.01' },
    tip: { bg: '#FDEFE0', fg: '#E8852B', d: 'M3 8h14v3H3zm1 3h12v6H4zM10 8v9' },
    rebook: { bg: '#E8F0FB', fg: '#3C7FB6', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0' },
    star: { bg: '#EFEAFA', fg: '#6E59C7', d: 'M10 3l2 5 5 .4-4 3.3 1.3 5L10 14l-4.3 2.7L7 11.7l-4-3.3 5-.4z' },
    target: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3a3 3 0 100 6 3 3 0 000-6zm0 2.5a.5.5 0 100 1 .5.5 0 000-1z' },
  };
  // §16 / §55 / §57 / §59: every KPI is the server's definition; "no data" is shown as "—" + "Not enough data", never as 0 % / 100 %
  const NED = tx('ops.serviceDone.notEnoughData');
  const sat = k.customerSatisfactionAvg;
  const acc = k.completionAccuracyPercent ?? null;
  const kpis: { key: string; l: string; v: string; ico: string; note?: string; noTrend?: boolean }[] = [
    { key: 'completed', l: tx('pos.completed_services_today'), v: String(k.completedServicesToday), ico: 'done' },
    { key: 'ready', l: tx('pos.ready_for_checkout'), v: String(k.ticketsReadyForCheckout), ico: 'cart' },
    { key: 'duration', l: tx('pos.avg_service_duration'), v: k.averageServiceDurationMinutes > 0 ? tx('pos.averageservicedurationminutes_min', { averageServiceDurationMinutes: String(k.averageServiceDurationMinutes) }) : '—', ico: 'clock', note: k.averageServiceDurationMinutes > 0 ? undefined : NED, noTrend: !(k.averageServiceDurationMinutes > 0) },
    { key: 'turnaround', l: tx('pos.avg_turnaround_to_checkout'), v: k.averageTurnaroundSeconds > 0 ? tx('pos.v0_min', { v0: String(Math.round(k.averageTurnaroundSeconds / 60)) }) : '—', ico: 'stop', note: k.averageTurnaroundSeconds > 0 ? undefined : NED, noTrend: !(k.averageTurnaroundSeconds > 0) },
    { key: 'addon', l: tx('pos.add_on_revenue_today'), v: money2(k.addOnRevenueCents), ico: 'tag' },
    { key: 'tips', l: tx('pos.tips_captured'), v: money2(k.tipsCapturedCents), ico: 'tip' },
    { key: 'rebooking', l: tx('pos.rebooking_rate'), v: k.rebookingRatePercent == null ? '—' : `${k.rebookingRatePercent}%`, ico: 'rebook', note: k.rebookingRatePercent == null ? NED : undefined, noTrend: k.rebookingRatePercent == null },
    { key: 'satisfaction', l: tx('pos.customer_satisfaction'), v: sat == null || !(sat > 0) ? '—' : `${sat.toFixed(1)} / 5`, ico: 'star', note: sat == null || !(sat > 0) ? NED : undefined, noTrend: sat == null || !(sat > 0) },
    { key: 'accuracy', l: tx('pos.completion_accuracy'), v: acc == null ? '—' : `${acc}%`, ico: 'target', note: acc == null ? NED : undefined, noTrend: acc == null },
  ];

  const items = s.tickets.items;
  // §23: the board is a projection of the canonical state (server fields), never its own workflow
  const stageOf = (t: Ticket): Stage => {
    if (t.status === 'sent_to_checkout' || t.checkoutStatus === 'sent_to_checkout') return 'sent';
    if (t.checkoutStatus === 'ready_for_checkout') return 'ready';
    if (t.qualityStatus === 'needs_review' || t.qualityStatus === 'issue_found') return 'review';
    return 'just';
  };
  const board: Record<Stage, Ticket[]> = { just: [], review: [], ready: [], sent: [] };
  for (const t of items) board[stageOf(t)].push(t);
  const COLS: { key: Stage; title: string; bg: string }[] = [
    { key: 'just', title: tx('pos.just_finished'), bg: '#FBF6EC' }, { key: 'review', title: tx('pos.guest_review_confirm'), bg: '#F3EEFB' },
    { key: 'ready', title: tx('pos.ready_for_checkout'), bg: '#EAF5EE' }, { key: 'sent', title: tx('pos.sent_to_front_desk'), bg: '#E9F1FA' },
  ];
  const selStage = items.find((t) => t.ticketId === selId); const selStageKey = selStage ? stageOf(selStage) : null;

  const Q_TONE: Record<string, { bg: string; fg: string; label: string }> = {
    ready: { bg: '#E9F6EC', fg: '#1F7A3F', label: tx('pos.ready') },
    review: { bg: '#FFF4E0', fg: '#8C5A00', label: tx('pos.review') }, needs_review: { bg: '#FFF4E0', fg: '#8C5A00', label: tx('pos.review') }, pending: { bg: '#FFF4E0', fg: '#8C5A00', label: tx('pos.review') },
    approved: { bg: '#E9F6EC', fg: '#1F7A3F', label: tx('pos.approve') },
    sent_to_checkout: { bg: '#EFEAFA', fg: '#553FB0', label: tx('pos.sent_to_checkout') }, issue_found: { bg: '#FBEAE8', fg: '#A8321F', label: tx('ops.serviceDone.issueFound') },
  };
  const qStatus = (t: Ticket) => stageOf(t) === 'sent' ? Q_TONE.sent_to_checkout : t.checkoutStatus === 'ready_for_checkout' ? Q_TONE.ready : (Q_TONE[t.qualityStatus] || Q_TONE.pending);
  // the salon's rule (wave 4: ignored here, so "Ready" posted and got 400 "Quality must be approved…")
  const qcBlocks = (t: Ticket) => s?.workflowSettings?.requireQualityCheckBeforeCheckout === true && t.qualityStatus !== 'approved';
  const qAction = (t: Ticket): 'open' | 'review' | 'send' => stageOf(t) === 'sent' ? 'open' : t.qualityStatus !== 'approved' ? 'review' : 'send';
  const qActionLabel = (t: Ticket) => ({ open: tx('pos.open'), review: tx('pos.review'), send: tx('pos.send') })[qAction(t)];

  const allInsights = s.insights || [];
  const insights = allInsights.slice(0, 5);   // §65: the 3–5 highest-priority; View All for the rest
  const techPerf = s.techPerformance || [];
  const staff = (s.staff || []).slice(0, 8);   // §44: never 200 cards
  const sum = s.staffSummary;
  const STAFF_TONE: Record<string, { bg: string; fg: string }> = { Available: { bg: '#E9F6EC', fg: '#1F7A3F' }, 'Finishing Soon': { bg: '#FFF4E0', fg: '#8C5A00' }, Busy: { bg: '#FBE9E7', fg: '#A8321F' }, Break: { bg: '#E8F0FB', fg: '#2F6699' } };
  const serviceMix = a?.serviceMix || [];
  const addOnMix = a?.addOnMix || [];
  const trendPts = a?.completionTrend || [];
  const funnel = a?.funnel || { completed: 0, inReview: 0, readyForCheckout: 0, sentToFrontDesk: 0 };
  const pot = a?.potentialRevenue || { totalCents: 0, serviceCents: 0, addOnCents: 0, tipsEstCents: 0, taxesEstCents: 0 };
  const cust = detail?.customer;
  const svcLines = (detail?.services || []).filter((l) => !l.isAddOn);
  const addLines = (detail?.services || []).filter((l) => l.isAddOn);
  const selTicket = items.find((t) => t.ticketId === selId) || null;
  // Auto Balance (§67): a RECOMMENDATION — approved guests not yet at the front desk, oldest first; a manager confirms each
  const balanceCandidates = items.filter((t) => t.qualityStatus === 'approved' && stageOf(t) !== 'sent').sort((x, y) => Date.parse(x.completedAt) - Date.parse(y.completedAt));
  const runBalance = async () => {
    const ids = balanceCandidates.filter((t) => pick.has(t.ticketId)).map((t) => t.ticketId);
    let moved = 0, already = 0, refused = 0;
    setBusyId('balance');
    for (const id of ids) { try { const r: any = await posServiceDoneApi.sendToCheckout(id); if (r?.duplicate) already++; else moved++; } catch { refused++; } }   // each through the same server handoff + gates
    setBusyId(null); setOverlay(null); setPick(new Set());
    setNote(tx('ops.serviceDone.balanceResult', { moved: String(moved), already: String(already), refused: String(refused) }));
    refetch();
  };
  const insightAct = (ins: SDInsight) => {
    if (ins.id === 'delayed') { setPick(new Set(balanceCandidates.map((t) => t.ticketId))); setOverlay({ kind: 'balance' }); return; }
    if (ins.id === 'quality') { setQuality('issue_found'); return; }
    if (ins.id === 'vip') { const v = items.find((t) => t.customerName === String(ins.vars?.name ?? '')); const q = new URLSearchParams(); q.set('q', String(ins.vars?.name ?? '')); if (v?.customerId) q.set('customerId', v.customerId); nav('/customers?' + q.toString()); return; }
    if (ins.route && ins.route !== '/service-done') nav(ins.route);
  };

  const h2: CSSProperties = { font: '700 13px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const chip = (txt: string, tone: { bg: string; fg: string }) => <span style={{ background: tone.bg, color: tone.fg, borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{txt}</span>;
  const ghostBtn: CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 9, padding: '0 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 32 };
  const orangeBtn: CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 9, padding: '0 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', minHeight: 40 };
  const linkBtn: CSSProperties = { ...ghostBtn, border: 'none', padding: '0 2px', minHeight: 30, background: 'transparent' };
  const off: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
  const avatar = (name: string, size = 20) => <span style={{ width: size, height: size, borderRadius: 99, background: '#ECE3D5', color: 'var(--g7)', fontSize: size * 0.4, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>;
  const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E9E54', RECONNECTING: '#B5821F', DEGRADED: '#B5821F', OFFLINE: '#C0392B' };
  const sel = (v: string, on: (x: string) => void, label: string, opts: ReactNode) => <select aria-label={label} value={v} onChange={(e) => on(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 8px', fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}>{opts}</select>;
  const ctxOff = !selId;   // §80: contextual actions are off with no guest selected

  // §79: the Quick Actions — every one does its job (Add Upsell / View Receipt used to show a note and nothing else)
  const QA: { l: string; d: string; fn: () => void; needsGuest: boolean }[] = [
    { l: tx('pos.move_to_checkout'), d: 'M3 5h2l2 9h9l2-6H6M8 18a1 1 0 100-2 1 1 0 000 2z', fn: () => selId && sendToCheckout(selId), needsGuest: true },
    { l: tx('pos.open_guest'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0', fn: () => { if (selId) { void loadDetail(selId); setOverlay({ kind: 'guest' }); } }, needsGuest: true },
    { l: tx('pos.add_upsell'), d: 'M10 4v12M4 10h12', fn: () => { setText(''); setOverlay({ kind: 'upsell' }); }, needsGuest: true },
    { l: tx('pos.send_update'), d: 'M3 5l8 6 8-6M3 5h16v10H3z', fn: () => selId && notifyCustomer(selId), needsGuest: true },
    { l: tx('pos.view_receipt'), d: 'M5 3h10v15l-2.5-1.5L10 18l-2.5-1.5L5 18zM7 7h6M7 10h6', fn: () => { if (selId) { void loadDetail(selId); setOverlay({ kind: 'summary' }); } }, needsGuest: true },
    // §81: Open Customer keeps the context — the Customers list opens filtered to this guest with their profile
    { l: tx('pos.open_customer'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0', fn: () => { const q = new URLSearchParams(); if (cust?.fullName) q.set('q', cust.fullName); if (cust?.customerId) q.set('customerId', cust.customerId); nav('/customers' + (q.toString() ? '?' + q.toString() : '')); }, needsGuest: true },
    { l: tx('pos.view_reports'), d: 'M4 16V8M9 16V4M14 16v-6', fn: () => nav('/reports'), needsGuest: false },
  ];

  // fixed table layout: the actions column always fits; guest / service truncate (§94). The status column steps aside on
  // narrower screens (the board shows the stage and the row's action names the next step).
  const queueTable = (rows: Ticket[], inOverlay = false) => (
    <table className="co-tbl sd-qtbl" style={{ tableLayout: 'fixed' }}>
      <colgroup><col /><col style={{ width: '24%' }} /><col style={{ width: 66 }} /><col className="sd-q-status" style={{ width: 74 }} /><col style={{ width: 128 }} /></colgroup>{/* actions 128 px (Nov 6 2026): the two Vietnamese labels ran 7–10 px past the card at 116 */}
      <thead><tr>{[tx('pos.guest'), tx('pos.service_3'), tx('pos.total'), tx('pos.status'), ''].map((hh, i) => <th key={i} className={i === 3 ? 'sd-q-status' : undefined} style={{ textAlign: i === 2 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((t) => { const isSel = t.ticketId === selId; const tn = qStatus(t); return (
          <tr key={t.ticketId} className="co-row" onClick={() => { selectTicket(t.ticketId); if (inOverlay) setOverlay(null); }} style={{ background: isSel ? '#FCF3E4' : 'transparent' }}>
            {/* §18 / §94: one compact two-line row — guest over completion time · technician; services over add-ons; total over tip */}
            <td style={{ maxWidth: 'none', lineHeight: 1.2 }} title={`${t.customerName} · ${[t.primaryTechnicianName, t.helperTechnicianName].filter(Boolean).join(' + ')}`}><div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(t.customerName, 16)}<span style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.customerName}</span></div><div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 20 }}>{hhmm(t.completedAt)} · {t.primaryTechnicianName || '—'}{t.helperTechnicianName ? ' +1' : ''}</div></td>
            {/* §18 / §94: services with the add-ons beneath, the tip beneath the total — one compact row, truncated, full text on hover / in Open Guest */}
            <td style={{ color: 'var(--soft)', maxWidth: 'none', lineHeight: 1.2 }} title={[t.serviceNames.join(', '), t.addOnsLabel].filter(Boolean).join(' + ')}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.serviceNames.join(', ') || '—'}</div>{t.addOnsLabel ? <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>+ {t.addOnsLabel}</div> : null}</td>
            <td style={{ textAlign: 'right', lineHeight: 1.2 }}><div style={{ fontWeight: 700 }}>{money2(t.subtotalCents)}</div>{t.tipCents ? <div style={{ fontSize: 10, color: '#1F7A3F' }}>+{money2(t.tipCents)}</div> : null}</td>
            <td className="sd-q-status">{chip(tn.label, tn)}</td>
            <td style={{ maxWidth: 'none', paddingRight: 0 }}><div className="co-actions" style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
              {/* two actions per row (§18 compact): the stage's next step, then Manage. Just Finished / Review → Ready (gated by
                  the salon's quality rule, with the reason) · Ready → Send · Sent → Open */}
              {stageOf(t) === 'just' || stageOf(t) === 'review'
                ? <button style={{ ...ghostBtn, ...(qcBlocks(t) ? off : {}) }} disabled={busyId === t.ticketId + 'ready' || qcBlocks(t)} title={qcBlocks(t) ? tx('pos.approve_the_quality_check_first_manage_r1vs') : undefined} onClick={(e) => { e.stopPropagation(); markReady(t.ticketId); }}>{tx('pos.ready')}</button>
                : <button style={ghostBtn} disabled={busyId === t.ticketId + 'send'} onClick={(e) => { e.stopPropagation(); if (qAction(t) === 'send') sendToCheckout(t.ticketId); else { selectTicket(t.ticketId); if (inOverlay) setOverlay(null); } }}>{qActionLabel(t)}</button>}
              <button style={{ ...ghostBtn, borderColor: 'var(--line)' }} onClick={(e) => { e.stopPropagation(); openManage(t.ticketId); }}>{tx('pos.manage')}</button>
            </div></td>
          </tr>
        ); })}
        {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_completed_services_yet')}</td></tr> : null}
      </tbody>
    </table>
  );
  const boardCard = (t: Ticket) => (
    <div key={t.ticketId} className="sd-card" onClick={() => selectTicket(t.ticketId)} style={t.ticketId === selId ? { borderColor: O, boxShadow: `0 0 0 1px ${O}` } : undefined} title={`${t.customerName} · ${t.serviceNames.join(', ')}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(t.customerName, 16)}<span className="nm">{t.customerName}</span>{t.qualityStatus === 'issue_found' ? <span style={{ marginLeft: 'auto', color: '#A8321F', fontSize: 10, fontWeight: 800 }}>!</span> : null}</div>
      <div className="sub">{t.serviceNames.join(', ') || '—'} · {t.primaryTechnicianName || '—'}</div>
      <div className="sub" style={{ color: 'var(--muted)' }}>{minAgo(t.completedAt)}{t.addOnsLabel ? ` · ${t.addOnsLabel}` : ''}</div>
    </div>
  );
  const closeOverlay = () => setOverlay(null);
  const linesList = (d: SDDetail) => (
    <table className="co-tbl"><thead><tr>{[tx('pos.service_3'), tx('ops.serviceDone.lineTech'), tx('pos.total')].map((hh, i) => <th key={hh} style={{ textAlign: i === 2 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
      <tbody>{d.services.map((l) => <tr key={l.serviceLineId}><td style={{ fontWeight: 600, maxWidth: 260 }}>{l.serviceName}{l.isAddOn ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {tx('pos.add_ons_2')}</span> : null}</td><td>{l.technicianName || '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money2(l.priceCents)}</td></tr>)}</tbody></table>
  );

  return (
    <div className="service-done-page" data-testid="service-done-page">
      {/* §12 / §78: notes float over the board — they never push the layout */}
      {note ? <div role="status" className="co-toast"><span data-testid="service-done-note" style={{ flex: 1 }}>{note}</span><button aria-label={tx('pos.close')} onClick={() => setNote(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', minWidth: 32, minHeight: 32 }}>×</button></div> : null}

      {/* Title + search / filters / live — one row (§69) */}
      <div className="co-title">
        <h1>{tx('pos.service_done')}</h1>
        <div className="co-sub">{tx('pos.completed_service_handoff_guest_confirmation_review_13o1')}</div>
        <div className="co-filters">
          <ImeSafeInput aria-label={tx('pos.search_completed')} value={search} onValue={setSearch} placeholder={tx('pos.search_guest_tech')} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', width: 160 }} />
          {sel(serviceFilter, setServiceFilter, tx('pos.service_filter'), <><option value="">{tx('pos.all_services')}</option>{(s.filters?.serviceCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}</>)}
          {sel(quality, setQuality, tx('pos.quality_filter'), <><option value="">{tx('pos.all_quality')}</option>{(s.filters?.qualityStatuses || []).map((q) => <option key={q} value={q}>{statusLabel('quality', q)}</option>)}</>)}
          {sel(status, setStatus, tx('pos.status'), <><option value="">{tx('pos.completed_2')}</option><option value="ready_for_checkout">{tx('pos.ready_for_checkout')}</option><option value="sent_to_checkout">{tx('pos.sent_to_front_desk')}</option><option value="reopened">{tx('pos.reopened_2')}</option></>)}
          <span data-testid="service-done-live" data-live={live} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: LIVE_TONE[live], fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 99, background: LIVE_TONE[live] }} />{tx(`payment.board.live.${live}`)}</span>
          <button aria-pressed={autoRefresh} data-testid="service-done-auto-refresh" title={tx('payment.board.autoRefreshHint')} onClick={toggleAutoRefresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${autoRefresh ? O : 'var(--line)'}`, borderRadius: 9, padding: '0 10px', fontSize: 12, background: autoRefresh ? '#FCF3E4' : 'var(--card)', color: autoRefresh ? O : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}><span aria-hidden style={{ width: 26, height: 14, borderRadius: 99, background: autoRefresh ? O : '#D8CFC2', position: 'relative', flex: 'none' }}><span style={{ position: 'absolute', top: 2, left: autoRefresh ? 14 : 2, width: 10, height: 10, borderRadius: 99, background: '#fff' }} /></span>{tx('pos.auto_refresh')}</button>
          <button aria-label={tx('pos.refresh')} title={tx('pos.refresh')} onClick={refetch} style={{ border: '1px solid var(--line)', borderRadius: 9, width: 38, background: 'var(--card)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.8"><path d="M4 10a6 6 0 0110-4.5M16 10a6 6 0 01-10 4.5M14 3v3h-3M6 17v-3h3" /></svg></button>
        </div>
      </div>

      {/* 9 KPIs (§15–§17) */}
      <div className="co-kpis" data-module-id="service-done-kpis">
        {kpis.map((c) => { const tr = c.noTrend ? undefined : trend(c.key); const ic = ICONS[c.ico]; return (
          <div key={c.key} className="co-card co-kpi">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: ic.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ic.fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ic.d} /></svg></span>
              <span className="co-kpi-l">{c.l}</span>
            </div>
            <div className="co-kpi-v">{c.v}</div>
            <div className="co-kpi-n">
              {tr && (tr.text || tr.deltaPercent != null) ? (() => { const down = tr.direction === 'down'; const good = c.key === 'duration' || c.key === 'turnaround' ? down : !down; return <span style={{ color: good ? '#1F7A3F' : '#A8321F', fontWeight: 700 }}>{down ? '▼' : '▲'} {tr.text || `${Math.abs(tr.deltaPercent!)}%`} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_yesterday')}</span></span>; })() : <span style={{ color: 'var(--muted)' }}>{c.note || ' '}</span>}
            </div>
          </div>
        ); })}
      </div>

      <div className="sd-main">
        {/* Completed Service Queue — fixed panel, internal scroll (§18–§21) */}
        <section className="co-card co-panel" data-testid="sd-queue">
          <div className="co-head"><h2 style={h2}>{tx('pos.completed_service_queue')}</h2><span style={{ background: '#FDEFE0', color: '#8C5A00', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>{s.tickets.pagination?.totalItems ?? items.length}</span></div>
          <div className="co-scroll">{queueTable(items)}</div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOverlay({ kind: 'queue' })}>{tx('pos.view_full_completed_queue')}</button>
        </section>

        {/* Service Done Board — fixed columns, counts, internal lists (§22–§24) */}
        <section className="co-card co-panel" data-testid="sd-board">
          <div className="co-head"><h2 style={h2}>{tx('pos.service_done_board')}</h2></div>
          <div className="sd-board">
            {COLS.map((col) => (
              <div key={col.key} className="sd-col" data-stage={col.key} style={{ background: col.bg, outline: selStageKey === col.key ? `2px solid ${O}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flex: 'none' }}><span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.title}</span><span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--soft)' }}>{board[col.key].length}</span></div>
                <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{board[col.key].map(boardCard)}</div>
              </div>
            ))}
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOverlay({ kind: 'board' })}>{tx('pos.view_full_board')}</button>
        </section>

        {/* AI Service Done Insights — advisory, 3–5 (§65–§67) */}
        <section className="co-card co-panel" data-testid="sd-insights">
          <div className="co-head"><h2 style={h2}>{tx('pos.ai_service_done_insights')}</h2><span style={{ background: '#EFEAFA', color: '#553FB0', borderRadius: 6, padding: '1px 7px', fontSize: 9.5, fontWeight: 800 }}>{tx('pos.new')}</span>{allInsights.length > 5 ? <button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setOverlay({ kind: 'insights' })}>{tx('ops.serviceDone.viewAll', { count: String(allInsights.length) })}</button> : null}</div>
          <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insights.map((raw) => { const ins = { ...raw, ...floorInsight('serviceDone', raw) }; const actionable = raw.id === 'delayed' || raw.id === 'quality' || raw.id === 'vip' || (raw.route && raw.route !== '/service-done'); return (
              <div key={ins.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: ins.severity === 'warn' || ins.severity === 'danger' ? '#FBEAE8' : '#FDEFE0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ins.severity === 'warn' || ins.severity === 'danger' ? '#C0392B' : O} strokeWidth="1.7"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg></span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, color: 'var(--text)' }}>{ins.text}</div>{ins.sub ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{ins.sub}</div> : null}</div>
                {ins.actionText && actionable ? <button style={ghostBtn} onClick={() => insightAct(raw)}>{ins.actionText}</button> : null}
              </div>
            ); })}
            {insights.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_insights_right_now')}</div> : null}
          </div>
          {/* §67: recommendation first — opens the list of approved guests; nothing moves until a person confirms */}
          <button style={{ ...orangeBtn, marginTop: 6, flex: 'none' }} data-testid="sd-auto-balance" onClick={() => { setPick(new Set(balanceCandidates.map((t) => t.ticketId))); setOverlay({ kind: 'balance' }); }}>{tx('pos.auto_balance_handoff')}</button>
        </section>

        {/* Technician Completion Performance — operational only, never pay (§45–§46) */}
        <section className="co-card co-panel" data-testid="sd-tech-perf">
          <div className="co-head"><h2 style={h2}>{tx('pos.technician_completion_performance')}</h2></div>
          <div className="co-scroll">
            <table className="co-tbl">
              <thead><tr>{[tx('pos.technician'), tx('pos.guests'), tx('pos.revenue'), tx('pos.tips'), tx('pos.avg_2'), tx('pos.rating')].map((hh, i) => <th key={hh} style={{ textAlign: i >= 1 && i <= 4 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
              <tbody>
                {techPerf.map((p, i) => (
                  <tr key={p.technicianId || i}>
                    <td style={{ maxWidth: 130 }} title={p.name}><div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>{avatar(p.name, 18)}<span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span></div></td>
                    <td style={{ textAlign: 'right' }}>{p.completedGuests}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money2(p.revenueCents)}</td>
                    <td style={{ textAlign: 'right', color: '#1F7A3F' }}>{money2(p.tipsCents)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--soft)' }}>{p.avgMinutes ? tx('pos.avgminutes_min', { avgMinutes: String(p.avgMinutes) }) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.rating != null ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.rating.toFixed(1)} <span style={{ color: '#B5821F' }}>★</span></span> : '—'}</td>
                  </tr>
                ))}
                {techPerf.length === 0 ? <tr><td colSpan={6} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_completions_yet_today')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => nav('/tenant/reports/technicians')}>{tx('pos.view_full_performance')}</button>
        </section>

        {/* Guest Completion Details — fixed panel; the full detail opens as an overlay (§47–§48) */}
        <section className="co-card co-panel" data-testid="sd-guest">
          <div className="co-head"><h2 style={h2}>{tx('pos.guest_completion_details')}</h2>{detail ? <span style={{ marginLeft: 'auto' }}>{chip(statusLabel('quality', detail.qualityStatus || 'pending'), Q_TONE[detail.qualityStatus || 'pending'] || Q_TONE.pending)}</span> : null}</div>
          {!detail ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{tx('pos.select_a_guest_from_the_queue_dwl9')}</div> : (
            <>
              <div className="co-scroll">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {avatar(cust?.fullName || '?', 32)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cust?.fullName}>{cust?.fullName}</span>{cust?.isVip ? chip('VIP', { bg: '#FBE9E7', fg: '#A8321F' }) : null}{cust?.customerId ? <MembershipBadge customerId={cust.customerId} compact /> : null}{detail?.serviceDoneLocked ? <span title={tx('pos.service_composition_is_locked_at_service_to3n')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 800, color: '#8C5A00', background: '#A96F221A', borderRadius: 999, padding: '1px 8px' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8C5A00" strokeWidth="2.4"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>{tx('pos.locked_2')}</span> : null}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{detail.ticketNumber} · {cust?.phone || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 10.5, textAlign: 'right', flex: 'none' }}>
                    <div><div style={{ color: 'var(--muted)' }}>{tx('pos.loyalty')}</div><b>{cust?.loyaltyPoints != null ? tx('pos.v0_pts_3', { v0: String(cust.loyaltyPoints.toLocaleString(displayLocale())) }) : '—'}</b></div>
                    <div><div style={{ color: 'var(--muted)' }}>{tx('pos.visits')}</div><b>{cust?.visitCount ?? '—'}</b></div>
                    <div><div style={{ color: 'var(--muted)' }}>{tx('pos.total_spend')}</div><b>{cust?.totalSpendCents != null ? money2(cust.totalSpendCents) : '—'}</b></div>
                  </div>
                </div>
                <div style={{ background: 'var(--page)', borderRadius: 9, padding: 7, display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.9fr', gap: 8, fontSize: 11 }}>
                  <div style={{ minWidth: 0 }}><div style={{ color: 'var(--muted)', fontSize: 10 }}>{tx('pos.current_service')}</div><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcLines.map((l) => l.serviceName).join(', ') || '—'}</b><div style={{ color: 'var(--soft)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx('pos.by')}{' '}{[...new Set(svcLines.map((l) => l.technicianName).filter(Boolean))].join(', ') || detail.primaryTechnician?.name || '—'}</div><div style={{ fontWeight: 700 }}>{money2(svcLines.reduce((acc2, l) => acc2 + l.priceCents, 0))}</div></div>
                  <div style={{ minWidth: 0 }}><div style={{ color: 'var(--muted)', fontSize: 10 }}>{tx('pos.add_ons_2')}</div><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addLines.map((l) => l.serviceName).join(', ') || '—'}</b><div style={{ fontWeight: 700 }}>{money2(addLines.reduce((acc2, l) => acc2 + l.priceCents, 0))}</div></div>
                  <div><div style={{ color: 'var(--muted)', fontSize: 10 }}>{tx('pos.est_total')}</div><div style={{ font: '700 17px/1 "Playfair Display",serif', color: '#8C5A00' }}>{money2(detail.subtotalCents)}</div>{detail.tipCents ? <div style={{ fontSize: 10, color: 'var(--muted)' }}>+ {money2(detail.tipCents)} {tx('pos.tips')}</div> : null}</div>
                </div>
                {detail.customerVisibleNotes || detail.notes || detail.rebooking ? (
                  <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 10.5 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--muted)', fontSize: 10 }}>{tx('pos.notes_preferences_2')}</div><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.customerVisibleNotes || detail.notes || '—'}</div></div>
                    {detail.rebooking ? <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--muted)', fontSize: 10 }}>{tx('pos.rebooking_suggestion')}</div><b>{detail.rebooking.label}</b> <span style={{ color: 'var(--soft)' }}>{detail.rebooking.window}</span></div> : null}
                  </div>
                ) : null}
                {cust?.customerId ? <MembershipRedeemPanel customerId={cust.customerId} ticketId={selId || ''} technicianId={detail.primaryTechnician?.technicianId ?? null} services={(detail.services || []).map((l) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, priceCents: l.priceCents, isAddOn: l.isAddOn }))} onRedeemed={(msg) => { setNote(msg); if (selId) loadDetail(selId); }} /> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flex: 'none' }}>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={() => selId && openManage(selId)}>{tx('pos.add_note_2')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={() => { setText(''); setOverlay({ kind: 'upsell' }); }}>{tx('pos.add_upsell')}</button>
                <button style={{ ...orangeBtn, flex: 1.3, minHeight: 40, ...(selTicket && qcBlocks(selTicket) ? off : {}) }} disabled={!selId || busyId === selId + 'send' || (!!selTicket && qcBlocks(selTicket))} title={selTicket && qcBlocks(selTicket) ? tx('pos.approve_the_quality_check_first_manage_r1vs') : undefined} onClick={() => selId && sendToCheckout(selId)}>{tx('pos.move_to_checkout')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} onClick={() => selId && notifyCustomer(selId)}>{tx('pos.send_update')}</button>
              </div>
            </>
          )}
        </section>

        {/* Ready / Finishing Technicians — ≤ 8 rows + counts for everyone on duty (§43–§44) */}
        <section className="co-card co-panel" data-testid="sd-staff">
          <div className="co-head"><h2 style={h2}>{tx('pos.ready_finishing_technicians')}</h2></div>
          {sum ? <div data-testid="sd-staff-summary" style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4, flex: 'none' }}>{tx('ops.serviceDone.staffSummary', { available: String(sum.available), finishing: String(sum.finishing), busy: String(sum.busy), onBreak: String(sum.onBreak), shown: String(sum.shown), onDuty: String(sum.onDuty) })}</div> : null}
          <div className="co-scroll">
            <table className="co-tbl">
              <thead><tr>{[tx('pos.technician'), tx('pos.specialty'), tx('pos.load'), tx('pos.next'), tx('pos.status')].map((hh) => <th key={hh}>{hh}</th>)}</tr></thead>
              <tbody>
                {staff.map((st, i) => (
                  <tr key={st.technicianId || i}>
                    <td style={{ maxWidth: 120 }} title={st.name}><div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(st.name, 16)}<span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</span></div></td>
                    <td style={{ color: 'var(--soft)', maxWidth: 90 }}>{st.specialty || '—'}</td>
                    <td style={{ color: 'var(--soft)' }}>{st.currentLoadBusy != null && st.currentLoadCap != null ? `${st.currentLoadBusy} / ${st.currentLoadCap}` : st.currentLoadBusy != null ? String(st.currentLoadBusy) : '—'}</td>
                    <td style={{ color: 'var(--soft)' }}>{st.nextAvailable ? floorLabel(st.nextAvailable) : '—'}</td>
                    <td>{chip(floorLabel(st.status), STAFF_TONE[st.status] || { bg: '#F2ECE0', fg: '#6B5C45' })}</td>
                  </tr>
                ))}
                {staff.length === 0 ? <tr><td colSpan={5} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)', whiteSpace: 'normal' }}>{tx('pos.availability_syncs_from_the_team_status_1j38')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => nav('/tenant/team/members')}>{tx('pos.view_all_technicians')}</button>
        </section>
      </div>

      {/* Analytics row — fixed height, compact (§60–§64) */}
      <div className="co-ana">
        <section className="co-card" data-module-id="sd-ana-completion-trend">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.completion_trend')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {(() => { const pts = trendPts; if (!pts.length) return <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_completions_yet')}</div>; const w = 230, h = 80, max = Math.max(1, ...pts.map((p) => p.count)); const xs = (i: number) => pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w; const ys = (v: number) => h - (v / max) * (h - 10) - 4; const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.count).toFixed(1)}`).join(' '); return (
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 'var(--co-chart)', marginTop: 4 }}>
              {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
              <path d={dd} fill="none" stroke={O} strokeWidth="2" />
              {pts.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.count)} r="2.6" fill={O} />)}
            </svg>
          ); })()}
        </section>
        <section className="co-card" data-module-id="sd-ana-service-mix">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.service_mix')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          <Donut items={serviceMix.map((m) => ({ label: m.category, count: m.count }))} />
        </section>
        <section className="co-card" data-module-id="sd-ana-add-on-mix">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.add_on_mix')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          <Donut items={addOnMix.map((m) => ({ label: m.label, count: m.count }))} />
        </section>
        <section className="co-card" data-module-id="sd-ana-completion-funnel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.completion_funnel')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {(() => { const steps = [{ l: tx('pos.service_completed'), v: funnel.completed }, { l: tx('pos.in_review_2'), v: funnel.inReview }, { l: tx('pos.ready_for_checkout'), v: funnel.readyForCheckout }, { l: tx('pos.sent_to_front_desk'), v: funnel.sentToFrontDesk }]; const base = Math.max(1, funnel.completed); const shades = ['#D9963F', '#C98326', '#B5701A', '#9A5C10']; return (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {steps.map((st, i) => { const wpct = Math.max(16, (st.v / base) * 100); return (
                <div key={st.l} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <div style={{ width: `${wpct * 0.5}%`, minWidth: 26, background: shades[i], borderRadius: 5, padding: '1px 6px', color: '#fff', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flex: 'none' }}>{st.v}</div>
                  <div style={{ fontSize: 10, color: 'var(--soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.l}</div>
                </div>
              ); })}
            </div>
          ); })()}
        </section>
        {/* §63–§64: awaiting collection — never settled revenue */}
        <section className="co-card" data-module-id="sd-ana-potential-revenue-ready-for-checkout">
          <h2 style={h2}>{tx('pos.potential_revenue_ready_for_checkout')}</h2>
          <div style={{ font: '700 17px/1 "Playfair Display",serif', color: '#1F7A3F', margin: '4px 0 2px' }}>{money2(pot.totalCents)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 10.5, lineHeight: 1.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.service_revenue')}</span><b>{money2(pot.serviceCents)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.add_on_revenue')}</span><b>{money2(pot.addOnCents)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.tips_estimated')}</span><b>{money2(pot.tipsEstCents)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.taxes_estimated')}</span><b>{money2(pot.taxesEstCents)}</b></div>
          </div>
        </section>
      </div>

      {/* Quick Actions — always visible at the bottom; contextual ones are off with no guest selected (§79–§80) */}
      <div className="co-qa" data-testid="service-done-quick-actions">
        {QA.map((q) => { const dis = q.needsGuest && ctxOff; return (
          <button key={q.l} type="button" onClick={q.fn} disabled={dis} aria-disabled={dis} className="dqa" title={dis ? tx('ops.serviceDone.selectGuestFirst') : q.l} style={dis ? off : undefined}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={q.d} /></svg>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>{q.l}</span>
          </button>
        ); })}
      </div>

      {overlay?.kind === 'queue' ? <OverlayBox onClose={closeOverlay} wide title={tx('ops.serviceDone.fullQueueTitle')}>{queueTable(items, true)}</OverlayBox> : null}
      {overlay?.kind === 'board' ? (
        <OverlayBox onClose={closeOverlay} wide title={tx('ops.serviceDone.fullBoardTitle')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
            {COLS.map((col) => <div key={col.key} style={{ background: col.bg, borderRadius: 9, padding: 6 }}><div style={{ fontSize: 11, fontWeight: 800, marginBottom: 4 }}>{col.title} · {board[col.key].length}</div><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{board[col.key].map((t) => <div key={t.ticketId} onClick={() => { selectTicket(t.ticketId); setOverlay(null); }}>{boardCard(t)}</div>)}</div></div>)}
          </div>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'insights' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.allInsights')}>
          {allInsights.map((raw) => { const ins = { ...raw, ...floorInsight('serviceDone', raw) }; return <div key={ins.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>{ins.text}{ins.sub ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ins.sub}</div> : null}</div>; })}
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'manage' ? (() => { const tid = overlay.id; const tk = items.find((t) => t.ticketId === tid); const d = detail?.ticketId === tid ? detail : null; const handedOff = tk ? stageOf(tk) === 'sent' : false; return (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.manageTitle', { guest: tk?.customerName || d?.customer.fullName || '' })} sub={tk ? `${tk.ticketNumber} · ${statusLabel('quality', tk.qualityStatus)}` : undefined}>
          <div data-testid="sd-manage" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{tx('ops.serviceDone.qualityTitle')}</div>
              {d?.qualityChecklist ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>{Object.entries(d.qualityChecklist).map(([key, v]) => <span key={key} style={{ fontSize: 10.5, color: v ? '#1F7A3F' : '#8C5A00' }}>{v ? '✓' : '○'} {statusLabel('qualityChecklist', key)}</span>)}</div> : null}
              <textarea aria-label={tx('ops.serviceDone.qualityNote')} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('ops.serviceDone.qualityNote')} style={{ width: '100%', minHeight: 56, border: '1px solid var(--line)', borderRadius: 9, padding: '6px 10px', fontFamily: 'inherit', fontSize: 12.5 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button style={{ ...orangeBtn, minHeight: 44, ...(handedOff ? off : {}) }} disabled={!!busyId || handedOff} onClick={() => doQuality(tid, 'approved')}>{tx('pos.approve')}</button>
                <button style={{ ...ghostBtn, minHeight: 44, ...(handedOff ? off : {}) }} disabled={!!busyId || handedOff} onClick={() => doQuality(tid, 'needs_review')}>{tx('pos.needs_review_2')}</button>
                <button style={{ ...ghostBtn, minHeight: 44, borderColor: '#A8321F', color: '#A8321F', ...(handedOff ? off : {}) }} disabled={!!busyId || handedOff} onClick={() => doQuality(tid, 'issue_found')}>{tx('ops.serviceDone.issueFound')}</button>
                {tk && (stageOf(tk) === 'just' || stageOf(tk) === 'review') ? <button style={{ ...ghostBtn, minHeight: 44, marginLeft: 'auto', ...(qcBlocks(tk) ? off : {}) }} disabled={!!busyId || qcBlocks(tk)} title={qcBlocks(tk) ? tx('pos.approve_the_quality_check_first_manage_r1vs') : undefined} onClick={() => { void markReady(tid); setOverlay(null); }}>{tx('pos.ready_for_checkout')}</button> : null}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{tx('ops.serviceDone.notesTitle')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <textarea aria-label={tx('ops.serviceDone.internalNotes')} placeholder={tx('ops.serviceDone.internalNotes')} value={notesDraft.notes} onChange={(e) => setNotesDraft((p) => ({ ...p, notes: e.target.value }))} style={{ minHeight: 50, border: '1px solid var(--line)', borderRadius: 9, padding: '6px 10px', fontFamily: 'inherit', fontSize: 12 }} />
                <textarea aria-label={tx('ops.serviceDone.guestNotes')} placeholder={tx('ops.serviceDone.guestNotes')} value={notesDraft.visible} onChange={(e) => setNotesDraft((p) => ({ ...p, visible: e.target.value }))} style={{ minHeight: 50, border: '1px solid var(--line)', borderRadius: 9, padding: '6px 10px', fontFamily: 'inherit', fontSize: 12 }} />
              </div>
              <button style={{ ...ghostBtn, minHeight: 44, marginTop: 6 }} disabled={!!busyId} onClick={() => saveNotes(tid)}>{tx('ops.serviceDone.saveNotes')}</button>
            </div>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 2 }}>{tx('ops.serviceDone.reopenTitle')}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{tx('ops.serviceDone.reopenHint')}</div>
              <button style={{ ...ghostBtn, minHeight: 44 }} disabled={!!busyId} onClick={() => doReopen(tid)}>{tx('pos.reopen_2')}</button>
            </div>
          </div>
        </OverlayBox>
      ); })() : null}
      {overlay?.kind === 'guest' && detail ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.guestDetailTitle')} sub={`${detail.ticketNumber} · ${detail.customer.fullName}`}>
          <div data-testid="sd-guest-detail" style={{ fontSize: 12 }}>
            {linesList(detail)}
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <span>{tx('pos.status')}: <b>{statusLabel('quality', detail.qualityStatus || 'pending')}</b></span>
              <span>{tx('pos.avg_service_duration')}: <b>{detail.durationMinutes ? tx('pos.v0_min', { v0: String(detail.durationMinutes) }) : '—'}</b></span>
              <span>{tx('ops.serviceDone.tipEntered')}: <b>{money2(detail.tipCents)}</b></span>
              {detail.rebooking ? <span>{tx('pos.rebooking_suggestion')}: <b>{detail.rebooking.label}</b> ({detail.rebooking.window})</span> : null}
            </div>
            {detail.notes || detail.customerVisibleNotes ? <div style={{ marginTop: 6, color: 'var(--soft)' }}>{detail.notes}{detail.notes && detail.customerVisibleNotes ? ' · ' : ''}{detail.customerVisibleNotes}</div> : null}
          </div>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'summary' && detail ? (
        // §54: a pre-checkout SERVICE SUMMARY — clearly not a paid receipt (the final receipt comes from Checkout)
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.summaryTitle')} sub={`${detail.ticketNumber} · ${detail.customer.fullName}`}>
          <div data-testid="sd-summary" style={{ fontSize: 12 }}>
            <div style={{ background: '#FFF4E0', color: '#6B4A14', borderRadius: 8, padding: '6px 10px', marginBottom: 8, fontWeight: 700 }}>{tx('ops.serviceDone.notAReceipt')}</div>
            {linesList(detail)}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}><span>{tx('pos.est_total')}</span><b>{money2(detail.subtotalCents)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{tx('ops.serviceDone.tipEntered')}</span><b>{money2(detail.tipCents)}</b></div>
          </div>
        </OverlayBox>
      ) : null}
      {overlay?.kind === 'upsell' ? (() => { const paid = detail?.status === 'paid'; return (
        // §49–§50 / §97: a service added after completion goes through Serving (catalog price, the technician who did it,
        // permission, audit) after an explicit, reasoned Reopen — Service Done never invents a charge
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.upsellTitle')} sub={selTicket ? `${selTicket.ticketNumber} · ${selTicket.customerName}` : undefined}>
          <div data-testid="sd-upsell" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--soft)' }}>{paid ? tx('ops.serviceDone.upsellPaid') : tx('ops.serviceDone.upsellHint')}</div>
            {!paid ? <>
              <textarea aria-label={tx('ops.serviceDone.qualityNote')} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('pos.reopening_requires_a_reason')} style={{ minHeight: 56, border: '1px solid var(--line)', borderRadius: 9, padding: '6px 10px', fontFamily: 'inherit', fontSize: 12.5 }} />
              <button style={{ ...orangeBtn, minHeight: 44, alignSelf: 'flex-start' }} disabled={!selId || !!busyId} onClick={() => selId && doReopen(selId, () => nav('/serving'))}>{tx('ops.serviceDone.reopenAndAdd')}</button>
            </> : null}
          </div>
        </OverlayBox>
      ); })() : null}
      {overlay?.kind === 'balance' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serviceDone.balanceTitle')} sub={tx('ops.serviceDone.balanceHint')}>
          <div data-testid="sd-balance" style={{ fontSize: 12 }}>
            {balanceCandidates.length === 0 ? <div style={{ color: 'var(--muted)', padding: 10 }}>{tx('ops.serviceDone.balanceNone')}</div> : balanceCandidates.map((t) => (
              <label key={t.ticketId} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                <input type="checkbox" checked={pick.has(t.ticketId)} onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(t.ticketId); else n.delete(t.ticketId); return n; })} style={{ width: 20, height: 20 }} />
                <span style={{ fontWeight: 700 }}>{t.customerName}</span><span style={{ color: 'var(--soft)' }}>{t.serviceNames.join(', ')} · {t.primaryTechnicianName || '—'}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{minAgo(t.completedAt)}</span>
              </label>
            ))}
            {balanceCandidates.length ? <button style={{ ...orangeBtn, minHeight: 44, marginTop: 10 }} disabled={busyId === 'balance' || pick.size === 0} onClick={() => { void runBalance(); }}>{tx('ops.serviceDone.balanceConfirm', { count: String(balanceCandidates.filter((t) => pick.has(t.ticketId)).length) })}</button> : null}
          </div>
        </OverlayBox>
      ) : null}
    </div>
  );
}
