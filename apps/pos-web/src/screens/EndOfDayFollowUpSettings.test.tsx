// End-of-Day Follow-Ups management center (EOD guide, Oct 30 2026): the seven settings + cooldown load from the server
// summary, Save sends the full editable payload, Preview Tonight is read-only (it only calls GET preview), the history
// list is server-driven (search goes to the server), and a 403 shows the permission notice.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/posFollowUpApi', () => ({ posFollowUpApi: { getSettings: vi.fn(), saveSettings: vi.fn() } }));
vi.mock('../api/posEodFollowUpsApi', () => ({ posEodFollowUpsApi: { summary: vi.fn(), health: vi.fn(), preview: vi.fn(), runs: vi.fn(), tasks: vi.fn(), task: vi.fn(), send: vi.fn(), approve: vi.fn(), reject: vi.fn() } }));

import { posFollowUpApi } from '../api/posFollowUpApi';
import { posEodFollowUpsApi } from '../api/posEodFollowUpsApi';
import { EndOfDayFollowUpSettings } from './EndOfDayFollowUpSettings';

const settings = (over: any = {}) => ({
  enabled: true, generationTime: '20:00', timezone: 'America/New_York', allowTechEditMessage: true, allowCustomerReplies: false, requireManagerApproval: false,
  reminderToTech: true, createMode: 'end_of_day', autoExpirePendingHours: 24, defaultMessageTemplate: null, contactCooldownHours: 24, ...over,
});
const page = (items: any[] = []) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1, basis: 'generated', sort: 'newest' });
const api = posEodFollowUpsApi as any;

beforeEach(() => {
  vi.clearAllMocks();
  api.summary.mockResolvedValue({ settings: settings(), today: '2026-10-31', timezone: 'America/New_York', generatedAt: '2026-10-31T12:00:00Z',
    nextRun: { businessDate: '2026-10-31', localTime: '20:00', timezone: 'America/New_York', at: '2026-11-01T00:00:00Z', dueNow: false }, lastRun: null,
    kpis: { pending: 3, awaitingApproval: 1, rejected: 0, sentToday: 2, failedToday: 0, expiredToday: 1, bookedAfter30d: 0 } });
  api.health.mockResolvedValue({ overall: 'unknown', rows: [{ key: 'scheduler', state: 'unknown', detail: 'No worker has recorded this job here yet.', evidence: 'scheduler_runs: none', nextStep: null }] });
  api.tasks.mockResolvedValue(page([{ id: 't1', businessDate: '2026-10-31', status: 'pending', customerId: 'c1', customerName: 'Ava Kim', customerPhoneLast4: '0101', customerHasApp: true, serviceName: 'Gel', technicianId: 'x1', technicianName: 'Ana One', completedAt: null, createdAt: null, sentAt: null, expiredAt: null, reason: null, managerNote: null, ticketId: 'k', ticketNumber: '1001', appointmentId: null, approved: false, overridden: false }]));
  api.runs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
  api.preview.mockResolvedValue({ businessDate: '2026-10-31', timezone: 'America/New_York', enabled: true, nextRun: null, generatedAt: '', note: 'Preview only — nothing was created, sent or notified.', totals: { candidates: 3, wouldCreate: 2, excluded: 1, noApp: 0, reasons: { already_generated: 0, customer_archived: 0, already_booked: 1, recently_contacted: 0 } }, technicians: [], rows: [] });
  (posFollowUpApi.saveSettings as any).mockImplementation((p: any) => Promise.resolve(settings(p)));
});
const mount = () => render(<MemoryRouter><EndOfDayFollowUpSettings /></MemoryRouter>);

