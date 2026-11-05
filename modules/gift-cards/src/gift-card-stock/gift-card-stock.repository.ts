// gift-card-stock.repository.ts — data access for physical gift-card inventory (spec §21). Cards are stored by hash +
// last four only (never the clear number). Registration is idempotent per tenant (the number's hash is unique), so
// re-registering a batch that overlaps existing stock silently skips the duplicates. Write DB handle throughout.
import { canMoveToSql } from '@aipowersalon/database';
import { GIFT_CARD_STOCK } from '../gift-card-lifecycles';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { StockItem } from '@aipowersalon/api-contracts/tenant';
import type { StockItem } from '@aipowersalon/api-contracts/tenant';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { StockCounts } from '@aipowersalon/api-contracts/tenant';
import type { StockCounts } from '@aipowersalon/api-contracts/tenant';

export interface StockContext { tenantId: string; branchId?: string; userId: string }
export interface NewStockCard { hash: string; last4: string }

export interface GiftCardStockRepo {
  registerCards(ctx: StockContext, cards: NewStockCard[], batchLabel: string | null): Promise<{ added: number; duplicates: number }>;
  listStock(ctx: StockContext): Promise<{ counts: StockCounts; items: StockItem[] }>;
  voidCard(ctx: StockContext, id: string): Promise<boolean>;
}

const iso = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const mapItem = (r: any): StockItem => ({ id: r.id, last4: r.card_number_last4, status: r.status, batchLabel: r.batch_label, notes: r.notes, createdAt: iso(r.created_at)!, activatedAt: iso(r.activated_at) });
const emptyCounts = (): StockCounts => ({ available: 0, activated: 0, void: 0, total: 0 });

export class KyselyGiftCardStockRepo implements GiftCardStockRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async registerCards(ctx: StockContext, cards: NewStockCard[], batchLabel: string | null): Promise<{ added: number; duplicates: number }> {
    if (cards.length === 0) return { added: 0, duplicates: 0 };
    const rows = cards.map((c) => ({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, card_number_hash: c.hash, card_number_last4: c.last4, status: 'available', batch_label: batchLabel }));
    // ON CONFLICT DO NOTHING on the (tenant, hash) unique index: only genuinely-new numbers are inserted + returned.
    const inserted = await this.db.insertInto('gift_card_stock').values(rows as any)
      .onConflict((oc) => oc.columns(['tenant_id', 'card_number_hash']).doNothing()).returning(['id']).execute().catch(() => [] as any[]);
    const added = (inserted as any[]).length;
    return { added, duplicates: cards.length - added };
  }

  async listStock(ctx: StockContext): Promise<{ counts: StockCounts; items: StockItem[] }> {
    const items = await this.db.selectFrom('gift_card_stock')
      .select(['id', 'card_number_last4', 'status', 'batch_label', 'notes', 'created_at', 'activated_at'])
      .where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').limit(200).execute().catch(() => [] as any[]);
    const countRows = await this.db.selectFrom('gift_card_stock').select(['status']).select((eb) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', ctx.tenantId).groupBy('status').execute().catch(() => [] as any[]);
    const counts = emptyCounts();
    for (const r of countRows as any[]) { const n = Number(r.c); if (r.status === 'available' || r.status === 'activated' || r.status === 'void') counts[r.status as 'available' | 'activated' | 'void'] = n; counts.total += n; }
    return { counts, items: (items as any[]).map(mapItem) };
  }

  async voidCard(ctx: StockContext, id: string): Promise<boolean> {
    // Only an available (un-sold) card can be voided; an activated one is a live gift card and must not be touched here.
    const r: any = await this.db.updateTable('gift_card_stock').set({ status: 'void', updated_at: new Date() } as any)
      .where('id', '=', id).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'available').where(canMoveToSql(GIFT_CARD_STOCK, 'void') as any).executeTakeFirst().catch(() => undefined);
    return Number((r as any)?.numUpdatedRows ?? 0) > 0;
  }
}

export class InMemoryGiftCardStockRepo implements GiftCardStockRepo {
  private rows: (StockItem & { tenantId: string; hash: string })[] = [];
  private seq = 0;

  async registerCards(ctx: StockContext, cards: NewStockCard[], batchLabel: string | null) {
    let added = 0, duplicates = 0;
    for (const c of cards) {
      if (this.rows.some((r) => r.tenantId === ctx.tenantId && r.hash === c.hash)) { duplicates++; continue; }
      this.rows.push({ id: 'gcs_' + (++this.seq), tenantId: ctx.tenantId, hash: c.hash, last4: c.last4, status: 'available', batchLabel, notes: null, createdAt: new Date().toISOString(), activatedAt: null });
      added++;
    }
    return { added, duplicates };
  }
  async listStock(ctx: StockContext) {
    const mine = this.rows.filter((r) => r.tenantId === ctx.tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const counts = emptyCounts();
    for (const r of mine) { if (r.status === 'available' || r.status === 'activated' || r.status === 'void') counts[r.status] = (counts[r.status] as number) + 1; counts.total++; }
    return { counts, items: mine.map((r) => ({ id: r.id, last4: r.last4, status: r.status, batchLabel: r.batchLabel, notes: r.notes, createdAt: r.createdAt, activatedAt: r.activatedAt })) };
  }
  async voidCard(ctx: StockContext, id: string) {
    const r = this.rows.find((x) => x.id === id && x.tenantId === ctx.tenantId && x.status === 'available');
    if (!r) return false; r.status = 'void'; return true;
  }
}
