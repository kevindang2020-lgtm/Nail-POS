// Duplicate Service / Name Review (backlog SERVICE PRICING · 11): before a service is created or renamed, warn — never
// block, never merge — when the catalog already has a near-identical name (same words, or one or two letters apart).
export interface SvcLite { serviceId: string; serviceName: string; categoryName?: string | null }
export const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
export function similarServices(name: string, items: SvcLite[], excludeId?: string | null, max = 3): SvcLite[] {
  const n = normName(name); if (n.length < 3) return [];
  const sorted = n.split(' ').sort().join(' ');
  const cap = n.length >= 10 ? 2 : 1;
  return items.filter((s) => {
    if (excludeId && s.serviceId === excludeId) return false;
    const o = normName(s.serviceName); if (!o) return false;
    return o === n || o.split(' ').sort().join(' ') === sorted || distance(o, n, cap) <= cap;
  }).slice(0, max);
}
