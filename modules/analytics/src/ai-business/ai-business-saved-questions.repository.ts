// ai-business-saved-questions.repository.ts — DTOs + repository port + in-memory adapter for saved questions (§35).
// Every operation is scoped to a trusted (tenantId, userId). Listing returns the user's own questions plus tenant-
// shared ones; delete only ever affects the caller's own rows. No cross-tenant context is stored or returned.
import { isIntent, type AiBusinessIntent } from './ai-business-intents';

export type SharingScope = 'private' | 'tenant';

export interface SavedQuestionContext { tenantId: string; userId: string }

export interface SavedQuestion {
  id: string;
  title: string;
  intent: AiBusinessIntent;
  preset: string | null;
  comparePreset: string | null;
  question: string | null;
  sharingScope: SharingScope;
  ownedByMe: boolean;         // true when the current user created it
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateSavedQuestionInput {
  title: string;
  intent: string;            // validated against the bounded intent set in the service
  preset?: string | null;
  comparePreset?: string | null;
  question?: string | null;
  sharingScope?: SharingScope;
}

export interface SavedQuestionsRepositoryPort {
  list(ctx: SavedQuestionContext): Promise<SavedQuestion[]>;
  create(ctx: SavedQuestionContext, input: CreateSavedQuestionInput & { intent: AiBusinessIntent }): Promise<SavedQuestion>;
  remove(ctx: SavedQuestionContext, id: string): Promise<boolean>;   // only the creator's own row
  touch(ctx: SavedQuestionContext, id: string): Promise<SavedQuestion | null>; // updates last_used_at (own or shared)
}

interface Stored {
  id: string; tenantId: string; userId: string; title: string; intent: AiBusinessIntent;
  preset: string | null; comparePreset: string | null; question: string | null; sharingScope: SharingScope;
  createdAt: string; lastUsedAt: string | null;
}

export class InMemorySavedQuestionsRepository implements SavedQuestionsRepositoryPort {
  private rows: Stored[] = [];
  private seq = 0;

  private view(r: Stored, userId: string): SavedQuestion {
    return {
      id: r.id, title: r.title, intent: r.intent, preset: r.preset, comparePreset: r.comparePreset,
      question: r.question, sharingScope: r.sharingScope, ownedByMe: r.userId === userId,
      createdAt: r.createdAt, lastUsedAt: r.lastUsedAt,
    };
  }

  async list(ctx: SavedQuestionContext): Promise<SavedQuestion[]> {
    return this.rows
      .filter((r) => r.tenantId === ctx.tenantId && (r.userId === ctx.userId || r.sharingScope === 'tenant'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((r) => this.view(r, ctx.userId));
  }
  async create(ctx: SavedQuestionContext, input: CreateSavedQuestionInput & { intent: AiBusinessIntent }): Promise<SavedQuestion> {
    const r: Stored = {
      id: `sq_${++this.seq}`, tenantId: ctx.tenantId, userId: ctx.userId, title: input.title, intent: input.intent,
      preset: input.preset ?? null, comparePreset: input.comparePreset ?? null, question: input.question ?? null,
      sharingScope: input.sharingScope ?? 'private', createdAt: new Date().toISOString(), lastUsedAt: null,
    };
    this.rows.push(r);
    return this.view(r, ctx.userId);
  }
  async remove(ctx: SavedQuestionContext, id: string): Promise<boolean> {
    const before = this.rows.length;
    // Only the creator may delete — tenant-shared rows are not deletable by other users.
    this.rows = this.rows.filter((r) => !(r.id === id && r.tenantId === ctx.tenantId && r.userId === ctx.userId));
    return this.rows.length < before;
  }
  async touch(ctx: SavedQuestionContext, id: string): Promise<SavedQuestion | null> {
    const r = this.rows.find((x) => x.id === id && x.tenantId === ctx.tenantId && (x.userId === ctx.userId || x.sharingScope === 'tenant'));
    if (!r) return null;
    r.lastUsedAt = new Date().toISOString();
    return this.view(r, ctx.userId);
  }
}

export { isIntent };
