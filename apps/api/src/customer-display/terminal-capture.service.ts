import { checkProcessorUrl } from '@aipowersalon/payments';
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
  /** Oct 21 2026: call off the prompt in progress for this salon's display session (see TerminalCaptureService.cancel). */
  cancel?(tenantId: string, sessionId: string): Promise<{ cancelled: true } | { cancelled: false; reason: string }>;
}

export type TerminalCaptureOutcome =
  | { outcome: 'approved'; paymentId: string; retref?: string; amountCents: number }
  | { outcome: 'declined'; paymentId: string; respText: string }
  | { outcome: 'failed'; paymentId?: string; reason: string }
  /** The terminal call threw AFTER the charge was sent: the card may or may not have been charged. Recorded as
   *  'processing' (Decision 22's lost-answer state) — the POS's "Verify with processor" settles it by inquiry on this
   *  ticket's order id; nothing is ever charged again blindly. */
  | { outcome: 'unknown'; paymentId?: string; reason: string }
  /** Oct 21 2026: the front desk called the prompt off — nothing was charged or recorded; the session may try again. */
  | { outcome: 'cancelled' }
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
    try {
      this.emitter?.toCustomerDisplay?.(row.id, event, payload);
      if (row.branchId) this.emitter?.toTenant?.({ tenantId: row.tenantId, branchId: row.branchId }, event, payload);
    } catch { /* realtime must never break the money path */ }
  }

  /** One attempt key per display session — the payments.idempotency_key unique partial index enforces it in the DB. */
  private idemKey(row: DisplaySessionRow): string { return `termcap_${row.id}`; }

  /** the prompts in progress, by display session — what cancel() needs to reach the right terminal */
  private readonly inFlight = new Map<string, { tenantId: string; device: TerminalDevicePort; hsn: string; cancelled: boolean }>();
  /** Oct 21 2026: the front desk calls off a prompt in progress (the guest walked away / chose cash). Only this salon's
   *  own prompt; nothing in progress is a plain no (no terminal call). The capture itself then ends 'cancelled'. */
  async cancel(tenantId: string, sessionId: string): Promise<{ cancelled: true } | { cancelled: false; reason: 'NOTHING_IN_PROGRESS' | 'TERMINAL_UNREACHABLE' | 'NOT_SUPPORTED' }> {
    const f = this.inFlight.get(sessionId);
    if (!f || f.tenantId !== tenantId) return { cancelled: false, reason: 'NOTHING_IN_PROGRESS' };
    if (typeof f.device.cancel !== 'function') return { cancelled: false, reason: 'NOT_SUPPORTED' };
    f.cancelled = true;
    try { await f.device.cancel(f.hsn); }
    catch (e) { f.cancelled = false; this.log.error(`terminal cancel for display session ${sessionId} did not reach the terminal: ${(e as Error).message}`); return { cancelled: false, reason: 'TERMINAL_UNREACHABLE' }; }
    recordPaymentEvent('cancelled');
    return { cancelled: true };
  }

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

  private async captureLocked(row: DisplaySessionRow & { ticketId: string; branchId: string }, idem: string): Promise<TerminalCaptureOutcome> {

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
    // Payment Terminals guide (Nov 4 2026): a DISABLED terminal is not a candidate — the same rule the Capture Routing screen
    // shows (terminals-screen routing). It used to count here: with one live and one disabled terminal the location had
    // no "only terminal", and a register's disabled terminal was chosen and then failed.
    const allTerms: any[] = await this.db.selectFrom('pos_payment_terminals').selectAll()
      .where('tenant_id', '=', row.tenantId as any).where('status', '=', 'paired')
      .where((eb: any) => eb.or([eb('branch_id', '=', row.branchId as any), eb('branch_id', 'is', null)]))
      .execute().catch(() => []);
    const sessRow: any = await this.db.selectFrom('customer_display_sessions').select(['pos_station_id'])
      .where('id', '=', row.id as any).executeTakeFirst().catch(() => undefined);
    const stationId = sessRow?.pos_station_id ? String(sessRow.pos_station_id) : null;
    const terms = allTerms.filter((t) => !t.disabled_at);
    const term = (stationId && terms.find((t) => t.station_id === stationId)) || (terms.length === 1 ? terms[0] : null);
    // nothing live to charge, and the terminal this charge would have used is disabled: say so (not 'no terminal')
    const ownDisabled = term ? null : stationId ? allTerms.find((t) => t.station_id === stationId && t.disabled_at) : terms.length === 0 && allTerms.length === 1 ? allTerms[0] : null;
    if (ownDisabled) return this.fail(row, idem, totals.totalDueCents, `terminal "${ownDisabled.label}" is disabled (TERMINAL_DISABLED)`);
    if (!term) return this.fail(row, idem, totals.totalDueCents, terms.length === 0 ? 'no paired terminal for this branch' : stationId ? 'no terminal is tied to this register (Devices → the terminal\'s register)' : 'several terminals are paired and this display serves no register');
    if (!term.hsn) return this.fail(row, idem, totals.totalDueCents, `terminal "${term.label}" has no HSN configured`);

    // ---- resolve the Bolt config through the provider router (terminal's merchant → branch merchant → tenant default) ----
    if (term.disabled_at) return this.fail(row, idem, totals.totalDueCents, `terminal "${term.label}" is disabled (TERMINAL_DISABLED)`);
    let bolt: { baseUrl: string; apiKey: string; merchantId: string };
    if (this.terminalRoute) {
      const r = await this.terminalRoute.resolveTerminalConfig(row.tenantId, row.branchId, term.merchant_account_id ? String(term.merchant_account_id) : null);
      if (!r.config) return this.fail(row, idem, totals.totalDueCents, r.reason === 'MERCHANT_SUSPENDED' ? 'card payments for this location are paused (MERCHANT_SUSPENDED)' : r.reason === 'SECRET_UNREADABLE' ? 'Bolt api key could not be decrypted' : 'Bolt terminal API is not configured for this location (TERMINAL_NOT_CONFIGURED)');
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
      // Security Deep Scan D2: the same processor-host allowlist as the router — a stored URL off the list never gets the key
      if (!checkProcessorUrl('bolt', String(cfg.bolt_base_url)).ok) return this.fail(row, idem, totals.totalDueCents, 'Bolt terminal address is not an approved processor host (PROCESSOR_URL_NOT_ALLOWED)');
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
    const flight = { tenantId: row.tenantId, device, hsn: String(term.hsn), cancelled: false };
    this.inFlight.set(row.id, flight);
    try {
      auth = await device.authCard({ hsn: String(term.hsn), amountCents: totals.totalDueCents, orderId: row.ticketId });
      await this.stampTerminal(row.tenantId, String(term.id), true);
    } catch (e) {
      this.inFlight.delete(row.id);
      await this.stampTerminal(row.tenantId, String(term.id), false);
      recordPaymentEvent('terminal_offline'); recordPaymentEvent('unknown');   // the terminal did not answer: outcome unknown
      await this.leases.release(row.tenantId, String(term.id), holder).catch(() => undefined);
      // Functional Decision 22 on the Bolt path (Oct 2 2026): a throw here (timeout, dropped connection) can come AFTER
      // the terminal charged the card. Recording it 'failed' invited the front desk to charge again. It is recorded
      // 'processing' — the stuck state the POS resolves with "Verify with processor" (inquiry by order id = this ticket)
      // — and the kiosk stays on "processing" until staff confirm.
      const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'processing', undefined, String(term.id)).catch(() => undefined);
      this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, unknown: true });
      return { outcome: 'unknown', paymentId, reason: `the terminal did not answer (${(e as Error).message}) — verify with the processor before charging again` };
    }
    this.inFlight.delete(row.id);
    await this.leases.release(row.tenantId, String(term.id), holder).catch(() => undefined);   // the terminal is free for the next POS

    // Oct 21 2026: the front desk called the prompt off and the terminal answered without approving — nothing happened.
    // No payment row (a decline would spend the session's one attempt key), so the same session can try again or pay
    // by cash. An approval that beat the cancel is handled below exactly like any approval.
    if (flight.cancelled && !auth.approved) {
      this.emit(row, EVENTS.customerDisplayPaymentRequested, { sessionId: row.id, cancelled: true });
      return { outcome: 'cancelled' };
    }

    if (auth.approved) {
      // Phase 15 round 2: the canonical POS paid path — the payment row (payment.captured), the ticket's paid state
      // (checkout.completed, visit.completed) in ONE transaction, once per display session. The card IS charged here: if
      // recording fails, nothing half-recorded commits; it is logged and kept as the 'processing' row (Decision 22) that
      // the POS's "Verify with processor" settles by inquiry on this ticket — never swallowed, never charged again.
      let rec: { paymentId: string; duplicate: boolean };
      try { rec = await this.recordApproval(row, idem, totals.totalDueCents, totals.tipCents, auth.retref, String(term.id)); }
      catch (e) {
        this.log.error(`terminal capture: card APPROVED (retref ${auth.retref ?? 'none'}, ${totals.totalDueCents} cents) but the payment was not recorded — ticket ${row.ticketId} (tenant ${row.tenantId}, display session ${row.id}) left 'processing' for Verify with processor: ${(e as Error).message}`);
        const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'processing', auth.retref, String(term.id))
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
    const paymentId = await this.recordPayment(row, idem, totals.totalDueCents, totals.tipCents, 'declined', auth.retref, String(term.id));
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
  async recordApproval(row: DisplaySessionRow & { ticketId: string; branchId: string }, idem: string, amountCents: number, tipCents: number, retref?: string, terminalId?: string): Promise<{ paymentId: string; duplicate: boolean }> {
    // the display is not a staff user: no created_by_user_id / actor id (the column is a user uuid); the events say source by correlation
    const ctx = { tenantId: row.tenantId, branchId: row.branchId, userId: undefined, role: 'CUSTOMER', permissions: [] } as unknown as Parameters<KyselyCheckoutRepository['setStatus']>[0];
    return this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      const tk = await k.selectFrom('tickets').select(['id']).where('id', '=', row.ticketId as any).where('tenant_id', '=', row.tenantId as any).forUpdate().executeTakeFirst();
      if (!tk) throw new Error('ticket not found');
      const prior: any = await k.selectFrom('payments').select(['id']).where('tenant_id', '=', row.tenantId as any).where('idempotency_key' as any, '=', idem).executeTakeFirst();
      if (prior) return { paymentId: String(prior.id), duplicate: true };
      const rec = await this.checkoutWriter.recordPayment(ctx, { paymentId: '', ticketId: row.ticketId, method: 'card', amountCents, tipCents, status: 'approved',
        ...(retref ? { processorTransactionId: retref } : {}), idempotencyKey: idem, createdAt: new Date().toISOString(),
        // Payment Terminals mandate §12/§17 (Oct 29 2026): the capture device — the paired terminal that took the card
        ...(terminalId ? { paymentSurface: 'cardpointe_terminal', deviceId: terminalId } : {}) } as any, k);
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

  private async recordPayment(row: DisplaySessionRow, idem: string, amountCents: number, tipCents: number, status: string, retref?: string, terminalId?: string): Promise<string> {
    const r: any = await this.db.insertInto('payments').values({
      id: sql`gen_random_uuid()`, tenant_id: row.tenantId, branch_id: row.branchId, ticket_id: row.ticketId,
      method: 'card', amount_cents: amountCents, tip_cents: tipCents, status,
      ...(terminalId ? { payment_surface: 'cardpointe_terminal', device_id: terminalId } : {}),   // the capture device (Payment Terminals §17)
      ...(retref ? { processor_transaction_id: retref } : {}), idempotency_key: idem,
    } as any).returning('id' as any).executeTakeFirst();
    return String(r?.id ?? '');
  }
}
