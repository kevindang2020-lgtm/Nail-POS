// communications-templates-core.ts — pure helpers for message-template placeholders (§25). Placeholders use {{name}}
// syntax. Names must be safe identifiers; anything else is rejected (no template injection). Preview rendering
// HTML-escapes substituted values so untrusted content can never inject markup.
export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const SAFE_NAME = /^[a-zA-Z0-9_]{1,40}$/;

/** Distinct placeholder names referenced in a template body/subject. */
export function extractPlaceholders(...parts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const p of parts) { if (!p) continue; let m: RegExpExecArray | null; PLACEHOLDER_RE.lastIndex = 0; while ((m = PLACEHOLDER_RE.exec(p))) found.add(m[1]); }
  return [...found];
}

/** Validate a template body: every `{{...}}` must be a safe identifier, and braces must be balanced (no injection). */
export function validateTemplate(...parts: (string | null | undefined)[]): { ok: boolean; error?: string; placeholders: string[] } {
  const joined = parts.filter(Boolean).join('\n');
  // Reject stray/unbalanced braces that aren't valid placeholders (e.g. "{{" without close, or "{% ... %}").
  const stripped = joined.replace(PLACEHOLDER_RE, '');
  if (/\{\{|\}\}/.test(stripped)) return { ok: false, error: 'malformed or unbalanced placeholder braces', placeholders: [] };
  if (/\{%|%\}|<%|%>|\$\{/.test(joined)) return { ok: false, error: 'unsupported template syntax', placeholders: [] };
  const placeholders = extractPlaceholders(...parts);
  const bad = placeholders.filter((n) => !SAFE_NAME.test(n));
  if (bad.length) return { ok: false, error: `invalid placeholder name(s): ${bad.join(', ')}`, placeholders };
  return { ok: true, placeholders };
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Safe preview: substitute placeholders with HTML-escaped sample values; unknown placeholders left as a visible tag. */
export function renderPreview(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (_, name: string) => (name in values ? escapeHtml(String(values[name])) : `[${name}]`));
}
