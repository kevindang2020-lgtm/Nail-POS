import { describe, it, expect } from 'vitest';
import { ProfileService, toBackupStatus, EMPTY_BACKUP_STATUS, type BackupStatus } from './profile.service';

// Backup state is real and honest: 'none' until a request exists, and a fresh request is 'requested'
// (never a fabricated 'completed'). The live insert/audit is covered by the migration-135 PG smoke.

describe('toBackupStatus', () => {
  it('maps a completed backup (latest + last-completed)', () => {
    const latest = { status: 'completed', requested_at: '2026-05-06T01:00:00Z' };
    const done = { completed_at: '2026-05-06T01:12:00Z', size_bytes: 4200000 };
    expect(toBackupStatus(latest, done)).toEqual<BackupStatus>({
      status: 'completed', requestedAt: '2026-05-06T01:00:00.000Z', lastCompletedAt: '2026-05-06T01:12:00.000Z', sizeBytes: 4200000,
    });
  });

  it('a fresh request with no completed backup shows requested + null lastCompletedAt', () => {
    const s = toBackupStatus({ status: 'requested', requested_at: '2026-06-26T12:00:00Z' }, null);
    expect(s.status).toBe('requested');
    expect(s.requestedAt).toBe('2026-06-26T12:00:00.000Z');
    expect(s.lastCompletedAt).toBeNull();
    expect(s.sizeBytes).toBeNull();
  });

  it('coerces an unknown/garbage status to none', () => {
    expect(toBackupStatus({ status: 'bogus', requested_at: '2026-06-26T12:00:00Z' }, null).status).toBe('none');
  });

  it('null/null → empty (never requested)', () => {
    expect(toBackupStatus(null, null)).toEqual(EMPTY_BACKUP_STATUS);
    expect(EMPTY_BACKUP_STATUS.status).toBe('none');
  });
});

describe('ProfileService backup methods (fail-soft without a live db)', () => {
  it('getBackupStatus returns empty with no db or tenant', async () => {
    expect(await new ProfileService(null as any).getBackupStatus({ tenantId: 't1' })).toEqual(EMPTY_BACKUP_STATUS);
    expect(await new ProfileService(null as any).getBackupStatus({})).toEqual(EMPTY_BACKUP_STATUS);
  });
  it('requestBackup fails soft to empty status with no db/session (no fabricated success)', async () => {
    expect(await new ProfileService(null as any).requestBackup({ tenantId: 't1', userId: 'u1' })).toEqual(EMPTY_BACKUP_STATUS);
    expect(await new ProfileService(null as any).requestBackup({})).toEqual(EMPTY_BACKUP_STATUS);
  });
});
