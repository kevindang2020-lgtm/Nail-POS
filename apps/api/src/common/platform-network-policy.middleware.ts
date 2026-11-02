// platform-network-policy.middleware.ts — Security Deep Scan §136 / §29: enforce the Super Admin network policy.
//
// The rules (blocks, allowlist, fail-safe empty allowlist, loopback) are PlatformNetworkPolicy's
// (modules/super-admin/src/super-admin-security/network-policy*.ts). This middleware decides WHERE they apply:
//   • the /super-admin realm (and /api/v1/platform/*, rewritten to it before Nest) — BEFORE the session is read, so a
//     refused network never reaches the sign-in check or a handler;
//   • the platform sign-in: POST /auth/login with portal "super-admin";
//   • any request carried by a SUPER_ADMIN session, whatever its path (a token minted on an allowed network and replayed
//     from another is refused there too) — the second registration, after TenantContextMiddleware sets req.ctx.
// Salon / customer / public traffic is never evaluated (a tenant route is unaffected by the platform allowlist).
//
// The client address is clientIp(req): Express's resolution under the configured trusted-proxy hop count — never a raw
// X-Forwarded-For. A refusal is 403 NETWORK_POLICY_DENIED, a NETWORK_POLICY_DENIED security event (HIGH) and a platform
// audit row — at most once per address + reason per minute per process, so a scripted flood cannot flood the record.
// SUPER_ADMIN_NETWORK_POLICY=report records without refusing; =off is the documented break-glass (no evaluation).
import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { PlatformNetworkPolicy } from '@aipowersalon/super-admin';
import { SecurityEvents } from '@aipowersalon/security-center';
import { AuditService } from '@aipowersalon/audit';
import { clientIp } from '@aipowersalon/security';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { log as rootLog } from '@aipowersalon/observability';

const log = rootLog.withContext({ component: 'platform-network-policy' });
const EVALUATED = Symbol.for('aps.platformNetworkPolicy');
export const REFUSAL_RECORD_INTERVAL_MS = 60_000;

/** Which part of the platform surface this request is, or null when the network policy does not apply to it. */
export function platformNetworkScope(req: any): 'realm' | 'login' | 'session' | null {
  const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0].replace(/^\/api\/v\d+(?=\/)/, '');
  if (/^\/super-admin(\/|$)/.test(path)) return 'realm';
  if (String(req?.method ?? '').toUpperCase() === 'POST' && /^\/auth\/login\/?$/.test(path) && req?.body?.portal === 'super-admin') return 'login';
  if (req?.ctx && isPlatformPrincipal(req.ctx)) return 'session';
  return null;
}

@Injectable()
export class PlatformNetworkPolicyMiddleware implements NestMiddleware {
  private readonly lastRecorded = new Map<string, number>();
  now: () => number = Date.now;
  constructor(
    @Optional() @Inject(PlatformNetworkPolicy) private readonly policy?: PlatformNetworkPolicy | null,
    @Optional() @Inject(SecurityEvents) private readonly securityEvents?: SecurityEvents | null,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService | null,
  ) {}

  async use(req: any, res: any, next: (err?: unknown) => void): Promise<void> {
    if (!this.policy || req?.[EVALUATED]) return next();
    const scope = platformNetworkScope(req);
    if (!scope) return next();
    const mode = this.policy.mode();
    if (mode === 'off') return next();
    req[EVALUATED] = true;
    const ip = clientIp(req);
    let d;
    try { d = await this.policy.decide(ip); } catch (e) { log.warn('network_policy.decide_failed', { error: (e as Error)?.message }); return next(); }   // fail open
    if (d.allowed) return next();
    this.record(req, ip, scope, d.reason, mode);
    if (mode === 'report') return next();
    res.status(403).json({ ok: false, code: 'NETWORK_POLICY_DENIED', message: 'Platform administration is not available from this network.' });
  }

  private record(req: any, ip: string | null, scope: string, reason: string, mode: string): void {
    const key = `${reason}|${ip ?? 'unknown'}`; const t = this.now();
    const last = this.lastRecorded.get(key);
    if (last !== undefined && t - last < REFUSAL_RECORD_INTERVAL_MS) return;
    if (this.lastRecorded.size >= 5_000) this.lastRecorded.clear();
    this.lastRecorded.set(key, t);
    const actorId = req?.ctx?.userId ?? null;
    const what = `${reason === 'blocked' ? 'blocked address' : 'address outside the Super Admin allowlist'} on ${scope}${mode === 'report' ? ' (report mode: not refused)' : ''}`;
    log.warn('network_policy.denied', { reason, scope, mode });
    void this.securityEvents?.record({ type: 'NETWORK_POLICY_DENIED', actorType: actorId ? 'super_admin' : 'anonymous', actorId, resourceType: 'platform_network_policy', resourceId: scope, reason: what, ip, device: String(req?.headers?.['user-agent'] ?? '').slice(0, 200) || null });
    void this.audit?.recordPlatform({ module: 'security', action: 'network_policy_denied', resourceType: 'platform_network_policy', resourceId: scope, summary: `Refused ${what}`, status: 'failed', severity: 'high', ip, userId: actorId, role: req?.ctx?.role ?? null, metadata: { reason, scope, mode } });
  }
}
