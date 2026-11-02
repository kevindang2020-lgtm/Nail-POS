import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgreementsPanel } from './AgreementsPanel';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { agreements: vi.fn(), createAgreement: vi.fn() } }));

const ag = () => ({ id: 'ag1', technicianId: 'tech1', title: '2026 comp', terms: { commissionPercent: 60, classification: 'employee' }, status: 'sent', version: 1, effectiveStart: '2026-01-01', createdAt: '2026-01-01', acknowledgedAt: null, acknowledgedBy: null });

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.agreements as any).mockResolvedValue([ag()]);
  (ownerCompensationApi.createAgreement as any).mockResolvedValue(ag());
});

describe('AgreementsPanel', () => {
  it('lists agreements with their status and terms', async () => {
    render(<AgreementsPanel />);
    await waitFor(() => expect(screen.getByText(/2026 comp/)).toBeInTheDocument());
    expect(screen.getByText(/awaiting acknowledgment/)).toBeInTheDocument();
    expect(screen.getByText(/60% commission/)).toBeInTheDocument();
  });

  it('creates an agreement capturing the entered terms', async () => {
    render(<AgreementsPanel />);
    await waitFor(() => expect(screen.getByText(/2026 comp/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Agreement technician'), { target: { value: 'tech9' } });
    fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'New terms' } });
    fireEvent.change(screen.getByLabelText('Agreement commission'), { target: { value: '55' } });
    fireEvent.click(screen.getByText('Create & send'));
    await waitFor(() => expect(ownerCompensationApi.createAgreement).toHaveBeenCalledWith({ technicianId: 'tech9', title: 'New terms', terms: { commissionPercent: 55 } }));
  });
});
