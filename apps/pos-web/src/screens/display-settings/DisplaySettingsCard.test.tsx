// DisplaySettingsCard.test.tsx — Dual-Screen mandate §118: the owner configures the customer display's check-in from the POS
// (Devices → Customer Displays). Only what changed is sent. Kevin (Oct 28 2026): the customer display is English only, so
// there is no language choice on this card.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../api/posDisplaySettingsApi', () => ({ posDisplaySettingsApi: { get: () => h.get(), save: (p: any) => h.save(p) } }));
import { DisplaySettingsCard } from './DisplaySettingsCard';

const S = { enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true,
  technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: true, customerLinkingEnabled: true, showWaitEstimate: true,
  autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8, displayLanguages: ['en'] };

beforeEach(() => { h.get.mockReset(); h.save.mockReset(); h.get.mockResolvedValue({ ...S }); h.save.mockImplementation(async (p: any) => ({ ...S, ...p })); });

describe('Customer display settings (§118)', () => {
  it('shows the salon\'s options and NO display-language choice (the display is English only)', async () => {
    render(<DisplaySettingsCard />);
    expect(await screen.findByText(/Check-in is on for your salon/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tiếng Việt (Vietnamese)')).toBeNull();
    expect(screen.queryByText('Languages on the display')).toBeNull();
  });
  it('a toggle saves only itself', async () => {
    render(<DisplaySettingsCard />);
    await screen.findByText(/Check-in is on for your salon/);
    fireEvent.click(screen.getByLabelText('Walk-in check-in'));
    fireEvent.click(screen.getByLabelText('Show the estimated wait'));
    fireEvent.click(screen.getByRole('button', { name: 'Save display settings' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ walkinCheckinEnabled: false, showWaitEstimate: false }));
  });
  it('nothing changed: Save is off; check-in switched off by the platform says so', async () => {
    h.get.mockResolvedValue({ ...S, enabled: false });
    render(<DisplaySettingsCard />);
    expect(await screen.findByText(/Check-in is off for your salon/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save display settings' })).toBeDisabled();
  });
  it('a refusal is shown, an unauthorised reader sees no card', async () => {
    h.save.mockRejectedValue(new Error('Choose at least one display language: English or Vietnamese.'));
    const { unmount } = render(<DisplaySettingsCard />);
    await screen.findByText(/Check-in is on/);
    fireEvent.click(screen.getByLabelText('Walk-in check-in'));
    fireEvent.click(screen.getByRole('button', { name: 'Save display settings' }));
    expect(await screen.findByText('Choose at least one display language: English or Vietnamese.')).toBeInTheDocument();
    unmount();
    h.get.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const { container } = render(<DisplaySettingsCard />);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');   // no card, no error text — this reader simply has no settings access
  });
});
