// ttp-refund-processor.ts — Tap to Pay refunds and voids in the POS (Kevin's decision, Oct 28 2026).
//
// A Tap to Pay card payment was captured on the Fiserv CommerceHub rail, through THIS location's own CommerceHub merchant
// (migration 704). Its refund / void must go back to that same rail and merchant — never to the location's card gateway
// (CardPointe / Clover), which does not know the CommerceHub transaction id. This builds the CommerceHub client for the
// caller's tenant + location; the checkout's refund / void then run their usual claim-first, three-outcome logic on it
// (approved → recorded; explicit decline → released; anything else → UNKNOWN, held, verified by a person — never retried).
//
// null = no Tap to Pay refund rail here (no CommerceHub credentials, or no Tap to Pay merchant for this location): the
// checkout then refuses with TAP_TO_PAY_REFUND_AT_PROCESSOR, exactly as before. VERIFY (BLOCKED_EXTERNAL): the refund /
// cancel request field names against the CommerceHub sandbox (commercehub.client.ts VERIFY markers).
import { instrumentedFetch } from '@aipowersalon/observability';
import { CommerceHubClient, commerceHubConfigFromEnv, type PaymentGatewayResolver } from '@aipowersalon/payments';
import type { PaymentProcessor } from '@aipowersalon/payments';

export interface TapToPayRefundPort {
  /** The processor that refunds / voids a Tap to Pay payment taken at this tenant + location, or null when none. */
  processorFor(ctx: { tenantId: string; branchId?: string | null }): Promise<PaymentProcessor | null>;
}

type FetchFn = Parameters<typeof instrumentedFetch>[1];

export class CommerceHubTapToPayRefunds implements TapToPayRefundPort {
  constructor(
    private readonly gateways: Pick<PaymentGatewayResolver, 'resolveTapToPayMerchant'>,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: FetchFn = ((u: string, i: unknown) => (globalThis.fetch as unknown as (a: string, b: unknown) => Promise<unknown>)(u, i)) as unknown as FetchFn,
  ) {}

  async processorFor(ctx: { tenantId: string; branchId?: string | null }): Promise<PaymentProcessor | null> {
    const merchant = await this.gateways.resolveTapToPayMerchant(ctx.tenantId, ctx.branchId ?? null, this.env);
    if (!merchant) return null;
    const base = commerceHubConfigFromEnv({ ...this.env, COMMERCEHUB_TTP_MERCHANT_ID: merchant.merchantId });
    if (!base) return null;
    return new CommerceHubClient({ ...base, merchantId: merchant.merchantId, terminalId: merchant.terminalId ?? base.terminalId }, instrumentedFetch('fiserv', this.fetchImpl));
  }
}
