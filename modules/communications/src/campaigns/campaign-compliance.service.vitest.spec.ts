import { describe, it, expect } from 'vitest';
import { CampaignComplianceService } from './campaign-compliance.service';
import { InMemoryComplianceRepo } from './campaign-compliance.repository';

const svc = () => new CampaignComplianceService(new InMemoryComplianceRepo());

describe('CampaignComplianceService', () => {
  it('summarizes alerts (all compliant when no open flags)', async () => {
    const s = svc();
    // Compliance flags are TENANT-OWNED. `alertsSummary` now requires the tenant from the verified session — it
    // used to read every tenant's flags, which meant any salon's staff could see every other salon's.
    const T1 = 'tenant-1';
    expect((await s.alertsSummary(T1)).allCompliant).toBe(true);
    await s.raiseFlag({ subjectType: 'tenant_campaign', subjectId: 'c1', tenantId: T1, flagType: 'high_opt_out' });
    await s.raiseFlag({ subjectType: 'tenant_campaign', subjectId: 'c2', tenantId: T1, flagType: 'spam_complaints' });
    const summary = await s.alertsSummary(T1);
    expect(summary.available).toBe(true);
    expect(summary.allCompliant).toBe(false);
    expect(summary.totalFlagged).toBe(2);
  });

  it('pauses a live campaign as an audited action, and refuses completed ones', async () => {
    const s = svc();
    const noReason = await s.pause({ subjectType: 'tenant_campaign', subjectId: 'c1', currentStatus: 'in_progress', reason: '' });
    expect(noReason.ok).toBe(false);
    const done = await s.pause({ subjectType: 'tenant_campaign', subjectId: 'c1', currentStatus: 'completed', reason: 'abuse' });
    expect(done.ok).toBe(false);
    const ok = await s.pause({ subjectType: 'tenant_campaign', subjectId: 'c1', currentStatus: 'in_progress', reason: 'excessive opt-outs' });
    expect(ok.ok).toBe(true);
    expect(ok.flag!.actionTaken).toBe('paused');
    expect(ok.flag!.status).toBe('actioned');
  });

  it('validates and stores campaign limits', async () => {
    const s = svc();
    expect((await s.setLimits({ maxSendsPerDay: -1 })).ok).toBe(false);
    const ok = await s.setLimits({ maxSendsPerDay: 5000, quietHoursStart: 21, quietHoursEnd: 8, minHoursBetween: 24 });
    expect(ok.ok).toBe(true);
    expect((await s.getLimits())!.maxSendsPerDay).toBe(5000);
  });
});
