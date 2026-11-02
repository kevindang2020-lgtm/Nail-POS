import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockMfaGet, mockPwGet, mockSessGet, mockPwSet } = vi.hoisted(() => ({ mockMfaGet: vi.fn(), mockPwGet: vi.fn(), mockSessGet: vi.fn(), mockPwSet: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityMfaPolicy: () => mockMfaGet(),
  securityPasswordPolicy: () => mockPwGet(),
  securitySessionPolicy: () => mockSessGet(),
  securityMfaPolicySet: vi.fn(), securitySessionPolicySet: vi.fn(),
  securityPasswordPolicySet: (b: any) => mockPwSet(b),
} }));
import { SecurityPolicyModal } from './SecurityPolicyModal';

beforeEach(() => {
  mockMfaGet.mockReset(); mockPwGet.mockReset(); mockSessGet.mockReset(); mockPwSet.mockReset();
  mockMfaGet.mockResolvedValue({ kind: 'mfa', available: false, note: 'none' });
  mockSessGet.mockResolvedValue({ kind: 'session', available: false });
  mockPwGet.mockResolvedValue({ kind: 'password', available: true, version: 2, compliant: true, config: { minLength: 14, maxLength: 64, compromisedCheck: true, commonRejection: true, lockoutThreshold: 5, historyCount: 5 } });
  mockPwSet.mockResolvedValue({ kind: 'password', version: 3, compliant: false, complianceFailing: ['minLength ≥ 12', 'compromised-password detection on'] });
});

describe('SecurityPolicyModal', () => {
  it('opens on the given initial kind and shows the active version + compliance', async () => {
    render(<SecurityPolicyModal initialKind="password" onClose={() => {}} />);
    expect(await screen.findByText(/Active version 2 · Compliant/)).toBeInTheDocument();
  });

  it('reports no active policy honestly for an unconfigured kind', async () => {
    render(<SecurityPolicyModal initialKind="mfa" onClose={() => {}} />);
    expect(await screen.findByText(/No active mfa policy yet/)).toBeInTheDocument();
  });

  it('saves a policy and surfaces the live compliance verdict with failing checks', async () => {
    render(<SecurityPolicyModal initialKind="password" onClose={() => {}} />);
    await screen.findByText(/Active version 2/);
    fireEvent.click(screen.getByRole('button', { name: /Save policy/ }));
    await waitFor(() => expect(mockPwSet).toHaveBeenCalled());
    expect(await screen.findByText(/Saved v3 — Review/)).toBeInTheDocument();
    expect(screen.getByText('minLength ≥ 12')).toBeInTheDocument();
    expect(screen.getByText('compromised-password detection on')).toBeInTheDocument();
  });

  it('switches tabs and loads that kind', async () => {
    render(<SecurityPolicyModal initialKind="password" onClose={() => {}} />);
    await screen.findByText(/Active version 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    await waitFor(() => expect(mockSessGet).toHaveBeenCalled());
    expect(await screen.findByText(/No active session policy yet/)).toBeInTheDocument();
  });
});
