// auth-devices.controller.ts — Constitution 3 §21–24 (Step 4): the signed-in user's own devices.
//   GET  /auth/devices                 → the devices (newest first), `current` marking the one this session came from
//   POST /auth/devices/:id/trust       → trusted for 30 days — only from a session whose sign-in proved a second factor
//   POST /auth/devices/:id/revoke      → signs it out (its sessions and refresh tokens end) and forgets its trust
//   POST /auth/devices/:id/block       → as revoke, and refuses sign-ins from it until unblocked
//   POST /auth/devices/:id/unblock
//   POST /auth/devices/:id/approve-platform → S-A13: a platform account approves another of ITS devices for Super Admin sign-in,
//                                            from a session on an already-approved device, with step-up
// A user only ever sees and changes their OWN devices (every query is keyed by the session's user id).
import { SignedInUserGuard, RequireStepUp } from '@aipowersalon/permissions/guards';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { AuditService } from '@aipowersalon/audit';
import { PlatformDeviceTrust } from './platform-device-trust';
import type { PlatformDeviceApprovalResult } from '@aipowersalon/api-contracts/platform';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { Controller, Get, HttpCode, HttpException, Inject, Optional, Param, Post, Req , UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { KyselyAuthDevices, DeviceError } from './auth-devices';
import { KyselyAuthEvents } from './auth-events';

@UseGuards(SignedInUserGuard)   // §27: the caller's own account — any signed-in person, never an integration
@Controller('auth/devices')
export class AuthDevicesController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Optional() @Inject(KyselyAuthDevices) private readonly devices?: KyselyAuthDevices | null, @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null, @Optional() @Inject(KyselyTenantAuthPolicy) private readonly policy?: KyselyTenantAuthPolicy | null,
    @Optional() @Inject(PlatformDeviceTrust) private readonly platformDevices?: PlatformDeviceTrust | null, @Optional() @Inject(AuditService) private readonly audit?: AuditService | null) {}
  private ev(r: any, type: 'DEVICE_TRUSTED' | 'DEVICE_REVOKED' | 'DEVICE_BLOCKED', deviceId: string): void {
    void this.authEvents?.record({ type, outcome: 'info', userId: r?.ctx?.userId ?? null, tenantId: r?.ctx?.tenantId ?? null, sessionId: r?.sessionId ?? null, metadata: { deviceId } });
  }
  private who(r: any): { userId: string; sid: string | null } {
    const userId = r?.ctx?.userId; if (!userId) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401);
    return { userId, sid: r?.sessionId ?? r?.ctx?.sessionId ?? null };
  }
  private svc(): KyselyAuthDevices { if (!this.devices || !this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'Devices need a database.' }, 503); return this.devices; }
  private async session(sid: string | null, userId: string): Promise<{ deviceId: string | null; mfaAt: string | null }> {
    if (!sid || !this.db) return { deviceId: null, mfaAt: null };
    const r: any = (await sql`select auth_device_id, last_mfa_at from sessions where id = ${sid}::uuid and user_id = ${userId}::uuid and revoked_at is null`.execute(this.db)).rows[0];
    return { deviceId: r?.auth_device_id ? String(r.auth_device_id) : null, mfaAt: r?.last_mfa_at ? new Date(r.last_mfa_at).toISOString() : null };
  }
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) { if (e instanceof DeviceError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status); throw e; }
  }

  @Get()
  async list(@Req() r: any) {
    const { userId, sid } = this.who(r); const svc = this.svc();
    const cur = await this.session(sid, userId);
    const allowed = !(r?.ctx?.tenantId && this.policy && (await this.policy.get(r.ctx.tenantId)).rememberTrustedDevices === false);
    return { devices: (await svc.list(userId)).map((d) => ({ ...d, current: d.id === cur.deviceId })), canTrust: !!cur.mfaAt && allowed };
  }
  @Post(':id/trust') @HttpCode(200)
  async trust(@Req() r: any, @Param('id') id: string) {
    const { userId, sid } = this.who(r); const svc = this.svc();
    // Constitution 3 Step 9: the salon's policy can switch trusted devices off
    if (r?.ctx?.tenantId && this.policy && (await this.policy.get(r.ctx.tenantId)).rememberTrustedDevices === false) throw new HttpException({ ok: false, code: 'POLICY_TRUSTED_DEVICES_OFF', message: 'Your salon does not allow trusted devices.' }, 403);
    return this.run(async () => { const device = await svc.trust(userId, id, { mfaAt: (await this.session(sid, userId)).mfaAt }); this.ev(r, 'DEVICE_TRUSTED', id); return { ok: true, device }; });
  }
  @Post(':id/revoke') @HttpCode(200)
  async revoke(@Req() r: any, @Param('id') id: string) { const { userId } = this.who(r); return this.run(async () => { const out = await this.svc().revoke(userId, id, 'revoked'); this.ev(r, 'DEVICE_REVOKED', id); return { ok: true, ...out }; }); }
  @Post(':id/block') @HttpCode(200)
  async block(@Req() r: any, @Param('id') id: string) { const { userId } = this.who(r); return this.run(async () => { const out = await this.svc().revoke(userId, id, 'blocked'); this.ev(r, 'DEVICE_BLOCKED', id); return { ok: true, ...out }; }); }
  /** S-A13: approve another device of this platform account for Super Admin sign-in. Only from a session whose own device is
   *  approved, with a fresh step-up (the password / authenticator again); salon accounts have nothing to approve. */
  @Post(':id/approve-platform') @HttpCode(200) @RequireStepUp()
  async approvePlatform(@Req() r: any, @Param('id') id: string): Promise<PlatformDeviceApprovalResult> {
    const { userId, sid } = this.who(r);
    if (!isPlatformPrincipal(r?.ctx ?? {})) throw new HttpException({ ok: false, code: 'PERMISSION_DENIED', message: 'Only platform accounts approve devices for Super Admin.' }, 403);
    if (!this.platformDevices || !this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'Devices need a database.' }, 503);
    const cur = await this.session(sid, userId);
    const out = await this.platformDevices.approveFromDevice(userId, cur.deviceId, id);
    if (!out.ok) throw new HttpException(out.reason === 'approver_not_approved'
      ? { ok: false, code: 'APPROVER_NOT_APPROVED', message: 'Approve new devices from a device that is already approved for Super Admin.' }
      : { ok: false, code: 'NOT_FOUND', message: 'That device is not on your account.' }, out.reason === 'approver_not_approved' ? 403 : 404);
    void this.authEvents?.record({ type: 'PLATFORM_DEVICE_APPROVED', outcome: 'success', userId, sessionId: sid, reason: 'device', metadata: { deviceId: id, approverDeviceId: cur.deviceId } });
    void this.audit?.recordPlatform({ module: 'security', action: 'platform_device_approved', resourceType: 'auth_device', resourceId: id, summary: 'Device approved for Super Admin sign-in (from an approved device)', status: 'success', severity: 'high', userId, role: r?.ctx?.role ?? null, metadata: { via: 'device', approverDeviceId: cur.deviceId } });   // never throws (AuditService contract)
    return { ok: true };
  }
  @Post(':id/unblock') @HttpCode(200)
  async unblock(@Req() r: any, @Param('id') id: string) { const { userId } = this.who(r); await this.svc().unblock(userId, id); return { ok: true }; }
}
