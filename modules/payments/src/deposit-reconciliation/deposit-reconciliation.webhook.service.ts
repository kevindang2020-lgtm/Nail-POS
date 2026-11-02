// deposit-reconciliation.webhook.service.ts — inbound bank-deposit webhook. Order: resolve endpoint by TOKEN
// (tenant is a verified credential, never the payload) -> verify HMAC signature over the raw body (stripe-style
// header, which also enforces timestamp freshness = replay protection) -> parse -> create deposit idempotently.
// Returns a status + reason; never throws tenant data across boundaries.
import { verifyWebhookSignature } from '@aipowersalon/ai';
import { parseBankPayload } from './deposit-reconciliation.webhook';
import type { WebhookRepositoryPort } from './deposit-reconciliation.webhook.repository';

export interface WebhookResult { status: number; reason: string; depositId?: string | null; idempotent?: boolean }

export class BankWebhookService {
  constructor(private readonly repo: WebhookRepositoryPort, private readonly toleranceSec = 300) {}

  async ingest(token: string, rawBody: string, signatureHeader: string): Promise<WebhookResult> {
    const endpoint = await this.repo.resolveEndpoint(token);
    if (!endpoint) return { status: 404, reason: 'unknown_endpoint' };
    if (endpoint.status !== 'active') return { status: 403, reason: 'endpoint_disabled' };

    // Signature + replay: stripe-style header carries the timestamp; out-of-tolerance is a replay reject.
    const verified = verifyWebhookSignature({ payload: rawBody, header: signatureHeader, secret: endpoint.signingSecret, scheme: 'stripe', toleranceSec: this.toleranceSec });
    if (!verified.ok) {
      const replay = verified.reason === 'timestamp_out_of_tolerance';
      return { status: 401, reason: replay ? 'replay_rejected' : verified.reason };
    }

    let body: any; try { body = JSON.parse(rawBody); } catch { return { status: 400, reason: 'invalid_json' }; }
    const parsed = parseBankPayload(body);
    if (!parsed.ok) return { status: 400, reason: parsed.error || 'invalid_payload' };

    const { id, idempotent } = await this.repo.createDepositIdempotent(endpoint.tenantId, endpoint.bankAccountId, parsed.value!);
    return { status: 200, reason: idempotent ? 'already_processed' : 'accepted', depositId: id, idempotent };
  }
}
