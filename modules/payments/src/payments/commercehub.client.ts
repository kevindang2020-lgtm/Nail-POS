// commercehub.client.ts — Fiserv CommerceHub adapter behind the PaymentProcessor port.
//
// IMPLEMENTED FROM FISERV'S PUBLIC COMMERCEHUB DOCUMENTATION (developer.fiserv.com), NOT a sandbox run. The HMAC
// authentication is documented verbatim and is high-confidence; the endpoint paths and request/response field names
// below follow the published Charges/Refunds/Cancels API. Every VERIFY-tagged spot must be confirmed against your
// CommerceHub sandbox before production — field names, the exact source object for a Tap-to-Pay PaymentSession, and
// the refund/cancel schemas are the most likely to need a small adjustment. This client NEVER fabricates a success:
// a non-2xx response or a non-APPROVED status surfaces as declined / ProcessorError.
//
// Amounts: the port speaks integer cents; CommerceHub speaks decimal major units (e.g. 12.04). Conversion is here.
import { createHmac, randomUUID } from 'node:crypto';
import { PaymentProcessor, AuthorizeInput, AuthorizeResult, RefundInput, VoidInput, ProcessorActionResult, ProcessorError } from './payment-processor.port';
import type { FetchLike } from './cardpointe.client';

export interface CommerceHubConfig {
  baseUrl: string;      // e.g. https://cert.api.fiserv.com (sandbox) — VERIFY the exact host for your account
  apiKey: string;
  apiSecret: string;
  merchantId: string;
  terminalId?: string;
  currency: string;     // ISO 4217, e.g. 'USD'
}

const centsToDecimal = (cents: number): number => Number((cents / 100).toFixed(2));
const decimalToCents = (total: unknown): number | undefined => (typeof total === 'number' ? Math.round(total * 100) : undefined);

export class CommerceHubClient implements PaymentProcessor {
  readonly name = 'commercehub';
  private readonly base: string;

