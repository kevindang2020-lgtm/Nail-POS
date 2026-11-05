// ai-queue-assignment-auto.ts — PURE auto-assignment safeguards. Auto-assignment is a high-trust action, so it only
// fires when EVERY guard passes. This function decides, for one recommendation envelope, whether the system may
// auto-assign — it never assigns anything itself. The caller (service) still routes the actual assignment through the
// queue's own assignTechnician action (with its own guards), and only when enabled + within the per-run cap.
import type { RecommendationEnvelope } from './ai-queue-assignment.dto';

export interface AutoAssignConfig {
  enabled: boolean;             // OFF by default — must be explicitly opted into
  confidenceFloor: number;      // minimum confidence to auto-assign (default 0.75)
  maxPerRun: number;            // cap on assignments per run (default 5)
}
export const DEFAULT_AUTO_CONFIG: AutoAssignConfig = { enabled: false, confidenceFloor: 0.75, maxPerRun: 5 };

export interface AutoAssignDecision { assign: boolean; technicianId: string | null; reason: string; }

// A recommendation may be auto-assigned ONLY when: auto is enabled; there is a recommended, eligible technician; the
// required action is 'assignable' (no staff_review); confidence meets the floor; and there are no warnings/conflicts.
export function autoAssignDecision(env: RecommendationEnvelope, cfg: AutoAssignConfig): AutoAssignDecision {
  if (!cfg.enabled) return { assign: false, technicianId: null, reason: 'auto_assignment_disabled' };
  if (!env.recommended) return { assign: false, technicianId: null, reason: 'no_eligible_technician' };
  if (env.requiredAction !== 'assignable') return { assign: false, technicianId: null, reason: `requires_${env.requiredAction}` };
  if (env.warnings.length > 0) return { assign: false, technicianId: null, reason: 'has_warnings' };
  if (env.conflicts.length > 0) return { assign: false, technicianId: null, reason: 'has_conflicts' };
  if (env.confidence < cfg.confidenceFloor) return { assign: false, technicianId: null, reason: 'below_confidence_floor' };
  return { assign: true, technicianId: env.recommended.technicianId, reason: 'safeguards_passed' };
}
