// messaging-readiness.service.ts — reads the messaging environment (only presence/length/safe values) and returns a
// readiness report via the pure evaluator. Never exposes secret values (no auth token, no KEK — only whether they're
// set and, for the KEK, its length). The public API base URL is used to render the exact webhook URLs to paste into
// Twilio; it's read from PUBLIC_API_BASE_URL / APS_API_BASE, else null.
import { Injectable } from '@nestjs/common';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { evaluateMessagingReadiness, type ReadinessReport } from './messaging-readiness-core';

const isE164 = (n?: string | null) => !!n && /^\+[1-9]\d{6,15}$/.test(n);

@Injectable()
export class MessagingReadinessService {
  report(): ReadinessReport {
    const env = process.env;
    return evaluateMessagingReadiness({
      hasAccountSid: !!env.TWILIO_ACCOUNT_SID,
      hasAuthToken: !!env.TWILIO_AUTH_TOKEN,
      fromNumber: env.TWILIO_FROM || null,
      hasStatusCallbackUrl: !!env.TWILIO_STATUS_CALLBACK_URL,
      statusCallbackUrl: env.TWILIO_STATUS_CALLBACK_URL || null,
      vaultKekLength: (env.PROVIDER_VAULT_KEK || '').length,
      publicApiBaseUrl: env.PUBLIC_API_BASE_URL || env.APS_API_BASE || null,
      isvEmailSet: !!env.TWILIO_ISV_EMAIL,
      primaryProfileSid: env.TWILIO_PRIMARY_PROFILE_SID || null,
      // Presence only — never a key, never a token. Same rule as everything else on this surface.
      invitations: {
        hasTwilio: !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && isE164(env.TWILIO_FROM),
        hasSendGrid: !!env.SENDGRID_API_KEY,   // the sender address defaults to nailsalons@aipowersalon.com
        hasNotifierUrl: !!env.INVITE_NOTIFIER_URL,
        hasAppBaseUrl: !!env.APP_BASE_URL,
      },
    });
  }
}

@Controller('super-admin/messaging')
@UseGuards(SuperAdminGuard)
export class MessagingReadinessController {
  constructor(private readonly svc: MessagingReadinessService) {}
  @Get('readiness') readiness() { return this.svc.report(); }
}
