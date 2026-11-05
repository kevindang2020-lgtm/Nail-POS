// voice-learning.service.ts — the human-approved improvement loop. Safety-critical orchestration:
//  - suggestions are captured from calls but never auto-applied;
//  - approving a suggestion only creates a DRAFT prompt version (never live);
//  - a prompt version goes live ONLY via activate() — an explicit, separate human action;
//  - the loop refuses to target anything operational (prices/hours/policies/permissions/booking-validation);
//  - rollback re-activates a prior version; only one version is active per (tenant, scope).
import { Injectable, Inject } from '@nestjs/common';
import { isAllowedSuggestionTarget, isForbiddenTarget, canTransition, evaluateOutcome, type PromptStatus, type OutcomeSignalsInput } from './voice-learning-core';
import type { VoiceContext } from './voice-booking.service';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { Suggestion } from '@aipowersalon/api-contracts/platform';
import type { Suggestion } from '@aipowersalon/api-contracts/platform';
import type { VoicePromptVersion } from '@aipowersalon/api-contracts/platform';

// PromptVersion: the platform contract's VoicePromptVersion (Constitution 13 §15).
export type PromptVersion = VoicePromptVersion;

export interface LearningRepo {
  addSuggestion(s: Omit<Suggestion, 'id' | 'createdMs'>): Promise<Suggestion>;
  getSuggestion(tenantId: string, id: string): Promise<Suggestion | null>;
  updateSuggestion(tenantId: string, id: string, patch: Partial<Suggestion>): Promise<Suggestion | null>;
  listSuggestions(tenantId: string, status?: string): Promise<Suggestion[]>;
  addPromptVersion(v: Omit<PromptVersion, 'id' | 'createdMs'>): Promise<PromptVersion>;
  getPromptVersion(tenantId: string, id: string): Promise<PromptVersion | null>;
  setPromptStatus(tenantId: string, id: string, status: PromptStatus, patch?: Partial<PromptVersion>): Promise<PromptVersion | null>;
  getActive(tenantId: string, scope: string): Promise<PromptVersion | null>;
  listPromptVersions(tenantId: string, scope: string): Promise<PromptVersion[]>;
}

export class LearningError extends Error {}

@Injectable()
export class VoiceLearningService {
  constructor(@Inject('LearningRepo') private readonly repo: LearningRepo) {}

  /** Capture a suggestion from a call's outcome IF the deterministic evaluator flags it. Never applies anything. */
  async suggestFromOutcome(ctx: VoiceContext, sourceCallId: string | null, outcome: OutcomeSignalsInput, detail: string): Promise<Suggestion | null> {
    const signals = evaluateOutcome(outcome);
    if (!signals.reviewWorthy) return null;
    return this.repo.addSuggestion({
      tenantId: ctx.tenantId, sourceCallId, category: signals.categories[0], targetType: 'prompt',
      detail: detail.slice(0, 2000), status: 'open', reviewedBy: null, resultingVersionId: null,
    });
  }

  /** Create a suggestion explicitly (e.g. a reviewer's idea). Refuses forbidden/operational targets outright. */
  async createSuggestion(ctx: VoiceContext, input: { sourceCallId?: string | null; category: string; targetType: string; detail: string }): Promise<Suggestion> {
    if (isForbiddenTarget(input.targetType)) throw new LearningError(`The learning loop cannot change '${input.targetType}'. Use its POS module.`);
    if (!isAllowedSuggestionTarget(input.targetType)) throw new LearningError(`Unsupported suggestion target: ${input.targetType}`);
    return this.repo.addSuggestion({ tenantId: ctx.tenantId, sourceCallId: input.sourceCallId ?? null, category: input.category, targetType: input.targetType, detail: input.detail.slice(0, 2000), status: 'open', reviewedBy: null, resultingVersionId: null });
  }

  /**
   * Approve a suggestion. This does NOT change anything live. For a prompt suggestion it creates a DRAFT prompt version
   * (derived from the current active one) that a human must then explicitly activate. Refuses forbidden targets.
   */
  async approveSuggestion(ctx: VoiceContext, id: string, reviewerUserId: string, newPromptBody?: string, scope = 'default'): Promise<{ suggestion: Suggestion; draftVersion?: PromptVersion }> {
    const s = await this.repo.getSuggestion(ctx.tenantId, id);
    if (!s) throw new LearningError('Suggestion not found');
    if (s.status !== 'open') throw new LearningError(`Only an open suggestion can be approved (is '${s.status}')`);
    if (isForbiddenTarget(s.targetType)) throw new LearningError(`Cannot apply a change to '${s.targetType}'`);

    let draftVersion: PromptVersion | undefined;
    if (s.targetType === 'prompt') {
      if (!newPromptBody?.trim()) throw new LearningError('A new prompt body is required to approve a prompt suggestion');
      const active = await this.repo.getActive(ctx.tenantId, scope);
      draftVersion = await this.repo.addPromptVersion({
        tenantId: ctx.tenantId, scope, versionLabel: nextLabel(active?.versionLabel), body: newPromptBody.trim(),
        status: 'draft', parentVersionId: active?.id ?? null, createdBy: reviewerUserId, approvedBy: null, activatedMs: null,
      });
    }
    const suggestion = (await this.repo.updateSuggestion(ctx.tenantId, id, { status: 'approved', reviewedBy: reviewerUserId, resultingVersionId: draftVersion?.id ?? null }))!;
    return { suggestion, draftVersion };
  }

