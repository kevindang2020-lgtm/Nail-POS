// pos-social.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { SocialContext, SocialPost, CreateSocialPostInput, SocialStatus } from './pos-social.dto';

export interface SocialRepositoryPort {
  list(ctx: SocialContext): Promise<SocialPost[]>;
  create(ctx: SocialContext, input: CreateSocialPostInput): Promise<SocialPost>;
  find(ctx: SocialContext, id: string): Promise<SocialPost | null>;
  setStatus(ctx: SocialContext, id: string, status: SocialStatus, from?: SocialStatus): Promise<SocialPost | null>;
}

export class InMemorySocialRepository implements SocialRepositoryPort {
  private rows: SocialPost[];
  constructor(seed: SocialPost[] = []) { this.rows = seed.slice(); }
  async list(_ctx: SocialContext): Promise<SocialPost[]> {
    return this.rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async create(_ctx: SocialContext, input: CreateSocialPostInput): Promise<SocialPost> {
    const row: SocialPost = {
      id: 'social_' + (this.rows.length + 1), platform: input.platform, caption: input.caption,
      scheduledAt: input.scheduledAt ?? null, status: input.scheduledAt ? 'scheduled' : 'draft',
      postedAt: null, createdAt: new Date().toISOString(),
    };
    this.rows.push(row); return row;
  }
  async find(_ctx: SocialContext, id: string): Promise<SocialPost | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async setStatus(_ctx: SocialContext, id: string, status: SocialStatus): Promise<SocialPost | null> {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    r.status = status; if (status === 'posted') r.postedAt = new Date().toISOString(); return r;
  }
}
