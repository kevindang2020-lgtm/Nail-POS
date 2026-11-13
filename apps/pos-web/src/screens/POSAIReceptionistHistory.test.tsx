// POSAIReceptionistHistory.test — extras AI Receptionist Settings 06: the protected-settings history searches and filters on
// the server, opens a before → after overlay, and restores a version only through the server's plan (a blocked version
// shows why instead of a button; no button without ai.manage).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { historyFn, restoreFn } = vi.hoisted(() => ({ historyFn: vi.fn(), restoreFn: vi.fn() }));
vi.mock('../api/posAiReceptionistCenterApi', () => ({ posAiReceptionistCenterApi: { controlHistory: historyFn, restore: restoreFn } }));
import { ControlHistory } from './POSAIReceptionistScreen';

const row = (o: Record<string, unknown>) => ({ id: 'e1', action: 'activate', at: '2026-11-10T15:00:00Z', actorName: 'Kim Owner', reason: 'go live please', actorUserId: 'u1',
  before: { bookingArmed: true, testCallVerifiedAt: '2026-11-10T14:00:00Z', activated: false }, after: { bookingArmed: true, testCallVerifiedAt: '2026-11-10T14:00:00Z', activated: true },
  restore: { actions: ['arm_booking', 'activate'], blockers: [] }, ...o });
const page = (items: unknown[]) => ({ items, pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 }, current: { bookingArmed: false, activated: false, testCallVerifiedAt: '2026-11-10T14:00:00Z', version: 7 } });

beforeEach(() => {
  historyFn.mockReset().mockResolvedValue(page([row({}), row({ id: 'e2', action: 'arm_booking', reason: 'first arm', restore: { actions: [], blockers: ['test_call_needs_new_verification'] } })]));
  restoreFn.mockReset();
});

describe('AI Receptionist Settings 06 — settings history', () => {
  it('lists who changed what; the search and From/To go to the server (page 1)', async () => {
    render(<ControlHistory canManage onClose={() => {}} />);
    const rows = await screen.findAllByTestId('rcp-hist-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Kim Owner');
    expect(historyFn).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, q: undefined, from: undefined, to: undefined });
    fireEvent.change(screen.getByTestId('rcp-hist-q'), { target: { value: ' pause ' } });
    fireEvent.click(screen.getByTestId('rcp-hist-search'));
    await waitFor(() => expect(historyFn).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, q: 'pause', from: undefined, to: undefined }));
    fireEvent.click(screen.getByTestId('rcp-hist-clear'));
    await waitFor(() => expect(historyFn).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined })));
  });

  it('the overlay shows before → after and the server\'s plan; Restore needs a reason and sends the version the server returned', async () => {
    restoreFn.mockResolvedValue({ restoredFrom: 'e1', actions: ['arm_booking', 'activate'], blockers: [], control: {}, replayed: false });
    const onRestored = vi.fn();
    render(<ControlHistory canManage onClose={() => {}} onRestored={onRestored} />);
    fireEvent.click((await screen.findAllByTestId('rcp-hist-view'))[0]);
    const diff = await screen.findByTestId('rcp-hist-diff');
    expect(diff.textContent).toContain('Receptionist active'); expect(diff.textContent).toMatch(/NoYes/);
    expect(screen.getByTestId('rcp-hist-plan').textContent).toContain('Arm booking actions → Activate the receptionist');
    expect(screen.getByTestId('rcp-hist-restore')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rcp-hist-reason'), { target: { value: 'owner wants it back' } });
    fireEvent.click(screen.getByTestId('rcp-hist-restore'));
    await waitFor(() => expect(restoreFn).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', expectedVersion: 7, reason: 'owner wants it back' })));
    expect(typeof restoreFn.mock.calls[0][0].idempotencyKey).toBe('string');
    expect(await screen.findByTestId('rcp-hist-note')).toHaveTextContent('Restored. Booking actions armed. Receptionist activated.');
    expect(onRestored).toHaveBeenCalled();
  });

  it('a version the server says is blocked shows why and offers no Restore; a viewer without ai.manage never gets the button', async () => {
    const { unmount } = render(<ControlHistory canManage onClose={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('rcp-hist-view'))[1]);
    expect(await screen.findByTestId('rcp-hist-blocked')).toHaveTextContent('cannot be restored from history');
    expect(screen.queryByTestId('rcp-hist-restore')).toBeNull();
    unmount();
    render(<ControlHistory onClose={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('rcp-hist-view'))[0]);
    await screen.findByTestId('rcp-hist-plan');
    expect(screen.queryByTestId('rcp-hist-restore')).toBeNull();
    expect(screen.queryByTestId('rcp-hist-reason')).toBeNull();
  });

  it('a refused restore shows the server\'s reason and the failing gates', async () => {
    restoreFn.mockRejectedValue(Object.assign(new Error('This version cannot be restored until its gates pass again.'), { code: 'AI_RCPT_GATES_NOT_MET', details: { failing: ['ent.package'] } }));
    render(<ControlHistory canManage onClose={() => {}} />);
    fireEvent.click((await screen.findAllByTestId('rcp-hist-view'))[0]);
    fireEvent.change(await screen.findByTestId('rcp-hist-reason'), { target: { value: 'owner wants it back' } });
    fireEvent.click(screen.getByTestId('rcp-hist-restore'));
    expect(await screen.findByTestId('rcp-hist-note')).toHaveTextContent('AI phone subscription');
  });
});
