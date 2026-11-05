// BookingVerificationOversightScreen.test — BUILD_PLAN Phase 4: the platform view of booking verification — the module
// and emergency switches (reason; step-up on the server), counts, and every salon's state with its platform switches.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminBookingVerificationApi', () => ({ superAdminBookingVerificationApi: { policy: vi.fn(), tenants: vi.fn(), health: vi.fn(), setModule: vi.fn(), setEmergency: vi.fn(), setTenant: vi.fn() } }));
import { superAdminBookingVerificationApi as api } from '../api/superAdminBookingVerificationApi';
import { BookingVerificationOversightScreen } from './BookingVerificationOversightScreen';

const tenant = { tenantId: 't1', tenantName: 'Pilot Salon', enabled: true, requiredByPlatform: false, blockedByPlatform: false, bypassBlocked: false, providerConnected: true, providerValidated: false, effective: 'provider_not_ready' as const };
beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.policy).mockResolvedValue({ moduleEnabled: true, emergencyDisabled: false, reason: null, version: 2 } as never);
  vi.mocked(api.health).mockResolvedValue({ sinceHours: 24, requested: 10, codesSent: 12, verified: 7, overridden: 1, failed: 0, locked: 2, expired: 1, tenantsMisconfigured: 1 } as never);
  vi.mocked(api.tenants).mockResolvedValue([tenant] as never);
});

describe('Booking Verification Oversight', () => {
  it('shows the switches, the counts (warnings flagged) and the salon refusing bookings', async () => {
    render(<BookingVerificationOversightScreen />);
    expect(await screen.findByTestId('module-state')).toHaveTextContent('On');
    expect(screen.getByTestId('emergency-state')).toHaveTextContent('Running');
    expect(await screen.findByTestId('card-requested')).toHaveTextContent('10');
    expect(screen.getByTestId('card-locked').getAttribute('style')).toContain('rgb(255, 251, 235)');
    expect(screen.getByTestId('card-failed').getAttribute('style')).not.toContain('rgb(255, 251, 235)');
    expect(await screen.findByTestId('bv-tenant')).toHaveTextContent('Refusing bookings — provider not ready');
  });
  it('switching the module off needs a reason and calls the server switch', async () => {
    vi.mocked(api.setModule).mockResolvedValue({ moduleEnabled: false } as never);
    render(<BookingVerificationOversightScreen />);
    fireEvent.click(await screen.findByText('Switch module off…'));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'short' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy();
    expect(api.setModule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Twilio incident INC-42' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.setModule).toHaveBeenCalledWith(false, 'Twilio incident INC-42'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('Module switched off');
  });
  it('forbidding a salon’s manager override sends its WHOLE platform row with the reason', async () => {
    vi.mocked(api.setTenant).mockResolvedValue(undefined as never);
    render(<BookingVerificationOversightScreen />);
    fireEvent.click(await screen.findByText('Forbid override…'));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Staff targeted by callers' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.setTenant).toHaveBeenCalledWith('t1', { required: false, blocked: false, bypassBlocked: true, reason: 'Staff targeted by callers' }));
  });
  it('a failed load says so — never an empty green screen', async () => {
    vi.mocked(api.policy).mockRejectedValue(new Error('down')); vi.mocked(api.health).mockRejectedValue(new Error('down')); vi.mocked(api.tenants).mockRejectedValue(new Error('down'));
    render(<BookingVerificationOversightScreen />);
    expect(await screen.findByText('Could not load the platform switches.')).toBeTruthy();
    expect(screen.getByText('Could not load the verification summary.')).toBeTruthy();
    expect(screen.getByText('Could not load the per-salon view.')).toBeTruthy();
  });
});
