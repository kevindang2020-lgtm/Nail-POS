import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechnicianSchedulePreview, type TechScheduleData } from './TechnicianSchedulePreview';

// Real-shaped data as returned by /pos/technicians/live-schedule/state (Col) + /:id/live-detail enrich.
const tech: TechScheduleData = {
  technicianId: 't1', fullName: 'Grace Kim', initials: 'GK', roleLabel: 'Senior Nail Tech', status: 'in_service',
  shift: { startTime: '09:00', endTime: '18:00', breakStartTime: '13:00', breakEndTime: '13:30' },
  skills: ['Gel Manicure', 'Acrylic Full Set'],
  appointments: [
    { appointmentId: 'a1', customerName: 'Emma Wilson', customerInitials: 'EW', serviceSummary: 'Gel Manicure', startTime: '09:30', endTime: '10:30', status: 'confirmed', source: 'online_booking', ticketId: 'tk1' },
    { appointmentId: 'a2', customerName: 'Maria Garcia', customerInitials: 'MG', serviceSummary: 'Acrylic Full Set', startTime: '11:00', endTime: '12:30', status: 'in_service', source: 'walk_in' },
  ],
  openSlots: [{ slotId: 's1', startTime: '15:00', endTime: '16:00', durationMinutes: 60, reason: 'gap' }],
  blocks: [{ blockId: 'b1', startTime: '16:30', endTime: '17:00', reason: 'training' }],
  bookedHours: 5, utilizationPercent: 72, phone: '(555) 123-4567', salesTodayCents: 24500, tipsTodayCents: 4200,
};

describe('TechnicianSchedulePreview (iPad Pro 13" preview)', () => {
  it('renders the technician header, working hours and real day metrics', () => {
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={() => {}} />);
    expect(screen.getByText('Grace Kim')).toBeTruthy();
    expect(screen.getByText(/Senior Nail Tech/)).toBeTruthy();
    expect(screen.getByText('9:00 AM – 6:00 PM')).toBeTruthy(); // working hours
    expect(screen.getByText('72%')).toBeTruthy();               // utilization
    expect(screen.getByText('$245.00')).toBeTruthy();           // sales from detail enrich
  });

  it('shows the complete schedule: appointments (customer + service + status), open slots and breaks', () => {
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={() => {}} />);
    expect(screen.getByText('Emma Wilson')).toBeTruthy();
    expect(screen.getByText('Maria Garcia')).toBeTruthy();
    expect(screen.getAllByText('Gel Manicure').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Available/).length).toBeGreaterThan(0); // open slot (+ legend)
    expect(screen.getByText(/Lunch \/ Break/)).toBeTruthy();   // shift lunch
    expect(screen.getByText(/training/i)).toBeTruthy();          // block
  });

  it('orders the timeline chronologically by start time', () => {
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={() => {}} />);
    const dlg = screen.getByRole('dialog');
    const text = dlg.textContent || '';
    expect(text.indexOf('Emma Wilson')).toBeLessThan(text.indexOf('Maria Garcia'));
    expect(text.indexOf('Maria Garcia')).toBeLessThan(text.indexOf('Available'));
  });

  it('close button, Escape and backdrop each call onClose', () => {
    const onClose = vi.fn();
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close preview'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('open slots are bookable when onBookSlot is provided (reuses the board booking)', () => {
    const onBookSlot = vi.fn();
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={() => {}} onBookSlot={onBookSlot} />);
    fireEvent.click(screen.getByText(/\+ Book/));
    expect(onBookSlot).toHaveBeenCalledWith(expect.objectContaining({ slotId: 's1' }));
  });

  it('keeps the schedule list as the internal scroll area', () => {
    render(<TechnicianSchedulePreview tech={tech} date="2026-07-10" onClose={() => {}} />);
    const scrollers = Array.from(document.querySelectorAll('div')).filter((d) => (d as HTMLElement).style.overflowY === 'auto');
    expect(scrollers.length).toBe(1); // exactly one scroll region — the schedule
  });
});
