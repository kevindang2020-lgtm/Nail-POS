// gift-card-settlement.repository.ts — data access for super-admin cross-tenant clearing settlement (spec §16/§33).
// Clearing entries accrue as 'pending' from cross-tenant redemptions; a super admin groups them into settlement batches
// and drives those batches through a reviewed lifecycle. No money moves automatically. Write DB handle throughout.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { TenantPosition } from '@aipowersalon/api-contracts/platform';
import type { TenantPosition } from '@aipowersalon/api-contracts/platform';
import { canMoveToSql } from '@aipowersalon/database';
import { GIFT_CARD_SETTLEMENT_BATCH, GIFT_CARD_CLEARING_ENTRY } from '../lifecycles';

export interface ClearingEntryRow {
  id: string; programId: string | null; giftCardId: string; issuingTenantId: string; redeemingTenantId: string;
  amountCents: number; platformFeeCents: number; status: string; settlementBatchId: string | null; createdAt: string;
}
export interface BatchRow {
  id: string; programId: string | null; status: string; totalCents: number; feeCents: number; netCents: number;
  periodStart: string | null; periodEnd: string | null; approvedByUserId: string | null; approvedAt: string | null;
  createdAt: string; entryCount: number;
}

// When a batch advances, its entries follow. Only these batch states change entry status; review/open leave entries as-is.
export const BATCH_TO_ENTRY_STATUS: Record<string, string> = { approved: 'approved', settled: 'settled', disputed: 'disputed', reversed: 'reversed', failed: 'failed' };

export interface GiftCardSettlementRepo {
  pendingEntries(programId?: string | null): Promise<ClearingEntryRow[]>;
  listBatches(): Promise<BatchRow[]>;
  getBatch(id: string): Promise<{ batch: BatchRow; entries: ClearingEntryRow[] } | null>;
  createBatch(input: { programId: string | null; totalCents: number; feeCents: number; netCents: number }, entryIds: string[]): Promise<BatchRow | null>;
  setBatchStatus(id: string, status: string, approvedByUserId: string | null, from?: string): Promise<BatchRow | null>;
  positions(): Promise<TenantPosition[]>;
}

const iso = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const mapEntry = (r: any): ClearingEntryRow => ({ id: r.id, programId: r.program_id, giftCardId: r.gift_card_id, issuingTenantId: r.issuing_tenant_id, redeemingTenantId: r.redeeming_tenant_id, amountCents: Number(r.amount_cents), platformFeeCents: Number(r.platform_fee_cents), status: r.status, settlementBatchId: r.settlement_batch_id, createdAt: iso(r.created_at)! });

export class KyselyGiftCardSettlementRepo implements GiftCardSettlementRepo {
  constructor(private readonly db: Kysely<DB>) {}

  private async batchRow(id: string): Promise<BatchRow | null> {
    const b: any = await this.db.selectFrom('gift_card_settlement_batches')
      .select(['id', 'program_id', 'status', 'total_cents', 'fee_cents', 'net_cents', 'period_start', 'period_end', 'approved_by_user_id', 'approved_at', 'created_at'])
      .where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (!b) return null;
    const c: any = await this.db.selectFrom('gift_card_clearing_entries').select((eb) => eb.fn.countAll().as('c')).where('settlement_batch_id', '=', id).executeTakeFirst().catch(() => undefined);
    return { id: b.id, programId: b.program_id, status: b.status, totalCents: Number(b.total_cents), feeCents: Number(b.fee_cents), netCents: Number(b.net_cents), periodStart: iso(b.period_start), periodEnd: iso(b.period_end), approvedByUserId: b.approved_by_user_id, approvedAt: iso(b.approved_at), createdAt: iso(b.created_at)!, entryCount: Number(c?.c ?? 0) };
  }

  async pendingEntries(programId?: string | null): Promise<ClearingEntryRow[]> {
    let qb = this.db.selectFrom('gift_card_clearing_entries')
      .select(['id', 'program_id', 'gift_card_id', 'issuing_tenant_id', 'redeeming_tenant_id', 'amount_cents', 'platform_fee_cents', 'status', 'settlement_batch_id', 'created_at'])
      .where('status', '=', 'pending').where('settlement_batch_id', 'is', null);
    if (programId) qb = qb.where('program_id', '=', programId);
    const rows = await qb.orderBy('created_at', 'asc').execute().catch(() => [] as any[]);
    return (rows as any[]).map(mapEntry);
  }

