import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechAgreementsPanel } from './TechAgreementsPanel';
import { techCompensationApi } from '../api/techApi';

vi.mock('../api/techApi', () => ({ techCompensationApi: { agreements: vi.fn(), acknowledgeAgreement: vi.fn() } }));

const ag = (status = 'sent') => ({ id: 'ag1', technicianId: 'tech1', title: '2026 comp', terms: { commissionPercent: 60 }, status, version: 1, effectiveStart: '2026-01-01', createdAt: '2026-01-01', acknowledgedAt: status === 'acknowledged' ? '2026-02-01' : null, acknowledgedBy: null });

beforeEach(() => {
  vi.clearAllMocks();
  (techCompensationApi.agreements as any).mockResolvedValue([ag('sent')]);
  (techCompensationApi.acknowledgeAgreement as any).mockResolvedValue(ag('acknowledged'));
});

describe('TechAgreementsPanel', () => {
  it('shows a sent agreement with an Acknowledge button', async () => {
    render(<TechAgreementsPanel />);
    await waitFor(() => expect(screen.getByText(/2026 comp/)).toBeInTheDocument());
    expect(screen.getByText(/60% commission/)).toBeInTheDocument();
    expect(screen.getByText('Acknowledge')).toBeInTheDocument();
  });

  it('acknowledges the agreement on click', async () => {
    render(<TechAgreementsPanel />);
    await waitFor(() => expect(screen.getByText('Acknowledge')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Acknowledge'));
    await waitFor(() => expect(techCompensationApi.acknowledgeAgreement).toHaveBeenCalledWith('ag1'));
  });

  it('shows acknowledged status with no button', async () => {
    (techCompensationApi.agreements as any).mockResolvedValue([ag('acknowledged')]);
    render(<TechAgreementsPanel />);
    await waitFor(() => expect(screen.getByText(/Acknowledged/)).toBeInTheDocument());
    expect(screen.queryByText('Acknowledge')).toBeNull();
  });
});
