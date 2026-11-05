// gift-card-last4.ts — which gift card paid, as the customer and the front desk may see it (Oct 6 2026).
//
// The last four of the card's printed number; a card sold with no number (a digital code) shows the last four of its
// code instead — the same four the POS already shows in its masked reference ("GC-****-7Q2K"). Never more than four.

/** Four digits from the printed number, else four letters/digits from the code, else null. */
export function giftCardLast4(numberLast4: unknown, code?: unknown): string | null {
  if (typeof numberLast4 === 'string' && /^\d{4}$/.test(numberLast4)) return numberLast4;
  if (typeof code === 'string') {
    const tail = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4);
    if (tail.length === 4) return tail;
  }
  return null;
}
