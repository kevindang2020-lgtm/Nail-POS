// Daily Summary Email / Schedule Report (Nov 10 2026): own address, honest outcomes, self-consented schedule
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { deliveryState: vi.fn(), emailNow: vi.fn(), schedule: vi.fn(), unschedule: vi.fn() } }));
vi.mock('../api/posReportsApi', () => ({ posReportsApi: api }));
import { ReportEmailControls } from './ReportEmailControls';

const base = { canSend: true, email: 'o***@rose.test', hasEmail: true, sender: 'simulated', scheduleRunning: true, subscription: null, deliveries: [] };
beforeEach(() => { vi.clearAllMocks(); api.deliveryState.mockResolvedValue(base); });

describe('ReportEmailControls', () => {
  it('Email Report sends the period on screen and says honestly it was only recorded', async () => {
    const note = vi.fn();
    api.emailNow.mockResolvedValue({ status: 'simulated' });
    render(<div><ReportEmailControls range={{ from: '2026-11-09', to: '2026-11-09' }} onNote={note} /></div>);
    await waitFor(() => expect(screen.getByTestId('rpt-email-now')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('rpt-email-now'));
    await waitFor(() => expect(api.emailNow).toHaveBeenCalledWith('2026-11-09', '2026-11-09'));
    await waitFor(() => expect(note).toHaveBeenCalledWith(expect.stringMatching(/o\*\*\*@rose\.test: recorded, not sent/)));
  });
  it('Schedule Report: I turn it on for myself, see the test-environment warning, then turn it off', async () => {
    render(<div><ReportEmailControls range={null} onNote={() => undefined} /></div>);
    fireEvent.click(await screen.findByTestId('rpt-schedule'));
    expect(screen.getByTestId('rpt-mail-sender')).toHaveTextContent(/recorded here, not sent/);
    expect(screen.getByTestId('rpt-email-now')).toBeDisabled();   // no period loaded yet
    api.schedule.mockResolvedValue({ ...base, subscription: { id: 's', frequency: 'weekly', sendAt: '08:00', active: true, consentedAt: '2026-11-10T00:00:00Z' } });
    fireEvent.change(screen.getByTestId('rpt-mail-frequency'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByTestId('rpt-mail-hour'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByTestId('rpt-mail-on'));
    await waitFor(() => expect(api.schedule).toHaveBeenCalledWith('weekly', '08:00'));
    api.unschedule.mockResolvedValue(base);
    fireEvent.click(await screen.findByTestId('rpt-mail-off'));
    await waitFor(() => expect(api.unschedule).toHaveBeenCalled());
  });
  it('without financial / export permission both buttons say why and send nothing', async () => {
    api.deliveryState.mockResolvedValue({ ...base, canSend: false });
    render(<div><ReportEmailControls range={{ from: '2026-11-09', to: '2026-11-09' }} onNote={() => undefined} /></div>);
    await waitFor(() => expect(screen.getByTestId('rpt-email-now')).toHaveAttribute('title', expect.stringMatching(/permission/)));
    expect(screen.getByTestId('rpt-email-now')).toBeDisabled();
  });
});
