// POSAccessGovernanceScreen.test.tsx — BUILD_PLAN Phase 9: access reviews, high-risk access, dormant accounts, denials.
// Real api client, routed fetch; routes are contract §3.4 (/pos/security/*) exactly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'OWNER' } }) }));
import { install, sent, ROLES, review, stepUpGated, stepUpRoute, type Routes as R } from './accessTestKit';
import { POSAccessGovernanceScreen } from './POSAccessGovernanceScreen';

const S = '/pos/security';
const routes = (): R => ({
  [`GET ${S}/access-reviews`]: { body: [review(), review({ id: 'rv0', status: 'completed', completedAt: '2026-07-01T00:00:00Z', createdAt: '2026-06-30T00:00:00Z' })] },
  [`GET ${S}/access-reviews/rv1`]: { body: review() },
  [`POST ${S}/access-reviews`]: (c) => ({ body: review({ id: 'rv2', dueAt: c.body.dueAt ?? null }) }),
  [`POST ${S}/access-reviews/rv1/decisions`]: stepUpGated((c) => ({ body: review({ items: review().items.map((i) => (i.userId === c.body.userId ? { ...i, decision: c.body.decision, note: c.body.note, decidedAt: '2026-10-08T13:00:00Z' } : i)) }) })),
  [`POST ${S}/access-reviews/rv1/complete`]: { body: review({ status: 'completed', completedAt: '2026-10-08T14:00:00Z' }) },
  'POST /auth/step-up': stepUpRoute(),
  'GET /pos/access/roles': { body: ROLES },
  [`GET ${S}/high-risk`]: { body: { generatedAt: '2026-10-08T12:00:00Z', rows: [{ userId: 'u2', name: 'Mai Tran', role: 'MANAGER', permissions: [{ key: 'checkout.approve_refund', sensitivity: 'critical', via: 'granted_by_role' }, { key: 'settings.edit', sensitivity: 'high', via: 'granted_temporarily' }] }] } },
  [`GET ${S}/dormant`]: (c) => ({ body: { generatedAt: '2026-10-08T12:00:00Z', thresholdDays: Number(new URL(c.url, 'http://x').searchParams.get('days')), rows: [{ userId: 'u3', name: 'Rae Desk', role: 'FRONT_DESK', lastLoginAt: null, daysSince: null, status: 'active' }] } }),
  [`GET ${S}/denials`]: { body: { from: '2026-10-01', to: '2026-10-08', total: 7, byKey: [{ key: 'checkout.approve_refund', count: 5 }, { key: 'customers.export', count: 2 }], byReason: [{ reason: 'missing_permission', count: 5 }, { reason: 'denied_by_override', count: 2 }], byUser: [{ userId: 'u3', name: 'Rae Desk', count: 7 }] } },
});
let R0: R;
beforeEach(() => { perms.deny = new Set(); R0 = routes(); install(R0); });
const renderIt = () => render(<MemoryRouter><POSAccessGovernanceScreen /></MemoryRouter>);
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('access reviews', () => {
  it('lists reviews with progress; starting one posts the due date and opens it', async () => {
    renderIt();
    const rows = await screen.findAllByTestId('review-row');
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveTextContent('1 / 2');
    fireEvent.change(screen.getByLabelText('Review due date'), { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByText('Start a review'));
    await waitFor(() => expect(sent('POST', `${S}/access-reviews`).length).toBe(1));
    expect(sent('POST', `${S}/access-reviews`)[0].body.dueAt).toBe(new Date('2026-10-31T23:59:59').toISOString());
    expect(await screen.findByRole('region', { name: 'Review' })).toBeInTheDocument();
  });
  it('revoke a person: step-up, then the decision posts once; complete stays disabled until everyone is decided', async () => {
    renderIt();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]);
    const items = await screen.findAllByTestId('review-item');
    expect(items[0]).toHaveTextContent('checkout.approve_refund');
    expect(screen.getByText('Complete review')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Decision for Mai Tran'), { target: { value: 'revoke' } });
    fireEvent.change(screen.getByLabelText('Note for Mai Tran'), { target: { value: 'left the salon' } });
    fireEvent.click(within(items[0]).getByText('Save'));
    const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    expect(await screen.findByText(/Access revoked — their sessions are ended/)).toBeInTheDocument();
    const d = sent('POST', `${S}/access-reviews/rv1/decisions`);
    expect(d.length).toBe(2);
    expect(d[1].body).toEqual({ userId: 'u2', decision: 'revoke', note: 'left the salon', templateKey: null });
    expect(screen.getByText('Complete review')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Complete review'));
    expect(await screen.findByText('Review completed.')).toBeInTheDocument();
    expect(sent('POST', `${S}/access-reviews/rv1/complete`).length).toBe(1);
  });
  it('"change role" needs a role built on their base role', async () => {
    R0[`POST ${S}/access-reviews/rv1/decisions`] = (c) => ({ body: review({ items: review().items.map((i) => (i.userId === c.body.userId ? { ...i, decision: 'change' } : i)) }) });
    renderIt();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]);
    fireEvent.change(await screen.findByLabelText('Decision for Mai Tran'), { target: { value: 'change' } });
    const roleSel = screen.getByLabelText('New role for Mai Tran') as HTMLSelectElement;
    expect([...roleSel.options].map((o) => o.value)).toEqual(['', 'MANAGER', 'ACCOUNTANT']);
    const save = within(screen.getAllByTestId('review-item')[0]).getByText('Save');
    expect(save).toBeDisabled();
    fireEvent.change(roleSel, { target: { value: 'ACCOUNTANT' } });
    fireEvent.click(save);
    await waitFor(() => expect(sent('POST', `${S}/access-reviews/rv1/decisions`)[0]?.body).toEqual({ userId: 'u2', decision: 'change', note: null, templateKey: 'ACCOUNTANT' }));
  });
  it('without access_review.manage: read-only (no start, no decisions)', async () => {
    perms.deny = new Set(['access_review.manage']);
    renderIt();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[0]);
    await screen.findAllByTestId('review-item');
    expect(screen.queryByText('Start a review')).toBeNull();
    expect(screen.queryByLabelText('Decision for Mai Tran')).toBeNull();
    expect(screen.queryByText('Complete review')).toBeNull();
  });
});

