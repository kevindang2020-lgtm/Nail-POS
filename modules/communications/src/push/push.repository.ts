// push.repository.ts — persistence port + in-memory adapter for the device-token registry and delivery logging.
import type { PushPlatform, PushSendResult } from './push.types';
import type { StaffPrefsRead } from '../notifications/staff-notification-prefs';

export interface PushContext { tenantId: string | null; userId: string }
export interface PushTokenRow { id: string; platform: PushPlatform; token: string; app: string | null }
export interface DeliveryLogInput { tenantId: string | null; userId: string; token: string; template: string; result: PushSendResult;
  /** extras round 11: a device NOT sent to because the person switched this kind of message off (result.error = 'staff_pref_off') */
  suppressed?: boolean }

export interface PushRepositoryPort {
  upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string): Promise<void>;
  revokeToken(token: string): Promise<void>;                 // token column is unique across users
  activeTokensForUser(userId: string): Promise<PushTokenRow[]>;
  /** extras Customer Notifications 08 (round 10): this person's quiet hours at this salon and the salon's time zone (null = none set) */
  quietHoursFor?(tenantId: string, userId: string): Promise<{ start: string; end: string; timeZone: string } | null>;
  /** extras round 11: this person's own notification switches at this salon — through the ONE reader (staff-notification-prefs.ts) */
  staffPrefsFor?(tenantId: string, userId: string): Promise<StaffPrefsRead>;
  logDelivery(input: DeliveryLogInput): Promise<void>;
}

interface Tok { id: string; tenantId: string | null; userId: string; platform: PushPlatform; token: string; app?: string; revoked: boolean }
export interface DeliveryLogRecord { tenantId: string | null; userId: string; channel: 'push'; targetMasked: string; template: string; providerId?: string; status: 'sent' | 'failed' | 'suppressed'; error?: string }

export class InMemoryPushRepository implements PushRepositoryPort {
  private toks: Tok[] = [];
  public readonly logs: DeliveryLogRecord[] = [];
  /** extras round 11: saved switches by `${tenantId}|${userId}` (tests); none = no saved row */
  public readonly staffPrefs = new Map<string, StaffPrefsRead>();
  private seq = 0;
  async upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string) {
    const existing = this.toks.find((t) => t.token === token);
    if (existing) { existing.userId = ctx.userId; existing.tenantId = ctx.tenantId; existing.platform = platform; existing.app = app; existing.revoked = false; return; }
    this.toks.push({ id: 'tok_' + ++this.seq, tenantId: ctx.tenantId, userId: ctx.userId, platform, token, app, revoked: false });
  }
  async revokeToken(token: string) { const t = this.toks.find((x) => x.token === token); if (t) t.revoked = true; }
  async activeTokensForUser(userId: string) { return this.toks.filter((t) => t.userId === userId && !t.revoked).map((t) => ({ id: t.id, platform: t.platform, token: t.token, app: t.app ?? null })); }
  async staffPrefsFor(tenantId: string, userId: string): Promise<StaffPrefsRead> { return this.staffPrefs.get(`${tenantId}|${userId}`) ?? { state: 'default', prefs: null }; }
  async logDelivery(input: DeliveryLogInput) {
    this.logs.push({ tenantId: input.tenantId, userId: input.userId, channel: 'push', targetMasked: '***' + input.token.slice(-6), template: input.template, providerId: input.result.providerId, status: input.suppressed ? 'suppressed' : input.result.ok ? 'sent' : 'failed', error: input.result.error });
  }
}
