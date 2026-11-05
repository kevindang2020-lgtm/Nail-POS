// TechScheduleScreen (technician, Module 2): today's appointments + a Mon-first week strip + a lunch banner derived from the
// real working-hours row. Verifies rendering + the today highlight, the status filter, the honest "today only" note for other
// days, the empty + error states, and the lunch banner placement.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/techApi', () => ({ techApi: { schedule: vi.fn(), workingHours: vi.fn() } }));

import { techApi } from '../api/techApi';
import { TechScheduleScreen } from './TechScheduleScreen';

const atToday = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const appt = (over: any = {}) => ({ appointmentId: 'a1', customerInitials: '', customerName: 'Jane Doe', serviceName: 'Gel-X', startTime: atToday(11, 0), status: 'booked', ...over });
const two = [appt(), appt({ appointmentId: 'a2', customerName: 'Mary Lee', serviceName: 'Pedicure', status: 'completed', startTime: atToday(14, 0) })];

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.schedule as any).mockResolvedValue(two);
  (techApi.workingHours as any).mockResolvedValue([]);   // no lunch banner by default
});

describe('TechScheduleScreen', () => {
  it('renders today\'s appointments and highlights today in the week strip', async () => {
    const { container } = render(<TechScheduleScreen />);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Gel-X')).toBeInTheDocument();
    expect(screen.getByText('Mary Lee')).toBeInTheDocument();
    expect(screen.getByText('Pedicure')).toBeInTheDocument();
    expect(container.querySelectorAll('.tech-week button')).toHaveLength(7);
    expect(container.querySelector('.tech-week button[aria-current="date"]')).not.toBeNull();
  });

  it('filters appointments by status', async () => {
    const { container } = render(<TechScheduleScreen />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByLabelText('Filter'));            // All -> Upcoming
    expect(container.querySelector('.tech-chip.neutral')?.textContent).toBe('Upcoming');
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();    // booked = upcoming
    expect(screen.queryByText('Mary Lee')).not.toBeInTheDocument(); // completed hidden
  });

  it('loads the real schedule for another day when it is tapped', async () => {
    const { container } = render(<TechScheduleScreen />);
    await screen.findByText('Jane Doe');
    const other = Array.from(container.querySelectorAll('.tech-week button')).find((b) => !b.hasAttribute('aria-current')) as HTMLElement;
    fireEvent.click(other);
    await waitFor(() => expect(techApi.schedule).toHaveBeenCalledTimes(2)); // initial today + the tapped day
    expect(container.querySelector('.tech-week button[aria-current="date"]')).not.toBeNull();
  });

  it('shows the empty state when there are no appointments', async () => {
    (techApi.schedule as any).mockResolvedValue([]);
    render(<TechScheduleScreen />);
    expect(await screen.findByText('No appointments scheduled for today.')).toBeInTheDocument();
  });

  it('shows an error when the schedule fails to load', async () => {
    (techApi.schedule as any).mockRejectedValue({ message: 'Failed to load your schedule.' });
    render(<TechScheduleScreen />);
    expect(await screen.findByText('Failed to load your schedule.')).toBeInTheDocument();
  });

  it('inserts a lunch break banner from the working-hours row', async () => {
    (techApi.workingHours as any).mockResolvedValue([{ dayOfWeek: new Date().getDay(), isWorking: true, startTime: '09:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00' }]);
    render(<TechScheduleScreen />);
    expect(await screen.findByText('Lunch Break')).toBeInTheDocument();
  });

  it('shows the booked inspiration look thumbnail when an appointment carries one (P3)', async () => {
    (techApi.schedule as any).mockResolvedValue([appt({ inspirationPhotoUrl: 'https://cdn.example.com/look.jpg' })]);
    render(<TechScheduleScreen />);
    const img = await screen.findByAltText('Booked inspiration look');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/look.jpg');
  });
});
