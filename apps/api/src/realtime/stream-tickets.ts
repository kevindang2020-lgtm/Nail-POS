// stream-tickets.ts — BUILD_PLAN Phase 13 (Constitution 6 §28–32, audit bug 1): native realtime without a cookie and
// without a bearer token in a URL.
//
// The four mobile apps open their realtime stream with EventSource. In a browser that sends the realm's httpOnly
// cookie. In the Capacitor shell there is no cookie (the page origin is capacitor://localhost) and EventSource cannot
// send an Authorization header — so native fell back to the 15-second safety poll. The fix:
//
//   1. the app (bearer-authenticated) POSTs /realtime/stream-ticket → { ticket, expiresIn: 60 }
//   2. it opens GET /api/v1/<realm>/stream?ticket=…&device=… — no cookie, no Authorization
//   3. StreamTicketMiddleware (before the session middleware) redeems the ticket ONCE and hands the session middleware
//      the session's verified claims, exactly as if the bearer had been sent: the revocation check (sid), the lock, the
//      platform lockdown, the authorization re-check and every route guard run unchanged.
//
// The ticket is random (32 bytes, base64url), stored only as its SHA-256, single use (one conditional UPDATE), expires in
// 60 s, and is bound to: the session id, the realm (a tenant ticket cannot open /customer/stream), the tenant and branch
// the session holds, and the device id that asked (when it sent one). A replayed URL — from a log, a proxy, a screenshot —
// opens nothing.
import { createHash, randomBytes } from 'node:crypto';
import { HttpException, Inject, Injectable, NestMiddleware, Optional, UnauthorizedException } from '@nestjs/common';
import { DATABASE, runAcrossTenants, type AppDatabase } from '@aipowersalon/database';
import { realmForPath, audienceFor } from '@aipowersalon/identity';

export const STREAM_TICKET_TTL_SECONDS = 60;
export type TicketRealm = 'tenant' | 'customer' | 'platform';
/** The SSE endpoints a ticket can open (path without /api/v1). Anything else ignores `?ticket=`. */
export const TICKET_STREAM_PATHS = ['/realtime/stream', '/tech/stream', '/owner/stream', '/customer/stream'] as const;

export interface TicketRow {
  sessionId: string; realm: TicketRealm; userId: string; tenantId: string | null; branchId: string | null;
  deviceId: string | null; claims: Record<string, unknown>; expiresAt: Date;
}
export interface StreamTicketStore {
  insert(hash: string, row: TicketRow): Promise<void>;
  /** Atomically mark the ticket used and return it — null when unknown, expired or already used. */
  consume(hash: string, now: Date): Promise<TicketRow | null>;
}

export const hashTicket = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const DEVICE_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
export const cleanDeviceId = (v: unknown): string | null => (typeof v === 'string' && DEVICE_RE.test(v) ? v : null);

export class InMemoryStreamTicketStore implements StreamTicketStore {
  readonly rows = new Map<string, TicketRow & { usedAt: Date | null }>();
  async insert(hash: string, row: TicketRow) { this.rows.set(hash, { ...row, usedAt: null }); }
  async consume(hash: string, now: Date) {
    const r = this.rows.get(hash);
    if (!r || r.usedAt || r.expiresAt.getTime() <= now.getTime()) return null;
    r.usedAt = now;
    const { usedAt: _u, ...row } = r;
    return row;
  }
}

export class KyselyStreamTicketStore implements StreamTicketStore {
  constructor(private readonly db: NonNullable<AppDatabase>) {}
  async insert(hash: string, row: TicketRow) {
    await this.db.insertInto('realtime_stream_tickets').values({
      ticket_hash: hash, session_id: row.sessionId, realm: row.realm, user_id: row.userId, tenant_id: row.tenantId,
      branch_id: row.branchId, device_id: row.deviceId, claims: JSON.stringify(row.claims) as any, expires_at: row.expiresAt,
    }).execute();
  }
  async consume(hash: string, now: Date) {
    // Pre-session by definition (no tenant context yet): the ticket hash IS the credential, so the lookup runs unrestricted.
    const r = await runAcrossTenants('realtime stream ticket redemption: pre-session, by ticket hash', () =>
      this.db.updateTable('realtime_stream_tickets').set({ used_at: now })
        .where('ticket_hash', '=', hash).where('used_at', 'is', null).where('expires_at', '>', now)
        .returning(['session_id', 'realm', 'user_id', 'tenant_id', 'branch_id', 'device_id', 'claims', 'expires_at'])
        .executeTakeFirst());
    if (!r) return null;
    const claims = typeof r.claims === 'string' ? JSON.parse(r.claims) : (r.claims as Record<string, unknown>);
    return { sessionId: r.session_id, realm: r.realm as TicketRealm, userId: r.user_id, tenantId: r.tenant_id, branchId: r.branch_id, deviceId: r.device_id, claims, expiresAt: new Date(r.expires_at as any) };
  }
}

export class StreamTicketError extends HttpException {
  constructor(reason: string) {
    super({ statusCode: 401, code: 'UNAUTHENTICATED', reason, message: 'This live-updates link is invalid, expired or already used.' }, 401);
  }
}

