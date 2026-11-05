// customer-display.service.ts — the kiosk's brain. Verifies the session public token (constant-time), assembles the
// CustomerDisplayState the iPad renders, and applies a customer-selected tip (validated, totals recomputed via the same
// checkout helpers the POS uses, then broadcast so the front desk sees it). Backend remains the source of truth for money.
import { EVENTS, rooms, type EventName, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { displayStateMode, enrichContext, logDisplayOperation, observeDisplayState, recordDisplayEvent } from '@aipowersalon/observability';
import type { DisplayDataPort, DisplaySessionRow } from './customer-display.repository';
import { buildDisplayBranding } from './customer-display-branding';
import type { TerminalCapturePort } from './terminal-capture.service';
import type { CustomerDisplayCheckout, CheckoutTotals } from '@aipowersalon/api-contracts/customer';
import { TechnicianTipStore, TipSelectionLocked, TipSelectionStale } from './technician-tips.store';
import type { DisplayTechnicianTips } from '@aipowersalon/api-contracts/customer';
import {
  computeTotals, tipOptions, tipForPercent, validateCustomTip, tipRecipients, recipientsKey, technicianTips, TechTipError, type TipRecipient,
  type CustomerDisplayState, type DisplayState, type PaymentMethod,
} from '@aipowersalon/checkout';

/** `standard`: the Dual-Screen mandate §104 code the client reacts to (packages/api-contracts ERROR_REGISTRY), when one applies. */
export type DisplayStandardCode = 'DISPLAY_SESSION_NOT_FOUND' | 'DISPLAY_SESSION_EXPIRED';
export class DisplayError extends Error {
  constructor(public code: 'forbidden' | 'not_found' | 'invalid', message: string, public standard?: DisplayStandardCode) { super(message); }
}

export type { TipSubmission } from '@aipowersalon/api-contracts/customer';   // the wire contract (Constitution 13 §15)
import type { TipSubmission, CustomerDisplayAdPlaylist, CustomerDisplayReceipt, DisplayHeartbeatAck, DisplayReceiptChannel, DisplayReceiptOption, DisplayCheckInSession } from '@aipowersalon/api-contracts/customer';
import { DISPLAY_RECEIPT_DECIDE_SECONDS, maskEmail, maskPhone, withCode } from '@aipowersalon/api-contracts';

/** Phase 3: what the display needs from the canonical phone service — structural, so the display module keeps its shape. */
export interface DisplayPhonePort {
  displayPrompt(tenantId: string, customerId: string): Promise<{ maskedPhone: string } | null>;
  verifyFromDisplay(tenantId: string, branchId: string | null, customerId: string, code: string): Promise<{ ok: boolean; message: string }>;
}

// POS session.state → the kiosk's DisplayState machine.
const STATE_MAP: Record<string, DisplayState> = {
  showing_ticket: 'ticket_review', ticket_review: 'ticket_review', tip_selected: 'tip_selected',
  payment_processing: 'payment_processing', processing: 'payment_processing', payment_in_progress: 'payment_processing',
  paid: 'payment_success', payment_success: 'payment_success', success: 'payment_success',
  payment_failed: 'payment_failed', failed: 'payment_failed',
};

/** 23-inch spec §41: a card charge in flight longer than this has lost its answer (terminal / network) — the display
 *  switches from 'Processing payment' to 'Verifying payment — please do not pay again'. It never asks for a second
 *  payment; the POS resolves the charge (Functional Decision 22's verify flow). */
export const PAYMENT_VERIFY_AFTER_MS = 20_000;
/** A completed checkout the display never released (it was offline at completion) is not re-shown on reconnect after
 *  this long — the next customer must never see the previous one's ticket (spec §107). */
export const STALE_COMPLETED_MS = 120_000;

// Minimal structural port to Go Check-In WITHOUT importing its module types (keeps the coupling one-way and optional).
// GoCheckInService satisfies this shape. 23-inch spec §8/§12 (Unit 7): the display runs its guests' check-in on its OWN
// identity — startDisplaySession takes the display the credential proved; slugForBranch remains only for displays built
// before Unit 7, which borrowed a kiosk's slug.
export interface GoCheckInSlugPort {
  slugForBranch(tenantId: string, branchId: string | null): Promise<string | null>;
  checkInAvailable?(tenantId: string, branchId: string | null): Promise<boolean>;
  startDisplaySession?(display: { id: string; tenantId: string; branchId: string | null }): Promise<DisplayCheckInSession>;
  /** Dual-Screen mandate §118–§119: the salon's display languages, its default first */
  displayLanguages?(tenantId: string): Promise<string[]>;
}

// 23-inch spec §47–§74, §108: the salon's advertising for this display. A structural port (the marketing module's
// DisplayAdsPlaylistService satisfies it): the display route proves WHICH device is asking, advertising decides what it plays.
export interface DeviceAdsPort {
  playlistForDevice(d: { deviceId: string; tenantId: string; branchId: string | null }): Promise<CustomerDisplayAdPlaylist>;
  recordDisplays(d: { deviceId: string; tenantId: string; branchId: string | null }, body: unknown): Promise<{ accepted: number; duplicate: boolean }>;
}
/** No advertising wired (in-memory / unit wiring): the display shows the salon's branded panel. */
const NO_ADS: Omit<CustomerDisplayAdPlaylist, 'generatedAt'> = { enabled: false, offReason: 'not_available', ads: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, playlistVersion: 'none', refreshAfterSeconds: 900, validUntil: null };

/** 23-inch spec §85–§86: the display's heartbeat lands in the device registry (display-devices.service). Structural. */
export interface DeviceHeartbeatPort { heartbeat(device: { id: string; tenantId: string; branchId: string | null }, body: unknown): Promise<DisplayHeartbeatAck> }
type ReceiptScope = { tenantId: string; branchId: string };
/** §97–§98: receipts belong to the checkout module (CheckoutService satisfies this) — the display offers the choice, the
 *  checkout module delivers it exactly as the POS's Send Receipt does. */
export interface DisplayReceiptPort {
  displayReceiptFacts(scope: ReceiptScope, ticketId: string): Promise<{ phone: string | null; email: string | null; alreadySent: boolean; live: { sms: boolean; email: boolean } }>;
  sendReceiptForDisplay(scope: ReceiptScope, ticketId: string, channel: 'sms' | 'email'): Promise<'sent' | 'unavailable' | 'failed'>;
}
export interface ReceiptStepFacts {
  /** the display's "Ask for a receipt" switch (Customer Display settings) */
  promptEnabled: boolean;
  /** Receipts & Branding "default delivery" — what is sent when the customer walks away (§97 automatic behaviour) */
  defaultDelivery: string[];
  live: { sms: boolean; email: boolean };
  phone: string | null; email: string | null;
  /** the front desk already sent one from the POS */
  alreadySent: boolean;
  choice: 'sms' | 'email' | 'none' | null | undefined;
  status: 'sending' | 'sent' | 'skipped' | 'unavailable' | 'failed' | null | undefined;
}
/**
 * §97–§98, pure: the receipt step on the display, or null when there is none. Offered: a text to the customer's phone and
 * an email to their address — each only when a real provider delivers it (never "texted" when nothing was sent) — and
 * "No receipt". Destinations are MASKED. Once chosen, the recorded outcome. Nothing to ask (no deliverable channel, the
 * salon switched the prompt off, the POS already sent one) → null, and the 3-second screen starts at once.
 */
export function displayReceiptStep(f: ReceiptStepFacts): CustomerDisplayReceipt | null {
  const masked = (c: DisplayReceiptChannel): string | undefined => (c === 'sms' ? maskPhone(f.phone) : c === 'email' ? maskEmail(f.email) : null) ?? undefined;
  if (f.choice && f.status) { const d = masked(f.choice); return { status: f.status, channel: f.choice, ...(d ? { destination: d } : {}) }; }
  if (!f.promptEnabled || f.alreadySent) return null;
  const options: DisplayReceiptOption[] = [];
  const phone = f.live.sms ? maskPhone(f.phone) : null;
  const email = f.live.email ? maskEmail(f.email) : null;
  if (phone) options.push({ channel: 'sms', destination: phone });
  if (email) options.push({ channel: 'email', destination: email });
  if (!options.length) return null;
  const defaults = f.defaultDelivery.map((x) => String(x).trim().toLowerCase()).map((x) => (x === 'text' ? 'sms' : x));
  const automatic = (defaults.find((d) => options.some((o) => o.channel === d)) as DisplayReceiptChannel | undefined) ?? 'none';
  return { status: 'choose', options: [...options, { channel: 'none' }], automatic, decideWithinSeconds: DISPLAY_RECEIPT_DECIDE_SECONDS };
}

export class CustomerDisplayService {
  constructor(
    private readonly repo: DisplayDataPort, private readonly rt?: RealtimeEmitter, private readonly terminalCapture?: TerminalCapturePort,
    private readonly goCheckIn?: GoCheckInSlugPort, private readonly ads?: DeviceAdsPort,
    private readonly receipts?: DisplayReceiptPort, private readonly devicesHub?: DeviceHeartbeatPort,
    /** Phase 3: the customer's phone-change code, typed on this display (CustomerPhoneUpdateService). */
    private readonly phone?: DisplayPhonePort,
    /** G4 Split Tips (Nov 5 2026): per-technician tips (absent without a database — the single tip stays) */
    private readonly tips?: TechnicianTipStore,
  ) {}

  /** G4: the ticket's performing technicians + the customer's current per-technician choice; null when the salon has not
   *  turned per-technician tips on, there is no database, or no technician performed a service on the ticket */
  private async technicianTipsFor(row: DisplaySessionRow, settings: { perTechnicianTips?: boolean; tipPresetCents?: number[]; defaultTipPercents: number[] }): Promise<{ view: DisplayTechnicianTips; recipients: TipRecipient[] } | null> {
    if (!settings.perTechnicianTips || !this.tips || !row.ticketId) return null;
    const l = await this.tips.lines(row.tenantId, row.ticketId);
    const recipients = tipRecipients(l.lines, l.discountCents);
    if (!recipients.length) return null;
    const sel = await this.tips.selection(row.tenantId, row.ticketId);
    const key = recipientsKey(recipients);
    const stale = !!sel && sel.state !== 'SUPERSEDED' && sel.recipientsKey !== key;
    const live = sel && !stale && sel.state !== 'SUPERSEDED' ? sel : null;
    const pick = new Map((live?.selections ?? []).map((x) => [x.technicianId, x]));
    return { recipients, view: {
      recipients: recipients.map((r) => { const c = pick.get(r.technicianId); return { technicianId: r.technicianId, name: r.name, avatarUrl: l.avatars[r.technicianId] ?? null, services: r.services, basisCents: r.basisCents,
        choice: c ? { tipType: c.tipType, percent: c.percent, tipCents: c.tipCents } : null }; }),
      version: sel?.version ?? 0, state: sel ? (stale ? 'SUPERSEDED' : sel.state) : 'NEW', stale, totalTipCents: live?.totalTipCents ?? 0,
      presetCents: settings.tipPresetCents ?? [300, 500, 1000], percents: settings.defaultTipPercents } };
  }

  /** G4: the customer's per-technician choices — validated against the ticket's REAL performers and their basis (a
   *  technician who did not perform a service is refused), versioned, written as the ticket's customer-directed split */
  private async applyTechnicianTips(row: DisplaySessionRow, input: TipSubmission): Promise<CustomerDisplayState> {
    const settings = await this.repo.resolveSettings(row.tenantId, row.branchId);
    const tt = await this.technicianTipsFor(row, settings);
    if (!tt) throw withCode(new DisplayError('invalid', 'Tipping each technician is not available for this checkout.'), 'TECH_TIPS_UNAVAILABLE');
    const confirm = input.confirm === true;
    let res: ReturnType<typeof technicianTips>;
    try { res = technicianTips(tt.recipients, input.technicians ?? [], settings.maxTipPercent); }
    catch (e) { if (e instanceof TechTipError) throw new DisplayError('invalid', e.message); throw e; }
    if (confirm && res.items.length !== tt.recipients.length) throw withCode(new DisplayError('invalid', 'Choose a tip (or No Tip) for each technician before confirming.'), 'TECH_TIPS_INCOMPLETE');
    const percents = new Set(res.items.map((i) => (i.tipType === 'percent' ? i.percent : -1)));
    const meta = { tipType: (res.totalCents === 0 ? 'none' : res.items.every((i) => i.tipType === 'percent') && percents.size === 1 ? 'percent' : 'custom') as 'none' | 'percent' | 'custom',
      tipPercent: res.items.length && res.items.every((i) => i.tipType === 'percent') && percents.size === 1 ? Math.round(Number(res.items[0].percent)) : null };
    // a declined / failed charge released the money: the customer may change the tips before trying again (§7.1)
    if (row.lastPaymentStatus === 'declined' || row.lastPaymentStatus === 'failed') await this.tips!.unlock(row.tenantId, row.ticketId!);
    try {
      await this.tips!.save({ tenantId: row.tenantId, branchId: row.branchId, ticketId: row.ticketId!, sessionId: row.id, expectedVersion: input.expectedVersion ?? null,
        recipientsKey: recipientsKey(tt.recipients), items: res.items, totalCents: res.totalCents, confirm, tipMeta: meta });
    } catch (e) {
      if (e instanceof TipSelectionStale || e instanceof TipSelectionLocked) throw new DisplayError('invalid', e.message);
      throw e;
    }
    const checkout = await this.projection(row);
    if (checkout) {
      const totals = computeTotals(CustomerDisplayService.effective(checkout), res.totalCents, settings, checkout.paymentMethod as PaymentMethod, checkout.giftCardSaleCents);
      await this.repo.applyTip(row.id, res.totalCents, totals.subtotalCents, totals.taxCents, totals.surchargeCents, totals.totalDueCents, meta);
    }
    this.emit(row, EVENTS.customerDisplayTipSelected, { sessionId: row.id, tipCents: res.totalCents, perTechnician: true, confirmed: confirm });
    return this.build((await this.repo.getSession(row.id)) ?? { ...row, state: 'tip_selected' });
  }

  // 23-inch spec §30–§39: the customer-safe checkout for this session's ticket, from the checkout module — the same
  // ticket, totals and payments the POS reads. Null when the session has no ticket (or it is gone).
  private projection(row: DisplaySessionRow): Promise<CustomerDisplayCheckout | null> {
    return row.ticketId ? this.repo.checkoutProjection(row.tenantId, row.branchId, row.ticketId) : Promise.resolve(null);
  }
  /** The effective subtotal (lines − discounts) — what the POS computes tips and tax on. */
  private static effective(c: CustomerDisplayCheckout): number { return Math.max(0, c.itemsSubtotalCents - c.discountCents); }

  private verify(hash: string | null, token: string | undefined): boolean {
    if (!hash || !token) return false;
    const h = createHash('sha256').update(token).digest('hex');
    if (h.length !== hash.length) return false;
    try { return timingSafeEqual(Buffer.from(h), Buffer.from(hash)); } catch { return false; }
  }

  private mapState(row: DisplaySessionRow): DisplayState {
    // the ticket's real payment status (driven by the POS pay path) is authoritative for completion
    if (row.ticketStatus === 'paid') return 'payment_success';
    if (row.ticketStatus === 'failed' || row.state === 'payment_failed') return 'payment_failed';
    // a declined charge while the customer is on the payment screen -> show failed (rather than spin until the session expires)
    if ((row.lastPaymentStatus === 'declined' || row.lastPaymentStatus === 'failed') && row.state === 'payment_processing') return 'payment_failed';
    if (row.closedAt || row.state === 'disconnected' || row.state === 'closed' || row.state === 'completed') return 'disconnected';
    // spec §40–§41: a card charge is in flight. Its outcome is authoritative only when the processor answers; past the
    // verify window the display says so instead of inviting a second payment. Checked BEFORE expiry — money in flight
    // outranks a session clock.
    if (row.lastPaymentStatus === 'processing') {
      const age = row.lastPaymentAt ? Date.now() - new Date(row.lastPaymentAt).getTime() : 0;
      return age >= PAYMENT_VERIFY_AFTER_MS ? 'payment_verifying' : 'payment_processing';
    }
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired';
    return STATE_MAP[row.state] ?? (row.ticketId ? 'ticket_review' : 'idle');
  }

  // Loads a session and asserts the public token matches; throws DisplayError otherwise.
  private async authed(sessionId: string, token: string | undefined): Promise<DisplaySessionRow> {
    const row = await this.repo.getSession(sessionId);
    if (!row) throw new DisplayError('not_found', 'Display session not found.', 'DISPLAY_SESSION_NOT_FOUND');
    if (!this.verify(row.publicTokenHash, token)) throw new DisplayError('forbidden', 'Invalid or missing display token.');
    return row;
  }

  async getState(sessionId: string, token: string | undefined): Promise<CustomerDisplayState> {
    return this.build(await this.authed(sessionId, token));
  }

  // True once the token is valid for this session — used to gate the SSE stream before subscribing.
  async canAccess(sessionId: string, token: string | undefined): Promise<boolean> {
    const row = await this.repo.getSession(sessionId);
    return !!row && this.verify(row.publicTokenHash, token);
  }

  async submitTip(sessionId: string, token: string | undefined, input: TipSubmission): Promise<CustomerDisplayState> {
    return this.applyTipToRow(await this.authed(sessionId, token), input);
  }

  private async applyTipToRow(row: DisplaySessionRow, input: TipSubmission): Promise<CustomerDisplayState> {
    const st = this.mapState(row);
    if (st !== 'ticket_review' && st !== 'tip_selected') throw new DisplayError('invalid', 'The tip can no longer be changed.');
    if (Array.isArray(input?.technicians)) return this.applyTechnicianTips(row, input);
    const settings = await this.repo.resolveSettings(row.tenantId, row.branchId);
    // G4: with per-technician tips on, one undirected ticket tip would leave the split to a fallback — refused
    if (await this.technicianTipsFor(row, settings)) throw withCode(new DisplayError('invalid', 'Choose a tip for each technician.'), 'TECH_TIPS_REQUIRED');
    const checkout = await this.projection(row);
    if (!checkout || !row.ticketId) throw new DisplayError('invalid', 'This checkout is no longer available.', 'DISPLAY_SESSION_EXPIRED');
    // the POS's own rule (checkout.service applyTip): a tip percent is of the effective subtotal, after discounts
    const subtotal = CustomerDisplayService.effective(checkout);
    const method = checkout.paymentMethod as PaymentMethod;

    let tipCents = 0;
    if (input?.tipType === 'percent') {
      if (!Number.isFinite(input.percent as number)) throw new DisplayError('invalid', 'A tip percentage is required.');
      tipCents = tipForPercent(subtotal, input.percent as number);
    } else if (input?.tipType === 'custom') {
      tipCents = Math.round(Number(input.amountCents));
    } else if (input?.tipType === 'none') {
      tipCents = 0;
    } else {
      throw new DisplayError('invalid', 'tipType must be none, percent, or custom.');
    }
    const v = validateCustomTip(tipCents, subtotal, settings.maxTipPercent);
    if (!v.ok) throw new DisplayError('invalid', v.reason || 'Invalid tip.');

    const totals = computeTotals(subtotal, tipCents, settings, method, checkout.giftCardSaleCents);   // the session row's copy only
    const meta = { tipType: (input!.tipType as 'none' | 'percent' | 'custom'), tipPercent: input!.tipType === 'percent' ? Math.round(input!.percent as number) : null };
    await this.repo.applyTip(row.id, tipCents, totals.subtotalCents, totals.taxCents, totals.surchargeCents, totals.totalDueCents, meta);
    await this.repo.setTicketTipFromDisplay({ tenantId: row.tenantId, ticketId: row.ticketId }, tipCents, meta);   // the ticket is the authority
    // tell the front desk (and any other viewer of this session) the customer chose a tip
    this.emit(row, EVENTS.customerDisplayTipSelected, { sessionId: row.id, tipCents });
    return this.build((await this.repo.getSession(row.id)) ?? { ...row, state: 'tip_selected' });
  }

  // The guest leaves a 1–5 satisfaction score on the post-payment thank-you screen. Persists to the ticket
  // (tickets.satisfaction_rating); the Service Done "Customer Satisfaction" KPI averages today's rated tickets.
  async submitRating(sessionId: string, token: string | undefined, rating: number): Promise<CustomerDisplayState> {
    return this.applyRatingToRow(await this.authed(sessionId, token), rating);
  }

  private async applyRatingToRow(row: DisplaySessionRow, rating: number): Promise<CustomerDisplayState> {
    const r = Math.round(Number(rating));
    if (!Number.isFinite(Number(rating)) || r < 1 || r > 5) throw new DisplayError('invalid', 'Rating must be between 1 and 5.');
    if (this.mapState(row) !== 'payment_success') throw new DisplayError('invalid', 'A rating can only be left after payment.');
    if (!row.ticketId) throw new DisplayError('invalid', 'There is no ticket to rate.');
    await this.repo.recordSatisfaction(row.tenantId, row.ticketId, r);
    return this.build(row);
  }

  // customer_pays mode only: the customer confirms payment on the device. This does NOT capture card data and does NOT
  // charge a card — it marks the session 'payment_processing' and signals the front desk/terminal to complete the sale on
  // the POS. The kiosk then mirrors completion from the ticket's real status (→ payment_success once the POS marks paid).
  async requestPayment(sessionId: string, token: string | undefined): Promise<CustomerDisplayState> {
    return this.requestPaymentForRow(await this.authed(sessionId, token));
  }

  private async requestPaymentForRow(row: DisplaySessionRow): Promise<CustomerDisplayState> {
    const settings = await this.repo.resolveSettings(row.tenantId, row.branchId);
    if (!settings.customerDisplayPayButtonEnabled) throw new DisplayError('invalid', 'Payment is not enabled on this display.');
    const st = this.mapState(row);
    if (st !== 'ticket_review' && st !== 'tip_selected') throw new DisplayError('invalid', 'Payment can no longer be started.');
    const checkout = await this.projection(row);
    if (!checkout) throw new DisplayError('invalid', 'This checkout is no longer available.', 'DISPLAY_SESSION_EXPIRED');
    // G4 Split Tips: the customer must have confirmed a current per-technician selection; it is frozen before the charge
    const tt = await this.technicianTipsFor(row, settings);
    if (tt) {
      if (tt.view.stale || tt.view.state !== 'CONFIRMED') throw withCode(new DisplayError('invalid', tt.view.stale ? 'The technicians on this ticket changed. Please choose the tips again.' : 'Please review and confirm the tips first.'), tt.view.stale ? 'TECH_TIPS_STALE' : 'TECH_TIPS_NOT_CONFIRMED');
      if (!(await this.tips!.lock(row.tenantId, row.ticketId!, row.id))) throw withCode(new DisplayError('invalid', 'Please review and confirm the tips first.'), 'TECH_TIPS_NOT_CONFIRMED');
    }
    await this.repo.markPaymentRequested(row.id);
    const method = checkout.paymentMethod as PaymentMethod;
    this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, totalDueCents: checkout.balanceDueCents, tipCents: checkout.tipCents });
    // terminal auto-trigger: when the branch captures on the terminal and the customer chose card, kick the physical
    // terminal charge in the background. The Pay response returns immediately (payment_processing); the kiosk's
    // poll/SSE reflects approved (-> payment_success via ticket paid) or declined/failed (-> payment_failed).
    if (settings.customerDisplayCaptureMode === 'terminal' && method === 'card' && this.terminalCapture) {
      void this.terminalCapture.capture(row).catch((e: unknown) => { new Logger('CustomerDisplay').error(`terminal capture threw for display session ${row.id} (ticket ${row.ticketId ?? 'none'}): ${(e as Error)?.message}`); /* never thrown into the Pay response; outcome rows are written inside capture() */ });
    }
    return this.build({ ...row, state: 'payment_processing' });
  }

  async submitMethod(sessionId: string, token: string | undefined, method: string): Promise<CustomerDisplayState> {
    return this.applyMethodToRow(await this.authed(sessionId, token), method);
  }

  // customer chooses how they'll pay (card vs cash) so totals reflect any card surcharge and the front desk knows the method.
  private async applyMethodToRow(row: DisplaySessionRow, method: string): Promise<CustomerDisplayState> {
    if (method !== 'card' && method !== 'cash') throw new DisplayError('invalid', 'Choose card or cash.');
    const st = this.mapState(row);
    if (st !== 'ticket_review' && st !== 'tip_selected') throw new DisplayError('invalid', 'The payment method can no longer be changed.');
    const settings = await this.repo.resolveSettings(row.tenantId, row.branchId);
    const checkout = await this.projection(row);
    if (!checkout || !row.ticketId) throw new DisplayError('invalid', 'This checkout is no longer available.', 'DISPLAY_SESSION_EXPIRED');
    const totals = computeTotals(CustomerDisplayService.effective(checkout), checkout.tipCents, settings, method as PaymentMethod, checkout.giftCardSaleCents);
    await this.repo.applyMethod(row.id, method, totals.subtotalCents, totals.taxCents, totals.surchargeCents, totals.totalDueCents);
    // the ticket's chosen method follows the customer's choice, so the POS and the display show ONE total (spec §35)
    await this.repo.setTicketMethodFromDisplay({ tenantId: row.tenantId, ticketId: row.ticketId }, method);
    this.emit(row, EVENTS.customerDisplayMethodSelected, { sessionId: row.id, method });
    return this.build((await this.repo.getSession(row.id)) ?? { ...row, paymentMethod: method });
  }

  // ---- the cardholder's signature (Kevin, Oct 6 2026): signed ONCE, on the Clover card terminal ----
  // The display used to ask every approved card payment for a signature on the 23-inch screen too, so customers whose
  // terminal also asked signed twice. The terminal is now the only place a signature is taken (the display's own
  // terminal charge asks for it — terminal-capture.service.ts — and stores what the terminal returns); the display never
  // asks, and nothing on it waits for one.

  // ---- the receipt step (23-inch spec §97–§98): after payment, before the 3-second screen ----
  async submitReceipt(sessionId: string, token: string | undefined, body: unknown): Promise<CustomerDisplayState> {
    return this.applyReceiptToRow(await this.authed(sessionId, token), body);
  }
  async submitReceiptForDevice(deviceToken: string | undefined, body: unknown): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session) throw new DisplayError('invalid', 'No active checkout on this display.', 'DISPLAY_SESSION_NOT_FOUND');
    return this.forDevice(r.device, await this.applyReceiptToRow(r.session, body));
  }

  /** The step for this checkout right now (null: none — nothing to ask, or receipts are not wired). Best-effort: a failed
   *  read never holds the completed screen hostage. */
  private async receiptFor(row: DisplaySessionRow): Promise<CustomerDisplayReceipt | null> {
    if (!this.receipts || !row.ticketId || !row.branchId) return null;
    try {
      const [settings, facts] = await Promise.all([
        this.repo.receiptSettings(row.tenantId, row.branchId),
        this.receipts.displayReceiptFacts({ tenantId: row.tenantId, branchId: row.branchId }, row.ticketId),
      ]);
      return displayReceiptStep({ ...settings, ...facts, choice: row.receiptChoice, status: row.receiptStatus });
    } catch { return null; }
  }

  private async applyReceiptToRow(row: DisplaySessionRow, body: unknown): Promise<CustomerDisplayState> {
    const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>).choice : undefined) as string | undefined;
    if (raw !== 'sms' && raw !== 'email' && raw !== 'none' && raw !== 'auto') throw new DisplayError('invalid', 'choice must be sms, email, none or auto.');
    if (this.mapState(row) !== 'payment_success') throw new DisplayError('invalid', 'A receipt can be chosen once the payment is complete.');
    const step = await this.receiptFor(row);
    if (!step) throw new DisplayError('invalid', 'There is no receipt to choose for this checkout.');
    if (step.status !== 'choose') return this.build(row);                        // already decided (a second tap): idempotent
    const channel = raw === 'auto' ? step.automatic : raw;
    if (!step.options.some((o) => o.channel === channel)) throw new DisplayError('invalid', 'That receipt option is not available.');
    await this.deliverReceipt(row, channel);
    return this.build((await this.repo.getSession(row.id)) ?? row);
  }

  /** Records the choice ONCE (a double tap or a race sends one receipt), then the checkout module delivers it. */
  private async deliverReceipt(row: DisplaySessionRow, channel: DisplayReceiptChannel): Promise<void> {
    const claimed = await this.repo.claimReceiptChoice(row.tenantId, row.id, channel, channel === 'none' ? 'skipped' : 'sending');
    if (!claimed || channel === 'none' || !this.receipts || !row.ticketId || !row.branchId) return;
    const outcome = await this.receipts.sendReceiptForDisplay({ tenantId: row.tenantId, branchId: row.branchId }, row.ticketId, channel).catch(() => 'failed' as const);
    await this.repo.finishReceipt(row.tenantId, row.id, outcome);
  }

  // ---- 23-inch spec §85–§86: the display's heartbeat (mode, app version, screen, profile) ----
  async heartbeatForDevice(deviceToken: string | undefined, body: unknown): Promise<DisplayHeartbeatAck> {
    const d = await this.deviceOnly(deviceToken);
    if (!this.devicesHub) return { maintenance: !!d.maintenance };
    return this.devicesHub.heartbeat({ id: d.id, tenantId: d.tenantId, branchId: d.branchId }, body);
  }

  // ---- device mode: a mounted iPad authenticated by a per-device token (not a per-session token) ----
  private deviceTokenHash(token: string | undefined): string | null {
    return token ? createHash('sha256').update(token).digest('hex') : null;
  }

  // resolve the paired device from its token, plus its current active session (if any).
  private async resolveDevice(deviceToken: string | undefined): Promise<{ device: { id: string; tenantId: string; branchId: string | null; maintenance?: boolean }; session: DisplaySessionRow | null } | null> {
    const hash = this.deviceTokenHash(deviceToken);
    if (!hash) return null;
    const device = await this.repo.deviceByToken(hash);
    if (!device) return null;
    this.deviceContext(device);
    return { device, session: await this.repo.currentSessionForDevice(device.id) };
  }
  /** §107: this request's log lines carry the display's salon and branch (from its credential — never the request). */
  private deviceContext(device: { tenantId: string; branchId: string | null }): void {
    enrichContext({ tenantId: device.tenantId, branchId: device.branchId, actorType: 'device' });
  }

  // what a mounted device should render right now: its active session, or an idle "waiting for the next customer" screen.
  async getDeviceState(deviceToken: string | undefined): Promise<CustomerDisplayState> {
    // §107–§108: the state build is timed by its coarse mode and logged as one operation line (no customer field)
    const t0 = performance.now();
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    const s = await this.deviceState(r);
    const ms = performance.now() - t0;
    observeDisplayState(displayStateMode(s.state), ms / 1000);
    logDisplayOperation({ deviceId: r.device.id, operation: 'state', mode: displayStateMode(s.state), durationMs: ms, status: 'ok' });
    return s;
  }
  private async deviceState(r: NonNullable<Awaited<ReturnType<CustomerDisplayService['resolveDevice']>>>): Promise<CustomerDisplayState> {
    if (r.session && this.isStaleCompleted(r.session)) {
      // spec §103 + §107: a restart DURING checkout restores it; a restart long AFTER it finished must not show the
      // previous customer again — the checkout is closed here and the display gets the idle state. A receipt nobody
      // chose gets the salon's automatic behaviour first (§97) — the customer still receives what the salon promised.
      const step = await this.receiptFor(r.session);
      if (step?.status === 'choose') await this.deliverReceipt(r.session, step.automatic).catch(() => undefined);
      if (await this.repo.closeSessionCompleted(r.session.tenantId, r.session.id)) this.emitCompleted(r.device, r.session, 'stale');
      return this.idleState(r.device.tenantId, r.device.branchId, r.device.maintenance);
    }
    return r.session ? this.forDevice(r.device, await this.build(r.session), r.session.customerId) : this.idleState(r.device.tenantId, r.device.branchId, r.device.maintenance);
  }

  /** Phase 3: the customer at THIS display typed their phone-change code. Only this display's current customer. */
  async submitPhoneCodeForDevice(deviceToken: string | undefined, code: string): Promise<{ ok: boolean; message: string }> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session?.customerId || !this.phone) throw new DisplayError('invalid', 'There is no code to enter right now.');
    const out = await this.phone.verifyFromDisplay(r.device.tenantId, r.device.branchId, r.session.customerId, String(code ?? ''));
    // The POS screens learn of an activation through the outbox (customer.phone_activated → customer_profile_updated).
    return out;
  }

  /**
   * 23-inch spec §2/§5 (Kevin's layout): check-in stays on the left WHILE the right panel shows a checkout, so a device's
   * checkout state carries its branch's Go Check-In slug too. It used to come with the idle state only — on the 23-inch
   * screen the check-in vanished the moment a checkout began (and the kiosk session was torn down and restarted after
   * it). Found Oct 6 2026 by the Unit 4 live browser proof. Best-effort, like the idle lookup.
   */
  private async forDevice(device: { tenantId: string; branchId: string | null }, s0: CustomerDisplayState, customerId?: string | null): Promise<CustomerDisplayState> {
    // Phase 3: staff asked this customer to type their phone-change code here (masked number only).
    const prompt = customerId && this.phone ? await this.phone.displayPrompt(device.tenantId, customerId).catch(() => null) : null;
    // POSLanguage.pdf §16 (Oct 28 2026): the Customer Display is ENGLISH ONLY, whatever the salon's POS language — the
    // state always says so (the display enforces it too); it never carries a language list from elsewhere
    const s: CustomerDisplayState = { ...s0, ...(prompt ? { phoneVerification: { maskedPhone: prompt.maskedPhone } } : {}), languages: ['en'] };
    if (s.goCheckInSlug || s.checkIn || !this.goCheckIn) return s;
    const [slug, checkIn] = await Promise.all([this.goCheckIn.slugForBranch(device.tenantId, device.branchId).catch(() => null), this.checkInOn(device.tenantId, device.branchId)]);
    return { ...s, ...(slug ? { goCheckInSlug: slug } : {}), ...(checkIn ? { checkIn: true } : {}) };
  }
  /** §14–§28: the salon's check-in is on for this display's branch (best-effort: off on any failure). */
  private async checkInOn(tenantId: string, branchId: string | null): Promise<boolean> {
    return this.goCheckIn?.checkInAvailable ? this.goCheckIn.checkInAvailable(tenantId, branchId).catch(() => false) : false;
  }
  /**
   * 23-inch spec §8, §12, §18 (Unit 7): a guest's check-in session on THIS display, started with the display's own
   * credential — the salon and branch are the display's, and the display needs no kiosk of its own anywhere. A display
   * in maintenance has no check-in (it shows a maintenance screen).
   */
  async startCheckInSession(deviceToken: string | undefined): Promise<DisplayCheckInSession> {
    const d = await this.deviceOnly(deviceToken);
    if (d.maintenance) throw new DisplayError('forbidden', 'This display is being serviced.');
    if (!this.goCheckIn?.startDisplaySession) throw new DisplayError('invalid', 'Check-in is not available on this display.');
    return this.goCheckIn.startDisplaySession({ id: d.id, tenantId: d.tenantId, branchId: d.branchId });
  }

  private isStaleCompleted(row: DisplaySessionRow): boolean {
    if (this.mapState(row) !== 'payment_success' || !row.ticketPaidAt) return false;
    return Date.now() - new Date(row.ticketPaidAt).getTime() >= STALE_COMPLETED_MS;
  }

  /**
   * 23-inch spec §43–§46: the display showed the completed checkout for its 3 seconds and now RELEASES it. The server
   * ends the session (state 'completed'), so no later fetch, reconnect or restart can bring that customer back. Only a
   * checkout that is unequivocally complete — the ticket paid, the receipt question answered — can be released
   * (§96). `sessionId` is what the display was showing: if the POS has already attached the NEXT customer, the release
   * is stale and changes nothing (the new checkout is returned instead).
   */
  async releaseForDevice(deviceToken: string | undefined, sessionId: unknown): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (typeof sessionId !== 'string' || !sessionId) throw new DisplayError('invalid', 'sessionId is required.');
    const s = r.session;
    if (!s) return this.idleState(r.device.tenantId, r.device.branchId, r.device.maintenance);   // already released (or expired): idempotent
    if (s.id !== sessionId) return this.forDevice(r.device, await this.build(s));   // a newer checkout owns the display now
    if (this.mapState(s) !== 'payment_success') throw new DisplayError('invalid', 'This checkout is not complete yet.');
    // §97: never clear the screen while the customer is still choosing a receipt
    if ((await this.receiptFor(s))?.status === 'choose') throw new DisplayError('invalid', 'The customer is still choosing a receipt.');
    if (await this.repo.closeSessionCompleted(s.tenantId, s.id)) this.emitCompleted(r.device, s, 'released');
    return this.idleState(r.device.tenantId, r.device.branchId, r.device.maintenance);
  }

  // the device's own channel + the POS checkout screen hear that the display is free again (ids only)
  private emitCompleted(device: { id: string; tenantId: string; branchId: string | null }, row: DisplaySessionRow, reason: 'released' | 'stale'): void {
    const payload = { sessionId: row.id, ticketId: row.ticketId, reason };
    this.rt?.toCustomerDisplayDevice?.(device.id, EVENTS.customerDisplayCompleted, payload);
    if (row.branchId) this.rt?.toTenant({ tenantId: row.tenantId, branchId: row.branchId }, EVENTS.customerDisplayCompleted, payload);
  }

  async submitTipForDevice(deviceToken: string | undefined, input: TipSubmission): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session) throw new DisplayError('invalid', 'No active checkout on this display.', 'DISPLAY_SESSION_NOT_FOUND');
    return this.forDevice(r.device, await this.applyTipToRow(r.session, input));
  }

  async submitRatingForDevice(deviceToken: string | undefined, rating: number): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session) throw new DisplayError('invalid', 'No active checkout on this display.', 'DISPLAY_SESSION_NOT_FOUND');
    return this.forDevice(r.device, await this.applyRatingToRow(r.session, rating));
  }

  async requestPaymentForDevice(deviceToken: string | undefined): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session) throw new DisplayError('invalid', 'No active checkout on this display.', 'DISPLAY_SESSION_NOT_FOUND');
    return this.forDevice(r.device, await this.requestPaymentForRow(r.session));
  }

  async submitMethodForDevice(deviceToken: string | undefined, method: string): Promise<CustomerDisplayState> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    if (!r.session) throw new DisplayError('invalid', 'No active checkout on this display.', 'DISPLAY_SESSION_NOT_FOUND');
    return this.forDevice(r.device, await this.applyMethodToRow(r.session, method));
  }

  // ---- 23-inch spec §47–§74, §108: the device's advertising (separate from checkout — §113: if it fails, nothing else does) ----
  /** The paired device only (no session needed — an idle display is exactly when ads play). */
  private async deviceOnly(deviceToken: string | undefined): Promise<{ id: string; tenantId: string; branchId: string | null; maintenance?: boolean }> {
    const hash = this.deviceTokenHash(deviceToken);
    const device = hash ? await this.repo.deviceByToken(hash) : null;
    if (!device) throw new DisplayError('forbidden', 'Invalid or missing device token.');
    this.deviceContext(device);
    return device;
  }

  /** §62: tenant, branch and device come from the device's own credential — never from the request. */
  async deviceAdsPlaylist(deviceToken: string | undefined): Promise<CustomerDisplayAdPlaylist> {
    const d = await this.deviceOnly(deviceToken);
    if (!this.ads) return { ...NO_ADS, generatedAt: new Date().toISOString() };
    try { return await this.ads.playlistForDevice({ deviceId: d.id, tenantId: d.tenantId, branchId: d.branchId }); }
    catch (e) { recordDisplayEvent('playlist_failed'); throw e; }   // §108 (the display keeps playing its cached list)
  }

  /** §108: which ads this display put on screen, and for how long (displayed — never "viewed"). */
  async recordDeviceAdDisplays(deviceToken: string | undefined, body: unknown): Promise<{ accepted: number; duplicate: boolean }> {
    const d = await this.deviceOnly(deviceToken);
    if (!this.ads) return { accepted: 0, duplicate: false };
    try {
      const out = await this.ads.recordDisplays({ deviceId: d.id, tenantId: d.tenantId, branchId: d.branchId }, body);
      if (!out.duplicate) recordDisplayEvent('ad_impression', out.accepted);   // §108–§109: displayed, never "viewed"
      return out;
    }
    catch (e: any) {
      if (e?.name === 'DisplayAdError' && e?.code === 'VALIDATION_FAILED') throw new DisplayError('invalid', String(e.message));
      throw e;
    }
  }

  // SSE rooms for a device (spec §100). ALWAYS the device's own channel — an idle display used to subscribe to nothing
  // and stay "connected", so it never heard that the POS had attached a checkout. While a checkout is attached, also
  // that session's room (the display's own actions) and its ticket's room (every POS change to the ticket, §36). The
  // display reconnects when its session changes, so the server re-derives this list; the device never chooses a room.
  async deviceRooms(deviceToken: string | undefined): Promise<string[]> {
    const r = await this.resolveDevice(deviceToken);
    if (!r) return [];
    const out = [rooms.customerDisplayDevice(r.device.id)];
    if (r.session) {
      out.push(rooms.customerDisplay(r.session.id));
      if (r.session.ticketId) out.push(rooms.ticket(r.session.ticketId));
    }
    return out;
  }

  async deviceValid(deviceToken: string | undefined): Promise<boolean> { return !!(await this.resolveDevice(deviceToken)); }

  /** §13: the salon's own header for this device's branch. Best-effort: a failed read shows the name alone. */
  private async branding(tenantId: string, branchId: string | null): Promise<CustomerDisplayState['branding']> {
    try { return buildDisplayBranding(tenantId, await this.repo.brandingSource(tenantId, branchId)); }
    catch { return undefined; }
  }

  private async idleState(tenantId: string, branchId: string | null, maintenance = false): Promise<CustomerDisplayState> {
    const [settings, branding] = await Promise.all([this.repo.resolveSettings(tenantId, branchId), this.branding(tenantId, branchId)]);
    const salonName = branding?.salonName ?? await this.repo.salonName(tenantId);
    // If a Go Check-In kiosk device serves this branch, hand the display its slug so the SAME paired device can render
    // the Go Check-In experience while idle. Best-effort: any failure just falls back to the plain welcome screen.
    const [goCheckInSlug, checkIn] = await Promise.all([
      this.goCheckIn ? this.goCheckIn.slugForBranch(tenantId, branchId).catch(() => null) : Promise.resolve(null),
      maintenance ? Promise.resolve(false) : this.checkInOn(tenantId, branchId),
    ]);
    return {
      state: 'idle', salonName, tipOptions: tipOptions(0, settings.defaultTipPercents, 0),
      selectedTipCents: 0, totals: computeTotals(0, 0, settings, 'card'), payButtonEnabled: settings.customerDisplayPayButtonEnabled,
      checkoutCompleteTimeoutSeconds: settings.checkoutCompleteTimeoutSeconds,
      ...(goCheckInSlug ? { goCheckInSlug } : {}),
      ...(checkIn ? { checkIn: true } : {}),
      languages: ['en'],   // POSLanguage.pdf §16: English only
      ...(branding ? { branding } : {}),
      // §85 MAINTENANCE (the owner's switch): the display shows a maintenance screen — no check-in, no advertising
      ...(maintenance ? { maintenance: true } : {}),
    };
  }

  // ---- internals ----
  private async build(row: DisplaySessionRow): Promise<CustomerDisplayState> {
    const settings = await this.repo.resolveSettings(row.tenantId, row.branchId);
    const state = this.mapState(row);
    // Every number below comes from the checkout projection — the display computes no money of its own (spec §35, §38).
    const checkout = await this.projection(row);
    const subtotal = checkout ? CustomerDisplayService.effective(checkout) : 0;
    const selectedTip = checkout?.tipCents ?? 0;
    const totals: CheckoutTotals = checkout
      ? { subtotalCents: subtotal, tipCents: checkout.tipCents, taxCents: checkout.taxCents, surchargeCents: checkout.customerFeeCents,
          giftCardChargeCents: checkout.giftCardSaleCents, totalDueCents: checkout.totalCents, paymentMethod: checkout.paymentMethod }
      : computeTotals(0, 0, settings, 'card');
    const [branding, firstName] = await Promise.all([this.branding(row.tenantId, row.branchId), this.repo.customerFirstName(row.tenantId, row.customerId)]);
    const salonName = branding?.salonName ?? await this.repo.salonName(row.tenantId);
    // §97–§98: the receipt choice comes right after the payment (the signature, if any, was taken on the card terminal),
    // before the 3-second screen
    const receipt = state === 'payment_success' ? await this.receiptFor(row) : null;
    const tt = checkout && (state === 'ticket_review' || state === 'tip_selected' || state === 'payment_processing' || state === 'payment_failed') ? await this.technicianTipsFor(row, settings) : null;
    return {
      state, salonName, sessionId: row.id, version: row.changedAtMs ?? 0,
      customer: firstName ? { firstName } : undefined,
      ticket: checkout ? { ticketNumber: checkout.ticketNumber || row.ticketNumber || '', services: checkout.lines.map((l) => ({ serviceName: l.name, priceCents: l.amountCents })) } : undefined,
      ...(checkout ? { checkout } : {}),
      tipOptions: tipOptions(subtotal, settings.defaultTipPercents, selectedTip),
      selectedTipCents: selectedTip, totals, payButtonEnabled: settings.customerDisplayPayButtonEnabled,
      checkoutCompleteTimeoutSeconds: settings.checkoutCompleteTimeoutSeconds,
      ...(receipt ? { receipt } : {}),
      ...(branding ? { branding } : {}),
      ...(tt ? { technicianTips: tt.view } : {}),
    };
  }

  // exposed for the SSE controller to compute the room name
  room(sessionId: string): string { return rooms.customerDisplay(sessionId); }

  // notify BOTH the device(s) viewing this session AND the front desk's POS checkout screen (tenant+branch room),
  // so a customer's tip/pay-tap on the iPad reflects live on the POS.
  private emit(row: DisplaySessionRow, event: EventName, payload: Record<string, unknown>): void {
    this.rt?.toCustomerDisplay(row.id, event, payload);
    if (row.branchId) this.rt?.toTenant({ tenantId: row.tenantId, branchId: row.branchId }, event, payload);
  }
}
