// gift-card-stock.service.ts — physical gift-card inventory (spec §21). Parses a pasted/scanned batch of 16-digit
// numbers, validates + de-duplicates them, and registers them as available stock (storing only hash + last four).
// Composes the stock state with a low-stock signal. No money moves — this is the card rack, not a sale.
import type { GiftCardStockRepo, StockContext } from './gift-card-stock.repository';
import { normalizeCardNumber, isValidCardNumber, hashCardNumber, lastFour } from '../gift-cards/gift-card-number-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class GiftCardStockError extends Error { constructor(msg: string) { super(msg); this.name = 'GiftCardStockError'; } }

const LOW_STOCK_THRESHOLD = 10;

export class GiftCardStockService {
  constructor(private readonly repo: GiftCardStockRepo) {}

  async getState(ctx: StockContext) {
    const { counts, items } = await this.repo.listStock(ctx);
    return { counts, items, lowStock: counts.available < LOW_STOCK_THRESHOLD, lowStockThreshold: LOW_STOCK_THRESHOLD };
  }

  async registerBatch(ctx: StockContext, body: { numbers?: string; batchLabel?: string }): Promise<{ added: number; duplicates: number; invalid: number }> {
    // One number per line (or comma/semicolon separated). Spaces WITHIN a number are fine — they're printed that way and
    // get stripped on normalize — so we split only on line breaks / commas, not on every space.
    const tokens = String(body?.numbers || '').split(/[\n\r,;]+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) throw withCode(new GiftCardStockError('Enter at least one card number.'), 'GIFT_CARD_NUMBERS_REQUIRED');
    const seen = new Set<string>();
    const cards: { hash: string; last4: string }[] = [];
    let invalid = 0, dupInInput = 0;
    for (const t of tokens) {
      const norm = normalizeCardNumber(t);
      if (!isValidCardNumber(norm)) { invalid++; continue; }
      if (seen.has(norm)) { dupInInput++; continue; }
      seen.add(norm);
      cards.push({ hash: hashCardNumber(norm), last4: lastFour(norm) });
    }
    if (cards.length === 0) throw withCode(new GiftCardStockError('No valid 16-digit card numbers found.'), 'GIFT_CARD_NUMBERS_INVALID');
    const res = await this.repo.registerCards(ctx, cards, (body?.batchLabel || '').trim() || null);
    return { added: res.added, duplicates: res.duplicates + dupInInput, invalid };
  }

  async voidCard(ctx: StockContext, id: string): Promise<{ ok: boolean }> {
    const ok = await this.repo.voidCard(ctx, id);
    if (!ok) throw withCode(new GiftCardStockError('That card is not available to void (already sold or not found).'), 'GIFT_CARD_NOT_VOIDABLE');
    return { ok: true };
  }
}
