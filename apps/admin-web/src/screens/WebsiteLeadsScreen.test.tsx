// Website Leads QA: the screen renders KPIs, a lead row, source/status analytics and recent activity from the mocked
// state hook, shows the right empty state, and opens the Add Lead modal — all over the real component.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useState_ = vi.fn();
vi.mock('../api/superAdminWebsiteLeadsApi', () => ({
  useSuperAdminWebsiteLeadsState: () => useState_(),
  superAdminWebsiteLeadsApi: { downloadCsv: vi.fn(), create: vi.fn(), get: vi.fn(), setStatus: vi.fn(), convert: vi.fn(), recalcScore: vi.fn(), assign: vi.fn(), addNote: vi.fn() },
}));

import { WebsiteLeadsScreen } from './WebsiteLeadsScreen';

const lead = (o: any = {}) => ({ id: 'l1', salonName: 'Glamour Nails', contactName: 'Sarah Thompson', phone: '512-555-1234', email: 'sarah@glamour.com', city: 'Austin', state: 'TX', source: 'website_form', leadScore: 85, status: 'new', message: null, currentPos: null, technicianCount: null, monthlyCardVolumeCents: null, assignedToUserId: 'u1', assignedToName: 'John Smith', nextFollowUpAt: '2026-05-08T00:00:00Z', convertedApplicationId: null, createdAt: '2026-05-05T14:30:00Z', updatedAt: '2026-05-05T14:30:00Z', ...o });

const stateValue = (over: any = {}) => ({
  state: {
    kpis: { totalLeads: 2847, newLeads: 892, contacted: 1156, qualified: 598, converted: 201, conversionRatePct: 7.06, trends: { totalLeads: 16.8, newLeads: 12.4, contacted: 10.1, qualified: 9.3, converted: 15.7, conversionRatePct: 1.25 } },
    filters: {}, leads: [lead()], pagination: { page: 1, limit: 10, totalItems: 2847, totalPages: 285 },
    analytics: { bySource: [{ source: 'website_form', count: 1156, pct: 40.6 }], byStatus: [{ status: 'new', count: 892, pct: 31.3 }, { status: 'contacted', count: 1156, pct: 40.6 }, { status: 'qualified', count: 598, pct: 21 }, { status: 'converted', count: 201, pct: 7.1 }], topSources: [{ rank: 1, source: 'website_form', count: 1156, growthPct: 16.5 }] },
    recentActivity: [{ id: 'a1', leadId: 'l1', activityType: 'created', title: 'New lead received', message: null, createdAt: '2026-06-17T00:00:00Z', leadName: 'Glamour Nails' }],
    permissions: { view: true, create: true, convert: true }, sources: [], statuses: [], assignableUsers: [{ id: 'u1', name: 'John Smith' }],
  },
  loading: false, error: null, reload: vi.fn(), ...over,
});

describe('Super-Admin Website Leads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders KPIs, a lead row, analytics, and recent activity from state', () => {
    useState_.mockReturnValue(stateValue());
    render(<MemoryRouter><WebsiteLeadsScreen /></MemoryRouter>);
    expect(screen.getAllByText('2,847').length).toBeGreaterThan(0);  // Total Leads (KPI + donut + pager)
    expect(screen.getByText('7.06%')).toBeInTheDocument();         // Conversion Rate
    expect(screen.getAllByText('Glamour Nails').length).toBeGreaterThan(0); // table + activity
    expect(screen.getByText('Sarah Thompson')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();            // score badge
    expect(screen.getByText('John Smith')).toBeInTheDocument();    // assigned rep
    expect(screen.getByText('Recent Lead Activity')).toBeInTheDocument();
    expect(screen.getByText('Leads by Source')).toBeInTheDocument();
  });

  it('shows the empty state when there are no leads', () => {
    useState_.mockReturnValue(stateValue({ state: { ...stateValue().state, leads: [], pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 1 } } }));
    render(<MemoryRouter><WebsiteLeadsScreen /></MemoryRouter>);
    expect(screen.getByText('No website leads yet.')).toBeInTheDocument();
  });

  it('opens the Add Lead modal', () => {
    useState_.mockReturnValue(stateValue());
    render(<MemoryRouter><WebsiteLeadsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByText('+ Add Lead'));
    expect(screen.getByText('Create Lead')).toBeInTheDocument();
    expect(screen.getByText('Message / Notes')).toBeInTheDocument();
  });
});
