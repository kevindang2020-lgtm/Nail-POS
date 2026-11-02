// ai-voice-transcription-search.ts — PURE helpers for transcript search. Search ALWAYS runs over redacted text +
// summaries/intents (never raw_text — raw is not indexed anywhere). These helpers keep the in-memory and SQL paths
// consistent for term parsing and snippet extraction.

// Split a query into lowercased terms (quoted phrases kept intact). Empty/short noise stripped.
export function parseTerms(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q || '')) !== null) {
    const t = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (t.length >= 2) terms.push(t);
  }
  return terms;
}

// True if every term appears somewhere in the haystack (AND semantics).
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  const h = (haystack || '').toLowerCase();
  return terms.every((t) => h.includes(t));
}

// Extract a short snippet around the first matching term, for display. Operates on redacted text only.
export function snippet(text: string, terms: string[], window = 60): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  if (idx < 0) return text.length <= window * 2 ? text : text.slice(0, window * 2) + '…';
  const start = Math.max(0, idx - window);
  const end = Math.min(text.length, idx + window);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