  constructor(private readonly cfg: CommerceHubConfig, private readonly fetchImpl: FetchLike) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
  }

  /** The documented HMAC header set: Authorization = base64(HMAC-SHA256(apiKey + clientRequestId + timestamp + body)). */
  private signedHeaders(body: string): Record<string, string> {
    const clientRequestId = randomUUID();
    const timestamp = String(Date.now());
    const raw = this.cfg.apiKey + clientRequestId + timestamp + body;
    const signature = createHmac('sha256', this.cfg.apiSecret).update(raw).digest('base64');
    return {
      'Content-Type': 'application/json',
      'Client-Request-Id': clientRequestId,
      'Api-Key': this.cfg.apiKey,
      'Timestamp': timestamp,
      'Auth-Token-Type': 'HMAC',
      'Authorization': signature,
    };
  }

  private async post(path: string, payload: unknown): Promise<any> {
    const body = JSON.stringify(payload);
    let res;
    try {
      res = await this.fetchImpl(this.base + path, { method: 'POST', headers: this.signedHeaders(body), body });
    } catch (e) {
      throw new ProcessorError(`CommerceHub request to ${path} failed: ${(e as Error).message}`);
    }
    const data = await res.json().catch(() => ({}));
    // 2xx = the request was processed (the transaction may still be DECLINED — handled by the caller). Non-2xx is a
    // transport/validation error and must NOT be treated as a payment outcome.
    if (!res.ok) {
      const msg = (data?.error?.[0]?.message || data?.details?.[0]?.message || `HTTP ${res.status}`);
      throw new ProcessorError(`CommerceHub ${path} returned ${res.status}: ${String(msg).slice(0, 200)}`, res.status);
    }
    return data;
  }

  private merchantDetails() {
    // VERIFY: CommerceHub expects merchantId; terminalId is required for card-present (Tap to Pay) merchants.
    return { merchantId: this.cfg.merchantId, ...(this.cfg.terminalId ? { terminalId: this.cfg.terminalId } : {}) };
  }

  /**
   * Authorize + capture in one call (captureFlag: true) via POST /payments/v1/charges. For Tap to Pay on iPhone the
   * card is captured on-device into a CommerceHub PaymentSession; `input.account` carries that sessionId.
   */
  async authorizeAndCapture(input: AuthorizeInput): Promise<AuthorizeResult> {
    const payload = {
      amount: { total: centsToDecimal(input.amountCents), currency: this.cfg.currency },
      // VERIFY: the PaymentSession source shape for the Tap-to-Pay flow (sourceType + the session field name).
      source: { sourceType: 'PaymentSession', session: input.account },
      transactionDetails: { captureFlag: true, merchantTransactionId: input.idempotencyKey || input.orderId },
      merchantDetails: this.merchantDetails(),
    };
    const data = await this.post('/payments/v1/charges', payload);
    const gr = data?.gatewayResponse ?? {};
    const prd = data?.paymentReceipt?.processorResponseDetails ?? {};
    const approved = (prd.approvalStatus ?? '').toUpperCase() === 'APPROVED'
      || ['AUTHORIZED', 'CAPTURED', 'SETTLED'].includes(String(gr.transactionState ?? '').toUpperCase());
    // mandate §232: an explicit DECLINED / FAILED status is a decline; anything else that is not approved is unknown
    const stateUp = String(gr.transactionState ?? '').toUpperCase(), apprUp = String(prd.approvalStatus ?? '').toUpperCase();
    const declined = !approved && (apprUp === 'DECLINED' || ['DECLINED', 'FAILED', 'CANCELLED', 'CANCELED', 'VOIDED'].includes(stateUp));
    return {
      approved,
      declined,
      outcome: approved ? 'approved' : declined ? 'declined' : 'unknown',
      retref: gr?.transactionProcessingDetails?.transactionId,
      authCode: prd.approvalCode,
      respstat: String(prd.responseCode ?? gr.transactionState ?? ''),
      respText: String(prd.responseMessage ?? gr.transactionState ?? ''),
      amountCents: decimalToCents(data?.paymentReceipt?.approvedAmount?.total),
    };
  }

  /** Refund a settled transaction via POST /payments/v1/refunds. Omitting amount requests a full refund. */
  async refund(input: RefundInput): Promise<ProcessorActionResult> {
    const payload = {
      ...(input.amountCents != null ? { amount: { total: centsToDecimal(input.amountCents), currency: this.cfg.currency } } : {}),
      referenceTransactionDetails: { referenceTransactionId: input.retref }, // VERIFY field name
      merchantDetails: this.merchantDetails(),
    };
    const data = await this.post('/payments/v1/refunds', payload);
    return this.actionResult(data);
  }

  /** Void an unsettled authorization via POST /payments/v1/cancels. */
  async voidTransaction(input: VoidInput): Promise<ProcessorActionResult> {
    const payload = {
      referenceTransactionDetails: { referenceTransactionId: input.retref }, // VERIFY field name
      merchantDetails: this.merchantDetails(),
    };
    const data = await this.post('/payments/v1/cancels', payload);
    return this.actionResult(data);
  }

  /**
   * Start a PaymentSession via POST /payments-vas/v1/security/credentials. The on-device Tap-to-Pay SDK initialises
   * with the returned sessionId/accessToken/publicKey, captures the tap, and the resulting sessionId is charged via
   * `authorizeAndCapture` (sourceType: PaymentSession). Response fields per Fiserv docs; VERIFY the exact `source`
   * required for the Tap-to-Pay SDK session against your sandbox.
   */
  async createSession(_input: { idempotencyKey?: string } = {}): Promise<{ sessionId: string; accessToken?: string; publicKey?: string; expiresInSeconds?: number }> {
    const payload = { merchantDetails: this.merchantDetails() }; // VERIFY: SDK-session `source`, if any, for card-present
    const data = await this.post('/payments-vas/v1/security/credentials', payload);
    const sessionId = data?.sessionId;
    if (!sessionId) throw new ProcessorError('CommerceHub credentials response did not include a sessionId');
    return { sessionId, accessToken: data?.accessToken, publicKey: data?.publicKey, expiresInSeconds: data?.accessTokenTimeToLive };
  }

  private actionResult(data: any): ProcessorActionResult {
    const gr = data?.gatewayResponse ?? {};
    const prd = data?.paymentReceipt?.processorResponseDetails ?? {};
    // Oct 28 2026 (Tap to Pay refunds in the POS): a refund / cancel is DONE only when CommerceHub says APPROVED, or — with
    // no approval status at all — the transaction is in a done state. A DECLINED state used to count as ok (the list
    // contained 'DECLINED'), so a declined refund would have been recorded as refunded. A decline is reported as one
    // (`declined`), so the checkout releases the reservation; anything else that is not ok stays UNKNOWN (never a retry).
    const approval = String(prd.approvalStatus ?? '').toUpperCase();
    const state = String(gr.transactionState ?? '').toUpperCase();
    const declined = approval === 'DECLINED' || state === 'DECLINED';
    const ok = !declined && (approval === 'APPROVED' || (!approval && ['AUTHORIZED', 'CAPTURED', 'SETTLED', 'VOIDED', 'CANCELLED'].includes(state)));
    return {
      ok, declined,
      retref: gr?.transactionProcessingDetails?.transactionId,
      respstat: String(prd.responseCode ?? gr.transactionState ?? ''),
      respText: String(prd.responseMessage ?? gr.transactionState ?? ''),
    };
  }
}

/** Build from env, or null when unconfigured. Reuses the COMMERCEHUB_TTP_* vars used elsewhere. */
export function commerceHubConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CommerceHubConfig | null {
  const apiKey = env.COMMERCEHUB_TTP_API_KEY;
  const apiSecret = env.COMMERCEHUB_TTP_API_SECRET;
  const merchantId = env.COMMERCEHUB_TTP_MERCHANT_ID;
  const baseUrl = env.COMMERCEHUB_BASE_URL; // VERIFY: your CommerceHub host (sandbox vs prod)
  if (!apiKey || !apiSecret || !merchantId || !baseUrl) return null;
  return { baseUrl, apiKey, apiSecret, merchantId, terminalId: env.COMMERCEHUB_TTP_TERMINAL_PROFILE_ID, currency: env.COMMERCEHUB_TTP_CURRENCY || 'USD' };
}
