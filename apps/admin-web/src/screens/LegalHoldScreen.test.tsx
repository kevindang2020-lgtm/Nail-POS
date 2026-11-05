import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const legalHolds = vi.fn();
const applyLegalHold = vi.fn();
const releaseLegalHold = vi.fn();
const customerDataOversight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  legalHolds: (...a: any[]) => legalHolds(...a),
  applyLegalHold: (...a: any[]) => applyLegalHold(...a),
  releaseLegalHold: (...a: any[]) => releaseLegalHold(...a),
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
} }));

import { LegalHoldScreen } from './LegalHoldScreen';

const hold = (over: any = {}) => ({ id: 'lh_1', tenantId: 't1', customerId: 'CUS-7', branchId: null, matterRef: 'LIT-7', reason: 'litigation', scope: 'customer', status: 'active', appliedByUserId: null, appliedAt: '2026-05-01T00:00:00Z', effectiveAt: '2026-05-01T00:00:00Z', reviewAt: null, releasedByUserId: null, releasedAt: null, releaseReason: null, internalNotes: null, ...over });

describe('LegalHoldScreen', () => {
  beforeEach(() => {
    legalHolds.mockReset(); legalHolds.mockResolvedValue([hold()]);
    applyLegalHold.mockReset(); applyLegalHold.mockResolvedValue({ ok: true, hold: { id: 'lh_2' } });
    releaseLegalHold.mockReset(); releaseLegalHold.mockResolvedValue({ ok: true });
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue({ customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 10 }] });
  });

  it('renders the header, summary, and holds table', async () => {
    render(<MemoryRouter><LegalHoldScreen /></MemoryRouter>);
    expect(await screen.findByText('Legal Hold')).toBeInTheDocument();
    expect(await screen.findByText('LIT-7')).toBeInTheDocument();
    expect(screen.getByText('Tenants Covered')).toBeInTheDocument();
    expect(screen.getByText('Release')).toBeInTheDocument();
  });

  it('validates the apply form before submitting', async () => {
    render(<MemoryRouter><LegalHoldScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('+ Place hold'));
    fireEvent.click(await screen.findByText('Place legal hold'));
    expect(await screen.findByText(/Matter \/ case reference is required/)).toBeInTheDocument();
    expect(applyLegalHold).not.toHaveBeenCalled();
  });

  it('applies a hold with valid input', async () => {
    render(<MemoryRouter><LegalHoldScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('+ Place hold'));
    await waitFor(() => expect(customerDataOversight).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Tenant *' }), { target: { value: 't1' } });
    fireEvent.change(screen.getByPlaceholderText('CUS-…'), { target: { value: 'CUS-9' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. LIT-2026-0042'), { target: { value: 'LIT-1' } });
    fireEvent.change(screen.getByPlaceholderText('Why this hold is being placed'), { target: { value: 'litigation' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Place legal hold'));
    await waitFor(() => expect(applyLegalHold).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', customerId: 'CUS-9', matterRef: 'LIT-1', reason: 'litigation', scope: 'customer' })));
  });

  it('filters by status', async () => {
    render(<MemoryRouter><LegalHoldScreen /></MemoryRouter>);
    await screen.findByText('LIT-7');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'released' } });
    await waitFor(() => expect(legalHolds).toHaveBeenCalledWith({ status: 'released' }));
  });
});
