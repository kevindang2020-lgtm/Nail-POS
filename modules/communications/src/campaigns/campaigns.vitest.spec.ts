import { AuditService, InMemoryAuditRepository } from '@aipowersalon/audit';
import { describe, it, expect } from 'vitest';
import { InMemoryCampaignsRepository } from './campaigns.repository';
import { CampaignsService, ValidationError, ForbiddenError, NotFoundError } from './campaigns.service';
import {
  canTransition, allowedTransitions, deriveMetrics, deriveKpis, normalizeChannel, applyCampaignFilters, type CampaignRow,
} from './campaigns.dto';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] };
const ctxB = { tenantId: 't_B', branchId: 'b9', userId: 'u9', role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] };
const viewerOnly = { tenantId: 't_A', branchId: 'b1', userId: 'u2', role: 'MANAGER', permissions: ['pos.marketing.view'] };

const newSvc = (audit?: AuditService) => new CampaignsService(new InMemoryCampaignsRepository(), audit);

const baseRow = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 'c1', tenantId: 't', branchId: null, name: 'Spring Into Glow', offer: '20% Off Gel Mani', channel: 'sms',
  audienceLabel: 'Lapsed', audienceSize: 2842, status: 'completed', scheduledAt: null,
  sentCount: 2842, openCount: 1370, clickCount: 358, replyCount: 236, bookingCount: 142,
  revenueCents: 425600, costCents: 83451, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z', ...over,
});

describe('campaigns pure logic', () => {
  it('lifecycle transitions: valid moves allowed, invalid + terminal rejected', () => {
    expect(canTransition('draft', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(false); // must pass through in_progress first
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'draft')).toBe(false);
    expect(allowedTransitions('completed')).toEqual([]);
  });
  it('deriveMetrics computes rates + ROI and guards divide-by-zero', () => {
    const m = deriveMetrics(baseRow());
    expect(m.openRate).toBe(48.2);   // 1370/2842
    expect(m.clickRate).toBe(12.6);  // 358/2842
    expect(m.roi).toBe(5.1);         // 425600/83451 ≈ 5.1
    const zero = deriveMetrics(baseRow({ sentCount: 0, costCents: 0 }));
    expect(zero.openRate).toBe(0);
    expect(zero.roi).toBe(0);
  });
  it('deriveKpis rolls up revenue, ROI and active count', () => {
    const k = deriveKpis([baseRow({ id: 'a', status: 'completed', revenueCents: 100000, costCents: 20000, sentCount: 100, openCount: 50 }), baseRow({ id: 'b', status: 'in_progress', revenueCents: 0, costCents: 0, sentCount: 0, openCount: 0 })]);
    expect(k.totalCampaigns).toBe(2);
    expect(k.activeCampaigns).toBe(1);
    expect(k.campaignRevenueCents).toBe(100000);
    expect(k.avgRoi).toBe(5); // 100000/20000
    expect(k.avgOpenRate).toBe(50);
  });
  it('normalizeChannel + filters', () => {
    expect(normalizeChannel('email')).toBe('email');
    expect(normalizeChannel('carrier-pigeon')).toBe('sms');
    const rows = [baseRow({ id: '1', channel: 'sms', status: 'completed', name: 'Glow' }), baseRow({ id: '2', channel: 'email', status: 'draft', name: 'Rebook' })];
    expect(applyCampaignFilters(rows, { channel: 'email' })).toHaveLength(1);
    expect(applyCampaignFilters(rows, { status: 'draft' })[0].id).toBe('2');
    expect(applyCampaignFilters(rows, { search: 'glow' })).toHaveLength(1);
  });
});

describe('CampaignsService', () => {
  it('create requires a name, starts in draft, and is tenant-scoped', async () => {
    const svc = newSvc();
    await expect(svc.create(ctx as any, { name: '  ' } as any)).rejects.toBeInstanceOf(ValidationError);
    const c = await svc.create(ctx as any, { name: 'VIP Rebooking', channel: 'email', audienceSize: 3124 });
    expect(c.status).toBe('draft');
    expect(c.channel).toBe('email');
    const state = await svc.getState(ctx as any, {});
    expect(state.campaigns).toHaveLength(1);
    expect(state.kpis.totalCampaigns).toBe(1);
  });

  it('enforces the lifecycle: draft → scheduled → in_progress → completed, rejecting illegal jumps', async () => {
    const svc = newSvc();
    const c = await svc.create(ctx as any, { name: 'Birthday Treat' });
    await svc.schedule(ctx as any, c.id);
    await svc.activate(ctx as any, c.id);
    const done = await svc.complete(ctx as any, c.id);
    expect(done.status).toBe('completed');
    // a completed campaign cannot be re-activated or edited
    await expect(svc.activate(ctx as any, c.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.update(ctx as any, c.id, { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an illegal direct transition (scheduled → completed)', async () => {
    const svc = newSvc();
    const c = await svc.create(ctx as any, { name: 'We Miss You' });
    await svc.schedule(ctx as any, c.id);
    await expect(svc.complete(ctx as any, c.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('isolates tenants and requires the manage permission for writes', async () => {
    const repo = new InMemoryCampaignsRepository();
    const svc = new CampaignsService(repo);
    const a = await svc.create(ctx as any, { name: 'A-only' });
    await svc.create(ctxB as any, { name: 'B-only' });
    // tenant A sees only its own
    expect((await svc.getState(ctx as any, {})).campaigns.map((c) => c.name)).toEqual(['A-only']);
    // tenant B cannot fetch A's campaign by id
    await expect(svc.detail(ctxB as any, a.id)).rejects.toBeInstanceOf(NotFoundError);
    // viewer without manage cannot create
    await expect(svc.create(viewerOnly as any, { name: 'nope' })).rejects.toBeInstanceOf(ForbiddenError);
    // platform read is cross-tenant
    const plat = await svc.listPlatform({});
    expect(plat.campaigns).toHaveLength(2);
  });

  it('platform state returns cross-tenant KPIs + rows (S10)', async () => {
    const svc = newSvc();
    const a = await svc.create(ctx as any, { name: 'A1' });
    await svc.schedule(ctx as any, a.id);
    await svc.activate(ctx as any, a.id);
    await svc.create(ctxB as any, { name: 'B1' });
    const state = await svc.getPlatformState({});
    expect(state.kpis.totalCampaigns).toBe(2);
    expect(state.kpis.activeCampaigns).toBe(1); // A1 is in_progress
    expect(state.campaigns).toHaveLength(2);
    // scoped to one tenant
    const onlyB = await svc.getPlatformState({ tenantId: 't_B' });
    expect(onlyB.campaigns.map((c) => c.name)).toEqual(['B1']);
  });

  it('writes a durable, tenant-scoped audit event on mutations', async () => {
    const audit = new AuditService(new InMemoryAuditRepository());
    const svc = newSvc(audit);
    const c = await svc.create(ctx as any, { name: 'Retail Upsell' });
    await svc.schedule(ctx as any, c.id);
    const page = await audit.list('t_A', {});
    expect(page.items.some((r) => r.module === 'campaigns' && r.action === 'campaign.created')).toBe(true);
    expect(page.items.some((r) => r.module === 'campaigns' && r.action === 'campaign.status_changed')).toBe(true);
    expect((await audit.list('t_B', {})).pagination.totalItems).toBe(0);
  });
});
