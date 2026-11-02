// RealtimeToasts (developer merge, Oct 2026): salon-wide toasts ride the existing realtime stream — named events toast,
// plain refetch signals stay quiet, a tap goes to the matching screen.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('../realtime/realtime-client', () => ({ REALTIME_EVENT: 'aps:realtime', ensureRealtimeConnected: vi.fn() }));
import { RealtimeToasts, toastFor } from './RealtimeToasts';

const fire = (event: string, payload?: unknown) => act(() => { window.dispatchEvent(new CustomEvent('aps:realtime', { detail: { event, screens: [], payload } })); });

describe('RealtimeToasts', () => {
  it('a booking event toasts; a refetch-only event does not; a tap opens the screen', () => {
    render(<MemoryRouter initialEntries={['/x']}><Routes><Route path="/x" element={<RealtimeToasts />} /><Route path="/booking" element={<div>BOOKING SCREEN</div>} /></Routes></MemoryRouter>);
    fire('settings_updated');
    expect(screen.queryByTestId('realtime-toast')).toBeNull();
    fire('appointment_created');
    expect(screen.getByText('New Appointment')).toBeInTheDocument();
    fireEvent.click(screen.getByText('New Appointment'));
    expect(screen.getByText('BOOKING SCREEN')).toBeInTheDocument();
  });
  it('a frame with its own title uses it; toasts go away on their own', () => {
    vi.useFakeTimers();
    try {
      render(<MemoryRouter><RealtimeToasts ms={1000} /></MemoryRouter>);
      fire('some_new_event', { title: 'Hello', body: 'World' });
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('World')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByText('Hello')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('maps only the meaningful events', () => {
    expect(toastFor('payment_failed')?.[2]).toBe('/checkout');
    expect(toastFor('queue_updated')).toBeNull();
  });
});
