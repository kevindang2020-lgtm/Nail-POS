import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SupportOverview } from '../api/superAdminSupportApi';

const { mockDash, mockCreate, mockStartSession, mockDetail, mockReply, mockStatus, mockNote } = vi.hoisted(() => ({ mockDash: vi.fn(), mockCreate: vi.fn(), mockStartSession: vi.fn(), mockDetail: vi.fn(), mockReply: vi.fn(), mockStatus: vi.fn(), mockNote: vi.fn() }));
vi.mock('../api/superAdminSupportApi', async () => {
  const actual = await vi.importActual<any>('../api/superAdminSupportApi');
  return { ...actual, superAdminSupportApi: { dashboard: (p: any) => mockDash(p), createTicket: (b: any) => mockCreate(b), ticketDetail: (id: any) => mockDetail(id), reply: (id: any, b: any) => mockReply(id, b), setTicketStatus: (id: any, to: any) => mockStatus(id, to), addInternalNote: (id: any, b: any) => mockNote(id, b) } };
});
// The screen now mounts <ActiveSupportSessions/>, which lists live sessions and can END them.
//
// Support access could be STARTED and never seen or revoked: `supportSessions()` and `endSupportSession()` both
// existed in the client and NOTHING CALLED EITHER. That is precisely why this mock did not have them, and why no
// test noticed that elevated access into a paying customer's business had no off switch.
vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    startSupportSession: (b: any) => mockStartSession(b),
    supportSessions: (_active?: boolean) => Promise.resolve([]),
    endSupportSession: (_id: string) => Promise.resolve({ ok: true }),
  },
}));

import { SupportAccessScreen } from './SupportAccessScreen';

const dash = (): { ok: true } & SupportOverview => ({
  ok: true,
  meta: { generatedAt: '2026-05-06T14:34:00Z', scope: 'platform' },
  kpis: { openTickets: 186, urgentTickets: 24, assignedTickets: 118, waitingForCustomer: 31, resolvedToday: 42, slaBreaches: 7, auditedSessions: 13, knowledgeArticles: 96, ticketCsat: null, avgFirstResponseMin: null },
  ticketVolumeTrend: [{ day: '2026-05-05', count: 40 }, { day: '2026-05-06', count: 48 }],
  ticketsByPriority: { total: 186, slices: [{ key: 'Critical', count: 12, pct: 6.5 }, { key: 'High', count: 48, pct: 25.8 }, { key: 'Medium', count: 78, pct: 41.9 }, { key: 'Low', count: 48, pct: 25.8 }] },
  slaBreakdown: { total: 186, slices: [{ key: 'On Track', count: 118, pct: 63.4 }, { key: 'Near Breach', count: 31, pct: 16.7 }, { key: 'Breached', count: 37, pct: 19.9 }] },
  agentPerformance: [{ agent: 'Jessica Miller', assigned: 42, resolved: 38, csat: null }],
  urgentIncidents: [{ id: 'i1', subject: 'Payment gateway outage', tenant: 'Glamour Studio', priority: 'critical', createdAt: '2026-05-06T14:00:00Z' }],
  queue: [{ id: 't1', ticketNumber: 'TKT-2026-00187', tenant: 'Glamour Studio', branch: 'Downtown', category: 'payment_failure', priority: 'high', assignedTo: 'Jessica Miller', slaStatus: 'on_track', relatedDevice: null, relatedTransaction: null, lastUpdate: '2026-05-06T14:10:00Z', status: 'open' }],
  resolvedToday: [{ id: 't9', ticketNumber: 'TKT-2026-00176', tenant: 'Lavish Looks', resolvedAt: '2026-05-06T13:22:00Z', csat: null }],
  waitingForCustomer: [{ id: 't8', ticketNumber: 'TKT-2026-00185', tenant: 'Shear Elegance', waitingSince: '2026-05-06T10:00:00Z' }],
  escalated: [{ id: 't7', ticketNumber: 'TKT-2026-00184', tenant: 'The Hair Loft', escalatedTo: 'L3 Support' }],
  recentSessions: [{ id: 'SES-2026-00057abc', tenant: 'Glamour Studio', accessLevel: null, reason: 'Payment gateway investigation', started: '2026-05-06T13:30:00Z', ended: '2026-05-06T13:45:00Z', durationMin: 15, startedBy: 'jessica@x.com', auditStatus: 'Completed' }],
  knowledgeBase: [{ id: 'kb1', title: 'Payment Failure Troubleshooting', status: 'draft', updated: '2026-05-06T09:00:00Z' }],
  atAGlance: { newTickets: 58, ticketsResolved: 42, urgentCases: 24, avgResponseMin: null, sessionsStarted: 5, csat: null },
});

const renderScreen = () => render(<MemoryRouter><SupportAccessScreen /></MemoryRouter>);
beforeEach(() => { mockDash.mockReset(); mockCreate.mockReset(); mockStartSession.mockReset(); mockCreate.mockResolvedValue({ ok: true, ticket: { ticketNumber: 'SUP-NEW01' } }); mockStartSession.mockResolvedValue({ ok: true }); mockDetail.mockReset(); mockReply.mockReset(); mockStatus.mockReset(); mockDetail.mockResolvedValue({ ok: true, ticket: { id: 't1', ticketNumber: 'TKT-2026-00187', tenant: 'Glamour Studio', tenantId: 'A', subject: 'Payment failing', description: 'Declines', category: 'payment_failure', priority: 'high', status: 'open', assignedAgent: 'Jessica Miller', csatScore: null, createdAt: '2026-05-06T13:00:00Z', updatedAt: '2026-05-06T14:10:00Z' }, conversation: [{ id: 'm1', authorKind: 'customer', body: 'Checkout is failing', createdAt: '2026-05-06T13:00:00Z' }], events: [{ id: 'e1', kind: 'created', detail: 'priority=high', createdAt: '2026-05-06T13:00:00Z' }] }); mockReply.mockResolvedValue({ ok: true }); mockStatus.mockResolvedValue({ ok: true }); mockNote.mockReset(); mockNote.mockResolvedValue({ ok: true }); });

