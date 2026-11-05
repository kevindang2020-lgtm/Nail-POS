// cardpointe.client.ts — Fiserv / CardConnect (CardPointe) Gateway REST client.
//
// Implements PaymentProcessor against the CardPointe Gateway REST API:
//   PUT  {base}/cardconnect/rest/auth     authorize (capture:'Y' => sale)
//   PUT  {base}/cardconnect/rest/refund   refund by retref
//   PUT  {base}/cardconnect/rest/void     void by retref
// Auth is HTTP Basic. Amounts are sent as decimal strings in the major unit (e.g. "12.50"), per the classic API.
// respstat: "A" approved, "B" retry, "C" declined.
//
// The HTTP transport is injected (FetchLike) so the request-building and response-parsing are fully unit-testable, and so
// an end-to-end run can target a local CardPointe-shaped server. In production the factory injects global fetch.

import { PaymentProcessor, AuthorizeInput, AuthorizeResult, RefundInput, VoidInput, ProcessorActionResult, ProcessorError, ConnectionTestResult, InquiryResult } from './payment-processor.port';

export interface FetchResponseLike { status: number; ok: boolean; json(): Promise<any>; text(): Promise<string>; headers?: { get(name: string): string | null }; }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<FetchResponseLike>;

export interface CardPointeConfig {
  /** e.g. "https://<site>.cardconnect.com" (no trailing slash, no /cardconnect/rest suffix). */
  baseUrl: string;
  merchid: string;
  username: string;
  password: string;
  currency?: string;
}

function toDollars(cents: number): string { return (cents / 100).toFixed(2); }

export class CardPointeClient implements PaymentProcessor {
  readonly name = 'cardpointe';
  private readonly authHeader: string;
  private readonly base: string;

