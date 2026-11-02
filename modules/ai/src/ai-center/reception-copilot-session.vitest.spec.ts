import { describe, it, expect } from 'vitest';
import { ReceptionCopilotSessionService } from './reception-copilot-session.service';

const ctx = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'RECEPTION', permissions: [] } as any;

describe('ReceptionCopilotSessionService (null DB is a safe no-op)', () => {
  const svc = new ReceptionCopilotSessionService(null as any);
  it('startSession / recordRecommendation return null ids without a DB', async () => {
    expect((await svc.startSession(ctx)).sessionId).toBeNull();
    expect((await svc.recordRecommendation(ctx, { kind: 'availability' })).recommendationId).toBeNull();
    expect(await svc.listRecommendations(ctx)).toEqual([]);
  });
});
