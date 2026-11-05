// Pure logic for model/prompt versioning + narrative provenance. No DB/Nest deps. Deterministic prompt hashing, version
// status transitions, active-version resolution, and provenance assembly so every narrative is auditable.

// Deterministic djb2 hash of the prompt text → stable short hex. Same prompt ⇒ same hash (pins the exact prompt used).
export function promptHash(text: string): string {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `ph_${h.toString(16).padStart(8, '0')}`;
}

export const VERSION_TRANSITIONS: Record<string, string[]> = { draft: ['active', 'retired'], active: ['retired'], retired: [] };
export function canActivateVersion(status: string): boolean { return String(status || '').toLowerCase() === 'draft'; }
export function canVersionTransition(from: string, to: string): boolean { return (VERSION_TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase()); }

export interface ModelVersion { id: string; modelName: string; promptVersion: string; status: string }
// The single active version for a model name (latest-registered active wins if more than one somehow exists).
export function resolveActiveVersion(versions: ModelVersion[], modelName: string): ModelVersion | null {
  const active = (versions || []).filter((v) => v.modelName === modelName && String(v.status).toLowerCase() === 'active');
  return active.length ? active[active.length - 1] : null;
}

// Provenance fields for a narrative: ties the grounding outcome to the template + model version. grounding_ok means the
// narrative passed the anti-hallucination gate (no invented numbers); all_grounded means every referenced metric existed.
export interface GroundingOutcome { allGrounded: boolean; offendingCount: number }
export function buildProvenance(input: { templateId: string | null; templateVersion: number | null; modelVersionId: string | null; grounding: GroundingOutcome }): {
  templateId: string | null; templateVersion: number | null; modelVersionId: string | null; allGrounded: boolean; groundingOk: boolean; offendingCount: number;
} {
  const offending = Math.max(0, Math.round(input.grounding.offendingCount || 0));
  return { templateId: input.templateId, templateVersion: input.templateVersion, modelVersionId: input.modelVersionId, allGrounded: !!input.grounding.allGrounded, groundingOk: offending === 0, offendingCount: offending };
}
