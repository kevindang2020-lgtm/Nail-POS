// CustomerPhoneOversightScreen.test — BUILD_PLAN Phase 3 (audit E13): the platform view of phone changes, counts only,
// and a sweep that needs a reason.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminCustomerPhoneApi', () => ({ superAdminCustomerPhoneApi: { oversight: vi.fn(), byTenant: vi.fn(), sweep: vi.fn() } }));
import { superAdminCustomerPhoneApi as api } from '../api/superAdminCustomerPhoneApi';
import { CustomerPhoneOversightScreen } from './CustomerPhoneOversightScreen';

const summary = { sinceHours: 168, tenantsWithUpdatesEnabled: 4, updatesRequested: 12, verified: 9, failed: 1, duplicateConflicts: 2, synchronizationFailures: 1, synchronizationDead: 0, manualConfirmations: 1, changesWithoutSms: 0, awaitingApproval: 0, openSessions: 2, expiredSessions: 3 };

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.oversight).mockResolvedValue(summary as never);
  vi.mocked(api.byTenant).mockResolvedValue([{ tenantId: 't1', tenantName: 'Pilot Salon', requested: 12, verified: 9, failed: 1, syncFailed: 1, awaitingApproval: 0 }] as never);
});

describe('Customer Phone Oversight', () => {
  it('shows the counts and the per-salon table; a failed sync is flagged', async () => {
    render(<CustomerPhoneOversightScreen />);
    expect(await screen.findByTestId('card-updatesRequested')).toHaveTextContent('12');
    expect(screen.getByTestId('card-synchronizationFailures')).toHaveTextContent('1');
    expect(screen.getByTestId('card-synchronizationFailures').getAttribute('style')).toContain('rgb(255, 251, 235)');
    expect(screen.getByTestId('card-synchronizationDead').getAttribute('style')).not.toContain('rgb(255, 251, 235)');
    expect(await screen.findByText('Pilot Salon')).toBeTruthy();
    expect(api.oversight).toHaveBeenCalledWith(168);
  });
  it('changing the window reloads with it', async () => {
    render(<CustomerPhoneOversightScreen />);
    await screen.findByTestId('card-verified');
    fireEvent.change(screen.getByLabelText('Time window'), { target: { value: '24' } });
    await waitFor(() => expect(api.oversight).toHaveBeenCalledWith(24));
  });
  it('a failed request says so — never an empty green screen', async () => {
    vi.mocked(api.oversight).mockRejectedValue(new Error('down'));
    vi.mocked(api.byTenant).mockRejectedValue(new Error('down'));
    render(<CustomerPhoneOversightScreen />);
    expect(await screen.findByText('Could not load the phone-change summary.')).toBeTruthy();
    expect(screen.getByText('Could not load the per-salon view.')).toBeTruthy();
  });
  it('the sweep needs a reason of at least 5 characters and reports what it did', async () => {
    vi.mocked(api.sweep).mockResolvedValue({ ok: true, expired: 2, syncQueued: 1 } as never);
    render(<CustomerPhoneOversightScreen />);
    fireEvent.click(await screen.findByText('Run sweep now'));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'no' } });
    fireEvent.click(screen.getByText('Run sweep'));
    expect(await screen.findByText('Enter at least 5 characters.')).toBeTruthy();
    expect(api.sweep).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'stuck sync after Twilio outage' } });
    fireEvent.click(screen.getByText('Run sweep'));
    await waitFor(() => expect(api.sweep).toHaveBeenCalledWith('stuck sync after Twilio outage'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('2 expired change(s) closed, 1 synchronisation(s) queued');
  });
});
