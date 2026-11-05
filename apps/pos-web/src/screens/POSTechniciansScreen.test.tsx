import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSTechniciansScreen } from './POSTechniciansScreen';

// A canned /pos/technicians/state payload (shape mirrors the screen's TechState).
const techState = {
  kpisFull: { totalTechnicians: 3, activeTechnicians: 2, availableNow: 1, inService: 1, onBreak: 0, offToday: 1, avgRating: 4.6, todaySalesCents: 12500, todayTipsCents: 2000, estimatedCommissionCents: 5000, totalServicesCompletedToday: 18 },
  rows: { items: [{ technicianId: 't1', firstName: 'Ana', lastName: 'Lee', displayName: 'Ana Lee', status: 'active', workingStatus: 'available', skillGroups: ['Nails'], servicesCount: 4, todaySalesCents: 5000, todayTipsCents: 800, estimatedCommissionCents: 1500, rating: 4.8, techAppEnabled: true, canProcessPayment: true }], pagination: { totalItems: 1 } },
  filterFacets: { statuses: ['active', 'inactive'], roles: [], skillGroups: ['Nails'], serviceCategories: [], shiftStatuses: ['on_shift', 'clocked_out'], appAccessStatuses: [] },
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSTechniciansScreen', () => {
  it('renders the roster, KPIs, and the New Technician control', async () => {
    globalThis.fetch = mockFetch(techState) as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    expect(await screen.findByText('Technicians')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Technician' })).toBeInTheDocument();
    expect(screen.getByText('Ana Lee')).toBeInTheDocument();
    expect(screen.getByText('Total Team Members')).toBeInTheDocument();
    expect(screen.getByText('Total Services Completed')).toBeInTheDocument();
    expect(screen.getAllByText('18').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Team Attendance Today')).toBeInTheDocument();
    expect(screen.getByText('Performance Overview')).toBeInTheDocument();
    // T11 added modules
    expect(screen.getByText(/Team Productivity/)).toBeInTheDocument();
    expect(screen.getByText("Today's Shift Overview")).toBeInTheDocument();
    expect(screen.getByText('Upcoming Birthdays')).toBeInTheDocument();
    expect(screen.getByText(/Training/)).toBeInTheDocument();
    expect(screen.getByText('Top Performers (today)')).toBeInTheDocument();
  });

  it('opens the create panel when New Technician is clicked (the wired -95 UI)', async () => {
    globalThis.fetch = mockFetch(techState) as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    await screen.findByText('Technicians');
    fireEvent.click(screen.getByRole('button', { name: 'New Technician' }));
    expect(screen.getByPlaceholderText('First name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Last name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('shows an empty state when there are no technicians', async () => {
    globalThis.fetch = mockFetch({ ...techState, rows: { items: [], pagination: { totalItems: 0 } } }) as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    expect(await screen.findByText('No technicians match.')).toBeInTheDocument();
  });

  it('shift-status filter refetches with the shiftStatus query param (backend-supported)', async () => {
    const fetchSpy = mockFetch(techState);
    globalThis.fetch = fetchSpy as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    await screen.findByText('Ana Lee');
    const shiftSelect = screen.getByTitle('Filter by shift status');
    fireEvent.change(shiftSelect, { target: { value: 'on_shift' } });
    // the last fetch call carries shiftStatus=on_shift
    await vi.waitFor(() => {
      const urls = fetchSpy.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.includes('shiftStatus=on_shift'))).toBe(true);
    });
  });

  it('missing-mapping toggle refetches with the missingMapping query param (backend-supported)', async () => {
    const fetchSpy = mockFetch(techState);
    globalThis.fetch = fetchSpy as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    await screen.findByText('Ana Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Missing service mapping' }));
    await vi.waitFor(() => {
      const urls = fetchSpy.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.includes('missingMapping='))).toBe(true);
    });
  });
  // merge Oct 12 (other chat, workforce audit #24/#28): the queue chip from the ONE workforce state; a plain edit never
  // carries `status`; lifecycle changes are explicit actions (suspend asks a reason inline).
  describe('workforce + lifecycle', () => {
    const routed = () => {
      const calls: { url: string; method: string; body: any }[] = [];
      const f = vi.fn(async (url: any, init?: any) => {
        const u = String(url); calls.push({ url: u, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
        const j = (x: unknown) => ({ ok: true, status: 200, json: async () => x, headers: { get: () => null } } as any);
        if (u.includes('/pos/workforce-status')) return j([{ technicianId: 't1', queue: 'UNAVAILABLE', employment: 'active', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', service: 'IDLE', manualUnavailable: true }]);
        if (u.includes('/time-off/pending')) return j([]);
        if (u.includes('/commission')) return j({ defaultPercent: 40 });
        if (u.includes('/pos/technicians/state')) return j(techState);
        return j({});
      });
      return { f, calls };
    };
    it('shows the workforce queue chip beside the roster row', async () => {
      const { f } = routed(); globalThis.fetch = f as any;
      render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
      expect(await screen.findByText('not taking customers')).toBeInTheDocument();
    });
    it('saving an edit never sends status; Suspend collects a reason inline and posts it', async () => {
      const { f, calls } = routed(); globalThis.fetch = f as any;
      render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      await waitFor(() => expect(screen.getByDisplayValue('40')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/pos/technicians/t1'))).toBe(true));
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/pos/technicians/t1'))!;
      expect(patch.body).not.toHaveProperty('status');
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
      fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'No-call no-show twice' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).slice(-1)[0]);
      await waitFor(() => expect(calls.find((c) => c.url.endsWith('/pos/technicians/t1/suspend'))?.body).toEqual({ reason: 'No-call no-show twice' }));
    });
  });
});

// 200-technician mandate §34: Role tabs and Branch are SERVER filters (the tabs used to filter the 20 rows on screen).
describe('Team page — role and branch on the server (§34)', () => {
  it('a role tab and the branch select refetch with role= / branchId= and show the server rows as they come', async () => {
    const urls: string[] = [];
    const st = { ...techState, teamSummary: { topPerformers: [], ratingBuckets: { excellent: 0, veryGood: 0, good: 0, needs: 0, unrated: 0 }, roleCounts: { 'Senior Technician': 40, Technician: 160 }, servicesMapped: 0 },
      rows: { items: [{ ...techState.rows.items[0], role: 'Technician' }], pagination: { page: 1, pageSize: 25, totalItems: 160, totalPages: 7 } },
      filterFacets: { ...techState.filterFacets, branches: [{ branchId: 'br1', name: 'Cherry Hill' }, { branchId: 'br2', name: 'Moorestown' }] } };
    globalThis.fetch = vi.fn(async (u: any) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any; }) as any;
    render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);
    await screen.findByText('Ana Lee');
    expect(screen.getByRole('button', { name: 'All Members (200)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Senior Technician (40)' }));
    await vi.waitFor(() => expect(urls.some((u) => u.includes('/pos/technicians/state') && /role=Senior(\+|%20)Technician/.test(u))).toBe(true));
    // the row the server answered stays on screen (no client-side role filter over the page)
    expect(screen.getByText('Ana Lee')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Branch filter'), { target: { value: 'br2' } });
    await vi.waitFor(() => expect(urls.some((u) => u.includes('branchId=br2') && /role=Senior(\+|%20)Technician/.test(u) && u.includes('page=1'))).toBe(true));
  });
});
