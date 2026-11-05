// hardware-payment.charge-adapter.ts — binds the shortfall auto-charge to the real payment processor.
// Production: the configured CardPointe (Fiserv) client via processorFromEnv(). Dev/test: a sandbox processor when
// PAYMENTS_SANDBOX=1. Neither path ever sees a raw card — only the tenant's saved gateway token.
import { type PaymentProcessor, type AuthorizeInput, type AuthorizeResult } from '../payments/payment-processor.port';
import { processorFromEnv } from '../payments/processor.factory';
import type { HardwareChargePort, ChargeInput, ChargeResult } from './hardware-payment.dto';

/** A no-network processor for dev/sandbox. Approves unless the token signals a decline ("decline"/"fail"). */
export class SandboxPaymentProcessor implements PaymentProcessor {
  readonly name = 'sandbox';
  async authorizeAndCapture(input: AuthorizeInput): Promise<AuthorizeResult> {
    const decline = /decline|fail/i.test(input.account || '');
    return decline
      ? { approved: false, declined: true, respstat: 'C', respText: 'Declined (sandbox)', amountCents: input.amountCents }
      : { approved: true, declined: false, retref: 'SBX-' + Math.random().toString(36).slice(2, 10).toUpperCase(), authCode: 'SBXOK', respstat: 'A', respText: 'Approved (sandbox)', amountCents: input.amountCents };
  }
  async refund() { return { ok: true, respstat: 'A', respText: 'Refunded (sandbox)' }; }
  async voidTransaction() { return { ok: true, respstat: 'A', respText: 'Voided (sandbox)' }; }
}

/** Picks the live processor when CardPointe is configured, else the sandbox when PAYMENTS_SANDBOX=1, else none. */
export function resolveHardwareProcessor(): PaymentProcessor | undefined {
  const live = processorFromEnv();
  if (live) return live;
  if (process.env.PAYMENTS_SANDBOX === '1' || process.env.PAYMENTS_SANDBOX === 'true') return new SandboxPaymentProcessor();
  return undefined;
}

export class HardwareChargeAdapter implements HardwareChargePort {
  constructor(private readonly processor: PaymentProcessor | undefined = resolveHardwareProcessor()) {}
  async charge(input: ChargeInput): Promise<ChargeResult> {
    if (!this.processor) return { ok: false, respstat: 'C', respText: 'No payment processor configured' };
    try {
      const r = await this.processor.authorizeAndCapture({ account: input.token, amountCents: input.amountCents, orderId: input.invoiceId, idempotencyKey: input.invoiceId });
      return { ok: r.approved || r.respstat === 'A', retref: r.retref, respstat: r.respstat, respText: r.respText };
    } catch (e: any) {
      return { ok: false, respstat: 'C', respText: `Processor error: ${e?.message ?? 'unknown'}` };
    }
  }
}
