// Usage Limits: renders per-tenant counters from /super-admin/platform/usage-limits, blocks non-numeric/negative input
// client-side (so a NaN -> JSON null never reaches the API), and posts a valid whole-number limit via the real route.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { usageLimits: vi.fn(), setUsageLimit: vi.fn() } }));

import { superAdminApi } from '../api/superAdminApi';
import { UsageLimitsScreen } from './UsageLimitsScreen';

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.usageLimits as any).mockResolvedValue([
    { tenantId: 't1', tenantName: 'Luxe Nails & Spa', tenantCode: 'LUXE-1001', metrics: [{ metric: 'customers', usedValue: 50, limitValue: 100 }] },
  ]);
  (superAdminApi.setUsageLimit as any).mockResolvedValue({ tenantId: 't1', metric: 'customers', limitValue: 500 });
});

const renderScreen = () => render(<MemoryRouter><UsageLimitsScreen /></MemoryRouter>);

describe('UsageLimitsScreen', () => {
  it('renders tenant counters used vs limit', async () => {
    renderScreen();
    expect(await screen.findByText(/Luxe Nails & Spa/)).toBeInTheDocument();
    expect(screen.getByText('50/100')).toBeInTheDocument();
  });

  it('blocks non-numeric input client-side (no API call, shows guidance)', async () => {
    renderScreen();
    await screen.findByText(/Luxe Nails & Spa/);
    const customersInput = screen.getAllByRole('textbox')[0];      // metrics order: customers first
    fireEvent.change(customersInput, { target: { value: 'abc' } });
    fireEvent.click(screen.getAllByText('Set')[0]);
    expect(screen.getByText(/whole number of 0 or more/i)).toBeInTheDocument();
    expect(superAdminApi.setUsageLimit).not.toHaveBeenCalled();
  });

  it('blocks a negative limit client-side', async () => {
    renderScreen();
    await screen.findByText(/Luxe Nails & Spa/);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '-5' } });
    fireEvent.click(screen.getAllByText('Set')[0]);
    expect(superAdminApi.setUsageLimit).not.toHaveBeenCalled();
  });

  it('posts a valid whole-number limit via the real route', async () => {
    renderScreen();
    await screen.findByText(/Luxe Nails & Spa/);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '500' } });
    fireEvent.click(screen.getAllByText('Set')[0]);
    await waitFor(() => expect(superAdminApi.setUsageLimit).toHaveBeenCalledWith('t1', 'customers', 500));
  });
});