@Injectable()
export class StreamTicketService {
  private store: StreamTicketStore;
  constructor(@Optional() @Inject(DATABASE) db?: AppDatabase | null) {
    this.store = db ? new KyselyStreamTicketStore(db) : new InMemoryStreamTicketStore();   // no DB (dev / unit harness): in-process
  }
  /** Tests: a service over a given store. */
  static withStore(store: StreamTicketStore): StreamTicketService {
    const s = new StreamTicketService(null);
    (s as any).store = store;
    return s;
  }
  get _store(): StreamTicketStore { return this.store; }

  /**
   * Issue a ticket for the session on `req` (its verified claims from the session middleware's own source). Refused for
   * an integration principal (API key / OAuth app — no session, no stream) and for a session without an id (cannot be
   * revoked, so cannot be bound).
   */
  async issue(input: { claims: Record<string, any> | null; sessionId: string | null; actorType?: string; deviceId?: unknown; now?: Date }): Promise<{ ticket: string; expiresIn: number }> {
    const c = input.claims;
    if (!c || input.actorType === 'INTEGRATION' || !input.sessionId || !c.userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to receive live updates.' });
    const now = input.now ?? new Date();
    const ticket = randomBytes(32).toString('base64url');
    const { iat: _i, ...claims } = c;
    await this.store.insert(hashTicket(ticket), {
      sessionId: input.sessionId, realm: audienceFor(String(c.role)) as TicketRealm /* the ONE role→realm mapping */, userId: String(c.userId),
      tenantId: c.tenantId ?? null, branchId: c.branchId ?? null, deviceId: cleanDeviceId(input.deviceId),
      claims, expiresAt: new Date(now.getTime() + STREAM_TICKET_TTL_SECONDS * 1000),
    });
    return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS };
  }

  /** Redeem for a stream request on `path`. Returns the session claims to authenticate the request with, or throws 401. */
  async redeem(input: { ticket: string; path: string; deviceId?: unknown; now?: Date }): Promise<Record<string, unknown>> {
    const now = input.now ?? new Date();
    if (typeof input.ticket !== 'string' || input.ticket.length < 20 || input.ticket.length > 200) throw new StreamTicketError('malformed');
    const row = await this.store.consume(hashTicket(input.ticket), now);
    if (!row) throw new StreamTicketError('unknown_expired_or_used');
    const pathRealm = realmForPath(input.path);
    if (pathRealm !== 'any' && pathRealm !== row.realm) throw new StreamTicketError('wrong_realm');
    if (row.deviceId && cleanDeviceId(input.deviceId) !== row.deviceId) throw new StreamTicketError('wrong_device');
    const c = row.claims as Record<string, any>;
    if (c.sid !== row.sessionId || (c.tenantId ?? null) !== row.tenantId || (c.branchId ?? null) !== row.branchId) throw new StreamTicketError('binding_mismatch');
    if (typeof c.exp === 'number' && c.exp * 1000 <= now.getTime()) throw new StreamTicketError('session_expired');
    return c;
  }
}

/** Path of the request without the query and without the /api/v1 prefix. */
export const streamPathOf = (req: any): string => String(req?.originalUrl ?? req?.url ?? '').split('?')[0].replace(/^\/api\/v1(?=\/)/, '').replace(/\/+$/, '');
const hasCredential = (req: any): boolean => {
  const h = req?.headers ?? {};
  return typeof (h.authorization ?? h.Authorization) === 'string' || /(^|;\s*)aps_(session|customer|platform)=/.test(String(h.cookie ?? ''));
};

/**
 * Runs BEFORE TenantContextMiddleware on the four SSE endpoints. With `?ticket=` and no cookie / Authorization, it redeems
 * the ticket and sets `req.session` to the session's claims — the session middleware then treats the request exactly
 * like the bearer call that asked for the ticket (revocation, lock, lockdown, authorization re-check, guards). With a
 * credential present the ticket is ignored (the browser path is unchanged); a bad ticket is a 401 before anything opens.
 */
@Injectable()
export class StreamTicketMiddleware implements NestMiddleware {
  constructor(private readonly tickets: StreamTicketService) {}
  async use(req: any, _res: any, next: () => void) {
    const path = streamPathOf(req);
    const ticket = req?.query?.ticket ?? new URLSearchParams(String(req?.originalUrl ?? req?.url ?? '').split('?')[1] ?? '').get('ticket');
    if (!ticket || String(req?.method ?? 'GET').toUpperCase() !== 'GET' || !(TICKET_STREAM_PATHS as readonly string[]).includes(path) || hasCredential(req)) return next();
    const device = req?.query?.device ?? req?.headers?.['x-device-id'];
    req.session = await this.tickets.redeem({ ticket: String(ticket), path, deviceId: device });   // throws 401 — Nest answers it
    if (!req.headers['x-device-id'] && cleanDeviceId(device)) req.headers['x-device-id'] = String(device);   // presence groups by device
    if (req.query && typeof req.query === 'object') { delete req.query.ticket; delete req.query.device; }
    return next();
  }
}
