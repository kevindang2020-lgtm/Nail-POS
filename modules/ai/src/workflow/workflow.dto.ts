import { taxCents as taxOf } from '@aipowersalon/money';
import type { Money } from '@aipowersalon/money';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
import { centsToUsd, taxCents } from '@aipowersalon/money';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86)
// workflow.dto.ts — AIPowerSalon POS workflow tail: Queue, Tech Queue, Service Done, Checkout.
// Context (tenantId/branchId/userId/role) is resolved from the session — never sent by the client.

export type QueueStatus = "waiting" | "ready" | "assigned" | "serving" | "ready_checkout" | "completed";
export type PaymentMethod = "card" | "cash" | "gift_card" | "split" | "other";
export type ArrivalSource = "appointment" | "walk_in";

// ===== Queue (/pos/queue) =====
export interface QueueGuest {
  queueItemId: string; position: number; waitedMinutes: number;
  customerId: string; customerName: string; serviceNames: string[];
  source: ArrivalSource; status: QueueStatus;
}
export interface AvailableTech { technicianId: string; name: string; role: string; status: "available" | "busy" | "break" | "off"; }
export interface QueueState { date: string; guests: QueueGuest[]; technicians: AvailableTech[]; waitingCount: number; avgWaitMinutes: number; }
export interface AssignTechRequest { technicianId: string; }

// ===== Tech Queue (/pos/tech-queue) — technician-centric board =====
export interface TechLane {
  technicianId: string; name: string; role: string; status: "available" | "busy" | "break" | "off";
  nowServing?: { ticketId: string; customerName: string; serviceName: string; startedAtLabel: string };
  upNext: { queueItemId: string; customerName: string; serviceName: string }[];
}
export interface TechQueueState { lanes: TechLane[]; available: number; scheduled: number; serving: number; upNextTotal: number; avgHandleMinutes: number; }

// ===== Service Done (/pos/service-done) =====
export interface CompletedTicket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string;
  technicianName: string; serviceNames: string[]; durationMinutes: number; totalCents: Money; completedAtLabel: string;
}
export interface ServiceDoneState { tickets: CompletedTicket[]; completedToday: number; awaitingCheckout: number; avgServiceMinutes: number; revenueReadyCents: Money; }

// ===== Checkout (/pos/checkout) =====
export interface CheckoutLine { name: string; meta?: string; priceCents: Money; }
export interface CheckoutTicket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone: string;
  loyaltyLabel?: string; technicianName?: string; lines: CheckoutLine[]; discountCents: Money; taxRatePercent: number; status: QueueStatus;
}
export interface CheckoutRequest {
  ticketId: string; method: PaymentMethod; tipCents: Money;
  splitParts?: { method: PaymentMethod; amountCents: Money }[];
  emailReceipt?: boolean;
}

// ===== pure helpers (unit-testable) =====

export function estimateWaitMinutes(waitingCount: number, avgServiceMinutes: number, availableTechs: number): number {
  if (availableTechs <= 0) return waitingCount * avgServiceMinutes;
  return Math.round((waitingCount / availableTechs) * avgServiceMinutes);
}

// sort guests by longest wait first, assigning 1-based positions
export function rankByWait(guests: { queueItemId: string; waitedMinutes: number }[]): { queueItemId: string; position: number }[] {
  return guests.slice().sort(function (a, b) { return b.waitedMinutes - a.waitedMinutes; })
    .map(function (g, i) { return { queueItemId: g.queueItemId, position: i + 1 }; });
}

export function tipAmountCents(taxableCents: Money, tipPercent: number): Money {
  return Math.round(taxableCents * (tipPercent / 100));
}

// full cart math: subtotal - discount = taxable; tax on taxable; tip on taxable; total
export function cartTotals(lines: { priceCents: Money }[], discountCents: Money, taxRatePercent: number, tipPercent: number): {
  subtotalCents: Money; taxableCents: Money; taxCents: Money; tipCents: Money; totalCents: Money;
} {
  const subtotalCents = lines.reduce(function (a, l) { return a + l.priceCents; }, 0);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = taxOf(taxableCents, taxRatePercent);
  const tipCents = Math.round(taxableCents * (tipPercent / 100));
  return { subtotalCents: subtotalCents, taxableCents: taxableCents, taxCents: taxCents, tipCents: tipCents, totalCents: taxableCents + taxCents + tipCents };
}

// split a total into N equal parts that sum exactly to the total (extra cents to the first parts)
export function splitEqually(totalCents: Money, ways: number): Money[] {
  if (ways <= 0) return [];
  const base = Math.floor(totalCents / ways);
  let rem = totalCents - base * ways;
  const out: Money[] = [];
  for (let i = 0; i < ways; i += 1) { out.push(base + (rem > 0 ? 1 : 0)); if (rem > 0) rem -= 1; }
  return out;
}

// a split is valid only if its parts sum exactly to the amount due
export function isValidSplit(parts: { amountCents: Money }[], totalCents: Money): boolean {
  return parts.reduce(function (a, p) { return a + p.amountCents; }, 0) === totalCents;
}

