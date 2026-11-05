// realtime-health.ts — Constitution 9 §143/§147: one health verdict for the gateway, computed from the counters
// the gateway already keeps. Pure so the thresholds are testable; the Super Admin System Operations → Realtime
// screen renders exactly this.
//
// §141: "Do not promise target before testing." The thresholds below are INCIDENT thresholds — the point at which
// an operator should look — not SLOs. They were chosen so that a healthy salon fleet never trips them and a real
// storm trips them within a minute; tune them from production numbers, never from a spec.
export interface RealtimeHealthInput {
  activeConnections: number;
  reconnectsPerMinute: number;
  authFailuresPerMinute: number;
  latencyP95Ms: number | null;
  eventsPerMinute: number;
  backbone: 'in-process' | 'redis';
  backbonePublishFailures: number;
  slowClientDisconnects: number;
}
export type RealtimeStatus = 'OPERATIONAL' | 'IDLE' | 'DEGRADED' | 'INCIDENT';
export interface RealtimeHealth { status: RealtimeStatus; signals: string[] }

export const THRESHOLDS = {
  reconnectStormPerMinute: 60,      // §38/§147 "reconnect storm": a fleet reopening after a blip is ~1 per device
  authFailureSpikePerMinute: 30,    // §147 "cross-tenant subscription attempt spike" / origin abuse
  lagDegradedMs: 3_000,             // §147 "queue event lag" — a queue screen more than 3s behind is noticed at the desk
  lagIncidentMs: 15_000,
  publishFailuresIncident: 5,       // §147 "Redis backbone outage": repeated publish failures, local-only delivery
};

export function evaluateRealtimeHealth(i: RealtimeHealthInput): RealtimeHealth {
  const signals: string[] = [];
  let worst: RealtimeStatus = i.activeConnections === 0 && i.eventsPerMinute === 0 ? 'IDLE' : 'OPERATIONAL';
  const raise = (to: RealtimeStatus, s: string) => { signals.push(s); if (rank(to) > rank(worst)) worst = to; };
  if (i.backbone === 'redis' && i.backbonePublishFailures >= THRESHOLDS.publishFailuresIncident)
    raise('INCIDENT', `redis backbone: ${i.backbonePublishFailures} publish failures (delivery is local-only until it recovers)`);
  if (i.reconnectsPerMinute >= THRESHOLDS.reconnectStormPerMinute)
    raise('DEGRADED', `reconnect storm: ${i.reconnectsPerMinute}/min`);
  if (i.authFailuresPerMinute >= THRESHOLDS.authFailureSpikePerMinute)
    raise('DEGRADED', `auth/origin failure spike: ${i.authFailuresPerMinute}/min`);
  if (i.latencyP95Ms != null && i.latencyP95Ms >= THRESHOLDS.lagIncidentMs)
    raise('INCIDENT', `event lag p95 ${i.latencyP95Ms}ms`);
  else if (i.latencyP95Ms != null && i.latencyP95Ms >= THRESHOLDS.lagDegradedMs)
    raise('DEGRADED', `event lag p95 ${i.latencyP95Ms}ms`);
  if (i.slowClientDisconnects > 0) signals.push(`${i.slowClientDisconnects} slow client(s) disconnected`);   // informational
  return { status: worst, signals };
}
const rank = (s: RealtimeStatus) => ({ IDLE: 0, OPERATIONAL: 0, DEGRADED: 1, INCIDENT: 2 }[s]);
