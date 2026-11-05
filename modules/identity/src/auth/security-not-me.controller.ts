// security-not-me.controller.ts — Constitution 3 §90 (Step 10a): POST /public/security/not-me { token } — the "This wasn't
// me" link from a new-device alert. Public by necessity (the person may have no working session); the single-use token
// is the credential. Blocks the device, ends every session of the account.
import { Body, Controller, HttpCode, HttpException, Inject, Optional, Post, Req } from '@nestjs/common';
import { SecurityNotifications } from './security-notifications';
import { KyselyAuthEvents } from './auth-events';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TOKEN_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('public/security')
export class SecurityNotMeController {
  constructor(@Optional() @Inject(SecurityNotifications) private readonly notifier?: SecurityNotifications | null, @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null) {}
  @Post('not-me') @HttpCode(200)
  async notMe(@Req() req: any, @Body(ValidatedBody(TOKEN_BODY)) b: any) {
    if (!this.notifier) throw new HttpException({ ok: false, code: 'UNAVAILABLE' }, 503);
    const r = await this.notifier.notMe(String(b?.token ?? ''));
    if (!r.ok) throw new HttpException({ ok: false, code: r.reason === 'used' ? 'ALREADY_USED' : r.reason === 'expired' ? 'EXPIRED' : 'INVALID',
      message: r.reason === 'used' ? 'This link was already used — your account was secured then.' : r.reason === 'expired' ? 'This link has expired. Sign in and review your devices under Security.' : 'This link is not valid.' }, 400);
    void this.authEvents?.record({ type: 'NOT_ME_REPORTED', outcome: 'info', userId: r.userId, ip: req?.ip ?? null, userAgent: String(req?.headers?.['user-agent'] ?? '') || null, metadata: { sessionsEnded: r.sessionsEnded } });
    return { ok: true, sessionsEnded: r.sessionsEnded, message: 'Done. Every device on your account is signed out and the new one is blocked. Choose a new password now.' };
  }
}
