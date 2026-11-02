// ai-calls-public.controller.ts — AI Calls guide (Oct 31 2026), §04 / §13 / §20. The ONE public voice endpoint:
//   POST /webhooks/voice/retell   Retell call lifecycle events (call_started / call_ended / call_analyzed).
// No session. The X-Retell-Signature over rawBody + timestamp (5-minute replay window, constant-time compare) is the
// authentication; with no signing key configured the endpoint answers 503 and records nothing — a call is never created
// from an unsigned request. Tenant / branch come from the salon's agent mapping, never from the payload's metadata.
// Answers 200 for every verified event (accepted or not) so the provider does not retry a refusal forever; the reason is
// returned as a category only.
import { Body, Controller, Inject, Optional, Post, Req, Res } from '@nestjs/common';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { recordWebhook } from '@aipowersalon/observability';
import { VOICE_RETELL_EVENT_BODY } from '../request-schemas';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { AiCallsIngest } from './ai-calls-ingest';
import { AI_CALLS_INGEST } from './ai-calls-tokens';

@Controller()
export class AiCallsPublicController {
  constructor(private readonly retell: RetellVoiceAdapter, @Optional() @Inject(AI_CALLS_INGEST) private readonly ingest: AiCallsIngest | null) {}

  @Post('webhooks/voice/retell')
  async events(@Req() req: any, @Res() res: any, @Body(ValidatedBody(VOICE_RETELL_EVENT_BODY)) body: any) {
    const key = String(process.env.RETELL_WEBHOOK_SIGNING_KEY ?? '').trim();
    if (!key || !this.ingest) { recordWebhook('retell_voice', 'rejected'); return res.status(503).json({ code: 'VOICE_EVENTS_NOT_CONFIGURED', message: 'Signed voice events are not configured.' }); }
    const raw: string = req?.rawBody ? req.rawBody.toString('utf-8') : '';
    const v = raw ? this.retell.verifyWebhook(raw, req.headers ?? {}, key) : { ok: false };
    if (!v.ok) { recordWebhook('retell_voice', 'rejected'); return res.status(403).json({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature check failed.' }); }
    const r = await this.ingest.applyRetellEvent(raw, body);
    recordWebhook('retell_voice', r.accepted ? (r.duplicate ? 'duplicate' : 'processed') : 'failed');
    return res.status(200).json({ accepted: r.accepted, duplicate: !!r.duplicate, disposition: r.disposition ?? null, reason: r.reason ?? null });
  }
}
