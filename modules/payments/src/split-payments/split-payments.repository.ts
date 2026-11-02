// split-payments.repository.ts — port + in-memory adapter.
import type { SplitPaymentsContext, RawPayment } from './split-payments.dto';
export interface SplitPaymentsRepositoryPort {
  listPayments(ctx: SplitPaymentsContext): Promise<RawPayment[]>;
}
export class InMemorySplitPaymentsRepository implements SplitPaymentsRepositoryPort {
  constructor(private readonly rows: RawPayment[] = []) {}
  async listPayments(): Promise<RawPayment[]> { return this.rows.slice(); }
}
