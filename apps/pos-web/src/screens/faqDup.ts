// FAQ Duplicate Warning (backlog AI BUSINESS SETUP · 06): before a new FAQ is saved, show existing questions that ask the
// same thing (same words in any order, or most words shared). A warning only — the manager can still save.
const STOP = new Set(['the', 'a', 'an', 'do', 'does', 'is', 'are', 'you', 'your', 'i', 'can', 'to', 'of', 'for', 'what', 'how', 'when', 'we', 'my', 'in', 'on', 'at']);
export const faqWords = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
export function similarFaqs<T extends { id: string; question: string; status?: string }>(question: string, items: T[], max = 3): T[] {
  const a = faqWords(question); if (a.size < 2) return [];
  return items.filter((x) => {
    if (x.status === 'archived') return false;
    const b = faqWords(x.question); if (!b.size) return false;
    let n = 0; for (const w of a) if (b.has(w)) n++;
    return n / (a.size + b.size - n) >= 0.5;
  }).slice(0, max);
}
