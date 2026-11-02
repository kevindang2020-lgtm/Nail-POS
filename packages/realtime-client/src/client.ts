// client.ts — Constitution 9 §174 the ONE shared realtime client, used by POS, Owner, Technician and Customer
// apps through realm-specific wrappers. Everything the POS client learned (reconnect-reconcile, jittered
// backoff, wake/tab-resume, dedupe, version guard, sequence gaps, presence reports) lives here once.
//
// Transport: SSE (REALTIME_ARCHITECTURE_AUDIT.md Phase 3). The room is server-derived (§13): the client never
// names a room. `subscribe({ channel })` (§175) is a CLIENT-SIDE filter over the stream by channel vocabulary,
// mapped centrally (§177) — features never format `tenant:123:branch:456:queue` themselves.
import {
  screensToRefetch, ConnectionStateMachine, EventTracker, SequenceTracker, shouldRefreshOnVisible, EVENTS,
  type RealtimeStatus,
} from './core';

/** `stream` = which of the stream's rooms the frame came from ('r0' the branch room, 'r1' e.g. the technician's own
 *  room — slot names only, never room names); absent on a single-room stream. */
export interface RealtimeDetail { event: string; screens: string[]; payload?: unknown; stream?: string; }
export type RealtimeEventHandler = (d: RealtimeDetail) => void;
export type ReconcileHandler = (reason: string) => void;
export type StatusHandler = (status: RealtimeStatus) => void;

/** §175 channel vocabulary → the server event names that belong to it (§177 centralized mapping). */
export const CHANNELS = {
  'branch.queue':    [EVENTS.queueUpdated, EVENTS.customerCheckedIn, EVENTS.ticketAssigned],
  'branch.booking':  [EVENTS.appointmentCreated, EVENTS.appointmentUpdated, EVENTS.appointmentCancelled],
  'branch.serving':  [EVENTS.serviceStarted, EVENTS.servicePaused, EVENTS.serviceResumed, EVENTS.serviceDone, EVENTS.ticketReadyCheckout,
                      EVENTS.ticketServiceLineAdded, EVENTS.ticketServiceLineUpdated, EVENTS.ticketServiceLineRemoved, EVENTS.ticketLineTechnicianAssigned],
  'branch.checkout': [EVENTS.checkoutTotalRecalculated, EVENTS.ticketTotalRecalculated, EVENTS.paymentProcessingStarted, EVENTS.paymentApproved, EVENTS.paymentFailed, EVENTS.ticketPaid, EVENTS.receiptSent,
                      EVENTS.checkoutPaymentClaimed, EVENTS.checkoutPaymentClaimReleased, EVENTS.paymentVerifying, EVENTS.paymentRecovered, EVENTS.mobilePayDeviceUpdated, EVENTS.checkoutSentToMobile],
  'technician.me':   [EVENTS.ticketAssigned, EVENTS.technicianHelpRequested, EVENTS.technicianHelpAccepted, EVENTS.technicianHelpDeclined,
                      EVENTS.followUpTaskUpdated, EVENTS.dailyFollowUpsCreated, EVENTS.technicianEarningsUpdated, EVENTS.techProfileUpdated,
                      EVENTS.techMembershipApproved, EVENTS.techMembershipRejected],
  'owner.dashboard': [EVENTS.reportsUpdated, EVENTS.ownerAlertCreated, EVENTS.ownerAlertUpdated, EVENTS.ownerPayrollUpdated, EVENTS.settingsUpdated, EVENTS.tenantStatusUpdated, EVENTS.expenseUpdated],
  'customer.me':     [EVENTS.customerFollowUpReceived, EVENTS.customerProfileUpdated],
} as const;
export type ChannelName = keyof typeof CHANNELS;

export interface RealtimeClientOptions {
  /** The SSE path, e.g. '/realtime/stream'. Relative paths ride the app's existing proxy. */
  streamPath?: string;
  /**
   * BUILD_PLAN Phase 13 (Constitution 6 §28–32): resolve the URL to open, BEFORE EACH (re)connect. On native this fetches a
   * fresh single-use stream ticket and returns the ABSOLUTE stream URL with `?ticket=` (EventSource cannot send a header;
   * a bearer never goes in a URL). Absent → `streamPath` as given (the browser's cookie authenticates). A rejection is a
   * connection error: jittered backoff, then a new attempt with a new ticket.
   */
  streamUrl?: () => Promise<string> | string;
  /** The app's authenticated POST (cookies/tokens differ per realm). Used for presence reports (§51). */
  post?: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  /** Injection points for tests / non-browser hosts. */
  eventSourceFactory?: (path: string) => EventSource;
  now?: () => number;
  windowRef?: Window & typeof globalThis;
}