  async listBatches(): Promise<BatchRow[]> {
    const batches = await this.db.selectFrom('gift_card_settlement_batches')
      .select(['id', 'program_id', 'status', 'total_cents', 'fee_cents', 'net_cents', 'period_start', 'period_end', 'approved_by_user_id', 'approved_at', 'created_at'])
      .orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    const counts = await this.db.selectFrom('gift_card_clearing_entries').select(['settlement_batch_id']).select((eb) => eb.fn.countAll().as('c')).where('settlement_batch_id', 'is not', null).groupBy('settlement_batch_id').execute().catch(() => [] as any[]);
    const byBatch = new Map<string, number>((counts as any[]).map((r) => [String(r.settlement_batch_id), Number(r.c)]));
    return (batches as any[]).map((b) => ({ id: b.id, programId: b.program_id, status: b.status, totalCents: Number(b.total_cents), feeCents: Number(b.fee_cents), netCents: Number(b.net_cents), periodStart: iso(b.period_start), periodEnd: iso(b.period_end), approvedByUserId: b.approved_by_user_id, approvedAt: iso(b.approved_at), createdAt: iso(b.created_at)!, entryCount: byBatch.get(String(b.id)) ?? 0 }));
  }

  async getBatch(id: string): Promise<{ batch: BatchRow; entries: ClearingEntryRow[] } | null> {
    const batch = await this.batchRow(id);
    if (!batch) return null;
    const rows = await this.db.selectFrom('gift_card_clearing_entries')
      .select(['id', 'program_id', 'gift_card_id', 'issuing_tenant_id', 'redeeming_tenant_id', 'amount_cents', 'platform_fee_cents', 'status', 'settlement_batch_id', 'created_at'])
      .where('settlement_batch_id', '=', id).orderBy('created_at', 'asc').execute().catch(() => [] as any[]);
    return { batch, entries: (rows as any[]).map(mapEntry) };
  }

  async createBatch(input: { programId: string | null; totalCents: number; feeCents: number; netCents: number }, entryIds: string[]): Promise<BatchRow | null> {
    if (entryIds.length === 0) return null;
    const id = await this.db.transaction().execute(async (trx) => {
      const ins: any = await trx.insertInto('gift_card_settlement_batches')
        .values({ program_id: input.programId, status: 'open', total_cents: input.totalCents, fee_cents: input.feeCents, net_cents: input.netCents } as any)
        .returning(['id']).executeTakeFirstOrThrow();
      const batchId = String(ins.id);
      // Claim only still-pending, still-unbatched entries (guards against a concurrent batch grabbing the same rows).
      await trx.updateTable('gift_card_clearing_entries').set({ settlement_batch_id: batchId, status: 'ready', updated_at: new Date() } as any)
        .where('id', 'in', entryIds).where('status', '=', 'pending').where('settlement_batch_id', 'is', null).where(canMoveToSql(GIFT_CARD_CLEARING_ENTRY, 'ready') as any).execute();
      return batchId;
    }).catch(() => null);
    return id ? this.batchRow(id) : null;
  }

  async setBatchStatus(id: string, status: string, approvedByUserId: string | null, from?: string): Promise<BatchRow | null> {
    const set: any = { status, updated_at: new Date() };
    if (status === 'approved') { set.approved_by_user_id = approvedByUserId; set.approved_at = new Date(); }
    // Phase 12 (#27): the batch moves through GIFT_CARD_SETTLEMENT_BATCH, conditional on the state the service checked;
    // its entries follow through GIFT_CARD_CLEARING_ENTRY. A batch another reviewer moved meanwhile is not moved (null).
    const moved = await this.db.transaction().execute(async (trx) => {
      let q: any = trx.updateTable('gift_card_settlement_batches').set(set).where('id', '=', id).where(canMoveToSql(GIFT_CARD_SETTLEMENT_BATCH, status) as any);
      if (from) q = q.where('status', '=', from);
      const r: any = await q.executeTakeFirst();
      if (!Number(r?.numUpdatedRows ?? 0)) return false;
      const entryStatus = BATCH_TO_ENTRY_STATUS[status];
      if (entryStatus) await trx.updateTable('gift_card_clearing_entries').set({ status: entryStatus, updated_at: new Date() } as any).where('settlement_batch_id', '=', id).where(canMoveToSql(GIFT_CARD_CLEARING_ENTRY, entryStatus) as any).execute();
      return true;
    }).catch(() => false);
    return moved ? this.batchRow(id) : null;
  }

