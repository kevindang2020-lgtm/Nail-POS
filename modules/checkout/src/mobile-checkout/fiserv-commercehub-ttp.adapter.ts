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
  type DeviceSession, type FinalizeInput, type FinalizeResult, type MintSessionInput, type TapToPaySessionPort, type TapToPayLookup,
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
    const client = this.client === undefined ? this.buildClient() : this.client;
    if (!client) throw new TapToPayNotImplementedError();
    // Start a CommerceHub PaymentSession (Security Credentials API). No card data on the backend — the card is captured
    // on-device by the SDK, which initialises with these credentials.
    const s = await client.createSession({ idempotencyKey: input.idempotencyKey });
    const ttlMs = (s.expiresInSeconds ?? 30 * 60) * 1000;
    return { provider: 'fiserv_commercehub', sessionToken: s.sessionId, accessToken: s.accessToken, publicKey: s.publicKey, expiresAt: new Date(Date.now() + ttlMs).toISOString(), environment: this.cfg.environment };
  }

  async finalizeTransaction(input: FinalizeInput): Promise<FinalizeResult> {
    if (!this.cfg) throw new TapToPayNotConfiguredError();
    const client = this.client === undefined ? this.buildClient() : this.client;
    // Fiserv master build §8C (P0, Nov 4 2026): no client ⇒ nothing can be verified. The former branch that returned
    // verified:true for a client-supplied `sbx_tap_*` reference is removed — a reference string from the device is
    // never proof of payment. Test doubles belong in test DI, not here.
    if (!client) throw new TapToPayNotImplementedError();
    // Charge the captured PaymentSession server-side (input.processorRef carries the sessionId the device SDK returned).
    const res = await client.authorizeAndCapture({ account: input.processorRef, amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
    // Verified only when the PROVIDER approved AND confirmed the exact amount; an approval without a matching amount is
    // not paid (it stays for provider inquiry / manual review).
    const amountMatches = res.amountCents === input.amountCents;
    return {
      verified: res.approved && amountMatches,
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
  async lookupTransaction(input: { tenantId: string; idempotencyKey: string; processorRef?: string | null; amountCents: number }): Promise<TapToPayLookup> {
    if (!this.cfg) throw new TapToPayNotConfiguredError();
    const client = this.client === undefined ? this.buildClient() : this.client;
    if (!client) throw new TapToPayNotImplementedError();
    const inquire = (client as any).inquireByOrderId as undefined | ((orderId: string) => Promise<{ transactions: { retref?: string; approved: boolean; declined: boolean; amountCents?: number; authCode?: string; respText?: string }[] }>);
    if (typeof inquire !== 'function') return { kind: 'no_inquiry' };
    let txns: { retref?: string; approved: boolean; declined: boolean; amountCents?: number; respText?: string }[];
    try { txns = (await inquire.call(client, input.idempotencyKey)).transactions; }
    catch (e: any) { return { kind: 'unreachable', error: String(e?.message ?? e).slice(0, 200) }; }
    const mine = txns.filter((t) => (t.amountCents == null || t.amountCents === input.amountCents) && (!input.processorRef || !t.retref || t.retref === input.processorRef));
    const approved = mine.find((t) => t.approved);
    if (approved?.retref) return { kind: 'approved', processorRef: approved.retref, capturedAmountCents: approved.amountCents };
    const declined = mine.find((t) => t.declined);
    if (declined) return { kind: 'declined', processorRef: declined.retref, respText: declined.respText };
    return { kind: 'not_found' };
  }

  private buildClient(): CommerceHubClient | null {
    const chc = commerceHubConfigFromEnv();
    if (!chc) return null;
    return new CommerceHubClient(chc, instrumentedFetch('fiserv', (globalThis as any).fetch));
  }
}
