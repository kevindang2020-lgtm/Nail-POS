// integration-webhook.controller.ts — inbound (public, signature-authenticated) receive endpoint + SuperAdmin
// review/retry/drain. The inbound route is intentionally NOT behind SuperAdminGuard: providers can't hold an admin
// session, so the provider signature IS the authentication (verified in the ingest service). For exact-byte HMAC in
// production the app must expose the raw request body (raw-body middleware); we use req.rawBody when present.

import { Body, Controller, Get, Headers, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { WebhookIngestService } from './webhook-ingest.service';
import { INT_LIMIT_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)
import { S } from '@aipowersalon/permissions';
/** Security Deep Scan §40: the shape of an inbound provider event; the x-signature over the raw bytes stays the authentication. */
const INTEGRATION_INBOUND_BODY = S.webhookEnvelope();

const actorFrom = (r: any) => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });
const REJECT: Record<string, [number, string]> = {
  unavailable: [503, 'Webhook ingest is not available.'], not_found: [404, 'Connection not found.'],
  connection_disabled: [403, 'Connection disabled — event quarantined.'], not_configured: [400, 'No webhook secret configured.'],
  not_supported: [400, 'Provider does not support inbound webhooks.'], signature_invalid: [401, 'Invalid signature.'],
  replay_blocked: [409, 'Replay/stale timestamp rejected.'], bad_payload: [400, 'Invalid payload.'],
};

@Controller('integrations/inbound')
export class IntegrationWebhookInboundController {
  constructor(private readonly svc: WebhookIngestService) {}

  @Post(':connectionId')
  async receive(@Param('connectionId') connectionId: string, @Req() req: any, @Body(ValidatedBody(INTEGRATION_INBOUND_BODY)) body: any, @Headers('x-signature') sig?: string) {
    const rawBody: string = typeof req?.rawBody === 'string' ? req.rawBody : (Buffer.isBuffer(req?.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {}));
    const res = await this.svc.processInbound({ connectionId, rawBody, signatureHeader: sig ?? req?.headers?.['x-signature'] });
    if (!res.ok && REJECT[res.code]) { const [s, m] = REJECT[res.code]; throw new HttpException({ code: res.code, message: m }, s); }
    return res;
  }
}

@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class IntegrationWebhookAdminController {
  constructor(private readonly svc: WebhookIngestService) {}

  @RequireIntegrationPermission(P.webhooksView)
  @Get('connections/:id/webhook-events')
  async events(@Req() r: any, @Param('id') id: string) { return this.svc.listWebhookEvents(actorFrom(r), id); }

  @RequireIntegrationPermission(P.productionWebhookManage)
  @Post('webhook-events/:eventId/retry')
  async retry(@Req() r: any, @Param('eventId') eventId: string) {
    const res = await this.svc.retryWebhookEvent(actorFrom(r), eventId);
    if (!res.ok && (res as any).error === 'not_found') throw new HttpException({ code: 'not_found', message: 'Event not found.' }, 404);
    if (!res.ok && (res as any).error === 'not_retryable') throw new HttpException({ code: 'not_retryable', message: 'Only failed events can be retried.' }, 409);
    return res;
  }

  @RequireIntegrationPermission(P.productionWebhookManage)
  @Post('webhook/drain')
  async drain(@Req() r: any, @Body(ValidatedBody(INT_LIMIT_BODY, { strict: true })) b: any) { return this.svc.drainWebhookQueue(actorFrom(r), Number(b?.limit) || 20); }
}