  async rejectSuggestion(ctx: VoiceContext, id: string, reviewerUserId: string): Promise<Suggestion> {
    const s = await this.repo.getSuggestion(ctx.tenantId, id);
    if (!s) throw new LearningError('Suggestion not found');
    if (s.status !== 'open') throw new LearningError('Only an open suggestion can be rejected');
    return (await this.repo.updateSuggestion(ctx.tenantId, id, { status: 'rejected', reviewedBy: reviewerUserId }))!;
  }

  /** Submit a draft for review (draft → pending_review). */
  async submitForReview(ctx: VoiceContext, versionId: string): Promise<PromptVersion> {
    return this.transition(ctx, versionId, 'pending_review');
  }

  /**
   * ACTIVATE a prompt version — the ONLY way a version goes live, and an explicit human action. Archives the current
   * active version first (so exactly one is active). Requires the version to be in pending_review (reviewed) or archived
   * (rollback).
   */
  async activatePromptVersion(ctx: VoiceContext, versionId: string, approverUserId: string, scope = 'default'): Promise<PromptVersion> {
    const v = await this.repo.getPromptVersion(ctx.tenantId, versionId);
    if (!v) throw new LearningError('Prompt version not found');
    if (!canTransition(v.status, 'active')) throw new LearningError(`A '${v.status}' version cannot be activated`);
    const current = await this.repo.getActive(ctx.tenantId, scope);
    if (current && current.id !== versionId) await this.repo.setPromptStatus(ctx.tenantId, current.id, 'archived');
    return (await this.repo.setPromptStatus(ctx.tenantId, versionId, 'active', { approvedBy: approverUserId, activatedMs: Date.now() }))!;
  }

  /** Rollback: re-activate the most recent previously-active (archived) version other than the current one. */
  async rollback(ctx: VoiceContext, scope = 'default'): Promise<PromptVersion> {
    const versions = await this.repo.listPromptVersions(ctx.tenantId, scope);
    const current = versions.find((v) => v.status === 'active');
    const priors = versions.filter((v) => v.status === 'archived' && v.activatedMs != null).sort((a, b) => (b.activatedMs! - a.activatedMs!));
    if (!priors.length) throw new LearningError('No prior version to roll back to');
    if (current) await this.repo.setPromptStatus(ctx.tenantId, current.id, 'archived');
    return (await this.repo.setPromptStatus(ctx.tenantId, priors[0].id, 'active', { activatedMs: Date.now() }))!;
  }

  private async transition(ctx: VoiceContext, versionId: string, to: PromptStatus): Promise<PromptVersion> {
    const v = await this.repo.getPromptVersion(ctx.tenantId, versionId);
    if (!v) throw new LearningError('Prompt version not found');
    if (!canTransition(v.status, to)) throw new LearningError(`Cannot move a '${v.status}' version to '${to}'`);
    return (await this.repo.setPromptStatus(ctx.tenantId, versionId, to))!;
  }

  listSuggestions(ctx: VoiceContext, status?: string) { return this.repo.listSuggestions(ctx.tenantId, status); }
  activePrompt(ctx: VoiceContext, scope = 'default') { return this.repo.getActive(ctx.tenantId, scope); }
}

function nextLabel(prev?: string): string {
  const m = /^v(\d+)$/.exec(prev ?? '');
  return m ? `v${Number(m[1]) + 1}` : 'v1';
}

/** In-memory repo for dev/tests. */
export class InMemoryLearningRepo implements LearningRepo {
  private suggestions: Suggestion[] = [];
  private versions: PromptVersion[] = [];
  async addSuggestion(s: any): Promise<Suggestion> { const rec = { ...s, id: 'sg_' + (this.suggestions.length + 1), createdMs: Date.now() }; this.suggestions.push(rec); return rec; }
  async getSuggestion(t: string, id: string) { return this.suggestions.find((s) => s.tenantId === t && s.id === id) ?? null; }
  async updateSuggestion(t: string, id: string, patch: any) { const s = await this.getSuggestion(t, id); if (s) Object.assign(s, patch); return s; }
  async listSuggestions(t: string, status?: string) { return this.suggestions.filter((s) => s.tenantId === t && (!status || s.status === status)); }
  async addPromptVersion(v: any): Promise<PromptVersion> { const rec = { ...v, id: 'pv_' + (this.versions.length + 1), createdMs: Date.now() }; this.versions.push(rec); return rec; }
  async getPromptVersion(t: string, id: string) { return this.versions.find((v) => v.tenantId === t && v.id === id) ?? null; }
  async setPromptStatus(t: string, id: string, status: PromptStatus, patch: any = {}) { const v = await this.getPromptVersion(t, id); if (v) Object.assign(v, { status }, patch); return v; }
  async getActive(t: string, scope: string) { return this.versions.find((v) => v.tenantId === t && v.scope === scope && v.status === 'active') ?? null; }
  async listPromptVersions(t: string, scope: string) { return this.versions.filter((v) => v.tenantId === t && v.scope === scope); }
}
