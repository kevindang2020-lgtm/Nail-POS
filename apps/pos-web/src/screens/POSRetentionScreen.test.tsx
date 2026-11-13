// POSRetentionScreen — Customer Retention Complete Build Guide (Oct 30 2026): the eight KPIs (the five original + Never
// Visited / Recovered / Campaign Recoveries), the segment tabs, the win-back list with Segment + Smart Priority + "why",
// Never Visited rows are never selectable for a win-back text, "select all eligible" sends the filters (not ids) to the
// server, the period / basis reach the API, the Recovery dialog states its definitions, and Settings saves with a version.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { summary: vi.fn(), customers: vi.fn(), customer: vi.fn(), recovery: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), exportCsv: vi.fn(),
  readiness: vi.fn(), preview: vi.fn(), confirm: vi.fn(), campaigns: vi.fn(), campaign: vi.fn(),
  snapshotDay: vi.fn(), snapshotMembers: vi.fn(), snapshotCompare: vi.fn(), snapshotRuns: vi.fn(), backfill: vi.fn(), smsPricing: vi.fn(), setSmsPricing: vi.fn(), winbackPicked: vi.fn() } }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { categories: () => Promise.resolve([{ id: 'cat1', name: 'Gel' }]) } }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { list: () => Promise.resolve({ items: [{ id: 't1', fullName: 'Tam N' }] }) } }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posRetentionApi', () => ({ posRetentionApi: api }));
const { notesApi } = vi.hoisted(() => ({ notesApi: { getNotes: vi.fn(), setNotes: vi.fn() } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: notesApi }));
const { mtApi } = vi.hoisted(() => ({ mtApi: { list: vi.fn(async () => ({ items: [{ id: 't1', name: 'We miss you', category: 'customer_follow_up' }, { id: 't2', name: 'Receipt', category: 'receipt' }] })), detail: vi.fn(async () => ({ template: { body: 'Hi {first_name}! {salon_name} misses you.' } })) } }));
vi.mock('../api/posMessageTemplatesApi', () => ({ posMessageTemplatesApi: mtApi }));
import { POSRetentionScreen } from './POSRetentionScreen';

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-31', today: '2026-10-30', timeZone: 'America/New_York', riskDays: 60, approachingDays: 45, observationWindowDays: 30, settingsVersion: 0, segmentationVersion: 'retention-v2', priorityFormulaVersion: 'winback-v1' };
const SUM = { period, kpis: { returningRatePercent: 62, returningCustomers: 124, visitedInPeriod: 200, newThisMonth: 18, newRegisteredThisMonth: 25, atRisk: 2, lapsedValueCents: 57000, neverVisited: 13, recovered: 4, campaignRecoveries: 1 },
  segments: { all: 240, returning: 124, approaching: 9, at_risk: 2, never: 13, recovered: 4, active: 100, at_risk_90: 1, at_risk_180: 1, returned: 4, contactable: 1, new_visitors: 18 }, priorityBands: { high: 1, medium: 0, low: 1 } };
const prio = (score: number, band: string) => ({ score, band, formulaVersion: 'winback-v1', components: { inactivity: 40, frequency: 30, spend: 22 }, topDriver: 'inactivity', explanation: 'x' });
const row = (id: string, name: string, o: Record<string, unknown>) => ({ customerId: id, customerName: name, avatarUrl: null, maskedPhone: '(•••) •••-0101', phoneStatus: 'ok', smsStatus: 'eligible', segment: 'at_risk', returningInPeriod: false, recoveredInPeriod: false,
  lastVisitAt: '2026-01-01T15:00:00Z', firstVisitAt: '2025-01-01T15:00:00Z', daysAway: 302, visits: 12, lifetimeSpendCents: 42000, createdAt: '2025-01-01T00:00:00Z', lastOutreachAt: null, lastOutreachStatus: null, nextAppointmentDate: null, priority: prio(92, 'high'), ...o });
