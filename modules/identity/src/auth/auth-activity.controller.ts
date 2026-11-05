// auth-activity.controller.ts — Constitution 3 §88 / §177 (Step 8): the signed-in user's OWN recent authentication events
// (sign-ins, failed MFA, step-ups, device changes) for the Security screen. Keyed by the session's user only.
import { SignedInUserGuard } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, Inject, Optional, Req , UseGuards } from '@nestjs/common';
import { KyselyAuthEvents } from './auth-events';

@UseGuards(SignedInUserGuard)   // §27: the caller's own account — any signed-in person, never an integration
@Controller('auth/activity')
export class AuthActivityController {
  constructor(@Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null) {}
  @Get()
  async mine(@Req() r: any) {
    const userId = r?.ctx?.userId; if (!userId) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401);
    if (!this.authEvents) return { events: [] };
    return { events: await this.authEvents.listForUser(userId, 30) };
  }
}
