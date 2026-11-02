// Canonical technician recommendation + eligibility — the single source of truth shared by Customer Queue
// (Best Match, assign preview) and Tech Queue (reassign). Pure and unit-testable; no DB access here so the same
// scoring runs in the repo (Best Match column) and in the services (assignment validation) without diverging.
//
// Honesty boundary: this scores from signals we actually have — skill coverage, availability, current active
// workload, requested-technician preference, and previous-technician history. Rotation position, overtime risk,
// and upcoming-appointment conflicts are part of the broader spec but are NOT fabricated here; when the inputs
// for those are wired they can be added as additional weighted terms.

export interface RecoTech {
  technicianId: string;
  name: string;
  available: boolean;
  skills: string[];          // service categories this tech can perform
  activeLoad?: number;       // current active queue/serving assignments (lower is better)
  isRequested?: boolean;     // matches the guest's requested technician
  isPrevious?: boolean;      // served this guest before
}

export interface RecoScored {
  technicianId: string;
  name: string;
  eligible: boolean;
  skillMatch: boolean;
  score: number;
  reasons: string[];
}

export interface RecoResult {
  best?: RecoScored;
  alternatives: RecoScored[];
  all: RecoScored[];
}

// Skill gate (skill-only) — every required service category must be covered. Shared verbatim with the
// assignment services so their "not skilled for the requested services" rule can never drift.
export function skillMatch(skills: string[], requiredCategories: string[]): boolean {
  const have = new Set(skills || []);
  return (requiredCategories || []).every((c) => have.has(c));
}

// Full eligibility = available AND skill-matched. Used to gate recommendations (assignment still allows a
// documented manager override, which is handled by the caller, not here).
export function isEligible(tech: RecoTech, requiredCategories: string[]): boolean {
  return !!tech.available && skillMatch(tech.skills, requiredCategories);
}

const W = { skill: 50, requested: 30, previous: 15, available: 20, loadPenalty: 5 } as const;

// Transparent weighted score. Only eligible techs can be "best"; ineligible techs still get a score/reasons so a
// manager-override UI can show why they ranked low.
export function scoreTechnician(tech: RecoTech, requiredCategories: string[]): RecoScored {
  const sm = skillMatch(tech.skills, requiredCategories);
  const eligible = sm && !!tech.available;
  const reasons: string[] = [];
  let score = 0;
  if (sm) { score += W.skill; reasons.push('Skill match'); } else { reasons.push('Missing required skill'); }
  if (tech.available) { score += W.available; } else { reasons.push('Not available'); }
  if (tech.isRequested) { score += W.requested; reasons.push('Requested by guest'); }
  if (tech.isPrevious) { score += W.previous; reasons.push('Served this guest before'); }
  const load = Math.max(0, tech.activeLoad || 0);
  if (load > 0) { score -= load * W.loadPenalty; reasons.push(`${load} active ${load === 1 ? 'assignment' : 'assignments'}`); }
  return { technicianId: tech.technicianId, name: tech.name, eligible, skillMatch: sm, score, reasons };
}

// Recommend the best eligible technician; alternatives are the next-best eligible options.
export function recommendTechnician(techs: RecoTech[], requiredCategories: string[]): RecoResult {
  const all = (techs || []).map((t) => scoreTechnician(t, requiredCategories)).sort((a, b) => b.score - a.score);
  const eligible = all.filter((t) => t.eligible);
  const [best, ...alts] = eligible;
  return { best, alternatives: alts.slice(0, 3), all };
}