const AT_RISK = [row('c1', 'Ana Rivera', {}), row('c2', 'Bo Chen', { smsStatus: 'no_consent', daysAway: 70, visits: 1, lifetimeSpendCents: 15000, priority: prio(15, 'low') })];
const NEVER = [row('n1', 'Nora Never', { segment: 'never_visited', lastVisitAt: null, firstVisitAt: null, daysAway: null, visits: 0, lifetimeSpendCents: 0, priority: null })];
const list = (items: unknown[], o: Record<string, unknown> = {}) => ({ period, segment: 'at_risk', sort: 'priority', items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, eligibleOnPage: 1, eligibleMatching: 1, filters: {}, ...o });
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.summary.mockResolvedValue(SUM);
  api.smsPricing.mockResolvedValue({ current: null, history: [] });   // the SMS pricing card loads on its own
  api.customers.mockImplementation(async (q: any) => (q.segment === 'never' ? list(NEVER, { segment: 'never', sort: 'created_desc', eligibleOnPage: 0, eligibleMatching: 0 }) : list(AT_RISK)));
  api.readiness.mockResolvedValue({ sender: { route: 'simulated', from: null, a2pStatus: null }, quietHours: { start: null, end: null, until: null }, canSend: true });
  api.preview.mockResolvedValue({ previewId: 'p1', finalBody: 'Lotus: Hi Reply STOP to opt out.', segments: { segments: 1, encoding: 'GSM-7', characters: 30 }, selected: 1, eligible: 1, excluded: 0, excludedReasons: {},
    sender: { route: 'simulated', from: null, a2pStatus: null }, canSend: true, blockedReason: null, quietHours: null, estimatedSegments: 1, costEstimateCents: null, roster: [], expiresInMinutes: 20 });
  api.recovery.mockResolvedValue({ period, definitions: {}, totals: { recoveredCustomers: 4, returnVisits: 5, observedReturnRevenueCents: 30000, campaignObserved: { customers: 1, visits: 1, revenueCents: 6000, avgDaysToReturn: 3 }, unmessagedRecovered: 3 },
    campaigns: [{ campaignId: 'cmp-1', label: 'Fall', confirmedAt: '2026-10-20T15:00:00Z', eligible: 10, sent: 10, delivered: 8, failed: 0, bookedAfterContact: 2, returnedCustomers: 1, returnRevenueCents: 6000 }],
    returns: { items: [{ ticketId: 't1', ticketNumber: '1001', customerId: 'c9', customerName: 'Cleo', returnedAt: '2026-10-29T15:00:00Z', previousVisitAt: '2026-06-01T15:00:00Z', daysAwayBefore: 150, netCents: 6000, campaignId: 'cmp-1', messageSentAt: '2026-10-25T15:00:00Z' }], page: 1, pageSize: 6, totalItems: 1, totalPages: 1 },
    trend: [{ month: '2026-10', visited: 200, returning: 124, newVisitors: 18, recovered: 4, returningRatePercent: 62 }] });
  api.settings.mockResolvedValue({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, version: 0, isDefault: true, updatedAt: null, updatedByUserId: null, canEdit: true });
  api.saveSettings.mockResolvedValue({ riskDays: 90, approachingDays: 60, observationWindowDays: 30, version: 1 });
});

