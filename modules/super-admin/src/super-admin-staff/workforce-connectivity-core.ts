// Pure logic for technician-app connectivity (§21/§34), derived from real device_push_tokens heartbeats
// (last_seen_at). No DB/Nest deps. A stale heartbeat is "disconnected", never silently treated as available.

export const CONNECTIVITY_WINDOW_MIN = 15; // a technician "connected" if their latest token was seen within this window
export type ConnectivityStatus = 'connected' | 'disconnected' | 'unknown';

// no token at all → unknown; recent heartbeat → connected; stale heartbeat → disconnected.
export function classifyConnectivity(lastSeenIso: string | null, hasToken: boolean, nowMs: number, windowMinutes = CONNECTIVITY_WINDOW_MIN): ConnectivityStatus {
  if (!hasToken) return 'unknown';
  if (!lastSeenIso) return 'disconnected';
  const t = Date.parse(lastSeenIso);
  if (Number.isNaN(t)) return 'disconnected';
  return nowMs - t <= windowMinutes * 60 * 1000 ? 'connected' : 'disconnected';
}

export interface ConnectivityRow { status: ConnectivityStatus }
export interface ConnectivitySummary { total: number; connected: number; disconnected: number; unknown: number; connectedRate: number | null; configured: boolean }

// Reconciles counts over ALL technicians. connectedRate is over the total. `configured` is true only when at least one
// technician actually has a token (i.e. real heartbeat data exists); otherwise the caller should render an honest gap.
export function summarizeConnectivity(rows: ConnectivityRow[]): ConnectivitySummary {
  let connected = 0, disconnected = 0, unknown = 0;
  for (const r of rows || []) {
    if (r.status === 'connected') connected++;
    else if (r.status === 'disconnected') disconnected++;
    else unknown++;
  }
  const total = connected + disconnected + unknown;
  const withToken = connected + disconnected;
  const connectedRate = total > 0 ? Math.round((connected / total) * 1000) / 10 : null;
  return { total, connected, disconnected, unknown, connectedRate, configured: withToken > 0 };
}
