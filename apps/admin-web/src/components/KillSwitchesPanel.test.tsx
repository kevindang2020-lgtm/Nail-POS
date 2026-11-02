import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
import { api } from '../api/client';
import { KillSwitchesPanel } from './KillSwitchesPanel';

const rows = [
  { key: 'ai.auto_actions', label: 'AI automatic actions', stops: 'x', active: false, reason: null, since: null },
  { key: 'sms.emergency_send', label: 'SMS sending (emergency stop)', stops: 'y', active: true, reason: null, since: '2026-09-28T10:00:00Z' },
  { key: 'booking.verification', label: 'Booking phone verification provider', stops: 'z', active: false, reason: null, since: null },
];
describe('Kill Switches (Constitution 7 §34)', () => {
  beforeEach(() => { vi.clearAllMocks(); (api.get as any).mockResolvedValue(rows); (api.post as any).mockResolvedValue({}); });
  it('lists every switch with its state; stopping needs a reason and calls that switch\'s own control', async () => {
    render(<KillSwitchesPanel />);
    expect(await screen.findByText('AI automatic actions')).toBeInTheDocument();
    expect(screen.getByText('STOPPED')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop…' })[0]);
    const go = screen.getByRole('button', { name: 'Stop now' });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for AI automatic actions'), { target: { value: 'runaway auto-assignment' } });
    fireEvent.click(go);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/super-admin/kill-switches/ai.auto_actions', { active: true, reason: 'runaway auto-assignment' }));
  });
  it('resuming SMS goes to the SMS master control with its own key', async () => {
    render(<KillSwitchesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume…' }));
    fireEvent.change(screen.getByLabelText('Reason for SMS sending (emergency stop)'), { target: { value: 'carrier issue resolved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/super-admin/sms-packages/platform-controls', { key: 'sms.emergency_send_disabled', enabled: false, reason: 'carrier issue resolved' }));
  });
});