describe('POSRetentionScreen', () => {
  it('renders the eight KPIs and the win-back list with Segment and Smart Priority', async () => {
    render(<POSRetentionScreen />);
    expect(await screen.findByRole('heading', { name: 'Customer Retention' })).toBeInTheDocument();
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-never')).toHaveTextContent('13');
    expect(screen.getByTestId('kpi-recovered')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-campaign-recoveries')).toHaveTextContent('1');
    expect(await screen.findByText('Ana Rivera')).toBeInTheDocument();
    const prios = screen.getAllByTestId('rt-prio'); expect(prios[0]).toHaveTextContent('92');
    expect(prios[0]!.getAttribute('title')).toMatch(/Why this priority\?/);
    expect(api.customers).toHaveBeenCalledWith(expect.objectContaining({ segment: 'at_risk', preset: 'month' }));
  });

  it('Never Visited rows are on their own tab, never in a win-back text — C5 gap: they can get a First Visit Invitation instead', async () => {
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('seg-never'));
    expect(await screen.findByText('Nora Never')).toBeInTheDocument();
    const cb = screen.getByRole('checkbox', { name: /Nora Never/ }); expect(cb).not.toBeDisabled();
    expect(screen.queryAllByTestId('rt-prio')).toHaveLength(0);
    fireEvent.click(cb);
    fireEvent.click(screen.getByTestId('send-sms'));
    expect(await screen.findByTestId('fv-note')).toBeInTheDocument();
    fireEvent.change(await screen.findByRole('textbox', { name: /message/i }), { target: { value: 'Welcome! Your first visit is 20% off.' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ audience: 'first_visit' })));
  });

  it('"Select all eligible" sends the filters, not a page of ids, to the preview', async () => {
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getByTestId('select-all-matching'));
    fireEvent.click(await screen.findByTestId('select-all-confirm'));
    fireEvent.click(screen.getByTestId('send-sms'));
    fireEvent.change(await screen.findByRole('textbox', { name: /message/i }), { target: { value: 'We miss you, come back soon!' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    const b = api.preview.mock.calls[0]![0];
    expect(b.customerIds).toBeUndefined();
    expect(b.selection).toMatchObject({ segment: 'at_risk', sms: 'eligible', preset: 'month', excludeIds: [] });
  });

  it('the Recovery dialog shows observed returns with their definitions', async () => {
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('open-recovery'));
    const d = await screen.findByTestId('dlg-recovery');
    expect(await screen.findByTestId('rt-recovery-totals')).toHaveTextContent('4');
    expect(d).toHaveTextContent(/not proven cause/);
    expect(screen.getByTestId('rt-returns')).toHaveTextContent('Cleo');
  });

  it('Settings save with the version they were read at', async () => {
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('open-settings'));
    fireEvent.change(await screen.findByTestId('set-risk'), { target: { value: '90' } });
    fireEvent.change(screen.getByTestId('set-approaching'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ riskDays: 90, approachingDays: 60, observationWindowDays: 30, expectedVersion: 0 }));
  });

  // ── Four-Module Completion Guide (Oct 30 2026) ─────────────────────────────────────────────────────────────────────
  it('CR-02: the branch selector lists the authorized branches, labels the scope and sends ?branch= to the server', async () => {
    api.summary.mockResolvedValue({ ...SUM, scope: { mode: 'tenant', label: 'tenant_wide', selectedBranchId: null, confined: false, unknownBranchVisits: 3,
      branches: [{ branchId: 'b-a', name: 'Alpha' }, { branchId: 'b-b', name: 'Beta' }] } });
    render(<POSRetentionScreen />);
    expect(await screen.findByTestId('rt-scope')).toHaveTextContent('Tenant-wide customer retention');
    expect(screen.getByTestId('rt-unknown-branch')).toHaveTextContent('Unknown branch: 3');
    fireEvent.change(screen.getByTestId('flt-branch'), { target: { value: 'b-b' } });
    await waitFor(() => expect(api.customers).toHaveBeenCalledWith(expect.objectContaining({ branch: 'b-b' })));
    await waitFor(() => expect(api.summary).toHaveBeenCalledWith(expect.objectContaining({ branch: 'b-b' })));
  });

  it('CR-01: As of Date reads the STORED snapshot; a day without one is "Incomplete / unverifiable"', async () => {
    api.snapshotRuns.mockResolvedValue({ from: '2026-09-30', to: '2026-10-30', items: [], page: 1, pageSize: 5, totalItems: 0, totalPages: 1 });
    api.snapshotDay.mockResolvedValue({ date: '2026-10-29', today: '2026-10-30', state: 'missing', unverifiable: true, run: null, counts: null });
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('open-history'));
    const st = await screen.findByTestId('hist-state');
    expect(st).toHaveTextContent(/Incomplete \/ unverifiable/); expect(st.getAttribute('data-state')).toBe('missing');
    expect(api.snapshotDay).toHaveBeenCalledWith('2026-10-29', undefined);   // no location chosen = every location
    expect(api.snapshotMembers).not.toHaveBeenCalled();   // no stored day → nothing listed, nothing invented
  });

  it('CR-03: the preview shows "Price unknown — cannot estimate" when no SMS price is configured (never $0)', async () => {
    api.preview.mockResolvedValueOnce({ previewId: 'p1', finalBody: 'Lotus: Hi Reply STOP to opt out.', segments: { segments: 1, encoding: 'GSM-7', characters: 30 }, selected: 1, eligible: 1, excluded: 0, excludedReasons: {},
      sender: { route: 'simulated', from: null, a2pStatus: null }, canSend: true, blockedReason: null, quietHours: null, estimatedSegments: 1, costEstimateCents: null, roster: [], expiresInMinutes: 20,
      estimate: { status: 'price_unknown', recipients: 1, segmentsPerMessage: 1, encoding: 'GSM-7', totalSegments: 1, currency: null, unitPrice: null, pricingEffectiveFrom: null, subtotalCents: null, carrierFeesCents: null,
        carrierFeesKnown: false, taxCents: null, taxKnown: false, totalCents: null, totalIsLowerBound: false } });
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ana Rivera/ }));
    fireEvent.click(screen.getByTestId('send-sms'));
    fireEvent.change(await screen.findByRole('textbox', { name: /Message/ }), { target: { value: 'We miss you! Come back.' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    const est = await screen.findByTestId('sms-estimate');
    expect(est).toHaveTextContent('Price unknown — cannot estimate'); expect(est).not.toHaveTextContent('$0.00');
  });

  it('CR-04: Book appointment opens the existing New Appointment flow with ?customerId= only (no name / phone in the URL)', async () => {
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getAllByTestId('rt-row-book')[0]!);
    expect(navigate).toHaveBeenCalledWith('/booking/new?customerId=c1&from=retention');
    expect(String(navigate.mock.calls.slice(-1)[0]?.[0])).not.toMatch(/Ana|0101|customerName|customerPhone/);
  });
  it('C5 §14 Add Note: a dated line is appended to the salon notes, keeping the other note fields', async () => {
    api.customer.mockResolvedValue({ ...AT_RISK[0], asOf: '2026-10-30', thresholds: { riskDays: 60, approachingDays: 45 }, segmentReason: { code: 'inactive', days: 302 }, visits: 12, outreach: [], upcomingBookings: [], visitEvidence: [], communications: [], refunds: { count: 0, cents: 0 }, lastBooking: null, marketingSmsConsent: true, marketingEmailConsent: false, maskedEmail: null, consentUpdatedAt: null });
    notesApi.getNotes.mockResolvedValue({ salonNotes: 'Likes almond shape', allergyNotes: 'latex' });
    notesApi.setNotes.mockResolvedValue({});
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ana Rivera' })[0]!);
    fireEvent.click(await screen.findByTestId('rt-add-note'));
    fireEvent.change(screen.getByTestId('rt-note-text'), { target: { value: 'Called — will book next week' } });
    fireEvent.click(screen.getByTestId('rt-note-save'));
    await waitFor(() => expect(notesApi.setNotes).toHaveBeenCalled());
    const [cid, body] = notesApi.setNotes.mock.calls[0]!;
    expect(cid).toBe('c1'); expect(body.allergyNotes).toBe('latex');
    expect(body.salonNotes).toMatch(/^Likes almond shape\n\d{4}-\d{2}-\d{2} · Retention: Called — will book next week$/);
  });
  it('C5 §12.2: start from an active follow-up template; a {placeholder} blocks the preview until replaced', async () => {
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ana Rivera/ }));
    fireEvent.click(screen.getByTestId('send-sms'));
    const pick = await screen.findByTestId('rt-template');
    expect(screen.queryByRole('option', { name: 'Receipt' })).toBeNull();   // only follow-up / promotions / general
    fireEvent.change(pick, { target: { value: 't1' } });
    const box = await screen.findByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('Hi {first_name}!  misses you.'));
    expect(screen.getByTestId('rt-placeholders')).toBeTruthy();
    expect(screen.getByTestId('sms-preview')).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Hi! We miss you.' } });
    expect(screen.queryByTestId('rt-placeholders')).toBeNull();
  });
  it('A19 Nov 6: search scope, category, technician and spend filters go to the server; picked customers become an unsent audience', async () => {
    api.winbackPicked.mockResolvedValue({ draftId: 'd1', status: 'draft', selected: 1, eligible: 1, excluded: 0, sends: 0, duplicate: false });
    render(<POSRetentionScreen />);
    fireEvent.change(await screen.findByTestId('flt-scope'), { target: { value: 'email' } });
    fireEvent.change(await screen.findByTestId('flt-category'), { target: { value: 'cat1' } });
    fireEvent.change(await screen.findByTestId('flt-technician'), { target: { value: 't1' } });
    fireEvent.change(screen.getByTestId('flt-spend'), { target: { value: 'high' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'email', category: 'cat1', technician: 't1', spend: 'high' })));
    const boxes = await screen.findAllByRole('checkbox');
    const row = boxes.find((b) => !(b as HTMLInputElement).disabled && b.getAttribute('aria-label') !== 'Select this page');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    fireEvent.click(await screen.findByTestId('add-picked'));
    await waitFor(() => expect(api.winbackPicked).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', customerIds: expect.any(Array) })));
    expect(await screen.findByText(/Saved as an unsent audience/)).toBeInTheDocument();
  });
});

