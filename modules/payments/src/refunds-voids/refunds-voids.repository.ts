// refunds-voids.repository.ts — port + in-memory adapter (dev/offline/tests default).
import type { RefundsVoidsContext, ReversalRow } from './refunds-voids.dto';

export interface RefundsVoidsRepositoryPort {
  list(ctx: RefundsVoidsContext): Promise<ReversalRow[]>;
}

export class InMemoryRefundsVoidsRepository implements RefundsVoidsRepositoryPort {
  constructor(private readonly seed: ReversalRow[] = []) {}
  async list(_ctx: RefundsVoidsContext): Promise<ReversalRow[]> { return this.seed.slice(); }
}
