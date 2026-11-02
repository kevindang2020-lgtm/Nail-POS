// ai-marketing-campaign.vitest.spec.ts — approval spine over a fake CampaignOrchestrationPort. Proves the AI
// layer reuses the campaign lifecycle, validates before creating, and NEVER activates/sends on approval.
import { describe, it, expect, vi } from 'vitest';
import {
  AiMarketingCampaignService,
  CampaignOrchestrationValidationError,
  type CampaignOrchestrationPort,
} from './ai-marketing-campaign.service';
import type { AiMarketingContext } from './ai-marketing.dto';

function ctx(over: Partial<AiMarketingContext> = {}): AiMarketingContext {
  return { tenantId: 'tenantA', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['marketing.manage'], ...over };
}
function row(over: Record<string, unknown> = {}): any {
  return { id: 'camp1', name: 'Rebook', channel: 'sms', offer: null, audienceLabel: '—', audienceSize: 40, status: 'draft', scheduledAt: null, ...over };
}
function fakePort(over: Partial<CampaignOrchestrationPort> = {}): CampaignOrchestrationPort & {
  transition: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (_c, req: any) => row({ ...req, status: 'draft' }));
  const detail = vi.fn(async (_c, id: string) => row({ id }));
  const update = vi.fn(async (_c, id: string, patch: any) => row({ id, ...patch }));
  const transition = vi.fn(async (_c, id: string, to: string) => row({ id, status: to }));
  return { create, detail, update, transition, ...over } as any;
}

const goodSubmit = {
  name: 'Gel rebooking', channel: 'sms', audienceLabel: 'Rebooking due', audienceSize: 60,
  draftText: 'Hi {{customer_first_name}}, time for your next visit at {{salon_name}}. {{booking_link}}',
};

describe('submitForApproval', () => {
  it('creates a draft campaign via the existing service and returns a checklist', async () => {
    const port = fakePort();
    const svc = new AiMarketingCampaignService(port);
    const res = await svc.submitForApproval(ctx(), goodSubmit);
    expect(port.create).toHaveBeenCalledOnce();
    expect(res.campaign.status).toBe('draft');
    expect(res.draftText).toContain('{{booking_link}}');
    expect(res.approvalChecklist.some((c) => c.item.includes('Awaiting explicit human approval'))).toBe(true);
  });

  it('rejects a draft that invents a discount with no approved offer', async () => {
    const port = fakePort();
    const svc = new AiMarketingCampaignService(port);
    await expect(
      svc.submitForApproval(ctx(), { ...goodSubmit, draftText: 'Get 25% off! {{booking_link}}' }),
    ).rejects.toBeInstanceOf(CampaignOrchestrationValidationError);
    expect(port.create).not.toHaveBeenCalled();
  });

  it('rejects an empty audience', async () => {
    const svc = new AiMarketingCampaignService(fakePort());
    await expect(svc.submitForApproval(ctx(), { ...goodSubmit, audienceSize: 0 })).rejects.toBeInstanceOf(
      CampaignOrchestrationValidationError,
    );
  });

  it('rejects missing required fields', async () => {
    const svc = new AiMarketingCampaignService(fakePort());
    await expect(svc.submitForApproval(ctx(), { channel: 'sms' })).rejects.toBeInstanceOf(
      CampaignOrchestrationValidationError,
    );
  });
});

describe('approveAndSchedule', () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString();

  it('schedules a draft campaign and NEVER activates/sends', async () => {
    const port = fakePort();
    const svc = new AiMarketingCampaignService(port);
    const out = await svc.approveAndSchedule(ctx(), 'camp1', future);
    expect(port.update).toHaveBeenCalledWith(expect.anything(), 'camp1', { scheduledAt: expect.any(String) });
    expect(port.transition).toHaveBeenCalledWith(expect.anything(), 'camp1', 'scheduled');
    // guardrail: approval must not move a campaign to in_progress (that is the gated send pipeline)
    const targets = port.transition.mock.calls.map((c) => c[2]);
    expect(targets).not.toContain('in_progress');
    expect(out.status).toBe('scheduled');
  });

  it('rejects a non-future schedule time', async () => {
    const svc = new AiMarketingCampaignService(fakePort());
    await expect(svc.approveAndSchedule(ctx(), 'camp1', '2000-01-01T00:00:00Z')).rejects.toBeInstanceOf(
      CampaignOrchestrationValidationError,
    );
  });

  it('rejects approving a campaign that is not a draft', async () => {
    const port = fakePort({ detail: vi.fn(async (_c, id: string) => row({ id, status: 'scheduled' })) as any });
    const svc = new AiMarketingCampaignService(port);
    await expect(svc.approveAndSchedule(ctx(), 'camp1', future)).rejects.toBeInstanceOf(
      CampaignOrchestrationValidationError,
    );
    expect(port.transition).not.toHaveBeenCalled();
  });

  it('rejects approving when the audience is empty', async () => {
    const port = fakePort({ detail: vi.fn(async (_c, id: string) => row({ id, status: 'draft', audienceSize: 0 })) as any });
    const svc = new AiMarketingCampaignService(port);
    await expect(svc.approveAndSchedule(ctx(), 'camp1', future)).rejects.toBeInstanceOf(
      CampaignOrchestrationValidationError,
    );
  });
});

describe('cancel', () => {
  it('transitions to cancelled', async () => {
    const port = fakePort();
    const svc = new AiMarketingCampaignService(port);
    const out = await svc.cancel(ctx(), 'camp1');
    expect(port.transition).toHaveBeenCalledWith(expect.anything(), 'camp1', 'cancelled');
    expect(out.status).toBe('cancelled');
  });
});
