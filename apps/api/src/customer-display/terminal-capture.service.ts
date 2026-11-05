// terminal-capture.service.ts — terminal auto-trigger: when the customer taps Pay on the iPad (and the branch is
// configured with customerDisplayCaptureMode='terminal'), the backend initiates the charge on the PAIRED PHYSICAL
// TERMINAL instead of waiting for the front desk.
//
// Honesty rules (same as the rest of the pay path):
//   • never synthesize an approval — only a real Bolt respstat 'A' marks the ticket paid;
//   • a decline or a config failure BEFORE the charge writes an honest payments row ('declined' / 'failed'), which is exactly
//     what drives the kiosk's payment_failed screen (built for the front-desk decline path) — the customer is never
//     left on an infinite spinner; a terminal call that throws mid-charge is 'processing' (may be charged — verify, D22);
//   • card only — a cash customer always completes with the front desk;
//   • idempotent per session: one charge attempt key per display session, so a double Pay-tap (or a poll/SSE race)
//     can never double-charge.
//
// The physical-device leg (real Bolt UAT/hardware) is the ONLY unverified part; everything orchestrated here is
// exercised against a Bolt-shaped local HTTP server in scripts/verify-terminal-capture.ts.

import { resolveCheckoutSettings, KyselyCheckoutRepository, KyselyTerminalLeases, CheckoutLockService, KyselyCheckoutLockRepository, LockHeldElsewhereError, type PaymentMethod, type TerminalLeasePort } from '@aipowersalon/checkout';
import { EVENTS, type EventName, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DisplaySessionRow } from './customer-display.repository';
import { terminalSignatureDataUrl, type TerminalDevicePort, type BoltConfig } from '@aipowersalon/payments';
import { recordPaymentEvent } from '@aipowersalon/observability';   // wave 3 PAYI §104

export interface TerminalCapturePort {
  /** Attempt the terminal charge for a paying display session. Resolves when the attempt is fully recorded. */
  capture(row: DisplaySessionRow): Promise<TerminalCaptureOutcome>;
}

export type TerminalCaptureOutcome =
  | { outcome: 'approved'; paymentId: string; retref?: string; amountCents: number }
  | { outcome: 'declined'; paymentId: string; respText: string }
  | { outcome: 'failed'; paymentId?: string; reason: string }
  /** The terminal call threw AFTER the charge was sent: the card may or may not have been charged. Recorded as
   *  'processing' (Decision 22's lost-answer state) — the POS's "Verify with processor" settles it by inquiry on this
   *  ticket's order id; nothing is ever charged again blindly. */
  | { outcome: 'unknown'; paymentId?: string; reason: string }
  /** Functional Decision 34: another transaction is active on this shared terminal — nothing was charged or recorded; try again. */
  | { outcome: 'terminal_busy'; terminalId: string; reason: 'TERMINAL_BUSY' }
  /** Oct 6 2026: another payment holds this ticket (the front desk recording one, or the manager's phone) — nothing was
   *  charged or recorded. */
  | { outcome: 'ticket_busy'; reason: 'PAYMENT_IN_PROGRESS'; heldBy: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'duplicate'; paymentId: string };

/** Phase 15 round 3: the POS's post-payment work (CheckoutService.runPostPaymentWork — its afterPaid, not a copy). */
export interface TerminalPostPaymentPort {
  runPostPaymentWork(scope: { tenantId: string; branchId: string }, ticketId: string): Promise<{ ran: boolean }>;
}

/** Builds a TerminalDevicePort for one tenant's Bolt config (injected so tests can supply a simulator/local server). */
export type TerminalDeviceFactory = (cfg: BoltConfig) => TerminalDevicePort;

/** How long the display's terminal charge may hold the ticket: the terminal waits for the customer's card (Bolt blocks),
 *  so longer than a front-desk payment; a lock left by a crash still expires. */
const TICKET_LOCK_MS = 4 * 60_000;
/** Pseudo display-session id prefix for a front-desk (POS) terminal attempt. */
const POS_ROW_PREFIX = 'pos:';

