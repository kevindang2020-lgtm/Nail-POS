// TicketDetailScreen (tech core flow): GET /tech/tickets/:id + the accept -> start-service -> service-done state machine,
// plus the Edit Live Ticket modal (mark line done / remove / change) and add-note / request-cancel. The key regression
// guard is the edit modal: the ticket's service lines are { id, name, ... } (NOT serviceLineId/serviceName), so the modal
// must render l.name and send l.id to the line endpoints — previously it read l.serviceLineId (undefined), silently
// breaking mark-done / remove / change-service.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back: vi.fn() }) }));
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../lib/tech', () => ({
  money2: (c: number) => `$${((c || 0) / 100).toFixed(2)}`,
  clock: () => '10:00 AM',
  statusLabel: (s: string) => s,
  statusKind: (s: string) => s,
  initials: (n?: string) => (n ? n.slice(0, 2).toUpperCase() : 'XX'),
}));
vi.mock('../api/techApi', () => ({
  techApi: {
    ticket: vi.fn(), accept: vi.fn(), startService: vi.fn(), serviceDone: vi.fn(),
    ticketMembership: vi.fn(),
    editOptions: vi.fn(), patchLine: vi.fn(), removeLine: vi.fn(), changeService: vi.fn(),
    addServiceLine: vi.fn(), addAddOn: vi.fn(), addNote: vi.fn(), requestCancel: vi.fn(),
  },
}));

import { techApi } from '../api/techApi';
import { TicketDetailScreen } from './TicketDetailScreen';

