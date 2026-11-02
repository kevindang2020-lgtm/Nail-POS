// ProfileChangeRequestsPanel — §95: the salon switch, the held-edit queue with "now vs requested", approve carries the
// version, send-back asks for a note inline (no native dialog), and the panel stays out of the way without the
// edit permission when nothing is waiting.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const h = vi.hoisted(() => ({ profilePolicy: vi.fn(), setProfilePolicy: vi.fn(), profileChanges: vi.fn(), decideProfileChange: vi.fn(), perms: ['pos.technicians.view', 'pos.technicians.edit'] as string[] }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: h }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
vi.mock('./usePermissions', () => ({ useCan: () => (p: string) => h.perms.includes(p) }));
import { ProfileChangeRequestsPanel } from './ProfileChangeRequestsPanel';

const req = { requestId: 'r1', profileId: 'p1', technicianId: 't1', displayName: 'Mia Pham', changes: { bio: 'New bio', languages: ['English', 'Vietnamese'] }, current: { bio: 'Old bio', languages: ['English'] }, requestedAt: '2026-10-13T10:00:00Z', version: 2 };

beforeEach(() => {
  h.perms = ['pos.technicians.view', 'pos.technicians.edit'];
  for (const k of ['profilePolicy', 'setProfilePolicy', 'profileChanges', 'decideProfileChange'] as const) h[k].mockReset();
  h.profilePolicy.mockResolvedValue({ publicProfileChangesRequireApproval: true, updatedAt: null });
  h.profileChanges.mockResolvedValue({ requests: [req] });
  h.decideProfileChange.mockResolvedValue({ ok: true, decision: 'approved' });
  h.setProfilePolicy.mockImplementation(async (on: boolean) => ({ publicProfileChangesRequireApproval: on }));
});

describe('ProfileChangeRequestsPanel', () => {
  it('shows now vs requested and approves with the request version', async () => {
    render(<ProfileChangeRequestsPanel />);
    expect(await screen.findByText('Mia Pham')).toBeInTheDocument();
    expect(screen.getByText('Old bio')).toBeInTheDocument();
    expect(screen.getByText('New bio')).toBeInTheDocument();
    expect(screen.getByText('English, Vietnamese')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decideProfileChange).toHaveBeenCalledWith('r1', 'approve', 2, undefined));
    expect(await screen.findByRole('status')).toHaveTextContent('Mia Pham’s profile changes are live.');
  });

  it('send back asks for a note inline and sends it; a 409 shows the server sentence', async () => {
    render(<ProfileChangeRequestsPanel />);
    await screen.findByText('Mia Pham');
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    const input = await screen.findByLabelText('Note to the technician');
    fireEvent.change(input, { target: { value: 'Keep it professional' } });
    h.decideProfileChange.mockRejectedValueOnce(new Error('This request changed since you loaded it. Refresh and decide again.'));
    const buttons = screen.getAllByRole('button', { name: 'Send back' });
    fireEvent.click(buttons[buttons.length - 1]);                         // the inline ask bar's confirm
    await waitFor(() => expect(h.decideProfileChange).toHaveBeenCalledWith('r1', 'reject', 2, 'Keep it professional'));
    expect(await screen.findByText(/changed since you loaded it/)).toBeInTheDocument();
    expect(h.profileChanges).toHaveBeenCalledTimes(2);   // reloaded after the conflict
  });

  it('the switch flips the salon policy; without the edit permission and no requests the panel renders nothing', async () => {
    h.profileChanges.mockResolvedValue({ requests: [] });
    render(<ProfileChangeRequestsPanel />);
    const box = await screen.findByLabelText("Require manager approval for technicians' public profile changes");
    await waitFor(() => expect(box).toBeChecked());
    fireEvent.click(box);
    await waitFor(() => expect(h.setProfilePolicy).toHaveBeenCalledWith(false));
    h.perms = ['pos.technicians.view'];
    const { container } = render(<ProfileChangeRequestsPanel />);
    await waitFor(() => expect(h.profileChanges).toHaveBeenCalledTimes(2));
    expect(container.querySelector('section')).toBeNull();
  });
});
