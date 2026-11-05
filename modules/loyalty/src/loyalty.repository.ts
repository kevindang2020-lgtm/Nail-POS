// loyalty.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { LoyaltyContext, LoyaltyProfile, LoyaltyReward, LoyaltyRedemption } from './loyalty.dto';

export interface LoyaltyRepositoryPort {
  listProfiles(ctx: LoyaltyContext): Promise<LoyaltyProfile[]>;
  getProfile(ctx: LoyaltyContext, customerId: string): Promise<LoyaltyProfile | null>;
  listRewards(ctx: LoyaltyContext): Promise<LoyaltyReward[]>;
  listRedemptions(ctx: LoyaltyContext): Promise<LoyaltyRedemption[]>;
  getReward(ctx: LoyaltyContext, id: string): Promise<LoyaltyReward | null>;
  createReward(ctx: LoyaltyContext, r: Omit<LoyaltyReward, 'id'>): Promise<LoyaltyReward>;
  updateReward(ctx: LoyaltyContext, id: string, r: Omit<LoyaltyReward, 'id'>): Promise<LoyaltyReward | null>;
}

export class InMemoryLoyaltyRepository implements LoyaltyRepositoryPort {
  constructor(
    private readonly seedProfiles: LoyaltyProfile[] = [],
    private readonly seedRewards: LoyaltyReward[] = [],
    private readonly seedRedemptions: LoyaltyRedemption[] = [],
  ) {}
  async listProfiles(ctx: LoyaltyContext): Promise<LoyaltyProfile[]> { void ctx; return this.seedProfiles.slice(); }
  async getProfile(ctx: LoyaltyContext, customerId: string): Promise<LoyaltyProfile | null> { void ctx; return this.seedProfiles.find((p) => p.customerId === customerId) ?? null; }
  async listRewards(ctx: LoyaltyContext): Promise<LoyaltyReward[]> { void ctx; return this.seedRewards.slice(); }
  async listRedemptions(ctx: LoyaltyContext): Promise<LoyaltyRedemption[]> { void ctx; return this.seedRedemptions.slice(); }
  async getReward(_ctx: LoyaltyContext, id: string) { return this.seedRewards.find((r) => r.id === id) ?? null; }
  async createReward(_ctx: LoyaltyContext, r: Omit<LoyaltyReward, 'id'>) { const row = { id: 'rw_' + (this.seedRewards.length + 1), ...r }; this.seedRewards.push(row); return row; }
  async updateReward(_ctx: LoyaltyContext, id: string, r: Omit<LoyaltyReward, 'id'>) { const i = this.seedRewards.findIndex((x) => x.id === id); if (i < 0) return null; this.seedRewards[i] = { id, ...r }; return this.seedRewards[i]; }
}
