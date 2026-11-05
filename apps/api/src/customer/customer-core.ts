// customer-core.ts — pure customer-app helpers (no I/O). Loyalty tier/progress, service progress, and home assembly.
import type { LoyaltyTierConfig, CustomerLoyaltySummary, CustomerHome, CustomerNextAppointment } from './customer.dto';

export function loyaltySummary(points: number, tiers: LoyaltyTierConfig[]): CustomerLoyaltySummary {
  const pts = Math.max(0, Math.floor(Number.isFinite(points) ? points : 0));
  const sorted = [...(tiers || [])].sort((a, b) => a.threshold - b.threshold);
  if (sorted.length === 0) return { points: pts, tier: 'Regular', nextTier: null, pointsToNextTier: 0, progressPercent: 100 };

  let current = (pts < sorted[0].threshold) ? { tier: 'Regular', threshold: 0 } : sorted[0];
  let next: LoyaltyTierConfig | null = (pts < sorted[0].threshold) ? sorted[0] : null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].threshold <= pts) { current = sorted[i]; next = sorted[i + 1] ?? null; }
  }
  if (!next) return { points: pts, tier: current.tier, nextTier: null, pointsToNextTier: 0, progressPercent: 100 };
  const span = next.threshold - current.threshold;
  const into = pts - current.threshold;
  const progressPercent = span > 0 ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 100;
  return { points: pts, tier: current.tier, nextTier: next.tier, pointsToNextTier: Math.max(0, next.threshold - pts), progressPercent };
}

export interface ServiceProgress { elapsedSeconds: number; progressPercent: number; estimatedFinishTime: string | null }
export function serviceProgress(startedAtIso: string, durationMinutes: number, nowMs: number = Date.now()): ServiceProgress {
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return { elapsedSeconds: 0, progressPercent: 0, estimatedFinishTime: null };
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  const totalSeconds = Math.max(0, Math.round((durationMinutes || 0) * 60));
  const progressPercent = totalSeconds > 0 ? Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalSeconds) * 100))) : 0;
  const estimatedFinishTime = totalSeconds > 0 ? new Date(started + totalSeconds * 1000).toISOString() : null;
  return { elapsedSeconds, progressPercent, estimatedFinishTime };
}

export interface ActiveServiceRaw { ticketId: string; serviceName: string; status: string; startedAt: string; durationMinutes: number }
export interface CustomerHomeInput {
  customerName: string; avatarUrl?: string | null; points: number; tiers: LoyaltyTierConfig[];
  nextAppointment?: CustomerNextAppointment; activeService?: ActiveServiceRaw; recentVisitsCount: number; nowMs?: number;
}
export function buildCustomerHome(i: CustomerHomeInput): CustomerHome {
  const loyalty = loyaltySummary(i.points, i.tiers);
  let activeService;
  if (i.activeService) {
    const p = serviceProgress(i.activeService.startedAt, i.activeService.durationMinutes, i.nowMs);
    activeService = {
      ticketId: i.activeService.ticketId, serviceName: i.activeService.serviceName, status: i.activeService.status,
      startedAt: i.activeService.startedAt, elapsedSeconds: p.elapsedSeconds, progressPercent: p.progressPercent, estimatedFinishTime: p.estimatedFinishTime,
    };
  }
  return { customerName: i.customerName, avatarUrl: i.avatarUrl, loyalty, nextAppointment: i.nextAppointment, activeService, recentVisitsCount: i.recentVisitsCount };
}
