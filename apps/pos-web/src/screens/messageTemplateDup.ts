// Duplicate Template Detection (backlog MESSAGE TEMPLATES · 11): warn — never block — when a new draft is
// near-identical to a template the user can already see on the same channel. The list API returns
// bodyPreview (first 160 chars), so a long template is compared on that prefix.
import type { MtRow } from '../api/posMessageTemplatesApi';

export const PREVIEW_LEN = 160;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}{}\[\]_ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}
export interface DupHit { id: string; name: string; reason: 'name' | 'body' }
export function similarTemplates(draft: { name: string; channel: string; body: string }, rows: MtRow[], max = 3): DupHit[] {
  const name = draft.name.trim().toLowerCase(); const body = norm(draft.body);
  const out: DupHit[] = [];
  for (const r of rows) {
    if (r.channel !== draft.channel || r.status === 'archived') continue;
    if (name && r.name.trim().toLowerCase() === name) { out.push({ id: r.id, name: r.name, reason: 'name' }); continue; }
    if (body.length < 12) continue;
    const prev = norm(r.bodyPreview);
    const truncated = r.bodyPreview.length >= PREVIEW_LEN;
    const cmp = truncated ? body.slice(0, prev.length) : body;
    if (cmp === prev || jaccard(words(cmp), words(prev)) >= 0.9) out.push({ id: r.id, name: r.name, reason: 'body' });
  }
  return out.slice(0, max);
}
