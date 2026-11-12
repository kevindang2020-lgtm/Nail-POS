import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
// one-screen §79 (Nov 6 2026): the queue row's Full View is an icon (its name is the tooltip and the accessible label) — the
// two text buttons ran 59–79 px past the Checkout Queue card
import { FaExpand } from 'react-icons/fa';
import { displayLocale, fmtInZone } from '../i18n/format';
import { viIncludes } from '@aipowersalon/api-contracts';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { createIntentKeys } from '@aipowersalon/api-client';
import { AICheckoutUpsellPanel } from './AICheckoutUpsellPanel';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SkipLineDrawer } from '../components/SkipLineDrawer';
import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { posCheckoutApi, type PaymentMethod, type PosTerminalOption } from '../api/posCheckoutApi';
import { getThisRegister } from '../api/posCustomerDisplaysApi';
import { useAuth } from '../auth/AuthContext';
import { CheckoutDealsPanel, type DiscountItem } from '../components/CheckoutDealsPanel';
import { CustomerDisplayCard, useCustomerDisplays } from './CustomerDisplayCard';
import { MobilePaymentsCard } from '../components/MobilePaymentsCard';
import { PaymentChannelsDialog } from '../components/PaymentChannelsDialog';   // Three Ways to Pay (SUNMI, Nov 9 2026): the three channels, read-only status + the existing actions   // TTP mandate §45/§149–§151: phone claim + Mobile Payments + Send to phone
import { useIPadView } from '../components/IPadViewProvider';
import { checkoutTicketRequest } from '../components/ipad-modules';
import { MembershipCoveragePanel } from './MembershipCoveragePanel';
import { GlobalRewardsTender } from '../components/GlobalRewardsTender';   // Global Loyalty (Oct 30 2026): AI PowerSalon Rewards points as a tender
import { useOfflineSync } from '../hooks/useOfflineSync';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { msg, parts, st, renderMsg, type Msg } from '../i18n/notice';

// POS Checkout — now WIRED against the reconciled posCheckoutApi (real /pos/checkout + /pos/customer-display routes).
// Reads /pos/checkout/state for the list/KPIs/settings/display, and the per-ticket /pos/checkout/tickets/:id detail for
// line items + server-truth totals. Wired actions: set tip (percent / none), change payment method (recalculate),
// take payment (cash / card / gift card / split), apply or clear a discount, send receipt, and send/clear the customer
// display. Money is server-truth — the UI only displays totals returned by the backend. Card/gift/split payments surface
// { configured:false } honestly when the Fiserv processor isn't live (no fake capture). Split requires segments that sum
// to the amount due; a discount over 50% needs override permission (the server enforces both).
type Row = { ticketId: string; ticketNumber: string; customerName: string; customerPhone?: string; isVip?: boolean; station?: string; serviceCount: number; completedAt?: string; finishedAt?: string; subtotalCents?: number; tipCents?: number; discountCents?: number; totalDueCents: number; status: string; primaryTechnicianName?: string; helperTechnicianName?: string; servicesLabel?: string };
type Totals = { subtotalCents: number; tipCents: number; taxCents: number; surchargeCents: number; discountCents?: number; giftCardChargeCents?: number; totalDueCents: number; paymentMethod?: PaymentMethod };
type Detail = {
  ticketId: string; ticketNumber: string; customer: { customerId?: string; fullName: string; isVip: boolean; phone?: string; email?: string; loyaltyTier?: string; loyaltyPoints?: number; visitCount?: number; preferredTechName?: string };
  stationLabel?: string; completedServices: { serviceLineId: string; serviceName: string; category?: string; technicianName?: string; priceCents: number; qty?: number }[];
  promotion?: { code: string; amountCents: number } | null;
  discounts?: DiscountItem[];   // BUILD_PLAN Phase 5: every discount itemized (no fake DISCOUNT chip)
  commission?: { rows: { name: string; nameCode?: 'technician' | 'unassigned' | null; role: string; roleCode?: 'primary' | 'assist'; percent: number }[]; estimatedPayoutCents: number } | null;
  totals: Totals; status: string; receiptDeliveryOptions: { sms: boolean; email: boolean; app: boolean; print: boolean };
  // §24–§27: the server's tenders on this ticket; absent paid/balance = the read failed (shown as unknown, never 0)
  tenders?: { paymentId: string; method: string; amountCents: number; tipCents: number; status: string; createdAt: string; last4?: string | null }[];
  paidCents?: number; balanceCents?: number;
};
type AttentionItem = { type: string; label?: string; guest: string; issue: string; time: string; ticketId?: string; severity?: 'info' | 'warn' | 'danger' };
type StaffRow = { technicianId?: string; name: string; initials?: string; nextAvailable: string; status: string };
type CheckoutState = {
  kpisFull: { ticketsReadyForPayment: number; subtotalCents: number; tipsTodayCents: number; cardSurchargeCollectedCents: number; taxCollectedCents: number; paidTicketsToday: number; failedPaymentsToday: number; pendingPaymentsToday?: number | null; customerDisplayActiveSessions: number; receiptDeliveryRatePercent: number; receiptDeliveryEligible?: number; averageCheckoutSeconds: number; giftCardLoyaltyRedemptionsCents: number; upsellCapturePercent: number };
  kpiTrends?: Record<string, { deltaPercent: number | null; direction?: 'up' | 'down' }>;
  analytics?: { paymentMix: { method: string; count: number; amountCents: number }[]; revenueTrend: { hour: number; amountCents: number }[]; upsellMix?: { category: string; sharePercent: number }[]; conversionPercent?: number | null; conversionDeltaPercent?: number | null; revenueTodayCents?: number; revenueTrendDeltaPercent?: number | null; potentialRevenue?: { totalCents: number; servicesCents: number; retailCents: number; tipsEstCents: number; ticketCount: number } };
  attention?: AttentionItem[];
  staff?: StaffRow[];
  staffSummary?: { total: number; ready: number; busy: number; onBreak: number; shown: number };
  insights?: { id: string; text: string; action?: string; route?: string; severity?: 'info' | 'warn' | 'danger' }[];
  tickets: { items: Row[]; pagination: { totalItems: number } };
  paymentSettings: { cardEnabled: boolean; cashEnabled: boolean; giftCardEnabled: boolean; splitPaymentEnabled: boolean; cardSurchargeEnabled: boolean; cardSurchargePercent: number; taxRatePercent: number; tipsEnabled: boolean; defaultTipPercents: number[]; allowCustomTip: boolean; allowNoTip: boolean; customerDisplayMode: string; fiservStatus: string };
  customerDisplay: { pairedDevices: { deviceId: string; label: string; stationCode: string; paired: boolean }[]; activeSession?: { sessionId: string; ticketId: string; ticketNumber: string; state: string; selectedTipCents: number; totalDueCents: number; paymentMethod?: string } | null };
  filters?: { statuses: string[]; stations: string[]; technicians: string[]; paymentMethods: string[] };
};

