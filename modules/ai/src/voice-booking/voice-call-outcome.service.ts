// voice-call-outcome.service.ts — records a structured outcome per call (idempotent upsert by tenant+providerCallId) and
// reads them back for call history + analytics. tenant/branch always come from the caller's VoiceContext (the key).
import { Injectable, Inject } from '@nestjs/common';
import { normalizeCallOutcome, type CallOutcomeInput, type NormalizedCallOutcome } from './voice-call-outcome-core';
import { summarizeOutcomes, type VoiceAnalytics } from './voice-analytics-core';
import type { VoiceContext } from './voice-booking.service';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { CallOutcomeRecord } from '@aipowersalon/api-contracts/platform';
import type { CallOutcomeRecord } from '@aipowersalon/api-contracts/platform';


export interface CallOutcomeRepo {
  upsert(ctx: VoiceContext, provider: string, o: NormalizedCallOutcome): Promise<CallOutcomeRecord>;
  get(tenantId: string, providerCallId: string): Promise<CallOutcomeRecord | null>;
  list(tenantId: string, opts?: { branchId?: string; limit?: number }): Promise<CallOutcomeRecord[]>;
}

@Injectable()
export class VoiceCallOutcomeService {
  constructor(@Inject('CallOutcomeRepo') private readonly repo: CallOutcomeRepo) {}

  /** Record (or idempotently update) the outcome of a call. Returns the stored record. */
  async record(ctx: VoiceContext, provider: string, input: CallOutcomeInput): Promise<CallOutcomeRecord> {
    const normalized = normalizeCallOutcome(input);
    return this.repo.upsert(ctx, provider, normalized);
  }

  get(tenantId: string, providerCallId: string): Promise<CallOutcomeRecord | null> { return this.repo.get(tenantId, providerCallId); }
  list(tenantId: string, opts?: { branchId?: string; limit?: number }): Promise<CallOutcomeRecord[]> { return this.repo.list(tenantId, opts); }

  /** Aggregate operator metrics over a tenant's calls (optionally scoped to a branch). Computed from real rows. */
  async summary(tenantId: string, opts: { branchId?: string; limit?: number } = {}): Promise<VoiceAnalytics> {
    const rows = await this.repo.list(tenantId, { branchId: opts.branchId, limit: opts.limit ?? 500 });
    return summarizeOutcomes(rows);
  }
}

/** In-memory repo for dev/tests. */
export class InMemoryCallOutcomeRepo implements CallOutcomeRepo {
  private rows: CallOutcomeRecord[] = [];
  async upsert(ctx: VoiceContext, provider: string, o: NormalizedCallOutcome): Promise<CallOutcomeRecord> {
    const existing = this.rows.find((r) => r.tenantId === ctx.tenantId && r.providerCallId === o.providerCallId);
    if (existing) { Object.assign(existing, o, { branchId: ctx.branchId, provider }); return existing; } // idempotent update
    const rec: CallOutcomeRecord = { ...o, id: 'oc_' + (this.rows.length + 1), tenantId: ctx.tenantId, branchId: ctx.branchId, provider, createdMs: Date.now() };
    this.rows.push(rec); return rec;
  }
  async get(tenantId: string, providerCallId: string): Promise<CallOutcomeRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.providerCallId === providerCallId) ?? null;
  }
  async list(tenantId: string, opts: { branchId?: string; limit?: number } = {}): Promise<CallOutcomeRecord[]> {
    let rows = this.rows.filter((r) => r.tenantId === tenantId);
    if (opts.branchId) rows = rows.filter((r) => r.branchId === opts.branchId);
    return rows.slice(-(opts.limit ?? 50)).reverse();
  }
}
