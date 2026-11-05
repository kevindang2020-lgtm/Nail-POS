// fake-deals-port.ts — a CheckoutDealsPort for checkout unit tests (spec support only, never wired in production).
// It models the deals domain's contract: offers with locked rules, one application per deal per ticket, released /
// redeemed / reversed states, sold-out refusals — so CheckoutService's pricing and hooks can be tested without a DB.
import { DealRefusedError, reason, type OfferRequest, type StackingPolicy, type PricedOffer } from '@aipowersalon/deals';
import type { CheckoutDealsPort } from '../checkout.service';

export interface FakeDeal { id: string; title: string; kind?: 'deal' | 'coupon'; rule: OfferRequest['rule']; stackable?: boolean; code?: string; lineIds?: string[] | null; booked?: boolean }
export interface FakeApp { redemptionId: string; dealId: string; kind: string; status: 'applied' | 'redeemed' | 'released' | 'reversed'; discountCents: number; lines: { lineId: string; cents: number }[]; ticketId: string }

export class FakeDealsPort implements CheckoutDealsPort {
  apps: FakeApp[] = [];
  paid: string[] = [];
  refunded: { ticketId: string; lines: string[] | null; reason: string }[] = [];
  soldOut = new Set<string>();
  private seq = 0;
  constructor(public deals: FakeDeal[], public mode: StackingPolicy['mode'] = 'best_single', public extra: Partial<StackingPolicy> = {}) {}
  async policy(): Promise<StackingPolicy> { return { mode: this.mode, allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null, ...this.extra }; }
  private offer(d: FakeDeal, id: string, extra: Partial<OfferRequest> = {}): OfferRequest {
    return { id, category: d.kind === 'coupon' ? 'coupon' : 'deal', description: d.title, rule: d.rule, stackable: !!d.stackable, lineIds: d.lineIds ?? null, dealId: d.id, ...extra };
  }
  async offersForPricing(_c: any, ticketId: string): Promise<OfferRequest[]> {
    return this.apps.filter((a) => a.ticketId === ticketId && (a.status === 'applied' || a.status === 'redeemed'))
      .map((a) => this.offer(this.deals.find((d) => d.id === a.dealId)!, 'deal-' + a.redemptionId, { redemptionId: a.redemptionId }));
  }
  async candidate(_c: any, _t: string, req: any) {
    const d = req.code ? this.deals.find((x) => x.code && x.code.toUpperCase() === String(req.code).toUpperCase()) : req.fromAppointment ? this.deals.find((x) => x.booked) : this.deals.find((x) => x.id === req.dealId);
    if (!d) throw new DealRefusedError(req.code ? 'That code isn’t valid here.' : req.fromAppointment ? 'No deal reserved for this appointment.' : 'Deal not found.', 400);
    return { deal: { id: d.id, title: d.title }, offer: this.offer(d, 'candidate-' + d.id) };
  }
  async reserve(_c: any, ticketId: string, cand: any, priced: PricedOffer) {
    if (this.soldOut.has(cand.deal.id)) throw new DealRefusedError('This deal has sold out.', 409, [reason('sold_out', 'Sold out.')]);
    const d = this.deals.find((x) => x.id === cand.deal.id)!;
    const app: FakeApp = { redemptionId: 'r' + (++this.seq), dealId: d.id, kind: d.kind ?? 'deal', status: 'applied', discountCents: priced.appliedCents, lines: priced.lines, ticketId };
    this.apps.push(app);
    return { redemptionId: app.redemptionId, dealId: d.id, discountCents: app.discountCents };
  }
  async release(_c: any, ids: string[]) { let n = 0; for (const a of this.apps) if (ids.includes(a.redemptionId) && a.status === 'applied') { a.status = 'released'; n++; } return n; }
  async syncAmounts(_c: any, applied: PricedOffer[], rejected: string[]) {
    for (const p of applied) { const a = this.apps.find((x) => x.redemptionId === p.redemptionId); if (a) { a.discountCents = p.appliedCents; a.lines = p.lines; } }
    for (const id of rejected) { const a = this.apps.find((x) => x.redemptionId === id); if (a) a.discountCents = 0; }
  }
  async panel(_c: any, ticketId: string) { return { applied: this.apps.filter((a) => a.ticketId === ticketId), eligible: [], notEligible: [], best: { dealIds: [], add: [], savingsCents: 0, currentCents: 0, better: false } }; }
  async applications(_c: any, ticketId: string) { return this.apps.filter((a) => a.ticketId === ticketId); }
  async onPaid(_c: any, ticketId: string) { this.paid.push(ticketId); for (const a of this.apps) if (a.ticketId === ticketId && a.status === 'applied') a.status = 'redeemed'; }
  async onRefunded(_c: any, ticketId: string, lines: string[] | null, reason: string) { this.refunded.push({ ticketId, lines, reason }); }
}
