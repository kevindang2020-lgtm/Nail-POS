// VisitPlanPanel — multi-technician routing contract §7/§8 [F]: accept, adjusted, no-override note, 409 text, manual mode.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRecommendationView, VisitPlan } from '@aipowersalon/api-contracts/tenant';
import { VisitPlanPanel } from './VisitPlanPanel';

type Call = { url: string; method: string; body?: any };
const roster = [{ technicianId: 't1', displayName: 'Mia Johnson' }, { technicianId: 't2', displayName: 'Leo Chen' }, { technicianId: 't3', displayName: 'Ana Park' }];
const visit = (over: Partial<VisitPlan> = {}): VisitPlan => ({
  queueItemId: 'q1', customerName: 'Jessica Miller', queueVersion: 4, expectedTechnicianId: null, mode: 'split', leadTechnicianId: 't1',
  lines: [
    { queueItemId: 'q1', serviceId: 's-ped', serviceName: 'Pedicure', category: 'Pedicure', durationMinutes: 45, sequence: 1, technicianId: 't1', technicianName: 'Mia Johnson', expectedTechnicianId: null,
      timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 45, confidence: 0.8, reasons: ['Free now'], warnings: [],
      alternates: [{ technicianId: 't3', name: 'Ana Park', matchScore: 0.6, estimatedStartInMinutes: 10, reasons: [], warnings: [] }], ineligible: [] },
    { queueItemId: 'q1', serviceId: 's-man', serviceName: 'Manicure', category: 'Manicure', durationMinutes: 30, sequence: 2, technicianId: 't2', technicianName: 'Leo Chen', expectedTechnicianId: null,
      timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 5, estimatedEndInMinutes: 35, confidence: 0.7, reasons: [], warnings: [],
      alternates: [{ technicianId: 't3', name: 'Ana Park', matchScore: 0.5, estimatedStartInMinutes: 10, reasons: [], warnings: [] }], ineligible: [] },
    { queueItemId: 'q1', serviceId: 's-art', serviceName: 'Nail Art', category: 'Nail Art', durationMinutes: 15, sequence: 3, technicianId: 't2', technicianName: 'Leo Chen', expectedTechnicianId: null,
      timing: 'after', afterServiceId: 's-man', estimatedStartInMinutes: 35, estimatedEndInMinutes: 50, confidence: 0.7, reasons: [], warnings: ['Nail Art: Leo finishes close to shift end'],
      alternates: [], ineligible: [] },
  ],
  technicianCount: 2, estimatedStartInMinutes: 0, estimatedFinishInMinutes: 50,
  singleTechnicianAlternative: { technicianId: 't3', name: 'Ana Park', estimatedFinishInMinutes: 100 },
  confidence: 0.7, warnings: ['Nail Art: Leo finishes close to shift end'], conflicts: [], requiredAction: 'staff_review', ...over,
});
const reco = (v: VisitPlan = visit()): PlanRecommendationView => ({ recommendationId: 'rec-1', kind: 'visit', visit: v, party: null, planVersion: 'qa-plan-1', ruleVersion: 'r1', recoVersion: 'x', configVersion: 'c1', generatedAt: '2026-10-10T12:00:00Z' });

const mock = (over: Record<string, (c: Call) => any> = {}) => {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    const c = { url: u, method, body }; calls.push(c);
    const res = (j: any, status = 200) => ({ ok: status < 300, status, statusText: 'x', json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } } as any);
    for (const k of Object.keys(over)) if (u.includes(k)) { const r = over[k](c); if (r !== undefined) return r && r.__status ? res(r.body, r.__status) : res(r); }
    if (u.includes('/entries/q1/plan')) return res(reco());
    if (u.includes('/plans/rec-1/decision')) return res({ decision: { id: 'd1' }, applied: body?.decision === 'accepted' || body?.decision === 'adjusted', result: null });
    if (u.includes('/pos/queue/items/q1')) return res({ queueItemId: 'q1', customerName: 'Jessica Miller', version: 7, assignedTechnicianId: null, requestedServices: [{ serviceId: 's-ped', serviceName: 'Pedicure' }, { serviceId: 's-man', serviceName: 'Manicure' }] });
    if (u.includes('/pos/queue/plans/assign')) return res({ applied: true, replayed: false, items: [] });
    return res({});
  });
  (fn as any).calls = calls;
  return fn as typeof fn & { calls: Call[] };
};
const sent = (f: { calls: Call[] }, method: string, frag: string) => f.calls.filter((c) => c.method === method && c.url.includes(frag));
const all = () => true;
const noOverride = (p: string) => p !== 'ai_queue_assignment.override';
const noAi = (p: string) => !p.startsWith('ai_queue_assignment');

beforeEach(() => { vi.restoreAllMocks(); });

