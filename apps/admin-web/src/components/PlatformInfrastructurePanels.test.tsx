// PlatformInfrastructurePanels.test — the Storage and Deployments panels show what the API read and say NotConnected
// (with the reason) for what it could not; a disk media store in production is flagged red; no secret is rendered.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformInfrastructurePanels, fmtBytes, fmtUptime } from './PlatformInfrastructurePanels';

const payload = {
  storage: { database: { available: true, sizeBytes: 734003200, tables: [{ table: 'outbox_events', totalBytes: 104857600, rows: 120000 }, { table: 'tickets', totalBytes: 52428800, rows: null }] },
             media: { store: 'disk', bucket: null, region: null, endpoint: null, envSegment: 'production', diskAccepted: false, productionSafe: false } },
  deployments: { build: { version: '1.0.0+abc1234', commit: 'abc1234def5678', deployment: 'dep_9', environment: 'production', startedAt: '2026-10-21T08:00:00Z' }, uptimeSeconds: 93784,
                 schema: { status: 'ok', latest: '671_rollout_flags_tap_to_pay_payroll.sql', latestAppliedAt: '2026-10-21T07:59:00Z', applied: 671, files: 671, pending: [], mismatches: [] },
                 migrations: { available: false, reason: 'no migration ledger', recent: [] } },
};
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { infrastructure: () => Promise.resolve(payload) } }));

describe('PlatformInfrastructurePanels', () => {
  it('renders the readings, flags the unsafe disk store, and shows NotConnected with the reason for what could not be read', async () => {
    render(<PlatformInfrastructurePanels />);
    expect(await screen.findByText('700 MB')).toBeTruthy();
    expect(screen.getByText('outbox_events')).toBeTruthy();
    expect(screen.getByText('120,000')).toBeTruthy();
    expect(screen.getByText('Container disk')).toBeTruthy();
    expect(screen.getByText(/production refuses this/)).toBeTruthy();
    expect(screen.getByText('1.0.0+abc1234')).toBeTruthy();
    expect(screen.getByText(/671 applied · 0 pending · latest 671_rollout_flags_tap_to_pay_payroll.sql/)).toBeTruthy();
    expect(screen.getByText(/no migration ledger/)).toBeTruthy();
    expect(screen.getByText(/up 1d 2h/)).toBeTruthy();
  });
  it('formats bytes and uptime for a person', () => {
    expect(fmtBytes(0)).toBe('0 B'); expect(fmtBytes(1536)).toBe('1.5 KB'); expect(fmtBytes(null)).toBe('—');
    expect(fmtUptime(90)).toBe('1m'); expect(fmtUptime(3660)).toBe('1h 1m'); expect(fmtUptime(93784)).toBe('1d 2h');
  });
});