  constructor(private readonly cfg: CardPointeConfig, private readonly fetchImpl: FetchLike) {
    // Fiserv hands out the base as "https://<site>.cardconnect.com/cardconnect/rest" — the same value pasted into the
    // gateway settings must work, so the suffix is stripped here and re-added per endpoint (never doubled).
    this.base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/cardconnect\/rest$/i, '');
    this.authHeader = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  }

  private async put(path: string, payload: Record<string, unknown>): Promise<any> { return this.call('PUT', path, payload); }
  private async call(method: 'PUT' | 'GET', path: string, payload?: Record<string, unknown>): Promise<any> {
    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: this.authHeader },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch (e) {
      throw new ProcessorError(`CardPointe request to ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProcessorError(`CardPointe ${path} returned HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`, res.status);
    }
    return res.json();
  }

  async authorizeAndCapture(input: AuthorizeInput): Promise<AuthorizeResult> {
    const r = await this.put('/cardconnect/rest/auth', {
      merchid: this.cfg.merchid,
      account: input.account,
      ...(input.expiry ? { expiry: input.expiry } : {}),
      amount: toDollars(input.amountCents),
      currency: this.cfg.currency || 'USD',
      capture: 'Y',
      ...(input.cvv ? { cvv2: input.cvv } : {}),
      ...(input.orderId ? { orderid: input.orderId } : {}),
      // card-not-present unless the caller says otherwise (Fiserv: CNP without ecomind 'E' is processed as card present)
      ecomind: input.ecomind ?? 'E',
      ...(input.name ? { name: input.name.slice(0, 30) } : {}),
      ...(input.address ? { address: input.address.slice(0, 30) } : {}),
      ...(input.postal ? { postal: input.postal.slice(0, 9) } : {}),
      // Stored Credential Transaction Framework — only what the caller states; nothing is inferred here
      ...(input.cof ? { cof: input.cof } : {}),
      ...(input.cofscheduled ? { cofscheduled: input.cofscheduled } : {}),
      ...(input.cofpermission ? { cofpermission: input.cofpermission } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
    });
    const respstat = String(r.respstat ?? '');
    const amountCents = r.amount != null && r.amount !== '' ? Math.round(parseFloat(String(r.amount)) * 100) : undefined;
    return {
      approved: respstat === 'A',
      declined: respstat === 'C',
      retref: r.retref != null ? String(r.retref) : undefined,
      authCode: r.authcode != null ? String(r.authcode) : undefined,
      respstat,
      respText: String(r.resptext ?? ''),
      amountCents,
      ...(r.profileid ? { profileId: String(r.profileid) } : {}),
      ...(r.avsresp ? { avsResp: String(r.avsresp) } : {}),
      ...(r.cvvresp ? { cvvResp: String(r.cvvresp) } : {}),
    };
  }

  /** GET /cardconnect/rest/inquireMerchant/{merchid}: proves the credentials, the base URL and the MID together, and
   *  reports what the merchant account supports — charges nothing. */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const r = await this.call('GET', `/cardconnect/rest/inquireMerchant/${encodeURIComponent(this.cfg.merchid)}`);
      const enabled = r?.enabled === true || String(r?.enabled).toLowerCase() === 'true';
      return { ok: enabled, merchantEnabled: enabled, cardProcessor: r?.cardproc ? String(r.cardproc) : undefined,
        avsSupported: String(r?.avs ?? '').toUpperCase() === 'Y', cvvSupported: String(r?.cvv ?? '').toUpperCase() === 'Y',
        message: enabled ? `Merchant ${String(r?.merchid ?? this.cfg.merchid)} reachable and enabled on ${String(r?.site ?? '')}${r?.cardproc ? ' (' + r.cardproc + ')' : ''}` : `Merchant reachable but not enabled` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Functional Decision 22 — GET {base}/cardconnect/rest/inquireByOrderid/{orderid}/{merchid}/1 (set=1: every
   *  transaction with that order id, as an array). A "not found" answer is a successful inquiry with no transactions;
   *  network / HTTP failures throw (the outcome is then still unknown). Response shape to confirm against the
   *  CardPointe sandbox before go-live — the parsing below accepts the documented array and a single-object form. */
  async inquireByOrderId(orderId: string): Promise<InquiryResult> {
    const r = await this.call('GET', `/cardconnect/rest/inquireByOrderid/${encodeURIComponent(orderId)}/${encodeURIComponent(this.cfg.merchid)}/1`);
    const rows: any[] = Array.isArray(r) ? r : (r && typeof r === 'object' && (r.retref || r.respstat) ? [r] : []);
    return {
      transactions: rows
        .filter((x) => !/not found/i.test(String(x?.resptext ?? '')))
        .map((x) => ({
          retref: x.retref != null ? String(x.retref) : undefined,
          approved: String(x.respstat ?? '') === 'A',
          declined: String(x.respstat ?? '') === 'C',
          amountCents: x.amount != null && x.amount !== '' ? Math.round(parseFloat(String(x.amount)) * 100) : undefined,
          authCode: x.authcode != null ? String(x.authcode) : undefined,
          respText: String(x.resptext ?? ''),
        })),
    };
  }

  async refund(input: RefundInput): Promise<ProcessorActionResult> {
    const r = await this.put('/cardconnect/rest/refund', {
      merchid: this.cfg.merchid,
      retref: input.retref,
      ...(input.amountCents != null ? { amount: toDollars(input.amountCents) } : {}),
    });
    const respstat = String(r.respstat ?? '');
    return { ok: respstat === 'A', retref: r.retref != null ? String(r.retref) : undefined, respstat, respText: String(r.resptext ?? '') };
  }

  async voidTransaction(input: VoidInput): Promise<ProcessorActionResult> {
    const r = await this.put('/cardconnect/rest/void', { merchid: this.cfg.merchid, retref: input.retref });
    const respstat = String(r.respstat ?? '');
    return { ok: respstat === 'A', retref: r.retref != null ? String(r.retref) : undefined, respstat, respText: String(r.resptext ?? '') };
  }
}