describe('VisitPlanPanel — AI plan', () => {
  it('shows each line: service, technician, timing (together / after Manicure), ETA and the split mode', async () => {
    globalThis.fetch = mock() as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Split across 2 technicians')).toBeInTheDocument();
    const art = screen.getByTestId('plan-line-s-art');
    expect(within(art).getByText('after Manicure')).toBeInTheDocument();
    expect(within(art).getByText('starts in 35 min · done in 50 min')).toBeInTheDocument();
    expect(within(screen.getByTestId('plan-line-s-ped')).getByText('together')).toBeInTheDocument();
    expect((screen.getByLabelText('Technician for Pedicure') as HTMLSelectElement).value).toBe('t1');
    expect(screen.getAllByText(/Leo finishes close to shift end/).length).toBeGreaterThan(0);
  });

  it('Accept sends decision accepted for the stored plan with an idempotency key', async () => {
    const f = mock(); globalThis.fetch = f as any; const onChanged = vi.fn();
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Accept plan'));
    await waitFor(() => expect(sent(f, 'POST', '/plans/rec-1/decision').length).toBe(1));
    const body = sent(f, 'POST', '/plans/rec-1/decision')[0].body;
    expect(body.decision).toBe('accepted'); expect(body.lines).toBeUndefined(); expect(typeof body.idempotencyKey).toBe('string');
    expect(await screen.findByText('Jessica Miller is assigned: Pedicure → Mia Johnson, Manicure → Leo Chen, Nail Art → Leo Chen.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('changing a line from its alternates sends adjusted with the FULL line list', async () => {
    const f = mock(); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Technician for Manicure'), { target: { value: 't3' } });
    fireEvent.click(screen.getByText('Assign changed plan'));
    await waitFor(() => expect(sent(f, 'POST', '/plans/rec-1/decision')[0]?.body).toMatchObject({ decision: 'adjusted', lines: [
      { queueItemId: 'q1', serviceId: 's-ped', technicianId: 't1' }, { queueItemId: 'q1', serviceId: 's-man', technicianId: 't3' }, { queueItemId: 'q1', serviceId: 's-art', technicianId: 't2' },
    ] }));
  });

  it('"Keep one technician" puts every line on that technician (adjusted)', async () => {
    const f = mock(); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Keep one technician: Ana Park'));
    fireEvent.click(screen.getByText('Assign changed plan'));
    await waitFor(() => expect(sent(f, 'POST', '/plans/rec-1/decision')[0]?.body.lines.map((l: any) => l.technicianId)).toEqual(['t3', 't3', 't3']));
  });

  it('without the override permission a changed plan cannot be sent — a plain note says why', async () => {
    const f = mock(); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={noOverride} onChanged={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Technician for Pedicure'), { target: { value: 't3' } });
    expect(screen.getByText(/Changing a technician needs a manager/)).toBeInTheDocument();
    expect(screen.getByText('Assign changed plan')).toBeDisabled();
    fireEvent.click(screen.getByText('Undo changes'));
    expect(screen.getByText('Accept plan')).not.toBeDisabled();
    expect(sent(f, 'POST', '/decision').length).toBe(0);
  });

  it('a 409 on one service says which service changed and who has it, then reloads the plan', async () => {
    let n = 0;
    const f = mock({ '/plans/rec-1/decision': () => ({ __status: 409, body: { message: 'changed', code: 'VERSION_CONFLICT', queueItemId: 'q1', serviceId: 's-man', currentTechnicianId: 't3', currentVersion: 5 } }), '/entries/q1/plan': () => { n++; return reco(); } });
    globalThis.fetch = f as any; const onChanged = vi.fn();
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Accept plan'));
    expect(await screen.findByText('Someone else changed Manicure for Jessica Miller first — it is now with Ana Park. The plan has been reloaded; nothing was assigned.')).toBeInTheDocument();
    await waitFor(() => expect(n).toBe(2));
    expect(onChanged).toHaveBeenCalledWith(null);
  });

  it('an ASSIGNMENT_LOCKED 409 names the lock', async () => {
    const f = mock({ '/plans/rec-1/decision': () => ({ __status: 409, body: { message: 'locked', code: 'ASSIGNMENT_LOCKED', lock: { technicianId: 't2', reason: 'regular' } } }) });
    globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Accept plan'));
    expect(await screen.findByText('Jessica Miller is locked to Leo Chen (“regular”). A manager has to unlock the guest first. Nothing was assigned.')).toBeInTheDocument();
  });

  it('reject needs a reason and what was wrong; keep unassigned asks (optional) why', async () => {
    const f = mock(); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Reject…'));
    fireEvent.click(screen.getByText('Reject plan'));
    expect(screen.getByText('Say why you are rejecting this plan.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reject reason'), { target: { value: 'guest wants one person' } });
    fireEvent.change(screen.getByLabelText('What was wrong'), { target: { value: 'customer_preference' } });
    fireEvent.click(screen.getByText('Reject plan'));
    await waitFor(() => expect(sent(f, 'POST', '/decision')[0]?.body).toMatchObject({ decision: 'rejected', reason: 'guest wants one person', feedbackCode: 'customer_preference' }));
    fireEvent.click(screen.getByText('Keep unassigned'));
    await screen.findByLabelText('Your answer');
    fireEvent.click(screen.getAllByText('Keep unassigned').pop()!);
    await waitFor(() => expect(sent(f, 'POST', '/decision').some((c) => c.body?.decision === 'kept_unassigned')).toBe(true));
  });

  it('a failed plan read is an honest error with retry and a manual fallback — never an empty plan', async () => {
    const f = mock({ '/entries/q1/plan': () => ({ __status: 500, body: { message: 'boom' } }) }); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('Could not work out a plan for Jessica Miller: boom.')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.queryByText('Accept plan')).toBeNull();
    fireEvent.click(screen.getByText('Pick technicians by hand'));
    expect(await screen.findByLabelText('Technician for Pedicure')).toBeInTheDocument();
  });

  it('a plan line nobody can do blocks Accept (all or none)', async () => {
    const v = visit(); v.lines[2] = { ...v.lines[2], technicianId: null, technicianName: null, alternates: [], ineligible: [{ technicianId: 't9', name: 'Kim', reasons: ['On break'] }] };
    globalThis.fetch = mock({ '/entries/q1/plan': () => reco({ ...v, requiredAction: 'no_eligible_technician' }) }) as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText('No technician can do Nail Art right now (Kim: On break).')).toBeInTheDocument();
    expect(screen.getByText('Accept plan')).toBeDisabled();
  });

  it('unknown availability shows "time unknown", never a made-up ETA', async () => {
    const v = visit({ estimatedStartInMinutes: null, estimatedFinishInMinutes: null }); v.lines = v.lines.map((l) => ({ ...l, estimatedStartInMinutes: null, estimatedEndInMinutes: null }));
    globalThis.fetch = mock({ '/entries/q1/plan': () => reco(v) }) as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText(/Time unknown — a technician’s availability is not known yet/)).toBeInTheDocument();
    expect(screen.getAllByText('time unknown').length).toBe(3);
  });
});

