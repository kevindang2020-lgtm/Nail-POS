// auth-devices.controller.ts — Constitution 3 §21–24 (Step 4): the signed-in user's own devices.
//   GET  /auth/devices                 → the devices (newest first), `current` marking the one this session came from
//   POST /auth/devices/:id/trust       → trusted for 30 days — only from a session whose sign-in proved a second factor
//   POST /auth/devices/:id/revoke      → signs it out (its sessions and refresh tokens end) and forgets its trust
//   POST /auth/devices/:id/block       → as revoke, and refuses sign-ins from it until unblocked
//   POST /auth/devices/:id/unblock
// A user only ever sees and changes their OWN devices (every query is keyed by the session's user id).
import { SignedInUserGuard } from '@aipowersalon/permissions/guards';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { Controller, Get, HttpCode, HttpException, Inject, Optional, Param, Post, Req , UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { KyselyAuthDevices, DeviceError } from './auth-devices';
import { KyselyAuthEvents } from './auth-events';

@UseGuards(SignedInUserGuard)   // §27: the caller's own account — any signed-in person, never an integration
@Controller('auth/devices')
export class AuthDevicesController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Optional() @Inject(KyselyAuthDevices) private readonly devices?: KyselyAuthDevices | null, @Optional() @Inject(KyselyAuthEvents) private readonly authEvents?: KyselyAuthEvents | null, @Optional() @Inject(KyselyTenantAuthPolicy) private readonly policy?: KyselyTenantAuthPolicy | null) {}
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
  @Post(':id/unblock') @HttpCode(200)
  async unblock(@Req() r: any, @Param('id') id: string) { const { userId } = this.who(r); await this.svc().unblock(userId, id); return { ok: true }; }
}
