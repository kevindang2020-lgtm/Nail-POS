// payment-channels-center.ts — Three Ways to Pay SUNMI guide (Nov 9 2026): the three payment channels of THIS location, as
// the server knows them — Clover Compact at the front desk, a staff iPhone with Tap to Pay, the Customer App (saved card /
// Pay Now) — plus the open ticket's payment status and the read-only "Check Three Payment Channels".
//
// READ-ONLY by construction: nothing here charges, authorizes, pings a provider, sends a prompt, saves a token, enrolls a
// merchant or changes a surcharge. Every channel is ALWAYS returned (a channel that cannot take money is shown with the
// reason and the next step — never hidden). States are server facts:
//   ready            the channel may take a payment here (in UAT mode it is a TEST lane — `mode` says so; never "certified")
//   setup_required   something the salon can fix (no terminal, no HSN, no phone, Customer App payments off …)
//   provider_pending an approval that belongs to the processor / Apple (production not approved, entitlement pending …)
//   blocked          a safety stop (merchant paused, platform kill switch, merchant/branch mismatch, host not allowed)
//   unavailable      could not be read / nothing online right now
// The open ticket's status comes from the canonical ledger (payments, payment attempts, checkout locks, Customer App
// intents): paid / partially paid / in progress / unknown — "Unknown" is never shown as declined or as paid.
// Money: integer cents. No card data, no token, no full MID ever leaves this file (merchant ids are masked by the router).
import { sql } from 'kysely';
import type { PcChannel, PcChannelKey, PcChannelState, PcCheckResponse, PcResponse, PcTicketStatus } from '@aipowersalon/api-contracts/tenant';
import { KyselyCheckoutRepository } from '../checkout/checkout.kysely.repository';
import { SURFACE_TAP_TO_PAY_IPHONE, isTerminalSurface } from '@aipowersalon/payments';
import { resolveGiftCardSaleSettings } from '../checkout/checkout-settings.resolver';

export interface PcCtx { tenantId: string; branchId: string; userId?: string | null; role?: string; permissions?: string[] }

/** the router methods this reader needs — never the credentials (resolveTerminalConfig's key is not read or returned) */
export interface PcGatewayPort {
  resolve(tenantId: string, branchId?: string | null): Promise<{ configured: boolean; status: string; environment: 'sandbox' | 'production'; merchantIdMasked: string; scope?: 'tenant' | 'branch'; pausedByPlatform?: boolean; blockedReason?: string }>;
  resolveTerminalConfig(tenantId: string, branchId: string | null, merchantAccountId?: string | null): Promise<{ config: unknown | null; reason?: string; blockedReason?: string }>;
  resolveTapToPayMerchant(tenantId: string, branchId?: string | null): Promise<unknown | null>;
  tokenizerUrl(tenantId: string, branchId?: string | null): Promise<{ available: boolean; reason?: string }>;
}
/** the Tap to Pay facts the mobile-checkout service already owns */
export interface PcTapToPayPort {
  getTapToPayOnboarding(ctx: PcCtx): Promise<{ appleEntitlementStatus: string; commerceHubStatus: string; onboarded: boolean; credentialsPresent: boolean; updatedAt?: string | null }>;
  tapToPayOffReason(tenantId: string): Promise<'platform' | 'provider' | 'rollout' | null>;
  deviceStatusForPos(ctx: PcCtx): Promise<{ deviceId: string; label: string | null; userName: string | null; online: boolean; status: string; tapToPayCapable: boolean; lastSeenAt: string | null }[]>;
}

export class PaymentChannelsError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = 'PaymentChannelsError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const mask = (s: string | null | undefined): string | null => { const x = String(s ?? '').replace(/\s/g, ''); return x ? (x.length <= 4 ? '••' + x : '••••' + x.slice(-4)) : null; };
/** payment_attempts states still moving (a second tender must wait) and the ones nobody knows the answer to */
export const PC_ATTEMPT_IN_FLIGHT = ['created', 'readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending', 'authorized', 'confirmation_pending', 'processing'] as const;
export const PC_ATTEMPT_UNKNOWN = ['unknown', 'reconciliation_required', 'needs_review'] as const;
const PAID_STATUSES = ['approved', 'partial', 'captured', 'settled'];
/** gift card statuses a card can still be spent in (a balance is still required) */
export const PC_GIFT_REDEEMABLE = ['active', 'partially_redeemed', 'delivered', 'claimed'] as const;
const surfaceChannel = (s: string | null | undefined, method?: string | null): PcChannelKey | null =>
  s === SURFACE_TAP_TO_PAY_IPHONE ? 'tap_to_pay_iphone' : isTerminalSurface(s) ? 'clover_compact' : method === 'customer_app' ? 'customer_app' : null;