const ticket = (over: any = {}) => ({
  ticketId: 'T1', technicianId: 'tech1', status: 'serving', ticketNumber: '1042',
  customerName: 'Jane Doe', customerPhoneMasked: '(•••) •••-1234',
  services: [{ id: 'line1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, status: 'serving' }],
  notes: null, totalCents: 4500, durationMinutes: 45, scheduledStart: null, scheduledEnd: null,
  acceptedAt: '2026-06-17T13:00:00Z', startedAt: '2026-06-17T13:05:00Z', completedAt: null, ...over,
});
const editOptions = () => ({
  editable: true, lockedReason: null, ticketStatus: 'serving',
  can: { addService: true, changeService: true, removeLine: true }, approvalRequiredFor: [],
  categories: ['Manicure', 'Pedicure'],
  services: [
    { serviceId: 'svc2', name: 'Spa Pedicure', categoryName: 'Pedicure', priceCents: 6000, durationMinutes: 60, isAddOn: false },
    { serviceId: 'svc3', name: 'Acrylic Full Set', categoryName: 'Manicure', priceCents: 7000, durationMinutes: 70, isAddOn: false },
  ],
  pendingChangeRequests: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.ticket as any).mockResolvedValue(ticket());
  (techApi.ticketMembership as any).mockResolvedValue({ hasMembership: false, membership: null, benefits: [] });
  (techApi.accept as any).mockResolvedValue(ticket({ status: 'accepted' }));
  (techApi.startService as any).mockResolvedValue(ticket());
  (techApi.serviceDone as any).mockResolvedValue(ticket({ status: 'done' }));
  (techApi.editOptions as any).mockResolvedValue(editOptions());
  (techApi.patchLine as any).mockResolvedValue({ ok: true });
  (techApi.removeLine as any).mockResolvedValue({ ok: true });
  (techApi.addNote as any).mockResolvedValue({ ok: true });
  (techApi.requestCancel as any).mockResolvedValue({ ok: true });
});

describe('TicketDetailScreen', () => {
  it('renders the ticket', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();        // main services card
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('accepts an assigned ticket', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ status: 'assigned', version: 7 }));
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Accept Ticket'));
    // §14: accept must forward the record version for optimistic-concurrency protection
    await waitFor(() => expect(techApi.accept).toHaveBeenCalledWith('T1', 7));
  });

  it('starts service on an accepted ticket', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ status: 'accepted' }));
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Start Service'));
    // BUILD_PLAN Phase 13: one Idempotency-Key per start (the journal replays with it)
    await waitFor(() => expect(techApi.startService).toHaveBeenCalledWith('T1', { idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_\-:.]{8,200}$/) }));
  });

  it('completes service via the confirm modal', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByRole('button', { name: 'Service Done' })); // primary opens the confirm modal
    expect(await screen.findByText('Complete this service?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm Service Done'));
    await waitFor(() => expect(techApi.serviceDone).toHaveBeenCalledWith('T1', undefined, { idempotencyKey: expect.any(String) }));
  });

  it('edit modal renders the real line name and sends the real line id on mark-done (fix)', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Edit Ticket'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Gel Manicure/)).toBeInTheDocument();   // l.name (was blank when read as l.serviceName)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(techApi.patchLine).toHaveBeenCalledWith('T1', 'line1', { status: 'done' }));
  });

  it('edit modal remove sends the real line id (fix)', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Edit Ticket'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(techApi.removeLine).toHaveBeenCalledWith('T1', 'line1'));
  });

  it('adds a note', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Add Note'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Note/), { target: { value: 'Used OPI gel' } });
    fireEvent.click(within(dialog).getByText('Save Note'));
    await waitFor(() => expect(techApi.addNote).toHaveBeenCalledWith('T1', 'Used OPI gel', 'internal'));
  });

  it('requests a cancellation', async () => {
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByText('Cancel Ticket'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Reason'), { target: { value: 'Customer left' } });
    fireEvent.click(within(dialog).getByText('Send Request'));
    await waitFor(() => expect(techApi.requestCancel).toHaveBeenCalledWith('T1', 'Customer left'));
  });

  it('BUILD_PLAN Phase 6: a new assignment says how the guest came to you (auto-assigned + locked to you)', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ status: 'assigned', version: 7, assignmentReason: 'From check-in', queueItemId: 'q1', assignSource: 'auto_assign', lock: { technicianId: 'tech1', reason: 'Regular client' }, lockedToYou: true }));
    render(<TicketDetailScreen ticketId="T1" />);
    expect(await screen.findByText('How you got this guest')).toBeInTheDocument();
    const chips = screen.getByTestId('assignment-origin');
    expect(chips).toHaveTextContent('Auto-assigned');
    expect(chips).toHaveTextContent('Locked to you');
  });

  it('BUILD_PLAN Phase 6: no source / lock from the server → no "How you got this guest" row', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ status: 'assigned', version: 7, assignmentReason: 'From check-in' }));
    render(<TicketDetailScreen ticketId="T1" />);
    expect(await screen.findByText('From check-in')).toBeInTheDocument();
    expect(screen.queryByText('How you got this guest')).toBeNull();
  });

  it('multi-technician routing: a part of a shared visit shows the chip, who else is on the visit, and "Finish my part"', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ sharedVisit: { visitPart: 1, partCount: 2, others: [{ technicianName: 'Leo', serviceNames: ['Manicure', 'Nail Art'], status: 'serving' }] } }));
    render(<TicketDetailScreen ticketId="T1" />);
    expect(await screen.findByText('Shared visit · Part 1 of 2')).toBeInTheDocument();
    const box = screen.getByLabelText('Shared visit');
    expect(within(box).getByText('Leo')).toBeInTheDocument();
    expect(within(box).getByText(/Manicure, Nail Art/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Service Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finish my part' }));
    expect(await screen.findByText('Finish your part?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm — finish my part'));
    await waitFor(() => expect(techApi.serviceDone).toHaveBeenCalledWith('T1', undefined, { idempotencyKey: expect.any(String) }));
  });

  it('multi-technician routing: a whole-visit ticket (no sharedVisit / one part) keeps "Service Done" and no chip', async () => {
    (techApi.ticket as any).mockResolvedValue(ticket({ sharedVisit: { visitPart: 1, partCount: 1, others: [] } }));
    render(<TicketDetailScreen ticketId="T1" />);
    await screen.findByText('Jane Doe');
    expect(screen.queryByText(/Shared visit/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Service Done' })).toBeInTheDocument();
  });

  it('shows an error when the ticket fails to load', async () => {
    (techApi.ticket as any).mockRejectedValue(new Error('Ticket not found'));
    render(<TicketDetailScreen ticketId="T1" />);
    expect(await screen.findByText('Ticket not found')).toBeInTheDocument();
  });
});
