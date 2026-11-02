import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { appFlags: vi.fn(), setAppFlag: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { AppControlsPanel } from './AppControlsPanel';

const flags = (over: Partial<Record<string, boolean | null>> = {}) => ({
  ok: true,
  flags: [
    { key: 'public_listing', default: false, override: over.public_listing ?? null, enabled: over.public_listing ?? false },
    { key: 'show_on_map', default: false, override: null, enabled: false },
    { key: 'customer_app_booking', default: true, override: null, enabled: true },
    { key: 'technician_app', default: true, override: null, enabled: true },
    { key: 'customer_service_progress', default: true, override: null, enabled: true },
    { key: 'tech_live_ticket_edit', default: true, override: null, enabled: true },
  ],
});

describe('AppControlsPanel (build doc §26)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists all six controls with default/override states', async () => {
    (superAdminApi.appFlags as any).mockResolvedValue(flags());
    render(<AppControlsPanel tenantId="t1" />);
    expect(await screen.findByText('Public listing in Customer App search')).toBeInTheDocument();
    expect(screen.getByText('Tech live ticket edit')).toBeInTheDocument();
    expect(screen.getAllByText(/Default \(/)).toHaveLength(6); // no overrides yet → no Reset buttons
    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });

  it('toggling posts an explicit override and reloads', async () => {
    (superAdminApi.appFlags as any).mockResolvedValueOnce(flags()).mockResolvedValueOnce(flags({ public_listing: true }));
    (superAdminApi.setAppFlag as any).mockResolvedValue({ ok: true });
    render(<AppControlsPanel tenantId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable Public listing in Customer App search' }));
    await waitFor(() => expect(superAdminApi.setAppFlag).toHaveBeenCalledWith('t1', 'public_listing', true));
    expect(await screen.findByText('Override: on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Public listing in Customer App search' })).toBeInTheDocument();
  });

  it('Reset sends null to revert to the platform default', async () => {
    (superAdminApi.appFlags as any).mockResolvedValueOnce(flags({ public_listing: true })).mockResolvedValueOnce(flags());
    (superAdminApi.setAppFlag as any).mockResolvedValue({ ok: true });
    render(<AppControlsPanel tenantId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset Public listing in Customer App search' }));
    await waitFor(() => expect(superAdminApi.setAppFlag).toHaveBeenCalledWith('t1', 'public_listing', null));
  });
});