const money = (c?: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { TipKeypad, parseDollarsToCents, useEventCallback } from '@aipowersalon/ui';
import { SplitPreviewBox } from './checkout/SplitPreviewBox';
import { GiftReadinessBox } from './checkout/GiftReadinessBox';   // Gift Cards · 03 Checkout Redemption Readiness (read-only preview)

// The ONE shared exact parser (no float money math). Invalid input keeps the old lenient behavior: 0.
const dollarsToCents = (s: string) => parseDollarsToCents(s) ?? 0;

/** A fresh, unguessable attempt key for one terminal tender (Fiserv §7.3: stable per attempt, not per button tap). */
function newAttemptKey(): string {
  try { return globalThis.crypto.randomUUID().replace(/-/g, ''); } catch { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
}

export function POSCheckoutScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<CheckoutState | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Vietnamese POS mandate §105/§108 (WP-D2): banners are kept as KEYS (i18n/notice.ts) and translated when rendered, so a
  // language switch re-words them in place; a server's / an error's own text stays a plain string.
  const [note, setNote] = useState<Msg | null>(null);
  // Functional Decision 22: a card charge whose answer was lost — offer to ask the processor, never to charge again.
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  // Fiserv master build §8B: the front-desk card button charges on the Clover Compact (Bolt) — never an empty token.
  const auth = useAuth();
  const [terminals, setTerminals] = useState<PosTerminalOption[] | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [terminalWaiting, setTerminalWaiting] = useState<string | null>(null);   // label of the terminal prompting now
  const terminalAttempt = useRef<{ ticketId: string; key: string } | null>(null);
  const [search, setSearch] = useState('');
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  // §105: the selected ticket is also in the URL (?ticket=) so a reload / crash comes back to the same ticket
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTicket = searchParams.get('ticket');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [waysOpen, setWaysOpen] = useState(false);   // Three Ways to Pay dialog
  const [cashStr, setCashStr] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [giftPin, setGiftPin] = useState('');
  const [discountStr, setDiscountStr] = useState('');
  const [rewardStr, setRewardStr] = useState('');   // Decision 15: a customer's loyalty reward code
  const [segments, setSegments] = useState<{ method: PaymentMethod; amountStr: string }[]>([]);
  const [channels, setChannels] = useState<Record<string, boolean>>({ sms: false, email: false, app: false, print: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);   // Move to Front Desk: the register picker (Oct 6 2026)
  const [skipDrawer, setSkipDrawer] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [payTypeFilter, setPayTypeFilter] = useState('');   // header "All Payment Types" filter (was a dead no-op)
  const [sigUrl, setSigUrl] = useState<string | null>(null);   // captured card signature (image data URL) currently being viewed
  const [sigOn, setSigOn] = useState<string | null>(null);     // where it was taken: the card terminal, or (older payments) the display
  const { isOffline } = useOfflineSync();
  // TTP mandate §45–§46: a payment phone holding the open ticket — the POS does not start its own payment meanwhile
  const [mobileClaim, setMobileClaim] = useState<{ deviceLabel: string | null; userName: string | null } | null>(null);

  // §46–§47: "Live" is the real connection state, and Auto Refresh is a real switch (on = live events + the safety sync
  // refresh the board in place; off = only the Refresh button does). Never a page reload.
  const [live, setLive] = useState<RealtimeStatus>(() => realtimeStatus());
  useEffect(() => { const h = (e: Event) => setLive((e as CustomEvent<{ status: RealtimeStatus }>).detail.status); window.addEventListener(REALTIME_STATUS, h); return () => window.removeEventListener(REALTIME_STATUS, h); }, []);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => { try { return localStorage.getItem('aps.checkout.autoRefresh') !== 'off'; } catch { return true; } });
  const toggleAutoRefresh = () => setAutoRefresh((v) => { try { localStorage.setItem('aps.checkout.autoRefresh', v ? 'off' : 'on'); } catch { /* per-viewer convenience only */ } return !v; });
  // §17 / §28 / §60: the fixed panels open their full lists in an overlay instead of growing the page
  const [overlay, setOverlay] = useState<null | 'queue' | 'attention' | 'lines' | 'summary'>(null);
  const wsBody = useRef<HTMLDivElement | null>(null);
  const { open: openIPad } = useIPadView();
  const loadState = useCallback((q: { search?: string; status?: string; paymentMethod?: string }) => posCheckoutApi.state(q)
    .then((d) => { setS(d as CheckoutState); setError(null); })
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_checkout'))), []);

  useEffect(() => {
    const t = setTimeout(() => { loadState({ search: search || undefined, status: statusFilter || undefined, paymentMethod: payTypeFilter || undefined }); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadState, search, statusFilter, payTypeFilter]);

  const enabledMethods = useMemo(() => {
    const ps = s?.paymentSettings; const out: { m: PaymentMethod; label: string }[] = [];
    if (ps?.cardEnabled) out.push({ m: 'card', get label() { return tx('pos.card'); } });
    if (ps?.cashEnabled) out.push({ m: 'cash', get label() { return tx('pos.cash'); } });
    if (ps?.giftCardEnabled) out.push({ m: 'gift_card', get label() { return tx('pos.gift_card_2'); } });
    if (ps?.splitPaymentEnabled) out.push({ m: 'split', get label() { return tx('pos.split'); } });
    return out;
  }, [s]);   // labels are getters: translated when rendered (WP-B)

  const loadDetail = useCallback(async (tid: string, preferMethod?: PaymentMethod) => {
    const d = await posCheckoutApi.detail(tid) as Detail;
    setDetail(d);
    // G4 (Nov 5 2026): the customer's per-technician tips from the display, refreshed with the ticket (and on every
    // checkout push). A failed read shows nothing rather than a guess.
    posCheckoutApi.tipSelection(tid).then((r) => setTipSel(r?.selection ?? null)).catch(() => setTipSel(null));
    const m = preferMethod || d.totals.paymentMethod || enabledMethods[0]?.m || 'card';
    setMethod(m);
    setCashStr(((d.totals.totalDueCents || 0) / 100).toFixed(2));
    const rdo = d.receiptDeliveryOptions || { sms: false, email: false, app: false, print: false };
    setChannels({ sms: !!rdo.sms, email: !!rdo.email, app: !!rdo.app, print: false });   // developer merge (Oct 2026): the salon's in-app receipt default is honoured too
    return d;
  }, [enabledMethods]);

  const selectTicket = useEventCallback(async (tid: string) => {
    setSelId(tid); setNote(null); setDetail(null);
    if (searchParams.get('ticket') !== tid) setSearchParams((p) => { const n = new URLSearchParams(p); n.set('ticket', tid); return n; }, { replace: true });
    // if the customer already chose a method on the iPad for this ticket, default the payment form to it
    const sess = s?.customerDisplay.activeSession;
    const prefer = sess && sess.ticketId === tid && (sess.paymentMethod === 'card' || sess.paymentMethod === 'cash') ? (sess.paymentMethod as PaymentMethod) : undefined;
    try { await loadDetail(tid, prefer); } catch (e: any) { setNote(e?.message || msg('pos.failed_to_load_ticket_detail')); return; }
    // B-81 (Oct 23 2026): a card charge still mid-air on this ticket survives a page reload — offer Verify again for a POS
    // card answer, and say plainly when a split, Tap to Pay or a guest's app payment is still being confirmed.
    try {
      const open = await posCheckoutApi.unsettledTenders(tid);
      if (open.some((u) => u.kind === 'payment')) setVerifyFor(tid);
      else if (open.length) setNote(msg('pos.unsettled_tender_elsewhere', { kind: open[0].kind === 'app_intent' ? msg('pos.unsettled_kind_app') : open[0].method === 'tap_to_pay' ? msg('pos.unsettled_kind_ttp') : msg('pos.unsettled_kind_split') }));
    } catch (e: any) { setNote(e?.message || msg('pos.failed_to_load_ticket_detail')); }
    // Put on the deal the customer BOOKED (non-fatal and idempotent: no booked deal → nothing happens). BUILD_PLAN Phase 5,
    // bug 2: a refusal is said out loud — a permission error used to be swallowed and the customer paid full price.
    try {
      const r: any = await posCheckoutApi.applyDeal(tid);
      if (r?.applied && !r?.alreadyApplied) { await loadDetail(tid, prefer); setNote(msg('pos.their_booked_deal_is_on_this_1t64')); }
      else if (r && r.applied === false && r.reason && !/No deal reserved|No appointment/.test(r.reason)) setNote(msg('payment.result.bookedDealNotApplied', { reason: String(r.reason) }));
    } catch (e: any) { if (e?.status === 403) setNote(msg('pos.you_don_t_have_permission_to_8xbn')); }
  });

  const refreshAll = async () => { await loadState({ search: search || undefined, status: statusFilter || undefined, paymentMethod: payTypeFilter || undefined }); if (selId) { try { await loadDetail(selId, method); } catch { /* ignore */ } } };
  const displays = useCustomerDisplays(selId);
  // Realtime: when a payment/checkout event is pushed for this tenant, refresh the board + open ticket.
  useRealtime('checkout', () => (autoRefresh ? refreshAll() : undefined));

  // Auto-select the first ready ticket so the Checkout Workspace is populated on load (reference shows a selected guest).
  // Fires when the board or the selection changes; reads the URL's ticket as it is at that moment.
  const autoSelect = useEventCallback(() => {
    if (selId || !s) return;
    if (urlTicket) { selectTicket(urlTicket); return; }   // §105: back to the ticket the URL names (it may have left the board — its detail still loads)
    if (s.tickets?.items?.length) { const first = s.tickets.items[0]; if (first) selectTicket(first.ticketId); }
  });
  useEffect(() => { autoSelect(); }, [s, selId, autoSelect]);

  // G4 follow-up (Nov 5 2026): the customer's per-technician tips are still a DRAFT on the display → the server refuses a
  // front-desk tender (TECH_TIPS_NOT_CONFIRMED). The cashier either asks the customer to confirm there, or confirms ON THEIR
  // BEHALF with a reason — recorded with the cashier's name, never as the customer's confirmation.
  const [tipAsk, setTipAsk] = useState<{ reason: string } | null>(null);
  const [tipSel, setTipSel] = useState<Awaited<ReturnType<typeof posCheckoutApi.tipSelection>>['selection']>(null);
  const staffTip = useRef<{ reason: string } | null>(null);
  useEffect(() => {
    if (method !== 'card' || !selId) return;
    let live = true;
    posCheckoutApi.terminals().then((list) => {
      if (!live) return;
      const all = list || []; const usable = all.filter((x) => !x.disabled);
      setTerminals(all);
      // keep the cashier's pick while it is still usable; one usable terminal is simply selected
      setTerminalId((cur) => (cur && usable.some((x) => x.id === cur) ? cur : usable.length === 1 ? usable[0].id : null));
    }).catch(() => { if (live) setTerminals([]); });
    return () => { live = false; };
  }, [method, selId]);
  const cancelOnTerminal = () => {
    if (!selId) return;
    void posCheckoutApi.cancelTerminal(selId).then((r) => setNote(r?.cancelled ? msg('payment.terminal.cancelSent') : msg('payment.terminal.cancelFailed', { reason: String(r?.reason || '') }))).catch((e: any) => setNote(msg('payment.terminal.cancelFailed', { reason: String(e?.message || '') })));
  };

  const run = async (key: string, fn: () => Promise<any>, after?: (r: any) => void) => {
    setNote(null); setBusy(key);
    try { const r = await fn(); if (after) after(r); }
    catch (e: any) {
      setNote(e?.message || msg('pos.action_failed'));
      if (key === 'pay' && e?.code === 'TECH_TIPS_NOT_CONFIRMED') setTipAsk({ reason: '' });
      // Smooth Refresh spec §76: another station paid or changed this visit first — show the server's truth at once
      // (only this board + the open ticket, no page reload) instead of leaving a stale total on screen.
      if (e?.status === 409 && e?.code === 'CHECKOUT_ALREADY_IN_PROGRESS') void refreshAll();
    }
    finally { setBusy(null); }
  };

  const changeMethod = (m: PaymentMethod) => {
    if (!selId) return;
    setMethod(m);
    run('recalc', () => posCheckoutApi.recalculate(selId, m), async () => {
      const d = await loadDetail(selId, m);
      if (m === 'split') setSegments([{ method: 'card', amountStr: ((d.totals.totalDueCents || 0) / 100).toFixed(2) }]);
    });
  };
  const setTipPercent = (p: number) => { if (!selId) return; run('tip', () => posCheckoutApi.applyTip(selId, { tipType: 'percent', tipPercent: p, source: 'front_desk' }), () => loadDetail(selId, method)); };
  const setNoTip = () => { if (!selId) return; run('tip', () => posCheckoutApi.applyTip(selId, { tipType: 'none', source: 'front_desk' }), () => loadDetail(selId, method)); };
  const applyDiscount = () => { if (!selId) return; run('discount', () => posCheckoutApi.applyDiscount(selId, { discountCents: dollarsToCents(discountStr) }), async () => { setNote(msg('pos.discount_of_discountstr_applied', { discountStr: String(money(dollarsToCents(discountStr))) })); await loadDetail(selId, method); }); };
  // Decision 15 loyalty step: the server checks the code belongs to this customer, is unused, unexpired and worth
  // something, reserves it to this ticket and takes it off LAST; it is spent only when the ticket is paid.
  const applyReward = () => { if (!selId || !rewardStr.trim()) return; run('reward', () => posCheckoutApi.applyRewardCode(selId, rewardStr), async () => { setRewardStr(''); setNote(msg('pos.reward_applied')); await loadDetail(selId, method); }); };
  const removeReward = () => { if (!selId) return; run('reward', () => posCheckoutApi.removeRewardCode(selId), async () => { setNote(msg('pos.reward_removed_the_code_can_be_87u2')); await loadDetail(selId, method); }); };
  const clearDiscount = () => { if (!selId) return; setDiscountStr(''); run('discount', () => posCheckoutApi.applyDiscount(selId, { discountCents: 0 }), async () => { setNote(msg('pos.discount_cleared')); await loadDetail(selId, method); }); };

  // One Idempotency-Key per payment INTENT (ticket + method + exact body): a retry after a lost answer re-sends the same
  // key and gets the original result; a changed amount/card is a new intent with a new key; success releases it.
  const payKeys = useRef(createIntentKeys());
  const keyed = (body: unknown) => { const intent = `pay:${selId}:${method}`; return { key: payKeys.current.keyFor(intent, body), done: () => payKeys.current.done(intent) }; };
  const takePayment = () => {
    if (isOffline) { setNote(msg('pos.financial_actions_are_disabled_in_offline_10x1')); return; }
    if (!selId || !detail) return;
    // §35 / §108: a card charge on this ticket is UNKNOWN — no new tender until it is verified (the server guards it too)
    if (verifyFor && verifyFor === selId) { setNote(msg('payment.unknown.completeBlocked')); return; }
    if (mobileClaim) { setNote(msg('pos.payment_in_progress_on_v0_v1_1fr4', { v0: mobileClaim.deviceLabel || msg('pos.a_payment_phone'), v1: String(mobileClaim.userName ? ` · ${mobileClaim.userName}` : '') })); return; }
    const onBehalf = staffTip.current ? { staffTipConfirmation: staffTip.current } : {}; staffTip.current = null; setTipAsk(null);
    if (method === 'cash') {
      const body = { amountReceivedCents: dollarsToCents(cashStr), ...onBehalf }; const k = keyed(body);
      run('pay', () => posCheckoutApi.payCash(selId, body, k.key), async (r) => { k.done(); setNote(msg('pos.cash_payment_recorded_change_due_changeduecents_yw2h', { changeDueCents: String(money(r?.changeDueCents)) })); await refreshAll(); });
    } else if (method === 'gift_card') {
      if (!giftCode.trim()) { setNote(msg('pos.enter_a_gift_card_code')); return; }
      const body = { giftCardCode: giftCode.trim(), pin: giftPin.trim() || undefined, ...onBehalf }; const k = keyed(body);
      run('pay', () => posCheckoutApi.payGiftCard(selId, body, k.key), async (r) => { k.done(); setNote(msg('pos.gift_card_applied_remaining_due_remainingduecents_lyk0', { remainingDueCents: String(money(r?.remainingDueCents)), giftRemainingCents: String(money(r?.giftRemainingCents)) })); await refreshAll(); });
    } else if (method === 'split') {
      const segs = segments.map((sg) => ({ method: sg.method, amountCents: dollarsToCents(sg.amountStr) }));
      const sum = segs.reduce((a, sg) => a + sg.amountCents, 0);
      const due = detail.totals.totalDueCents || 0;
      if (segs.length === 0) { setNote(msg('pos.add_at_least_one_split_segment')); return; }
      if (sum !== due) { setNote(msg('pos.split_must_total_the_amount_due_v7ux', { sum: String(money(sum)), due: String(money(due)), v2: String(money(Math.abs(sum - due))) })); return; }
      const k = keyed({ segments: segs, ...onBehalf });
      run('pay', () => posCheckoutApi.paySplit(selId, { segments: segs, ...onBehalf }, k.key), async (r) => {
        k.done();
        if (r && r.configured === false) setNote(r.disabledReason || msg('pos.a_split_method_is_not_configured_182f'));
        else setNote(msg('payment.result.splitRecorded', { status: st('payment', String(r?.status || 'recorded')), count: segs.length }));
        await refreshAll();
      });
    } else {
      // Card = the Clover Compact at this location (Fiserv §7 / §8B). One attempt key per tender: a retry after a lost
      // answer re-sends the SAME key and gets the recorded outcome; a definitive answer starts a fresh key next time.
      const tid = selId;
      // Merge fix (Nov 7 2026): a tap before the terminal list has loaded must not read as "no terminal paired" —
      // load it now (the same call the picker makes) and decide on the real list.
      if (terminals === null) {
        setBusy('pay');
        void posCheckoutApi.terminals().then((list) => { setTerminals(list || []); return list || []; }, () => { setTerminals([]); return [] as PosTerminalOption[]; })
          .then((list) => { setBusy(null); if (list.some((x) => !x.disabled)) payOnTerminal(tid, list, onBehalf); else setNote(msg('payment.terminal.none')); });
        return;
      }
      payOnTerminal(tid, terminals, onBehalf);
    }
  };
  const payOnTerminal = (tid: string, list: PosTerminalOption[], onBehalf: { staffTipConfirmation?: { reason: string } }) => {
    {
      const live = list.filter((x) => !x.disabled);
      if (!live.length) { setNote(msg('payment.terminal.none')); return; }
      const chosen = live.find((x) => x.id === terminalId) || null;
      const register = auth?.principal?.branchId ? getThisRegister(String(auth.principal.branchId)) : null;
      if (!terminalAttempt.current || terminalAttempt.current.ticketId !== tid) terminalAttempt.current = { ticketId: tid, key: newAttemptKey() };
      const attemptKey = terminalAttempt.current.key;
      setTerminalWaiting((chosen || live.find((x) => x.stationId && x.stationId === register) || live[0]).label);
      run('pay', () => posCheckoutApi.payTerminal(tid, { attemptKey, terminalId: chosen?.id ?? null, stationId: register, ...onBehalf }).catch((e: any) => {
        // The request left the POS but no answer came back: the card may have been charged — verify, never pay again.
        if (!e?.status || e.status >= 500) { setVerifyFor(tid); return { status: 'unknown', next: 'verify', message: e?.message || '' }; }
        throw e;
      }), async (r: any) => {
        setTerminalWaiting(null);
        const reason = String(r?.message || '');
        if (r?.status === 'approved') { terminalAttempt.current = null; setVerifyFor(null); setNote(msg('payment.terminal.approved', { amount: String(money(r?.amountCents || 0)) })); }
        else if (r?.status === 'declined') { terminalAttempt.current = null; setNote(msg('payment.terminal.declined', { reason })); }
        else if (r?.status === 'unknown') { setVerifyFor(tid); setNote(msg('payment.terminal.unknown', { reason })); }   // keep the key: a retry must not charge again
        else if (r?.status === 'cancelled') { terminalAttempt.current = null; setNote(msg('payment.terminal.cancelled')); }
        else if (r?.status === 'in_progress') { terminalAttempt.current = null; setNote(msg('payment.terminal.inProgress', { reason })); }
        else { terminalAttempt.current = null; setNote(msg('payment.terminal.unavailable', { reason })); }
        await refreshAll();
      });
    }
  };

  const sendReceipt = () => {
    if (!selId) return;
    const chans = (Object.keys(channels) as ('sms' | 'email' | 'app' | 'print')[]).filter((c) => channels[c]);
    if (chans.length === 0) { setNote(msg('pos.pick_at_least_one_receipt_channel')); return; }
    run('receipt', () => posCheckoutApi.receiptSendAll(selId, { channels: chans }), (r) => {
      if (r && r.configured === false) { setNote(r.disabledReason || msg('pos.receipt_delivery_is_not_configured')); return; }
      // send-all answers per channel: say what happened to EACH — a simulated send (no texting / e-mail provider set up)
      // or a refused channel is NOT "sent" (wave 4 PILOT: this used to claim "Receipt sent via sms, email." always)
      const label = (c: string): Msg => (c === 'sms' || c === 'email' || c === 'app' || c === 'print' ? msg(`payment.channel.${c}`) : c);
      const results: any[] = Array.isArray(r?.results) ? r.results : [];
      if (!results.length) { setNote(msg('pos.receipt_sent_via_v0', { v0: parts(chans.map(label), ', ') })); return; }
      setNote(parts(results.map((x): Msg => {
        if (x?.configured === false) return msg('payment.channel.result', { channel: label(x.channel), result: x.disabledReason || msg('pos.not_configured') });
        if (x?.delivery === 'simulated') return msg('pos.channel_not_sent_no_provider_is_cnpm', { channel: label(x.channel) });
        if (x?.delivery && x.delivery !== 'sent') return msg('pos.channel_not_sent_v1', { channel: label(x.channel), v1: String(x.reason || x.delivery) });
        return msg('pos.channel_sent', { channel: label(x.channel) });
      }), ' · '));
    });
  };

  // 23-inch spec §81–§83: the workspace's To Display / Clear Display and the Customer Display card are ONE model — this POS's
  // register, its display (dedicated first, else shared), the display the open ticket is on
  const reloadBoard = () => loadState({ search: search || undefined, status: statusFilter || undefined, paymentMethod: payTypeFilter || undefined });
  const sendToDisplay = () => { if (selId) run('disp', () => displays.send(selId), async (msg: string) => { setNote(msg); await reloadBoard(); }); };
  const clearDisplay = () => { if (displays.ticketSession) run('disp', () => displays.cancel(), async (msg: string) => { setNote(msg); await reloadBoard(); }); };
  // §83: no display that can take the customer → To Display is off, and LOOKS off (the reason is in its tooltip)
  const toDisplayOff = busy === 'disp' || !selId || !displays.mine?.online || !!displays.mine?.maintenance;
  const viewSignature = () => { if (!selId) return; run('sig', () => posCheckoutApi.signature(selId), (r) => { if (r?.signaturePng) { setSigUrl(r.signaturePng); setSigOn(r.capturedOn ?? null); } else setNote(msg('pos.no_card_signature_was_captured_for_cxvh')); }); };

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_checkout')}</div></div>;

  const ps = s.paymentSettings;
  const k = s.kpisFull;
  const a = s.analytics || { paymentMix: [], revenueTrend: [] };
  const fmtDur = (sec: number) => { const m = Math.floor(sec / 60); const r = Math.round(sec % 60); return m > 0 ? `${m}m ${r}s` : `${r}s`; };
  const trend = (key: string) => s.kpiTrends?.[key];
  const hhmm = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' }); };

  // --- KPI definitions (9). Values from canonical backend kpisFull; day-over-day trend only when the backend supplies it. ---
  const O = 'var(--aps-orange)';
  const I = {
    guests: { bg: '#FBE9E7', fg: '#E5634D', d: 'M9 11a3 3 0 100-6 3 3 0 000 6zm-7 8a7 7 0 0114 0z' },
    receipt: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M5 3h10v16l-2.5-1.5L10 19l-2.5-1.5L5 19zM7 7h6M7 10h6' },
    pay: { bg: '#FDEFE0', fg: '#E8852B', d: 'M3 6h16v10H3zM3 9h16M7 13h3' },
    dollar: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M10 3v14M7 6h4a2 2 0 010 4H8a2 2 0 000 4h5' },
    tip: { bg: '#FDEFE0', fg: '#E8852B', d: 'M10 3l2 5 5 .5-4 3.5 1 5-4-2.5L6 17l1-5-4-3.5 5-.5z' },
    clock: { bg: '#E8F0FB', fg: '#3C7FB6', d: 'M10 4a6 6 0 100 12 6 6 0 000-12zm0 3v3l2 2' },
    gift: { bg: '#FBE9E7', fg: '#E5634D', d: 'M3 8h14v3H3zm1 3h12v6H4zM10 8v9M10 8s-1-4-3-3 0 3 3 3zm0 0s1-4 3-3 0 3-3 3z' },
    upsell: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M3 14l4-4 3 3 6-7M13 6h3v3' },
    delivery: { bg: '#E9F6EC', fg: '#2E9E54', d: 'M3 5h11v8H3zM14 8h3l2 2v3h-5M6 15.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM15 15.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  } as const;
  const kpis: { key: string; l: string; v: string; ico: keyof typeof I; note?: string }[] = [
    { key: 'guestsReady', l: tx('pos.guests_ready_for_checkout'), v: String(k.ticketsReadyForPayment), ico: 'guests' },
    { key: 'completed', l: tx('pos.completed_checkouts_today'), v: String(k.paidTicketsToday), ico: 'receipt' },
    // §15–§16: unresolved payment-domain states from the server (processing / unknown card, split attempt, Tap to Pay, app
    // charge). null = the read failed → '—', never a guessed 0 and never the failed-payment count (the old fallback).
    { key: 'pending', l: tx('pos.pending_payments'), v: k.pendingPaymentsToday == null ? '—' : String(k.pendingPaymentsToday), ico: 'pay', note: k.pendingPaymentsToday == null ? tx('payment.kpi.unreadable') : undefined },
    { key: 'revenue', l: tx('pos.today_s_revenue'), v: money(a.revenueTodayCents ?? k.subtotalCents), ico: 'dollar' },
    { key: 'tips', l: tx('pos.tips_captured'), v: money(k.tipsTodayCents), ico: 'tip' },
    { key: 'avgTime', l: tx('pos.avg_checkout_time'), v: k.averageCheckoutSeconds > 0 ? fmtDur(k.averageCheckoutSeconds) : '—', ico: 'clock', note: k.averageCheckoutSeconds > 0 ? undefined : tx('pos.pending_data') },
    { key: 'redemptions', l: tx('pos.gift_card_loyalty_redemptions'), v: k.giftCardLoyaltyRedemptionsCents > 0 ? money(k.giftCardLoyaltyRedemptionsCents) : '—', ico: 'gift', note: k.giftCardLoyaltyRedemptionsCents > 0 ? undefined : tx('pos.pending_data') },
    { key: 'upsell', l: tx('pos.upsell_at_checkout'), v: k.upsellCapturePercent > 0 ? `${k.upsellCapturePercent}%` : '—', ico: 'upsell', note: k.upsellCapturePercent > 0 ? undefined : tx('pos.pending_data') },
    // §16: delivered ÷ eligible receipt sends today; nothing sent yet → '—' (a 0 % would read as every receipt failing)
    { key: 'receiptRate', l: tx('pos.receipt_delivery_rate'), v: k.receiptDeliveryEligible === 0 ? '—' : `${k.receiptDeliveryRatePercent}%`, ico: 'delivery', note: k.receiptDeliveryEligible === 0 ? tx('payment.kpi.noReceiptsYet') : undefined },
  ];

  // --- queue + attention ---
  const items = s.tickets.items.filter((t) => { const q = search.trim(); return !q || [t.customerName, t.ticketNumber, t.primaryTechnicianName].some((x) => viIncludes(x, q)); });   // accent-insensitive (§41)
  const STATUS_TONE: Record<string, { bg: string; fg: string }> = { ready_for_payment: { bg: '#E9F6EC', fg: '#2E9E54' }, paid: { bg: '#E9F6EC', fg: '#2E9E54' }, ready: { bg: '#E9F6EC', fg: '#2E9E54' }, waiting_payment: { bg: '#FFF4E0', fg: '#B5821F' }, payment_in_progress: { bg: '#FFF4E0', fg: '#B5821F' }, split: { bg: '#EFEAFA', fg: '#6E59C7' }, vip: { bg: '#FBE9E7', fg: '#E5634D' }, failed: { bg: '#FBEAE8', fg: '#C0392B' }, reopened: { bg: '#FFF4E0', fg: '#B5821F' }, on_hold: { bg: '#EEF1F6', fg: '#5B6B82' } };
  // the status stays the canonical code (colour key above); only its words are translated (§20, §62)
  const boardLabel = (code: string, vip?: boolean) => vip ? tx('payment.board.vip') : statusLabel('checkoutTicket', code);
  const actionLabel = (code: string, vip?: boolean) => tx(vip ? 'payment.board.action.priority' : code === 'waiting_payment' || code === 'payment_in_progress' ? 'payment.board.action.continue' : code === 'split' ? 'payment.board.action.resume' : 'payment.board.action.open');
  const attention: AttentionItem[] = s.attention || [];
  // the attention TYPE arrives as an English word from the server — kept as the code (colour key); its words are translated
  const ATT_KEY: Record<string, string> = { 'Payment Unknown': 'payment.attention.paymentUnknown', 'Payment Processing': 'payment.attention.paymentProcessing', 'Refund Uncertain': 'payment.attention.refundUncertain', 'Discount Approval': 'payment.attention.discountApproval', 'Partial Payment': 'payment.attention.partialPayment', 'Failed Receipt': 'payment.attention.failedReceipt', 'Failed Payment': 'payment.attention.failedPayment', 'Split Payment': 'payment.attention.splitPayment', 'Gift Card': 'payment.attention.giftCard' };
  const ATT_TONE: Record<string, { bg: string; fg: string }> = { 'Payment Unknown': { bg: '#FBEAE8', fg: '#C0392B' }, 'Payment Processing': { bg: '#FFF4E0', fg: '#B5821F' }, 'Refund Uncertain': { bg: '#FBEAE8', fg: '#C0392B' }, 'Discount Approval': { bg: '#FFF4E0', fg: '#B5821F' }, 'Partial Payment': { bg: '#E8F0FB', fg: '#3C7FB6' }, 'Failed Receipt': { bg: '#FBEAE8', fg: '#C0392B' }, 'Failed Payment': { bg: '#FBEAE8', fg: '#C0392B' }, 'Split Payment': { bg: '#EFEAFA', fg: '#6E59C7' }, 'Gift Card': { bg: '#E9F6EC', fg: '#2E9E54' } };

  // --- workspace (selected ticket) ---
  const selRow = items.find((x) => x.ticketId === selId);
  const isPaid = selRow?.status === 'paid' || (detail as any)?.status === 'paid';
  const isHeld = selRow?.status === 'on_hold';
  // §35 / §108: this ticket has a card charge whose answer was lost — Complete Checkout stays off until it is verified
  const unknownHere = !!verifyFor && verifyFor === selId;
  const registers = displays.state?.stations ?? [];
  const t = detail?.totals;
  const cust = detail?.customer;
  const lines = detail?.completedServices || [];
  const rewardApplied: { id: string; description?: string; appliedCents: number } | null = ((detail as any)?.discountSnapshot?.applied || []).find((a: any) => a.category === 'loyalty') || null;
  const comm = detail?.commission || null;
  const tipBase = Math.max(0, (t?.subtotalCents || 0)); // tenant rule: post-discount services+products
  const tipPcts = ps.defaultTipPercents?.length ? ps.defaultTipPercents : [15, 18, 20];
  const selectedTipPct = t && tipBase > 0 ? Math.round(((t.tipCents || 0) / tipBase) * 100) : null;

  // --- split payment view ---
  const splitDue = t?.totalDueCents || 0;
  const splitSum = segments.reduce((acc, sg) => acc + dollarsToCents(sg.amountStr), 0);
  const splitOk = segments.length > 0 && splitSum === splitDue;
  const SEG_METHODS: { m: PaymentMethod; label: string }[] = [{ m: 'card', label: tx('pos.card') }, { m: 'cash', label: tx('pos.cash') }, { m: 'gift_card', label: tx('pos.gift') }];

  // --- AI insights (§54–§56): advisory only, 3–5 items, each from a real board signal; an action OPENS something for a
  // person to decide — nothing is applied by itself. Server insights win when the API sends them. ---
  const attCount = (type: string) => attention.filter((x) => x.type === type).length;
  type Insight = { id: string; text: string; action?: string; act?: () => void; route?: string; severity?: 'info' | 'warn' | 'danger' };
  const derivedInsights: Insight[] = [];
  if (attCount('Payment Unknown') > 0) derivedInsights.push({ id: 'unknown', text: tx('payment.insight.verifyUnknown', { count: String(attCount('Payment Unknown')) }), action: tx('payment.insight.review'), act: () => setOverlay('attention'), severity: 'danger' });
  if (attCount('Failed Receipt') > 0) derivedInsights.push({ id: 'receipts', text: tx('payment.insight.failedReceipts', { count: String(attCount('Failed Receipt')) }), action: tx('payment.insight.review'), act: () => setOverlay('attention'), severity: 'warn' });
  if ((k.ticketsReadyForPayment || 0) > 0) derivedInsights.push({ id: 'ready', text: tx('pos.ticketsreadyforpayment_guest_plural_ready_for_checkout_uorm', { ticketsReadyForPayment: String(k.ticketsReadyForPayment), plural: String(k.ticketsReadyForPayment === 1 ? '' : 's') }), action: tx('payment.insight.openQueue'), act: () => setOverlay('queue') });
  const insights: Insight[] = (s.insights && s.insights.length ? s.insights : derivedInsights).slice(0, 5);

  // --- staff (§61): the board carries at most 8 rows + everyone's counts; the full list lives on the Team screen ---
  const staff: StaffRow[] = s.staff || [];
  const staffSum = s.staffSummary;
  const STAFF_KEY: Record<string, string> = { 'Front Desk': 'payment.staff.frontDesk', Ready: 'payment.staff.ready', Busy: 'payment.staff.busy', Break: 'payment.staff.break' };
  const STAFF_TONE: Record<string, { bg: string; fg: string }> = { 'Front Desk': { bg: '#E9F6EC', fg: '#2E9E54' }, Ready: { bg: '#E9F6EC', fg: '#2E9E54' }, Busy: { bg: '#E8F0FB', fg: '#3C7FB6' }, Break: { bg: '#FFF4E0', fg: '#B5821F' } };

  // --- analytics ---
  const MIX_COLOR: Record<string, string> = { card: '#3C7FB6', cash: '#2E9E54', gift_card: '#E8852B', split: '#6E59C7', other: '#C0392B' };
  const mix = (a.paymentMix || []).map((p) => ({ code: p.method, label: statusLabel('paymentMethod', p.method), amount: p.amountCents }));
  const mixTotal = mix.reduce((acc, x) => acc + x.amount, 0);
  const trendPts = a.revenueTrend || [];
  const upsell = a.upsellMix || [];
  const UPSELL_COLOR = ['#E8852B', '#3C7FB6', '#6E59C7', '#2E9E54'];
  const conv = a.conversionPercent ?? null;
  const pot = a.potentialRevenue || { totalCents: 0, servicesCents: 0, retailCents: 0, tipsEstCents: 0, ticketCount: items.length };

  // --- quick actions (§57–§60, §66): every button does its job; none is a dead end ---
  // a ticket action with no ticket selected says so (wave 4 UI sweep: six quick actions did nothing at all)
  const withTicket = (fn: () => void) => () => { if (selId) fn(); else setNote(msg('pos.select_a_ticket_first')); };
  // Apply Discount scrolls INSIDE the workspace body (the page itself never scrolls — scrollIntoView would move it)
  const goDiscount = () => { const body = wsBody.current; const el = document.getElementById('co-discount'); if (body && el) { body.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8), behavior: 'smooth' }); (el.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true }); } };
  // New Checkout = the next guest waiting (never a second ticket for a visit — tickets come from Service Done, §72)
  const nextGuest = () => { const next = items.find((x) => x.ticketId !== selId && x.status !== 'paid') || items[0]; if (next) selectTicket(next.ticketId); else setNote(msg('payment.qa.noReadyGuest')); };
  // CheckOut extras #07 (role-safe quick action explanations): a quick action that cannot run right now says WHY — the
  // missing ticket, an already-paid ticket, offline mode, an unverified card charge, a not-configured merchant or a total
  // still loading — as a visible line + tooltip. The control is never hidden and never silently approves: a tap still
  // shows the same note, and the server still enforces every rule.
  const qaWhy = (k: 'ticket' | 'pay' | 'discount' | 'split'): string | null => {
    if (!selId) return tx('pos.select_a_ticket_first');
    if ((k === 'pay' || k === 'split') && isOffline) return tx('pos.financial_actions_are_disabled_in_offline_10x1');
    if (k !== 'ticket' && isPaid) return tx('payment.qaWhy.paid');
    if (!detail || detail.ticketId !== selId) return k === 'ticket' ? null : tx('payment.qaWhy.totalLoading');
    if (k === 'pay' && unknownHere) return tx('payment.unknown.completeBlocked');
    if (k === 'pay' && method === 'card' && ps.fiservStatus === 'not_configured') return tx('payment.qaWhy.merchantNotConfigured');
    return null;
  };
  const QA: { l: string; d: string; fn: () => void; why?: string | null }[] = [
    { l: tx('pos.new_checkout'), d: 'M9 3a3 3 0 100 6 3 3 0 000-6zM3 17a6 6 0 0112 0M16 6v6M13 9h6', fn: nextGuest },
    { l: tx('pos.apply_discount'), d: 'M5 5h7l5 5-7 7-5-5zM8 8h.01', fn: withTicket(() => { if (isPaid) { setNote(msg('pos.paid_2')); return; } goDiscount(); }), why: qaWhy('discount') },
    // §22–§23: Split Ticket ≠ Split Payment. This button splits the PAYMENT (several tenders for one ticket); splitting a
    // ticket into two bills is not built (a visit has one ticket across the platform) — flagged for the owner.
    { l: tx('pos.split_payment'), d: 'M10 3v14M5 7l-2 3 2 3M15 7l2 3-2 3', fn: withTicket(() => changeMethod('split')), why: qaWhy('split') },
    { l: tx('pos.take_payment'), d: 'M3 6h16v10H3zM3 9h16', fn: withTicket(() => takePayment()), why: qaWhy('pay') },
    { l: tx('pos.send_receipt'), d: 'M3 5l8 6 8-6M3 5h16v10H3z', fn: withTicket(() => sendReceipt()), why: qaWhy('ticket') },
    { l: tx('pos.view_signature'), d: 'M3 15c4-6 6 3 10-2M3 17h14', fn: withTicket(() => viewSignature()), why: qaWhy('ticket') },
    // §58: Rebook goes to the Booking domain with this guest chosen; §59: Open Customer keeps the context (filtered + profile)
    { l: tx('pos.rebook_guest'), d: 'M5 5h12v12H5zM5 9h12M9 3v4M13 3v4', fn: withTicket(() => { const q = new URLSearchParams(); if (cust?.customerId) q.set('customerId', cust.customerId); if (cust?.fullName) q.set('customerName', cust.fullName); if (cust?.phone) q.set('customerPhone', cust.phone); nav('/booking/new' + (q.toString() ? '?' + q.toString() : '')); }), why: qaWhy('ticket') },
    { l: tx('pos.open_customer'), d: 'M10 10a3 3 0 100-6 3 3 0 000 6zm-6 8a6 6 0 0112 0', fn: withTicket(() => { const q = new URLSearchParams(); if (cust?.fullName) q.set('q', cust.fullName); if (cust?.customerId) q.set('customerId', cust.customerId); nav('/customers' + (q.toString() ? '?' + q.toString() : '')); }), why: qaWhy('ticket') },
    // §60: an authoritative read-only summary, re-read from the server when it opens
    { l: tx('pos.view_summary'), d: 'M4 4h12v12H4zM7 8h6M7 11h6', fn: withTicket(() => { if (selId) void loadDetail(selId, method).catch(() => undefined); setOverlay('summary'); }), why: qaWhy('ticket') },
  ];

  const card: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 10 };
  const anaCard: CSSProperties = { ...card, padding: '8px 10px', overflow: 'hidden' };
  const h2: CSSProperties = { font: '700 13.5px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
  const chip = (txt: string, tone: { bg: string; fg: string }) => <span style={{ background: tone.bg, color: tone.fg, borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{txt}</span>;
  const orangeBtn: CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', minHeight: 44 };
  const ghostBtn: CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 9, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 38 };
  const linkBtn: CSSProperties = { ...ghostBtn, border: 'none', padding: '0 2px', minHeight: 30, background: 'transparent' };
  const LIVE_TONE: Record<RealtimeStatus, string> = { CONNECTED: '#2E9E54', RECONNECTING: '#B5821F', DEGRADED: '#B5821F', OFFLINE: '#C0392B' };
  const attIssue = (it: AttentionItem) => it.type === 'Payment Unknown' ? tx('payment.attention.paymentUnknownIssue') : it.type === 'Payment Processing' ? tx('payment.attention.paymentProcessingIssue') : it.type === 'Refund Uncertain' ? tx('payment.attention.refundUncertainIssue') : it.issue;
  const LINES_ON_BOARD = 6;   // §19: a big ticket (20+ lines) opens its lines in an overlay — the workspace stays compact
  const discountTotal = detail?.totals?.discountCents || (detail?.discounts ?? []).reduce((n, d) => n + d.amountCents, 0);
  const initials = (name: string) => (name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('');

  const queueTable = (rows: Row[]) => (
    <table className="co-tbl">
      <thead><tr>{/* §79 one-screen (Nov 6 2026): the technician sits under the guest (as on Service Done) — a column of its own pushed the
          row's actions past the card */}{[tx('pos.time'), tx('pos.guest'), tx('pos.services'), tx('pos.total'), tx('pos.status'), 'Actions'].map((hh, i) => <th key={i} className={i === 2 ? 'co-svc' : undefined} style={{ textAlign: i === 3 ? 'right' : 'left' }}>{hh === 'Actions' ? <span className="sr-only">{tx('pos.actions')}</span> : hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => { const sel = r.ticketId === selId; const tone = r.isVip ? STATUS_TONE.vip : STATUS_TONE[r.status] || STATUS_TONE.ready_for_payment; return (
          <tr key={r.ticketId} className="co-row" onClick={() => { selectTicket(r.ticketId); setOverlay(null); }} style={{ background: sel ? '#FCF3E4' : 'transparent' }}>
            <td style={{ color: 'var(--muted)' }}>{hhmm(r.finishedAt || r.completedAt)}</td>
            <td><div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}><span style={{ width: 18, height: 18, borderRadius: 99, background: '#ECE3D5', color: 'var(--g7)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initials(r.customerName)}</span><span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.customerName}</span><span style={{ fontSize: 10, color: 'var(--soft)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.primaryTechnicianName || undefined}>{r.primaryTechnicianName || tx('pos.any_tech_2')}</span></span></div></td>
            <td className="co-svc" style={{ color: 'var(--soft)', maxWidth: 120 }} title={r.servicesLabel || undefined}>{r.servicesLabel || tx('pos.servicecount_svc', { serviceCount: String(r.serviceCount) })}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.totalDueCents)}</td>
            <td>{chip(boardLabel(r.status, r.isVip), tone)}</td>
            <td className="co-acts" style={{ maxWidth: 'none' }}><button style={{ ...ghostBtn, minHeight: 32 }} onClick={(e) => { e.stopPropagation(); selectTicket(r.ticketId); setOverlay(null); }}>{actionLabel(r.status, r.isVip)}</button> <button style={{ ...ghostBtn, minHeight: 32, width: 32, padding: 0 }} title={tx('pos.open_full_ipad_view')} aria-label={tx('pos.full_view')} data-testid="co-row-full-view" onClick={(e) => { e.stopPropagation(); openIPad(checkoutTicketRequest({ ticketId: r.ticketId, ticketNumber: r.ticketNumber, customer: { fullName: r.customerName, isVip: r.isVip, phone: r.customerPhone }, totals: { totalDueCents: r.totalDueCents } })); }}><FaExpand aria-hidden="true" /></button></td>
          </tr>
        ); })}
        {rows.length === 0 ? <tr><td colSpan={6} style={{ padding: 14, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.no_guests_ready_for_checkout')}</td></tr> : null}
      </tbody>
    </table>
  );
  const attentionTable = (rows: AttentionItem[]) => (
    <table className="co-tbl">
      <thead><tr>{[tx('pos.type'), tx('pos.guest'), tx('pos.issue'), tx('pos.time')].map((hh) => <th key={hh}>{hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((it, i) => (
          <tr key={i} className="co-row" onClick={() => { if (it.ticketId) { selectTicket(it.ticketId); setOverlay(null); } }} style={{ cursor: it.ticketId ? 'pointer' : 'default' }}>
            <td>{chip(ATT_KEY[it.type] ? tx(ATT_KEY[it.type]) : it.type, ATT_TONE[it.type] || { bg: '#F2ECE0', fg: '#8A7A66' })}</td>
            <td style={{ fontWeight: 600, maxWidth: 110 }}>{it.guest}</td>
            <td style={{ color: 'var(--soft)', maxWidth: 260 }} title={attIssue(it)}>{attIssue(it)}</td>
            <td style={{ color: 'var(--muted)' }}>{it.time || '—'}</td>
          </tr>
        ))}
        {rows.length === 0 ? <tr><td colSpan={4} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>{tx('pos.nothing_needs_attention')}</td></tr> : null}
      </tbody>
    </table>
  );
  const linesTable = (rows: Detail['completedServices']) => (
    <table className="co-tbl">
      <thead><tr>{[tx('pos.item_2'), tx('pos.category'), tx('pos.technician'), tx('pos.qty'), tx('pos.price'), tx('pos.total')].map((hh, i) => <th key={hh} style={{ textAlign: i >= 3 ? 'right' : 'left' }}>{hh}</th>)}</tr></thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.serviceLineId}>
            <td style={{ fontWeight: 600, maxWidth: 200 }}>{l.serviceName}</td>
            <td style={{ color: 'var(--soft)' }}>{l.category || tx('pos.service_3')}</td>
            {/* §20: each line keeps its own technician — the payout follows the line, not the ticket */}
            <td style={{ color: 'var(--soft)' }}>{l.technicianName || '—'}</td>
            <td style={{ textAlign: 'right' }}>{l.qty || 1}</td>
            <td style={{ textAlign: 'right' }}>{money(l.priceCents)}</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(l.priceCents * (l.qty || 1))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const Overlay = ({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) => (
    <div className="co-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={() => setOverlay(null)}>
      <div className="co-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><h2 style={{ ...h2, fontSize: 15 }}>{title}</h2>{sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}<button style={{ ...ghostBtn, marginLeft: 'auto', minHeight: 44, padding: '0 16px' }} onClick={() => setOverlay(null)}>{tx('pos.close')}</button></div>
        <div className="co-scroll">{children}</div>
      </div>
    </div>
  );

  return (
    <div className="checkout-page" data-testid="checkout-page">
      {/* §12: notes float over the board — they never push the layout down */}
      {note ? <div role="status" className="co-toast"><span data-testid="checkout-note" style={{ flex: 1 }}>{renderMsg(note)}</span><button aria-label={tx('pos.close')} onClick={() => setNote(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', minWidth: 32, minHeight: 32 }}>×</button></div> : null}

      {waysOpen ? <PaymentChannelsDialog ticketId={selId} onClose={() => { setWaysOpen(false); void refreshAll(); }} onUseClover={() => { if (method !== 'card') changeMethod('card'); }} /> : null}
      {/* Title + search / filters / live */}
      <div className="co-title">
        <h1>{tx('pos.checkout')}</h1>
        <div className="co-sub">{tx('pos.fast_payment_processing_split_tickets_discounts_fbti')}</div>
        <div className="co-filters">
          <ImeSafeInput type="search" enterKeyHint="search" aria-label={tx('pos.search_checkout')} value={search} onValue={setSearch} placeholder={tx('pos.search_guest_ticket')} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: 'var(--card)', color: 'var(--text)', width: 170 }} />
          <select aria-label={tx('pos.payment_type_filter')} value={payTypeFilter} onChange={(e) => setPayTypeFilter(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 8px', fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}><option value="">{tx('pos.all_payment_types')}</option><option value="card">{tx('pos.card')}</option><option value="cash">{tx('pos.cash')}</option><option value="gift_card">{tx('pos.gift_card_2')}</option><option value="split">{tx('pos.split_payment')}</option></select>
          <span aria-label={tx('pos.checkout_date')} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: 'var(--card)', display: 'inline-flex', alignItems: 'center' }}>{tx('pos.today_v0', { v0: String(fmtInZone(new Date(), { month: 'short', day: '2-digit' })) })}</span>
          <select aria-label={tx('pos.filter_by_status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '0 8px', fontSize: 12, background: 'var(--card)', color: 'var(--text)' }}><option value="">{tx('pos.active_checkout')}</option><option value="ready_for_payment">{tx('pos.ready')}</option><option value="waiting_payment">{tx('pos.waiting_payment')}</option><option value="split">{tx('pos.split_payment')}</option><option value="paid">{tx('pos.completed_2')}</option><option value="failed">{tx('pos.failed_2')}</option><option value="on_hold">{tx('pos.on_hold')}</option></select>
          <span data-testid="checkout-live" data-live={live} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: LIVE_TONE[live], fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ width: 8, height: 8, borderRadius: 99, background: LIVE_TONE[live] }} />{tx(`payment.board.live.${live}`)}</span>
          <button aria-pressed={autoRefresh} data-testid="checkout-auto-refresh" title={tx('payment.board.autoRefreshHint')} onClick={toggleAutoRefresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${autoRefresh ? O : 'var(--line)'}`, borderRadius: 9, padding: '0 10px', fontSize: 12, background: autoRefresh ? '#FCF3E4' : 'var(--card)', color: autoRefresh ? O : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}><span aria-hidden style={{ width: 26, height: 14, borderRadius: 99, background: autoRefresh ? O : '#D8CFC2', position: 'relative', flex: 'none' }}><span style={{ position: 'absolute', top: 2, left: autoRefresh ? 14 : 2, width: 10, height: 10, borderRadius: 99, background: '#fff' }} /></span>{tx('pos.auto_refresh')}</button>
          {/* Three Ways to Pay (SUNMI Nov 9 2026): Clover Compact · Staff iPhone · Customer App — status and hand-off, never a card form */}
          <button data-testid="co-ways-btn" data-module-id="checkout-three-ways" onClick={() => setWaysOpen(true)} title={tx('ways.btnHint')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 9, padding: '0 12px', minHeight: 38, background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{tx('ways.btn')}</button>
          <button aria-label={tx('pos.refresh')} title={tx('pos.refresh')} onClick={() => { void refreshAll(); }} style={{ border: '1px solid var(--line)', borderRadius: 9, width: 38, background: 'var(--card)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.8"><path d="M4 10a6 6 0 0110-4.5M16 10a6 6 0 01-10 4.5M14 3v3h-3M6 17v-3h3" /></svg></button>
        </div>
      </div>

      {/* 9 KPI cards */}
      <div className="co-kpis" data-module-id="checkout-kpis">
        {kpis.map((c) => { const tr = trend(c.key); return (
          <div key={c.key} className="co-card co-kpi">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: I[c.ico].bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={I[c.ico].fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={I[c.ico].d} /></svg></span>
              <span className="co-kpi-l">{c.l}</span>
            </div>
            <div className="co-kpi-v">{c.v}</div>
            <div className="co-kpi-n">
              {tr && tr.deltaPercent != null ? (() => { const good = c.key === 'avgTime' ? tr.direction === 'down' : tr.direction !== 'down'; return <span style={{ color: good ? '#2E9E54' : '#C0392B', fontWeight: 700 }}>{tr.direction === 'down' ? '▼' : '▲'} {Math.abs(tr.deltaPercent)}% <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_yesterday')}</span></span>; })() : <span style={{ color: 'var(--muted)' }}>{c.note || ' '}</span>}
            </div>
          </div>
        ); })}
      </div>

      <div className="co-main">
        {/* Checkout Queue — fixed height, internal scroll (§17) */}
        <section className="co-card co-panel co-q" data-module-id="checkout-queue">
          <div className="co-head"><h2 style={h2}>{tx('pos.checkout_queue')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{items.length}</span></div>
          <div className="co-scroll">{queueTable(items)}</div>
          <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOverlay('queue')}>{tx('payment.board.viewFullQueue', { count: String(s.tickets.pagination?.totalItems ?? items.length) })}</button>
        </section>

        {/* Transactions Needing Attention */}
        <section className="co-card co-panel co-att" data-testid="checkout-attention">
          <div className="co-head"><h2 style={h2}>{tx('pos.transactions_needing_attention')}</h2>{attention.length ? <span style={{ background: '#FBEAE8', color: '#C0392B', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>{attention.length}</span> : null}
            {attention.length ? <button style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => setOverlay('attention')}>{tx('payment.board.viewAllAttention', { count: String(attention.length) })}</button> : null}</div>
          <div className="co-scroll">{attentionTable(attention)}</div>
        </section>

        {/* CENTER — Workspace: fixed header · scrolling body · fixed footer with the totals always in view (§18–§21) */}
        <section className="co-card co-ws" data-testid="checkout-workspace">
          <div className="co-head" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none', marginBottom: 6 }}>
            <h2 style={{ ...h2, whiteSpace: 'nowrap', flex: 'none' }}>{tx('pos.checkout_workspace')}</h2>
            {detail ? <>
              <span style={{ width: 26, height: 26, borderRadius: 99, background: '#ECE3D5', color: 'var(--g7)', fontWeight: 800, fontSize: 10.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initials(cust?.fullName || '?')}</span>
              <span style={{ fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap', flex: 'none', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust?.fullName}</span>
              {cust?.isVip ? chip('VIP', { bg: '#FBE9E7', fg: '#E5634D' }) : null}
              <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>#{detail.ticketNumber} · {cust?.phone || '—'} · <b style={{ color: 'var(--text)' }}>{cust?.loyaltyPoints != null ? cust.loyaltyPoints.toLocaleString() : '—'}</b> {tx('pos.points_2')} · {tx('pos.visits')} <b style={{ color: 'var(--text)' }}>{cust?.visitCount ?? '—'}</b> · {tx('pos.preferred_tech')} <b style={{ color: 'var(--text)' }}>{cust?.preferredTechName || detail.completedServices[0]?.technicianName || '—'}</b></span>
              <span style={{ marginLeft: 'auto', flex: 'none' }}>{isPaid ? chip(tx('payment.badge.paid'), { bg: '#E9F6EC', fg: '#2E9E54' }) : <button style={ghostBtn} onClick={goDiscount}>{tx('pos.apply_discount')}</button>}</span>
            </> : null}
          </div>
          {verifyFor ? (
            // §35: the UNKNOWN-payment banner, in the mandate's exact words — new tender is blocked, Verify Payment is the way on.
            // It sits INSIDE the workspace (the body gives up the room), so the board never grows.
            <div role="alert" data-testid="payment-unknown-banner" style={{ flex: 'none', border: '1px solid #C0392B', background: '#FBEAE8', borderRadius: 10, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>
                <b>{tx('payment.unknown.title')}</b> <b>{tx('payment.unknown.doNotPayAgain')}</b> {tx('payment.unknown.verifyFirst')}
                {busy === 'verify' ? <span style={{ display: 'block', color: 'var(--muted)', marginTop: 2 }}>{tx('payment.unknown.verifying')}</span> : null}
              </span>
              <button className="btn" style={{ minHeight: 44 }} disabled={busy === 'verify'} onClick={() => run('verify', () => posCheckoutApi.verifyCard(verifyFor), async (v: any) => {
                const answer: Record<string, Msg> = {
                  approved: msg('payment.verify.approved'),
                  declined: msg('payment.verify.declined'),
                  failed: msg('payment.verify.failed'),
                  pending: msg('payment.verify.pending', { seconds: Number(v?.retryAfterSeconds ?? 60) }),
                  unknown: v?.reason ? String(v.reason) : msg('payment.verify.unreachable'),
                  none: msg('payment.verify.none'),
                };
                setNote(answer[v?.status] || msg('payment.verify.other', { status: st('payment', String(v?.status)) }));
                if (v?.status !== 'pending' && v?.status !== 'unknown') setVerifyFor(null);
                await refreshAll();
              })}>{tx('payment.unknown.verifyPayment')}</button>
            </div>
          ) : null}
          {tipAsk && detail ? (
            <div role="alert" data-testid="tips-on-behalf" style={{ flex: 'none', border: '1px solid #B8892B', background: '#FFF8E7', borderRadius: 10, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 260px' }}><b>{tx('payment.tipsOnBehalf.title')}</b> {tx('payment.tipsOnBehalf.body')}</span>
              <input aria-label={tx('payment.tipsOnBehalf.reason')} placeholder={tx('payment.tipsOnBehalf.reason')} value={tipAsk.reason} maxLength={300}
                onChange={(e) => setTipAsk({ reason: e.target.value })} style={{ minHeight: 44, flex: '1 1 200px', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px' }} />
              <button className="btn primary" style={{ minHeight: 44 }} disabled={tipAsk.reason.trim().length < 3 || busy === 'pay'}
                onClick={() => { staffTip.current = { reason: tipAsk.reason.trim() }; takePayment(); }}>{tx('payment.tipsOnBehalf.confirm')}</button>
              <button className="btn" style={{ minHeight: 44 }} onClick={() => setTipAsk(null)}>{tx('payment.tipsOnBehalf.cancel')}</button>
            </div>
          ) : null}
          {!detail ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', padding: 20 }}>
              {tx('pos.select_a_guest_from_the_checkout_1ssf')}
            </div>
          ) : (
            <>
              <div className="co-scroll" ref={wsBody} data-testid="checkout-workspace-body">
                {isPaid ? (
                  <div className="bg-[#E9F6EC] border border-[#C8E6C9] rounded-xl p-2 mb-2 flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[#2E9E54] text-white inline-flex items-center justify-center font-extrabold text-xs shrink-0">✓</span>
                    <div className="font-bold text-[#1B5E20] text-[12.5px]">{tx('pos.payment_completed')} <span className="font-normal text-[11px] text-[#2E7D32]">{tx('pos.this_ticket_has_been_paid_in_hps4')}{money(t?.totalDueCents || 0)}{tx('pos.no_further_payment_is_required')}</span></div>
                  </div>
                ) : null}
                {linesTable(lines.slice(0, LINES_ON_BOARD))}
                {lines.length > LINES_ON_BOARD ? <button style={{ ...linkBtn, marginTop: 2 }} data-testid="checkout-lines-more" onClick={() => setOverlay('lines')}>{tx('payment.lines.viewAll', { count: String(lines.length) })}</button> : null}
                {selId ? (
                  <CheckoutDealsPanel ticketId={selId} isPaid={isPaid} discounts={detail.discounts ?? []}
                    onChanged={() => loadDetail(selId, method)} onNote={setNote} onClearManual={clearDiscount} />
                ) : null}
              {/* Payment / Controls section */}
              {isPaid ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mt-2">
                  <div className="lg:col-span-7 bg-[var(--page)] rounded-xl p-3 border border-[var(--line)]">
                    <h3 style={{ ...h2, fontSize: 12, marginBottom: 6 }}>{tx('pos.receipt_delivery_options')}</h3>
                    <div className="flex gap-1.5 flex-wrap sm:flex-nowrap">
                      {(['sms', 'email', 'app'] as const).map((ch) => {
                        // developer merge (Oct 2026): after payment the third channel is the real in-app receipt (send-all 'app'),
                        // each channel toggled on its own — SMS + Email together is still two taps.
                        const labels: Record<string, string> = { sms: tx('payment.channel.sms'), email: tx('payment.channel.email'), app: tx('payment.channel.app') };
                        const on = channels[ch];
                        return (
                          <button
                            key={ch}
                            onClick={() => setChannels((p) => ({ ...p, [ch]: !p[ch] }))}
                            style={{
                              flex: 1,
                              border: `1px solid ${on ? O : 'var(--line)'}`,
                              background: on ? '#FCF3E4' : 'var(--card)',
                              color: on ? O : 'var(--soft)',
                              borderRadius: 8,
                              padding: '6px 0',
                              fontSize: 11.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {labels[ch]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="lg:col-span-5 bg-[var(--page)] rounded-xl p-3 border border-[var(--line)]">
                    <h3 style={{ ...h2, fontSize: 12, margin: '0 0 6px' }}>{tx('pos.commission_preview')}</h3>
                    <div className="space-y-1">
                      {(comm?.rows || []).map((r, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs py-0.5">
                          <span className="font-bold">{r.nameCode ? tx(`ops.checkout.payout.name.${r.nameCode}`) : r.name}</span>
                          {chip(r.roleCode ? tx(`ops.checkout.payout.role.${r.roleCode}`) : r.role, i === 0 ? { bg: '#E9F6EC', fg: '#2E9E54' } : { bg: '#E8F0FB', fg: '#3C7FB6' })}
                          <span className="ml-auto font-bold">{r.percent}%</span>
                        </div>
                      ))}
                      {!comm ? <div className="text-xs text-[var(--muted)]">{tx('pos.estimated_from_payroll_after_payment')}</div> : null}
                      <div className="flex justify-between text-xs font-bold pt-1.5 border-t border-[var(--line)]">
                        <span>{tx('pos.estimated_payout')}</span>
                        <span style={{ color: O }}>{comm ? money(comm.estimatedPayoutCents) : '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Method Selection */}
                  <div className="mt-3">
                    <h3 style={{ ...h2, fontSize: 12, marginBottom: 6 }}>{tx('pos.payment_method_2')}</h3>
                    <div className="flex gap-1.5 flex-wrap">
                      {enabledMethods.map((pm) => {
                        const on = method === pm.m;
                        return (
                          <button
                            key={pm.m}
                            onClick={() => changeMethod(pm.m)}
                            style={{
                              border: `1px solid ${on ? O : 'var(--line)'}`,
                              background: on ? '#FCF3E4' : 'var(--card)',
                              color: on ? O : 'var(--text)',
                              borderRadius: 9,
                              padding: '7px 14px',
                              cursor: 'pointer',
                              fontSize: 12.5,
                              fontWeight: 700,
                            }}
                          >
                            {pm.label}
                          </button>
                        );
                      })}
                    </div>

                    {method === 'card' ? (
                      <div className="mt-2.5 flex flex-col gap-1.5" data-testid="terminal-pay">
                        {terminals && terminals.length === 0 ? (
                          <div className="text-xs text-[var(--muted)] font-bold">{tx('payment.terminal.none')}</div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="text-xs text-[var(--muted)] font-bold" htmlFor="pos-terminal-pick">{tx('payment.terminal.label')}</label>
                            <select id="pos-terminal-pick" aria-label={tx('payment.terminal.label')} value={terminalId ?? ''} onChange={(e) => setTerminalId(e.target.value || null)} disabled={busy === 'pay'}
                              className="border border-[var(--line)] rounded-lg p-1.5 text-xs">
                              <option value="">—</option>
                              {(terminals || []).map((x) => <option key={x.id} value={x.id} disabled={x.disabled}>{x.label}{x.disabled ? ' ' + tx('payment.terminal.disabled') : ''}</option>)}
                            </select>
                            <span className="text-xs text-[var(--muted)]">{tx('payment.terminal.amountOnDevice', { amount: money(t?.totalDueCents || 0) })}</span>
                          </div>
                        )}
                        {ps?.cardSurchargeEnabled && ps.cardSurchargePercent > 0 ? (
                          // Fiserv §9.4 / N.J.S.A. 56:8-156.2: disclosed BEFORE the card is presented. Conditional — the processor
                          // decides per card (credit only), so no exact fee is shown as already assessed.
                          <div role="note" data-testid="surcharge-disclosure" className="text-xs font-bold" style={{ color: 'var(--warn, #8a5a00)' }}>
                            {tx('payment.surcharge.disclosure', { rate: String(ps.cardSurchargePercent) })}
                          </div>
                        ) : null}
                        {busy === 'pay' && terminalWaiting ? (
                          <div className="flex items-center gap-2 flex-wrap" role="status">
                            <span className="text-xs font-bold">{tx('payment.terminal.waiting', { terminal: terminalWaiting })}</span>
                            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={cancelOnTerminal}>{tx('payment.terminal.cancel')}</button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {method === 'cash' ? (
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-[var(--muted)] font-bold">{tx('pos.cash_received')}</label>
                        <span className="inline-flex items-center gap-1">
                          $
                          <input
                            aria-label={tx('pos.cash_received')}
                            value={cashStr}
                            onChange={(e) => setCashStr(e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="w-24 border border-[var(--line)] rounded-lg p-1.5 text-xs text-right"
                          />
                        </span>
                        {(() => {
                          const rec = dollarsToCents(cashStr);
                          const due = t?.totalDueCents || 0;
                          return rec > 0 && rec >= due ? (
                            <span className="text-xs text-[#2E9E54] font-bold">{tx('pos.change')}{' '}{money(rec - due)}</span>
                          ) : null;
                        })()}
                      </div>
                    ) : null}

                    {method === 'gift_card' ? (
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-[var(--muted)] font-bold">{tx('pos.gift_card_code')}</label>
                        <input
                          aria-label={tx('pos.gift_card_code')}
                          autoComplete="off" spellCheck={false} /* GIFT CARDS · 06: a redeemable code is never offered back by browser autocomplete */
                          value={giftCode}
                          onChange={(e) => setGiftCode(e.target.value)}
                          placeholder={tx('pos.enter_code')}
                          className="flex-1 max-w-[220px] border border-[var(--line)] rounded-lg p-1.5 text-xs"
                        />
                        <input
                          aria-label={tx('pos.gift_card_pin')}
                          type="password" inputMode="numeric" autoComplete="off"
                          value={giftPin}
                          onChange={(e) => setGiftPin(e.target.value)}
                          placeholder="PIN"
                          className="w-20 border border-[var(--line)] rounded-lg p-1.5 text-xs font-mono"
                        />
                        <GiftReadinessBox code={giftCode} ticketId={selId} dueCents={detail.balanceCents ?? Math.max(0, (detail.totals.totalDueCents || 0) - (detail.paidCents || 0))} offline={isOffline} phoneClaim={!!mobileClaim} giftEnabled={s?.paymentSettings?.giftCardEnabled} />
                      </div>
                    ) : null}
                  </div>

                  {/* Split Payment & Tips / Commissions */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mt-2">
                    <div className="lg:col-span-7">
                      <h3 style={{ ...h2, fontSize: 12, marginBottom: 6 }}>{tx('pos.split_payment')}</h3>
                      {method !== 'split' ? (
                        <button style={{ ...ghostBtn }} onClick={() => changeMethod('split')}>
                          {tx('pos.enable_split_payment')}
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {segments.map((sg, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1.5 border border-[var(--line)] rounded-lg p-1.5 flex-wrap sm:flex-nowrap"
                            >
                              <select
                                value={sg.method}
                                onChange={(e) =>
                                  setSegments((p) =>
                                    p.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x))
                                  )
                                }
                                className="bg-transparent text-xs font-semibold border-none"
                              >
                                {SEG_METHODS.map((m) => (
                                  <option key={m.m} value={m.m}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                              <span className="ml-auto inline-flex items-center gap-1">
                                $
                                <input
                                  value={sg.amountStr}
                                  onChange={(e) =>
                                    setSegments((p) => p.map((x, j) => (j === i ? { ...x, amountStr: e.target.value } : x)))
                                  }
                                  className="w-16 border border-[var(--line)] rounded px-1.5 py-0.5 text-xs text-right"
                                />
                              </span>
                              <button
                                onClick={() => setSegments((p) => p.filter((_, j) => j !== i))}
                                className="bg-transparent border-none text-[var(--muted)] cursor-pointer px-1"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                            onClick={() => setSegments((p) => [...p, { method: 'cash', amountStr: '' }])}
                          >
                            {tx('pos.add_tender')}
                          </button>
                          <SplitPreviewBox segments={segments} dueCents={splitDue} labels={Object.fromEntries(SEG_METHODS.map((x) => [x.m, x.label]))} />
                          <div className="flex justify-between text-xs font-bold pt-1 border-t border-[var(--line)]">
                            <span>{tx('pos.total_paid')}</span>
                            <span style={{ color: splitOk ? '#2E9E54' : '#C0392B' }}>
                              {money(splitSum)}
                              {!splitOk ? ` / ${money(splitDue)}` : ''}
                            </span>
                          </div>
                        </div>
                      )}

                      <h3 style={{ ...h2, fontSize: 12, margin: '12px 0 6px' }}>{tx('pos.receipt_delivery')}</h3>
                      <div className="flex gap-1.5 flex-wrap sm:flex-nowrap">
                        {(['sms', 'email', 'app'] as const).map((ch) => {
                          const labels: Record<string, string> = { sms: tx('payment.channel.sms'), email: tx('payment.channel.email'), app: tx('payment.channel.both') };
                          const on = ch === 'app' ? channels.sms && channels.email : channels[ch];
                          return (
                            <button
                              key={ch}
                              onClick={() =>
                                ch === 'app'
                                  ? setChannels((p) => ({ ...p, sms: true, email: true }))
                                  : setChannels((p) => ({ ...p, [ch]: !p[ch] }))
                              }
                              style={{
                                flex: 1,
                                border: `1px solid ${on ? O : 'var(--line)'}`,
                                background: on ? '#FCF3E4' : 'var(--card)',
                                color: on ? O : 'var(--soft)',
                                borderRadius: 8,
                                padding: '6px 0',
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {labels[ch]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="lg:col-span-5">
                      <h3 style={{ ...h2, fontSize: 12, marginBottom: 6 }}>{tx('pos.quick_tip')}</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {tipPcts.slice(0, 3).map((p) => {
                          const on = selectedTipPct === p;
                          return (
                            <button
                              key={p}
                              disabled={busy === 'tip'}
                              onClick={() => setTipPercent(p)}
                              style={{
                                border: `1px solid ${on ? O : 'var(--line)'}`,
                                background: on ? '#FCF3E4' : 'var(--card)',
                                color: on ? O : 'var(--text)',
                                borderRadius: 9,
                                padding: '7px 0',
                                cursor: 'pointer',
                                textAlign: 'center',
                              }}
                            >
                              <div style={{ fontWeight: 800, fontSize: 13 }}>{p}%</div>
                              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                                {money(Math.round(tipBase * (p / 100)))}
                              </div>
                            </button>
                          );
                        })}
                        <button
                          disabled={busy === 'tip'}
                          onClick={() => setCustomTipOpen(true)}
                          style={{
                            border: '1px solid var(--line)',
                            background: 'var(--card)',
                            borderRadius: 9,
                            padding: '7px 2px',
                            cursor: 'pointer',
                            textAlign: 'center',
                            minWidth: 0,
                          }}
                        >
                          <div style={{ fontWeight: 800, fontSize: 'clamp(10.5px, 0.75vw, 12px)', overflowWrap: 'anywhere' }}>{tx('pos.custom_2')}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>✎</div>
                        </button>
                      </div>

                      {customTipOpen ? (
                        <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
                          <TipKeypad
                            onCancel={() => setCustomTipOpen(false)}
                            onApply={(cents) => {
                              setCustomTipOpen(false);
                              if (selId)
                                run(
                                  'tip',
                                  () =>
                                    posCheckoutApi.applyTip(selId, {
                                      tipType: 'custom',
                                      tipAmountCents: cents,
                                      source: 'front_desk',
                                    }),
                                  () => loadDetail(selId, method)
                                );
                            }}
                          />
                        </div>
                      ) : null}

                      {ps.allowNoTip ? (
                        <button
                          disabled={busy === 'tip'}
                          onClick={setNoTip}
                          style={{ ...ghostBtn, width: '100%', marginTop: 6, padding: '6px 0', fontSize: 12 }}
                        >
                          {tx('pos.no_tip')}
                        </button>
                      ) : null}

                      {tipSel ? (
                        <div data-testid="customer-tip-selection" className="bg-[var(--page)] rounded-xl p-2 border border-[var(--line)] mt-2 text-xs">
                          <div className="flex items-center gap-1.5 font-bold">
                            {tx('payment.customerTips.title')}
                            <span style={{ marginLeft: 'auto', fontWeight: 700, color: tipSel.stale || tipSel.state === 'DRAFT' ? '#B8892B' : tipSel.state === 'SUPERSEDED' ? 'var(--muted)' : '#2E9E54' }}>
                              {tipSel.stale ? tx('payment.customerTips.stale') : tx('payment.customerTips.state.' + tipSel.state)}{tipSel.source === 'staff' ? ` · ${tx('payment.customerTips.byStaff')}` : ''}
                            </span>
                          </div>
                          {tipSel.technicians.map((t) => (
                            <div key={t.technicianId} className="flex items-center py-0.5"><span>{t.name}</span><span style={{ marginLeft: 'auto', fontWeight: 700 }}>{t.tipType === 'none' ? tx('pos.no_tip') : money(t.tipCents)}{t.tipType === 'percent' && t.percent != null ? ` (${t.percent}%)` : ''}</span></div>
                          ))}
                          <div className="flex items-center pt-1 border-t border-[var(--line)] font-bold"><span>{tx('payment.customerTips.total')}</span><span style={{ marginLeft: 'auto' }}>{money(tipSel.totalTipCents)}</span></div>
                        </div>
                      ) : null}

                      <h3 style={{ ...h2, fontSize: 12, margin: '12px 0 6px' }}>
                        {tx('pos.commission_preview')}{' '}
                        {comm ? null : <span className="text-[9.5px] text-[var(--muted)] font-normal">{tx('pos.pending_payroll_wiring')}</span>}
                      </h3>
                      <div className="bg-[var(--page)] rounded-xl p-2.5 border border-[var(--line)] space-y-1">
                        {(comm?.rows || []).map((r, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs py-0.5">
                            <span className="font-bold">{r.nameCode ? tx(`ops.checkout.payout.name.${r.nameCode}`) : r.name}</span>
                            {chip(r.roleCode ? tx(`ops.checkout.payout.role.${r.roleCode}`) : r.role, i === 0 ? { bg: '#E9F6EC', fg: '#2E9E54' } : { bg: '#E8F0FB', fg: '#3C7FB6' })}
                            <span className="ml-auto font-bold">{r.percent}%</span>
                          </div>
                        ))}
                        {!comm ? <div className="text-xs text-[var(--muted)]">{tx('pos.estimated_from_payroll_after_payment')}</div> : null}
                        <div className="flex justify-between text-xs font-bold pt-1 border-t border-[var(--line)]">
                          <span>{tx('pos.estimated_payout')}</span>
                          <span style={{ color: O }}>{comm ? money(comm.estimatedPayoutCents) : '—'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {selId ? (
                    <MembershipCoveragePanel ticketId={selId} />
                  ) : null}

                  <div id="co-discount" className="flex items-center gap-2 mt-3 flex-wrap">
                    <label className="text-xs text-[var(--muted)] font-bold">{tx('pos.manual_discount')}</label>
                    <span className="inline-flex items-center gap-1">
                      $
                      <input
                        aria-label={tx('pos.discount_amount')}
                        value={discountStr}
                        onChange={(e) => setDiscountStr(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-24 border border-[var(--line)] rounded-lg p-1.5 text-xs text-right"
                      />
                    </span>
                    <button
                      disabled={busy === 'discount' || !selId || !discountStr.trim()}
                      onClick={applyDiscount}
                      style={{ ...ghostBtn, padding: '6px 12px' }}
                    >
                      {tx('pos.apply_2')}
                    </button>
                    <button
                      disabled={busy === 'discount' || !selId}
                      onClick={clearDiscount}
                      style={{ ...ghostBtn, padding: '6px 12px' }}
                    >
                      {tx('pos.clear')}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <label className="text-xs text-[var(--muted)] font-bold">{tx('pos.reward_code')}</label>
                    {rewardApplied ? (
                      <span className="inline-flex items-center gap-1.5 bg-[#E9F6EC] text-[#2E9E54] rounded-md px-2.5 py-1 text-xs font-bold">
                        {(rewardApplied.description || 'Reward').replace(/^Reward: /, '')} −{money(rewardApplied.appliedCents)}
                        {!isPaid ? <button aria-label={tx('pos.remove_reward')} disabled={busy === 'reward'} onClick={removeReward} className="border-none bg-transparent text-[#2E9E54] cursor-pointer font-extrabold">×</button> : null}
                      </span>
                    ) : (
                      <>
                        <input
                          aria-label={tx('pos.reward_code')}
                          value={rewardStr}
                          onChange={(e) => setRewardStr(e.target.value.toUpperCase())}
                          placeholder={tx('pos.rdm')}
                          className="w-36 border border-[var(--line)] rounded-lg p-1.5 text-xs uppercase tracking-wider"
                        />
                        <button disabled={busy === 'reward' || !selId || !rewardStr.trim() || isPaid} onClick={applyReward} style={{ ...ghostBtn, padding: '6px 12px' }}>
                          {tx('pos.apply_reward')}
                        </button>
                      </>
                    )}
                  </div>
                  {selId ? <GlobalRewardsTender ticketId={selId} isPaid={isPaid} onChanged={refreshAll} /> : null}
                </>
              )}
                {selId && !isPaid ? <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 10 }}><AICheckoutUpsellPanel checkoutId={selId} onCartChanged={() => { void refreshAll(); }} /></div> : null}
              </div>

              {/* fixed footer: the totals strip (always visible) + the actions */}
              <div className="co-ws-foot" data-testid="checkout-totals">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', fontSize: 11.5 }}>
                  {([
                    ['subtotal', tx('glossary.checkout.subtotal'), t?.subtotalCents || 0],
                    ['discount', tx('glossary.checkout.discount'), -discountTotal],
                    ['tax', tx('payment.totals.taxRate', { rate: ps.taxRatePercent || 0 }), t?.taxCents || 0],
                    ['giftCard', tx('payment.totals.giftCard'), t?.giftCardChargeCents || 0],
                    ['surcharge', tx('payment.totals.cardSurcharge'), t?.surchargeCents || 0],
                    ['tip', tx('glossary.checkout.tip'), t?.tipCents || 0],
                  ] as [string, string, number][]).filter(([id, , v]) => !((id === 'discount' || id === 'giftCard' || id === 'surcharge') && v === 0)).map(([id, lab, v]) => (
                    <span key={id} style={{ whiteSpace: 'nowrap', color: v < 0 ? '#2E9E54' : 'var(--text)' }}><span style={{ color: 'var(--muted)' }}>{lab}</span> <b>{v < 0 ? '−' : ''}{money(Math.abs(v))}</b></span>
                  ))}
                  {detail.paidCents != null && detail.paidCents > 0 && !isPaid ? <span style={{ whiteSpace: 'nowrap', color: '#3C7FB6', fontWeight: 700 }} data-testid="checkout-paid-balance">{tx('payment.workspace.paidBalance', { paid: money(detail.paidCents), balance: money(detail.balanceCents) })}</span> : null}
                  <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}><span style={{ fontWeight: 700, fontSize: 12.5 }}>{isPaid ? tx('pos.total_paid') : tx('pos.total_due')}</span> <b style={{ fontSize: 19, color: '#2E9E54' }}>{money(t?.totalDueCents)}</b></span>
                </div>
              {/* Bottom Actions */}
              <div className="co-actions flex flex-row gap-2 mt-1.5">
                {isPaid ? (
                  <>
                    {displays.ticketSession ? (
                      <button disabled={busy === 'disp'} onClick={clearDisplay} className="flex-1 py-2" style={ghostBtn}>
                        {tx('pos.clear_display')}
                      </button>
                    ) : (
                      <button disabled={toDisplayOff} title={displays.mine?.online ? undefined : tx('pos.no_customer_display_is_connected_continue_leej')} onClick={sendToDisplay} className="flex-1 py-2" style={toDisplayOff ? { ...ghostBtn, opacity: 0.45, cursor: 'not-allowed' } : ghostBtn}>
                        {tx('pos.to_display')}
                      </button>
                    )}
                    <button disabled={busy === 'receipt'} onClick={sendReceipt} className="flex-[1.5] py-2 text-sm" style={orangeBtn}>
                      {tx('pos.send_receipt')}
                    </button>
                    <button
                      disabled
                      className="flex-1 py-2 bg-[#E9F6EC] text-[#2E9E54] border border-[#2E9E54] font-bold cursor-default rounded-lg"
                    >
                      {tx('pos.completed_paid')}
                    </button>
                  </>
                ) : (
                  <>
                    {/* Oct 6 2026: these used to show a message and do nothing */}
                    {isHeld ? (
                      <button disabled={busy === 'hold'} onClick={() => selId && run('hold', () => posCheckoutApi.resume(selId), () => { setNote(msg('pos.ticket_resumed_it_is_back_in_1u2x')); void refreshAll(); })} className="flex-1 py-2 text-xs" style={ghostBtn}>
                        {tx('pos.resume_ticket')}
                      </button>
                    ) : (
                      <button disabled={busy === 'hold'} onClick={() => selId && run('hold', () => posCheckoutApi.hold(selId), () => { setNote(msg('pos.ticket_on_hold_its_items_tip_75my')); void refreshAll(); })} className="flex-1 py-2 text-xs" style={ghostBtn}>
                        {tx('pos.hold_ticket')}
                      </button>
                    )}
                    <button disabled={busy === 'move'} aria-expanded={moveOpen} onClick={() => setMoveOpen((v) => !v)} className="flex-1 py-2 text-xs" style={ghostBtn}>
                      {tx('pos.move_to_front_desk')}
                    </button>
                    {displays.ticketSession ? (
                      <button disabled={busy === 'disp'} onClick={clearDisplay} className="flex-1 py-2 text-xs" style={ghostBtn}>
                        {tx('pos.clear_display')}
                      </button>
                    ) : (
                      <button disabled={toDisplayOff} title={displays.mine?.online ? undefined : tx('pos.no_customer_display_is_connected_continue_leej')} onClick={sendToDisplay} className="flex-1 py-2 text-xs" style={toDisplayOff ? { ...ghostBtn, opacity: 0.45, cursor: 'not-allowed' } : ghostBtn}>
                        {tx('pos.to_display')}
                      </button>
                    )}
                    <button disabled={busy === 'receipt'} onClick={sendReceipt} className="flex-1 py-2 text-xs" style={ghostBtn}>
                      {tx('pos.send_receipt')}
                    </button>
                    <button
                      disabled={busy === 'pay' || unknownHere}
                      aria-disabled={busy === 'pay' || unknownHere}
                      title={unknownHere ? tx('payment.unknown.completeBlocked') : undefined}
                      onClick={takePayment}
                      className="flex-[1.6] py-2 text-sm font-bold"
                      style={unknownHere ? { ...orangeBtn, opacity: 0.45, cursor: 'not-allowed' } : orangeBtn}
                    >
                      {busy === 'pay' ? tx('pos.processing') : tx('pos.complete_checkout')}
                    </button>
                  </>
                )}
              </div>
              {/* Move to Front Desk: the register this ticket is to be paid at — one of this location's registers */}
              {moveOpen && !isPaid ? (
                <div role="group" aria-label={tx('pos.move_to_register')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.move_to')}</span>
                  {registers.length === 0 ? <span style={{ fontSize: 11.5 }}>{tx('pos.no_registers_yet_add_one_on_1nov')}</span> : registers.map((reg) => (
                    <button key={reg.id} disabled={busy === 'move' || reg.name === selRow?.station} onClick={() => selId && run('move', () => posCheckoutApi.move(selId, reg.id), (r) => { setMoveOpen(false); setNote(msg('pos.moved_to_v0', { v0: String(r?.station || reg.name) })); void refreshAll(); })} className="py-1 px-2 text-xs" style={ghostBtn}>
                      {reg.name}{reg.id === displays.register ? tx('pos.this_register') : ''}{reg.name === selRow?.station ? ' ✓' : ''}
                    </button>
                  ))}
                  <button onClick={() => setMoveOpen(false)} className="py-1 px-2 text-xs" style={ghostBtn}>{tx('pos.cancel')}</button>
                </div>
              ) : null}
              </div>
            </>
          )}
        </section>

        {/* RIGHT — AI insights (advisory, 3–5) + the customer display and payment phones, in one fixed panel (§54) */}
        <section className="co-card co-panel co-right" data-module-id="checkout-ai-insights">
          <div className="co-head"><h2 style={h2}>{tx('pos.ai_checkout_insights')}</h2><span style={{ background: '#EFEAFA', color: '#6E59C7', borderRadius: 6, padding: '1px 7px', fontSize: 9.5, fontWeight: 800 }}>{tx('pos.new')}</span></div>
          <div className="co-scroll">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {insights.map((ins, i) => (
                <div key={ins.id || i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, background: ins.severity === 'warn' || ins.severity === 'danger' ? '#FBEAE8' : '#FDEFE0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke={ins.severity === 'warn' || ins.severity === 'danger' ? '#C0392B' : O} strokeWidth="1.7"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg></span>
                  <span style={{ fontSize: 11.5, flex: 1, color: 'var(--text)' }}>{ins.text}</span>
                  {ins.action && (ins.act || ins.route) ? <button style={ghostBtn} onClick={() => (ins.act ? ins.act() : ins.route ? nav(ins.route) : undefined)}>{ins.action}</button> : null}
                </div>
              ))}
              {insights.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tx('pos.no_insights_right_now')}</div> : null}
            </div>
            {/* §55: Auto Assist only RECOMMENDS — the employee confirms every change in the workspace */}
            <div style={{ marginTop: 8 }} title={tx('payment.assist.title')}>
              <AiAssistantPanel packageCode="ai_upsell" cta={tx('pos.auto_assist_checkout')} action="checkout_assist" buildPrompt={() => "Review the current checkout: suggest valid loyalty redemption, retail upsell, rebooking, and the best receipt channel for a nail salon. Require human confirmation. Be brief."} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <CustomerDisplayCard m={displays} ticketId={selId} ticketPaid={isPaid} onChanged={() => { void refreshAll(); }} />
              <MobilePaymentsCard ticketId={selId} ticketPaid={isPaid} onClaimChange={setMobileClaim} />
            </div>
          </div>
        </section>

        {/* Staff / Ready Technicians — compact: ≤ 8 rows + counts (§61) */}
        <section className="co-card co-panel co-staff" data-module-id="checkout-staff">
          <div className="co-head"><h2 style={h2}>{tx('pos.available_front_desk_ready_technicians')}</h2></div>
          {staffSum ? <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4, flex: 'none' }} data-testid="checkout-staff-summary">{tx('payment.staff.summary', { ready: String(staffSum.ready), busy: String(staffSum.busy), onBreak: String(staffSum.onBreak), shown: String(staffSum.shown), total: String(staffSum.total) })}</div> : null}
          <div className="co-scroll">
            <table className="co-tbl">
              <thead><tr>{[tx('pos.technician'), tx('pos.next_available_2'), tx('pos.status')].map((hh) => <th key={hh}>{hh}</th>)}</tr></thead>
              <tbody>
                {staff.slice(0, 8).map((sr, i) => (
                  <tr key={sr.technicianId || i}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 18, borderRadius: 99, background: '#ECE3D5', color: 'var(--g7)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{sr.initials || initials(sr.name)}</span><span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sr.name}</span></div></td>
                    <td style={{ color: 'var(--soft)' }}>{sr.nextAvailable}</td>
                    <td>{chip(STAFF_KEY[sr.status] ? tx(STAFF_KEY[sr.status]) : sr.status, STAFF_TONE[sr.status] || { bg: '#F2ECE0', fg: '#8A7A66' })}</td>
                  </tr>
                ))}
                {staff.length === 0 ? <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)', whiteSpace: 'normal' }}>{tx('pos.staff_availability_syncs_from_the_team_1x00')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          {staff.length ? <button style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={() => nav('/tenant/team/members')}>{tx('pos.view_all_staff')}</button> : null}
        </section>
      </div>

      {/* Analytics row — fixed height */}
      <div className="co-ana">
        {/* Revenue Trend */}
        <section style={anaCard} data-module-id="co-ana-revenue-trend">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.revenue_trend')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          <div style={{ font: '700 18px/1 "Playfair Display",serif', marginTop: 4 }}>{money(a.revenueTodayCents ?? k.subtotalCents)}</div>
          {a.revenueTrendDeltaPercent != null ? <div style={{ fontSize: 10.5, color: '#2E9E54', fontWeight: 700 }}>▲ {a.revenueTrendDeltaPercent}{tx('pos.vs_yesterday_2')}</div> : <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_s_settled_revenue')}</div>}
          {(() => { const pts = trendPts; if (!pts.length) return <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_settled_payments_yet')}</div>; const w = 220, h = 78, max = Math.max(1, ...pts.map((p) => p.amountCents)); const xs = (i: number) => pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w; const ys = (v: number) => h - (v / max) * (h - 8) - 2; const dd = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(p.amountCents).toFixed(1)}`).join(' '); return (
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'var(--co-chart)', marginTop: 2 }}>
              {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
              <path d={dd} fill="none" stroke={O} strokeWidth="2" />
              {pts.map((p, i) => <circle key={i} cx={xs(i)} cy={ys(p.amountCents)} r="2.5" fill={O} />)}
            </svg>
          ); })()}
        </section>
        {/* Payment Mix */}
        <section style={anaCard} data-module-id="co-ana-payment-mix">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.payment_mix')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {mixTotal === 0 ? <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_payments_yet')}</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <svg viewBox="0 0 120 120" style={{ width: 'var(--co-chart)', height: 'var(--co-chart)', flex: 'none' }}>{(() => { let acc = 0; const R = 46, C = 2 * Math.PI * R; return mix.map((m, i) => { const dash = (m.amount / mixTotal) * C; const seg = <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={MIX_COLOR[m.code] || '#999'} strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />; acc += dash; return seg; }); })()}</svg>
              <div style={{ flex: 1 }}>{mix.map((m, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '1px 0' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: MIX_COLOR[m.code] || '#999' }} />{m.label}<span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{(Math.round((m.amount / mixTotal) * 1000) / 10).toFixed(1)}% · {money(m.amount)}</span></div>)}</div>
            </div>
          )}
        </section>
        {/* Conversion gauge */}
        <section style={anaCard} data-module-id="co-ana-checkout-conversion">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.checkout_conversion')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {conv == null ? <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>{tx('pos.no_data_yet')}</div> : (() => { const pct = Math.max(0, Math.min(100, conv)); const R = 42, C = Math.PI * R; const dash = (pct / 100) * C; return (
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <svg viewBox="0 0 110 62" style={{ width: 'auto', height: 'var(--co-chart)' }}>
                <path d="M13 55 A42 42 0 0 1 97 55" fill="none" stroke="var(--line)" strokeWidth="11" strokeLinecap="round" />
                <path d="M13 55 A42 42 0 0 1 97 55" fill="none" stroke={O} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} />
                <text x="55" y="50" textAnchor="middle" style={{ font: '700 18px "Playfair Display",serif', fill: 'var(--text)' }}>{pct}%</text>
              </svg>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.service_done_checkout')}</div>
              {a.conversionDeltaPercent != null ? <div style={{ fontSize: 10, color: '#2E9E54', fontWeight: 700 }}>▲ {a.conversionDeltaPercent}{tx('pos.vs_yesterday_2')}</div> : null}
            </div>
          ); })()}
        </section>
        {/* Upsell Mix */}
        <section style={anaCard} data-module-id="co-ana-upsell-mix">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={h2}>{tx('pos.upsell_mix')}</h2><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.today_6')}</span></div>
          {upsell.length === 0 ? <div style={{ height: 'var(--co-chart)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '0 6px' }}>{tx('pos.upsell_categories_need_a_line_category_1oua')}</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <svg viewBox="0 0 120 120" style={{ width: 'var(--co-chart)', height: 'var(--co-chart)', flex: 'none' }}>{(() => { let acc = 0; const R = 46, C = 2 * Math.PI * R; return upsell.map((u, i) => { const dash = (u.sharePercent / 100) * C; const seg = <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={UPSELL_COLOR[i % UPSELL_COLOR.length]} strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />; acc += dash; return seg; }); })()}</svg>
              <div style={{ flex: 1 }}>{upsell.map((u, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '1px 0' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: UPSELL_COLOR[i % UPSELL_COLOR.length] }} />{u.category}<span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{u.sharePercent}%</span></div>)}</div>
            </div>
          )}
        </section>
        {/* Potential Revenue */}
        <section style={anaCard} data-module-id="co-ana-potential-revenue-in-queue">
          <h2 style={h2}>{tx('pos.potential_revenue_in_queue')}</h2>
          <div style={{ font: '700 18px/1 "Playfair Display",serif', margin: '4px 0' }}>{money(pot.totalCents)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, fontSize: 10.5, lineHeight: 1.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.services')}</span><b>{money(pot.servicesCents)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.retail')}</span><b>{pot.retailCents > 0 ? money(pot.retailCents) : '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>{tx('pos.tips_est')}</span><b>{money(pot.tipsEstCents)}</b></div>
          </div>
          <div style={{ fontSize: 10.5, color: O, fontWeight: 700, marginTop: 2 }}>{pot.ticketCount} {tx('pos.tickets_in_queue')}</div>
        </section>
      </div>

      {/* Quick Actions — one fixed row (§66), every button wired */}
      <div className="co-qa" data-testid="checkout-quick-actions">
        {QA.map((q) => (
          <button key={q.l} onClick={q.fn} className="dqa" title={q.why ? `${q.l} — ${q.why}` : q.l} aria-disabled={q.why ? true : undefined} data-why={q.why || undefined} style={q.why ? { opacity: 0.6 } : undefined}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={O} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={q.d} /></svg>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.15 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>{q.l}</span>
              {q.why ? <span data-testid="qa-why" style={{ fontSize: 9.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.why}</span> : null}
            </span>
          </button>
        ))}
      </div>

      {overlay === 'queue' ? <Overlay title={tx('payment.board.fullQueueTitle')}>{queueTable(items)}</Overlay> : null}
      {overlay === 'attention' ? <Overlay title={tx('payment.board.allAttentionTitle')}>{attentionTable(attention)}</Overlay> : null}
      {overlay === 'lines' && detail ? <Overlay title={tx('payment.lines.title')} sub={`#${detail.ticketNumber} · ${cust?.fullName ?? ''}`}>{linesTable(lines)}</Overlay> : null}
      {overlay === 'summary' && detail ? (
        <Overlay title={tx('payment.summary.title')} sub={tx('payment.summary.readOnly')}>
          <div data-testid="checkout-summary" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 14, fontSize: 12.5 }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>#{detail.ticketNumber} · {cust?.fullName}</div>
              {linesTable(lines)}
              {(detail.discounts ?? []).length ? <div style={{ marginTop: 6 }}>{(detail.discounts ?? []).map((d, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#2E9E54' }}><span>{d.label}</span><b>−{money(d.amountCents)}</b></div>)}</div> : null}
            </div>
            <div>
              {([[tx('glossary.checkout.subtotal'), t?.subtotalCents || 0], [tx('glossary.checkout.discount'), -discountTotal], [tx('payment.totals.taxRate', { rate: ps.taxRatePercent || 0 }), t?.taxCents || 0], [tx('payment.totals.cardSurcharge'), t?.surchargeCents || 0], [tx('glossary.checkout.tip'), t?.tipCents || 0]] as [string, number][]).map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span style={{ color: 'var(--muted)' }}>{l}</span><b>{v < 0 ? '−' : ''}{money(Math.abs(v))}</b></div>)}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4, fontSize: 14 }}><b>{tx('pos.total_due')}</b><b>{money(t?.totalDueCents)}</b></div>
              <div style={{ fontWeight: 800, margin: '10px 0 4px' }}>{tx('payment.summary.tenders')}</div>
              {detail.tenders == null ? <div style={{ color: '#C0392B' }}>{tx('payment.summary.unreadable')}</div> : detail.tenders.length === 0 ? <div style={{ color: 'var(--muted)' }}>{tx('payment.summary.noTenders')}</div> : detail.tenders.map((p) => (
                <div key={p.paymentId} style={{ display: 'flex', gap: 8, padding: '2px 0' }}><span>{statusLabel('paymentMethod', p.method)}{p.last4 ? ` ••${p.last4}` : ''}</span><span style={{ color: 'var(--muted)' }}>{renderMsg(st('payment', p.status))}</span><b style={{ marginLeft: 'auto' }}>{money(p.amountCents)}</b></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}><span>{tx('payment.summary.paid')}</span><b>{detail.paidCents == null ? '—' : money(detail.paidCents)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{tx('payment.summary.balance')}</span><b>{detail.balanceCents == null ? '—' : money(detail.balanceCents)}</b></div>
            </div>
          </div>
        </Overlay>
      ) : null}
      {skipDrawer ? <SkipLineDrawer open onClose={() => setSkipDrawer(false)} /> : null}
      {sigUrl ? (
        <div onClick={() => setSigUrl(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, maxWidth: 520, width: '90%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={h2}>{tx('pos.card_signature')}</span>
              <button onClick={() => setSigUrl(null)} style={ghostBtn}>{tx('pos.close')}</button>
            </div>
            <img src={sigUrl} alt={tx('pos.cardholder_signature')} style={{ width: '100%', background: '#fff', border: '1px solid var(--line)', borderRadius: 8 }} />
            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{sigOn === 'customer_display' ? tx('pos.signed_on_the_customer_display_at_1sjh') : tx('pos.signed_on_the_card_terminal_at_1a8o')}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
