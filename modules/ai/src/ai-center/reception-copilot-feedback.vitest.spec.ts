import { describe, it, expect } from 'vitest';
import { ReceptionCopilotFeedbackService } from './reception-copilot-feedback.service';

const give = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'RECEPTION', permissions: ['reception_copilot.give_feedback'] } as any;
const noPerm = { ...give, permissions: [] } as any;
const mgr = { ...give, role: 'MANAGER', permissions: ['reception_copilot.view_usage'] } as any;

describe('ReceptionCopilotFeedbackService (§44)', () => {
  it('requires reception_copilot.give_feedback to record', async () => {
    const svc = new ReceptionCopilotFeedbackService(null as any);
    await expect(svc.recordFeedback(noPerm, { recommendationId: 'r1', rating: 'helpful' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('validates the rating value', async () => {
    const svc = new ReceptionCopilotFeedbackService(null as any);
    await expect(svc.recordFeedback(give, { recommendationId: 'r1', rating: 'meh' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('accepts a valid rating (no-op without a DB but passes gate + validation)', async () => {
    const svc = new ReceptionCopilotFeedbackService(null as any);
    expect(await svc.recordFeedback(give, { recommendationId: 'r1', rating: 'helpful' })).toEqual({ ok: false });
  });
  it('summary requires a management view permission', async () => {
    const svc = new ReceptionCopilotFeedbackService(null as any);
    await expect(svc.summary(give)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });   // give_feedback alone is not enough
    expect(await svc.summary(mgr)).toEqual({ helpful: 0, notHelpful: 0, dismissed: 0, helpfulRate: 0, byKind: [] });
  });
});
