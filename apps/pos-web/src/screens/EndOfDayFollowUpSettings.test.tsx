// Settings > End-of-Day Follow-Ups: reads/writes /pos/follow-ups/settings. Verifies the controls reflect loaded settings,
// Save sends the full editable payload (and reflects the returned values), the generation-time change is included, and
// load errors surface.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/posFollowUpApi', () => ({ posFollowUpApi: { getSettings: vi.fn(), saveSettings: vi.fn() } }));

import { posFollowUpApi } from '../api/posFollowUpApi';
import { EndOfDayFollowUpSettings } from './EndOfDayFollowUpSettings';

const settings = (over: any = {}) => ({
  enabled: true, generationTime: '20:00', timezone: 'America/New_York',
  allowTechEditMessage: true, allowCustomerReplies: false, requireManagerApproval: false,
  reminderToTech: true, createMode: 'end_of_day', autoExpirePendingHours: 24, defaultMessageTemplate: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (posFollowUpApi.getSettings as any).mockResolvedValue(settings());
  (posFollowUpApi.saveSettings as any).mockImplementation((p: any) => Promise.resolve(settings(p)));
});

const enableToggle = () => within(screen.getByText('Enable End-of-Day Follow-Ups').closest('.row') as HTMLElement).getByRole('button');

describe('EndOfDayFollowUpSettings', () => {
  it('reflects loaded settings (timezone, generation time, toggle state)', async () => {
    render(<EndOfDayFollowUpSettings />);
    expect(await screen.findByText(/America\/New_York/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('8:00 PM')).toBeInTheDocument();   // labelTime('20:00')
    expect(enableToggle()).toHaveTextContent('On');                    // enabled: true
  });

  it('saves the full editable payload and shows the saved note', async () => {
    render(<EndOfDayFollowUpSettings />);
    await screen.findByText(/America\/New_York/);
    fireEvent.click(enableToggle());                                   // flip Enable -> off
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() => expect(posFollowUpApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false, generationTime: '20:00', allowTechEditMessage: true, allowCustomerReplies: false,
      requireManagerApproval: false, reminderToTech: true, createMode: 'end_of_day', autoExpirePendingHours: 24,
    })));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(enableToggle()).toHaveTextContent('Off');                   // reflects the returned settings
  });

  it('includes a changed generation time in the save', async () => {
    render(<EndOfDayFollowUpSettings />);
    await screen.findByText(/America\/New_York/);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '18:30' } });
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() => expect(posFollowUpApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ generationTime: '18:30' })));
  });

  it('surfaces a load error', async () => {
    (posFollowUpApi.getSettings as any).mockRejectedValue(new Error('settings unavailable'));
    render(<EndOfDayFollowUpSettings />);
    expect(await screen.findByText('settings unavailable')).toBeInTheDocument();
  });
});
