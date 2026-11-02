import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TierPlansPanel } from './TierPlansPanel';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { tierPlans: vi.fn(), createTierPlan: vi.fn(), archiveTierPlan: vi.fn(), previewTierPlan: vi.fn() } }));

const plan = () => ({ id: 'tp1', technicianId: 'tech1', branchId: null, mode: 'entire' as const, bands: [{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: null, ratePercent: 60 }], status: 'active', effectiveStart: '2026-01-01', createdAt: '2026-01-01' });

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.tierPlans as any).mockResolvedValue([plan()]);
  (ownerCompensationApi.createTierPlan as any).mockResolvedValue(plan());
  (ownerCompensationApi.archiveTierPlan as any).mockResolvedValue({ ok: true });
  (ownerCompensationApi.previewTierPlan as any).mockResolvedValue({ productionCents: 500000, entire: { commissionCents: 275000, effectiveRatePercent: 55 }, marginal: { commissionCents: 255000, effectiveRatePercent: 51 } });
});

describe('TierPlansPanel', () => {
  it('lists existing plans', async () => {
    render(<TierPlansPanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
  });

  it('creates a plan with the entered technician and the band ladder (dollars → cents)', async () => {
    render(<TierPlansPanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Technician ID'), { target: { value: 'tech9' } });
    fireEvent.click(screen.getByText('Save plan'));
    await waitFor(() => expect(ownerCompensationApi.createTierPlan).toHaveBeenCalled());
    const arg = (ownerCompensationApi.createTierPlan as any).mock.calls[0][0];
    expect(arg).toMatchObject({ technicianId: 'tech9', mode: 'entire' });
    expect(arg.bands).toEqual([{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 600000, ratePercent: 55 }, { uptoCents: null, ratePercent: 60 }]);
  });

  it('previews entire-period vs marginal side by side', async () => {
    render(<TierPlansPanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(ownerCompensationApi.previewTierPlan).toHaveBeenCalled());
    expect(screen.getByText(/2750\.00/)).toBeInTheDocument();
    expect(screen.getByText(/2550\.00/)).toBeInTheDocument();
  });

  it('archives a plan', async () => {
    render(<TierPlansPanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Archive'));
    await waitFor(() => expect(ownerCompensationApi.archiveTierPlan).toHaveBeenCalledWith('tp1'));
  });
});
