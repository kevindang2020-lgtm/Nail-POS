// PartyPlanPanel — contract §4/§7/§8 [F]: members × lines, together label + shared start, Accept all (one decision),
// a stale member → 409 in plain words, Start party → move-to-tech-queue, honest error on a failed read.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { PartyPlan, PlanRecommendationView, QueueGroupView, VisitPlan } from '@aipowersalon/api-contracts/tenant';
import { PartyPlanPanel } from './PartyPlanPanel';

type Call = { url: string; method: string; body?: any };
const roster = [{ technicianId: 't1', displayName: 'Mia Johnson' }, { technicianId: 't2', displayName: 'Leo Chen' }];
const member = (qid: string, name: string, tid: string, tname: string): VisitPlan => ({
  queueItemId: qid, customerName: name, queueVersion: 1, expectedTechnicianId: null, mode: 'single', leadTechnicianId: tid,
  lines: [{ queueItemId: qid, serviceId: `s-${qid}`, serviceName: 'Gel Manicure', category: 'Manicure', durationMinutes: 40, sequence: 1, technicianId: tid, technicianName: tname, expectedTechnicianId: null,
    timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 15, estimatedEndInMinutes: 55, confidence: 0.8, reasons: [], warnings: [], alternates: [], ineligible: [] }],
  technicianCount: 1, estimatedStartInMinutes: 15, estimatedFinishInMinutes: 55, singleTechnicianAlternative: null, confidence: 0.8, warnings: [], conflicts: [], requiredAction: 'assignable',
});
const party = (over: Partial<PartyPlan> = {}): PartyPlan => ({
  groupId: 'g1', label: 'Lee bridal party', together: true, members: [member('q2', 'Olivia Brown', 't1', 'Mia Johnson'), member('q3', 'Ana Ruiz', 't2', 'Leo Chen')],
  sharedStartInMinutes: 15, estimatedFinishInMinutes: 55, anyOrderFinishInMinutes: 40, confidence: 0.8, warnings: [], conflicts: [], requiredAction: 'assignable', ...over,
});
const reco = (p: PartyPlan = party()): PlanRecommendationView => ({ recommendationId: 'rec-p', kind: 'party', visit: null, party: p, planVersion: 'qa-plan-1', ruleVersion: 'r', recoVersion: 'x', configVersion: null, generatedAt: '2026-10-10T12:00:00Z' });
const group = (assigned: boolean): QueueGroupView => ({ groupId: 'g1', label: 'Lee bridal party', size: 2, together: true, status: 'waiting', createdAt: '2026-10-10T12:00:00Z',
  members: [{ queueItemId: 'q2', customerName: 'Olivia Brown', status: assigned ? 'assigned' : 'waiting', assignedTechnicianId: assigned ? 't1' : null, assignedTechnicianName: null },
    { queueItemId: 'q3', customerName: 'Ana Ruiz', status: assigned ? 'assigned' : 'waiting', assignedTechnicianId: assigned ? 't2' : null, assignedTechnicianName: null }] } as QueueGroupView);
const mock = (over: Record<string, (c: Call) => any> = {}) => {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    const c = { url: u, method, body }; calls.push(c);
    const res = (j: any, status = 200) => ({ ok: status < 300, status, statusText: 'x', json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } } as any);
    for (const k of Object.keys(over)) if (u.includes(k)) { const r = over[k](c); if (r !== undefined) return r && r.__status ? res(r.body, r.__status) : res(r); }
    if (u.includes('/groups/g1/plan')) return res(reco());
    if (u.includes('/plans/rec-p/decision')) return res({ decision: { id: 'd' }, applied: true, result: null });
    if (u.includes('/groups/g1/move-to-tech-queue')) return res({ moved: [{ queueItemId: 'q2', techQueueTicketIds: ['tq1'], duplicate: false }, { queueItemId: 'q3', techQueueTicketIds: ['tq2'], duplicate: false }] });
    return res({});
  });
  (fn as any).calls = calls;
  return fn as typeof fn & { calls: Call[] };
};
const sent = (f: { calls: Call[] }, method: string, frag: string) => f.calls.filter((c) => c.method === method && c.url.includes(frag));
const all = () => true;
beforeEach(() => { vi.restoreAllMocks(); });

