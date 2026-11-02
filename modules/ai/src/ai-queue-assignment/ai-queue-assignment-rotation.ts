// ai-queue-assignment-rotation.ts — PURE tenant/branch-configurable rotation. Given a policy and the eligible
// candidates (already enriched with real workload from tech-queue), it computes each candidate's effective
// rotationIndex (0 = most "up next"), which the engine then folds in as an additive term. This never overrides hard
// eligibility — it only orders eligible technicians. Deterministic + fully unit-testable.
export type RotationPolicy = 'hybrid' | 'least_minutes' | 'least_customers' | 'first_available' | 'fixed_order';
export const ROTATION_POLICIES: RotationPolicy[] = ['hybrid', 'least_minutes', 'least_customers', 'first_available', 'fixed_order'];

export interface RotationCandidate {
  technicianId: string;
  assignedMinutes: number | null;   // from tech-queue estimatedWorkloadMinutes
  activeAssignments: number;
  availableInMinutes: number | null;
  fixedRotationIndex: number | null; // tech-queue rotationPosition when the branch runs a fixed turn order
}

const num = (v: number | null, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);

/** BUILD_PLAN Phase 6 (audit "rotation: fixed-order gets no data"): the salon's fixed turn order comes from the settings
 *  port, and the turn moves on from whoever was served last — the list is rotated to start AFTER that technician. */
export interface RotationContext { fixedOrder?: string[] | null; lastServedTechnicianId?: string | null }

export function fixedOrderPositions(fixedOrder: string[], lastServedTechnicianId: string | null | undefined): Record<string, number> {
  const list = [...new Set(fixedOrder.filter((x) => typeof x === 'string' && x))];
  const at = lastServedTechnicianId ? list.indexOf(lastServedTechnicianId) : -1;
  const rotated = at >= 0 ? [...list.slice(at + 1), ...list.slice(0, at + 1)] : list;
  const out: Record<string, number> = {};
  rotated.forEach((id, i) => { out[id] = i; });
  return out;
}

// Returns technicianId → effective rotationIndex (0-based). Ties keep input order (stable).
export function computeRotation(policy: RotationPolicy, candidates: RotationCandidate[], rc: RotationContext = {}): Record<string, number> {
  const idx = candidates.map((c, i) => ({ c, i }));
  let ordered: { c: RotationCandidate; i: number }[];
  switch (policy) {
    case 'least_minutes':
      ordered = [...idx].sort((a, b) => num(a.c.assignedMinutes, 0) - num(b.c.assignedMinutes, 0) || a.i - b.i);
      break;
    case 'least_customers':
      ordered = [...idx].sort((a, b) => a.c.activeAssignments - b.c.activeAssignments || a.i - b.i);
      break;
    case 'first_available':
      ordered = [...idx].sort((a, b) => num(a.c.availableInMinutes, 1e9) - num(b.c.availableInMinutes, 1e9) || a.i - b.i);
      break;
    case 'fixed_order': {
      // The configured list first (rotated past the last served), then anyone not on it by the queue's own turn index.
      const pos = rc.fixedOrder?.length ? fixedOrderPositions(rc.fixedOrder, rc.lastServedTechnicianId) : {};
      const key = (c: RotationCandidate) => (c.technicianId in pos ? pos[c.technicianId] : 1e6 + num(c.fixedRotationIndex, 1e6));
      ordered = [...idx].sort((a, b) => key(a.c) - key(b.c) || a.i - b.i);
      break;
    }
    case 'hybrid':
    default:
      // Balance minutes + customer count so neither a single long service nor a single short one skews it.
      ordered = [...idx].sort((a, b) => {
        const am = num(a.c.assignedMinutes, 0) + a.c.activeAssignments * 20;
        const bm = num(b.c.assignedMinutes, 0) + b.c.activeAssignments * 20;
        return am - bm || a.i - b.i;
      });
      break;
  }
  const out: Record<string, number> = {};
  ordered.forEach((o, rank) => { out[o.c.technicianId] = rank; });
  return out;
}
