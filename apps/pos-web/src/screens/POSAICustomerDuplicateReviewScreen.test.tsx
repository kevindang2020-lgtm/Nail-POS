// POSAICustomerDuplicateReviewScreen — Duplicate Review guides (Nov 1 2026). The title, subtitle, candidate table and
// "Merge into this" stay, but "Merge into this" only PROPOSES the profile to keep and opens the comparison: nothing is sent
// until Preview merge, and nothing merges until every listed item is confirmed and Confirm merge is pressed. Keep Separate
// needs a reason and never merges. A blank phone reads "Not provided", never a match or a zero. Freshness is real: a
// never-scanned salon scans once on open. A blocked preview cannot be confirmed; a role without merge permission sees why.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, perms } = vi.hoisted(() => ({
  api: { summary: vi.fn(), groups: vi.fn(), group: vi.fn(), scan: vi.fn(), decide: vi.fn(), note: vi.fn(), preview: vi.fn(), merge: vi.fn(), history: vi.fn(), check: vi.fn() },
  perms: { deny: [] as string[] },
}));
vi.mock('../api/posDuplicateReviewApi', () => ({ posDuplicateReviewApi: api, newMergeKey: () => 'key-12345678' }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAICustomerDuplicateReviewScreen } from './POSAICustomerDuplicateReviewScreen';

const FRESH = { state: 'up_to_date', lastSuccessAt: '2026-11-02T14:00:00Z', ruleVersion: 'dr-2026-11-02' };
const SUM = (o: any = {}) => ({ kpis: { open: 1, pending: 1, inReview: 0, highConfidence: 0, deferred: 0, keptSeparate: 0, merged: 0, merged30d: 0, failed: 0 }, latestDetectedAt: '2026-11-02T14:00:00Z', freshness: FRESH, ...o });
const GROUP = { id: 'g1', status: 'pending', confidence: 'possible', reasons: ['name'], why: ['name_only', 'contact_missing_on_some'], memberCount: 2, version: 3, detectedAt: '2026-11-02T14:00:00Z',
  members: [
    { customerId: 'c1aaaaaa-0000', name: 'test', phone: null, email: null, visits: 0, archived: false, createdAt: '2026-10-30T10:00:00Z' },
    { customerId: 'c2bbbbbb-0000', name: 'test', phone: '(•••) •••-0001', email: null, visits: 0, archived: false, createdAt: '2026-10-30T11:00:00Z' },
  ] };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, applied: { sort: 'newest' }, period: { today: '2026-11-02' }, contact: 'masked', freshness: FRESH });
const MEMBER = (id: string, o: any = {}) => ({ customerId: id, name: 'test', phone: null, phoneVerified: null, email: null, createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z', branch: 'Main',
  visits: 0, lastVisit: null, upcomingAppointments: 0, nextAppointment: null, canceledOrNoShow: 0, openTickets: 0, lastTechnician: null, preferredTechnician: null,
  loyalty: { points: null, tier: null }, activeMemberships: 0, giftCards: { count: 0, balanceCents: 0 }, paymentMethods: 0, consent: { sms: null, email: null }, tags: [], archived: false, missing: false, ...o });
const DETAIL = { group: { id: 'g1', status: 'pending', confidence: 'possible', reasons: ['name'], ruleVersion: 'dr-2026-11-02', version: 3, detectedAt: '2026-11-02T14:00:00Z' },
  evidence: { signals: [{ field: 'phone', state: 'partial', present: 1, of: 2 }, { field: 'email', state: 'missing', present: 0, of: 2 }, { field: 'name', state: 'match', present: 2, of: 2 }], why: ['name_only'] },
  members: [MEMBER('c1aaaaaa-0000'), MEMBER('c2bbbbbb-0000', { phone: '(•••) •••-0001', phoneVerified: false })], events: [{ id: 'e1', type: 'detected', at: '2026-11-02T14:00:00Z', note: null }] };
