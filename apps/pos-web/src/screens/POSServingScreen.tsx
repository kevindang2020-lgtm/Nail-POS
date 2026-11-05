import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { viIncludes } from '@aipowersalon/api-contracts';
import { useNavigate } from 'react-router-dom';
import { posServingApi, type ServingFilters } from '../api/posServingApi';
import { useIPadView } from '../components/IPadViewProvider';
import { checkoutTicketRequest } from '../components/ipad-modules';
import { api } from '../api/client';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel, statusLabelOrNull, humanizeCode } from '../i18n/status-label';
import { floorLabel, floorInsight } from './opsStatus';
import { fmtDateTime, fmtTime, fmtMoney, displayLocale } from '../i18n/format';
import { codedText } from '../i18n/coded-text';
import type { CodedText } from '@aipowersalon/api-contracts';
// POS Serving — the live service floor (Serving mandate, Oct 28 2026). One fixed 1920×1080 screen at 100 % zoom: title +
// filters + live · 9 KPIs · Live Service Floor | Service Progress Board | AI Service Insights · Technician Service
// Performance | Guest Service Details | Available / Finishing Technicians · analytics · 7 Quick Actions. Every list scrolls
// inside its own panel; the full floor, Manage, Move Stage, Add Upsell, Send Update, Staff Alert and Auto Balance open as
// overlays — the page never grows (§9, §19, §43, §80, §87).
// The server is the authority (§17, §23, §28): every row carries its canonical status and the actions THIS user may take
// (allowedActions — status ∩ settings ∩ permissions); the board columns and their counts are the server's projection
// (stageCounts over every matched ticket, not the loaded page); Start / Mark Ready / Send are idempotent server
// transitions (a repeat answers "already …"); timing is server truth (§26, §81). Tapping a row only selects it (§21, §114).
type Action = 'start' | 'pause' | 'resume' | 'report_delay' | 'clear_delay' | 'mark_ready' | 'send_to_service_done';
type Ticket = {
  ticketId: string; ticketNumber: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean; station?: string; serviceNames: string[]; stage?: string; addOnsLabel?: string;
  primaryTechnicianId?: string; primaryTechnicianName?: string; helperTechnicianName?: string; startedAt?: string; pausedAt?: string | null; estimatedEndAt?: string | null;
  elapsedMinutes: number; estimatedDurationMinutes?: number; subtotalCents: number; status: string; delayStatus?: string; allowedActions?: Action[]; technicianNames?: string[];
};
const revLabel = (a: string) => statusLabelOrNull('servingAction', a) ?? (a && tx(`ops.serving.rev.${a}`) !== `ops.serving.rev.${a}` ? tx(`ops.serving.rev.${a}`) : a ? humanizeCode(a) : '');
const revTime = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : fmtDateTime(d); };

type SVDetail = {
  ticketId: string; ticketNumber: string; status?: string; allowedActions?: Action[]; startedAt?: string;
  customer: { customerId?: string; fullName: string; phone?: string; isVip?: boolean; loyaltyPoints?: number; preferredTechName?: string };
  services: { serviceLineId: string; serviceName: string; category?: string; technicianId?: string; technicianName?: string; priceCents: number; isAddOn?: boolean; status?: string }[];
  primaryTechnician?: { technicianId: string; name: string }; estimatedEndAt?: string | null; elapsedMinutes?: number; estimatedDurationMinutes?: number;
  subtotalCents: number; notes?: string; customerVisibleNotes?: string; delayReason?: string;
  addOnSuggestions?: { serviceId: string; serviceName: string; priceCents: number }[];
};
type TechPerf = { technicianId?: string; name: string; activeGuests: number; revenueCents: number; tipsCents: number; utilizationPercent: number | null; avgMinutes: number; rating: number | null };
type StaffRow = { technicianId?: string; name: string; specialty?: string; currentLoad?: number; nextAvailable?: string; status: string };
type SVInsight = { id: string; text: string; sub?: string; action?: string; route?: string; severity?: 'info' | 'warn' | 'danger'; vars?: Record<string, string | number> };
type ServingState = {
  kpis: { servingNow: number; activeTickets: number; delayedServices: number; nearingCompletion: number; averageServiceDurationMinutes: number | null; totalInServiceSalesCents: number; techniciansInService: number; servicesCompletedToday: number; addOnAttachRatePercent: number | null; addOnRevenueCents: number; customerSatisfactionAvg: number | null; onTimeCompletionPercent: number | null; techniciansTotal?: number; techniciansOnDuty?: number; readyToStart?: number };
  kpiTrends?: Record<string, { deltaPercent: number | null; direction?: 'up' | 'down'; text?: string }>;
  analytics?: { serviceTimeTrend: { hour: number; minutes: number }[]; serviceMix: { category: string; sharePercent: number; count: number }[]; addOnMix: { label: string; sharePercent: number; count: number }[]; funnel: { started: number; finishing: number; serviceDone: number; completionRatePercent: number }; potentialRevenue: { totalCents: number; inServiceCents: number; addOnsPendingCents: number; finishingSoonCents: number; readyToCompleteCents: number }; potentialRevenueDeltaPercent?: number | null };
  techPerformance?: TechPerf[];
  staff?: StaffRow[];
  staffSummary?: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number };
  stageCounts?: { readyToStart: number; inService: number; finishing: number; ready: number; paused: number; delayed: number };
  insights?: SVInsight[];
  tickets: { items: Ticket[]; pagination: { totalItems: number } };
  filters: { statuses: string[]; technicians: string[]; serviceCategories: string[]; stations: string[]; delayStatuses: string[] };
  workflowSettings?: { allowPauseResume?: boolean };
};
type Tech = { technicianId: string; displayName: string };
type Balance = { ticketId: string; ticketNumber: string; customerName: string; fromTechnicianName?: string; toTechnicianId: string; toTechnicianName: string; reason: string };
type Overlay = null | { kind: 'floor' } | { kind: 'manage'; id: string } | { kind: 'move' } | { kind: 'upsell' } | { kind: 'update' } | { kind: 'alert' } | { kind: 'balance' } | { kind: 'insights' };

const CTX_KEY = 'aps.serving.ctx';   // §73: the floor's filters + selected guest survive a trip to the customer profile
const readCtx = (): { search?: string; status?: string; delay?: string; service?: string; selId?: string } => { try { return JSON.parse(sessionStorage.getItem(CTX_KEY) || '{}') || {}; } catch { return {}; } };
const liveMins = (t: { status: string; startedAt?: string; pausedAt?: string | null; elapsedMinutes: number }, nowMs: number, base: number) => (t.status === 'in_service' || t.status === 'delayed') && t.startedAt && !t.pausedAt ? t.elapsedMinutes + Math.max(0, Math.floor((nowMs - base) / 60000)) : t.elapsedMinutes;
const inputStyle: CSSProperties = { height: 40, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const PALETTE = ['#A96F22', '#C89B5A', '#4E9C78', '#5E86C2', '#C47878', '#9585B8'];
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
      <div style={{ flex: 1, minWidth: 0 }}>{items.slice(0, 4).map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '1px 0' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)', flex: 'none' }}>{Math.round((it.count / total) * 100)}%</span></div>))}</div>
    </div>
  );
};