describe('reports', () => {
  it('high-risk: each person’s high / critical keys with sensitivity and WHY', async () => {
    renderIt(); tab('High-risk access');
    const row = await screen.findByTestId('high-risk-row');
    expect(row).toHaveTextContent('Mai Tran');
    expect(within(row).getByTestId('sens-critical')).toBeInTheDocument();
    expect(row).toHaveTextContent('Temporary grant');
    expect(within(row).getByText('Mai Tran').closest('a')).toHaveAttribute('href', '/tenant/team/permissions/u2');
  });
  it('dormant: the threshold goes to the server as ?days=', async () => {
    renderIt(); tab('Dormant accounts');
    expect(await screen.findByTestId('dormant-row')).toHaveTextContent('never');
    expect(sent('GET', `${S}/dormant`)[0].url).toMatch(/days=60/);
    fireEvent.change(screen.getByLabelText('Dormant after'), { target: { value: '90' } });
    await waitFor(() => expect(sent('GET', `${S}/dormant`).some((c) => /days=90/.test(c.url))).toBe(true));
  });
  it('denials: totals by permission, reason and person for the chosen dates', async () => {
    renderIt(); tab('Denials');
    expect(await screen.findByTestId('denials-total')).toHaveTextContent('7 refused requests');
    expect(screen.getAllByTestId('denial-key').length).toBe(2);
    expect(screen.getByText('Not in their role — 5')).toBeInTheDocument();
    expect(sent('GET', `${S}/denials`)[0].url).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  });
  it('tabs follow permissions: no security_reports.view → only reviews; neither → a permission message and no calls', async () => {
    perms.deny = new Set(['security_reports.view']);
    const { unmount } = renderIt();
    await screen.findAllByTestId('review-row');
    expect(screen.queryByRole('tab', { name: 'High-risk access' })).toBeNull();
    unmount();
    perms.deny = new Set(['security_reports.view', 'access_review.view']);
    install(routes());
    renderIt();
    expect(screen.getByText(/do not have permission to view access governance/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent('GET', S).length).toBe(0);
  });
});
