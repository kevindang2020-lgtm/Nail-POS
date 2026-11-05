// push.service.ts — register/revoke device tokens and dispatch a notification to all of a user's devices through the
// configured provider, logging every attempt. dispatchToUser is best-effort and never throws, so callers (notification
// sites) can fire-and-forget without risking the underlying action.
import { Injectable } from '@nestjs/common';
import type { PushRepositoryPort, PushContext } from './push.repository';
import type { PushProvider, PushMessage, PushPlatform, DispatchSummary } from './push.types';
import type { PushTokenRow } from './push.repository';
import { selectPushProvider } from './push-providers';
import { isPushApp, isPushCategory, categoryTargetsApp, pushRouteData, PUSH_FORBIDDEN_DATA_KEYS } from '@aipowersalon/api-contracts';

/** §61 + §62 (Phase 13 D): the payload a provider sees — the producer's data minus every forbidden key, plus the typed
 *  category and route. Values are strings (FCM data is string-only). */
export function minimizedPushData(msg: PushMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const forbidden = new Set<string>(PUSH_FORBIDDEN_DATA_KEYS as readonly string[]);
  for (const [k, v] of Object.entries(msg.data ?? {})) { if (!forbidden.has(k) && v != null) out[k] = String(v); }
  return msg.category ? { ...out, ...pushRouteData(msg.category, out) } : out;
}

export class PushError extends Error { constructor(public code: 'invalid', msg: string) { super(msg); } }
const PLATFORMS: PushPlatform[] = ['ios', 'android', 'web'];

@Injectable()
export class PushService {
  private provider: PushProvider;
  constructor(private readonly repo: PushRepositoryPort, provider?: PushProvider) { this.provider = provider ?? selectPushProvider(); }
  setProvider(p: PushProvider) { this.provider = p; }           // used by tests / runtime swap
  providerName() { return this.provider.name; }

  async register(ctx: PushContext, platform: string, token: string, app?: string): Promise<{ ok: true }> {
    if (!ctx.userId) throw new PushError('invalid', 'Not authenticated.');
    if (!PLATFORMS.includes(platform as PushPlatform)) throw new PushError('invalid', 'platform must be ios, android, or web.');
    if (!token || token.trim().length < 8) throw new PushError('invalid', 'A valid device token is required.');
    // Phase 13 D: the app id picks the APNs topic and the per-app targeting — only the known ones (or none, for the POS).
    let normApp = app ? app.toLowerCase().trim() : undefined;
    if (normApp === 'technician') normApp = 'tech';
    if (normApp != null && normApp !== '' && !isPushApp(normApp) && normApp !== 'pos' && normApp !== 'admin') throw new PushError('invalid', 'app must be customer, tech, owner, manager, pos, or admin.');
    await this.repo.upsertToken(ctx, platform as PushPlatform, token.trim(), normApp);
    return { ok: true };
  }
  async unregister(_ctx: PushContext, token: string): Promise<{ ok: true }> {
    if (token && token.trim()) await this.repo.revokeToken(token.trim());
    return { ok: true };
  }

  // Fan a message out to every active device of a user. Returns a summary; logs each attempt. Never throws.
  // A provider result of 'unregistered' (APNs 410/BadDeviceToken, FCM UNREGISTERED) revokes the dead token so it
  // is not retried forever.
  // Phase 13 D (Constitution 6 §58–63): a typed category sends only to the apps it targets (a technician's queue push
  // never reaches the customer app on the same person's phone); an unknown category sends nothing. The payload is
  // minimized here, at the one choke point every producer goes through.
  async dispatchToUser(tenantId: string | null, userId: string, msg: PushMessage): Promise<DispatchSummary> {
    if (msg.category !== undefined && !isPushCategory(msg.category)) return { tokens: 0, sent: 0, failed: 0, provider: this.provider.name };
    let tokens: PushTokenRow[] = [];
    try { tokens = await this.repo.activeTokensForUser(userId); } catch { tokens = []; }
    if (msg.category) tokens = tokens.filter((t) => categoryTargetsApp(msg.category!, t.app));
    msg = { ...msg, data: minimizedPushData(msg) };
    let sent = 0, failed = 0;
    for (const t of tokens) {
      let result; try { result = await this.provider.send({ token: t.token, platform: t.platform, app: t.app }, msg); } catch (e: any) { result = { ok: false, error: e?.message || 'send_error' }; }
      try { await this.repo.logDelivery({ tenantId, userId, token: t.token, template: msg.reference || msg.title, result }); } catch { /* best-effort */ }
      if (result.ok) sent++; else failed++;
      if (!result.ok && result.error === 'unregistered') { try { await this.repo.revokeToken(t.token); } catch { /* best-effort */ } }
    }
    return { tokens: tokens.length, sent, failed, provider: this.provider.name };
  }
}
