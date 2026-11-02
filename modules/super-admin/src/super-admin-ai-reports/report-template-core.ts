// Pure logic for report templates + narrative GROUNDING. No DB/Nest deps. Two responsibilities: (1) template versioning
// rules, and (2) the anti-hallucination layer — a narrative may only contain numbers the run actually computed. Template
// text is treated as literal data (never executed / never interpreted as instructions), which is the prompt-injection-safe
// stance the spec requires. An actual LLM summarizer would be constrained to the grounded payload built here.

export interface TemplateSection { id: string; title: string; metricKeys: string[]; text?: string }

export function nextTemplateVersion(existingVersions: number[]): number {
  return (existingVersions && existingVersions.length ? Math.max(...existingVersions) : 0) + 1;
}
export function canPublishTemplate(status: string): boolean { return String(status || '').toLowerCase() === 'draft'; }
export function canArchiveTemplate(status: string): boolean { const s = String(status || '').toLowerCase(); return s === 'draft' || s === 'published'; }

export type SectionsResult = { ok: true; sections: TemplateSection[] } | { ok: false; reason: string };
export function validateTemplateSections(sections: unknown): SectionsResult {
  if (!Array.isArray(sections) || sections.length === 0) return { ok: false, reason: 'at least one section is required' };
  const out: TemplateSection[] = [];
  for (const s of sections) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) return { ok: false, reason: 'each section needs an id' };
    if (typeof s.title !== 'string' || !s.title.trim()) return { ok: false, reason: `section "${s.id}" needs a title` };
    if (!Array.isArray(s.metricKeys)) return { ok: false, reason: `section "${s.id}" needs metricKeys[]` };
    out.push({ id: s.id, title: s.title, metricKeys: s.metricKeys.map((k: unknown) => String(k)), text: typeof s.text === 'string' ? s.text : undefined });
  }
  return { ok: true, sections: out };
}

// Builds a grounded narrative payload: for each section, only metric keys PRESENT in the snapshot resolve; a referenced
// key that is missing renders as "—" with grounded:false — never a fabricated number. `allGrounded` is false if any
// referenced metric was unavailable, so a caller can mark the narrative partial rather than pretend completeness.
export interface GroundedLine { key: string; value: number | string | null; grounded: boolean }
export interface GroundedSection { id: string; title: string; lines: GroundedLine[] }
export function buildGroundedNarrative(sections: TemplateSection[], metrics: Record<string, unknown>): { sections: GroundedSection[]; allGrounded: boolean } {
  let allGrounded = true;
  const out = sections.map((sec) => ({
    id: sec.id, title: sec.title,
    lines: sec.metricKeys.map((key) => {
      const present = Object.prototype.hasOwnProperty.call(metrics || {}, key) && metrics[key] != null;
      if (!present) { allGrounded = false; return { key, value: '—', grounded: false }; }
      const v = metrics[key];
      return { key, value: (typeof v === 'number' || typeof v === 'string') ? v : String(v), grounded: true };
    }),
  }));
  return { sections: out, allGrounded };
}

// The anti-hallucination GATE. Extracts every number from a candidate narrative string and confirms each is one of the
// allowed values (the run's snapshot metrics). Any number not traceable to the snapshot is a grounding violation — this
// is what would reject an LLM summary that invented or altered a figure.
export function extractNumbers(text: string): number[] {
  const matches = String(text || '').match(/-?\d[\d,]*\.?\d*/g) || [];
  return matches.map((m) => Number(m.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}
export function validateNarrativeGrounding(text: string, allowedValues: number[]): { ok: true } | { ok: false; offending: number[] } {
  const allowed = new Set(allowedValues.map((v) => Number(v)));
  const offending = extractNumbers(text).filter((num) => !allowed.has(num));
  return offending.length === 0 ? { ok: true } : { ok: false, offending };
}
