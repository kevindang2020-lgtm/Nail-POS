// TechnicianWorkforcePanel (merge Oct 12 2026, other chat's phase-3 test adapted to OUR routes + vocabulary):
// statuses shown SEPARATELY; time off approve / decline (decline needs a reason, inline — no native dialog); a manager
// entry; certification verify / revoke (revoke needs a reason; a REVOKED cert offers nothing — REVOKED is terminal).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: vi.fn(), timeOff: vi.fn(), certifications: vi.fn(), setUnavailable: vi.fn(), decideTimeOff: vi.fn(), createTimeOff: vi.fn(), verifyCertification: vi.fn(),
}));
vi.mock('../api/posWorkforceApi', () => ({ posWorkforceApi: h }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { TechnicianWorkforcePanel } from './TechnicianWorkforcePanel';

const state = { tenantId: 'x', branchId: null, technicianId: 't1', employment: 'active', clock: 'ON_BREAK', shift: 'ON_SHIFT', queue: 'BREAK', service: 'IDLE', presence: 'online', currentTicketId: null, manualUnavailable: false, openShiftId: null, breakStartedAt: null, updatedAt: '', version: 1 };
const FUTURE = '2099-03-01T14:00:00.000Z'; const LATER = '2099-03-02T22:00:00.000Z';
const timeOff = [{ id: 'to1', tenantId: 'x', technicianId: 't1', branchId: null, startsAt: FUTURE, endsAt: LATER, kind: 'VACATION', status: 'pending', reason: 'Family trip', requestedBy: 'u', approvedBy: null, decidedAt: null, decisionNote: null, createdAt: FUTURE }];
const cert = (o: any) => ({ id: 'c1', technicianId: 't1', globalTechProfileId: null, name: 'State Nail License', issuer: 'NJ Board', issuedAt: null, expiresAt: '2099-01-01', hasDocument: true, verificationStatus: 'UNVERIFIED', verifiedAt: null, verifiedByUserId: null, revokedReason: null, daysToExpiry: 1000, createdAt: '', updatedAt: '', ...o });

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.state.mockResolvedValue(state); h.timeOff.mockResolvedValue(timeOff);
  h.certifications.mockResolvedValue([cert({}), cert({ id: 'c2', name: 'Acrylic Specialist', verificationStatus: 'VERIFIED' }), cert({ id: 'c3', name: 'Old Cert', verificationStatus: 'REVOKED', revokedReason: 'lapsed' })]);
  for (const k of ['setUnavailable', 'decideTimeOff', 'createTimeOff', 'verifyCertification'] as const) h[k].mockResolvedValue({});
});

describe('TechnicianWorkforcePanel', () => {
  it('shows employment / clock / shift / queue / service as separate statuses', async () => {
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    expect(await screen.findByText('On break')).toBeInTheDocument();
    for (const t of ['On shift', 'Break', 'Idle', 'Active']) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('toggles "not taking customers" through the workforce route', async () => {
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark not taking customers' }));
    await waitFor(() => expect(h.setUnavailable).toHaveBeenCalledWith('t1', true));
  });

  it('approves a pending request; declining asks for a reason inline and sends it (lowercase decision vocabulary)', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decideTimeOff).toHaveBeenCalledWith('t1', 'to1', 'approved'));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Short-staffed that week' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' }).slice(-1)[0]);
    await waitFor(() => expect(h.decideTimeOff).toHaveBeenCalledWith('t1', 'to1', 'rejected', 'Short-staffed that week'));
    expect(prompt).not.toHaveBeenCalled();
  });

  it('a manager entry validates the window, then posts ISO times + kind', async () => {
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add time off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save time off' }));
    expect(await screen.findByText('Pick a start and an end.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Time off start'), { target: { value: '2099-04-02T18:00' } });
    fireEvent.change(screen.getByLabelText('Time off end'), { target: { value: '2099-04-01T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time off' }));
    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
    expect(h.createTimeOff).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Time off end'), { target: { value: '2099-04-03T09:00' } });
    fireEvent.change(screen.getByLabelText('Time off kind'), { target: { value: 'SICK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save time off' }));
    await waitFor(() => expect(h.createTimeOff).toHaveBeenCalledWith('t1', { startsAt: new Date('2099-04-02T18:00').toISOString(), endsAt: new Date('2099-04-03T09:00').toISOString(), kind: 'SICK' }));
  });

  it('verifies an unverified certification, revokes a verified one with a reason, offers nothing on a revoked one', async () => {
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    expect(await screen.findByText('Old Cert')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(h.verifyCertification).toHaveBeenCalledWith('t1', 'c1', 'VERIFIED'));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'License lapsed' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' }).slice(-1)[0]);
    await waitFor(() => expect(h.verifyCertification).toHaveBeenCalledWith('t1', 'c2', 'REVOKED', 'License lapsed'));
  });

  it('says live status is unavailable when the workforce read fails (never a fabricated state)', async () => {
    h.state.mockRejectedValue(new Error('down'));
    render(<TechnicianWorkforcePanel technicianId="t1" />);
    expect(await screen.findByText('Live status is unavailable right now.')).toBeInTheDocument();
  });
});
