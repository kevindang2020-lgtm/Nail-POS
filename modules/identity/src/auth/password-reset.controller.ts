// password-reset.controller.ts — public endpoints for the tenant forgot-password / temporary-code flow.
// POST /auth/password-reset/request   — always returns the generic message (no account enumeration).
// POST /auth/password-reset/temp-login — exchange a temporary code for a short-lived reset session.
// POST /auth/password-reset/complete   — set a new password, revoke old sessions, return fresh tokens.
import { Body, Controller, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { PasswordResetService } from './password-reset.service';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { RESET_COMPLETE_BODY, RESET_REQUEST_BODY, RESET_TEMP_LOGIN_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly svc: PasswordResetService) {}

  @Post('request') @HttpCode(200)
  request(@Body(ValidatedBody(RESET_REQUEST_BODY)) b: any, @Req() r: any) {
    return this.svc.requestReset({ salonCode: String(b?.salonCode ?? ''), phone: String(b?.phone ?? ''), ip: safeInet(r?.ip) ?? undefined, ua: r?.headers?.['user-agent'] });
  }

  @Post('temp-login') @HttpCode(200)
  tempLogin(@Body(ValidatedBody(RESET_TEMP_LOGIN_BODY)) b: any) {
    return this.svc.loginWithTemp({ tenantCodeOrSlug: String(b?.tenantCodeOrSlug ?? b?.salonCode ?? ''), emailOrPhone: String(b?.emailOrPhone ?? ''), password: String(b?.password ?? '') });
  }

  @Post('complete') @HttpCode(200)
  async complete(@Body(ValidatedBody(RESET_COMPLETE_BODY)) b: any) {
    try {
      return await this.svc.completeReset({ resetSessionToken: String(b?.resetSessionToken ?? ''), newPassword: String(b?.newPassword ?? ''), confirmPassword: String(b?.confirmPassword ?? '') });
    } catch (e: any) {
      throw new HttpException({ ok: false, code: 'reset_failed', message: e?.message || 'reset_failed' }, 400);
    }
  }
}
