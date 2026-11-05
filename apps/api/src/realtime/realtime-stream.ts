// realtime-stream.ts — Constitution 9 §7 "one logical Realtime Gateway layer".
//
// Four endpoints serve SSE streams (POS /realtime/stream, /owner/stream, /tech/stream, /customer/stream). Before
// this file each hand-rolled its own frame loop, and only the POS one had sequence numbers (§31–33), resync on
// reconnect (§36), the slow-client gate (§102), origin validation (§196), the connect limiter (§149), presence
// (Phase 14) and authorization revalidation (§42). Now every stream is opened HERE, so a protection added once
// applies to every realm — and a controller is reduced to "which rooms does this principal get" (§13: rooms are
// always derived from the server-side context, never from the client).
//
// Multi-room streams: a realm stream subscribes to two rooms (e.g. the branch room + the technician's own room).
// Sequences are per ROOM (§32), so each frame names its stream slot (`stream: 'r0' | 'r1' …`, an opaque index —
// clients never see room names, §110) and the SSE `id` carries the whole vector (`r0:42|r1:7`) so Last-Event-ID
// on reconnect lets the server check EVERY room for a gap.
import { REALTIME, type Emission, screensToRefetch, eventVersion } from '@aipowersalon/realtime-contracts';
import { clientIp } from '@aipowersalon/security';
import { Inject, Injectable, Optional, ForbiddenException, HttpException, MessageEvent, type BeforeApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, Subject, merge, interval, map, tap, of, takeUntil } from 'rxjs';
import type { SessionStore } from '@aipowersalon/identity';
import { untilSessionRevoked } from './sse-session-guard';
import { untilAuthzChanged, authzVersion, type AuthzVersionSource } from './authz-revalidation';
import { SUPPORT_SESSION_GATE, untilSupportSessionDead, type SupportSessionLookup } from '../common/support-session-gate';   // Phase 14
import { InProcessEmitter } from './realtime.gateway';
import { SlowClientGate, ConnectLimiter } from './realtime-transport-core';
import { isOriginAllowed } from '../common/allowed-origins';
import { PresenceService, type PresenceEntry } from './presence';

export interface StreamOptions {
  /** What the frame carries. 'full' = event + screens + payload (POS/owner); 'event-only' = event name (§22 minimization for tech/customer). */
  frame?: 'full' | 'event-only';
}

export function encodeSeqVector(seqs: number[]): string { return seqs.map((s, i) => `r${i}:${s}`).join('|'); }
export function decodeSeqVector(id: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!id) return out;
  for (const part of id.split('|')) {
    const m = /^r(\d+):(\d+)$/.exec(part.trim());
    if (m) out.set(Number(m[1]), Number(m[2]));
    else if (/^\d+$/.test(part.trim())) out.set(0, Number(part.trim()));      // legacy single-room id
  }
  return out;
}

