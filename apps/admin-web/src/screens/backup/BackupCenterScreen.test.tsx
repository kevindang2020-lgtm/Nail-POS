// BackupCenterScreen.test — G9 Backup & DR (Nov 5 2026): English-only Backup Center. "Not reported" when the catalog is
// empty (never a fake green); only VERIFIED points are selectable; the plan shows blockers/warnings; a finance
// confirmation gates approval when money moved after the restore time.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../api/superAdminBackupsApi', () => ({ superAdminBackupsApi: {
  overview: vi.fn(), tenants: vi.fn(), points: vi.fn(), point: vi.fn(), plans: vi.fn(), plan: vi.fn(), createPlan: vi.fn(), approve: vi.fn(), execute: vi.fn(), cancel: vi.fn(),
} }));
import { superAdminBackupsApi as api } from '../../api/superAdminBackupsApi';
import { BackupCenterScreen } from './BackupCenterScreen';

const T = { id: 'bc000000-0000-4000-8000-0000000000a1', name: 'Salon One', tenantCode: 'BKC1', status: 'active', branches: [{ id: 'bc000000-0000-4000-8000-0000000000b1', name: 'Downtown', salonCode: 'S-DT' }] };
const P_OK = { id: 'p-ok', scope: 'platform', source: 'provider_snapshot', recoveryTimestamp: '2026-11-05T05:00:00.000Z', verificationStatus: 'VERIFIED', immutableReplica: 'present' };
const P_UN = { id: 'p-un', scope: 'platform', source: 'provider_snapshot', recoveryTimestamp: '2026-11-04T05:00:00.000Z', verificationStatus: 'UNVERIFIED', immutableReplica: 'missing' };
const plan = (over: Record<string, unknown> = {}) => ({ id: 'plan1', mode: 'FULL_TENANT', status: 'AWAITING_APPROVAL', planSha256: 'f'.repeat(64), targetTimestamp: P_OK.recoveryTimestamp,
  plan: { blockers: [], warnings: [{ code: 'PAYMENTS_AFTER_TARGET', message: '1 payment(s) after the requested time.' }], financialEventsAfterTarget: 1, point: { schemaVersion: '819.sql' }, currentSchemaVersion: '819.sql' }, ...over });

beforeEach(() => { for (const f of Object.values(api)) vi.mocked(f as any).mockReset(); });

describe('Backup Center', () => {
  it('an empty catalog says Not reported — no invented status', async () => {
    vi.mocked(api.overview).mockResolvedValue({ catalogConfigured: false } as never);
    render(<BackupCenterScreen />);
    expect(await screen.findByTestId('backup-not-reported')).toHaveTextContent('Not reported');
  });
  it('shows the latest recoverable time and a missed midnight checkpoint', async () => {
    vi.mocked(api.overview).mockResolvedValue({ catalogConfigured: true, tenants: { total: 2, protectedByLatestVerifiedPlatformPoint: 2 },
      points: { latestRecoverableTimestamp: '2026-11-05T05:00:00.000Z', lastPlatformPoint: null, last7Days: { recorded: 1, failed: 0, unverified: 0 }, verifiedWithoutImmutableCopy: 0, storageBytes: 4096 },
      evidence: { rpoSeconds: 600, lastRestoreDrill: null }, schedule: { nextMidnightCheckpoint: '2026-11-06T05:00:00.000Z', missed: { missed: true, scheduledAt: '2026-11-05T05:00:00.000Z' } }, pitr: null } as never);
    render(<BackupCenterScreen />);
    expect(await screen.findByTestId('latest-recoverable')).toHaveTextContent('Nov 5, 2026');
    expect(screen.getByTestId('midnight-missed')).toBeInTheDocument();
  });
  it('restore flow: only verified points selectable; finance confirmation gates approval', async () => {
    vi.mocked(api.overview).mockResolvedValue({ catalogConfigured: false } as never);
    vi.mocked(api.tenants).mockResolvedValue({ items: [T] } as never);
    vi.mocked(api.points).mockResolvedValue({ items: [P_OK, P_UN], calendar: [{ date: '2026-11-05', snapshots: 1, pitr: false }] } as never);
    vi.mocked(api.createPlan).mockResolvedValue(plan() as never);
    vi.mocked(api.approve).mockResolvedValue(plan({ status: 'APPROVED' }) as never);
    render(<BackupCenterScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Restore Center' }));
    fireEvent.change(screen.getByLabelText('Search salon'), { target: { value: 'BKC1' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.click(await screen.findByText(/Salon One/));
    fireEvent.click(screen.getByLabelText('Whole salon (all branches)'));
    await waitFor(() => expect(screen.getAllByRole('radio', { name: /platform/ })).toHaveLength(2));
    const [ok, un] = screen.getAllByRole('radio', { name: /platform/ });
    expect(un).toBeDisabled();
    fireEvent.click(ok);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Accidental bulk delete' } });
    fireEvent.click(screen.getByText('Preview impact'));
    expect(await screen.findByText(/PAYMENTS_AFTER_TARGET/)).toBeInTheDocument();
    expect(vi.mocked(api.createPlan).mock.calls[0][0]).toMatchObject({ mode: 'FULL_TENANT', tenantId: T.id, branchId: null, recoveryPointId: 'p-ok' });
    const approve = screen.getByText('Approve plan');
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/reviewed with finance/));
    fireEvent.click(approve);
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('plan1', 'f'.repeat(64), true));
    expect(await screen.findByText('Begin restore')).toBeInTheDocument();
  });
});
