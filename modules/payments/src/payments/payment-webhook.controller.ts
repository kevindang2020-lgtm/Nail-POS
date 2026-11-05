import { SecurityEvents } from '@aipowersalon/security-center';
// payment-webhook.controller.ts — `POST /webhooks/payments/:processor` (also /fiserv).
// UNAUTHENTICATED by design — the processor calls it with no session. It is excluded from TenantContextMiddleware in
// app.module; the tenant is resolved from the payload's merchant id and the signature is verified inside the service.
import { Controller, Post, Param, Body, Req, Res, Optional } from '@nestjs/common';
import { PaymentWebhookService } from '../payments/payment-webhook.service';
import { recordWebhook, recordWebhookLatency, webhookProvider } from '@aipowersalon/observability';

@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly svc: PaymentWebhookService, @Optional() private readonly securityEvents?: SecurityEvents) {}

  @Post(':processor')
  async handle(@Param('processor') processor: string, @Body() body: any, @Req() req: any, @Res() res: any) {
    // Prefer the EXACT raw request bytes the processor signed (NestFactory({ rawBody: true }) populates req.rawBody).
    // PAYMENTS_WEBHOOK_RAW_BODY=1 makes raw-body capture MANDATORY (reject if absent) so signatures are never silently
    // verified over a re-serialized copy of the parsed JSON. Default (off) falls back to re-serialized JSON for dev/test parity.
    const provider = webhookProvider('payments', processor);   // Constitution 4 §173–175 counters
    recordWebhook(provider, 'received');
    const startedAt = Date.now();   // wave 3 PAYI §158: latency per provider
    const rawBuf = req?.rawBody;
    const haveRaw = Buffer.isBuffer(rawBuf) || typeof rawBuf === 'string';
    const strict = process.env.PAYMENTS_WEBHOOK_RAW_BODY === '1';
    if (strict && !haveRaw) { recordWebhook(provider, 'rejected'); res.status(400).json({ ok: false, code: 'raw_body_required' }); return; }
    const raw = haveRaw ? (Buffer.isBuffer(rawBuf) ? rawBuf.toString('utf8') : String(rawBuf)) : JSON.stringify(body ?? {});
    const sig = req?.headers?.['x-webhook-signature'] || req?.headers?.['x-cardpointe-signature'] || req?.headers?.['x-signature'] || '';
    // The full header map lets the service read the signature header (generic HMAC-SHA256 hex for Fiserv/CardPointe/Clover).
    const out = await this.svc.handle(String(processor), raw, body ?? {}, String(sig), req?.headers);
    // Constitution 12 §189/§292: a forged or corrupted callback is a security event, not just a 401.
    if (out.status === 401) void this.securityEvents?.record({ type: 'WEBHOOK_SIGNATURE_FAILED', actorType: 'provider', resourceType: 'payment_webhook', resourceId: String(processor).slice(0, 40), reason: String((out.body as any)?.reason ?? 'invalid_signature'), ip: req?.ip ?? null });
    if (out.status === 401 || out.status === 400) recordWebhook(provider, 'rejected');
    else if (out.status === 200) { recordWebhook(provider, 'verified'); recordWebhook(provider, (out.body as any)?.duplicate ? 'duplicate' : 'processed'); }
    else if (out.status === 500 && (out.body as any)?.code === 'processing_failed') { recordWebhook(provider, 'verified'); recordWebhook(provider, 'failed'); }   // §45/§158: verified, recorded, processing threw — the processor retries
    recordWebhookLatency(provider, Date.now() - startedAt);
    res.status(out.status).json(out.body);
  }
}
