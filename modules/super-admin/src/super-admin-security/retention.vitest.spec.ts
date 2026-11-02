import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionService, RetentionError } from './retention.service';
import { InMemoryRetentionRepository } from './retention.repository';

let repo: InMemoryRetentionRepository; let svc: RetentionService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1' };
beforeEach(() => { repo = new InMemoryRetentionRepository(); svc = new RetentionService(repo); });

describe('RetentionService', () => {
  it('reports no active rule honestly before configuration', async () => {
    expect((await svc.get('notifications')).available).toBe(false);
  });

  it('saves a valid rule (versioned + audited) respecting compliance floors', async () => {
    const r = await svc.upsert('audit_events', 400, 'archive', actor);
    expect(r.version).toBe(1); expect(r.retentionDays).toBe(400); expect(r.action).toBe('archive');
    expect((await svc.get('audit_events')).available).toBe(true);
    expect(repo.audits[0]).toMatchObject({ action: 'retention_rule_changed', dataClass: 'audit_events' });
  });

  it('REJECTS a retention below the compliance floor', async () => {
    await expect(svc.upsert('audit_events', 30, 'delete', actor)).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.upsert('login_attempts', 10, 'delete', actor)).rejects.toMatchObject({ code: 'invalid' });
    expect(repo.rows).toHaveLength(0);
  });

  it('rejects an unknown data class or a negative retention', async () => {
    await expect(svc.upsert('bogus', 100, 'delete', actor)).rejects.toBeInstanceOf(RetentionError);
    await expect(svc.upsert('notifications', -5, 'delete', actor)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('versions each update and archives the prior active rule', async () => {
    await svc.upsert('notifications', 30, 'delete', actor);
    const r2 = await svc.upsert('notifications', 60, 'anonymize', actor);
    expect(r2.version).toBe(2);
    expect(repo.rows.filter((x) => x.dataClass === 'notifications' && x.status === 'active')).toHaveLength(1);
    expect(repo.rows.filter((x) => x.dataClass === 'notifications' && x.status === 'archived')).toHaveLength(1);
  });

  it('previewPurge is a non-destructive dry run that counts eligible records + ledgers the run', async () => {
    await svc.upsert('notifications', 30, 'delete', actor);
    repo.counts['notifications'] = 42; // countable in this test
    const p = await svc.previewPurge('notifications', actor);
    expect(p.eligibleCount).toBe(42); expect(p.netToProcess).toBe(42);
    expect(p.message).toMatch(/Dry run — nothing deleted/);
    expect(repo.runs[0]).toMatchObject({ dataClass: 'notifications', mode: 'dry_run', net: 42 });
    expect(repo.rows.find((r) => r.dataClass === 'notifications')!.status).toBe('active'); // nothing deleted/changed
  });

  it('previewPurge requires an active rule, and is honest when a class is not countable', async () => {
    await expect(svc.previewPurge('notifications', actor)).rejects.toMatchObject({ code: 'not_found' });
    await svc.upsert('session_history', 30, 'delete', actor); // no count seeded → unsupported
    await expect(svc.previewPurge('session_history', actor)).rejects.toMatchObject({ code: 'unsupported' });
  });
});