@Injectable()
export class RealtimeStreamFactory implements BeforeApplicationShutdown {
  private readonly limiter = new ConnectLimiter();
  /** Every live stream's subscriber, so a shutdown can tell each client to move BEFORE the socket dies (§ graceful shutdown). */
  private readonly live = new Set<{ next: (m: MessageEvent) => void; complete: () => void }>();
  private draining = false;
  private readonly drain$ = new Subject<void>();                                    // completes every OUTER stream (heartbeat included)
  constructor(
    @Inject(REALTIME) private readonly bus: InProcessEmitter,
    @Optional() @Inject('SessionStore') private readonly sessions?: SessionStore,
    @Optional() @Inject('AUTHZ_VERSION_SOURCE') private readonly authz?: AuthzVersionSource | null,
    @Optional() private readonly presence?: PresenceService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * BUILD_PLAN Phase 13 (found by the native-realtime live proof): 'SessionStore' is provided by AuthModule, which this
   * @Global RealtimeModule does not import — so the constructor injection above resolved to undefined in the running API
   * and `untilSessionRevoked` was a no-op: a signed-out (or admin-revoked) session's open stream kept streaming. Resolve it
   * from the whole container on first use (strict: false) when the module-scoped injection is absent.
   */
  /** Phase 14: the support-session lookup (AppModule's SUPPORT_SESSION_GATE), resolved like the session store above. */
  private supportGate(): SupportSessionLookup | null {
    try { return (this.moduleRef?.get(SUPPORT_SESSION_GATE, { strict: false }) as SupportSessionLookup | undefined) ?? null; } catch { return null; }
  }
  private sessionStore(): SessionStore | undefined {
    if (this.sessions) return this.sessions;
    try { return (this.moduleRef?.get('SessionStore', { strict: false }) as SessionStore | undefined) ?? undefined; } catch { return undefined; }
  }

  /**
   * Graceful shutdown (DoD "Graceful gateway shutdown works"): tell every connected client to reconnect — with a
   * small client-side jitter so the surviving instances do not take the whole fleet in the same 100 ms — then
   * complete the streams. New opens during the drain get the same instruction immediately. Returns the number of
   * clients told to move. Idempotent.
   */
  drain(jitterMs = 2000): number {
    this.draining = true;
    let n = 0;
    for (const sub of [...this.live]) {
      try { sub.next({ data: { event: 'reconnect_requested', screens: [], reason: 'server_shutdown', jitterMs } } as MessageEvent); n++; } catch { /* already gone */ }
    }
    this.drain$.next();                                                               // completes the outer merge(events$, heartbeat$) of every live stream → teardown runs
    this.live.clear();
    return n;
  }
  get liveCount(): number { return this.live.size; }
  // BEFORE the HTTP server closes (Oct 6 2026). It used to be onApplicationShutdown — which Nest runs only AFTER
  // httpServer.close() resolves, and close() waits for every open connection. An SSE stream never ends on its own, so
  // on SIGTERM the drain never ran and the process hung until the platform killed it (clients reconnected blind).
  // The streams complete asynchronously (the last frame is written, then Nest ends the response); give them a moment so
  // their sockets are idle when the server closes — Node closes idle keep-alive sockets at close(), not ones that go
  // idle a few milliseconds later (those would hold close() for the keep-alive timeout).
  async beforeApplicationShutdown(): Promise<void> {
    const told = this.drain();
    if (told > 0) await new Promise((r) => setTimeout(r, 300));
  }

  /** Open one stream for the authenticated principal on `req`, subscribed to the rooms `resolveRooms` derives from the server context. */
  open(req: any, resolveRooms: () => Promise<string[]> | string[], opts: StreamOptions = {}): Observable<MessageEvent> {
    const c = req?.ctx || {};
    const frameMode = opts.frame ?? 'full';

    // §196: refuse a credentialed stream from an origin CORS would refuse — BEFORE anything is written.
    if (!isOriginAllowed(req?.headers?.origin)) { this.bus.metrics.mark('originRejected'); throw new ForbiddenException('origin not allowed'); }
    // §38/§149/§150: a principal reconnecting faster than any client legitimately would is a storm or abuse.
    const key = c.userId ? `u:${c.userId}` : `ip:${clientIp(req) ?? 'unknown'}`;
    const verdict = this.limiter.attempt(key);
    if (!verdict.ok) {
      this.bus.metrics.mark('connectsRateLimited');
      throw new HttpException({ statusCode: 429, message: 'too many realtime connections', retryAfterMs: verdict.retryAfterMs }, 429);
    }
    // §127: record the connection's authorization version at connect (async; terminal facts are enforced meanwhile).
    let initialVersion: string | null = null;
    if (this.authz && c.userId && c.tenantId) {
      this.authz.facts(c.userId, c.tenantId).then((f) => { initialVersion = authzVersion(f); }).catch(() => { /* fail-open */ });
    }

    // A client that opens while this instance is draining is redirected immediately with a FINITE stream.
    if (this.draining) return of({ data: { event: 'reconnect_requested', screens: [], reason: 'server_shutdown', jitterMs: 2000 } } as MessageEvent);

    const presenceRef: { entry: PresenceEntry | null } = { entry: null };
    const events$ = new Observable<MessageEvent>((sub) => {
      let alive = true;
      let teardowns: Array<() => void> = [];
      this.bus.metrics.connectionsOpened++;
      this.live.add(sub);
      const lastId = String(req?.headers?.['last-event-id'] ?? '');
      if (lastId) this.bus.metrics.mark('reconnects');

      // Phase 14 §113: register in the ephemeral presence registry; removed on teardown, expires on its own (§52).
      if (this.presence && c.userId && c.tenantId) {
        this.presence.register(c, req?.sessionId ?? null, req?.headers?.['x-device-id'] ? String(req.headers['x-device-id']) : null)
          .then((e) => { if (!alive) { void this.presence!.unregister(e); return; } presenceRef.entry = e; sub.next({ data: { event: 'presence_registered', screens: [], connectionId: e.connectionId } } as MessageEvent); })
          .catch(() => { /* presence is best-effort */ });
      }

      (async () => {
        let roomList: string[] = [];
        try { roomList = await resolveRooms(); }
        catch (err) {
          // A resolver may REFUSE the principal (a display session that cannot access this checkout, §15/§18): tell
          // the client once and close — never leave it "connected" to nothing.
          if (err instanceof ForbiddenException) { if (alive) { sub.next({ data: { event: 'forbidden', screens: [] } } as MessageEvent); sub.complete(); } return; }
          roomList = [];
        }
        if (!alive) return;
        // §33/§36: compare every room's Last-Event-ID position with where the room is now. Behind on ANY room ⇒ the
        // first frame is RESYNC_REQUIRED (no replay archive, §11: snapshot + resume).
        // §236: ask the SHARED counter, not this node's memory — a gateway that just restarted knows nothing locally.
        const current = await Promise.all(roomList.map((r) => (this.bus as any).currentSeqAsync?.(r) ?? this.bus.currentSeq?.(r) ?? 0));
        if (!alive) return;
        const seen = decodeSeqVector(lastId);
        // Behind ⇒ frames were missed. AHEAD ⇒ the server's counter was reset under the client (§237 Redis restart,
        // counter flush): the stream's numbering no longer matches what the client holds, so it must resync too.
        const gap = lastId !== '' && roomList.some((_, i) => seen.has(i) && (seen.get(i) as number) !== current[i]);
        if (gap) this.bus.metrics.mark('resyncsRequired');
        const seqs: Record<string, number> = {}; current.forEach((s, i) => { seqs[`r${i}`] = s; });
        sub.next({ data: { event: gap ? 'resync_required' : 'connected', screens: [], seq: current[0] ?? 0, seqs, reason: gap ? 'sequence_gap' : undefined } } as MessageEvent);

        // §98/§102: one slow-client gate per connection, fed by the connection's pending write bytes.
        const gate = new SlowClientGate();
        const pending = () => Number(req?.res?.writableLength ?? req?.socket?.writableLength ?? 0);
        const lastSeqs = [...current];
        teardowns = roomList.map((room, i) => this.bus.subscribe(room, (e: Emission) => {
          const p = pending();
          if (gate.recovered(p)) {
            this.bus.metrics.slowClientResyncs++;
            const now: Record<string, number> = {}; roomList.forEach((r, k) => { now[`r${k}`] = this.bus.currentSeq?.(r) ?? 0; });
            sub.next({ data: { event: 'resync_required', screens: [], seq: now.r0 ?? 0, seqs: now, reason: 'slow_client' } } as MessageEvent);
          }
          const v = gate.admit(p);
          if (v === 'drop') { this.bus.metrics.slowClientDrops++; return; }
          if (v === 'disconnect') { this.bus.metrics.mark('slowClientDisconnects'); sub.complete(); return; }
          if (typeof e.seq === 'number') lastSeqs[i] = e.seq;
          const data = frameMode === 'full'
            ? { event: e.event, v: eventVersion(e.event), screens: screensToRefetch(e.event), payload: e.payload, seq: e.seq ?? null, stream: `r${i}` }
            : { event: e.event, v: eventVersion(e.event), screens: screensToRefetch(e.event), seq: e.seq ?? null, stream: `r${i}` };
          sub.next({ id: encodeSeqVector(lastSeqs), data } as MessageEvent);
        }));
      })();

      return () => {
        alive = false;
        this.live.delete(sub);
        this.bus.metrics.connectionsClosed++;
        for (const t of teardowns) t();
        if (presenceRef.entry && this.presence) void this.presence.unregister(presenceRef.entry);
      };
    });

    // §53: the heartbeat keeps idle proxies from reaping the socket AND refreshes presence (§52) on each write.
    const heartbeat$ = interval(25000).pipe(
      tap(() => { if (presenceRef.entry && this.presence) void this.presence.heartbeat(presenceRef.entry); }),
      map(() => ({ data: { event: 'ping' } } as MessageEvent)),
    );
    // §41 revoked session, §42–44 changed authorization: either ends the stream; the client's reconnect re-authorizes.
    const authz$ = untilAuthzChanged<MessageEvent>(c.userId, c.tenantId, this.authz ?? undefined, () => initialVersion, () => { this.bus.metrics.mark('authzTerminations'); });
    // BUILD_PLAN Phase 14 (Constitution 9 §225 / 12): a stream opened under a support session (req.ctx.supportSessionId —
    // set only by TenantContextMiddleware from a VERIFIED live session) ends when that session expires or is ended.
    const support$ = untilSupportSessionDead<MessageEvent>(this.supportGate(), (c as any).supportSessionId, () => { this.bus.metrics.mark('authzTerminations'); });
    return merge(events$, heartbeat$).pipe(untilSessionRevoked(req, this.sessionStore()), authz$, support$, takeUntil(this.drain$));
  }
}