describe('Customer Retention — useful empty state (extras #10)', () => {
  it('zero at-risk customers: explains why, offers the next views with live counts, and a tap switches the segment on the server', async () => {
    api.customers.mockImplementation(async (q: any) => list([], { segment: q.segment, eligibleOnPage: 0, eligibleMatching: 0 }));
    render(<POSRetentionScreen />);
    const box = await screen.findByTestId('rt-empty-actions');
    expect(box).toHaveTextContent('came back within 60 days');
    expect(screen.getByTestId('rt-empty-go-approaching')).toHaveTextContent('View Approaching Risk (9)');
    expect(screen.getByTestId('rt-empty-go-never')).toHaveTextContent('View Never Visited (13)');
    expect(screen.getByTestId('rt-empty-go-recovered')).toHaveTextContent('View Recovered (4)');
    fireEvent.click(screen.getByTestId('rt-empty-go-approaching'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ segment: 'approaching' })));
  });
});

describe('Customer Retention — status is text + shape, not colour alone (extras #12)', () => {
  it('each SMS outcome chip has a shape before its words (✓ can text, ✕ cannot), hidden from screen readers', async () => {
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    const icons = screen.getAllByTestId('rt-sms-icon');
    expect(icons.map((i) => i.textContent)).toEqual(['✓', '✕']);   // Ana: eligible · Bo: no consent
    expect(icons.every((i) => i.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(icons[1].parentElement!.textContent!.length).toBeGreaterThan(2);   // the words are still there
  });
  it('Extras CR-15: Audit trail opens the activity log filtered to retention — and to one campaign from its details', async () => {
    const cmp = { id: 'cmp-1111-2222', label: 'Fall', status: 'completed', confirmedAt: '2026-10-20T15:00:00Z', createdAt: '2026-10-20T15:00:00Z', queued: 0, selected: 2, body: 'Hi', counts: { sent: 2, delivered: 2 } };
    api.campaigns.mockResolvedValue({ items: [cmp], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
    api.campaign.mockResolvedValue({ campaign: cmp, recipients: { items: [], page: 1, pageSize: 8, totalItems: 0, totalPages: 1 } });
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('open-audit'));
    expect(navigate).toHaveBeenLastCalledWith('/tenant/account/activity-logs?module=retention');
    fireEvent.click(screen.getByTestId('open-campaigns'));
    fireEvent.click(await screen.findByText('Details'));
    fireEvent.click(await screen.findByTestId('campaign-audit'));
    expect(navigate).toHaveBeenLastCalledWith('/tenant/account/activity-logs?module=retention&search=cmp-1111-2222');
    expect(api.confirm).not.toHaveBeenCalled(); expect(api.saveSettings).not.toHaveBeenCalled();   // navigation only — nothing is sent or changed
  });
  it('Win-Back §01/§02/§07: Area Code searches at 3 digits, reaches the list query and the select-all filter; an empty code result says so honestly', async () => {
    api.customers.mockImplementation(async (q: any) => (q.areaCode === '609' ? list([], { totalItems: 0 }) : list(AT_RISK)));
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    const box = screen.getByTestId('flt-areacode');
    fireEvent.change(box, { target: { value: '8a5' } });            // non-digits dropped, incomplete → not sent, hint shown
    expect(box).toHaveValue('85'); expect(screen.getByTestId('flt-areacode-hint')).toHaveTextContent('Enter 3 digits');
    expect(api.customers).not.toHaveBeenCalledWith(expect.objectContaining({ areaCode: expect.anything() }));
    fireEvent.change(box, { target: { value: '856' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ areaCode: '856', page: 1 })));
    expect(await screen.findByTestId('rt-areacode-count')).toHaveTextContent('Area code 856: 2 matching');
    expect(screen.queryByTestId('flt-areacode-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('select-all-matching'));
    fireEvent.click(await screen.findByTestId('select-all-confirm'));
    fireEvent.click(screen.getByTestId('send-sms'));
    fireEvent.change(await screen.findByRole('textbox', { name: /message/i }), { target: { value: 'We miss you, come back soon!' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ areaCode: '856' }) })));
  });

  it('Win-Back §07: a code with no stored numbers shows the empty result with examples and a clear button', async () => {
    api.customers.mockImplementation(async (q: any) => (q.areaCode === '609' ? list([], { totalItems: 0 }) : list(AT_RISK)));
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.change(screen.getByTestId('flt-areacode'), { target: { value: '609' } });
    expect(await screen.findByText('No stored numbers with area code 609')).toBeInTheDocument();
    expect(screen.getByTestId('rt-areacode-empty')).toHaveTextContent('Only this salon');
    fireEvent.click(screen.getByRole('button', { name: 'Clear area code' }));
    expect(await screen.findByText('Ana Rivera')).toBeInTheDocument();
    expect(screen.getByTestId('flt-areacode')).toHaveValue('');
  });

  it('extras Win-Back 10: the phone check shows confirmed / not confirmed numbers, filters the list and the select-all selection; never says consent', async () => {
    const ROWS = [row('c1', 'Ana Rivera', { phoneVerification: 'verified' }), row('c2', 'Bo Chen', { smsStatus: 'no_consent', phoneVerification: 'verified' }), row('c3', 'Cy Old', { phoneVerification: 'unverified' }), row('c4', 'Di Nophone', { maskedPhone: null, phoneStatus: 'missing', smsStatus: 'no_phone', phoneVerification: 'no_number' })];
    api.customers.mockImplementation(async (q: any) => list(q.phoneCheck === 'verified' ? ROWS.slice(0, 2) : ROWS));
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    const badges = screen.getAllByTestId('rt-phone-verification');
    expect(badges.map((b) => b.textContent)).toEqual(['Number confirmed', 'Number confirmed', 'Number not confirmed']);   // no badge without a number
    expect(badges[0]!.getAttribute('title')).toMatch(/not permission to text/);
    fireEvent.change(screen.getByTestId('flt-phonecheck'), { target: { value: 'verified' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ phoneCheck: 'verified', page: 1 })));
    await waitFor(() => expect(screen.queryByText('Cy Old')).toBeNull());
    fireEvent.click(screen.getByTestId('select-all-matching'));
    fireEvent.click(await screen.findByTestId('select-all-confirm'));
    fireEvent.click(screen.getByTestId('send-sms'));
    fireEvent.change(await screen.findByRole('textbox', { name: /message/i }), { target: { value: 'We miss you, come back soon!' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ phoneCheck: 'verified', sms: 'eligible' }) })));
    fireEvent.click(screen.getByTestId('flt-clear'));
    await waitFor(() => expect(screen.getByTestId('flt-phonecheck')).toHaveValue(''));
  });

  // ── Retention Win-Back 15: bulk selection guardrails ──────────────────────────────────────────────────────────────
  it('Win-Back 15: a selection over the salon\'s warning size is flagged (select-all dialog + selection bar); Clear can be undone', async () => {
    api.settings.mockResolvedValue({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, bulkSelectionWarnAt: 200, bulkSelectionWarnAtIsDefault: true, version: 0, isDefault: true, canEdit: true });
    api.customers.mockImplementation(async () => list(AT_RISK, { eligibleMatching: 250 }));
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getByTestId('select-all-matching'));
    expect(await screen.findByTestId('select-all-large')).toHaveTextContent('This selects 250 customers — more than this salon\'s warning size of 200');
    fireEvent.click(screen.getByTestId('select-all-confirm'));
    expect(await screen.findByTestId('sel-large')).toHaveTextContent('Large selection: 250 customers (this salon warns above 200)');
    fireEvent.click(screen.getByTestId('sel-clear'));
    expect(screen.queryByTestId('sel-large')).toBeNull();
    fireEvent.click(screen.getByTestId('sel-undo'));
    expect(screen.getByTestId('sel-large')).toHaveTextContent('250');
    expect(api.preview).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
  });
  it('Win-Back 15: the preview names count + criteria; Confirm stays off until the exact count is typed, then sends it', async () => {
    api.customers.mockImplementation(async () => list(AT_RISK, { eligibleMatching: 250 }));
    api.preview.mockResolvedValue({ previewId: 'p9', finalBody: 'Lotus: Hi Reply STOP to opt out.', segments: { segments: 1, encoding: 'GSM-7', characters: 30 }, selected: 250, eligible: 240, excluded: 10, excludedReasons: { no_consent: 10 },
      sender: { route: 'simulated', from: null, a2pStatus: null }, canSend: true, blockedReason: null, quietHours: null, estimatedSegments: 240, costEstimateCents: null, roster: [], expiresInMinutes: 20,
      largeSelection: { warnAt: 200, over: true, selected: 250, criteria: { kind: 'win_back', mode: 'all_matching', segment: 'at_risk', q: null, excluded: 0, filters: { sms: 'eligible', preset: 'month' } } } });
    api.confirm.mockResolvedValue({ campaignId: 'cmp9', queued: 240, duplicate: false });
    api.campaign.mockResolvedValue({ campaign: { id: 'cmp9-0000-1111', label: null, status: 'completed', confirmedAt: '2026-10-20T15:00:00Z', createdAt: '2026-10-20T15:00:00Z', queued: 0, selected: 250, body: 'Hi', counts: { sent: 240 } }, recipients: { items: [], page: 1, pageSize: 8, totalItems: 0, totalPages: 1 } });
    render(<POSRetentionScreen />);
    await screen.findByText('Ana Rivera');
    fireEvent.click(screen.getByTestId('select-all-matching'));
    fireEvent.click(await screen.findByTestId('select-all-confirm'));
    fireEvent.click(screen.getByTestId('send-sms'));
    fireEvent.change(await screen.findByRole('textbox', { name: /message/i }), { target: { value: 'We miss you, come back soon!' } });
    fireEvent.click(screen.getByTestId('sms-preview'));
    const box = await screen.findByTestId('rt-large');
    expect(box).toHaveTextContent('Large selection: 250 customers (warning size 200)');
    expect(box).toHaveTextContent(/everyone matching .*2 filter\(s\).*0 taken out by hand/);
    expect(box).toHaveTextContent('Cancel or Edit message sends nothing');
    expect(screen.getByTestId('sms-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rt-large-count'), { target: { value: '25' } });
    expect(screen.getByTestId('sms-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rt-large-count'), { target: { value: '250' } });
    expect(screen.getByTestId('sms-confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('sms-confirm'));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(expect.objectContaining({ previewId: 'p9', confirmLargeSelection: 250 })));
  });
  it('Win-Back 15: Settings saves the large-selection warning (empty = default; out of range refused before saving)', async () => {
    api.settings.mockResolvedValue({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, bulkSelectionWarnAt: 200, bulkSelectionWarnAtIsDefault: true, version: 3, isDefault: false, canEdit: true });
    render(<POSRetentionScreen />);
    fireEvent.click(await screen.findByTestId('open-settings'));
    const f = await screen.findByTestId('set-bulk');
    fireEvent.change(f, { target: { value: '5' } });
    expect(screen.getByTestId('settings-save')).toBeDisabled();
    fireEvent.change(f, { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, bulkSelectionWarnAt: 150, expectedVersion: 3 }));
  });
});
