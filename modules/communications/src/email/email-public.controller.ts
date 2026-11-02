// email-public.controller.ts — the two PUBLIC email endpoints (no session; Email guide §05 / §12, Oct 31 2026):
//   POST /webhooks/email/sendgrid   the provider's SIGNED event batch → email-events.ts. Unsigned, stale or unverifiable
//                                   batches are refused and change nothing; with no verification key configured the
//                                   endpoint answers 503 — delivery is never inferred from an unsigned request.
//   GET  /public/email/unsubscribe  a minimal confirmation page; POST (RFC 8058 one-click) records a MARKETING-only
//                                   unsubscribe for that salon + address. The HMAC token names both; a bad token changes
//                                   nothing and the answer never reveals whether the address exists.
import { Body, Controller, Get, Headers, Inject, Optional, Post, Query, Req, Res } from '@nestjs/common';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { recordWebhook } from '@aipowersalon/observability';
import { EMAIL_EVENTS_BODY, EMPTY_BODY } from '../request-schemas';
import { verifySendgridSignature, freshTimestamp, applyEmailEvents, applyUnsubscribe } from './email-events';
import { verifyUnsubscribe, unsubscribeSecret } from './email-policy';

const page = (title: string, text: string, form = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#FBF8F3;margin:0;padding:40px 16px;color:#2B2A28"><div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E7DCC9;border-radius:14px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1><p style="line-height:1.5">${text}</p>${form}</div></body></html>`;

@Controller()
export class EmailPublicController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}

  @Post('webhooks/email/sendgrid')
  async events(@Req() req: any, @Res() res: any, @Body(ValidatedBody(EMAIL_EVENTS_BODY)) body: any,
    @Headers('x-twilio-email-event-webhook-signature') sig?: string, @Headers('x-twilio-email-event-webhook-timestamp') ts?: string) {
    const key = String(process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY ?? '').trim();
    if (!key || !this.db) { recordWebhook('sendgrid', 'rejected'); return res.status(503).json({ code: 'EMAIL_EVENTS_NOT_CONFIGURED', message: 'Signed email events are not configured.' }); }
    const raw: Buffer | undefined = req?.rawBody;
    if (!raw || !sig || !ts || !freshTimestamp(ts) || !verifySendgridSignature(key, sig, ts, raw)) { recordWebhook('sendgrid', 'rejected'); return res.status(403).json({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature check failed.' }); }
    recordWebhook('sendgrid', 'verified');
    const events = Array.isArray(body) ? body : [];
    const r = await applyEmailEvents(this.db, events);
    recordWebhook('sendgrid', 'processed');
    return res.status(200).json(r);
  }

  @Get('public/email/unsubscribe')
  async unsubscribePage(@Query('token') token: string, @Res() res: any) {
    const secret = unsubscribeSecret();
    const ok = secret ? !!verifyUnsubscribe(String(token ?? ''), secret) : false;
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (!ok) return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid. Please use the link from a recent email.'));
    const t = String(token).replace(/[^A-Za-z0-9._-]/g, '');
    return res.status(200).send(page('Unsubscribe from marketing emails', 'You will stop receiving marketing emails from this salon. Booking confirmations and receipts will still arrive.',
      `<form method="post" action="?token=${t}"><button type="submit" style="background:#B8933D;color:#fff;border:0;border-radius:9px;padding:12px 20px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`));
  }

  @Post('public/email/unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: any, @Body(ValidatedBody(EMPTY_BODY)) _b: any) {
    const secret = unsubscribeSecret(); const v = secret ? verifyUnsubscribe(String(token ?? ''), secret) : null;
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (!v || !this.db) return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid. Please use the link from a recent email.'));
    await applyUnsubscribe(this.db, v.tenantId, v.address);
    return res.status(200).send(page('You are unsubscribed', 'You will no longer receive marketing emails from this salon. Booking confirmations and receipts will still arrive.'));
  }
}
