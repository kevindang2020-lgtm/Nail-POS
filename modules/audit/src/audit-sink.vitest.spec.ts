// audit-sink.vitest.spec.ts — the one-object port reaches the audit trail (Phase 1 of BUILD_PLAN_2026-10-06).
//
// The bug this pins: services called AuditService.record({ tenantId, module, action }) with ONE object through
// `audit as any`, and every such audit was silently dropped. The adapter is the only legal bridge now.
import { describe, it, expect } from 'vitest';
import { AuditService } from './audit.service';
import { InMemoryAuditRepository } from './audit.repository';
import { auditSinkFor, RecordingAuditSink } from './audit-sink';

const T = '11111111-1111-1111-1111-111111111111';
const U = '33333333-3333-3333-3333-333333333333';

describe('auditSinkFor', () => {
  it('a tenant entry becomes an audit_events row with the actor, module, action, summary and metadata', async () => {
    const repo = new InMemoryAuditRepository();
    const sink = auditSinkFor(new AuditService(repo));
    await sink.record({ tenantId: T, branchId: null, userId: U, role: 'OWNER', module: 'booking_verification', action: 'verification_enabled', summary: 'on', metadata: { enabled: true, apiKey: 'sk-live' } });
    const page = await repo.list(T, {});
    expect(page.items).toHaveLength(1);
    const row = page.items[0];
    expect(row).toMatchObject({ tenantId: T, actorUserId: U, actorRole: 'OWNER', module: 'booking_verification', action: 'verification_enabled', summary: 'on' });
    expect(row.metadata).toEqual({ enabled: true, apiKey: '[redacted]' });   // redaction still applies
  });

  it('a tenant-less entry (a Super Admin action) is a PLATFORM row, not a dropped one', async () => {
    const repo = new InMemoryAuditRepository();
    const sink = auditSinkFor(new AuditService(repo));
    await sink.record({ userId: U, module: 'booking_verification', action: 'platform_emergency_disabled', summary: 'off everywhere', metadata: { reason: 'incident' } });
    expect((await repo.list(T, {})).items).toHaveLength(0);
    expect(repo.platformRows).toHaveLength(1);
    expect(repo.platformRows[0]).toMatchObject({ userId: U, module: 'booking_verification', action: 'platform_emergency_disabled', metadata: { reason: 'incident' } });
  });

  it('calling the raw service with ONE object is what used to happen — and it records NOTHING', async () => {
    // Documents the failure mode the adapter exists for: this is why `audit as any` is a gate failure.
    const repo = new InMemoryAuditRepository();
    const svc = new AuditService(repo);
    const r = await (svc as any).record({ tenantId: T, module: 'm', action: 'a' });
    expect(r).toBeNull();
    expect((await repo.list(T, {})).items).toHaveLength(0);
  });

  it('never throws into the caller even when the store is down', async () => {
    const sink = auditSinkFor({ record: async () => { throw new Error('down'); }, recordPlatform: async () => { throw new Error('down'); } } as any);
    await expect(sink.record({ tenantId: T, module: 'm', action: 'a' })).rejects.toThrow();   // the SERVICE swallows; a bare port does not
    const svc = new AuditService({ record: () => { throw new Error('down'); }, recordPlatform: () => { throw new Error('down'); } } as any);
    await expect(auditSinkFor(svc).record({ tenantId: T, module: 'm', action: 'a' })).resolves.toBeUndefined();
    await expect(auditSinkFor(svc).record({ module: 'm', action: 'a' })).resolves.toBeUndefined();
  });

  it('RecordingAuditSink keeps entries for tests', async () => {
    const s = new RecordingAuditSink();
    await s.record({ tenantId: T, module: 'm', action: 'a' });
    expect(s.entries).toHaveLength(1);
  });
});
