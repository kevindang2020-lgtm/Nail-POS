// service-revenue.ts — the ONE service-revenue calculation shared by Daily Summary "Revenue by Service" and the Services
// Report (SUNMI batch 9 guide 2, Nov 10 2026). Pure: the repository hands it the period's paid tickets and their lines.
//
// Definitions (frozen; shown on the screen):
//  · basis: the period's paid tickets (payment recorded on a salon day in the period — the Daily Summary basis)
//  · a service line = a ticket_service_lines row that is not removed and not retail; its amount is its RECORDED line total
//    (historical price, never today's catalog price) and its name / category are the snapshots taken at the sale
//  · units = the line's quantity (1 when unrecorded) — not tickets, not appointments, not payments
//  · a multi-service ticket splits by its own lines; a line is counted once whatever technicians or tenders it had
//  · tax, tips and card surcharge are never service revenue; discounts and refunds are recorded per TICKET, not per line,
//    so they are reported beside the lines for those tickets and never spread over services by a made-up rule
//  · a paid ticket with no service line keeps its sales under "No service lines recorded" so the categories add up to
//    the Service Sales card (and the health check counts it)
export interface ServiceLineFact {
  id: string; ticketId: string; ticketNumber: string | null; occurredAt: string; serviceId: string | null; serviceName: string;
  category: string; technicianId: string | null; technician: string; customerId: string | null; customer: string;
  units: number; grossCents: number; unmapped: boolean; noLines?: boolean;
  /** search only — never sent to the screen */
  phoneDigits?: string;
}
export interface ServiceRevenueCategory { key: string; name: string; units: number; grossCents: number; lines: number; percentOfTop: number; unmapped: boolean }
export interface ServiceRevenueTotals { grossCents: number; units: number; lines: number; tickets: number; averageCents: number | null; ticketDiscountCents: number; refundedCents: number }

export const NO_LINES = '__no_lines__';
export const UNMAPPED = '__unmapped__';