describe('EndOfDayFollowUpSettings — management center', () => {
  it('shows the server KPIs, the honest health state and the history row', async () => {
    mount();
    expect(await screen.findByText('Ava Kim')).toBeInTheDocument();
    expect(screen.getByTestId('eod-kpi-automation')).toHaveTextContent(/Unknown/);
    expect(screen.getByTestId('eod-kpi-pending')).toHaveTextContent('4');
  });
  it('Save sends every setting including the contact cooldown', async () => {
    mount();
    fireEvent.change(await screen.findByTestId('eod-set-cooldown'), { target: { value: '48' } });
    fireEvent.click(screen.getByTestId('eod-save'));
    await waitFor(() => expect(posFollowUpApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, generationTime: '20:00', autoExpirePendingHours: 24, contactCooldownHours: 48 })));
  });
  it('Preview Tonight only reads (GET preview) and shows the counts', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('eod-preview-btn'));
    expect(await screen.findByTestId('eod-pv-create')).toHaveTextContent('2');
    expect(api.send).not.toHaveBeenCalled(); expect(api.approve).not.toHaveBeenCalled();
  });
  it('search goes to the server', async () => {
    mount();
    fireEvent.change(await screen.findByTestId('eod-search'), { target: { value: 'ava' } });
    await waitFor(() => expect(api.tasks).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ava', page: 1 })));
  });
  it('a 403 shows the permission notice', async () => {
    api.summary.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' });
    mount();
    expect(await screen.findByTestId('eod-forbidden')).toBeInTheDocument();
  });
  it('round 10 (EOD 03 · 09): Preview shows the generation check; the details show the revision status and replies', async () => {
    api.preview.mockResolvedValue({ businessDate: '2026-10-31', timezone: 'America/New_York', enabled: true, nextRun: null, generatedAt: '', note: 'Preview only.', totals: { candidates: 3, wouldCreate: 1, excluded: 1, noApp: 0, reasons: { already_generated: 1, customer_archived: 0, already_booked: 1, recently_contacted: 0 } }, technicians: [], rows: [],
      correctness: { businessDate: '2026-10-31', eligible: 3, withTask: 1, withoutTask: 1, excludedNow: { already_booked: 1 }, tasksForDay: 2, tasksNoLongerEligible: 1, customersWithSeveralTasks: 0, run: { status: 'completed', eligible: 3, created: 1, excluded: 1 }, duplicatesPossible: false } });
    mount();
    fireEvent.click(await screen.findByTestId('eod-preview-btn'));
    expect((await screen.findByTestId('eod-pv-check-counts')).textContent).toBe('3 eligible service lines · 1 already have a follow-up · 1 still to create · 2 follow-ups on file for this day');
    expect(screen.getByTestId('eod-pv-check-run').textContent).toBe('The run recorded 3 eligible · 1 created · 1 excluded');
    expect(screen.getByTestId('eod-pv-check-issues').textContent).toMatch(/^1 follow-ups on file no longer match an eligible visit · 0 customers/);

    api.task.mockResolvedValue({ id: 't1', status: 'pending_manager_approval', businessDate: '2026-10-31', customerId: 'c1', customerName: 'Ava Kim', customerPhone: null, customerHasApp: true, technicianId: 'x1', technicianName: 'Ana One',
      serviceName: 'Gel', ticketId: 'k', ticketNumber: '1001', appointmentId: null, completedAt: null, createdAt: null, submittedAt: null, sentAt: null, expiredAt: null, rejectedAt: null, templateKey: null, draft: 'Hi', sentMessage: null,
      reason: null, managerNote: null, overrideReason: null, approved: false, delivery: null, customerViewedAt: null, bookedAfter: null, timeline: [],
      approval: { state: 'resubmitted', revision: 2, submissions: 2, rejections: 1, lastRejectedAt: null, lastSubmittedAt: null },
      replies: { count: 0, lastAt: null, mappedTo: { taskId: 't1', customerId: 'c1', ticketId: 'k' }, channel: 'customer_app' } });
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(await screen.findByTestId('eod-row-details'));
    expect((await screen.findByTestId('eod-d-approval')).textContent).toBe('Changed and sent back for approval (version 2) · returned 1 time(s)');
    expect(screen.getByTestId('eod-d-replies').textContent).toBe('No reply from the customer yet');
  });
});