describe('SupportAccessScreen (Support Center)', () => {
  it('renders title, subtitle, banner, and all 10 KPIs', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Support Center')).toBeInTheDocument());
    expect(screen.getByText('Manages tenant support, technical incidents, requests, and controlled account assistance.')).toBeInTheDocument();
    expect(screen.getByText(/time-limited, reason-based, visibly labeled/)).toBeInTheDocument();
    for (const l of ['Open Tickets', 'Urgent Tickets', 'Assigned Tickets', 'Waiting-for-Customer', 'Resolved Today', 'SLA Breaches', 'Audited Sessions', 'Knowledge Articles', 'Ticket CSAT', 'Avg First Response'])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
  });

  it('renders 11 Support Controls and the 7-step Controlled Support Mode panel', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Support Controls')).toBeInTheDocument());
    for (const c of ['Create Tickets', 'Assign Tickets', 'Change Priority', 'Communicate', 'Attach Logs', 'Link Transactions', 'Escalate Issues', 'Record Resolution', 'KB Articles', 'Performance'])
      expect(screen.getAllByText(c).length).toBeGreaterThan(0);
    expect(screen.getByText('Controlled Support Mode')).toBeInTheDocument();
    for (const s of ['Select Tenant', 'Provide Support Reason', 'Choose Allowed Access Level', 'Start Time-Limited Session', 'Record Every Action in Audit Logs', 'Automatically End Session'])
      expect(screen.getAllByText(s).length).toBeGreaterThan(0);
  });

  it('renders the queue, analytics, workflow modules, sessions, KB, quick actions, at-a-glance', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Open Support Queue')).toBeInTheDocument());
    for (const m of ['Ticket Volume Trend (Last 7 Days)', 'Tickets by Priority', 'SLA Status Breakdown', 'Support Performance by Agent', 'Urgent Incidents', 'Resolved Tickets Today', 'Waiting-for-Customer Tickets', 'Escalated Technical Issues', 'Recent Audited Support Sessions', 'Knowledge Base Drafts / Articles', 'Quick Actions', 'At-a-Glance Summary (Today)'])
      expect(screen.getAllByText(m).length).toBeGreaterThan(0);
    expect(screen.getByText('TKT-2026-00187')).toBeInTheDocument();
    expect(screen.getByText('Payment gateway outage')).toBeInTheDocument();
    for (const q of ['Open Ticket', 'Upload Logs', 'Create KB Article']) expect(screen.getAllByText(q).length).toBeGreaterThan(0);
  });

  it('honestly shows — for unmodeled CSAT / first response', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Ticket CSAT')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('applies queue filters server-side via Apply Filters', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('TKT-2026-00187')).toBeInTheDocument());
    mockDash.mockClear();
    fireEvent.change(screen.getByDisplayValue('All Priorities'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(mockDash).toHaveBeenCalledWith(expect.objectContaining({ priority: 'critical' })));
  });

  it('creates a ticket for a tenant through the Create Ticket modal', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('+ Create Ticket')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Create Ticket'));
    await waitFor(() => expect(screen.getByLabelText('Tenant ID')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: '11111111-1111-1111-1111-111111111111' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Checkout failing' } });
    fireEvent.click(screen.getByText('Create Ticket', { selector: 'button' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '11111111-1111-1111-1111-111111111111', subject: 'Checkout failing' })));
  });

  it('starts a controlled support session (time-limited, reason-based) via the existing audited endpoint', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Start Support Mode').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Start Support Mode')[0]);
    await waitFor(() => expect(screen.getByLabelText('Support Tenant ID')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Support Tenant ID'), { target: { value: '11111111-1111-1111-1111-111111111111' } });
    fireEvent.change(screen.getByLabelText('Support reason'), { target: { value: 'Investigate gateway declines' } });
    fireEvent.click(screen.getByText('Start Session'));
    await waitFor(() => expect(mockStartSession).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '11111111-1111-1111-1111-111111111111', reason: 'Investigate gateway declines', minutes: 30 })));
  });


  it('opens a ticket detail drawer with the conversation and lets support reply', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('TKT-2026-00187')).toBeInTheDocument());
    fireEvent.click(screen.getByText('TKT-2026-00187'));
    await waitFor(() => expect(mockDetail).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getAllByText('Support Conversation').length).toBeGreaterThan(1));
    expect(screen.getByText('Checkout is failing')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reply body'), { target: { value: 'On it now' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith('t1', 'On it now'));
  });


  it('adds an internal note separated from the tenant conversation', async () => {
    mockDash.mockResolvedValue(dash());
    renderScreen();
    await waitFor(() => expect(screen.getByText('TKT-2026-00187')).toBeInTheDocument());
    fireEvent.click(screen.getByText('TKT-2026-00187'));
    await waitFor(() => expect(screen.getByLabelText('Internal note body')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Internal note body'), { target: { value: 'Root cause noted' } });
    fireEvent.click(screen.getByText('Add Note'));
    await waitFor(() => expect(mockNote).toHaveBeenCalledWith('t1', 'Root cause noted'));
  });

});
