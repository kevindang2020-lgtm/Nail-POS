// reputation-routes — the AI Review & Reputation guide (Nov 2 2026) moved the workspace reads to /pos/reputation/*. The old read
// handlers stay retired (their client methods are gone too), and the new read side carries the same AI subscription gate.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AI_PACKAGE_KEY } from '../ai-entitlement/ai-entitlement.guard';
import { AiReviewReputationController } from './ai-review-reputation.controller';
import { ReputationCenterController } from './reputation-center.controller';
import { ReputationSettingsCenterController } from './reputation-settings-center.controller';

describe('Review & Reputation routes', () => {
  it('inbox · analytics · branch-comparison · escalations/urgent · integration-status · GET :id stay retired', () => {
    for (const h of ['inbox', 'analytics', 'branchComparison', 'urgentQueue', 'integrationStatus', 'detail']) expect((AiReviewReputationController.prototype as any)[h]).toBeUndefined();
  });
  it('GET / PUT settings stay retired (Review & Reputation Settings guide, Nov 2 2026); the settings center is NOT package-gated', () => {
    for (const h of ['getSettings', 'updateSettings']) expect((AiReviewReputationController.prototype as any)[h]).toBeUndefined();
    expect(Reflect.getMetadata(AI_PACKAGE_KEY, ReputationSettingsCenterController)).toBeUndefined();
  });
  it('the writes are still on the assistant controller', () => {
    for (const h of ['draft', 'requestApproval', 'approve', 'reject', 'publish', 'acknowledge', 'assign', 'resolve', 'addNote']) expect(typeof (AiReviewReputationController.prototype as any)[h]).toBe('function');
  });
  it('the workspace read side requires ai_review_reputation_assistant', () => {
    expect(Reflect.getMetadata(AI_PACKAGE_KEY, ReputationCenterController)).toBe('ai_review_reputation_assistant');
  });
});
