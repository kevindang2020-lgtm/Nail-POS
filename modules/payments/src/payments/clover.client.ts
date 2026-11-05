// clover.client.ts — Clover adapter implementing PaymentProcessor (Payment Gateway Isolation §11 named set), using the
// Clover Ecommerce API. Fourth concrete processor behind the gateway abstraction.
//   POST {base}/v1/charges   authorize+capture (capture:true)
//   POST {base}/v1/refunds   refund by charge id (FULL refund when amount is omitted)
// Auth is Bearer (the tenant's Clover ecommerce private access token). Bodies are JSON; amounts are integer cents — same
// cents we use, no conversion. NOTE: the Clover Ecommerce API has no distinct "void" for an already-captured charge, so
// voidTransaction maps to a FULL refund (documented). Transport is injected for unit tests; live verification needs a
// Clover account (same external-sandbox class of blocker as Fiserv) — the per-tenant SELECTION + request mapping proven here.

import { PaymentProcessor, AuthorizeInput, AuthorizeResult, RefundInput, VoidInput, ProcessorActionResult, ProcessorError } from './payment-processor.port';
import type { FetchLike, FetchResponseLike } from './cardpointe.client';

export interface CloverConfig {
  /** Clover Ecommerce base, e.g. "https://scl.clover.com" (prod) or "https://scl-sandbox.dev.clover.com" (sandbox). */
  baseUrl: string;
  /** Clover ecommerce private access token. Never leaves the backend. */
  apiAccessToken: string;
  currency?: string;
}

export class CloverPaymentAdapter implements PaymentProcessor {
  readonly name = 'clover';
  private readonly base: string;
  private readonly currency: string;

  constructor(private readonly cfg: CloverConfig, private readonly fetchImpl: FetchLike) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
    this.currency = (cfg.currency || 'usd').toLowerCase();
  }

  private async post(path: string, body: unknown, idempotencyKey?: string): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: 'application/json',
      Authorization: 'Bearer ' + this.cfg.apiAccessToken,
    };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(this.base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new ProcessorError(`Clover request to ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ProcessorError(`Clover ${path} returned HTTP ${res.status}${t ? ': ' + t.slice(0, 200) : ''}`, res.status);
    }
    return res.json();
  }

  async authorizeAndCapture(input: AuthorizeInput): Promise<AuthorizeResult> {
    const r = await this.post('/v1/charges', {
      amount: input.amountCents, currency: this.currency, source: input.account,
      capture: true, external_reference_id: input.orderId,
    }, input.idempotencyKey);
    const status = String(r?.status || '').toLowerCase();
    const approved = r?.paid === true || status === 'succeeded' || status === 'paid';
    const isDefinitiveDecline = status === 'failed' || status === 'canceled' || status === 'declined';
    const respstat = approved ? 'A' : (isDefinitiveDecline ? 'C' : 'B');
    const declined = respstat === 'C';
    return {
      approved, declined,
      retref: r?.id, authCode: r?.id,
      respstat, respText: status || (approved ? 'paid' : (respstat === 'B' ? 'provider_unavailable' : 'declined')),
      amountCents: typeof r?.amount === 'number' ? r.amount : input.amountCents,
    };
  }

  async refund(input: RefundInput): Promise<ProcessorActionResult> {
    const body: Record<string, unknown> = { charge: input.retref };
    if (typeof input.amountCents === 'number') body.amount = input.amountCents;
    const r = await this.post('/v1/refunds', body);
    const ok = !!r?.id && r?.status !== 'failed';
    const isDefinitiveFail = r?.status === 'failed' || r?.status === 'declined';
    const respstat = ok ? 'A' : (isDefinitiveFail ? 'C' : 'B');
    return { ok, retref: r?.id, respstat, respText: String(r?.status || (ok ? 'succeeded' : (respstat === 'B' ? 'provider_unavailable' : 'failed'))) };
  }

  // Clover Ecommerce has no separate void for a captured charge → full refund (documented mapping).
  async voidTransaction(input: VoidInput): Promise<ProcessorActionResult> {
    const r = await this.post('/v1/refunds', { charge: input.retref });
    const ok = !!r?.id && r?.status !== 'failed';
    const isDefinitiveFail = r?.status === 'failed' || r?.status === 'declined';
    const respstat = ok ? 'A' : (isDefinitiveFail ? 'C' : 'B');
    return { ok, retref: r?.id, respstat, respText: String(r?.status || (ok ? 'voided' : (respstat === 'B' ? 'provider_unavailable' : 'failed'))) };
  }
}