export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  status(): RealtimeStatus;
  onEvent(fn: RealtimeEventHandler): () => void;
  onReconcile(fn: ReconcileHandler): () => void;
  onStatus(fn: StatusHandler): () => void;
  /** §175: subscribe by channel vocabulary. Returns an unsubscribe (§172/§173: always call it on unmount). */
  subscribe(req: { channel: ChannelName; onEvent: RealtimeEventHandler }): () => void;
  /** Test/diagnostic hook: feed a raw frame as if the server sent it. */
  _ingest(frame: unknown): void;
}

export function createRealtimeClient(opts: RealtimeClientOptions = {}): RealtimeClient {
  const path = opts.streamPath ?? '/realtime/stream';
  const now = opts.now ?? Date.now;
  const win = opts.windowRef ?? (typeof window !== 'undefined' ? window : undefined);
  const mkES = opts.eventSourceFactory ?? ((p: string) => new EventSource(p, { withCredentials: true }));

  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let hiddenAt: number | null = null;
  let started = false;
  let listening = false;                       // window listeners are added ONCE per client, and do nothing while disconnected
  let generation = 0;                          // bumps on every open()/disconnect(): a late ticket for an old attempt opens nothing
  const sm = new ConnectionStateMachine();
  const tracker = new EventTracker();
  // §32: sequences are per ROOM; a multi-room stream labels each frame with its slot ('r0', 'r1' …), so one tracker per slot.
  const seqs = new Map<string, SequenceTracker>();
  const trackerFor = (slot: string) => { let t = seqs.get(slot); if (!t) { t = new SequenceTracker(); seqs.set(slot, t); } return t; };
  const baselineAll = (d: any) => {
    if (d.seqs && typeof d.seqs === 'object') for (const [slot, n] of Object.entries(d.seqs)) trackerFor(slot).baseline(n as number);
    else trackerFor('r0').baseline(d.seq);
  };
  let connectionId: string | null = null;
  const eventHandlers = new Set<RealtimeEventHandler>();
  const reconcileHandlers = new Set<ReconcileHandler>();
  const statusHandlers = new Set<StatusHandler>();

  const publishStatus = () => { for (const h of statusHandlers) { try { h(sm.status); } catch { /* handler */ } } };
  const reconcile = (reason: string) => { for (const h of reconcileHandlers) { try { h(reason); } catch { /* handler */ } } };
  const dispatch = (d: RealtimeDetail) => { for (const h of eventHandlers) { try { h(d); } catch { /* handler */ } } };
  const reportPresence = (state: 'ONLINE' | 'AWAY') => {
    if (!connectionId || !opts.post) return;
    opts.post('/realtime/presence', { connectionId, state }).catch(() => { /* best-effort, server-throttled (§153) */ });
  };

  function ingest(frame: unknown): void {
    const d = frame as any;
    if (!d || !d.event || d.event === 'ping') return;
    if (d.event === 'resync_required') { baselineAll(d); reconcile(d.reason === 'slow_client' ? 'slow_client' : 'sequence_gap'); return; }   // §33/§36/§102
    if (d.event === 'connected') { baselineAll(d); return; }
    // Graceful gateway shutdown: the instance is going away and asked us to move NOW, spread over `jitterMs` so the
    // surviving instances do not receive the whole fleet at once. Reopen then reconciles as usual (§34–36).
    if (d.event === 'reconnect_requested') {
      const jitter = typeof d.jitterMs === 'number' && d.jitterMs >= 0 ? Math.floor(Math.random() * d.jitterMs) : 0;
      if (es) { try { es.close(); } catch { /* noop */ } es = null; }
      sm.errored(); publishStatus();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(open, jitter);
      return;
    }
    if (d.event === 'presence_registered') { connectionId = typeof d.connectionId === 'string' ? d.connectionId : null; return; }   // Phase 14
    const seqState = trackerFor(typeof d.stream === 'string' ? d.stream : 'r0').observe(d.seq);   // §31–33, per slot
    if (seqState === 'gap') reconcile('sequence_gap');
    if (seqState === 'duplicate') return;
    const env = d.payload && typeof d.payload === 'object' ? (d.payload as any) : {};
    // §29/§30/§183 duplicates + envelope versions; §43 (Oct 28 2026): the projected resourceVersion the server has sent since Oct 21
    // was never read, so a late older frame still triggered a repaint — now a strictly older one is dropped
    if (!tracker.shouldApply({ eventId: env.eventId, resourceType: env.resourceType ?? undefined, resourceId: env.resourceId ?? undefined, version: env.version, resourceVersion: typeof env.resourceVersion === 'number' && env.resourceVersionSource === 'aggregate' ? env.resourceVersion : null })) return;
    dispatch({ event: d.event, screens: d.screens || screensToRefetch(d.event), payload: d.payload, ...(typeof d.stream === 'string' ? { stream: d.stream } : {}) });
  }

  function scheduleRetry(): void {
    const { retryInMs } = sm.errored();                                                    // §37 jittered backoff, owned here
    publishStatus();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(open, retryInMs);
  }

  function open(): void {
    if (es) { try { es.close(); } catch { /* dead */ } es = null; }
    if (!started) return;
    const gen = ++generation;
    if (!opts.streamUrl) { attach(path); return; }
    let resolved: Promise<string>;
    try { resolved = Promise.resolve(opts.streamUrl()); } catch (e) { resolved = Promise.reject(e); }
    resolved.then(
      (url) => { if (gen === generation && started) attach(url); },
      () => { if (gen === generation && started) scheduleRetry(); },
    );
  }

  function attach(url: string): void {
    try {
      es = mkES(url);
      es.onopen = () => {
        const { reconcile: owed } = sm.opened();
        publishStatus();
        if (owed) reconcile('reconnected');                                                  // §34–36: never assume nothing was missed
      };
      es.onmessage = (m: MessageEvent) => { try { ingest(JSON.parse(m.data)); } catch { /* malformed */ } };
      es.onerror = () => {
        try { es?.close(); } catch { /* noop */ }
        es = null;
        scheduleRetry();
      };
    } catch { es = null; }
  }

  return {
    connect() {
      if (started || !win) return;
      if (typeof (win as any).EventSource === 'undefined' && !opts.eventSourceFactory) return;    // SSR / jsdom → no-op
      started = true;
      if (!listening) {
        listening = true;
        // Phase 13: added once per client and inert while disconnected — after logout, a tab resume or the radio coming
        // back must not reopen a stream for a session that no longer exists.
        win.document?.addEventListener('visibilitychange', () => {                              // §163 wake / tab-resume
          if (!started) return;
          if (win.document.hidden) { hiddenAt = now(); reportPresence('AWAY'); return; }
          reportPresence('ONLINE');
          if (shouldRefreshOnVisible(hiddenAt, now())) { reconcile('tab-resumed'); if (retryTimer) clearTimeout(retryTimer); open(); }
          hiddenAt = null;
        });
        win.addEventListener('online', () => { if (!started) return; const { retryNow } = sm.networkOnline(); publishStatus(); if (retryNow) { if (retryTimer) clearTimeout(retryTimer); open(); } });
        win.addEventListener('offline', () => { if (!started) return; sm.networkOffline(); publishStatus(); });
      }
      open();
    },
    disconnect() {
      started = false;
      generation++;                                                                             // an in-flight ticket opens nothing
      if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
      if (es) { try { es.close(); } catch { /* noop */ } es = null; }
      connectionId = null;
    },
    status: () => sm.status,
    onEvent(fn) { eventHandlers.add(fn); return () => { eventHandlers.delete(fn); }; },
    onReconcile(fn) { reconcileHandlers.add(fn); return () => { reconcileHandlers.delete(fn); }; },
    onStatus(fn) { statusHandlers.add(fn); return () => { statusHandlers.delete(fn); }; },
    subscribe({ channel, onEvent }) {
      const names = new Set<string>(CHANNELS[channel] as readonly string[]);
      const h: RealtimeEventHandler = (d) => { if (names.has(d.event)) onEvent(d); };
      eventHandlers.add(h);
      return () => { eventHandlers.delete(h); };                                                // §173: no leak
    },
    _ingest: ingest,
  };
}

