// push.repository.ts — persistence port + in-memory adapter for the device-token registry and delivery logging.
import type { PushPlatform, PushSendResult } from './push.types';

export interface PushContext { tenantId: string | null; userId: string }
export interface PushTokenRow { id: string; platform: PushPlatform; token: string; app: string | null }
export interface DeliveryLogInput { tenantId: string | null; userId: string; token: string; template: string; result: PushSendResult }

export interface PushRepositoryPort {
  upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string): Promise<void>;
  revokeToken(token: string): Promise<void>;                 // token column is unique across users
  activeTokensForUser(userId: string): Promise<PushTokenRow[]>;
  logDelivery(input: DeliveryLogInput): Promise<void>;
}

interface Tok { id: string; tenantId: string | null; userId: string; platform: PushPlatform; token: string; app?: string; revoked: boolean }
export interface DeliveryLogRecord { tenantId: string | null; userId: string; channel: 'push'; targetMasked: string; template: string; providerId?: string; status: 'sent' | 'failed'; error?: string }

export class InMemoryPushRepository implements PushRepositoryPort {
  private toks: Tok[] = [];
  public readonly logs: DeliveryLogRecord[] = [];
  private seq = 0;
  async upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string) {
    const existing = this.toks.find((t) => t.token === token);
    if (existing) { existing.userId = ctx.userId; existing.tenantId = ctx.tenantId; existing.platform = platform; existing.app = app; existing.revoked = false; return; }
    this.toks.push({ id: 'tok_' + ++this.seq, tenantId: ctx.tenantId, userId: ctx.userId, platform, token, app, revoked: false });
  }
  async revokeToken(token: string) { const t = this.toks.find((x) => x.token === token); if (t) t.revoked = true; }
  async activeTokensForUser(userId: string) { return this.toks.filter((t) => t.userId === userId && !t.revoked).map((t) => ({ id: t.id, platform: t.platform, token: t.token, app: t.app ?? null })); }
  async logDelivery(input: DeliveryLogInput) {
    this.logs.push({ tenantId: input.tenantId, userId: input.userId, channel: 'push', targetMasked: '***' + input.token.slice(-6), template: input.template, providerId: input.result.providerId, status: input.result.ok ? 'sent' : 'failed', error: input.result.error });
  }
}
