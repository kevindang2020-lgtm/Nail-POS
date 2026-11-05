// gift-cards.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { GiftCardsContext, GiftCardRow, GiftCardLedgerRow } from './gift-cards.dto';

export interface GiftCardsRepositoryPort {
  listCards(ctx: GiftCardsContext): Promise<GiftCardRow[]>;
  /** Decision 31: the tenant's ledger rows in [from, to] (whole tenant — liability is the company's, not one branch's). */
  /** from / to are days in timeZone (the requesting branch's — Oct 2 2026; they were UTC days). */
  ledgerRows?(ctx: GiftCardsContext, from: string, to: string, timeZone?: string): Promise<GiftCardLedgerRow[]>;
  /** The requesting branch's zone (branches.timezone → America/New_York). */
  timeZone?(ctx: GiftCardsContext): Promise<string>;
  outstandingLiabilityCents?(ctx: GiftCardsContext): Promise<number>;
  branchNames?(ctx: GiftCardsContext): Promise<Map<string, string>>;
}

export class InMemoryGiftCardsRepository implements GiftCardsRepositoryPort {
  constructor(private readonly seed: GiftCardRow[] = [], private readonly ledger: (GiftCardLedgerRow & { date: string })[] = [], private readonly names: Record<string, string> = {}) {}
  async ledgerRows(_ctx: GiftCardsContext, from: string, to: string): Promise<GiftCardLedgerRow[]> { return this.ledger.filter((r) => r.date >= from && r.date <= to); }
  async outstandingLiabilityCents(): Promise<number> { return this.seed.filter((c) => c.status === 'active' || c.status === 'frozen').reduce((a, c) => a + Math.max(0, c.balanceCents), 0); }
  async branchNames(): Promise<Map<string, string>> { return new Map(Object.entries(this.names)); }
  async listCards(ctx: GiftCardsContext): Promise<GiftCardRow[]> {
    // in-memory seed is already tenant-local in tests; return a stable copy
    void ctx;
    return this.seed.slice();
  }
}
