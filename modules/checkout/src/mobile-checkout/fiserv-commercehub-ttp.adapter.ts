// fiserv-commercehub-ttp.adapter.ts — the Fiserv CommerceHub implementation of the Tap to Pay session boundary.
//
// Honesty contract (spec §7): this adapter NEVER fabricates a session token or a successful charge.
//   • Not configured (no CommerceHub TTP credentials) → TapToPayNotConfiguredError.
//   • Configured but no charges client available (COMMERCEHUB_BASE_URL unset) → TapToPayNotImplementedError.
// When configured AND a client is available, both operations run against the CommerceHub client (commercehub.client.ts,
// implemented from Fiserv's published docs): mintDeviceSession → Security Credentials API (start a PaymentSession),
// finalizeTransaction → Charges API (charge/verify the captured PaymentSession). Amounts stay in integer cents at
// this boundary; no merchant secret is ever returned. The client's request/response mapping is validated by contract
// tests and carries VERIFY markers to confirm the exact field names against your CommerceHub sandbox.
import { instrumentedFetch } from '@aipowersalon/observability';
import { fiservTtpConfigFromEnv, type FiservTtpConfig } from './ttp-config';
import { CommerceHubClient, commerceHubConfigFromEnv } from '@aipowersalon/payments';
import {
  TapToPayNotConfiguredError, TapToPayNotImplementedError,
  type DeviceSession, type FinalizeInput, type FinalizeResult, type MintSessionInput, type TapToPaySessionPort, type TapToPayLookup, type TapToPayMerchantRef,
} from './tap-to-pay-session';

