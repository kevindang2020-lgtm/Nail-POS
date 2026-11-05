import { describe, it, expect } from 'vitest';
import { InMemoryAuditRepository, type AuditRepositoryPort } from './audit.repository';
import { AuditService } from './audit.service';
import { normalizeSeverity, normalizeStatus, redactMetadata, buildAuditRow, applyAuditFilters, type AuditEventRow } from './audit.dto';

const ctxA = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'MANAGER', actorName: 'Alice' };
const ctxB = { tenantId: 't_B', branchId: 'b9', userId: 'u9', role: 'OWNER', actorName: 'Bob' };

describe('pure helpers', () => {
  it('normalizeSeverity clamps invalid to low', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
    expect(normalizeSeverity('bogus')).toBe('low');
    expect(normalizeSeverity(undefined)).toBe('low');
  });
  it('normalizeStatus defaults to success', () => {
    expect(normalizeStatus('failed')).toBe('failed');
    expect(normalizeStatus('nope')).toBe('success');
  });
  it('redactMetadata removes sensitive values at any depth, keeps structure', () => {
    const red = redactMetadata({ amount: 500, cardNumber: '4111111111111111', nested: { cvv: '123', note: 'ok' }, password: 'x' });
    expect(red.amount).toBe(500);
    expect(red.cardNumber).toBe('[redacted]');
    expect(red.password).toBe('[redacted]');
    expect((red.nested as any).cvv).toBe('[redacted]');
    expect((red.nested as any).note).toBe('ok');
  });
  it('buildAuditRow normalizes + redacts + fills actor from ctx', () => {
    const row = buildAuditRow(ctxA, { module: ' checkout ', action: ' payment.refunded ', severity: 'x' as any, metadata: { token: 'sk_live_x', n: 1 } });
    expect(row.module).toBe('checkout');
    expect(row.action).toBe('payment.refunded');
    expect(row.severity).toBe('low');
    expect(row.actorName).toBe('Alice');
    expect(row.metadata.token).toBe('[redacted]');
    expect(row.metadata.n).toBe(1);
  });
  it('applyAuditFilters filters by module, severity and search', () => {
    const rows: AuditEventRow[] = [
      { id: '1', tenantId: 't', branchId: null, occurredAt: '2026-06-01T00:00:00Z', actorUserId: null, actorRole: null, actorName: 'Lee', module: 'checkout', action: 'payment.captured', resourceType: null, resourceId: null, summary: 'paid', status: 'success', severity: 'low', ip: null, device: null, metadata: {} },
      { id: '2', tenantId: 't', branchId: null, occurredAt: '2026-06-02T00:00:00Z', actorUserId: null, actorRole: null, actorName: 'Lee', module: 'auth', action: 'login.failed', resourceType: null, resourceId: null, summary: 'bad pw', status: 'failed', severity: 'high', ip: null, device: null, metadata: {} },
    ];
    expect(applyAuditFilters(rows, { module: 'auth' })).toHaveLength(1);
    expect(applyAuditFilters(rows, { severity: 'high' })[0].action).toBe('login.failed');
    expect(applyAuditFilters(rows, { search: 'captured' })).toHaveLength(1);
    expect(applyAuditFilters(rows, { from: '2026-06-02T00:00:00Z' })).toHaveLength(1);
  });
});

describe('AuditService + in-memory repo', () => {
  it('records an event and reads it back tenant-scoped', async () => {
    const svc = new AuditService(new InMemoryAuditRepository());
    await svc.record(ctxA, { module: 'checkout', action: 'payment.refunded', severity: 'high', summary: 'refund $30', resourceType: 'payment', resourceId: 'p1' });
    const page = await svc.list('t_A', {});
    expect(page.pagination.totalItems).toBe(1);
    expect(page.items[0].action).toBe('payment.refunded');
    expect(page.items[0].severity).toBe('high');
  });

  it('enforces tenant isolation on reads', async () => {
    const repo = new InMemoryAuditRepository();
    const svc = new AuditService(repo);
    await svc.record(ctxA, { module: 'checkout', action: 'a.A' });
    await svc.record(ctxB, { module: 'checkout', action: 'a.B' });
    const a = await svc.list('t_A', {});
    const b = await svc.list('t_B', {});
    expect(a.items.map((r) => r.action)).toEqual(['a.A']);
    expect(b.items.map((r) => r.action)).toEqual(['a.B']);
    expect(a.items.some((r) => r.tenantId === 't_B')).toBe(false);
  });

  it('platform read is cross-tenant and can scope to one tenant', async () => {
    const svc = new AuditService(new InMemoryAuditRepository());
    await svc.record(ctxA, { module: 'm', action: 'a.A' });
    await svc.record(ctxB, { module: 'm', action: 'a.B' });
    const all = await svc.listPlatform({});
    expect(all.pagination.totalItems).toBe(2);
    const onlyB = await svc.listPlatform({ tenantId: 't_B' });
    expect(onlyB.items.map((r) => r.action)).toEqual(['a.B']);
  });

  it('redacts sensitive metadata before storage (append-only safety)', async () => {
    const svc = new AuditService(new InMemoryAuditRepository());
    await svc.record(ctxA, { module: 'checkout', action: 'pay', metadata: { cvv: '999', amountCents: 1000 } });
    const page = await svc.list('t_A', {});
    expect(page.items[0].metadata.cvv).toBe('[redacted]');
    expect(page.items[0].metadata.amountCents).toBe(1000);
  });

  it('record() is resilient: no tenant → null, repo failure → null (never throws into the caller)', async () => {
    const svc = new AuditService(new InMemoryAuditRepository());
    expect(await svc.record({ tenantId: '' } as any, { module: 'm', action: 'a' })).toBeNull();

    const throwingRepo: AuditRepositoryPort = {
      record: () => { throw new Error('db down'); },
      recordPlatform: () => { throw new Error('db down'); },
      list: async () => ({ items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } }),
      listPlatform: async () => ({ items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } }),
    };
    const svc2 = new AuditService(throwingRepo);
    await expect(svc2.record(ctxA, { module: 'm', action: 'a' })).resolves.toBeNull();
    await expect(svc2.recordPlatform({ module: 'm', action: 'a' })).resolves.toBeUndefined();
  });

  it('append-only: the repository port exposes no mutation/deletion methods', () => {
    const repo: any = new InMemoryAuditRepository();
    expect(typeof repo.record).toBe('function');
    expect(typeof repo.list).toBe('function');
    expect(repo.update).toBeUndefined();
    expect(repo.delete).toBeUndefined();
    expect(repo.remove).toBeUndefined();
  });
});

import { buildAuditRow as _build } from './audit.dto';
describe('a system actor is audited, not lost (audit_events.actor_user_id is UUID)', () => {
  it("a 'system:<job>' actor keeps its name and binds NULL, not a non-UUID, to actor_user_id", () => {
    const r = _build({ tenantId: 't', userId: 'system:campaigns', role: 'SYSTEM' } as any, { module: 'campaigns', action: 'x' } as any);
    expect(r.actorUserId).toBeNull(); expect(r.actorName).toBe('system:campaigns'); expect(r.actorRole).toBe('SYSTEM');
  });
  it('a real user id is unchanged', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const r = _build({ tenantId: 't', userId: id, role: 'OWNER' } as any, { module: 'm', action: 'a' } as any);
    expect(r.actorUserId).toBe(id); expect(r.actorName).toBeNull();
  });
});