describe('PartyPlanPanel', () => {
  it('shows members × lines, "Served together", the shared start and the any-order finish', async () => {
    globalThis.fetch = mock() as any;
    render(<PartyPlanPanel groupId="g1" label="Lee bridal party" group={group(false)} roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Served together')).toBeInTheDocument();
    expect(screen.getByText(/Everyone starts in 15 min · all done in 55 min · in any order: done in 40 min/)).toBeInTheDocument();
    expect(within(screen.getByTestId('party-member-q2')).getByText('Mia Johnson')).toBeInTheDocument();
    expect(within(screen.getByTestId('party-member-q3')).getByText('Leo Chen')).toBeInTheDocument();
  });

  it('Accept all sends ONE accepted decision for the party recommendation', async () => {
    const f = mock(); globalThis.fetch = f as any; const onChanged = vi.fn();
    render(<PartyPlanPanel groupId="g1" label="Lee bridal party" group={group(false)} roster={roster} can={all} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Accept all'));
    await waitFor(() => expect(sent(f, 'POST', '/plans/rec-p/decision').length).toBe(1));
    expect(sent(f, 'POST', '/plans/rec-p/decision')[0].body).toMatchObject({ decision: 'accepted' });
    expect(await screen.findByText('Lee bridal party: every guest is assigned.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith('Lee bridal party: every guest is assigned.');
  });

  it('a stale member → 409 names that guest; nothing assigned', async () => {
    globalThis.fetch = mock({ '/plans/rec-p/decision': () => ({ __status: 409, body: { code: 'VERSION_CONFLICT', queueItemId: 'q3', currentTechnicianId: 't1', currentVersion: 3 } }) }) as any;
    render(<PartyPlanPanel groupId="g1" label="Lee bridal party" group={group(false)} roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Accept all'));
    expect(await screen.findByText('Someone else changed Ana Ruiz first — they are now with Mia Johnson. The queue has been refreshed; nothing was assigned.')).toBeInTheDocument();
  });

  it('Start party is offered once every member is assigned and moves the group', async () => {
    const f = mock(); globalThis.fetch = f as any;
    const { rerender } = render(<PartyPlanPanel groupId="g1" label="Lee bridal party" group={group(false)} roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Start party')).toBeDisabled();
    rerender(<PartyPlanPanel groupId="g1" label="Lee bridal party" group={group(true)} roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.click(screen.getByText('Start party'));
    await waitFor(() => expect(sent(f, 'POST', '/pos/queue/groups/g1/move-to-tech-queue').length).toBe(1));
    expect(await screen.findByText('Lee bridal party: 2 guests sent to the technicians.')).toBeInTheDocument();
  });

  it('any-order parties say so', async () => {
    globalThis.fetch = mock({ '/groups/g1/plan': () => reco(party({ together: false, sharedStartInMinutes: null })) }) as any;
    render(<PartyPlanPanel groupId="g1" label="Lee bridal party" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Any order')).toBeInTheDocument();
    expect(screen.getByText(/Each guest starts as soon as a technician is free/)).toBeInTheDocument();
  });

  it('a failed read is an honest error with retry (no empty plan, no Accept)', async () => {
    let n = 0;
    globalThis.fetch = mock({ '/groups/g1/plan': () => { n++; return { __status: 500, body: { message: 'boom' } }; } }) as any;
    render(<PartyPlanPanel groupId="g1" label="Lee bridal party" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Could not work out a plan for Lee bridal party: boom.')).toBeInTheDocument();
    expect(screen.queryByText('Accept all')).toBeNull();
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(n).toBe(2));
  });
});
