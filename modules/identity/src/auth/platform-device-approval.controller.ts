// platform-device-approval.controller.ts — S-A13 (Security Deep Scan §29 / §136): POST /public/security/approve-device { token }
// — the one-time link emailed when a platform account signed in (password + authenticator) from a device not yet approved
// for platform use. Public by necessity (the device being approved has no session); the single-use token is the credential.
// The admin portal page /approve-device POSTs it after the person presses Approve — a GET never approves (mail scanners
// pre-fetch links). See platform-device-trust.ts.
import { AnonRateLimit } from '@aipowersalon/security/nest';
import { clientIp } from '@aipowersalon/security';
import { Body, Controller, HttpCode, HttpException, Inject, Optional, Post, Req } from '@nestjs/common';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { AuditService } from '@aipowersalon/audit';
import { PlatformDeviceTrust } from './platform-device-trust';
import { KyselyAuthEvents } from './auth-events';
import { TOKEN_BODY } from '../request-schemas';
import type { PlatformDeviceApprovalResult } from '@aipowersalon/api-contracts/platform';

@Controller('public/security')
export class PlatformDeviceApprovalController {
  constructor(
    @Optional() @Inject(PlatformDeviceTrust) private readonly trust?: PlatformDeviceTrust | null,
    @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService | null,
  ) {}

  @Post('approve-device') @HttpCode(200) @AnonRateLimit(20, 15 * 60_000, { bucket: 'platform-device-approve' })
  async approve(@Req() req: any, @Body(ValidatedBody(TOKEN_BODY, { strict: true })) b: any): Promise<PlatformDeviceApprovalResult> {
    if (!this.trust) throw new HttpException({ ok: false, code: 'UNAVAILABLE' }, 503);
    const r = await this.trust.approveByToken(String(b?.token ?? ''));
    if (!r.ok) {
      const code = r.reason === 'used' ? 'ALREADY_USED' : r.reason === 'expired' ? 'EXPIRED' : r.reason === 'device_gone' ? 'DEVICE_GONE' : 'INVALID';
      const message = r.reason === 'used' ? 'This link was already used. Sign in again from the device.'
        : r.reason === 'expired' ? 'This link has expired. Sign in again from the device to get a new one.'
        : r.reason === 'device_gone' ? 'That device was signed out or blocked on your account. Sign in again from it to get a new link.'
        : 'This link is not valid.';
      throw new HttpException({ ok: false, code, message }, 400);
    }
    const ip = clientIp(req) ?? null;
    void this.authEvents?.record({ type: 'PLATFORM_DEVICE_APPROVED', outcome: 'success', userId: r.userId, reason: 'email', ip, userAgent: String(req?.headers?.['user-agent'] ?? '') || null, metadata: { deviceId: r.deviceId } });
    void this.audit?.recordPlatform({ module: 'security', action: 'platform_device_approved', resourceType: 'auth_device', resourceId: r.deviceId, summary: 'Device approved for Super Admin sign-in (emailed link)', status: 'success', severity: 'high', ip, userId: r.userId, role: 'SUPER_ADMIN', metadata: { via: 'email' } });   // never throws (AuditService contract)
    return { ok: true, message: 'Device approved. Sign in again from it.' };
  }
}
