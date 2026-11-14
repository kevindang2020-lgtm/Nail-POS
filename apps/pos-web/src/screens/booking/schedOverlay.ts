// schedOverlay.ts — the AI Scheduling Optimizer's calendar indicators (GET /pos/ai-scheduling-optimizer/calendar?date=)
// turned into the new Booking Schedule Board's read-only overlay. The marks are the Classic board's: a lock on an
// appointment the optimizer may not move, an outline for an open conflict (worst severity wins), an "AI" badge that
// opens the open suggestion in the optimizer, and a thin strip for each unused gap. Nothing here writes anything.
import type { BoardOverlay, AppointmentMarks, OverlayGap } from '@aipowersalon/booking-schedule-board';
import type { SchedCalendarIndicators, SchedConflict } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../../i18n/status-label';

const RANK: Record<SchedConflict['severity'], number> = { info: 1, warning: 2, critical: 3 };
const hhmm = (s: string): number | null => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function schedToBoardOverlay(
  ind: SchedCalendarIndicators | null,
  names: { customerNameOf: (appointmentId: string) => string },
  onOpenRec: ((recommendationId: string) => void) | null,
): BoardOverlay | null {
  if (!ind) return null;
  const appointments: Record<string, AppointmentMarks> = {};
  const mark = (id: string) => (appointments[id] ??= {});
  for (const c of ind.conflicts ?? []) {
    if (c.resolved) continue;
    for (const id of c.appointmentIds) { const m = mark(id); if (!m.conflict || RANK[c.severity] > RANK[m.conflict]) m.conflict = c.severity; }
  }
  for (const [id, a] of Object.entries(ind.appointments ?? {})) {
    const m = mark(id);
    if (a.locked) m.locked = { title: tx('pos.locked_the_ai_optimizer_will_not_2smd') };
    if (onOpenRec && a.recommendationId) {
      m.badge = {
        label: 'AI',
        title: tx('pos.ai_optimizer_suggestion_v0_v1_open_l8q9', { v0: statusLabel('aiSuggestion', a.type), v1: statusLabel('aiSuggestion', a.status) }),
        ariaLabel: tx('pos.open_the_ai_optimizer_suggestion_for_1gkj', { customerName: names.customerNameOf(id) }),
        onOpen: () => onOpenRec(a.recommendationId),
      };
    }
  }
  const gaps: OverlayGap[] = [];
  for (const g of ind.gaps ?? []) {
    const s = hhmm(g.startTime), e = hhmm(g.endTime);
    if (!g.technicianId || s == null || e == null || e <= s) continue;
    gaps.push({
      id: g.id, technicianId: g.technicianId, startMinute: s, endMinute: e,
      title: tx('pos.ai_optimizer_durationmin_min_unused_v1', { durationMin: String(g.durationMin), v1: g.servicesThatFit.length ? tx('pos.fits_v0', { v0: g.servicesThatFit.join(', ') }) : '' }),
    });
  }
  return { appointments, gaps };
}
