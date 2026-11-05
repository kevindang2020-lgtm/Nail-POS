import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickCheckInPanel } from './QuickCheckInPanel';

// The Quick Check-In Panel is the Check-In screen's centerpiece: three tabs (Existing / New / Walk-In) that all
// resolve to the real POST /pos/check-in/walk-in (link-or-create server-side). These tests lock the interactive
// wiring — including the previously-dead "+" services control, now a real show-all expander — and the submit path.

const services = Array.from({ length: 15 }, (_, i) => ({ serviceId: `svc${i + 1}`, name: `Service ${i + 1}`, durationMinutes: 30 }));
const technicians = [{ technicianId: 't1', displayName: 'Lily Adams' }, { technicianId: 't2', displayName: 'Mia Johnson' }];

// Records requests so the submit assertion can inspect the endpoint + body.
const recordFetch = (opts: { searchResult?: any[]; fail?: boolean } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/customers/search')) return ok(opts.searchResult ?? [{ customerId: 'c1', fullName: 'Jessica Miller', phone: '415-555-1212', totalVisits: 18 }]);
    if (u.includes('/walk-in')) { if (opts.fail) return { ok: false, status: 400, json: async () => ({ message: 'Check-in failed' }), headers: { get: () => null } } as any; return ok({ checkInId: 'ci1' }); }
    return ok({});
  });
  (fn as any).calls = calls;
  return fn;
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('QuickCheckInPanel — service selection and the +N expander (was a dead button)', () => {
  it('shows the first 12 services and a real +N control that reveals the rest', async () => {
    globalThis.fetch = recordFetch() as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    // New Customer tab surfaces the ServiceChips without needing a search
    fireEvent.click(screen.getByText('New Customer'));
    expect(screen.getByText('Service 1')).toBeInTheDocument();
    expect(screen.getByText('Service 12')).toBeInTheDocument();
    expect(screen.queryByText('Service 13')).not.toBeInTheDocument();   // hidden until expanded
    // the "+" is now "+3" (15 - 12) and reveals the rest — not a fake "coming soon" message
    const more = screen.getByText('+3');
    fireEvent.click(more);
    expect(screen.getByText('Service 13')).toBeInTheDocument();
    expect(screen.getByText('Service 15')).toBeInTheDocument();
    expect(screen.queryByText(/coming from the services module/)).not.toBeInTheDocument();
    // and a "less" toggle collapses back
    fireEvent.click(screen.getByText('less'));
    expect(screen.queryByText('Service 13')).not.toBeInTheDocument();
  });

  it('toggling a service updates the estimated duration', () => {
    globalThis.fetch = recordFetch() as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    fireEvent.click(screen.getByText('New Customer'));
    fireEvent.click(screen.getByText('Service 1'));
    fireEvent.click(screen.getByText('Service 2'));
    // two 30-min services → 60 min in the Select Service header and the Est. Duration field
    expect(screen.getByText(/~60 min/)).toBeInTheDocument();
  });
});

describe('QuickCheckInPanel — tabs and validation', () => {
  it('switches between the three tabs', () => {
    globalThis.fetch = recordFetch() as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    expect(screen.getByPlaceholderText(/Search by phone number/)).toBeInTheDocument();   // existing tab default
    fireEvent.click(screen.getByText('New Customer'));
    expect(screen.getByPlaceholderText('First name *')).toBeInTheDocument();   // §25: first / last name (Oct 28 2026)
    expect(screen.getByPlaceholderText('Last name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Walk-In' }));
    expect(screen.getByPlaceholderText('Guest name')).toBeInTheDocument();
  });

  it('requires a service before completing', () => {
    globalThis.fetch = recordFetch() as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Walk-In' }));
    fireEvent.change(screen.getByPlaceholderText('Guest name'), { target: { value: 'Walk Guest' } });
    fireEvent.click(screen.getByText('✓ Complete Check-In'));
    expect(screen.getByText('Select at least one service.')).toBeInTheDocument();
  });

  it('requires a guest name on the walk-in tab', () => {
    globalThis.fetch = recordFetch() as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Walk-In' }));
    fireEvent.click(screen.getByText('Service 1'));
    fireEvent.click(screen.getByText('✓ Complete Check-In'));
    expect(screen.getByText('Guest name is required.')).toBeInTheDocument();
  });
});

describe('QuickCheckInPanel — real submission', () => {
  it('a new-customer check-in POSTs to /walk-in with services, source, and an idempotency key', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    const onComplete = vi.fn();
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('New Customer'));
    fireEvent.change(screen.getByPlaceholderText('First name *'), { target: { value: 'New' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Guest' } });
    fireEvent.change(screen.getByPlaceholderText('Email (optional)'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByText('Service 1'));
    fireEvent.click(screen.getByText('✓ Complete Check-In'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/check-in/walk-in') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ customerName: 'New Guest', customerEmail: 'new@example.com', smsOptIn: false, serviceIds: ['svc1'], isNewCustomer: true, source: 'in_person' });
      expect(typeof call.body.idempotencyKey).toBe('string');
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('existing-customer flow: phone search selects a customer, then submits with customerId', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search by phone number/), { target: { value: '415-555-1212' } });
    fireEvent.click(screen.getByText('Search'));
    const pick = await screen.findByText('Jessica Miller');
    fireEvent.click(pick);
    fireEvent.click(await screen.findByText('Service 1'));
    fireEvent.click(screen.getByText('✓ Complete Check-In'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/walk-in') && c.method === 'POST');
      expect(call.body).toMatchObject({ customerId: 'c1', serviceIds: ['svc1'] });
    });
  });

  it('surfaces a server error instead of pretending the check-in worked', async () => {
    globalThis.fetch = recordFetch({ fail: true }) as any;
    render(<QuickCheckInPanel services={services} technicians={technicians} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Walk-In' }));
    fireEvent.change(screen.getByPlaceholderText('Guest name'), { target: { value: 'Walk Guest' } });
    fireEvent.click(screen.getByText('Service 1'));
    fireEvent.click(screen.getByText('✓ Complete Check-In'));
    expect(await screen.findByText('Check-in failed')).toBeInTheDocument();
  });
});
