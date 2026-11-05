import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { getMock, updateMock } = vi.hoisted(() => ({ getMock: vi.fn(), updateMock: vi.fn() }));
vi.mock('../api/posRemindersApi', () => ({ posRemindersApi: { get: getMock, update: updateMock } }));
import { POSRemindersScreen } from './POSRemindersScreen';
beforeEach(() => { getMock.mockReset(); updateMock.mockReset(); });

describe('POSRemindersScreen', () => {
  it('loads config and saves updates (hours -> minutes)', async () => {
    getMock.mockResolvedValue({ enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    updateMock.mockResolvedValue({ enabled: true, leadMinutes: 120, windowMinutes: 60, channel: 'email' });
    render(<POSRemindersScreen />);
    expect(await screen.findByRole('heading', { name: 'Appointment Reminders' })).toBeInTheDocument();
    const lead = screen.getByDisplayValue('24');   // 1440 min -> 24h
    fireEvent.change(lead, { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toMatchObject({ enabled: true, leadMinutes: 120, channel: 'email' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
  it('reflects disabled state', async () => {
    getMock.mockResolvedValue({ enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    render(<POSRemindersScreen />);
    const cb = await screen.findByRole('checkbox');
    expect((cb as HTMLInputElement).checked).toBe(false);
  });
});
