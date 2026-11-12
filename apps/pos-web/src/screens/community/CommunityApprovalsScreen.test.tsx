// CommunityApprovalsScreen.test.tsx — BUILD_PLAN Phase 8: /community/approvals (manager approve / return with a note).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { B, calls, err, installFetch, myPost, page, sent, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'MANAGER', userId: 'u2' } }) }));
import { CommunityApprovalsScreen, approvalBacklog } from './CommunityApprovalsScreen';

let routes: Record<string, R>;
const waiting = () => [myPost({ id: 'd1', title: 'Caller asked for our login code', status: 'manager_approval', version: 3, awaitingMyApproval: true, createdByMe: false, privacyScanFlags: ['phone'] }),
  myPost({ id: 'd2', title: 'Fake supplier invoice', category: 'fake_vendor_or_supplier', severity: 'moderate', status: 'manager_approval', version: 2, awaitingMyApproval: true, moderationRequired: false })];
beforeEach(() => {
  perms.deny = new Set();
  routes = {
    [`GET ${B}/mine`]: { body: page(waiting()) },
    [`POST ${B}/advisories/d1/approve`]: { body: myPost({ id: 'd1', title: 'Caller asked for our login code', status: 'moderation_review', version: 4 }) },
    [`POST ${B}/advisories/d2/approve`]: { body: myPost({ id: 'd2', title: 'Fake supplier invoice', status: 'published_unverified', version: 3 }) },
    [`POST ${B}/advisories/d2/return`]: { body: myPost({ id: 'd2', status: 'returned_for_correction' }) },
  };
  installFetch(routes);
});
const renderIt = () => render(<MemoryRouter><CommunityApprovalsScreen /></MemoryRouter>);

describe('advisory approvals', () => {
  it('lists the awaiting_approval advisories with what the privacy check hid', async () => {
    renderIt();
    expect((await screen.findAllByTestId('community-approval-row')).length).toBe(2);
    expect(Object.fromEntries(sent('GET', `${B}/mine`)[0].query)).toEqual({ kind: 'awaiting_approval', page: '1', pageSize: '50' });
    expect(screen.getAllByTestId('community-approval-row')[0]).toHaveTextContent(/Hidden by the privacy check: phone/i);
  });
  it('Approve sends expectedVersion and says where it went (moderation vs published)', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Caller asked for our login code' }));
    expect(await screen.findByTestId('community-approval-result')).toHaveTextContent('goes to AI PowerSalon moderators');
    expect(sent('POST', `${B}/advisories/d1/approve`)[0].body).toEqual({ expectedVersion: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Fake supplier invoice' }));
    await waitFor(() => expect(screen.getByTestId('community-approval-result')).toHaveTextContent('Approved and published “Fake supplier invoice”'));
  });
  it('Return needs a note and sends it with expectedVersion', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Return: Fake supplier invoice' }));
    const g = screen.getByRole('group', { name: 'Return Fake supplier invoice for correction' });
    const send = within(g).getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    fireEvent.change(within(g).getByLabelText('Note for the writer'), { target: { value: 'Remove the street name.' } });
    fireEvent.click(send);
    await waitFor(() => expect(sent('POST', `${B}/advisories/d2/return`)[0]?.body).toEqual({ expectedVersion: 2, note: 'Remove the street name.' }));
  });
  it('a 409 (another manager acted) reloads the list and says so', async () => {
    routes[`POST ${B}/advisories/d1/approve`] = err(409, 'version_conflict');
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Caller asked for our login code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this');
    await waitFor(() => expect(sent('GET', `${B}/mine`).length).toBeGreaterThan(1));
  });
  it('without community.advisory.approve: no list, no calls', async () => {
    perms.deny = new Set(['community.advisory.approve']);
    renderIt();
    expect(screen.getByText(/Only owners and managers/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(0);
  });
  it('empty → plain message', async () => {
    routes[`GET ${B}/mine`] = { body: page([]) };
    renderIt();
    expect(await screen.findByTestId('community-approvals-empty')).toBeTruthy();
  });
  it('extras (Safety Community 02): the SLA view counts the backlog and ages from each record, and approves nothing', async () => {
    const now = Date.now();
    const iso = (h: number) => new Date(now - h * 3_600_000).toISOString();
    routes[`GET ${B}/mine`] = { body: page([myPost({ id: 'd1', title: 'Old one', status: 'manager_approval', updatedAt: iso(80) }), myPost({ id: 'd2', title: 'Day one', status: 'manager_approval', updatedAt: iso(30) }), myPost({ id: 'd3', title: 'New one', status: 'manager_approval', updatedAt: iso(2) })], { total: 7 }) };
    renderIt();
    const sla = await screen.findByTestId('community-approval-sla');
    expect(sla).toHaveTextContent('7 waiting for approval');
    expect(screen.getByTestId('community-approval-oldest')).toHaveTextContent('Oldest of the 3 shown waiting 3 days');
    expect(screen.getByTestId('community-approval-over24')).toHaveTextContent('2 over 24 h');
    expect(screen.getByTestId('community-approval-over72')).toHaveTextContent('1 over 3 days');
    expect(screen.getAllByTestId('community-approval-age').map((e) => e.textContent)).toEqual([' · waiting 3 days', ' · waiting 30 h', ' · waiting 2 h']);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('approvalBacklog: full list → plain oldest; unreadable times are skipped, not counted as zero', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const b = approvalBacklog([{ updatedAt: '2026-11-10T11:00:00Z' }, { updatedAt: 'nope' }], 2, now);
    expect(b).toEqual({ waiting: 2, shown: 2, oldestMs: 3_600_000, over24h: 0, over72h: 0 });
    expect(approvalBacklog([], 0, now).oldestMs).toBeNull();
  });
});