  async positions(): Promise<TenantPosition[]> {
    // Outstanding position per salon over non-terminal obligations: receivable = owed to them (as redeemer), payable =
    // they owe (as issuer). Settled/reversed/failed entries are done and excluded.
    const OPEN = ['pending', 'ready', 'validated', 'approved', 'disputed'];
    const recv = await this.db.selectFrom('gift_card_clearing_entries').select(['redeeming_tenant_id']).select((eb) => eb.fn.sum('amount_cents').as('s')).where('status', 'in', OPEN).groupBy('redeeming_tenant_id').execute().catch(() => [] as any[]);
    const pay = await this.db.selectFrom('gift_card_clearing_entries').select(['issuing_tenant_id']).select((eb) => eb.fn.sum('amount_cents').as('s')).where('status', 'in', OPEN).groupBy('issuing_tenant_id').execute().catch(() => [] as any[]);
    const map = new Map<string, TenantPosition>();
    for (const r of recv as any[]) { const t = String(r.redeeming_tenant_id); const p = map.get(t) || { tenantId: t, receivableCents: 0, payableCents: 0, netCents: 0 }; p.receivableCents = Number(r.s || 0); map.set(t, p); }
    for (const r of pay as any[]) { const t = String(r.issuing_tenant_id); const p = map.get(t) || { tenantId: t, receivableCents: 0, payableCents: 0, netCents: 0 }; p.payableCents = Number(r.s || 0); map.set(t, p); }
    return [...map.values()].map((p) => ({ ...p, netCents: p.receivableCents - p.payableCents })).sort((a, b) => b.netCents - a.netCents);
  }
}

export class InMemoryGiftCardSettlementRepo implements GiftCardSettlementRepo {
  private entries: ClearingEntryRow[] = [];
  private batches: BatchRow[] = [];
  private seq = 0;
  // test seam: seed pending clearing entries
  seed(entries: ClearingEntryRow[]) { this.entries = entries.map((e) => ({ ...e })); }

  async pendingEntries(programId?: string | null) { return this.entries.filter((e) => e.status === 'pending' && !e.settlementBatchId && (!programId || e.programId === programId)); }
  async listBatches() { return this.batches.map((b) => ({ ...b, entryCount: this.entries.filter((e) => e.settlementBatchId === b.id).length })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async getBatch(id: string) { const b = this.batches.find((x) => x.id === id); if (!b) return null; return { batch: { ...b, entryCount: this.entries.filter((e) => e.settlementBatchId === id).length }, entries: this.entries.filter((e) => e.settlementBatchId === id) }; }
  async createBatch(input: { programId: string | null; totalCents: number; feeCents: number; netCents: number }, entryIds: string[]) {
    if (entryIds.length === 0) return null;
    const id = 'gcb_' + (++this.seq);
    const batch: BatchRow = { id, programId: input.programId, status: 'open', totalCents: input.totalCents, feeCents: input.feeCents, netCents: input.netCents, periodStart: null, periodEnd: null, approvedByUserId: null, approvedAt: null, createdAt: new Date().toISOString(), entryCount: 0 };
    this.batches.push(batch);
    for (const e of this.entries) if (entryIds.includes(e.id) && e.status === 'pending' && !e.settlementBatchId) { e.settlementBatchId = id; e.status = 'ready'; }
    return { ...batch, entryCount: this.entries.filter((e) => e.settlementBatchId === id).length };
  }
  async setBatchStatus(id: string, status: string, approvedByUserId: string | null) {
    const b = this.batches.find((x) => x.id === id); if (!b) return null;
    b.status = status; if (status === 'approved') { b.approvedByUserId = approvedByUserId; b.approvedAt = new Date().toISOString(); }
    const es = BATCH_TO_ENTRY_STATUS[status]; if (es) for (const e of this.entries) if (e.settlementBatchId === id) e.status = es;
    return { ...b, entryCount: this.entries.filter((e) => e.settlementBatchId === id).length };
  }
  async positions() {
    const OPEN = ['pending', 'ready', 'validated', 'approved', 'disputed'];
    const map = new Map<string, TenantPosition>();
    for (const e of this.entries) {
      if (!OPEN.includes(e.status)) continue;
      const r = map.get(e.redeemingTenantId) || { tenantId: e.redeemingTenantId, receivableCents: 0, payableCents: 0, netCents: 0 }; r.receivableCents += e.amountCents; map.set(e.redeemingTenantId, r);
      const p = map.get(e.issuingTenantId) || { tenantId: e.issuingTenantId, receivableCents: 0, payableCents: 0, netCents: 0 }; p.payableCents += e.amountCents; map.set(e.issuingTenantId, p);
    }
    return [...map.values()].map((p) => ({ ...p, netCents: p.receivableCents - p.payableCents })).sort((a, b) => b.netCents - a.netCents);
  }
}