const TERMINAL_RECENT_MS = 15 * 60_000;

export class PaymentChannelsCenter {
  constructor(readonly db: any, private readonly gw: PcGatewayPort | null, private readonly ttp: PcTapToPayPort | null, private readonly now: () => Date = () => new Date()) {}

  private liveMode(): boolean { return process.env.PAYMENTS_LIVE_MODE === '1' || process.env.PAYMENTS_LIVE_MODE === 'true'; }

  async channels(ctx: PcCtx, ticketId?: string | null): Promise<PcResponse> {
    if (!ctx.tenantId || !ctx.branchId) throw new PaymentChannelsError('PAYMENT_CHANNELS_NO_LOCATION', 'Choose a location first.');
    if (ticketId != null && ticketId !== '' && !UUID.test(ticketId)) throw new PaymentChannelsError('PAYMENT_CHANNELS_TICKET_INVALID', 'That ticket id is not valid.');
    const checkedAt = this.now().toISOString();
    const branch: any = await this.db.selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.branchId).executeTakeFirst();
    if (!branch) throw new PaymentChannelsError('PAYMENT_CHANNELS_NO_LOCATION', 'This location was not found.', 404);
    const merchant = await this.merchant(ctx);
    const ticket = ticketId ? await this.ticket(ctx, ticketId) : null;
    const [clover, iphone, app] = await Promise.all([this.clover(ctx, merchant), this.iphone(ctx), this.customerApp(ctx, merchant, ticket)]);
    // one ticket, one tender at a time: while a payment is moving (or unknown, or the ticket is paid) every channel's
    // pay action is held — the server refuses a second one anyway (locks + idempotency); the screen says why first.
    if (ticket) for (const c of [clover, iphone, app]) {
      if (ticket.status === 'paid') { c.actionAllowed = false; c.actionHeldBy = 'ticket_paid'; }
      else if (ticket.status === 'in_progress') { c.actionAllowed = false; c.actionHeldBy = 'payment_in_progress'; }
      else if (ticket.status === 'unknown') { c.actionAllowed = false; c.actionHeldBy = 'verify_first'; }
      else if (ticket.balanceCents != null && ticket.balanceCents <= 0) { c.actionAllowed = false; c.actionHeldBy = 'nothing_due'; }
    }
    return { checkedAt, branch: { id: String(branch.id), name: String(branch.name ?? '') }, liveMode: this.liveMode(), merchant, ticket, channels: [clover, iphone, app] };
  }

  private async merchant(ctx: PcCtx): Promise<PcResponse['merchant']> {
    if (!this.gw) return { configured: false, masked: null, environment: null, scope: null, status: 'not_configured', pausedByPlatform: false, blockedReason: null };
    try {
      const g = await this.gw.resolve(ctx.tenantId, ctx.branchId);
      return { configured: !!g.configured, masked: g.merchantIdMasked || null, environment: g.environment ?? null, scope: g.scope ?? null, status: String(g.status ?? 'not_configured'), pausedByPlatform: !!g.pausedByPlatform, blockedReason: g.blockedReason ?? null };
    } catch { return { configured: false, masked: null, environment: null, scope: null, status: 'unreadable', pausedByPlatform: false, blockedReason: 'MERCHANT_UNREADABLE' }; }
  }

  // ── the open ticket, from the canonical ledger ────────────────────────────────────────────────────────────────
  private async ticket(ctx: PcCtx, ticketId: string): Promise<PcTicketStatus> {
    const t: any = await this.db.selectFrom('tickets').select(['id', 'branch_id', 'ticket_number', 'status', 'paid_at', 'customer_id', 'removed_at'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    if (!t || t.removed_at) throw new PaymentChannelsError('TICKET_NOT_FOUND', 'Ticket not found.', 404);
    if (String(t.branch_id) !== String(ctx.branchId)) throw new PaymentChannelsError('PAYMENT_CHANNELS_OTHER_LOCATION', 'This ticket belongs to another location.', 403);
    const pays: any[] = await this.db.selectFrom('payments').select(['id', 'method', 'status', 'amount_cents', 'payment_surface', 'processor_transaction_id', 'approved_at', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).orderBy('created_at', 'asc').execute();
    const intents: any[] = await this.db.selectFrom('payment_intents').select(['id', 'status', 'processor_ref', 'updated_at', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).orderBy('created_at', 'desc').execute();
    const attempts: any[] = await this.db.selectFrom('payment_attempts').select(['id', 'status', 'payment_surface', 'method', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('status', 'in', [...PC_ATTEMPT_IN_FLIGHT, ...PC_ATTEMPT_UNKNOWN]).execute();
    const locks: any[] = await this.db.selectFrom('checkout_locks').select(['source', 'owner_device_id', 'acquired_at'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('released_at', 'is', null).where('expires_at', '>', this.now()).execute();
    const appRefs = new Set(intents.filter((i) => i.status === 'succeeded' && i.processor_ref).map((i) => String(i.processor_ref)));
    const paid = pays.filter((p) => PAID_STATUSES.includes(String(p.status)));
    const paidCents = paid.reduce((s, p) => s + Number(p.amount_cents ?? 0), 0);
    let dueCents: number | null = null;
    try {
      const repo = new KyselyCheckoutRepository(this.db);
      const cctx: Parameters<KyselyCheckoutRepository['totalsFor']>[0] = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: String(ctx.userId ?? ''), role: String(ctx.role ?? ''), permissions: ctx.permissions ?? [] } as Parameters<KyselyCheckoutRepository['totalsFor']>[0];
      const totals = await repo.totalsFor(cctx, ticketId, 'card');
      dueCents = totals ? Math.max(0, Math.trunc(totals.totalDueCents)) : null;
    } catch { dueCents = null; }   // unknown due stays unknown ("—"), never 0
    const channelOf = (p: any): PcChannelKey | 'other' => surfaceChannel(p.payment_surface) ?? (p.processor_transaction_id && appRefs.has(String(p.processor_transaction_id)) ? 'customer_app' : 'other');
    const lastPaid = paid[paid.length - 1];
    const unknownPay = pays.some((p) => ['unknown', 'pending_verification', 'processing'].includes(String(p.status)));
    const attemptUnknown = attempts.find((a) => (PC_ATTEMPT_UNKNOWN as readonly string[]).includes(String(a.status)));
    const attemptMoving = attempts.find((a) => (PC_ATTEMPT_IN_FLIGHT as readonly string[]).includes(String(a.status)));
    const appMoving = intents.find((i) => i.status === 'processing');
    const appSent = intents.find((i) => i.status === 'requires_action');
    const lock = locks[0];
    const isPaid = String(t.status) === 'paid' || !!t.paid_at;
    let status: PcTicketStatus['status']; let inProgressVia: PcChannelKey | 'front_desk' | null = null;
    if (isPaid) status = 'paid';
    else if (unknownPay || attemptUnknown) { status = 'unknown'; inProgressVia = attemptUnknown ? surfaceChannel(attemptUnknown.payment_surface) : null; }
    else if (appMoving) { status = 'in_progress'; inProgressVia = 'customer_app'; }
    else if (attemptMoving) { status = 'in_progress'; inProgressVia = surfaceChannel(attemptMoving.payment_surface) ?? 'front_desk'; }
    else if (lock) { status = 'in_progress'; inProgressVia = lock.source === 'mobile' ? 'tap_to_pay_iphone' : 'front_desk'; }
    else if (paidCents > 0) status = 'partially_paid';
    else status = 'unpaid';
    return {
      id: String(t.id), number: t.ticket_number != null ? String(t.ticket_number) : null, status, inProgressVia,
      appPromptOpen: !!appSent && !isPaid,
      dueCents, paidCents, balanceCents: isPaid ? 0 : dueCents == null ? null : Math.max(0, dueCents - paidCents),   // a settled ticket owes nothing (card-fee remainder included)
      paidVia: isPaid && lastPaid ? channelOf(lastPaid) : null,
      paidAt: isPaid ? iso(t.paid_at ?? lastPaid?.approved_at ?? lastPaid?.created_at) : null,
      hasCustomer: !!t.customer_id,
    };
  }

  // ── 1 · Clover Compact at the front desk ──────────────────────────────────────────────────────────────────────
  private async clover(ctx: PcCtx, merchant: PcResponse['merchant']): Promise<PcChannel> {
    const base: PcChannel = { key: 'clover_compact', state: 'unavailable', reason: null, mode: merchant.environment === 'production' ? 'production' : merchant.environment === 'sandbox' ? 'uat' : null, actionAllowed: false, actionHeldBy: null, lastVerifiedAt: null, facts: {} };
    let terms: any[];
    try {
      terms = await this.db.selectFrom('pos_payment_terminals').select(['id', 'label', 'hsn', 'serial_number', 'terminal_type', 'merchant_account_id', 'disabled_at', 'last_seen_at', 'last_ping_at', 'last_ping_ok'])
        .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', ctx.branchId).where('status', '=', 'paired').orderBy('label').execute();
    } catch { return { ...base, reason: 'TERMINALS_UNREADABLE' }; }
    const live = terms.filter((x) => !x.disabled_at);
    const withHsn = live.filter((x) => x.hsn);
    const pick = withHsn[0] ?? live[0] ?? null;
    const lastOk = live.filter((x) => x.last_ping_ok && x.last_ping_at).map((x) => new Date(x.last_ping_at).getTime()).sort((a, b) => b - a)[0];
    const seen = live.filter((x) => x.last_seen_at).map((x) => new Date(x.last_seen_at).getTime()).sort((a, b) => b - a)[0];
    base.facts = {
      terminals: live.length, disabledTerminals: terms.length - live.length,
      terminalLabel: pick ? String(pick.label ?? '') : null, terminalType: pick?.terminal_type ? String(pick.terminal_type) : null,
      hsnMasked: pick ? mask(pick.hsn ?? pick.serial_number) : null,
      merchantMasked: merchant.masked, lastSuccessfulPingAt: lastOk ? new Date(lastOk).toISOString() : null, lastSeenAt: seen ? new Date(seen).toISOString() : null,
      recentlySeen: !!seen && this.now().getTime() - seen < TERMINAL_RECENT_MS,
    };
    base.lastVerifiedAt = (base.facts.lastSuccessfulPingAt as string | null) ?? (base.facts.lastSeenAt as string | null);
    if (merchant.pausedByPlatform) return { ...base, state: 'blocked', reason: 'PLATFORM_PAUSED' };
    if (!live.length) return { ...base, state: 'setup_required', reason: terms.length ? 'TERMINALS_ALL_DISABLED' : 'NO_TERMINAL' };
    if (!withHsn.length) return { ...base, state: 'setup_required', reason: 'TERMINAL_HSN_MISSING' };
    if (!this.gw) return { ...base, state: 'unavailable', reason: 'ROUTER_UNAVAILABLE' };
    let r: { config: unknown | null; reason?: string; blockedReason?: string };
    try { r = await this.gw.resolveTerminalConfig(ctx.tenantId, ctx.branchId, pick?.merchant_account_id ?? null); }
    catch { return { ...base, state: 'unavailable', reason: 'MERCHANT_UNREADABLE' }; }
    if (!r.config) {
      const reason = String(r.reason ?? 'TERMINAL_NOT_CONFIGURED');
      const state: PcChannelState = reason === 'PRODUCTION_NOT_APPROVED' ? 'provider_pending'
        : reason === 'MERCHANT_SUSPENDED' || reason === 'MERCHANT_BRANCH_MISMATCH' || reason === 'HOST_NOT_ALLOWED' ? 'blocked'
        : reason === 'SECRET_UNREADABLE' ? 'unavailable' : 'setup_required';
      return { ...base, state, reason: r.blockedReason && state === 'provider_pending' ? String(r.blockedReason) : reason };
    }
    return { ...base, state: 'ready', reason: base.mode === 'uat' ? 'UAT_TEST_LANE' : null, actionAllowed: true };
  }

  // ── 2 · Staff iPhone — Tap to Pay (the native app does the tap; the POS shows status and hands off) ───────────
  private async iphone(ctx: PcCtx): Promise<PcChannel> {
    const base: PcChannel = { key: 'tap_to_pay_iphone', state: 'unavailable', reason: null, mode: process.env.COMMERCEHUB_TTP_ENV === 'production' ? 'production' : 'uat', actionAllowed: false, actionHeldBy: null, lastVerifiedAt: null, facts: {} };
    if (!this.ttp) return { ...base, reason: 'TAP_TO_PAY_SERVICE_UNAVAILABLE' };
    let ob: Awaited<ReturnType<PcTapToPayPort['getTapToPayOnboarding']>>; let off: Awaited<ReturnType<PcTapToPayPort['tapToPayOffReason']>>; let phones: Awaited<ReturnType<PcTapToPayPort['deviceStatusForPos']>>;
    try { [ob, off, phones] = await Promise.all([this.ttp.getTapToPayOnboarding(ctx), this.ttp.tapToPayOffReason(ctx.tenantId), this.ttp.deviceStatusForPos(ctx)]); }
    catch { return { ...base, reason: 'TAP_TO_PAY_UNREADABLE' }; }
    let ttpMerchant = false;
    try { ttpMerchant = !!(this.gw && await this.gw.resolveTapToPayMerchant(ctx.tenantId, ctx.branchId)); } catch { ttpMerchant = false; }
    const capable = phones.filter((p) => p.tapToPayCapable);
    const online = capable.filter((p) => p.online);
    const seen = phones.map((p) => (p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0)).sort((a, b) => b - a)[0];
    base.facts = {
      appleEntitlement: ob.appleEntitlementStatus, processorTtp: ob.commerceHubStatus, onboarded: ob.onboarded, credentialsPresent: ob.credentialsPresent,
      merchantAssigned: ttpMerchant, phones: phones.length, capablePhones: capable.length, onlinePhones: online.length,
      devices: online.slice(0, 8).map((p) => ({ deviceId: p.deviceId, label: p.label ?? null, userName: p.userName ?? null })),
      onboardingUpdatedAt: ob.updatedAt ?? null,
    };
    base.lastVerifiedAt = seen ? new Date(seen).toISOString() : null;
    if (off) return { ...base, state: 'blocked', reason: off === 'platform' ? 'TAP_TO_PAY_OFF_PLATFORM' : off === 'provider' ? 'TAP_TO_PAY_OFF_PROVIDER' : 'TAP_TO_PAY_NOT_IN_ROLLOUT' };
    if (!ob.onboarded) return { ...base, state: 'provider_pending', reason: ob.appleEntitlementStatus !== 'approved' ? 'APPLE_ENTITLEMENT_PENDING' : ob.commerceHubStatus !== 'active' ? 'PROCESSOR_TTP_PENDING' : 'TAP_TO_PAY_CREDENTIALS_MISSING' };
    if (!ttpMerchant) return { ...base, state: 'setup_required', reason: 'TAP_TO_PAY_MERCHANT_MISSING' };
    if (!capable.length) return { ...base, state: 'setup_required', reason: 'NO_APPROVED_PHONE' };
    if (!online.length) return { ...base, state: 'unavailable', reason: 'NO_PHONE_ONLINE' };
    return { ...base, state: 'ready', reason: base.mode === 'uat' ? 'UAT_TEST_LANE' : null, actionAllowed: true };
  }

  // ── 3 · Customer App — saved card / Pay Now (hosted tokenizer + card-not-present) ─────────────────────────────
  private async customerApp(ctx: PcCtx, merchant: PcResponse['merchant'], ticket: PcTicketStatus | null): Promise<PcChannel> {
    const base: PcChannel = { key: 'customer_app', state: 'unavailable', reason: null, mode: merchant.environment === 'production' ? 'production' : merchant.environment === 'sandbox' ? 'uat' : null, actionAllowed: false, actionHeldBy: null, lastVerifiedAt: null, facts: {} };
    // Skip-the-Line settings: a read error is "off" (fail closed — the same rule skip-line itself follows)
    let featureEnabled = false; let settingsUnreadable = false;
    try {
      const s: any = await this.db.selectFrom('skip_line_checkout_settings').select(['feature_enabled']).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      featureEnabled = s ? !!s.feature_enabled : true;   // no row = the product default (on), exactly as skip-line reads it
    } catch { settingsUnreadable = true; }
    let tokenizer: { available: boolean; reason?: string } = { available: false, reason: 'router_unavailable' };
    if (this.gw) { try { tokenizer = await this.gw.tokenizerUrl(ctx.tenantId, ctx.branchId); } catch { tokenizer = { available: false, reason: 'merchant_unreadable' }; } }
    let savedCards: number | null = null;
    if (ticket?.hasCustomer) {
      try {
        const t: any = await this.db.selectFrom('tickets').select(['customer_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticket.id).executeTakeFirst();
        const r: any = t?.customer_id ? await this.db.selectFrom('customer_payment_methods').select((eb: any) => eb.fn.countAll().as('n'))
          .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', t.customer_id).where('revoked_at', 'is', null).where('token_source', '=', 'hosted_iframe').executeTakeFirst() : { n: 0 };
        savedCards = Number(r?.n ?? 0);
      } catch { savedCards = null; }
    }
    // when this location last took a verified app payment — an informational fact; a read error says "unreadable"
    const lastAppRead: { updated_at?: unknown } | 'unreadable' | undefined = await this.db.selectFrom('payment_intents').select(['updated_at']).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', ctx.branchId).where('status', '=', 'succeeded')
      .orderBy('updated_at', 'desc').limit(1).executeTakeFirst().catch(() => 'unreadable' as const);
    const lastApp = lastAppRead === 'unreadable' ? undefined : lastAppRead;
    base.facts = { appPaymentsEnabled: featureEnabled, hostedTokenizer: tokenizer.available, tokenizerReason: tokenizer.available ? null : tokenizer.reason ?? null, merchantMasked: merchant.masked,
      ticketHasCustomer: ticket ? ticket.hasCustomer : null, customerSavedCards: savedCards, promptOpen: ticket?.appPromptOpen ?? false, lastAppPaymentAt: iso(lastApp?.updated_at), lastAppPaymentReadable: lastAppRead !== 'unreadable' };
    base.lastVerifiedAt = iso(lastApp?.updated_at);
    if (merchant.pausedByPlatform) return { ...base, state: 'blocked', reason: 'PLATFORM_PAUSED' };
    if (settingsUnreadable) return { ...base, state: 'unavailable', reason: 'APP_SETTINGS_UNREADABLE' };
    if (!featureEnabled) return { ...base, state: 'setup_required', reason: 'APP_PAYMENTS_OFF' };
    if (!tokenizer.available) {
      const r = String(tokenizer.reason ?? '').toUpperCase();
      const state: PcChannelState = /PRODUCTION|VALIDATED|BOARDED|NOT_ENABLED|NOT_VERIFIED/.test(r) ? 'provider_pending' : /PAUSED|SUSPENDED|HOST/.test(r) ? 'blocked' : 'setup_required';
      return { ...base, state, reason: r ? 'TOKENIZER_' + r : 'TOKENIZER_UNAVAILABLE' };
    }
    const ready: PcChannel = { ...base, state: 'ready', reason: base.mode === 'uat' ? 'UAT_TEST_LANE' : null, actionAllowed: true };
    if (ticket && !ticket.hasCustomer) return { ...ready, actionAllowed: false, actionHeldBy: 'no_customer' };
    return ready;
  }

  // ── Check Three Payment Channels (read-only) ──────────────────────────────────────────────────────────────────
  async check(ctx: PcCtx): Promise<PcCheckResponse> {
    const checkedAt = this.now().toISOString();
    const out: PcCheckResponse['checks'] = [];
    const push = (key: string, area: PcCheckResponse['checks'][number]['area'], state: PcCheckResponse['checks'][number]['state'], reason: string | null, count?: number) => out.push({ key, area, state, reason, ...(count != null ? { count } : {}) });
    let r: PcResponse | null = null;
    try { r = await this.channels(ctx, null); push('channels_readable', 'shared', 'PASSED', null); }
    catch (e) { push('channels_readable', 'shared', 'FAILED', e instanceof PaymentChannelsError ? e.code : 'CHANNELS_UNREADABLE'); }
    // shared checkout: payments still moving or unknown at this location (oldest first matters to support)
    try {
      const stale = await sql<{ moving: number; unknown: number }>`select
          count(*) filter (where status = any(${[...PC_ATTEMPT_IN_FLIGHT]}::text[]) and created_at < now() - interval '15 minutes')::int as moving,
          count(*) filter (where status = any(${[...PC_ATTEMPT_UNKNOWN]}::text[]))::int as unknown
        from payment_attempts where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}`.execute(this.db);
      const m = Number(stale.rows[0]?.moving ?? 0), u = Number(stale.rows[0]?.unknown ?? 0);
      push('unknown_payments', 'shared', u ? 'WARNING' : 'PASSED', u ? 'VERIFY_UNKNOWN_PAYMENTS' : null, u);
      push('stuck_payments', 'shared', m ? 'WARNING' : 'PASSED', m ? 'PAYMENTS_STUCK_IN_PROGRESS' : null, m);
      const appStuck = await sql<{ n: number }>`select count(*)::int as n from payment_intents where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId} and status = 'processing' and updated_at < now() - interval '15 minutes'`.execute(this.db);
      const a = Number(appStuck.rows[0]?.n ?? 0);
      push('app_payments_unsettled', 'shared', a ? 'WARNING' : 'PASSED', a ? 'APP_PAYMENTS_NEED_VERIFY' : null, a);
    } catch { push('unknown_payments', 'shared', 'INSUFFICIENT_DATA', 'LEDGER_UNREADABLE'); }
    // round 10 (Split Payments 02): processor callback (webhook) processing health for this salon, last 24 hours — from the
    // recorded payment_gateway_events only (this location's events, plus the salon's events not tied to a location). A
    // callback that arrived with a valid signature but was never processed after 15 minutes is "stuck"; a bad signature is
    // counted (and was never applied). No callbacks recorded is "not enough data", never a pass.
    try {
      const w = (await sql<{ received: number; processed: number; bad_sig: number; stuck: number }>`select count(*)::int as received,
          count(*) filter (where processed_at is not null)::int as processed,
          count(*) filter (where signature_valid = false)::int as bad_sig,
          count(*) filter (where signature_valid and processed_at is null and created_at < now() - interval '15 minutes')::int as stuck
        from payment_gateway_events where tenant_id = ${ctx.tenantId} and (branch_id = ${ctx.branchId} or branch_id is null) and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0];
      const rec = Number(w?.received ?? 0), stuck = Number(w?.stuck ?? 0), bad = Number(w?.bad_sig ?? 0);
      push('webhook_processing', 'shared', !rec ? 'INSUFFICIENT_DATA' : stuck ? 'WARNING' : 'PASSED', !rec ? 'NO_CALLBACKS_24H' : stuck ? 'CALLBACKS_NOT_PROCESSED' : null, rec ? (stuck || Number(w?.processed ?? 0)) : undefined);
      push('webhook_signatures', 'shared', bad ? 'WARNING' : rec ? 'PASSED' : 'INSUFFICIENT_DATA', bad ? 'CALLBACK_SIGNATURE_FAILURES' : rec ? null : 'NO_CALLBACKS_24H', bad || undefined);
    } catch { push('webhook_processing', 'shared', 'INSUFFICIENT_DATA', 'LEDGER_UNREADABLE'); }
    const lane = (key: string, area: 'clover' | 'iphone' | 'saved_card', c?: PcChannel) => {
      if (!c) return push(key, area, 'UNAVAILABLE', 'CHANNELS_UNREADABLE');
      const state = c.state === 'ready' ? (c.mode === 'uat' ? 'WARNING' : 'PASSED') : c.state === 'provider_pending' ? 'PROVIDER_APPROVAL_PENDING' : c.state === 'blocked' ? 'FAILED' : c.state === 'unavailable' ? 'UNAVAILABLE' : 'WARNING';
      push(key, area, state, c.reason ?? (c.state === 'ready' && c.mode === 'uat' ? 'UAT_TEST_LANE' : null));
    };
    lane('clover_compact', 'clover', r?.channels[0]);
    const term = r?.channels[0];
    if (term && term.state === 'ready') push('terminal_ping', 'clover', term.facts.lastSuccessfulPingAt ? 'PASSED' : 'INSUFFICIENT_DATA', term.facts.lastSuccessfulPingAt ? null : 'NO_SUCCESSFUL_PING_ON_RECORD');
    lane('tap_to_pay_iphone', 'iphone', r?.channels[1]);
    lane('customer_app', 'saved_card', r?.channels[2]);
    // round 10 (Split Payments 15): the two non-card split methods per location, read through the SAME rules Checkout uses.
    // Cash has no switch in Checkout (always accepted). Gift card REDEMPTION has no on/off switch either — its scope comes
    // from this location's gift-card settings (crossBranchRedemption: cards of every location vs this location's + salon-wide
    // cards); gift card SALES follow enabled + posSalesEnabled (Checkout refuses a sale with GIFT_CARDS_DISABLED /
    // GIFT_CARD_SALES_DISABLED). The count is the live cards with money this location would accept.
    push('cash_method', 'shared', 'PASSED', 'CASH_ALWAYS_ACCEPTED');
    try {
      const gc = await resolveGiftCardSaleSettings(this.db, ctx.tenantId, ctx.branchId);
      const cards = await sql<{ n: number }>`select count(*)::int as n from gift_cards where tenant_id = ${ctx.tenantId} and status = any(${[...PC_GIFT_REDEEMABLE]}::text[]) and balance_cents > 0
          ${gc.crossBranchRedemption ? sql`` : sql`and (branch_id = ${ctx.branchId} or branch_id is null)`}`.execute(this.db);
      push('gift_card_method', 'shared', 'PASSED', gc.crossBranchRedemption ? 'GIFT_CARD_REDEEM_ALL_LOCATIONS' : 'GIFT_CARD_REDEEM_THIS_LOCATION', Number(cards.rows[0]?.n ?? 0));
      push('gift_card_sales', 'shared', gc.enabled && gc.posSalesEnabled ? 'PASSED' : 'WARNING', !gc.enabled ? 'GIFT_CARDS_DISABLED' : !gc.posSalesEnabled ? 'GIFT_CARD_SALES_DISABLED' : null);
    } catch { push('gift_card_method', 'shared', 'INSUFFICIENT_DATA', 'SETTINGS_UNREADABLE'); }
    // compliance: production money stays off until processor approval; card fees are never a flat local percentage
    push('live_mode', 'compliance', r?.liveMode ? 'PASSED' : 'PROVIDER_APPROVAL_PENDING', r?.liveMode ? null : 'PRODUCTION_PAYMENTS_DISABLED');
    try {
      // a card surcharge switched on here needs the merchant's provider enrollment — never a local flat fee
      const s: any = await this.db.selectFrom('checkout_settings').select(['credit_card_surcharge_enabled']).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      const enrolled = await sql<{ n: number }>`select ((select count(*) from payment_merchant_accounts where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId} and surcharge_enrolled)
          + (select count(*) from tenant_payment_config where tenant_id = ${ctx.tenantId} and surcharge_enrolled))::int as n`.execute(this.db);
      const on = !!s?.credit_card_surcharge_enabled; const ok = Number(enrolled.rows[0]?.n ?? 0) > 0;
      push('surcharge_policy', 'compliance', on && !ok ? 'WARNING' : 'PASSED', on && !ok ? 'SURCHARGE_ON_WITHOUT_PROVIDER_ENROLLMENT' : on ? 'SURCHARGE_PROVIDER_ENROLLED' : null);
    } catch { push('surcharge_policy', 'compliance', 'INSUFFICIENT_DATA', 'SETTINGS_UNREADABLE'); }
    push('no_side_effects', 'shared', 'PASSED', null);
    const order = ['FAILED', 'UNAVAILABLE', 'PROVIDER_APPROVAL_PENDING', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'] as const;
    const overall = order.find((s) => out.some((c) => c.state === s)) ?? 'PASSED';
    return { overall, checkedAt, checks: out };
  }
}
