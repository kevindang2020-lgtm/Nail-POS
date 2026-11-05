import { SecurityEvents } from '@aipowersalon/security-center';
// twilio-inbound.controller.ts — the public webhook Twilio calls for inbound SMS. No auth guard (Twilio is the caller);
// every request is signature-verified inside the service. Returns empty TwiML so Twilio doesn't auto-reply.
import { Controller, Post, Req, Res, Body, Headers, Optional } from '@nestjs/common';
import { TwilioInboundService } from './twilio-inbound.service';
import { recordWebhook } from '@aipowersalon/observability';
import { TWILIO_INBOUND_BODY, TWILIO_STATUS_BODY } from '../request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

/** Constitution 4 §173–175: count one Twilio delivery by what the service made of it. */
function countTwilio(r: any): void {
  recordWebhook('twilio', 'received');
  if (r?.reason === 'bad_signature' || r?.reason === 'no_signature_config') { recordWebhook('twilio', 'rejected'); return; }
  recordWebhook('twilio', 'verified'); recordWebhook('twilio', 'processed');
}

@Controller('webhooks/twilio')
export class TwilioInboundController {
  constructor(private readonly svc: TwilioInboundService, @Optional() private readonly securityEvents?: SecurityEvents) {}

  @Post('sms/inbound')
  async inbound(@Req() req: any, @Res() res: any, @Body(ValidatedBody(TWILIO_INBOUND_BODY)) body: any, @Headers('x-twilio-signature') signature?: string) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body || {})) params[k] = String(v ?? '');
    // Reconstruct the exact URL Twilio signed (proxy-aware), needed for signature verification.
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const url = `${proto}://${host}${req.originalUrl || req.url || ''}`;
    const r = await this.svc.handleInbound({ from: params.From || '', to: params.To || '', body: params.Body || '', signature, url, params });
    countTwilio(r);
    if ((r as any)?.reason === 'bad_signature') void this.securityEvents?.record({ type: 'WEBHOOK_SIGNATURE_FAILED', actorType: 'provider', resourceType: 'twilio_inbound', reason: 'bad_signature', ip: req?.ip ?? null });
    res.set?.('Content-Type', 'text/xml');
    return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  @Post('sms/status')
  async status(@Req() req: any, @Res() res: any, @Body(ValidatedBody(TWILIO_STATUS_BODY)) body: any, @Headers('x-twilio-signature') signature?: string) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body || {})) params[k] = String(v ?? '');
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const url = `${proto}://${host}${req.originalUrl || req.url || ''}`;
    const r = await this.svc.handleStatus({ sid: params.MessageSid || params.SmsSid || '', status: params.MessageStatus || params.SmsStatus || '', signature, url, params });
    countTwilio(r);
    if ((r as any)?.reason === 'bad_signature') void this.securityEvents?.record({ type: 'WEBHOOK_SIGNATURE_FAILED', actorType: 'provider', resourceType: 'twilio_status', reason: 'bad_signature', ip: req?.ip ?? null });
    res.set?.('Content-Type', 'text/xml');
    return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}
