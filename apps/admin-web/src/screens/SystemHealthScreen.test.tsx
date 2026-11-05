// System Health: renders live process + DB metrics from GET /super-admin/system-health, formats uptime, and degrades
// cleanly when the database probe fails (no crash, error surfaced, counts hidden).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemHealth: vi.fn() } }));

import { superAdminApi } from '../api/superAdminApi';
import { SystemHealthScreen } from './SystemHealthScreen';

const healthy = {
  ok: true, generatedAt: '2026-06-17T12:00:00Z',
  process: { uptimeSeconds: 90061, node: 'v20.11.0', pid: 4242, memoryRssMb: 128.5, memoryHeapUsedMb: 64.2, env: 'production' },
  database: { driver: 'postgres', ok: true, latencyMs: 12, serverVersion: 'PostgreSQL 16.2', tableCount: 95, counts: { tenants: 28, users: 140, activeSubscriptions: 22 } },
};

beforeEach(() => { vi.clearAllMocks(); });
const renderScreen = () => render(<MemoryRouter><SystemHealthScreen /></MemoryRouter>);

describe('SystemHealthScreen', () => {
  it('shows Operational status and the process/DB metrics', async () => {
    (superAdminApi.systemHealth as any).mockResolvedValue(healthy);
    renderScreen();
    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('1d 1h 1m 1s')).toBeInTheDocument();      // fmtUptime(90061)
    expect(screen.getByText('128.5 MB')).toBeInTheDocument();          // RSS
    expect(screen.getByText('v20.11.0')).toBeInTheDocument();          // node
    expect(screen.getByText('production')).toBeInTheDocument();        // env
    expect(screen.getByText('postgres')).toBeInTheDocument();          // db driver
  });

  it('renders DB counts when the database is reachable', async () => {
    (superAdminApi.systemHealth as any).mockResolvedValue(healthy);
    renderScreen();
    await screen.findByText('Operational');
    const tenants = screen.getByText('Tenants').closest('div') as HTMLElement;
    expect(within(tenants).getByText('28')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();               // users
    expect(screen.getByText('PostgreSQL 16.2')).toBeInTheDocument();   // server version
  });

  it('degrades cleanly when the database probe fails (no crash, error shown, counts hidden)', async () => {
    (superAdminApi.systemHealth as any).mockResolvedValue({
      ok: false, generatedAt: '2026-06-17T12:00:00Z',
      process: { uptimeSeconds: 5, node: 'v20.11.0', pid: 4242, memoryRssMb: 100, memoryHeapUsedMb: 50, env: 'production' },
      database: { driver: 'postgres', ok: false, error: 'connection refused' },
    });
    renderScreen();
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('connection refused')).toBeInTheDocument();
    expect(screen.queryByText('Tenants')).not.toBeInTheDocument();     // counts grid hidden while DB is down
  });

  it('surfaces a fetch error instead of spinning forever', async () => {
    (superAdminApi.systemHealth as any).mockRejectedValue(new Error('boom'));
    renderScreen();
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
