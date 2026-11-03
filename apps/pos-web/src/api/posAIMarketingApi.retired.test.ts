// AI Marketing guides (Nov 3 2026): the center + Campaign Center replace these client methods — they are retired.
import { describe, it, expect } from 'vitest';
import { posAIMarketingApi } from './posAIMarketingApi';
describe('posAIMarketingApi — retired methods', () => {
  it.each(['state', 'previewAudience', 'submitCampaign', 'approveCampaign', 'campaignResults'])('%s is gone', (k) => {
    expect((posAIMarketingApi as Record<string, unknown>)[k]).toBeUndefined();
  });
  it('the center and the draft generator remain', () => {
    expect(typeof posAIMarketingApi.center.summary).toBe('function');
    expect(typeof posAIMarketingApi.center.saveDraft).toBe('function');
    expect(typeof posAIMarketingApi.generateDraft).toBe('function');
  });
});
