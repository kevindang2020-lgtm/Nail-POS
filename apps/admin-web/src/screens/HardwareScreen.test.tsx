// QA for the Hardware Packages screen: status-coloured rows, the ?tenantId deep-link filter (View All from
// Tenants / Salons), status tab filtering, and search wiring to the backend.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { hardware: vi.fn(), createHardware: vi.fn(), updateHardware: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { HardwareScreen } from './HardwareScreen';

const row = (over: any = {}) => ({ id: 'hw1', tenant_id: 't1', imac_color: 'Silver', imac_serial: 'IMAC-1', clover_flex_serial: '', checkin_display_serial: '', status: 'delivered', agreement_status: 'signed', payment_setup_status: 'complete', ...over });

describe('HardwareScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.hardware as any).mockResolvedValue({ rows: [row()], total: 1 });
  });

  it('renders a package with a coloured status badge + payment badge', async () => {
    render(<MemoryRouter><HardwareScreen /></MemoryRouter>);
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(await screen.findByText(/pay: Complete/i)).toBeInTheDocument();
  });

  it('applies the ?tenantId deep-link filter and shows a clearable chip', async () => {
    render(<MemoryRouter initialEntries={['/hardware-packages?tenantId=t1&source=tenants-salons-dashboard']}><HardwareScreen /></MemoryRouter>);
    await waitFor(() => expect(superAdminApi.hardware).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' })));
    expect(await screen.findByText(/Filtered to tenant/i)).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText(/from Tenants \/ Salons/i)).toBeInTheDocument();
  });

  it('filters by status when a tab is selected', async () => {
    render(<MemoryRouter><HardwareScreen /></MemoryRouter>);
    await screen.findByText('Delivered');
    (superAdminApi.hardware as any).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Installed' }));
    await waitFor(() => expect(superAdminApi.hardware).toHaveBeenCalledWith(expect.objectContaining({ status: 'installed' })));
  });

  it('passes the search term to the backend', async () => {
    render(<MemoryRouter><HardwareScreen /></MemoryRouter>);
    await screen.findByText('Delivered');
    (superAdminApi.hardware as any).mockClear();
    fireEvent.change(screen.getByPlaceholderText(/Search iMac/i), { target: { value: 'IMAC-1' } });
    await waitFor(() => expect(superAdminApi.hardware).toHaveBeenCalledWith(expect.objectContaining({ search: 'IMAC-1' })));
  });
});
