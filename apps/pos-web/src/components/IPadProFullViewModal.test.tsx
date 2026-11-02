import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IPadProFullViewModal } from './IPadProFullViewModal';
import { IPadViewProvider, useIPadView } from './IPadViewProvider';
import { techScheduleRequest } from './ipad-modules';
import type { TechScheduleData } from './TechnicianSchedulePreview';

describe('IPadProFullViewModal (reusable iPad Pro full-view shell)', () => {
  it('renders nothing when closed, and title/subtitle/children when open', () => {
    const { rerender } = render(<IPadProFullViewModal isOpen={false} onClose={() => {}} title="X"><p>body</p></IPadProFullViewModal>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<IPadProFullViewModal isOpen onClose={() => {}} title="Lily Adams" subtitle="Full Day Schedule"><p>body</p></IPadProFullViewModal>);
    expect(screen.getByText('Lily Adams')).toBeTruthy();
    expect(screen.getByText('Full Day Schedule')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('shows loading skeleton and error state', () => {
    const { rerender } = render(<IPadProFullViewModal isOpen onClose={() => {}} title="X" loading><p>hidden</p></IPadProFullViewModal>);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('hidden')).toBeNull();
    rerender(<IPadProFullViewModal isOpen onClose={() => {}} title="X" error="Could not load"><p>hidden</p></IPadProFullViewModal>);
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
  });

  it('close button, Escape and backdrop each call onClose', () => {
    const onClose = vi.fn();
    render(<IPadProFullViewModal isOpen onClose={onClose} title="X"><p>b</p></IPadProFullViewModal>);
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('hasUnsavedChanges blocks backdrop-close but Escape/✕ still work', () => {
    const onClose = vi.fn();
    render(<IPadProFullViewModal isOpen onClose={onClose} title="X" hasUnsavedChanges><p>b</p></IPadProFullViewModal>);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const tech: TechScheduleData = {
  technicianId: 't1', fullName: 'Lily Adams', initials: 'LA', roleLabel: 'Nail Technician', status: 'in_service',
  shift: { startTime: '09:00', endTime: '20:00' }, skills: ['Nail Art'],
  appointments: [{ appointmentId: 'a1', customerName: 'Ava Thompson', serviceSummary: 'Spa Pedicure', startTime: '09:00', endTime: '10:00', status: 'arriving_soon' }],
  openSlots: [{ slotId: 's1', startTime: '11:00', endTime: '12:00', durationMinutes: 60 }], blocks: [],
  bookedHours: 6, utilizationPercent: 78,
};

function Opener() {
  const { open } = useIPadView();
  return <button onClick={() => open(techScheduleRequest(tech, '2026-05-06'))}>open</button>;
}

describe('IPadViewProvider + registry (global openIPadView)', () => {
  it('opens the registered technician-schedule content in the shell, then closes', () => {
    render(<IPadViewProvider><Opener /></IPadViewProvider>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Lily Adams')).toBeTruthy();       // header from meta
    expect(screen.getByText('Ava Thompson')).toBeTruthy();     // real record content
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
