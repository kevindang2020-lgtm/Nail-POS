// gift-card-settlement.service.ts — super-admin cross-tenant clearing settlement (spec §16/§33). Summarizes outstanding
// obligations, groups pending clearing entries into a batch (with platform-fee-aware totals), and drives batches through
// the reviewed lifecycle. Funds never move automatically — a person advances the batch. Behind SuperAdminGuard.
import type { GiftCardSettlementRepo, BatchRow } from './gift-card-settlement.repository';
import { settlementTotals, canTransitionSettlement } from '@aipowersalon/gift-cards';

export class GiftCardSettlementError extends Error { constructor(msg: string) { super(msg); this.name = 'GiftCardSettlementError'; } }

export class GiftCardSettlementService {
  constructor(private readonly repo: GiftCardSettlementRepo) {}

  async getState() {
    const [pending, batches, positions] = await Promise.all([this.repo.pendingEntries(), this.repo.listBatches(), this.repo.positions()]);
    const t = settlementTotals(pending.map((e) => ({ amountCents: e.amountCents, platformFeeCents: e.platformFeeCents })));
    return { pending: { count: pending.length, totalCents: t.totalCents, feeCents: t.feeCents, netCents: t.netCents, entries: pending }, batches, positions };
  }

  async createBatch(body: { programId?: string | null; entryIds?: string[] }): Promise<BatchRow> {
    const programId = body.programId ?? null;
    const pending = await this.repo.pendingEntries(programId);
    const chosen = body.entryIds && body.entryIds.length ? pending.filter((e) => body.entryIds!.includes(e.id)) : pending;
    if (chosen.length === 0) throw new GiftCardSettlementError('No pending clearing entries to settle.');
    const t = settlementTotals(chosen.map((e) => ({ amountCents: e.amountCents, platformFeeCents: e.platformFeeCents })));
    const batch = await this.repo.createBatch({ programId, totalCents: t.totalCents, feeCents: t.feeCents, netCents: t.netCents }, chosen.map((e) => e.id));
    if (!batch) throw new GiftCardSettlementError('Could not create the settlement batch.');
    return batch;
  }

  async getBatch(id: string) {
    const b = await this.repo.getBatch(id);
    if (!b) throw new GiftCardSettlementError('Settlement batch not found.');
    return b;
  }

  async setBatchStatus(id: string, body: { status?: string }, userId: string | null): Promise<BatchRow> {
    const status = String(body.status || '');
    const current = await this.repo.getBatch(id);
    if (!current) throw new GiftCardSettlementError('Settlement batch not found.');
    if (!canTransitionSettlement(current.batch.status, status)) throw new GiftCardSettlementError(`Cannot move a ${current.batch.status} batch to ${status || 'that state'}.`);
    const updated = await this.repo.setBatchStatus(id, status, userId, current.batch.status);
    if (!updated) throw new GiftCardSettlementError('The settlement batch changed while you were working on it — refresh and try again.');
    return updated;
  }
}
