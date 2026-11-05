// Phase 2 QA: the top-bar tenant scope selector. Default shows "All Branches" (platform-wide). Opening the menu
// lazy-loads the salon list; choosing a salon sets the shared scope (button reflects it); "All Branches" clears it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listTenants = vi.fn();
vi.mock('../api/superAdminHardwarePackagesApi', () => ({ hwApi: { listTenants: () => listTenants() } }));

import { ScopeProvider } from './ScopeContext';
import { TenantScopeSelector } from './TenantScopeSelector';

const renderSel = () => render(<ScopeProvider><TenantScopeSelector /></ScopeProvider>);

beforeEach(() => {
  listTenants.mockReset();
  listTenants.mockResolvedValue([
    { id: 't1', name: 'Glow Nails Spa', code: 'GLW' },
    { id: 't2', name: 'Polished Studio', code: null },
  ]);
});

describe('TenantScopeSelector', () => {
  it('defaults to All Branches / Super Admin and does not fetch until opened', () => {
    renderSel();
    expect(screen.getByText('All Branches')).toBeTruthy();
    expect(screen.getByText('Super Admin')).toBeTruthy();
    expect(listTenants).not.toHaveBeenCalled();
  });

  it('opens, lazy-loads salons, scopes to a chosen salon, then clears', async () => {
    renderSel();
    fireEvent.click(screen.getAllByRole('button')[0]); // toggle open
    expect(listTenants).toHaveBeenCalledTimes(1);

    // salon list resolves asynchronously
    await waitFor(() => expect(screen.getByText(/Glow Nails Spa/)).toBeTruthy());

    fireEvent.click(screen.getByText(/Glow Nails Spa/));
    // button now reflects the scoped salon
    expect(screen.getByText('Glow Nails Spa')).toBeTruthy();
    expect(screen.getByText('Scoped view')).toBeTruthy();

    // re-open and clear back to platform-wide
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(screen.getByText(/Platform-wide/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Platform-wide/));
    expect(screen.getByText('All Branches')).toBeTruthy();
    expect(screen.getByText('Super Admin')).toBeTruthy();
  });
});