export class FiservCommerceHubTtpAdapter implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  // Injectable config (tests) or env (prod). null ⇒ not configured. `client` is the CommerceHub client used for both
  // the session-mint (Security Credentials API) and the finalize charge; when omitted it is built from env, and is
  // null until COMMERCEHUB_BASE_URL is set.
  constructor(
    private readonly cfg: FiservTtpConfig | null = fiservTtpConfigFromEnv(),
    private readonly client: CommerceHubClient | null | undefined = undefined,
  ) {}

  isConfigured(): boolean { return this.cfg !== null; }

  async mintDeviceSession(input: MintSessionInput): Promise<DeviceSession> {
    if (!this.cfg) throw new TapToPayNotConfiguredError();
    const client = this.client === undefined ? this.buildClient(input.merchant) : this.client;
    if (!client) throw new TapToPayNotImplementedError();
    // Start a CommerceHub PaymentSession (Security Credentials API). No card data on the backend — the card is captured
    // on-device by the SDK, which initialises with these credentials.
    const s = await client.createSession({ idempotencyKey: input.idempotencyKey });
    const ttlMs = (s.expiresInSeconds ?? 30 * 60) * 1000;
    return { provider: 'fiserv_commercehub', sessionToken: s.sessionId, accessToken: s.accessToken, publicKey: s.publicKey, expiresAt: new Date(Date.now() + ttlMs).toISOString(), environment: this.cfg.environment };
  }

  async finalizeTransaction(input: FinalizeInput): Promise<FinalizeResult> {
    if (!this.cfg) throw new TapToPayNotConfiguredError();
    const client = this.client === undefined ? this.buildClient(input.merchant) : this.client;
    if (!client) throw new TapToPayNotImplementedError();
    // Charge the captured PaymentSession server-side (input.processorRef carries the sessionId the device SDK returned).
    const res = await client.authorizeAndCapture({ account: input.processorRef, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
    // the client's own three-way reading (§232): only an explicit DECLINED / FAILED is a decline — anything else that is not
    // approved is 'unknown' and goes to verification (M6-5: a 200 PENDING was recorded as a decline).
    // Fiserv master build §8C (Nov 4 2026): verified only when the PROVIDER approved AND confirmed the exact amount; an
    // approval without a matching amount is not paid — it is 'unknown' (provider inquiry / manual review).
    const amountMatches = res.amountCents === input.amountCents;
    const outcome = res.approved && !amountMatches ? 'unknown' : res.outcome === 'retry' ? 'unknown' : res.outcome;
    return {
      verified: res.approved && amountMatches, outcome,
      processorRef: res.retref ?? input.processorRef,
      capturedAmountCents: res.amountCents,
      respText: res.approved && !amountMatches ? `Provider approved ${res.amountCents ?? 'an unconfirmed amount'} cents, expected ${input.amountCents}; held for review` : res.respText,
    };
  }

  /**
   * §76 / §78: the provider's answer for an unresolved attempt. The CommerceHub client (owned by @aipowersalon/payments)
   * exposes a transaction inquiry only once `inquireByOrderId` is implemented and verified against the sandbox — until
   * then this answers `no_inquiry` (a human resolves the attempt from the processor portal; nothing is auto-decided).
   * BLOCKED_EXTERNAL: live verification needs CommerceHub credentials.
   */
  async lookupTransaction(input: { tenantId: string; idempotencyKey: string; processorRef?: string | null; amountCents: number; merchant?: TapToPayMerchantRef }): Promise<TapToPayLookup> {
    if (!this.cfg) throw new TapToPayNotConfiguredError();
    const client = this.client === undefined ? this.buildClient(input.merchant) : this.client;
    if (!client) throw new TapToPayNotImplementedError();
    const inquire = (client as any).inquireByOrderId as undefined | ((orderId: string) => Promise<{ transactions: { retref?: string; approved: boolean; declined: boolean; amountCents?: number; authCode?: string; respText?: string }[] }>);
    if (typeof inquire !== 'function') return { kind: 'no_inquiry' };
    let txns: { retref?: string; approved: boolean; declined: boolean; amountCents?: number; respText?: string }[];
    try { txns = (await inquire.call(client, input.idempotencyKey)).transactions; }
    catch (e: any) { return { kind: 'unreachable', error: String(e?.message ?? e).slice(0, 200) }; }
    // Oct 28 2026 (mandate audit, §35 / §36 / §73): the inquiry is BY THIS ATTEMPT'S ORDER ID — every transaction it lists is
    // this attempt's. It used to keep only those whose retref equalled the stored processorRef, but for a phone tap that
    // stored ref is the PaymentSession id while retref is the CommerceHub transaction id: the real approved charge was
    // filtered out, read as not_found, the attempt released after 5 minutes and the customer could be charged again.
    // Now: any approval wins (whatever its amount — the captured amount is reported, never assumed); a decline needs an
    // explicit decline and no approval; transactions in no final state are NOT "nothing there" — the attempt waits.
    const approved = txns.find((t) => t.approved);
    if (approved) return { kind: 'approved', processorRef: approved.retref ?? input.processorRef ?? input.idempotencyKey, capturedAmountCents: approved.amountCents };
    const declined = txns.find((t) => t.declined);
    if (declined) return { kind: 'declined', processorRef: declined.retref, respText: declined.respText };
    if (txns.length) return { kind: 'unreachable', error: `the provider lists ${txns.length} transaction(s) for this payment in no final state` };
    return { kind: 'not_found' };
  }

  /** Tap to Pay per location (migration 704): the CommerceHub API key / secret / host are the platform's (env); the
   *  merchant id and terminal id are the LOCATION's, passed in by the service. Without a merchant (unit harnesses only)
   *  the env MID is used. VERIFY against the CommerceHub sandbox that one ISV key may act for each onboarded MID. */
  private buildClient(merchant?: TapToPayMerchantRef): CommerceHubClient | null {
    const chc = commerceHubConfigFromEnv({ ...process.env, ...(merchant ? { COMMERCEHUB_TTP_MERCHANT_ID: merchant.merchantId } : {}) });
    if (!chc) return null;
    const cfg = merchant ? { ...chc, merchantId: merchant.merchantId, terminalId: merchant.terminalId ?? chc.terminalId } : chc;
    return new CommerceHubClient(cfg, instrumentedFetch('fiserv', (globalThis as any).fetch));
  }
}