export class TerminalCaptureService implements TerminalCapturePort {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly deviceFactory: TerminalDeviceFactory,
    private readonly decrypt: (enc: string) => string,
    private readonly emitter?: RealtimeEmitter,
    /** Functional Decision 34 — the shared-terminal reservation; database-backed by default (migration 485). */
    leases?: TerminalLeasePort,
    /** The ticket's checkout lock — one payment at a time per ticket (Oct 6 2026); database-backed by default. */
    ticketLocks?: CheckoutLockService,
    /** Phase 15 round 2: the approval's payment.captured / checkout.completed / visit.completed go through this outbox,
     *  in the paid transaction (KyselyCheckoutRepository). Stateless; the module passes the DI instance. */
    outbox: OutboxWriter = new OutboxWriter(),
    private readonly log: Pick<Logger, 'error'> = new Logger('TerminalCapture'),
    /** Phase 15 round 3: deals / coupons, reward code, compensation snapshot, membership commission, review request,
     *  gift-card sale + reload activation for a terminal-paid ticket — the module passes CheckoutService. */
    private readonly postPayment?: TerminalPostPaymentPort,
    /** Payments mandate §13 / §17 (wave 3): THE provider router decides which merchant account's Bolt key drives this
     *  terminal (terminal → branch merchant → tenant default) and opens it with the PAYMENT secrets. Before this, the
     *  Bolt key was read straight off tenant_payment_config and opened with the MFA key: a key sealed by Super Admin
     *  (v2p:, PAYMENT_ENC_KEY) passed through unchanged and the Clover was called with ciphertext as its API key. */
    private readonly terminalRoute?: { resolveTerminalConfig(tenantId: string, branchId: string | null, merchantAccountId?: string | null): Promise<{ config: { baseUrl: string; apiKey: string; merchantId: string } | null; reason?: string }> },
  ) {
    this.checkoutWriter = new KyselyCheckoutRepository(db, outbox);
    this.leases = leases ?? new KyselyTerminalLeases(db as any);
    this.ticketLocks = ticketLocks ?? new CheckoutLockService(new KyselyCheckoutLockRepository(db as any), TICKET_LOCK_MS);
  }
  private readonly leases: TerminalLeasePort;
  private readonly ticketLocks: CheckoutLockService;
  private readonly checkoutWriter: KyselyCheckoutRepository;

  private emit(row: DisplaySessionRow, event: EventName, payload: Record<string, unknown>): void {
    // A front-desk (POS) attempt has no display session: it never addresses a display and never sends the display-only
    // "payment requested" / signature events; the POS learns its outcome from the HTTP answer + paid/approved events.
    const isPos = String(row.id).startsWith(POS_ROW_PREFIX);
    if (isPos && (event === EVENTS.customerDisplayPaymentRequested || event === EVENTS.customerDisplaySignatureCaptured)) return;
    try {
      if (!isPos) this.emitter?.toCustomerDisplay?.(row.id, event, payload);
      if (row.branchId) this.emitter?.toTenant?.({ tenantId: row.tenantId, branchId: row.branchId }, event, payload);
    } catch { /* realtime must never break the money path */ }
  }

  /** One attempt key per display session — the payments.idempotency_key unique partial index enforces it in the DB. */
  private idemKey(row: DisplaySessionRow): string { return `termcap_${row.id}`; }

  async capture(row: DisplaySessionRow): Promise<TerminalCaptureOutcome> {
    // ---- gates (all honest skips, never errors shown to the customer) ----
    if (!row.ticketId || !row.branchId) return { outcome: 'skipped', reason: 'session has no ticket/branch' };
    const settings = await resolveCheckoutSettings(this.db, row.tenantId, row.branchId);
    if (settings.customerDisplayCaptureMode !== 'terminal') return { outcome: 'skipped', reason: 'capture mode is front_desk' };
    const method = (row.paymentMethod || 'card') as PaymentMethod;
    if (method !== 'card') return { outcome: 'skipped', reason: 'cash completes with the front desk' };

    // ---- idempotency: one charge attempt per session ----
    const idem = this.idemKey(row);
    const existing: any = await this.db.selectFrom('payments').select(['id', 'status'])
      .where('tenant_id', '=', row.tenantId as any).where('idempotency_key' as any, '=', idem)
      .executeTakeFirst().catch(() => undefined);
    if (existing) return { outcome: 'duplicate', paymentId: String(existing.id) };

    // ---- one payment at a time per ticket (Oct 6 2026) ----
    // The ticket's checkout lock is held from here until the outcome is recorded — through the terminal's wait for the
    // card. A cash payment at the front desk while the customer taps their card used to be recorded beside the card
    // charge (paid twice); now it is refused (PAYMENT_IN_PROGRESS) until this finishes, and if the front desk is already
    // recording one, this charge does not start.
    // The lock session is per ATTEMPT, not per display session (Phase 15 round 2): the lock is re-entrant for its own
    // session, so two Pay taps racing past the payments check above both held it and both sent a charge to the terminal
    // (reproduced: the second approval then hit the idempotency index and was lost). Now the second attempt is ticket_busy.
    const lockSession = 'display-pay:' + row.id + ':' + randomUUID(), ticketId = row.ticketId, branchId = row.branchId;
    try {
      await this.ticketLocks.acquire({ tenantId: row.tenantId, branchId, ticketId, userId: row.id, sessionId: lockSession, source: 'display' });
    } catch (e: unknown) {
      if (e instanceof LockHeldElsewhereError) {
        this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, ticketBusy: true });
        return { outcome: 'ticket_busy', reason: 'PAYMENT_IN_PROGRESS', heldBy: e.heldBy.source };   // nothing charged, nothing recorded
      }
      throw e;
    }
    try { return await this.captureLocked({ ...row, ticketId, branchId }, idem); }
    finally { await this.ticketLocks.release(row.tenantId, ticketId, lockSession, 'display_payment_done').catch(() => undefined); }
  }

  /**
   * Fiserv master build §7 / §8B (Nov 4 2026): the FRONT DESK "Pay on Clover Compact" button. Before this, the POS Card
   * button posted /pay/card with no terminal and no token, so it could never reach the Compact. This drives the SAME path
   * the customer display uses — ticket lock, one-transaction-per-terminal lease, the provider router (branch-scoped
   * merchant + allowlisted Bolt host + production gates), Bolt authCard, amount/retref reconciliation, the canonical paid
   * transaction, signature and post-payment work — so there is exactly one terminal money path.
   *
   *   • idempotent per attempt: `attemptKey` (generated by the POS once per tender) becomes the payment's idempotency key;
   *     a retry of a lost response returns the recorded outcome instead of charging again;
   *   • the terminal is the one the cashier picked, else the one tied to this register, else the branch's only one — always
   *     a terminal assigned to THIS branch;
   *   • the ticket must belong to this branch; the amount is the server's ticket total less what is already paid.
   */
  async captureForPos(scope: { tenantId: string; branchId: string; userId?: string | null }, ticketId: string, opts: { attemptKey: string; terminalId?: string | null; stationId?: string | null }): Promise<TerminalCaptureOutcome & { idempotencyKey?: string }> {
    if (!scope.tenantId || !scope.branchId) return { outcome: 'skipped', reason: 'choose a location before taking a card payment' };
    // the ticket lock names the staff member who is taking the payment (checkout_locks.user_id is a user uuid)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(scope.userId || ''))) return { outcome: 'skipped', reason: 'sign in as a staff member to take a card payment' };
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(opts.attemptKey || ''))) return { outcome: 'skipped', reason: 'a payment attempt key is required' };
    const idem = `termcap_pos_${opts.attemptKey}`;
    const existing: any = await this.db.selectFrom('payments').select(['id', 'status', 'amount_cents', 'processor_transaction_id'] as any)
      .where('tenant_id', '=', scope.tenantId as any).where('idempotency_key' as any, '=', idem).executeTakeFirst().catch(() => undefined);
    if (existing) {
      const st = String(existing.status);
      if (st === 'approved') return { outcome: 'approved', paymentId: String(existing.id), retref: existing.processor_transaction_id ?? undefined, amountCents: Number(existing.amount_cents), idempotencyKey: idem };
      if (st === 'processing') return { outcome: 'unknown', paymentId: String(existing.id), reason: 'this payment is still being verified — use Verify with processor before charging again', idempotencyKey: idem };
      return { outcome: 'duplicate', paymentId: String(existing.id), idempotencyKey: idem };
    }
    const tk: any = await this.db.selectFrom('tickets').select(['id', 'branch_id', 'customer_id'] as any)
      .where('id', '=', ticketId as any).where('tenant_id', '=', scope.tenantId as any).executeTakeFirst().catch(() => undefined);
    if (!tk) return { outcome: 'skipped', reason: 'the ticket was not found' };
    if (String(tk.branch_id) !== String(scope.branchId)) return { outcome: 'skipped', reason: 'this ticket belongs to another location' };
    const row = {
      id: POS_ROW_PREFIX + opts.attemptKey, tenantId: scope.tenantId, branchId: scope.branchId, ticketId, state: 'payment_processing', ticketNumber: null,
      customerId: tk.customer_id ?? null, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 0, paymentMethod: 'card', expiresAt: null, closedAt: null,
      ticketStatus: null, lastPaymentStatus: null,
    } as unknown as DisplaySessionRow & { ticketId: string; branchId: string };
    const lockSession = 'pos-terminal:' + opts.attemptKey + ':' + randomUUID();
    try {
      await this.ticketLocks.acquire({ tenantId: scope.tenantId, branchId: scope.branchId, ticketId, userId: String(scope.userId), sessionId: lockSession, source: 'pos' });
    } catch (e: unknown) {
      if (e instanceof LockHeldElsewhereError) return { outcome: 'ticket_busy', reason: 'PAYMENT_IN_PROGRESS', heldBy: e.heldBy.source };
      throw e;
    }
    try { return { ...(await this.captureLocked(row, idem, { terminalId: opts.terminalId ?? null, stationId: opts.stationId ?? null })), idempotencyKey: idem }; }
    finally { await this.ticketLocks.release(scope.tenantId, ticketId, lockSession, 'pos_terminal_payment_done').catch(() => undefined); }
  }

  /** Cancel the prompt on the terminal that is charging this ticket (POS "Cancel"). Fiserv: a cancel cannot stop an
   *  authorization already sent to the Gateway — the attempt's outcome still comes from the terminal / Verify. */
  async cancelForPos(scope: { tenantId: string; branchId: string }, ticketId: string): Promise<{ cancelled: boolean; reason?: string }> {
    const live = this.inFlight.get(`${scope.tenantId}|${ticketId}`);
    if (!live || live.branchId !== scope.branchId) return { cancelled: false, reason: 'no terminal prompt is running for this ticket on this server' };
    if (!live.device.cancel) return { cancelled: false, reason: 'this terminal cannot be cancelled from the POS' };
    try { await live.device.cancel(live.hsn); return { cancelled: true }; }
    catch (e) { return { cancelled: false, reason: (e as Error).message.slice(0, 200) }; }
  }

  /** Terminals the front desk may pick for this branch (never another branch's; disabled ones are listed as such). */
  async terminalsForPos(scope: { tenantId: string; branchId: string }): Promise<Array<{ id: string; label: string; stationId: string | null; disabled: boolean; lastSeenAt: string | null; hsnConfigured: boolean }>> {
    if (!scope.tenantId || !scope.branchId) return [];
    const rows: any[] = await this.db.selectFrom('pos_payment_terminals').select(['id', 'label', 'station_id', 'disabled_at', 'last_seen_at', 'hsn'] as any)
      .where('tenant_id', '=', scope.tenantId as any).where('branch_id', '=', scope.branchId as any).where('status', '=', 'paired').orderBy('label').execute().catch(() => []);
    return rows.map((r) => ({ id: String(r.id), label: String(r.label || 'Terminal'), stationId: r.station_id ? String(r.station_id) : null, disabled: !!r.disabled_at,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null, hsnConfigured: !!r.hsn }));
  }

  /** The device instances currently prompting for a card, so the POS can cancel its own prompt (per process). */
  private readonly inFlight = new Map<string, { device: TerminalDevicePort; hsn: string; branchId: string }>();

  private async captureLocked(row: DisplaySessionRow & { ticketId: string; branchId: string }, idem: string, pick?: { terminalId?: string | null; stationId?: string | null }): Promise<TerminalCaptureOutcome> {

    // ---- amount: server-recomputed from the session (never client-supplied) ----
    // 23-inch spec §35 — one authoritative checkout: the terminal is asked for exactly what the POS's payCard would
    // charge — the TICKET's card total less what is already paid. It used to charge the display session's copy (subtotal
    // and tip stored when the session was created): a tip or discount added at the POS afterwards never reached the charge,
    // a gift card that had already paid part was charged again in full, and a fully paid ticket was charged a second time.
    // A ticket the front desk has already settled (cash, say) is never charged again. The card total carries the card
    // fee, so "card total − paid" was still a few dollars after a full cash payment — and the terminal asked for them
    // (found Oct 6 2026 by the one-payment-per-ticket test).
    const tk: any = await this.db.selectFrom('tickets').select(['status', 'paid_at'] as any).where('id', '=', row.ticketId as any).where('tenant_id', '=', row.tenantId as any).executeTakeFirst().catch(() => undefined);
    if (tk && (tk.status === 'paid' || tk.paid_at)) return { outcome: 'skipped', reason: 'the ticket is already paid' };
    const checkout = new KyselyCheckoutRepository(this.db);
    const cctx = { tenantId: row.tenantId, branchId: row.branchId, userId: 'customer-display:' + row.id, role: 'CUSTOMER', permissions: [] } as Parameters<KyselyCheckoutRepository['totalsFor']>[0];
    const ticketTotals = await checkout.totalsFor(cctx, row.ticketId, 'card');
    if (!ticketTotals) return { outcome: 'skipped', reason: 'the ticket was not found' };
    const due = Math.max(0, ticketTotals.totalDueCents - await checkout.paidTotalCents(cctx, row.ticketId));
    if (due <= 0) return { outcome: 'skipped', reason: 'nothing is left to charge on this ticket' };
    const totals = { totalDueCents: due, tipCents: ticketTotals.tipCents };

    // ---- resolve the physical terminal: station-paired first, else the branch's single paired terminal ----
    // Fiserv master build §5.2: only a terminal EXPLICITLY assigned to this branch may charge this branch's ticket. A
    // terminal with no branch (branch_id NULL) used to match every branch of the tenant — it now matches none; assign it
    // to its location in Devices first.
    const terms: any[] = await this.db.selectFrom('pos_payment_terminals').selectAll()
      .where('tenant_id', '=', row.tenantId as any).where('status', '=', 'paired')
      .where('branch_id', '=', row.branchId as any)
      .execute().catch(() => []);
    let stationId: string | null;
    if (pick) stationId = pick.stationId ?? null;
    else {
      const sessRow: any = await this.db.selectFrom('customer_display_sessions').select(['pos_station_id'])
        .where('id', '=', row.id as any).executeTakeFirst().catch(() => undefined);
      stationId = sessRow?.pos_station_id ? String(sessRow.pos_station_id) : null;
    }
    // the cashier's explicit pick (POS) must be a terminal of THIS branch — terms is already branch-scoped
    if (pick?.terminalId && !terms.some((t) => String(t.id) === String(pick.terminalId))) return this.fail(row, idem, totals.totalDueCents, 'that terminal is not paired at this location');
    const term = (pick?.terminalId && terms.find((t) => String(t.id) === String(pick.terminalId))) || (stationId && terms.find((t) => t.station_id === stationId)) || (terms.length === 1 ? terms[0] : null);
    if (!term) return this.fail(row, idem, totals.totalDueCents, terms.length === 0 ? 'no paired terminal for this branch' : stationId ? 'no terminal is tied to this register (Devices → the terminal\'s register)' : pick ? 'several terminals are paired here — choose one' : 'several terminals are paired and this display serves no register');
    if (!term.hsn) return this.fail(row, idem, totals.totalDueCents, `terminal "${term.label}" has no HSN configured`);

    // ---- resolve the Bolt config through the provider router (terminal's merchant → branch merchant → tenant default) ----
    if (term.disabled_at) return this.fail(row, idem, totals.totalDueCents, `terminal "${term.label}" is disabled (TERMINAL_DISABLED)`);
    let bolt: { baseUrl: string; apiKey: string; merchantId: string };
    if (this.terminalRoute) {
      const r = await this.terminalRoute.resolveTerminalConfig(row.tenantId, row.branchId, term.merchant_account_id ? String(term.merchant_account_id) : null);
      if (!r.config) return this.fail(row, idem, totals.totalDueCents, terminalRouteRefusal(r.reason));
      bolt = r.config;
    } else {
      // legacy path (no router injected — unit harnesses): the tenant default row, opened with the injected decrypt
      const cfg: any = await this.db.selectFrom('tenant_payment_config').select(['merchant_id', 'bolt_base_url', 'bolt_api_key_enc'])
        .where('tenant_id', '=', row.tenantId as any).executeTakeFirst().catch(() => undefined);
      if (!cfg?.bolt_base_url || !cfg?.bolt_api_key_enc || !cfg?.merchant_id) {
        return this.fail(row, idem, totals.totalDueCents, 'Bolt terminal API is not configured for this tenant');
      }
      let apiKey: string;
      try { apiKey = this.decrypt(String(cfg.bolt_api_key_enc)); }
      catch { return this.fail(row, idem, totals.totalDueCents, 'Bolt api key could not be decrypted'); }
      bolt = { baseUrl: String(cfg.bolt_base_url), apiKey, merchantId: String(cfg.merchant_id) };
    }

    // ---- Functional Decision 34: ONE transaction at a time on a shared terminal (database lease, migration 485) ----
    const holder = 'display:' + row.id;
    if (!(await this.leases.acquire(row.tenantId, String(term.id), holder))) {
      this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, terminalBusy: true });
      recordPaymentEvent('terminal_busy');
      return { outcome: 'terminal_busy', terminalId: String(term.id), reason: 'TERMINAL_BUSY' };   // nothing charged, nothing recorded
    }

    // ---- the charge: only a real respstat decides anything ----
    const device = this.deviceFactory(bolt);
    let auth;
    recordPaymentEvent('attempt');
    const flightKey = `${row.tenantId}|${row.ticketId}`;
    this.inFlight.set(flightKey, { device, hsn: String(term.hsn), branchId: row.branchId });
    try {
      auth = await device.authCard({ hsn: String(term.hsn), amountCents: totals.totalDueCents, orderId: row.ticketId });
      await this.stampTerminal(row.tenantId, String(term.id), true);
    } catch (e) {
      this.inFlight.delete(flightKey);
      await this.stampTerminal(row.tenantId, String(term.id), false);
      recordPaymentEvent('terminal_offline'); recordPaymentEvent('unknown');   // the terminal did not answer: outcome unknown
      await this.leases.release(row.tenantId, String(term.id), holder).catch(() => undefined);
      // Functional Decision 22 on the Bolt path (Oct 2 2026): a throw here (timeout, dropped connection) can come AFTER
      // the terminal charged the card. Recording it 'failed' invited the front desk to charge again. It is recorded
      // 'processing' — the stuck state the POS resolves with "Verify with processor" (inquiry by order id = this ticket)
      // — and the kiosk stays on "processing" until staff confirm.
      const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'processing', undefined).catch(() => undefined);
      this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, unknown: true });
      return { outcome: 'unknown', paymentId, reason: `the terminal did not answer (${(e as Error).message}) — verify with the processor before charging again` };
    }
    this.inFlight.delete(flightKey);
    await this.leases.release(row.tenantId, String(term.id), holder).catch(() => undefined);   // the terminal is free for the next POS

    // Fiserv master build §7.2: "Paid" only when the provider approval, retref and amount reconcile. An approval with no
    // retref or a different amount is contradictory — kept 'processing' for Verify with processor, never closed as paid.
    if (auth.approved && (!auth.retref || (auth.amountCents != null && auth.amountCents !== totals.totalDueCents))) {
      this.log.error(`terminal capture: approval does not reconcile (retref ${auth.retref ?? 'none'}, approved ${auth.amountCents ?? '?'} vs requested ${totals.totalDueCents} cents) — ticket ${row.ticketId} left 'processing'`);
      const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'processing', auth.retref).catch(() => undefined);
      this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, unknown: true });
      return { outcome: 'unknown', paymentId, reason: 'the terminal approval does not match the requested amount — verify with the processor before charging again' };
    }
    if (auth.approved) {
      // Phase 15 round 2: the canonical POS paid path — the payment row (payment.captured), the ticket's paid state
      // (checkout.completed, visit.completed) in ONE transaction, once per display session. The card IS charged here: if
      // recording fails, nothing half-recorded commits; it is logged and kept as the 'processing' row (Decision 22) that
      // the POS's "Verify with processor" settles by inquiry on this ticket — never swallowed, never charged again.
      let rec: { paymentId: string; duplicate: boolean };
      try { rec = await this.recordApproval(row, idem, totals.totalDueCents, totals.tipCents, auth.retref); }
      catch (e) {
        this.log.error(`terminal capture: card APPROVED (retref ${auth.retref ?? 'none'}, ${totals.totalDueCents} cents) but the payment was not recorded — ticket ${row.ticketId} (tenant ${row.tenantId}, display session ${row.id}) left 'processing' for Verify with processor: ${(e as Error).message}`);
        const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'processing', auth.retref)
          .catch((e2: unknown) => { this.log.error(`terminal capture: the 'processing' row for ticket ${row.ticketId} could not be written either: ${(e2 as Error).message}`); return undefined; });
        this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, unknown: true });
        return { outcome: 'unknown', paymentId, reason: 'the terminal approved the card but recording it failed — verify with the processor before charging again' };
      }
      if (rec.duplicate) return { outcome: 'duplicate', paymentId: rec.paymentId };
      recordPaymentEvent('approved');
      const paymentId = rec.paymentId;
      // Phase 15 round 3: the POS's post-payment work, once — only for the approval that was just recorded (a duplicate
      // returned above), after the paid transaction committed and still under this ticket's lock, exactly where the POS
      // runs afterPaid. Best-effort after the money like the POS: its steps log their own failures; nothing here undoes
      // the payment.
      await this.runPostPayment(row);
      this.emit(row, EVENTS.paymentApproved, { ticketId: row.ticketId, method: 'card', source: 'terminal' });
      this.emit(row, EVENTS.ticketPaid, { ticketId: row.ticketId });
      await this.keepSignature(row, paymentId, auth.signature);
      return { outcome: 'approved', paymentId, retref: auth.retref, amountCents: auth.amountCents ?? totals.totalDueCents };
    }

    // declined (respstat C) or retry (B) — both are an honest non-approval; the kiosk shows payment_failed
    recordPaymentEvent('declined');
    const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'declined', auth.retref);
    this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, declined: true });
    return { outcome: 'declined', paymentId, respText: auth.respText || auth.respstat };
  }

  /**
   * Kevin, Oct 6 2026: the cardholder signs ONCE, on the Clover terminal (the display never asks). The signature the
   * terminal returned is kept on the payment (migration 513, captured_on 'terminal') so the front desk can view it as
   * before. Best-effort and after the money is recorded: a missing or unreadable signature never touches the payment.
   */
  /** §50 terminal health: the registry remembers when the terminal last answered / last transacted (migration 638). */
  private async stampTerminal(tenantId: string, terminalId: string, answered: boolean): Promise<void> {
    await this.db.updateTable('pos_payment_terminals')
      .set(answered ? ({ last_seen_at: sql`now()`, last_transaction_at: sql`now()`, last_ping_ok: true } as any) : ({ last_ping_at: sql`now()`, last_ping_ok: false } as any))
      .where('tenant_id', '=', tenantId as any).where('id', '=', terminalId as any).execute().catch(() => undefined);
  }

  private async keepSignature(row: DisplaySessionRow, paymentId: string, raw: string | undefined): Promise<void> {
    const image = terminalSignatureDataUrl(raw);
    if (!image || !paymentId || !row.branchId) return;
    try {
      const r: any = await this.db.insertInto('payment_signatures').values({
        tenant_id: row.tenantId, branch_id: row.branchId, payment_id: paymentId, ticket_id: row.ticketId,
        signature_png: image, captured_on: 'terminal',
      } as any).onConflict((oc: any) => oc.columns(['tenant_id', 'payment_id']).doNothing()).executeTakeFirst();
      if (Number(r?.numInsertedOrUpdatedRows ?? 0) > 0) this.emit(row, EVENTS.customerDisplaySignatureCaptured, { sessionId: row.id, paymentId, ticketId: row.ticketId, source: 'terminal' });
    } catch { /* the payment stands; only the copy of the signature is missing */ }
  }

  /**
   * Record an APPROVED terminal charge exactly as the POS records a paid card (Phase 15 round 2), in one transaction:
   * the ticket row is locked first, so a second delivery of the same approval waits, then finds this session's payment
   * (its idempotency key) and records nothing — `duplicate`. Otherwise KyselyCheckoutRepository.recordPayment writes the
   * row + payment.captured and setStatus('paid') writes paid_at + checkout.completed + visit.completed; any failure
   * throws and rolls all of it back. Amount and tip are exactly what was charged (unchanged from before).
   */
  async recordApproval(row: DisplaySessionRow & { ticketId: string; branchId: string }, idem: string, amountCents: number, tipCents: number, retref?: string): Promise<{ paymentId: string; duplicate: boolean }> {
    // the display is not a staff user: no created_by_user_id / actor id (the column is a user uuid); the events say source by correlation
    const ctx = { tenantId: row.tenantId, branchId: row.branchId, userId: undefined, role: 'CUSTOMER', permissions: [] } as unknown as Parameters<KyselyCheckoutRepository['setStatus']>[0];
    return this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      const tk = await k.selectFrom('tickets').select(['id']).where('id', '=', row.ticketId as any).where('tenant_id', '=', row.tenantId as any).forUpdate().executeTakeFirst();
      if (!tk) throw new Error('ticket not found');
      const prior: any = await k.selectFrom('payments').select(['id']).where('tenant_id', '=', row.tenantId as any).where('idempotency_key' as any, '=', idem).executeTakeFirst();
      if (prior) return { paymentId: String(prior.id), duplicate: true };
      const rec = await this.checkoutWriter.recordPayment(ctx, { paymentId: '', ticketId: row.ticketId, method: 'card', amountCents, tipCents, status: 'approved',
        ...(retref ? { processorTransactionId: retref } : {}), idempotencyKey: idem, createdAt: new Date().toISOString() } as any, k);
      if (!(await this.checkoutWriter.setStatus(ctx, row.ticketId, 'paid', k))) throw new Error('ticket not found');
      return { paymentId: String(rec.paymentId), duplicate: false };
    });
  }

  private async runPostPayment(row: DisplaySessionRow & { ticketId: string; branchId: string }): Promise<void> {
    if (!this.postPayment) return;
    try {
      const r = await this.postPayment.runPostPaymentWork({ tenantId: row.tenantId, branchId: row.branchId }, row.ticketId);
      if (!r.ran) this.log.error(`terminal capture: post-payment work did not run for ticket ${row.ticketId} (tenant ${row.tenantId}) — the store does not show it paid`);
    } catch (e) {
      this.log.error(`terminal capture: post-payment work failed for paid ticket ${row.ticketId} (tenant ${row.tenantId}): ${(e as Error).message}`);
    }
  }

  /** A config/transport failure: record an honest 'failed' payments row so the kiosk reflects it (never a fake decline reason). */
  private async fail(row: DisplaySessionRow, idem: string, amountCents: number, reason: string): Promise<TerminalCaptureOutcome> {
    const paymentId = await this.recordPayment(row, idem, amountCents, row.selectedTipCents || 0, 'failed', undefined).catch(() => undefined);
    this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, failed: true, reason });
    return { outcome: 'failed', paymentId, reason };
  }

  private async recordPayment(row: DisplaySessionRow, idem: string, amountCents: number, tipCents: number, status: string, retref?: string): Promise<string> {
    const r: any = await this.db.insertInto('payments').values({
      id: sql`gen_random_uuid()`, tenant_id: row.tenantId, branch_id: row.branchId, ticket_id: row.ticketId,
      method: 'card', amount_cents: amountCents, tip_cents: tipCents, status,
      ...(retref ? { processor_transaction_id: retref } : {}), idempotency_key: idem,
    } as any).returning('id' as any).executeTakeFirst();
    return String(r?.id ?? '');
  }
}

/** Human-readable refusal for the terminal route (no secrets, no MID). */
export function terminalRouteRefusal(reason?: string): string {
  switch (reason) {
    case 'MERCHANT_SUSPENDED': return 'card payments for this location are paused (MERCHANT_SUSPENDED)';
    case 'SECRET_UNREADABLE': return 'Bolt api key could not be decrypted';
    case 'MERCHANT_BRANCH_MISMATCH': return 'this terminal belongs to a different location\'s merchant account (MERCHANT_BRANCH_MISMATCH)';
    case 'HOST_NOT_ALLOWED': return 'the terminal API address is not an approved Fiserv host for this environment (HOST_NOT_ALLOWED)';
    case 'PRODUCTION_NOT_APPROVED': return 'live card payments are not approved for this merchant yet (PRODUCTION_NOT_APPROVED)';
    default: return 'Bolt terminal API is not configured for this location (TERMINAL_NOT_CONFIGURED)';
  }
}