// Overlays are MODULE-LEVEL components (Customer Queue mandate review, Oct 28 2026): declared inside the screen, the box was
// a new component type on every render, so React remounted it on each keystroke — the staff-alert / update text fields
// lost focus after one letter. Same look as before.
const OV_H2: CSSProperties = { font: '700 15px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
const OV_CLOSE: CSSProperties = { background: 'var(--card)', border: '1px solid var(--aps-orange)', color: 'var(--aps-orange)', borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 'auto', minHeight: 44, padding: '0 16px', flex: 'none', whiteSpace: 'nowrap' };
function OverlayBox({ title, sub, wide, children, onClose }: { title: string; sub?: string; wide?: boolean; children: ReactNode; onClose: () => void }) {
  return (
    <div className="co-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="co-card" style={wide ? undefined : { width: 'min(760px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><h2 style={OV_H2}>{title}</h2>{sub ? <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'normal' }}>{sub}</span> : null}<button style={OV_CLOSE} onClick={onClose}>{tx('pos.close')}</button></div>
        <div className="co-scroll">{children}</div>
      </div>
    </div>
  );
}

export function POSServingScreen() {
  const nav = useNavigate();
  const saved = useRef(readCtx());
  const [s, setS] = useState<ServingState | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [roster, setRoster] = useState<Tech[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changeReqs, setChangeReqs] = useState<any[]>([]);
  const [crBusy, setCrBusy] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState(saved.current.search ?? '');
  const [status, setStatus] = useState(saved.current.status ?? '');
  const [delay, setDelay] = useState(saved.current.delay ?? '');
  const [serviceFilter, setServiceFilter] = useState(saved.current.service ?? '');
  const [now, setNow] = useState(Date.now());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [text, setText] = useState('');
  const [delayMin, setDelayMin] = useState('');
  const [helperSel, setHelperSel] = useState('');
  const [full, setFull] = useState<Ticket[] | null>(null);
  // §76: Live is the real connection state; Auto Refresh is a real switch (on = live events + the safety sync reconcile the
  // floor in place; off = only Refresh does). Never a page reload (§77).
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => { try { return localStorage.getItem('aps.serving.autoRefresh') !== 'off'; } catch { return true; } });
  const toggleAutoRefresh = () => setAutoRefresh((v) => { try { localStorage.setItem('aps.serving.autoRefresh', v ? 'off' : 'on'); } catch { /* per-viewer convenience only */ } return !v; });

  const filters = (): ServingFilters => ({ search: search || undefined, status: status || undefined, delayStatus: delay || undefined, serviceCategory: serviceFilter || undefined, pageSize: 50 });
  const load = useCallback((f: ServingFilters) => {
    return posServingApi.state(f)
      .then((d) => { setS(d as ServingState); setLoadedAt(Date.now()); setError(null); })
      .catch((e: any) => setError(e?.message || tx('ops.serving.loadError')));
  }, []);
  const loadChangeReqs = () => posServingApi.pendingChangeRequests().then(setChangeReqs).catch(() => setChangeReqs([]));
  useEffect(() => { loadChangeReqs(); }, []);
  const decideCr = async (rid: string, decision: 'approve' | 'reject') => {
    setCrBusy(rid); setNote(null);
    try { await posServingApi.decideChangeRequest(rid, decision); await loadChangeReqs(); refetch(); }
    catch (e: any) { setNote(e?.message || tx('pos.decision_failed')); } finally { setCrBusy(null); }
  };
  useEffect(() => {
    const t = setTimeout(() => { load(filters()); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, status, delay, serviceFilter]);   // eslint-disable-line react-hooks/exhaustive-deps -- filters() reads these
  useEffect(() => {
    (api.get('/pos/technicians/state') as Promise<{ rows: { items: Tech[] } }>)
      .then((d) => setRoster((d?.rows?.items || []).map((t) => ({ technicianId: t.technicianId, displayName: (t as any).displayName }))))
      .catch(() => setRoster([]));
  }, []);
  // the live clock: a minute tick on top of the server's elapsed (server truth, §81) — never a per-second re-render
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const [selId, setSelId] = useState<string | null>(saved.current.selId ?? null);
  const [detail, setDetail] = useState<SVDetail | null>(null);
  const detailFor = useRef<string | null>(null);
  const loadDetail = useCallback(async (tid: string) => { detailFor.current = tid; try { const d = await posServingApi.ticket(tid) as SVDetail; if (detailFor.current === tid) setDetail(d); } catch { if (detailFor.current === tid) setDetail(null); } }, []);
  const [revisions, setRevisions] = useState<{ version: number; action: string; summary?: string | null; summaryCoded?: CodedText | null; actorRole?: string | null; createdAt: string }[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const loadRevisions = useCallback((tid: string | null) => {
    if (!tid) { setRevisions([]); setCurrentVersion(null); return; }
    posServingApi.revisions(tid)
      .then((r) => { if (detailFor.current !== tid) return; setRevisions(Array.isArray(r?.revisions) ? r.revisions : []); setCurrentVersion(r?.currentVersion ?? null); })
      .catch(() => { setRevisions([]); setCurrentVersion(null); });
  }, []);
  useEffect(() => { loadRevisions(selId); }, [selId, loadRevisions]);
  const selectTicket = useEventCallback((tid: string) => { setSelId(tid); loadDetail(tid); });
  // §79: snapshot first, then the live events + the silent safety sync; the open guest is reconciled with it
  const refetch = () => { void load(filters()); if (selId) { void loadDetail(selId); loadRevisions(selId); } if (overlay?.kind === 'floor') void loadFull(); };
  useRealtime('serving', () => (autoRefresh ? refetch() : undefined));
  // Auto-select (the guest kept from before Open Customer, else the first) so Guest Service Details is populated
  useEffect(() => {
    if (!s) return;
    if (selId && !detail && detailFor.current !== selId) { loadDetail(selId); return; }
    if (!selId && s.tickets.items.length) {
      // Pick the first guest once. Re-requesting its detail on every pass made a detail ⇄ effect loop (a frozen board)
      // whenever the selection had not landed yet; the detail request is single-flight per ticket via detailFor.
      const first = s.tickets.items[0].ticketId;
      setSelId((cur) => cur ?? first);
      if (detailFor.current !== first) loadDetail(first);
    }
  }, [s, selId, detail, loadDetail]);

  const loadFull = async () => { try { const d = await posServingApi.state({ ...filters(), pageSize: 100 }) as ServingState; setFull(d.tickets.items); } catch { setFull([]); } };
  const { open: openIPad } = useIPadView();

  /** every action is the server's transition; the floor then reconciles with the server — never an optimistic move (§23) */
  const act = async (tid: string, fn: () => Promise<any>, kind: string, after?: (r: any) => void) => {
    setNote(null); setBusyId(tid + kind);
    try { const r = await fn(); after?.(r); refetch(); }
    catch (e: any) { setNote(e?.message || tx('pos.action_failed')); }
    finally { setBusyId(null); }
  };
  const doAction = (tid: string, a: Action) => {
    setOverlay(null);
    if (a === 'start') return act(tid, () => posServingApi.start(tid), 'start', (r) => setNote(r?.duplicate ? tx('ops.serving.alreadyStarted') : tx('ops.serving.started')));
    if (a === 'pause') return act(tid, () => posServingApi.pause(tid), 'pause', () => setNote(tx('ops.serving.paused')));
    if (a === 'resume') return act(tid, () => posServingApi.resume(tid), 'resume', () => setNote(tx('ops.serving.resumed')));
    if (a === 'mark_ready') return act(tid, () => posServingApi.markServiceDone(tid), 'ready', (r) => setNote(r?.duplicate ? tx('ops.serving.alreadyReady') : tx('ops.serving.markedReady')));
    if (a === 'send_to_service_done') return act(tid, () => posServingApi.sendToServiceDone(tid), 'send', (r) => setNote(r?.duplicate ? tx('ops.serving.alreadySent') : tx('ops.serving.sent')));
    if (a === 'report_delay' || a === 'clear_delay') { setText(''); setDelayMin(''); setHelperSel(''); setOverlay({ kind: 'manage', id: tid }); }
  };
  const doReportDelay = (tid: string) => { if (!text.trim()) { setNote(tx('pos.a_delay_reason_is_required')); return; } const extra = parseInt(delayMin, 10); act(tid, () => posServingApi.reportDelay(tid, { reason: text.trim(), ...(Number.isFinite(extra) && extra > 0 ? { extraMinutes: extra } : {}) }), 'delay', () => setOverlay(null)); };
  const doClearDelay = (tid: string) => { if (!text.trim()) { setNote(tx('pos.clearing_a_delay_requires_a_note')); return; } act(tid, () => posServingApi.clearDelay(tid, { note: text.trim() }), 'cleardelay', () => setOverlay(null)); };
  const doHelper = (tid: string) => { act(tid, () => posServingApi.assignHelper(tid, { technicianId: helperSel === '__none__' ? null : helperSel || null }), 'helper', () => setOverlay(null)); };
  const [guestNote, setGuestNote] = useState('');
  const doGuestNote = (tid: string) => { if (!guestNote.trim()) { setNote(tx('pos.type_the_note_first')); return; } act(tid, () => posServingApi.updateNotes(tid, { notes: guestNote.trim() }), 'note'); setGuestNote(''); };
  const [moveTechOpen, setMoveTechOpen] = useState(false);
  const doMoveTech = (tid: string, technicianId: string) => { act(tid, () => posServingApi.assignTechnician(tid, { technicianId }), 'movetech'); setMoveTechOpen(false); };

  // Add Upsell (§46–§49): an add-on SERVICE from the catalog (the server prices it and the chosen technician owns the line) —
  // or a retail product (its own line kind, B-19 manager PIN past the counted stock). One logical tap = one clientRequestId.
  const [upTab, setUpTab] = useState<'addon' | 'retail'>('addon');
  const [upTech, setUpTech] = useState('');
  const upReq = useRef<string>('');
  const openUpsell = () => { if (!selId) { setNote(tx('ops.serving.selectGuest')); return; } upReq.current = ''; setUpTab('addon'); setUpTech(detail?.primaryTechnician?.technicianId || ''); setRetailQty('1'); setRetailSearch(''); setRetailPinAsk(null); setOverlay({ kind: 'upsell' }); posServingApi.retailCatalog().then((r) => setRetailProducts(r.products || [])).catch(() => setRetailProducts([])); };
  const addAddOn = (tid: string, serviceId: string, name: string) => {
    if (!upReq.current) upReq.current = `${tid}:${serviceId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const clientRequestId = upReq.current;
    act(tid, () => posServingApi.addService(tid, { serviceId, ...(upTech ? { technicianId: upTech } : {}), clientRequestId }), 'addon', (r) => { upReq.current = ''; setOverlay(null); setNote(r?.duplicate ? tx('ops.serving.addOnDuplicate') : tx('ops.serving.addedAddOn', { name })); });
  };
  const [retailProducts, setRetailProducts] = useState<{ productId: string; name: string; retailPriceCents: number }[] | null>(null);
  const [retailSearch, setRetailSearch] = useState('');
  const [retailQty, setRetailQty] = useState('1');
  const [retailPinAsk, setRetailPinAsk] = useState<{ tid: string; productId: string; quantity: number; onHand: number; name: string } | null>(null);
  const [retailPin, setRetailPin] = useState('');
  const sellRetail = (tid: string, productId: string, managerPin?: string) => {
    const quantity = Number(retailQty);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) { setNote(tx('pos.quantity_must_be_a_whole_number_brqq')); return; }
    const name = (retailProducts || []).find((p) => p.productId === productId)?.name ?? '';
    act(tid, async () => {
      try { await posServingApi.addRetail(tid, { productId, quantity, ...(managerPin ? { managerPin } : {}) }); }
      catch (e: any) {
        const code = e?.code ?? e?.body?.code ?? e?.body?.error?.code;
        if (code === 'INSUFFICIENT_STOCK' && !managerPin) { setRetailPinAsk({ tid, productId, quantity, onHand: Number(e?.body?.details?.onHand ?? e?.details?.onHand ?? 0), name }); setRetailPin(''); return; }
        throw e;
      }
      setOverlay(null); setRetailPinAsk(null);
    }, 'retail');
  };
  // Send Update (§72): the communications path; SMS answers honestly when it is not configured
  const [upd, setUpd] = useState<{ channel: 'app' | 'sms'; kind: 'status' | 'running_late' | 'almost_done' | 'ready' }>({ channel: 'app', kind: 'status' });
  const sendUpdate = (tid: string) => act(tid, () => posServingApi.notifyCustomer(tid, upd), 'update', (r) => { setOverlay(null); setNote(r?.configured === false ? (r.disabledReason || tx('pos.notifications_are_not_configured')) : tx('ops.serving.updateSent')); });
  // Send Staff Alert (§58): technician_notifications, this salon only
  const [alertTech, setAlertTech] = useState(''); const [alertMsg, setAlertMsg] = useState('');
  const sendAlert = () => { if (!alertTech) { setNote(tx('ops.serving.alertPickTech')); return; } if (!alertMsg.trim()) { setNote(tx('pos.type_the_note_first')); return; } const name = roster.find((r) => r.technicianId === alertTech)?.displayName ?? (s?.staff || []).find((x) => x.technicianId === alertTech)?.name ?? ''; act('alert', () => posServingApi.staffAlert({ technicianId: alertTech, ...(selId ? { ticketId: selId } : {}), message: alertMsg.trim() }), 'alert', () => { setOverlay(null); setAlertMsg(''); setNote(tx('ops.serving.alertSent', { name })); }); };
  // Auto Balance (§56–§57): recommendations from the server; a person assigns each one (eligibility is re-checked then)
  const [balance, setBalance] = useState<Balance[] | null>(null);
  const openBalance = () => { setBalance(null); setOverlay({ kind: 'balance' }); posServingApi.balanceSuggestions().then((r) => setBalance(r.suggestions || [])).catch((e: any) => { setBalance([]); setNote(e?.message || tx('pos.action_failed')); }); };
  const applyBalance = (b: Balance) => act(b.ticketId, () => posServingApi.assignTechnician(b.ticketId, { technicianId: b.toTechnicianId }), 'balance', () => { setBalance((x) => (x || []).filter((y) => y.ticketId !== b.ticketId)); setNote(tx('ops.serving.balanceAssigned', { guest: b.customerName, to: b.toTechnicianName })); });

  const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E9E54', RECONNECTING: '#B5821F', DEGRADED: '#B5821F', OFFLINE: '#C0392B' };
  const O = 'var(--aps-orange)';
  const card: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 10 };
  const h2: CSSProperties = { font: '700 13px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const ghostBtn: CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 9, padding: '0 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 32 };
  const orangeBtn: CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 9, padding: '0 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', minHeight: 40 };
  const linkBtn: CSSProperties = { ...ghostBtn, border: 'none', padding: '0 2px', minHeight: 30, background: 'transparent' };
  const off: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
  const sel = (v: string, on: (x: string) => void, label: string, opts: ReactNode) => <select aria-label={label} value={v} onChange={(e) => on(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 8px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', maxWidth: 150 }}>{opts}</select>;
  const closeOverlay = () => setOverlay(null);

  const titleRow = (
    <div className="co-title">
      <h1>{tx('pos.serving')}</h1>
      <div className="co-sub">{tx('ops.serving.subtitle')}</div>
      <div className="co-filters">
        <ImeSafeInput aria-label={tx('pos.search_serving')} value={search} onValue={setSearch} placeholder={tx('pos.search_guest_tech')} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', width: 160 }} />
        {sel(serviceFilter, setServiceFilter, tx('pos.service_filter'), <><option value="">{tx('pos.all_services')}</option>{(s?.filters?.serviceCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}</>)}
        {sel(delay, setDelay, tx('pos.delay_filter'), <><option value="">{tx('pos.all_timing')}</option>{(s?.filters?.delayStatuses || []).map((d) => <option key={d} value={d}>{statusLabel('delay', d)}</option>)}</>)}
        {sel(status, setStatus, tx('pos.status'), <><option value="">{tx('pos.in_progress')}</option><option value="not_started">{tx('status.techTicket.ready_to_start')}</option><option value="in_service">{tx('pos.in_service_3')}</option><option value="paused">{tx('pos.paused')}</option><option value="delayed">{tx('pos.delayed')}</option><option value="completed">{tx('pos.ready_for_service_done')}</option></>)}
        <span data-testid="serving-live" data-live={live} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: LIVE_TONE[live], fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 99, background: LIVE_TONE[live] }} />{tx(`payment.board.live.${live}`)}</span>
        <button aria-pressed={autoRefresh} data-testid="serving-auto-refresh" title={tx('payment.board.autoRefreshHint')} onClick={toggleAutoRefresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${autoRefresh ? O : 'var(--line)'}`, borderRadius: 9, padding: '0 10px', fontSize: 12, background: autoRefresh ? '#FCF3E4' : 'var(--card)', color: autoRefresh ? O : 'var(--muted)', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>{tx('pos.auto_refresh')}</button>
        <button aria-label={tx('pos.refresh')} title={tx('pos.refresh')} onClick={refetch} style={{ border: '1px solid var(--line)', borderRadius: 9, width: 38, background: 'var(--card)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.8"><path d="M4 10a6 6 0 0110-4.5M16 10a6 6 0 01-10 4.5M14 3v3h-3M6 17v-3h3" /></svg></button>
      </div>
    </div>
  );

  // §123: the loading state is the board's own skeleton — the same fixed modules, so nothing shifts when data arrives
  if (!s) return (
    <div className="serving-page" data-testid="serving-page" aria-busy={!error}>
      {titleRow}
      <div className="co-kpis">{Array.from({ length: 9 }, (_, i) => <div key={i} className="co-card co-kpi" />)}</div>
      <div className="sd-main">{['pos.live_service_floor', 'pos.service_progress_board', 'pos.ai_service_insights', 'pos.technician_service_performance', 'pos.guest_service_details', 'pos.available_finishing_technicians'].map((k, i) => (
        <section key={k} className="co-card co-panel"><div className="co-head"><h2 style={h2}>{tx(k)}</h2></div>
          {i === 0 ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: error ? '#A8321F' : 'var(--muted)', fontSize: 12 }}>{error ? <>{error}<button style={ghostBtn} onClick={() => load(filters())}>{tx('pos.retry')}</button></> : tx('pos.loading_serving')}</div> : null}
        </section>))}</div>
      <div className="co-ana">{Array.from({ length: 5 }, (_, i) => <section key={i} className="co-card" />)}</div>
      <div className="co-qa">{Array.from({ length: 7 }, (_, i) => <div key={i} className="co-card" />)}</div>
    </div>
  );

  const k = s.kpis;
  const a = s.analytics;
  const m2 = (c?: number) => fmtMoney(c || 0);
  const hhmm = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtTime(d); };
  const trend = (key: string) => s.kpiTrends?.[key];
  const elapsedOf = (t: Ticket) => liveMins(t, now, loadedAt);
  const items = s.tickets.items;
  const NED = tx('ops.serviceDone.notEnoughData');

  const ICONS: Record<string, { bg: string; fg: string; d: string }> = {
    active: { bg: '#E8F0FB', fg: '#2F6699', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0' },
    finish: { bg: '#FDEFE0', fg: '#B5621B', d: 'M4 10l4 4 8-9' },
    clock: { bg: '#E8F0FB', fg: '#2F6699', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v3l2 2' },
    tech: { bg: '#EFEAFA', fg: '#553FB0', d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0' },
    convert: { bg: '#FDEFE0', fg: '#B5621B', d: 'M4 10a6 6 0 0112 0M13 5l3 2-3 2' },
    delay: { bg: '#FBE9E7', fg: '#A8321F', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v4M10 14h.01' },
    upsell: { bg: '#E8F0FB', fg: '#2F6699', d: 'M3 8h14v3H3zm1 3h12v6H4zM10 8v9' },
    star: { bg: '#FBE9E7', fg: '#B5452F', d: 'M10 3l2 5 5 .4-4 3.3 1.3 5L10 14l-4.3 2.7L7 11.7l-4-3.3 5-.4z' },
    ontime: { bg: '#E9F6EC', fg: '#1F7A3F', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm-1 6l1.5 1.5L13 8' },
  };
  // §16 / §82–§85: the server's definitions; a KPI with no population is "—" + "Not enough data", never 0 % / 0.0 ★
  const onDuty = k.techniciansOnDuty ?? k.techniciansTotal ?? 0;
  const techPct = onDuty ? Math.round((k.techniciansInService / onDuty) * 100) : null;
  const sat = k.customerSatisfactionAvg;
  const kpis: { key: string; l: string; v: string; ico: string; support?: string; upBad?: boolean; downGood?: boolean; note?: string; noTrend?: boolean }[] = [
    { key: 'active', l: tx('pos.active_services'), v: String(k.servingNow), ico: 'active' },
    { key: 'readyToFinish', l: tx('pos.ready_to_finish'), v: String(k.nearingCompletion), ico: 'finish' },
    { key: 'avgTime', l: tx('pos.avg_service_time'), v: k.averageServiceDurationMinutes != null && k.averageServiceDurationMinutes > 0 ? tx('pos.averageservicedurationminutes_min', { averageServiceDurationMinutes: String(k.averageServiceDurationMinutes) }) : '—', ico: 'clock', downGood: true, note: k.averageServiceDurationMinutes ? undefined : NED, noTrend: !k.averageServiceDurationMinutes },
    { key: 'techsBusy', l: tx('pos.technicians_busy'), v: `${k.techniciansInService} / ${onDuty || '—'}`, ico: 'tech', support: techPct != null ? tx('ops.serving.utilized', { pct: techPct }) : NED },
    { key: 'addOnConversion', l: tx('pos.add_on_conversion'), v: k.addOnAttachRatePercent == null ? '—' : `${k.addOnAttachRatePercent}%`, ico: 'convert', note: k.addOnAttachRatePercent == null ? NED : undefined, noTrend: k.addOnAttachRatePercent == null },
    { key: 'delayed', l: tx('pos.services_delayed'), v: String(k.delayedServices), ico: 'delay', upBad: true },
    { key: 'upsellRevenue', l: tx('pos.upsell_revenue_today'), v: m2(k.addOnRevenueCents), ico: 'upsell' },
    { key: 'satisfaction', l: tx('pos.customer_satisfaction'), v: sat == null || !(sat > 0) ? '—' : `${sat.toFixed(1)} / 5`, ico: 'star', note: sat == null || !(sat > 0) ? NED : undefined, noTrend: sat == null || !(sat > 0) },
    { key: 'onTime', l: tx('pos.on_time_completion'), v: k.onTimeCompletionPercent == null ? '—' : `${k.onTimeCompletionPercent}%`, ico: 'ontime', note: k.onTimeCompletionPercent == null ? NED : undefined, noTrend: k.onTimeCompletionPercent == null },
  ];

  // §27–§28: the board is the server's projection — the column is the row's canonical stage; the counts are the server's
  // stageCounts over every matched ticket (it counted only the loaded page)
  type Col = 'start' | 'inservice' | 'finishing' | 'ready';
  const colOf = (t: Ticket): Col => t.status === 'completed' || t.status === 'sent_to_service_done' ? 'ready' : t.status === 'not_started' ? 'start' : t.stage === 'Finishing Soon' ? 'finishing' : 'inservice';
  const board: Record<Col, Ticket[]> = { start: [], inservice: [], finishing: [], ready: [] };
  for (const t of items) board[colOf(t)].push(t);
  const sc = s.stageCounts;
  const COLS: { key: Col; title: string; bg: string; count: number }[] = [
    { key: 'start', title: tx('status.techTicket.ready_to_start'), bg: '#E9F1FA', count: sc ? sc.readyToStart : board.start.length },
    { key: 'inservice', title: tx('pos.in_service_3'), bg: '#EAF5EE', count: sc ? sc.inService + sc.paused + sc.delayed : board.inservice.length },
    { key: 'finishing', title: tx('pos.finishing_soon'), bg: '#FBF1E6', count: sc ? sc.finishing : board.finishing.length },
    { key: 'ready', title: tx('pos.ready_for_service_done'), bg: '#F3EEFB', count: sc ? sc.ready : board.ready.length },
  ];
  const selTicket = items.find((t) => t.ticketId === selId) || (full || []).find((t) => t.ticketId === selId) || null;
  const selCol = selTicket ? colOf(selTicket) : null;

  const STAGE_TONE: Record<string, { bg: string; fg: string }> = {
    'In Service': { bg: '#E9F6EC', fg: '#1F7A3F' }, 'Finishing Soon': { bg: '#FFF4E0', fg: '#8C5A00' }, 'Ready': { bg: '#EFEAFA', fg: '#553FB0' },
    'Paused': { bg: '#EEF0F2', fg: '#4F5661' }, 'Delayed': { bg: '#FBE9E7', fg: '#A8321F' }, 'Ready to Start': { bg: '#E8F0FB', fg: '#2F6699' },
  };
  const stageTone = (st?: string) => (st && STAGE_TONE[st]) || STAGE_TONE['In Service'];
  // §34: delayed is text + icon + colour, never colour alone
  const stageChip = (t: Ticket) => { const tn = stageTone(t.stage); const late = t.status === 'delayed' || t.delayStatus === 'late' || t.delayStatus === 'critical'; return <span className="sv-stage" style={{ background: late ? STAGE_TONE.Delayed.bg : tn.bg, color: late ? STAGE_TONE.Delayed.fg : tn.fg }}>{late ? '⚠ ' : ''}{late && t.stage !== 'Delayed' ? tx('ops.serving.delayedTag') : (t.stage ? floorLabel(t.stage) : tx('pos.in_service_3'))}</span>; };

  const allInsights = s.insights || [];
  const insights = allInsights.slice(0, 4);   // §54: the top items; View All for the rest
  const techPerf = s.techPerformance || [];
  const staff = (s.staff || []).slice(0, 8);   // §62: never 200 cards
  const sum = s.staffSummary;
  const STAFF_TONE: Record<string, { bg: string; fg: string }> = { Available: { bg: '#E9F6EC', fg: '#1F7A3F' }, 'Finishing Soon': { bg: '#FFF4E0', fg: '#8C5A00' }, Busy: { bg: '#FBE9E7', fg: '#A8321F' }, Break: { bg: '#E8F0FB', fg: '#2F6699' } };
  const serviceMix = a?.serviceMix || [];
  const addOnMix = a?.addOnMix || [];
  const trendPts = a?.serviceTimeTrend || [];
  const funnel = a?.funnel || { started: 0, finishing: 0, serviceDone: 0, completionRatePercent: 0 };
  const pot = a?.potentialRevenue || { totalCents: 0, inServiceCents: 0, addOnsPendingCents: 0, finishingSoonCents: 0, readyToCompleteCents: 0 };
  const cust = detail?.customer;
  const allowed: Action[] = (detail && detail.ticketId === selId ? detail.allowedActions : selTicket?.allowedActions) ?? [];
  const ctxOff = !selId;   // §70: contextual actions are off with no guest selected
  const estFinishMins = detail?.estimatedEndAt ? Math.round((new Date(detail.estimatedEndAt).getTime() - now) / 60000) : null;
  const avatar = (name: string, size = 20) => <span style={{ width: size, height: size, borderRadius: 99, background: '#ECE3D5', color: 'var(--g7)', fontSize: size * 0.4, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>;
  const chip = (txt: string, tone: { bg: string; fg: string }) => <span className="sv-chip" style={{ background: tone.bg, color: tone.fg }}>{txt}</span>;

  // the selected guest already at Service Done cannot be marked again — say where it went instead of posting
  const markSelected = () => {
    if (!selId) { setNote(tx('ops.serving.selectGuest')); return; }
    if (selTicket && (selTicket.status === 'completed' || selTicket.status === 'sent_to_service_done')) { setNote(tx('pos.this_service_is_already_done_it_102l')); return; }
    if (!allowed.includes('mark_ready')) { setNote(tx('ops.serving.noLegalMove')); return; }
    void doAction(selId, 'mark_ready');
  };
  const startSelected = () => {
    if (!selId) { setNote(tx('ops.serving.selectGuest')); return; }
    if (allowed.includes('start')) { void doAction(selId, 'start'); return; }
    if (allowed.includes('resume')) { void doAction(selId, 'resume'); return; }
    setNote(selTicket?.status === 'in_service' ? tx('ops.serving.alreadyStarted') : tx('ops.serving.cannotStart'));
  };
  const saveCtx = () => { try { sessionStorage.setItem(CTX_KEY, JSON.stringify({ search, status, delay, service: serviceFilter, selId })); } catch { /* per-viewer convenience */ } };
  const openCustomer = () => { if (!cust) { setNote(tx('ops.serving.selectGuest')); return; } saveCtx(); const q = new URLSearchParams(); if (cust.fullName) q.set('q', cust.fullName); if (cust.customerId) q.set('customerId', cust.customerId); nav('/customers' + (q.toString() ? '?' + q.toString() : '')); };
  const insightAct = (ins: SVInsight) => {
    const r = ins.route || '';
    if (r === 'filter:delayed') { setStatus('delayed'); return; }
    if (r === 'balance') { openBalance(); return; }
    if (r.startsWith('customer:')) { saveCtx(); const q = new URLSearchParams(); if (ins.vars?.name) q.set('q', String(ins.vars.name)); q.set('customerId', r.slice(9)); nav('/customers?' + q.toString()); return; }
    if (r && r !== '/serving') { saveCtx(); nav(r); }
  };
  const ACTION_LABEL: Record<Action, string> = { start: tx('pos.start_service'), pause: tx('pos.pause'), resume: tx('pos.resume'), report_delay: tx('pos.report_delay'), clear_delay: tx('pos.clear_delay'), mark_ready: tx('pos.mark_ready'), send_to_service_done: tx('pos.send_to_service_done') };
  const QA: { l: string; d: string; fn: () => void; enabled: boolean }[] = [
    { l: tx('pos.start_service'), d: 'M6 4l10 6-10 6z', fn: startSelected, enabled: !ctxOff && (allowed.includes('start') || allowed.includes('resume')) },
    { l: tx('pos.move_stage'), d: 'M4 10h9m0 0l-3-3m3 3l-3 3', fn: () => { if (!selId) { setNote(tx('ops.serving.selectGuest')); return; } setOverlay({ kind: 'move' }); }, enabled: !ctxOff && allowed.length > 0 },
    { l: tx('pos.add_upsell'), d: 'M10 4v12M4 10h12', fn: openUpsell, enabled: !ctxOff && !!selTicket && selTicket.status !== 'sent_to_service_done' },
    { l: tx('pos.send_update'), d: 'M3 5l8 6 8-6M3 5h16v10H3z', fn: () => { if (!selId) { setNote(tx('ops.serving.selectGuest')); return; } setUpd({ channel: 'app', kind: selTicket?.status === 'delayed' ? 'running_late' : selTicket?.stage === 'Finishing Soon' ? 'almost_done' : 'status' }); setOverlay({ kind: 'update' }); }, enabled: !ctxOff },
    { l: tx('pos.mark_ready'), d: 'M4 10l4 4 8-9', fn: markSelected, enabled: !ctxOff && allowed.includes('mark_ready') },
    { l: tx('pos.open_customer'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0', fn: openCustomer, enabled: !ctxOff && !!cust },
    { l: tx('pos.view_reports'), d: 'M4 16V8M9 16V4M14 16v-6', fn: () => { saveCtx(); nav('/reports'); }, enabled: true },
  ];

  // §18–§19 / §89: fixed table layout, two-line compact rows — long names truncate (full text on hover / in the detail)
  const floorTable = (rows: Ticket[], inOverlay = false) => (
    <table className="co-tbl sv-floor" style={{ tableLayout: 'fixed' }}>
      {/* §18: guest + technician(s) | service + add-ons | stage | elapsed / estimate + start time | Manage. Below 1500 px wide the
          service column steps aside and the guest's second line carries the service (1366 is a fallback, §129) */}
      <colgroup><col /><col className="sv-col-svc" style={{ width: '31%' }} /><col style={{ width: 98 }} /><col style={{ width: 62 }} /><col style={{ width: 72 }} /></colgroup>
      <thead><tr>{[tx('pos.guest'), tx('pos.service_3'), tx('pos.stage'), tx('pos.elapsed'), ''].map((hh, i) => <th key={i} className={i === 1 ? 'sv-col-svc' : undefined} style={{ textAlign: i === 3 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((t) => { const isSel = t.ticketId === selId; const el = elapsedOf(t); const est = t.estimatedDurationMinutes || 0; const late = t.status === 'delayed' || t.delayStatus === 'late' || t.delayStatus === 'critical'; return (
          <tr key={t.ticketId} className={`co-row${late ? ' sv-delayed' : ''}`} data-ticket={t.ticketId} onClick={() => { selectTicket(t.ticketId); if (inOverlay) setOverlay(null); }} style={{ background: isSel ? '#FCF3E4' : 'transparent' }}>
            <td style={{ lineHeight: 1.2 }} title={`${t.customerName} · ${(t.technicianNames?.length ? t.technicianNames : [t.primaryTechnicianName]).filter(Boolean).join(' + ')}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(t.customerName, 16)}<span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.customerName}</span>{t.isVip ? <span style={{ color: '#A8321F', fontSize: 9, fontWeight: 800, flex: 'none' }}>VIP</span> : null}</div>
              <div style={{ fontSize: 10, color: 'var(--soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}><span className="sv-narrow">{t.serviceNames[0] || '—'} · </span>{(t.technicianNames?.length ? t.technicianNames : [t.primaryTechnicianName || '—']).join(' + ')}</div>
            </td>
            <td className="sv-col-svc" style={{ color: 'var(--soft)', lineHeight: 1.2 }} title={[t.serviceNames.join(', '), t.addOnsLabel].filter(Boolean).join(' + ')}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{t.serviceNames.join(', ') || '—'}</div><div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.addOnsLabel ? `+ ${t.addOnsLabel}` : m2(t.subtotalCents)}</div></td>
            <td>{stageChip(t)}</td>
            <td style={{ textAlign: 'right', lineHeight: 1.2 }}><div style={{ fontWeight: 700, color: late ? '#A8321F' : 'var(--text)' }}>{t.status === 'not_started' ? '—' : `${el}′`}{est ? <span style={{ fontWeight: 400, fontSize: 9.5, color: 'var(--muted)' }}> /{est}′</span> : null}</div><div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{hhmm(t.startedAt)}</div></td>
            <td style={{ paddingRight: 0 }}><button style={{ ...ghostBtn, borderColor: 'var(--line)', minHeight: 34 }} onClick={(e) => { e.stopPropagation(); selectTicket(t.ticketId); setText(''); setDelayMin(''); setHelperSel(''); setOverlay({ kind: 'manage', id: t.ticketId }); }}>{tx('pos.manage')}</button></td>
          </tr>
        ); })}
        {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_active_services')}</td></tr> : null}
      </tbody>
    </table>
  );
  const boardCard = (t: Ticket) => (
    <div key={t.ticketId} className="sd-card" data-ticket={t.ticketId} onClick={() => selectTicket(t.ticketId)} style={t.ticketId === selId ? { borderColor: O, boxShadow: `0 0 0 1px ${O}` } : undefined} title={`${t.customerName} · ${t.serviceNames.join(', ')}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(t.customerName, 16)}<span className="nm">{t.customerName}</span>{t.status === 'delayed' ? <span style={{ marginLeft: 'auto', color: '#A8321F', fontSize: 10, fontWeight: 800, flex: 'none' }}>⚠</span> : t.status === 'paused' ? <span style={{ marginLeft: 'auto', color: '#4F5661', fontSize: 9, fontWeight: 800, flex: 'none' }}>II</span> : null}</div>
      <div className="sub">{t.serviceNames[0] || '—'} · {t.primaryTechnicianName || '—'}</div>
      <div className="sub" style={{ color: 'var(--muted)' }}>{t.status === 'not_started' ? tx('status.techTicket.ready_to_start') : `${elapsedOf(t)}′${t.estimatedDurationMinutes ? ' / ' + t.estimatedDurationMinutes + '′' : ''}`}{t.addOnsLabel ? ` · ${t.addOnsLabel}` : ''}</div>
    </div>
  );
  const manageT = overlay?.kind === 'manage' ? (items.find((t) => t.ticketId === overlay.id) || (full || []).find((t) => t.ticketId === overlay.id) || null) : null;

  return (
    <div className="serving-page" data-testid="serving-page">
      {/* §80: notes float over the floor — they never push the layout */}
      {note ? <div role="status" className="co-toast"><span data-testid="serving-note" style={{ flex: 1 }}>{note}</span><button aria-label={tx('pos.close')} onClick={() => setNote(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', minWidth: 32, minHeight: 32 }}>×</button></div> : null}
      {error ? <div role="alert" className="co-toast" style={{ top: 48, borderColor: '#C0392B' }}><span style={{ flex: 1 }}>{tx('ops.serving.loadError')} {error}</span><button style={ghostBtn} onClick={() => load(filters())}>{tx('pos.retry')}</button></div> : null}

      {titleRow}

      {/* 9 KPIs (§15–§17) */}
      <div className="co-kpis" data-testid="serving-kpis">
        {kpis.map((c) => { const tr = c.noTrend ? undefined : trend(c.key); const ic = ICONS[c.ico]; return (
          <div key={c.key} className="co-card co-kpi">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: ic.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ic.fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ic.d} /></svg></span>
              <span className="co-kpi-l">{c.l}</span>
            </div>
            <div className="co-kpi-v">{c.v}</div>
            <div className="co-kpi-n">
              {c.support ? <span style={{ color: 'var(--muted)' }}>{c.support}</span>
                : tr && (tr.text || tr.deltaPercent != null) ? (() => { const down = tr.direction === 'down'; const good = c.downGood ? down : c.upBad ? down : !down; return <span style={{ color: good ? '#1F7A3F' : '#A8321F', fontWeight: 700 }}>{down ? '▼' : '▲'} {tr.text || `${Math.abs(tr.deltaPercent!)}%`} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_yesterday')}</span></span>; })()
                  : <span style={{ color: 'var(--muted)' }}>{c.note || ''}</span>}
            </div>
          </div>
        ); })}
      </div>

      <div className="sd-main">
        {/* Live Service Floor — fixed panel, internal scroll (§18–§21) */}
        <section className="co-card co-panel" data-testid="sv-floor">
          <div className="co-head"><h2 style={h2}>{tx('pos.live_service_floor')}</h2><span style={{ background: '#FDEFE0', color: '#8C5A00', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>{s.tickets.pagination?.totalItems ?? items.length}</span></div>
          <div className="co-scroll">{floorTable(items)}</div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => { setFull(null); setOverlay({ kind: 'floor' }); void loadFull(); }}>{tx('pos.view_full_service_floor')}</button>
        </section>

        {/* Service Progress Board — the server's canonical stages, counts, internal lists (§27–§30) */}
        <section className="co-card co-panel" data-testid="sv-board">
          <div className="co-head"><h2 style={h2}>{tx('pos.service_progress_board')}</h2></div>
          <div className="sd-board">
            {COLS.map((col) => (
              <div key={col.key} className="sd-col" data-stage={col.key} style={{ background: col.bg, outline: selCol === col.key ? `2px solid ${O}` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flex: 'none', gap: 4 }}><span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.title}</span><span data-testid={`sv-count-${col.key}`} style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)' }}>{col.count}</span></div>
                <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{board[col.key].map(boardCard)}{col.count > board[col.key].length ? <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', flex: 'none' }}>+{col.count - board[col.key].length} {tx('pos.more')}</div> : null}</div>
              </div>
            ))}
          </div>
        </section>

        {/* AI Service Insights — advisory (§54–§57), the requested-technician approvals, Auto Balance + Staff Alert */}
        <section className="co-card co-panel" data-testid="sv-insights">
          <div className="co-head"><h2 style={h2}>{tx('pos.ai_service_insights')}</h2><span style={{ background: '#EFEAFA', color: '#553FB0', borderRadius: 6, padding: '1px 7px', fontSize: 9.5, fontWeight: 800 }}>{tx('pos.new')}</span>{allInsights.length > insights.length ? <button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setOverlay({ kind: 'insights' })}>{tx('pos.view_all')}</button> : null}</div>
          <div className="co-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {changeReqs.length > 0 ? (
              <div style={{ border: '1px solid #F0D9B5', background: '#FFF8EC', borderRadius: 9, padding: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><h3 style={{ ...h2, fontSize: 11.5 }}>{tx('pos.requested_technician_change_approvals')}</h3><span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: '#8C5A00' }}>{changeReqs.length} {tx('pos.pending_2')}</span></div>
                {changeReqs.slice(0, 3).map((cr: any) => (
                  <div key={cr.requestId || cr.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cr.reason || ''}><b>{cr.customerName || '—'}</b> · {cr.currentTechnicianName || '—'} → {cr.requestedTechnicianName || '—'}</span>
                    <button disabled={crBusy === (cr.requestId || cr.id)} style={{ ...orangeBtn, minHeight: 32, fontSize: 10.5 }} onClick={() => decideCr(cr.requestId || cr.id, 'approve')}>{tx('pos.approve')}</button>
                    <button disabled={crBusy === (cr.requestId || cr.id)} style={{ ...ghostBtn, borderColor: '#A8321F', color: '#A8321F' }} onClick={() => decideCr(cr.requestId || cr.id, 'reject')}>{tx('pos.reject')}</button>
                  </div>
                ))}
              </div>
            ) : null}
            {insights.map((raw) => { const ins = { ...raw, ...floorInsight('serving', raw) }; return (
              <div key={ins.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: ins.severity === 'warn' || ins.severity === 'danger' ? '#FBEAE8' : '#FDEFE0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ins.severity === 'warn' || ins.severity === 'danger' ? '#A8321F' : O} strokeWidth="1.7"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg></span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.25 }}>{ins.text}</div>{ins.sub ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{ins.sub}</div> : null}</div>
                {ins.actionText && raw.route ? <button style={ghostBtn} onClick={() => insightAct(raw)}>{ins.actionText}</button> : null}
              </div>
            ); })}
            {insights.length === 0 && changeReqs.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_insights_right_now')}</div> : null}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flex: 'none' }}>
            {/* §56: analyze → recommend → a person confirms each one (nothing is reassigned automatically) */}
            <button style={{ ...orangeBtn, flex: 1, minWidth: 0 }} data-testid="sv-auto-balance" onClick={openBalance}>{tx('pos.auto_balance_floor')}</button>
            <button style={{ ...ghostBtn, flex: 1, minHeight: 40, minWidth: 0 }} data-testid="sv-staff-alert" onClick={() => { setAlertTech(selTicket?.primaryTechnicianId || ''); setAlertMsg(''); setOverlay({ kind: 'alert' }); }}>{tx('pos.send_staff_alert')}</button>
          </div>
        </section>

        {/* Technician Service Performance — operational only, never pay (§40–§41) */}
        <section className="co-card co-panel" data-testid="sv-tech-perf">
          <div className="co-head"><h2 style={h2}>{tx('pos.technician_service_performance')}</h2></div>
          <div className="co-scroll">
            <table className="co-tbl">
              <thead><tr>{[tx('pos.technician'), tx('pos.guests'), tx('pos.revenue'), tx('pos.util'), tx('pos.avg_2'), tx('pos.rating')].map((hh, i) => <th key={hh} style={{ textAlign: i >= 1 && i <= 4 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
              <tbody>
                {techPerf.map((p, i) => (
                  <tr key={p.technicianId || i}>
                    <td style={{ maxWidth: 130 }} title={p.name}><div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>{avatar(p.name, 18)}<span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span></div></td>
                    <td style={{ textAlign: 'right' }}>{p.activeGuests}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{m2(p.revenueCents)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--soft)' }}>{p.utilizationPercent != null ? `${p.utilizationPercent}%` : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--soft)' }}>{p.avgMinutes ? tx('pos.avgminutes_min', { avgMinutes: String(p.avgMinutes) }) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.rating != null ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.rating.toFixed(1)} <span style={{ color: '#B5821F' }}>★</span></span> : '—'}</td>
                  </tr>
                ))}
                {techPerf.length === 0 ? <tr><td colSpan={6} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_active_technicians')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => { saveCtx(); nav('/tenant/reports/technicians'); }}>{tx('pos.view_full_performance')}</button>
        </section>

        {/* Guest Service Details — fixed height, internal scroll (§42–§45) */}
        <section className="co-card co-panel" data-testid="sv-guest">
          <div className="co-head"><h2 style={h2}>{tx('pos.guest_service_details')}</h2>{selTicket ? <span style={{ marginLeft: 'auto' }}>{stageChip(selTicket)}</span> : null}</div>
          {!detail ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{tx('pos.select_a_guest_from_the_floor_6ibk')}</div> : (
            <>
              <div className="co-scroll">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {avatar(cust?.fullName || '?', 32)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cust?.fullName}>{cust?.fullName}</span>{cust?.isVip ? chip('VIP', { bg: '#FBE9E7', fg: '#A8321F' }) : null}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail.ticketNumber} · {cust?.phone || '—'} · {tx('pos.loyalty')} {cust?.loyaltyPoints != null ? tx('pos.v0_pts_3', { v0: String(cust.loyaltyPoints.toLocaleString(displayLocale())) }) : '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.est_finish')}</div>
                    <div style={{ font: '700 16px/1.1 "Playfair Display",serif', color: estFinishMins != null && estFinishMins < 0 ? '#A8321F' : O }}>{hhmm(detail.estimatedEndAt)}</div>
                    <div style={{ fontSize: 10, color: 'var(--soft)' }}>{estFinishMins == null ? '' : estFinishMins < 0 ? tx('ops.serving.lateBy', { min: String(-estFinishMins) }) : tx('pos.in_estfinishmins_min', { estFinishMins: String(estFinishMins) })}</div>
                  </div>
                </div>
                <div className="sv-guest">
                  <div style={{ background: 'var(--page)', borderRadius: 9, padding: 7, minWidth: 0 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 3 }}>{tx('pos.current_service_stack')}</div>
                    {(detail.services || []).map((l) => { const done = l.status === 'done'; return (
                      <div key={l.serviceLineId} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 0', minWidth: 0 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${l.serviceName} · ${l.technicianName || ''}`}>{l.serviceName}{l.isAddOn ? <span style={{ color: 'var(--muted)' }}> · {tx('pos.add_ons_2')}</span> : null}<span style={{ color: 'var(--soft)' }}> · {l.technicianName || detail.primaryTechnician?.name || '—'}</span></span>
                        <span style={{ flex: 'none', fontWeight: 600 }}>{m2(l.priceCents)}</span>
                        {chip(done ? tx('ops.serving.lineDone') : l.status === 'assigned' ? tx('ops.serving.lineQueued') : tx('pos.in_service_3'), done ? { bg: '#EFEAFA', fg: '#553FB0' } : l.status === 'assigned' ? { bg: '#EEF0F2', fg: '#4F5661' } : { bg: '#E9F6EC', fg: '#1F7A3F' })}
                      </div>
                    ); })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 3 }}><span style={{ color: 'var(--muted)' }}>{tx('pos.total')}</span><b>{m2(detail.subtotalCents)}</b></div>
                  </div>
                  <div style={{ background: 'var(--page)', borderRadius: 9, padding: 7, fontSize: 11, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('ops.serving.started_at')}</span><b>{hhmm(detail.startedAt)}</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.elapsed')}</span><b>{selTicket ? elapsedOf(selTicket) : detail.elapsedMinutes ?? 0}′ / {detail.estimatedDurationMinutes || '—'}′</b></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.preferred_tech')}</span><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{cust?.preferredTechName || '—'}</b></div>
                    {detail.delayReason ? <div style={{ color: '#A8321F', marginTop: 2 }}>⚠ {detail.delayReason}</div> : null}
                    {detail.customerVisibleNotes || detail.notes ? <div style={{ marginTop: 3, color: 'var(--soft)' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.service_notes')}: </span>{detail.customerVisibleNotes || detail.notes}</div> : null}
                  </div>
                </div>
                {/* change history — append-only revision timeline at the point of work */}
                <div style={{ background: 'var(--page)', borderRadius: 9, padding: 7, marginTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}><div style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{tx('pos.change_history')}</div>{currentVersion != null ? <span style={{ fontSize: 9.5, color: 'var(--soft)' }}>v{currentVersion}</span> : null}</div>
                  {revisions.length === 0 ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.no_changes_recorded_yet')}</div> : revisions.slice().reverse().slice(0, 20).map((rv, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, padding: '2px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ width: 22, flex: 'none', textAlign: 'center', fontSize: 9, fontWeight: 800, color: O }}>v{rv.version}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.2 }}>{revLabel(rv.action)}</div>
                        {rv.summary || rv.summaryCoded ? <div style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{codedText(rv.summaryCoded, rv.summary)}</div> : null}
                        <div style={{ fontSize: 8.5, color: 'var(--soft)' }}>{revTime(rv.createdAt)}{rv.actorRole ? ` · ${statusLabel('role', String(rv.actorRole).toLowerCase())}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input aria-label={tx('pos.note_for_this_guest')} placeholder={tx('pos.add_a_note_for_this_guest')} value={guestNote} onChange={(e) => setGuestNote(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                  <button style={{ ...ghostBtn, minHeight: 40 }} disabled={!selId} onClick={() => selId && doGuestNote(selId)}>{tx('pos.save_note')}</button>
                </div>
                {moveTechOpen && selId ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <select aria-label={tx('pos.move_to_technician')} defaultValue="" onChange={(e) => e.target.value && doMoveTech(selId, e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                      <option value="">{tx('pos.move_to_technician_2')}</option>
                      {roster.map((r) => <option key={r.technicianId} value={r.technicianId}>{r.displayName}</option>)}
                    </select>
                    <button style={{ ...ghostBtn, minHeight: 40 }} onClick={() => setMoveTechOpen(false)}>{tx('pos.cancel')}</button>
                  </div>
                ) : null}
              </div>
              <div className="co-actions" style={{ display: 'flex', gap: 6, marginTop: 6, flex: 'none' }}>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} disabled={!selId} onClick={openUpsell}>{tx('pos.add_upsell')}</button>
                <button style={{ ...ghostBtn, flex: 1, minHeight: 40 }} disabled={!selId} onClick={() => setMoveTechOpen((v) => !v)}>{tx('pos.move_tech')}</button>
                {/* the canonical handoff — offered only when the server says it is a legal move for this user */}
                <button style={{ ...orangeBtn, flex: 1.3, ...(allowed.includes('send_to_service_done') ? {} : off) }} disabled={!selId || !allowed.includes('send_to_service_done') || busyId === selId + 'send'} onClick={() => selId && doAction(selId, 'send_to_service_done')}>{tx('pos.send_to_service_done')}</button>
              </div>
            </>
          )}
        </section>

        {/* Available / Finishing Technicians — real operational state, capped, counts for everyone (§59–§62) */}
        <section className="co-card co-panel" data-testid="sv-staff">
          <div className="co-head"><h2 style={h2}>{tx('pos.available_finishing_technicians')}</h2></div>
          {sum ? <div data-testid="sv-staff-summary" style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tx('ops.serving.staffSummary', { available: String(sum.available), finishing: String(sum.finishing), busy: String(sum.busy), onBreak: String(sum.onBreak), onDuty: String(sum.onDuty) })}>{tx('ops.serving.staffSummary', { available: String(sum.available), finishing: String(sum.finishing), busy: String(sum.busy), onBreak: String(sum.onBreak), onDuty: String(sum.onDuty) })}</div> : null}
          <div className="co-scroll">
            <table className="co-tbl" style={{ tableLayout: 'fixed' }}>
              <colgroup><col /><col style={{ width: '28%' }} /><col style={{ width: 40 }} /><col style={{ width: 92 }} /></colgroup>
              <thead><tr>{[tx('pos.technician'), tx('pos.specialty'), tx('pos.load'), tx('pos.status')].map((hh, i) => <th key={hh} style={{ textAlign: i === 2 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
              <tbody>
                {staff.map((st, i) => (
                  <tr key={st.technicianId || i}>
                    <td title={st.name}><div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{avatar(st.name, 16)}<span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</span></div></td>
                    <td style={{ color: 'var(--soft)' }} title={st.specialty}>{st.specialty || '—'}</td>
                    <td style={{ color: 'var(--soft)', textAlign: 'right' }}>{st.currentLoad != null ? st.currentLoad : '—'}</td>
                    <td>{chip(floorLabel(st.status), STAFF_TONE[st.status] || { bg: '#F2ECE0', fg: '#6E5E48' })}</td>
                  </tr>
                ))}
                {staff.length === 0 ? <tr><td colSpan={4} style={{ padding: 10, textAlign: 'center', color: 'var(--muted)', whiteSpace: 'normal' }}>{tx('pos.availability_syncs_from_the_team_status_1j38')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => { saveCtx(); nav('/tenant/team/members'); }}>{tx('pos.view_all_technicians')}</button>
        </section>
      </div>

      {/* Analytics row — compact operational charts; detail lives in Reports (§63–§67) */}
      <div className="co-ana">
        <section className="co-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.service_time_trend')}</h2><span style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {(() => { const pts = trendPts; if (!pts.length) return <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_data_yet')}</div>; const w = 230, h = 70, max = Math.max(1, ...pts.map((p) => p.minutes)); const xs = (i: number) => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w); const ys = (v: number) => h - (v / max) * (h - 10) - 4; const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.minutes).toFixed(1)}`).join(' '); return (
            <svg className="co-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ marginTop: 4 }}>
              {[0.33, 0.66].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
              <path d={dd} fill="none" stroke={O} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          ); })()}
        </section>
        <section className="co-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.service_mix')}</h2><span style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          <Donut items={serviceMix.slice(0, 5).map((m) => ({ label: m.category, count: m.count }))} />
        </section>
        <section className="co-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.add_on_mix')}</h2><span style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          <Donut items={addOnMix.map((m) => ({ label: m.label, count: m.count }))} />
        </section>
        <section className="co-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.completion_funnel')}</h2><span style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {(() => { const base = Math.max(1, funnel.started); const steps = [{ l: tx('pos.started_2'), v: funnel.started }, { l: tx('pos.finishing'), v: funnel.finishing }, { l: tx('pos.service_done'), v: funnel.serviceDone }]; const shades = ['#C77F2E', '#A96F22', '#4E9C78']; return (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {steps.map((st, i) => (
                <div key={st.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: `${Math.max(18, Math.min(100, (st.v / base) * 100)) * 0.6}%`, background: shades[i], borderRadius: 4, padding: '1px 6px', color: '#fff', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.v}</div>
                  <div style={{ fontSize: 10, color: 'var(--soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.l}</div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}><span style={{ color: 'var(--muted)' }}>{tx('pos.completion_rate')}</span><b style={{ color: '#1F7A3F' }}>{funnel.started ? `${funnel.completionRatePercent}%` : '—'}</b></div>
            </div>
          ); })()}
        </section>
        <section className="co-card">
          {/* §52: projected value of the work on the floor — NOT settled revenue */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}><h2 style={h2}>{tx('pos.potential_revenue_in_progress')}</h2><b style={{ font: '700 15px/1 "Playfair Display",serif', color: '#1F7A3F', flex: 'none' }}>{m2(pot.totalCents)}</b></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 10.5, marginTop: 3 }}>
            {[[tx('pos.in_service_3'), pot.inServiceCents], [tx('pos.add_ons_pending'), pot.addOnsPendingCents], [tx('pos.finishing_soon'), pot.finishingSoonCents], [tx('pos.ready_to_complete'), pot.readyToCompleteCents]].map(([l, v]) => <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{l}</span><b>{m2(Number(v))}</b></div>)}
          </div>
        </section>
      </div>

      {/* Quick Actions — always visible, contextual ones off with no guest (§68–§71) */}
      <div className="co-qa" data-testid="serving-quick-actions">
        {QA.map((q) => (
          <button key={q.l} type="button" onClick={q.fn} aria-disabled={!q.enabled} className="dqa co-card" style={q.enabled ? undefined : off}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={q.d} /></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{q.l}</span>
          </button>
        ))}
      </div>

      {/* ---- overlays (the page never grows) ---- */}
      {overlay?.kind === 'floor' ? <OverlayBox onClose={closeOverlay} title={tx('ops.serving.floorTitle')} sub={String(s.tickets.pagination?.totalItems ?? items.length)} wide>{full == null ? <div style={{ padding: 16, color: 'var(--muted)' }}>{tx('pos.loading_serving')}</div> : floorTable(full, true)}</OverlayBox> : null}

      {overlay?.kind === 'manage' ? (
        <OverlayBox onClose={closeOverlay} title={`${tx('pos.manage')} · ${manageT?.customerName ?? ''}`} sub={manageT ? `${manageT.ticketNumber} · ${floorLabel(manageT.stage || '')}` : undefined}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody><tr><td style={{ padding: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.delay_reason_clear_note')}</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('pos.reason_or_note')} style={inputStyle} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.extra_minutes_delay')}</span><input value={delayMin} onChange={(e) => setDelayMin(e.target.value)} placeholder={tx('admin.form.example', { value: '15' })} inputMode="numeric" style={inputStyle} /></label>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button disabled={busyId === overlay.id + 'delay'} style={{ ...orangeBtn, minHeight: 44 }} onClick={() => doReportDelay(overlay.id)}>{tx('pos.report_delay')}</button>
              <button disabled={busyId === overlay.id + 'cleardelay'} style={{ ...ghostBtn, minHeight: 44 }} onClick={() => doClearDelay(overlay.id)}>{tx('pos.clear_delay')}</button>
              <button style={{ ...ghostBtn, minHeight: 44 }} onClick={() => { selectTicket(overlay.id); openUpsell(); }}>{tx('pos.sell_product')}</button>
              {manageT ? <button style={{ ...ghostBtn, minHeight: 44, borderColor: 'var(--line)' }} title={tx('pos.open_full_ipad_view')} onClick={() => { setOverlay(null); openIPad(checkoutTicketRequest({ ticketId: manageT.ticketId, ticketNumber: manageT.ticketNumber, customer: { fullName: manageT.customerName, isVip: manageT.isVip, phone: manageT.customerPhone } })); }}>{tx('pos.full_view')}</button> : null}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'end', marginTop: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}><span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{tx('pos.assign_change_helper_technician')}</span>
                <select value={helperSel} onChange={(e) => setHelperSel(e.target.value)} style={inputStyle}><option value="">{tx('pos.select_helper')}</option><option value="__none__">{tx('pos.remove_helper')}</option>{roster.map((r) => <option key={r.technicianId} value={r.technicianId}>{r.displayName}</option>)}</select>
              </label>
              <button disabled={busyId === overlay.id + 'helper'} style={{ ...ghostBtn, minHeight: 44 }} onClick={() => doHelper(overlay.id)}>{tx('pos.apply_helper')}</button>
            </div>
          </td></tr></tbody></table>
        </OverlayBox>
      ) : null}

      {/* §31: Move Stage — only the legal next states for this guest and this user */}
      {overlay?.kind === 'move' && selId ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serving.moveStageTitle', { name: selTicket?.customerName ?? cust?.fullName ?? '' })} sub={selTicket ? floorLabel(selTicket.stage || '') : undefined}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="sv-move-menu">
            {allowed.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{tx('ops.serving.noLegalMove')}</div> : allowed.map((ac) => (
              <button key={ac} data-action={ac} style={{ ...(ac === 'mark_ready' || ac === 'start' || ac === 'send_to_service_done' ? orangeBtn : ghostBtn), minHeight: 48, fontSize: 13, textAlign: 'left', padding: '0 14px' }} disabled={busyId === selId + ac} onClick={() => doAction(selId, ac)}>{ACTION_LABEL[ac]}</button>
            ))}
          </div>
        </OverlayBox>
      ) : null}

      {/* §46–§49: Add Upsell — add-on service (catalog price, line owner) or a retail product (its own line kind) */}
      {overlay?.kind === 'upsell' && selId ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serving.upsellTitle')} sub={tx('ops.serving.upsellSub')}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['addon', 'retail'] as const).map((tb) => <button key={tb} aria-pressed={upTab === tb} onClick={() => setUpTab(tb)} style={{ ...(upTab === tb ? orangeBtn : ghostBtn), minHeight: 44 }}>{tb === 'addon' ? tx('ops.serving.addOnTab') : tx('ops.serving.retailTab')}</button>)}
          </div>
          {upTab === 'addon' ? (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>{tx('ops.serving.doneBy')}
                <select aria-label={tx('ops.serving.doneBy')} value={upTech} onChange={(e) => setUpTech(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                  {detail?.primaryTechnician ? <option value={detail.primaryTechnician.technicianId}>{detail.primaryTechnician.name}</option> : <option value="">—</option>}
                  {roster.filter((r) => r.technicianId !== detail?.primaryTechnician?.technicianId).map((r) => <option key={r.technicianId} value={r.technicianId}>{r.displayName}</option>)}
                </select>
              </label>
              {(detail?.addOnSuggestions || []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tx('ops.serving.noAddOns')}</div> : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="sv-addon-list">
                  {(detail?.addOnSuggestions || []).map((ad) => <button key={ad.serviceId} disabled={busyId === selId + 'addon'} style={{ ...ghostBtn, minHeight: 44, fontSize: 12, padding: '0 12px' }} onClick={() => addAddOn(selId, ad.serviceId, ad.serviceName)}>{ad.serviceName} · {m2(ad.priceCents)}</button>)}
                </div>
              )}
            </>
          ) : (
            <div data-testid="retail-picker">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <ImeSafeInput aria-label={tx('pos.search_products_2')} placeholder={tx('pos.search_products_2')} value={retailSearch} onValue={setRetailSearch} style={{ ...inputStyle, flex: 1 }} />
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>{tx('pos.qty')}<input aria-label={tx('pos.quantity')} value={retailQty} onChange={(e) => setRetailQty(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 60, marginLeft: 6 }} /></label>
              </div>
              {retailPinAsk ? (
                <div data-testid="retail-manager-pin" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: 8, border: '1px solid var(--line)', borderRadius: 9, background: '#FFF3E8' }}>
                  <span style={{ fontSize: 12.5, flex: 1 }}>{tx('pos.manager_pin_to_sell_past_stock')} · {retailPinAsk.name} · {tx('pos.on_hand')}: {retailPinAsk.onHand}</span>
                  <input aria-label={tx('pos.manager_pin')} placeholder={tx('pos.manager_pin')} type="password" inputMode="numeric" autoComplete="off" value={retailPin} onChange={(e) => setRetailPin(e.target.value)} style={{ ...inputStyle, width: 110 }} />
                  <button style={{ ...ghostBtn, minHeight: 44 }} disabled={!retailPin.trim()} onClick={() => sellRetail(retailPinAsk.tid, retailPinAsk.productId, retailPin.trim())}>{tx('pos.allow')}</button>
                  <button style={{ ...ghostBtn, minHeight: 44 }} onClick={() => setRetailPinAsk(null)}>{tx('pos.cancel')}</button>
                </div>
              ) : null}
              {retailProducts == null ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tx('pos.loading_products')}</div>
                : retailProducts.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tx('pos.no_products_are_set_up_for_1adm')}</div>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{retailProducts.filter((pr) => !retailSearch.trim() || viIncludes(pr.name, retailSearch.trim())).map((pr) => <button key={pr.productId} disabled={busyId === selId + 'retail'} style={{ ...ghostBtn, minHeight: 44, fontSize: 12, padding: '0 12px' }} onClick={() => sellRetail(selId, pr.productId)}>{pr.name} · {m2(pr.retailPriceCents)}</button>)}</div>}
            </div>
          )}
        </OverlayBox>
      ) : null}

      {/* §72: Send Update — the guest's app feed (SMS honestly reports when it is not configured) */}
      {overlay?.kind === 'update' && selId ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serving.updateTitle')} sub={tx('ops.serving.updateSub', { name: selTicket?.customerName ?? cust?.fullName ?? '' })}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{(['status', 'running_late', 'almost_done', 'ready'] as const).map((kd) => <button key={kd} aria-pressed={upd.kind === kd} onClick={() => setUpd((u) => ({ ...u, kind: kd }))} style={{ ...(upd.kind === kd ? orangeBtn : ghostBtn), minHeight: 44 }}>{tx(`ops.serving.kind.${kd}`)}</button>)}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>{(['app', 'sms'] as const).map((ch) => <button key={ch} aria-pressed={upd.channel === ch} onClick={() => setUpd((u) => ({ ...u, channel: ch }))} style={{ ...(upd.channel === ch ? orangeBtn : ghostBtn), minHeight: 44 }}>{tx(`ops.serving.channel.${ch}`)}</button>)}</div>
          <button data-testid="sv-send-update" disabled={busyId === selId + 'update'} style={{ ...orangeBtn, minHeight: 48, width: '100%' }} onClick={() => sendUpdate(selId)}>{tx('pos.send_update')}</button>
        </OverlayBox>
      ) : null}

      {/* §58: Send Staff Alert — one technician of this salon */}
      {overlay?.kind === 'alert' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serving.alertTitle')} sub={tx('ops.serving.alertSub')}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, marginBottom: 8 }}>{tx('ops.serving.alertTech')}
            <select aria-label={tx('ops.serving.alertTech')} value={alertTech} onChange={(e) => setAlertTech(e.target.value)} style={inputStyle}><option value="">—</option>{(roster.length ? roster.map((r) => ({ id: r.technicianId, n: r.displayName })) : staff.map((x) => ({ id: x.technicianId || '', n: x.name }))).filter((x) => x.id).map((x) => <option key={x.id} value={x.id}>{x.n}</option>)}</select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, marginBottom: 10 }}>{tx('ops.serving.alertMessage')}
            <input aria-label={tx('ops.serving.alertMessage')} value={alertMsg} onChange={(e) => setAlertMsg(e.target.value)} maxLength={500} style={inputStyle} />
          </label>
          <button data-testid="sv-send-alert" disabled={busyId === 'alertalert'} style={{ ...orangeBtn, minHeight: 48, width: '100%' }} onClick={sendAlert}>{tx('ops.serving.alertSend')}</button>
        </OverlayBox>
      ) : null}

      {/* §56–§57: Auto Balance — the server's recommendations; each one is applied by a person through assign-technician */}
      {overlay?.kind === 'balance' ? (
        <OverlayBox onClose={closeOverlay} title={tx('ops.serving.balanceTitle')} sub={tx('ops.serving.balanceSub')}>
          {balance == null ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{tx('pos.loading_serving')}</div> : balance.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12 }} data-testid="sv-balance-none">{tx('ops.serving.balanceNone')}</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="sv-balance-list">
              {balance.map((b) => (
                <div key={b.ticketId} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 9, padding: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700 }}>{tx('ops.serving.balanceRow', { guest: b.customerName, from: b.fromTechnicianName || '—', to: b.toTechnicianName })}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.ticketNumber} · {tx(`ops.serving.balanceReason.${b.reason}`)}</div></div>
                  <button disabled={busyId === b.ticketId + 'balance'} style={{ ...orangeBtn, minHeight: 44 }} onClick={() => applyBalance(b)}>{tx('pos.assign')}</button>
                </div>
              ))}
            </div>
          )}
        </OverlayBox>
      ) : null}

      {overlay?.kind === 'insights' ? (
        <OverlayBox onClose={closeOverlay} title={tx('pos.ai_service_insights')}>
          {allInsights.map((raw) => { const ins = { ...raw, ...floorInsight('serving', raw) }; return <div key={ins.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}><div style={{ flex: 1 }}><div style={{ fontSize: 12.5 }}>{ins.text}</div>{ins.sub ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ins.sub}</div> : null}</div>{ins.actionText && raw.route ? <button style={{ ...ghostBtn, minHeight: 44 }} onClick={() => { setOverlay(null); insightAct(raw); }}>{ins.actionText}</button> : null}</div>; })}
        </OverlayBox>
      ) : null}
    </div>
  );
}
