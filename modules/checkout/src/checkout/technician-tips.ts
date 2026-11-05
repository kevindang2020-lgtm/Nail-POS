// technician-tips.ts — Individual Technician Tipping at Checkout (Split Tips guide, Nov 5 2026, G4). PURE money math
// (integer cents) shared by the customer display and its tests:
//
//   recipients  the technicians who PERFORMED the ticket's service lines (not who was booked), one card each, with the
//               service basis attributable to them: each service line's total, shared lines split by their recorded
//               share (ticket_service_line_allocations, basis points — never invented), the ticket discount spread over
//               all lines by size (largest remainder) — §4.1 / §4.3. Product / retail lines carry no tip basis.
//   tips        each technician's own choice: No Tip (explicit 0), a dollar preset or custom cents, or a percent of THAT
//               technician's basis — 20% of A's $40 and B's $60 is $8 + $12, never 20% of the whole ticket twice.
//   key         a fingerprint of performers + basis: a performer or price change makes an old selection stale (§4.1).

export interface TipLineInput {
  lineId: string; technicianId: string | null; technicianName?: string | null; serviceName: string;
  lineTotalCents: number; isProduct: boolean;
  /** shared service: who performed which share (basis points); empty = the line's technician alone */
  shares?: { technicianId: string; shareBps: number; name?: string | null }[];
}
export interface TipRecipient { technicianId: string; name: string; services: string[]; basisCents: number }
export type TechTipChoice = { technicianId: string; tipType: 'none' | 'percent' | 'custom'; percent?: number | null; amountCents?: number | null };
export interface TechTipResult { technicianId: string; tipType: 'none' | 'percent' | 'custom'; percent: number | null; tipCents: number }

const cents = (v: number) => Math.max(0, Math.round(Number(v) || 0));

/** split `total` over integer weights by largest remainder (exact: parts sum to total) */
export function splitByWeights(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) * total) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (left <= 0) break; out[o.i] += 1; left -= 1; }
  return out;
}

/** the eligible tip recipients with their attributable net service basis (§4.1, §4.3) */
export function tipRecipients(lines: TipLineInput[], ticketDiscountCents: number): TipRecipient[] {
  const all = lines.filter((l) => cents(l.lineTotalCents) > 0 || !l.isProduct);
  const disc = splitByWeights(Math.min(cents(ticketDiscountCents), all.reduce((a, l) => a + cents(l.lineTotalCents), 0)), all.map((l) => cents(l.lineTotalCents)));
  const by = new Map<string, TipRecipient>(); const order: string[] = [];
  all.forEach((l, i) => {
    if (l.isProduct) return;
    const net = Math.max(0, cents(l.lineTotalCents) - disc[i]);
    const shares = (l.shares ?? []).filter((s) => s.technicianId && s.shareBps > 0);
    const parts = shares.length && shares.reduce((a, s) => a + s.shareBps, 0) === 10000
      ? shares.map((s, k) => ({ id: s.technicianId, name: s.name ?? null, cents: splitByWeights(net, shares.map((x) => x.shareBps))[k] }))
      : l.technicianId ? [{ id: l.technicianId, name: l.technicianName ?? null, cents: net }] : [];
    for (const p of parts) {
      let r = by.get(p.id);
      if (!r) { r = { technicianId: p.id, name: p.name || 'Technician', services: [], basisCents: 0 }; by.set(p.id, r); order.push(p.id); }
      if (p.name && r.name === 'Technician') r.name = p.name;
      r.basisCents += p.cents;
      if (!r.services.includes(l.serviceName)) r.services.push(l.serviceName);
    }
  });
  return order.map((id) => by.get(id)!);
}

export function recipientsKey(rs: TipRecipient[]): string {
  return rs.map((r) => `${r.technicianId}:${r.basisCents}`).sort().join('|');
}

export class TechTipError extends Error { constructor(message: string, readonly reason: string, readonly technicianId?: string) { super(message); } }

/** each technician's tip in cents from the customer's choices. Every recipient must have an explicit choice (No Tip is a
 *  choice); a technician who is not a recipient is refused (§4.1 — never a client-chosen payee). */
export function technicianTips(recipients: TipRecipient[], choices: TechTipChoice[], maxTipPercent: number, opts: { maxCustomCents?: number } = {}): { items: TechTipResult[]; totalCents: number } {
  const valid = new Map(recipients.map((r) => [r.technicianId, r]));
  const seen = new Set<string>(); const items: TechTipResult[] = [];
  for (const c of choices) {
    const r = valid.get(String(c?.technicianId ?? ''));
    if (!r) throw new TechTipError('That technician did not perform a service on this ticket.', 'NOT_A_RECIPIENT', c?.technicianId);
    if (seen.has(r.technicianId)) throw new TechTipError('Each technician can have one tip.', 'DUPLICATE', r.technicianId);
    seen.add(r.technicianId);
    let tip = 0; let pct: number | null = null;
    if (c.tipType === 'percent') {
      const p = Number(c.percent);
      if (!Number.isFinite(p) || p < 0 || p > 100) throw new TechTipError('Choose a tip percentage between 0 and 100.', 'PERCENT_INVALID', r.technicianId);
      pct = p; tip = Math.round(r.basisCents * (p / 100));
    } else if (c.tipType === 'custom') {
      const a = Number(c.amountCents);
      if (!Number.isInteger(a) || a < 0) throw new TechTipError('Enter the tip in whole cents.', 'AMOUNT_INVALID', r.technicianId);
      tip = a;
    } else if (c.tipType !== 'none') throw new TechTipError('Choose No Tip, an amount or a percentage.', 'TYPE_INVALID', r.technicianId);
    const cap = Math.max(opts.maxCustomCents ?? 50000, r.basisCents > 0 ? Math.round(r.basisCents * (maxTipPercent / 100)) : 0);
    if (tip > cap) throw new TechTipError(`That tip is higher than this salon allows for one technician (${(cap / 100).toFixed(2)}).`, 'TIP_EXCEEDS_MAX', r.technicianId);
    items.push({ technicianId: r.technicianId, tipType: c.tipType, percent: pct, tipCents: tip });
  }
  return { items, totalCents: items.reduce((a, i) => a + i.tipCents, 0) };
}