const PREVIEW = (o: any = {}) => ({ groupId: 'g1', previewHash: 'hash-abcdef12', expiresAt: '2026-11-02T15:10:00Z', survivor: MEMBER('c1aaaaaa-0000'), sources: [MEMBER('c2bbbbbb-0000')],
  moves: { pos_tech_appointments: 1 }, blockers: [], acknowledgements: [{ code: 'NAME_ONLY', detail: {} }, { code: 'FUTURE_APPOINTMENTS', detail: { count: 1 } }], canMerge: true, ...o });
const mount = () => render(<MemoryRouter initialEntries={['/tenant/ai/customer-profile/duplicates']}><POSAICustomerDuplicateReviewScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  perms.deny = [];
  api.summary.mockResolvedValue(SUM()); api.groups.mockResolvedValue(page([GROUP])); api.group.mockResolvedValue(DETAIL);
  api.scan.mockResolvedValue({ reused: false, scan: { groupsFound: 1 } });
});

describe('POSAICustomerDuplicateReviewScreen', () => {
  it('keeps the title, subtitle and table; a blank phone is "Not provided"; the label is evidence-backed (name only → Possible)', async () => {
    mount();
    expect(await screen.findByText('Duplicate Review')).toBeInTheDocument();
    const g = await screen.findByTestId('dup-group');
    expect(within(g).getByText('Keep this one')).toBeInTheDocument();
    expect(within(g).getAllByText('Merge into this')).toHaveLength(2);
    expect(within(g).getByTestId('dup-confidence')).toHaveTextContent('Possible');
    expect(within(g).getByTestId('dup-name-only')).toBeInTheDocument();
    expect(within(g).getAllByText('Not provided').length).toBeGreaterThanOrEqual(3);   // one blank phone + two blank emails
    expect(screen.getByTestId('dup-freshness')).toHaveTextContent(/Up to date/);
    expect(api.scan).not.toHaveBeenCalled();                                              // fresh data: no scan on open
  });

  it('"Merge into this" only proposes the profile to keep: it opens the comparison and sends nothing', async () => {
    mount();
    fireEvent.click((await screen.findAllByTestId('dup-merge-into'))[0]);
    expect(await screen.findByTestId('dup-compare')).toBeInTheDocument();
    expect((screen.getAllByTestId('dup-survivor')[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Keep this profile')).toBeInTheDocument();
    expect(api.preview).not.toHaveBeenCalled(); expect(api.merge).not.toHaveBeenCalled(); expect(api.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dup-close'));
    expect(api.merge).not.toHaveBeenCalled();
  });

  it('preview → every listed item must be confirmed → Confirm merge sends the preview hash, one request key and the acknowledgements', async () => {
    api.preview.mockResolvedValue(PREVIEW());
    api.merge.mockResolvedValue({ status: 'completed', operationId: 'op1' });
    mount();
    fireEvent.click((await screen.findAllByTestId('dup-merge-into'))[0]);
    fireEvent.click(await screen.findByTestId('dup-preview'));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith('g1', 'c1aaaaaa-0000'));
    expect(await screen.findByTestId('dup-preview-panel')).toBeInTheDocument();
    const confirm = screen.getByTestId('dup-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId('ack-NAME_ONLY'));
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId('ack-FUTURE_APPOINTMENTS'));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('g1', { survivorId: 'c1aaaaaa-0000', previewHash: 'hash-abcdef12', idempotencyKey: 'key-12345678', acknowledged: ['NAME_ONLY', 'FUTURE_APPOINTMENTS'] }));
    expect(await screen.findByTestId('dup-notice')).toHaveTextContent(/Profiles merged/);
  });

  it('a blocked preview cannot be confirmed and says why', async () => {
    api.preview.mockResolvedValue(PREVIEW({ blockers: [{ code: 'OPEN_TICKET', detail: { count: 1 } }], acknowledgements: [], canMerge: false }));
    mount();
    fireEvent.click((await screen.findAllByTestId('dup-merge-into'))[1]);
    fireEvent.click(await screen.findByTestId('dup-preview'));
    expect(await screen.findByTestId('pv-block-OPEN_TICKET')).toHaveTextContent(/open ticket/);
    expect(screen.getByTestId('dup-confirm')).toBeDisabled();
  });

  it('a stale preview answer is shown in the POS language and nothing is reported as merged', async () => {
    api.preview.mockResolvedValue(PREVIEW({ acknowledgements: [] }));
    api.merge.mockRejectedValue(Object.assign(new Error('x'), { status: 409, body: { code: 'DUPLICATE_STALE_PREVIEW' } }));
    mount();
    fireEvent.click((await screen.findAllByTestId('dup-merge-into'))[0]);
    fireEvent.click(await screen.findByTestId('dup-preview'));
    fireEvent.click(await screen.findByTestId('dup-confirm'));
    expect(await screen.findByTestId('dup-action-err')).toHaveTextContent('Something changed since the preview');
    expect(screen.queryByTestId('dup-notice')).toBeNull();
  });

  it('Keep Separate needs a reason, sends the expected version, and never merges', async () => {
    api.decide.mockResolvedValue({ id: 'g1', status: 'kept_separate', version: 4 });
    mount();
    fireEvent.click(await screen.findByTestId('dup-compare'));
    fireEvent.click(await screen.findByTestId('dup-keep'));
    expect(screen.getByTestId('dup-keep-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('dup-note-input'), { target: { value: 'two different people' } });
    fireEvent.click(screen.getByTestId('dup-keep-save'));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('g1', { decision: 'keep_separate', expectedVersion: 3, note: 'two different people' }));
    expect(api.merge).not.toHaveBeenCalled();
  });

  it('a reviewer without merge permission can preview but sees why Confirm is missing; Keep Separate is hidden', async () => {
    perms.deny = ['pos.customers.merge'];
    api.preview.mockResolvedValue(PREVIEW());
    mount();
    fireEvent.click((await screen.findAllByTestId('dup-merge-into'))[0]);
    expect(await screen.findByTestId('dup-compare')).toBeInTheDocument();
    expect(screen.queryByTestId('dup-keep')).toBeNull();
    fireEvent.click(screen.getByTestId('dup-preview'));
    expect(await screen.findByTestId('dup-no-merge')).toBeInTheDocument();
    expect(screen.queryByTestId('dup-confirm')).toBeNull();
  });

  it('a never-scanned salon scans once on open and says so; the empty state does not claim "no duplicates"', async () => {
    api.summary.mockResolvedValue(SUM({ freshness: { state: 'never', lastSuccessAt: null, ruleVersion: 'dr-2026-11-02' }, kpis: { open: 0, highConfidence: 0, deferred: 0, keptSeparate: 0, merged: 0, merged30d: 0, failed: 0 } }));
    api.groups.mockResolvedValue({ ...page([]), freshness: { state: 'never' } });
    mount();
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No scan has run yet/)).toBeInTheDocument();
  });

  it('Check Duplicate Review System shows each check in the POS language with its next step', async () => {
    api.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T14:05:00Z', reused: false, checks: [
      { key: 'legacy_overconfidence', state: 'WARNING', count: 1, evidence: 'server text', action: 'server text' },
      { key: 'tenant_isolation', state: 'PASSED', count: 0, evidence: 'server text', action: null },
    ] });
    mount();
    fireEvent.click(await screen.findByTestId('dup-check'));
    expect(await screen.findByTestId('chk-legacy_overconfidence-state')).toHaveTextContent('Warning');
    expect(screen.getByTestId('chk-legacy_overconfidence')).toHaveTextContent(/old rule called these Strong/);
    expect(screen.getByTestId('chk-tenant_isolation-state')).toHaveTextContent('Passed');
  });
});
