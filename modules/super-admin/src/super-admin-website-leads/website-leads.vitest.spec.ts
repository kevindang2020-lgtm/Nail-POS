import { describe, it, expect } from 'vitest';
import { computeLeadKpis, computeLeadScore, scoreBand, filterLeads, paginate, analyticsBySource, analyticsByStatus, topSources, type LeadRow } from './website-leads-core';
import { InMemoryWebsiteLeadsRepo } from './website-leads.repository';
import { WebsiteLeadsService } from './website-leads.service';

const lead = (over: Partial<LeadRow>): LeadRow => ({
  id: Math.random().toString(36).slice(2), salonName: 'Salon', contactName: 'Person', phone: '555', email: 'a@b.com', city: 'NJ', state: 'NJ',
  source: 'website_form', leadScore: 50, status: 'new', message: null, currentPos: null, technicianCount: null, monthlyCardVolumeCents: null,
  assignedToUserId: null, assignedToName: null, nextFollowUpAt: null, convertedApplicationId: null, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

describe('website-leads core', () => {
  const rows = [
    lead({ status: 'new', source: 'website_form' }), lead({ status: 'new', source: 'instagram' }),
    lead({ status: 'contacted', source: 'website_form' }), lead({ status: 'qualified', source: 'referral' }),
    lead({ status: 'converted', source: 'website_form' }), lead({ status: 'spam', source: 'website_form' }),
    lead({ status: 'archived', source: 'instagram' }),
  ];
  it('KPIs: total excludes spam/archived; conversion rate = converted/total', () => {
    const k = computeLeadKpis(rows);
    expect(k.totalLeads).toBe(5); // new,new,contacted,qualified,converted
    expect(k.newLeads).toBe(2); expect(k.contacted).toBe(1); expect(k.qualified).toBe(1); expect(k.converted).toBe(1);
    expect(k.conversionRatePct).toBe(20); // 1/5
  });
  it('lead score from signals + bands', () => {
    expect(computeLeadScore({ monthlyCardVolumeCents: 6_000_000, technicianCount: 9, phone: '1', email: 'e', message: 'x'.repeat(50), source: 'referral' })).toBe(85);
    expect(scoreBand(85)).toBe('hot'); expect(scoreBand(60)).toBe('warm'); expect(scoreBand(10)).toBe('cold'); expect(scoreBand(null)).toBe('none');
  });
  it('filters by source/status/score/search', () => {
    expect(filterLeads(rows, { source: 'website_form' })).toHaveLength(4);
    expect(filterLeads(rows, { status: 'new' })).toHaveLength(2);
    expect(filterLeads(rows, { scoreRange: 'warm' }).length).toBeGreaterThan(0);
    expect(filterLeads([lead({ salonName: 'Glamour Nails' })], { search: 'glamour' })).toHaveLength(1);
  });
  it('date range compares on the calendar day and is inclusive of the end day', () => {
    const r2 = [lead({ createdAt: '2026-05-05T14:30:00.000Z' }), lead({ createdAt: '2026-05-10T09:00:00.000Z' })];
    expect(filterLeads(r2, { dateTo: '2026-05-05' })).toHaveLength(1);   // kept despite the 14:30 timestamp
    expect(filterLeads(r2, { dateFrom: '2026-05-10' })).toHaveLength(1);
    expect(filterLeads(r2, { dateFrom: '2026-05-05', dateTo: '2026-05-10' })).toHaveLength(2);
    expect(filterLeads(r2, { dateTo: '2026-05-04' })).toHaveLength(0);
  });
  it('paginates', () => {
    const p = paginate(rows, 1, 3);
    expect(p.items).toHaveLength(3); expect(p.pagination).toMatchObject({ totalItems: 7, totalPages: 3, page: 1 });
  });
  it('analytics by source/status/top', () => {
    expect(analyticsBySource(rows)[0]).toMatchObject({ source: 'website_form' }); // most common among counted
    expect(analyticsByStatus(rows).map((s) => s.status)).toEqual(['new', 'contacted', 'qualified', 'converted']);
    expect(topSources(rows)[0].rank).toBe(1);
  });
});

describe('WebsiteLeadsService', () => {
  const mk = (rows: LeadRow[] = []) => { const repo = new InMemoryWebsiteLeadsRepo(); repo.leads = rows; const svc = new WebsiteLeadsService(repo, null); return { repo, svc }; };

  it('state returns kpis + paginated leads + analytics + permissions', async () => {
    const { svc } = mk([lead({ status: 'new' }), lead({ status: 'converted' })]);
    const s = await svc.state({ page: 1, limit: 10 });
    expect(s.kpis.totalLeads).toBe(2);
    expect(s.leads).toHaveLength(2);
    expect(s.analytics.bySource.length).toBeGreaterThan(0);
    expect(s.permissions.convert).toBe(true);
  });

  it('createLead auto-scores and logs an activity', async () => {
    const { repo, svc } = mk();
    const r = await svc.createLead({ userId: 'admin' }, { salonName: 'Glamour Nails', contactName: 'Sarah', email: 'a@b.com', phone: '555', source: 'referral', monthlyCardVolumeCents: 6_000_000, technicianCount: 9, message: 'x'.repeat(50) });
    expect(r.lead.salonName).toBe('Glamour Nails');
    expect(r.lead.leadScore).toBeGreaterThanOrEqual(80); // strong signals
    expect(repo.activities.some((a) => a.activityType === 'created')).toBe(true);
  });

  it('rejects an invalid status', async () => {
    const { repo, svc } = mk([lead({})]);
    await expect(svc.setStatus({}, repo.leads[0].id, 'nonsense')).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('convert creates an application, flips status, is idempotent', async () => {
    const { repo, svc } = mk([lead({ status: 'qualified' })]);
    const id = repo.leads[0].id;
    const r = await svc.convertToApplication({ userId: 'admin' }, id);
    expect(r.applicationId).toBeTruthy();
    expect(repo.leads[0].status).toBe('converted');
    expect(repo.leads[0].convertedApplicationId).toBeTruthy();
    await expect(svc.convertToApplication({}, id)).rejects.toMatchObject({ code: 'bad_request' }); // already_converted
  });

  it('recalculate-score updates the score; notes require text', async () => {
    const { repo, svc } = mk([lead({ leadScore: 0, source: 'referral', monthlyCardVolumeCents: 6_000_000, technicianCount: 9, phone: '1', email: 'e', message: 'x'.repeat(50) })]);
    const id = repo.leads[0].id;
    const r = await svc.recalculateScore({}, id);
    expect(r.leadScore).toBeGreaterThanOrEqual(80);
    await expect(svc.addNote({}, id, '   ')).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('exports filtered CSV with a header row', async () => {
    const { svc } = mk([lead({ salonName: 'Glamour Nails', status: 'new' })]);
    const csv = await svc.exportCsv({ status: 'new' });
    expect(csv.split('\n')[0]).toContain('salonName');
    expect(csv).toContain('Glamour Nails');
  });
});
