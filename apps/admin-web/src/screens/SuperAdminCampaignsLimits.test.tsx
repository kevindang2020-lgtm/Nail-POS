import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CampaignLimitsModal } from './SuperAdminCampaignsLimits';

const getCampaignLimits = vi.fn();
const setCampaignLimits = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  getCampaignLimits: (...a: any[]) => getCampaignLimits(...a),
  setCampaignLimits: (...a: any[]) => setCampaignLimits(...a),
} }));

describe('CampaignLimitsModal', () => {
  beforeEach(() => {
    getCampaignLimits.mockReset(); getCampaignLimits.mockResolvedValue({ id: 'CLIM-0001', maxSendsPerDay: 5000, maxCampaignsPerDay: 20, quietHoursStart: 21, quietHoursEnd: 8, minHoursBetween: 24 });
    setCampaignLimits.mockReset(); setCampaignLimits.mockResolvedValue({ ok: true, limits: { id: 'CLIM-0002', maxSendsPerDay: 6000 } });
  });

  it('prefills from active limits and saves valid values', async () => {
    const onSaved = vi.fn();
    render(<CampaignLimitsModal onClose={() => {}} onSaved={onSaved} />);
    await waitFor(() => expect((screen.getByLabelText('Max sends / day') as HTMLInputElement).value).toBe('5000'));
    fireEvent.change(screen.getByLabelText('Max sends / day'), { target: { value: '6000' } });
    fireEvent.click(screen.getByText('Save limits'));
    await waitFor(() => expect(setCampaignLimits).toHaveBeenCalledWith(expect.objectContaining({ maxSendsPerDay: 6000, quietHoursStart: 21 })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('rejects an out-of-range quiet hour', async () => {
    render(<CampaignLimitsModal onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Max sends / day') as HTMLInputElement).value).toBe('5000'));
    fireEvent.change(screen.getByLabelText('Quiet hours start (0–23)'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Save limits'));
    expect(screen.getByText(/Quiet hours start must be an hour 0–23/)).toBeInTheDocument();
    expect(setCampaignLimits).not.toHaveBeenCalled();
  });
});