/**
 * §191–193 fallback polling. While the stream is not CONNECTED for longer than `graceMs`, call `poll` every
 * `intervalMs` (5–15 s per §191 — never 500 ms); stop the moment the stream is CONNECTED again (§193).
 * `onStateChange(true)` lets the UI show "Live updates unavailable — refreshing periodically" (§192).
 */
export class FallbackPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private downSince: number | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly poll: () => void,
    private readonly opts: { intervalMs?: number; graceMs?: number; onStateChange?: (polling: boolean) => void; now?: () => number } = {},
  ) {
    const i = opts.intervalMs ?? 10_000;
    if (i < 5_000) throw new Error('§191: fallback polling interval must be ≥ 5s');
  }
  get polling(): boolean { return this.timer !== null; }
  /** Feed every status change. */
  onStatus(status: RealtimeStatus): void {
    if (status === 'CONNECTED') { this.stop(); this.downSince = null; return; }
    if (this.downSince === null) {
      this.downSince = (this.opts.now ?? Date.now)();
      this.armTimer = setTimeout(() => this.start(), this.opts.graceMs ?? 15_000);       // a brief blip never starts polling
    }
  }
  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(this.poll, this.opts.intervalMs ?? 10_000);
    this.opts.onStateChange?.(true);
    this.poll();
  }
  /** Stop polling AND disarm a pending grace timer — safe to call on unmount at any point (§173: no leak). */
  stop(): void {
    if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
    if (!this.timer) return;
    clearInterval(this.timer); this.timer = null;
    this.opts.onStateChange?.(false);
  }
}