/** categories, revenue-desc with a stable tie-break (name, then key) */
export function rankCategories(lines: ServiceLineFact[]): ServiceRevenueCategory[] {
  const m = new Map<string, ServiceRevenueCategory>();
  for (const l of lines) {
    const key = l.noLines ? NO_LINES : l.unmapped ? UNMAPPED : l.category;
    const c = m.get(key) ?? { key, name: l.noLines ? '' : l.unmapped ? '' : l.category, units: 0, grossCents: 0, lines: 0, percentOfTop: 0, unmapped: !!(l.unmapped || l.noLines) };
    c.units += l.units; c.grossCents += l.grossCents; c.lines += 1; m.set(key, c);
  }
  const out = [...m.values()].sort((a, b) => b.grossCents - a.grossCents || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const top = out[0]?.grossCents || 0;
  for (const c of out) c.percentOfTop = top > 0 ? Math.round((c.grossCents / top) * 100) : 0;
  return out;
}

export function totalsOf(lines: ServiceLineFact[], discountByTicket: Record<string, number>, refundByTicket: Record<string, number>): ServiceRevenueTotals {
  const tickets = [...new Set(lines.map((l) => l.ticketId))];
  const grossCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const units = lines.reduce((s, l) => s + l.units, 0);
  return {
    grossCents, units, lines: lines.length, tickets: tickets.length,
    averageCents: units > 0 ? Math.round(grossCents / units) : null,
    ticketDiscountCents: tickets.reduce((s, t) => s + (discountByTicket[t] || 0), 0),
    refundedCents: tickets.reduce((s, t) => s + (refundByTicket[t] || 0), 0),
  };
}

const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** search: service / category / service id / technician / customer / ticket # or id; ≥4 digits also match the customer's phone
 *  (formatted or not) and ticket numbers. `canSeeCustomers=false` never matches on a customer. */
export function matchLine(l: ServiceLineFact, q: string, canSeeCustomers: boolean): boolean {
  const needle = fold(q).trim();
  if (!needle) return true;
  const fields = [l.serviceName, l.category, l.serviceId, l.technician, l.ticketNumber, l.ticketId, ...(canSeeCustomers ? [l.customer] : [])];
  if (fields.some((v) => fold(v).includes(needle))) return true;
  const digits = needle.replace(/\D/g, '');
  if (digits.length < 4) return false;
  if (String(l.ticketNumber ?? '').replace(/\D/g, '') === digits) return true;
  return canSeeCustomers && !!l.phoneDigits && l.phoneDigits.endsWith(digits.length > 10 ? digits.slice(-10) : digits);
}

/** newest first by recorded payment time, then line id (immutable) — no duplicates or gaps across pages */
export function newestFirst(a: ServiceLineFact, b: ServiceLineFact): number {
  return a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// ── batch 9 guide 6 (Nov 10 2026): technician attribution from the same lines ─────────────────────────────────────────────
// Each technician owns ONLY the service lines assigned to them (a helper never inherits the primary technician's other
// services, and a line is never counted twice). Revenue = their lines' recorded amounts (sales before discounts — no tax,
// tips, surcharge or retail); services = units; tickets = distinct tickets they worked on. A line with no technician and
// a paid ticket with no lines stay visible as their own rows, so the leaderboard adds up to Service Sales.
export const UNASSIGNED = '__unassigned__';
export interface TechnicianRank { technicianId: string; rank: number; name: string; roleLabel: string; revenueCents: number; completedServices: number; tickets: number; unattributed: boolean }
export const techKeyOf = (l: ServiceLineFact) => (l.noLines ? NO_LINES : l.technicianId || UNASSIGNED);
export function rankTechnicians(lines: ServiceLineFact[]): TechnicianRank[] {
  const m = new Map<string, TechnicianRank & { t: Set<string> }>();
  for (const l of lines) {
    const k = techKeyOf(l);
    const r = m.get(k) ?? { technicianId: k, rank: 0, name: k === NO_LINES || k === UNASSIGNED ? '' : l.technician, roleLabel: 'Technician', revenueCents: 0, completedServices: 0, tickets: 0, unattributed: k === NO_LINES || k === UNASSIGNED, t: new Set<string>() };
    r.revenueCents += l.grossCents; r.completedServices += l.units; r.t.add(l.ticketId); m.set(k, r);
  }
  // named technicians first by revenue (stable: name, id); the unattributed buckets after them
  const out = [...m.values()].map(({ t, ...r }) => ({ ...r, tickets: t.size }))
    .sort((a, b) => Number(a.unattributed) - Number(b.unattributed) || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId));
  let n = 0; for (const r of out) r.rank = r.unattributed ? 0 : ++n;
  return out;
}

// ── batch 9 guide 10 (Nov 10 2026): the same lines ranked by SERVICE (historical id, else its recorded name) ────────────────
export const svcKeyOf = (l: ServiceLineFact) => (l.noLines ? NO_LINES : l.serviceId ? 'id:' + l.serviceId : 'name:' + l.serviceName.toLowerCase());
export function rankServices(lines: ServiceLineFact[]): ServiceRevenueCategory[] {
  const m = new Map<string, ServiceRevenueCategory & { names: Map<string, number> }>();
  for (const l of lines) {
    const key = svcKeyOf(l);
    const c = m.get(key) ?? { key, name: '', units: 0, grossCents: 0, lines: 0, percentOfTop: 0, unmapped: !!l.noLines, names: new Map<string, number>() };
    c.units += l.units; c.grossCents += l.grossCents; c.lines += 1;
    if (!l.noLines) c.names.set(l.serviceName, (c.names.get(l.serviceName) ?? 0) + 1);
    m.set(key, c);
  }
  // a renamed service keeps one row (its id); it shows the name it was sold under most often in the period
  const out = [...m.values()].map(({ names, ...c }) => ({ ...c, name: [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '' }))
    .sort((a, b) => Number(a.unmapped) - Number(b.unmapped) || b.grossCents - a.grossCents || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const top = out.find((c) => !c.unmapped)?.grossCents || 0;
  for (const c of out) c.percentOfTop = top > 0 ? Math.round((c.grossCents / top) * 100) : 0;
  return out;
}
export const uniqueServices = (lines: ServiceLineFact[]) => new Set(lines.filter((l) => !l.noLines).map(svcKeyOf)).size;
