import { describe, it, expect } from 'vitest';
import { categoryFor, severityFor, toActivity, applyFilters, paginate, summarize, type ActivityRaw } from './tenant-activity-core';
import { SuperAdminTenantActivityService } from './tenant-activity.service';
import { InMemoryTenantActivityRepo } from './tenant-activity.repository';

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

const raw: ActivityRaw[] = [
  { id: '1', actionType: 'super_admin_tenant_created', entityType: 'tenant', entityId: 't1', tenantId: 't1', tenantName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', actorUserId: 'admin1', actorRole: 'SUPER_ADMIN', createdAt: iso(5) },
  { id: '2', actionType: 'payment_setup_completed', entityType: 'tenant_payment_config', entityId: 't2', tenantId: 't2', tenantName: 'Diamond Nail Bar', salonCode: 'DIAM-1002', actorUserId: 'admin1', actorRole: 'SUPER_ADMIN', createdAt: iso(21) },
  { id: '3', actionType: 'hardware_package_shipped', entityType: 'hardware_package', entityId: 'h9', tenantId: 't3', tenantName: 'Bella Nails Lounge', salonCode: 'BELL-1003', actorUserId: 'admin2', actorRole: 'SUPER_ADMIN', createdAt: iso(38) },
  { id: '4', actionType: 'ai_package_activated', entityType: 'ai_package', entityId: 'a4', tenantId: 't4', tenantName: 'Paris Nail Studio', salonCode: 'PARI-1004', actorUserId: null, actorRole: null, createdAt: iso(60) },
  { id: '5', actionType: 'payment_failed', entityType: 'payment', entityId: 'p7', tenantId: 't5', tenantName: 'Queen Nails', salonCode: 'QUEE-1005', actorUserId: null, actorRole: null, createdAt: iso(75) },
];

describe('tenant-activity-core', () => {
  it('categorizes actions into the dashboard buckets', () => {
    expect(categoryFor('super_admin_tenant_created')).toBe('tenant');
    expect(categoryFor('payment_setup_completed')).toBe('payment');
    expect(categoryFor('payment_gateway_connected')).toBe('payment');
    expect(categoryFor('hardware_package_shipped')).toBe('hardware');
    expect(categoryFor('ai_package_activated')).toBe('ai');
    expect(categoryFor('tenant_application_submitted')).toBe('application');
    expect(categoryFor('support_access_opened')).toBe('support');
    expect(categoryFor('warning_sent')).toBe('support');
    expect(categoryFor('something_else')).toBe('other');
  });

  it('derives severity from the action', () => {
    expect(severityFor('payment_failed')).toBe('error');
    expect(severityFor('payment_setup_completed')).toBe('success');
    expect(severityFor('tenant_paused')).toBe('warning');
    expect(severityFor('tenant_viewed')).toBe('info');
  });

  it('formats a raw audit row into an activity item with icon + title + names', () => {
    const a = toActivity(raw[0]);
    expect(a.icon).toBe('🟢');
    expect(a.title).toBe('New tenant registered');
    expect(a.tenantName).toBe('Luxe Nails & Spa');
    expect(a.salonCode).toBe('LUXE-1001');
    expect(a.category).toBe('tenant');
    expect(a.severity).toBe('info');
    expect(a.ageLabel).toMatch(/ago|\//);
  });

  it('filters by category, severity, eventType, tenant, and search', () => {
    const items = raw.map(toActivity);
    expect(applyFilters(items, { page: 1, limit: 25, category: 'payment' }).map((i) => i.id).sort()).toEqual(['2', '5']);
    expect(applyFilters(items, { page: 1, limit: 25, severity: 'error' }).map((i) => i.id)).toEqual(['5']);
    expect(applyFilters(items, { page: 1, limit: 25, eventType: 'hardware' }).map((i) => i.id)).toEqual(['3']);
    expect(applyFilters(items, { page: 1, limit: 25, tenantId: 't4' }).map((i) => i.id)).toEqual(['4']);
    expect(applyFilters(items, { page: 1, limit: 25, search: 'queen' }).map((i) => i.id)).toEqual(['5']);
    expect(applyFilters(items, { page: 1, limit: 25, search: 'LUXE-1001' }).map((i) => i.id)).toEqual(['1']);
  });

  it('paginates and reports total + pageCount', () => {
    const items = raw.map(toActivity);
    const p = paginate(items, 2, 2);
    expect(p.total).toBe(5);
    expect(p.pageCount).toBe(3);
    expect(p.items.length).toBe(2);
  });

  it('summarizes counts by category + warning/error', () => {
    const s = summarize(raw.map(toActivity));
    expect(s.total).toBe(5);
    expect(s.tenant).toBe(1);
    expect(s.payment).toBe(2);
    expect(s.hardware).toBe(1);
    expect(s.ai).toBe(1);
    expect(s.warningError).toBe(1);
  });
});

describe('SuperAdminTenantActivityService', () => {
  const svc = new SuperAdminTenantActivityService(new InMemoryTenantActivityRepo(raw));

  it('lists newest-first with pagination metadata', async () => {
    const r = await svc.list({ limit: 3 });
    expect(r.total).toBe(5);
    expect(r.items.length).toBe(3);
    expect(r.items[0].id).toBe('1'); // newest
  });

  it('applies sanitized filters and a filter-aware summary', async () => {
    const r = await svc.list({ category: 'payment' });
    expect(r.items.map((i) => i.id).sort()).toEqual(['2', '5']);
    const s = await svc.summary({ category: 'payment' });
    expect(s.total).toBe(2);
    expect(s.payment).toBe(2);
  });

  it('ignores an invalid severity/category instead of erroring', async () => {
    const r = await svc.list({ severity: 'nonsense', category: 'bogus' });
    expect(r.total).toBe(5);
  });

  it('returns an empty feed (never fabricated) when there is no data', async () => {
    const empty = new SuperAdminTenantActivityService(new InMemoryTenantActivityRepo([]));
    const r = await empty.list({});
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
  });

  it('recent() returns the newest N with timeAgo', async () => {
    const r = await svc.recent({ limit: 3 });
    expect(r.activities.length).toBe(3);
    expect(r.activities[0].id).toBe('1'); // newest
    expect(typeof r.activities[0].timeAgo).toBe('string');
    expect(r.activities[0].icon).toBe('🟢'); // tenant_created
  });

  it('byId() resolves a single activity and 404-shapes a miss', async () => {
    const hit = await svc.byId('3');
    expect((hit as any).id).toBe('3');
    expect((hit as any).icon).toBe('📦'); // hardware shipped
    const miss = await svc.byId('does-not-exist');
    expect((miss as any).ok).toBe(false);
  });

  it('maps plan-upgrade events to ⬆️', async () => {
    const repo = new InMemoryTenantActivityRepo([
      { id: 'p1', actionType: 'plan_upgraded_to_enterprise', entityType: 'subscription', entityId: 's1', tenantId: 't1', tenantName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', actorUserId: 'admin1', actorRole: 'SUPER_ADMIN', createdAt: iso(3) },
    ]);
    const r = await new SuperAdminTenantActivityService(repo).recent({});
    expect(r.activities[0].icon).toBe('⬆️');
    expect(r.activities[0].title).toBe('Plan upgraded to Enterprise');
  });
});
