import { SecurityEvents } from '@aipowersalon/security-center';
// deposit-reconciliation.webhook.controller.ts — PUBLIC bank webhook (no auth guard; authenticated by HMAC
// signature + token). Uses the EXACT raw request bytes (req.rawBody) that the sender signed.
import { Controller, Post, Param, Req, Res, Optional } from '@nestjs/common';
import { BankWebhookService } from './deposit-reconciliation.webhook.service';
import { recordWebhook } from '@aipowersalon/observability';

@Controller('webhooks/bank')
export class BankWebhookController {
  constructor(private readonly svc: BankWebhookService, @Optional() private readonly securityEvents?: SecurityEvents) {}

  @Post(':token')
  async ingest(@Param('token') token: string, @Req() req: any, @Res() res: any) {
    recordWebhook('bank', 'received');   // Constitution 4 §173–175 counters
    const raw = req?.rawBody ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody)) : (req?.body ? JSON.stringify(req.body) : '');
    const sig = req?.headers?.['x-signature'] || req?.headers?.['x-bank-signature'] || '';
    const result = await this.svc.ingest(token, raw, String(sig));
    // Constitution 12 §189/§292: bad signature or a replay (timestamp out of tolerance) on the bank channel.
    if (result.status === 401) void this.securityEvents?.record({ type: 'WEBHOOK_SIGNATURE_FAILED', severity: 'HIGH', actorType: 'provider', resourceType: 'bank_webhook', reason: String(result.reason ?? 'signature_invalid'), ip: req?.ip ?? null });
    if (result.status === 200) { recordWebhook('bank', 'verified'); recordWebhook('bank', result.idempotent ? 'duplicate' : 'processed'); }
    else if (result.status === 400) { recordWebhook('bank', 'verified'); recordWebhook('bank', 'rejected'); }   // signed, but not a usable payload
    else if (result.status === 401 || result.status === 403 || result.status === 404) recordWebhook('bank', 'rejected');
    res.status(result.status).json({ ok: result.status === 200, reason: result.reason, idempotent: result.idempotent ?? false });
  }
}
