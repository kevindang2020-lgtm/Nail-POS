// SystemOpsPaymentDevices.test — Secure Tap to Pay §51 (Oct 27 2026): the platform payment-phone security panel.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemPaymentDevices: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SystemOpsPaymentDevices } from './SystemOpsPaymentDevices';

beforeEach(() => { vi.mocked(superAdminApi.systemPaymentDevices).mockReset(); });

describe('SystemOpsPaymentDevices', () => {
  it('totals, alerts (incidents + raw attempts), the unusual-registration watch list and app versions', async () => {
    vi.mocked(superAdminApi.systemPaymentDevices).mockResolvedValue({
      scope: 'platform', windowDays: 30, generatedAt: 'x', devices: { active: 12, pending: 3, revoked: 2 }, registrations: { last24h: 7, window: 40 }, revocations: 2, suspensions: 1, claimConflicts: 4,
      signals: { revoked_device_attempt: 1, key_mismatch: 2, request_replayed: 0, app_version_refused: 5, attestation_failed: 0, unusual_registration: 1 },
      appVersions: [{ version: '1.4.0', devices: 10 }, { version: '1.3.9', devices: 2 }],
      topRegistrations: [{ tenantId: 't1', tenantName: 'Glow Nails', last24h: 5 }],
      process: { events: { key_mismatch: 9, unusual_registration: 3 }, appVersions: { '1.4': 20 } },
    } as never);
    render(<SystemOpsPaymentDevices />);
    const totals = await screen.findByTestId('ops-payment-devices-totals');
    expect(totals.textContent).toBe('74012324');
    expect(screen.getByTestId('ops-payment-alert-key_mismatch')).toHaveTextContent('Key mismatch29');
    expect(screen.getByTestId('ops-payment-alert-unusual_registration')).toHaveTextContent('Unusual registration13');
    expect(screen.getByText('Glow Nails')).toBeTruthy();
    expect(screen.getByTestId('ops-payment-versions')).toHaveTextContent('1.4.0 (10) · 1.3.9 (2)');
  });
  it('an error is shown, not swallowed', async () => {
    vi.mocked(superAdminApi.systemPaymentDevices).mockRejectedValue(new Error('Forbidden'));
    render(<SystemOpsPaymentDevices />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });
});