describe('VisitPlanPanel — manual mode (no AI)', () => {
  it('with no AI permission: one select per service → assignPlan with the item version, expected technicians, key, source staff', async () => {
    const f = mock(); globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={noAi} onChanged={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Technician for Pedicure'), { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Assign technicians'));
    expect(screen.getByText('Pick a technician for every service — a plan assigns all of them or none.')).toBeInTheDocument();
    expect(sent(f, 'POST', '/plans/assign').length).toBe(0);
    fireEvent.change(screen.getByLabelText('Technician for Manicure'), { target: { value: 't2' } });
    fireEvent.click(screen.getByText('Assign technicians'));
    await waitFor(() => expect(sent(f, 'POST', '/pos/queue/plans/assign').length).toBe(1));
    const body = sent(f, 'POST', '/pos/queue/plans/assign')[0].body;
    expect(body).toMatchObject({ source: 'staff', items: [{ queueItemId: 'q1', expectedVersion: 7, expectedTechnicianId: null, lines: [
      { serviceId: 's-ped', technicianId: 't1', expectedTechnicianId: null }, { serviceId: 's-man', technicianId: 't2', expectedTechnicianId: null }] }] });
    expect(typeof body.idempotencyKey).toBe('string');
    expect(sent(f, 'POST', '/entries/q1/plan').length).toBe(0);
    expect(f.calls.some((c) => c.url.includes('service-assignments'))).toBe(false);
  });

  it('402 (no AI entitlement) falls back to manual mode and says so', async () => {
    globalThis.fetch = mock({ '/entries/q1/plan': () => ({ __status: 402, body: { message: 'no' } }) }) as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={all} onChanged={() => {}} />);
    expect(await screen.findByText(/AI plans are not enabled for this salon/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Technician for Manicure')).toBeInTheDocument();
  });

  it('manual 409 is said in plain words and the services are re-read', async () => {
    let reads = 0;
    const f = mock({ '/pos/queue/plans/assign': () => ({ __status: 409, body: { code: 'VERSION_CONFLICT', queueItemId: 'q1', currentTechnicianId: 't2', currentVersion: 8 } }),
      '/pos/queue/items/q1': () => { reads++; return { queueItemId: 'q1', version: 7, assignedTechnicianId: null, requestedServices: [{ serviceId: 's-ped', serviceName: 'Pedicure' }] }; } });
    globalThis.fetch = f as any;
    render(<VisitPlanPanel queueItemId="q1" customerName="Jessica Miller" roster={roster} can={noAi} onChanged={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Technician for Pedicure'), { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Assign technicians'));
    expect(await screen.findByText('Someone else changed Jessica Miller first — they are now with Leo Chen. The queue has been refreshed; nothing was assigned.')).toBeInTheDocument();
    await waitFor(() => expect(reads).toBe(2));
  });
});
