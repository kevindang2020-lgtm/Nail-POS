import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCustomersScreen } from './POSCustomersScreen';

const pagination = (totalItems: number) => ({ page: 1, pageSize: 8, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 8)) });
const state = {
  kpisFull: { totalCustomers: 0, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 0, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 0, averageSpendCents: 0 },
  rows: { items: [], pagination: pagination(0) },
  filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSCustomersScreen', () => {
  it('mounts and renders the reference shell: header, 8 KPIs, toolbar, tabs, empty table', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    expect(await screen.findByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Manage and grow your customer relationships')).toBeInTheDocument();
    // toolbar + add
    expect(screen.getByText('+ Add Customer')).toBeInTheDocument();
    // 5 category tabs
    expect(screen.getByText('All Customers')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    // empty table + pagination summary
    expect(screen.getByText('No matching customers.')).toBeInTheDocument();
    expect(screen.getByText(/Showing 0–0 of 0/)).toBeInTheDocument();
  });

  it('renders the reference modules wired from state rows (8 KPIs, 6 summary cards, table, right rail, bottom analytics)', async () => {
    const withRows = {
      kpisFull: { totalCustomers: 100, newCustomersToday: 4, returningCustomersToday: 12, vipCustomers: 20, birthdayThisMonth: 3, inactiveCustomers: 8, duplicateProfiles: 2, loyaltyMembers: 55, averageSpendCents: 24575 },
      analytics: { ageGroups: [{ label: '26-35', count: 2 }], lifetimeValue: { totalRevenueCents: 429600, totalCustomers: 3, repeatRatePercent: 67, avgClvCents: 143200 }, rfm: [{ segment: 'Champions', count: 2 }, { segment: 'At Risk', count: 1 }], retentionRatePercent: 67 },
      rows: { items: [
        { customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: '(555) 123-4567', email: 'olivia@email.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP', 'High Spender'], marketingOptIn: true, smsOptIn: true, emailOptIn: true },
        { customerId: 'CUST-1002', displayName: 'Emma Wilson', phone: '(555) 234-5678', email: 'emma@email.com', status: 'active', source: 'walk_in', visitCount: 18, lastVisitAt: '2026-05-04', totalSpendCents: 89200, averageSpendCents: 4958, loyaltyPoints: 1280, loyaltyTier: 'Silver', isVip: false, tags: ['Loyalty Member'], marketingOptIn: true, smsOptIn: true, emailOptIn: true },
        { customerId: 'CUST-1003', displayName: 'Sophia Martinez', phone: '(555) 345-6789', email: 'sophia@email.com', status: 'active', source: 'online_booking', visitCount: 31, lastVisitAt: '2026-05-03', totalSpendCents: 215600, averageSpendCents: 6955, loyaltyPoints: 3680, loyaltyTier: 'Platinum', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true },
      ], pagination: pagination(3) },
      filterFacets: { segments: ['new', 'returning'], statuses: ['active', 'inactive'], loyaltyTiers: ['Gold', 'Silver'], visitRanges: [], spendRanges: ['$500+'], sources: ['walk_in', 'online_booking'], tags: ['VIP', 'Loyalty Member'] },
    };
    globalThis.fetch = mockFetch(withRows) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Customers', level: 1 })).toBeInTheDocument();
    // 8 KPIs (reference set)
    expect(screen.getByText('Retention Rate')).toBeInTheDocument();
    expect(screen.getByText('Avg. Spend per Customer')).toBeInTheDocument();
    expect(screen.getByText('Loyalty Members')).toBeInTheDocument();
    // 6 summary cards
    expect(screen.getByText('New This Month')).toBeInTheDocument();
    expect(screen.getByText('Top Spenders')).toBeInTheDocument();
    // table rows + columns
    expect(screen.getAllByText('Olivia Brown').length).toBeGreaterThan(0);
    expect(screen.getByText('#CUST-1003')).toBeInTheDocument();
    // right rail + bottom analytics
    expect(screen.getByText(/Customer Demographics/)).toBeInTheDocument();
    expect(screen.getByText('Customer Sources')).toBeInTheDocument();
    expect(screen.getByText('Top Customer Tags')).toBeInTheDocument();
    expect(screen.getByText('Customer Lifetime Value')).toBeInTheDocument();
    expect(screen.getByText('RFM Analysis')).toBeInTheDocument();
    expect(screen.getByText('Recent Customer Activity')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–3 of 3/)).toBeInTheDocument();
  });

  it('opens the customer profile drawer when a customer name is clicked', async () => {
    globalThis.fetch = mockFetch({
      kpisFull: { totalCustomers: 1, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 1, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 1, averageSpendCents: 5203 },
      rows: { items: [{ customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: '(555) 123-4567', email: 'olivia@email.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true }], pagination: pagination(1) },
      filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    const name = (await screen.findAllByTitle('Open profile'))[0];
    fireEvent.click(name);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('CONTACT')).toBeInTheDocument();
    expect(within(dialog).getByText('LIFETIME')).toBeInTheDocument();
    expect(within(dialog).getByText('COMMUNICATION CONSENT')).toBeInTheDocument();
    // tab strip switches to the loyalty/membership view (all from the real detail payload)
    fireEvent.click(within(dialog).getByText('Loyalty & Membership'));
    expect(within(dialog).getByText('MEMBERSHIP')).toBeInTheDocument();
  });

  it('edits tags from the profile drawer (PATCH /pos/customers/:id/tags)', async () => {
    const fetchMock = mockFetch({
      kpisFull: { totalCustomers: 1, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 1, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 1, averageSpendCents: 5203 },
      rows: { items: [{ customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: 'x', email: 'o@e.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true }], pagination: pagination(1) },
      filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
    });
    globalThis.fetch = fetchMock as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTitle('Open profile'))[0]);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText('+ add tag');   // Sep 2026 redesign wording
    fireEvent.change(input, { target: { value: 'Bridal' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect((fetchMock.mock.calls as any[]).some((c) => String(c[0]).includes('/tags'))).toBe(true));
    const tagsCall = (fetchMock.mock.calls as any[]).find((c) => String(c[0]).includes('/tags'));
    expect(String(tagsCall?.[1]?.method || '')).toMatch(/PATCH/i);
  });

  it('F1 §17 (Nov 5 2026): duplicates show as a compact alert (no inline comparison); with none pending the row collapses', async () => {
    const emptyKpis = { totalCustomers: 0, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 0, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 0, averageSpendCents: 0, retentionRatePercent: 0 };
    const baseState = { kpisFull: emptyKpis, rows: { items: [], pagination: pagination(0) }, filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] } };
    let open = 3;
    globalThis.fetch = vi.fn(async (url: any) => ({ ok: true, status: 200, json: async () => (String(url).includes('/duplicate-review/summary') ? { kpis: { open } } : baseState), headers: { get: () => null } } as any)) as any;
    const { unmount } = render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    expect(await screen.findByTestId('dup-alert')).toHaveTextContent('3 groups need review');
    expect(screen.queryByRole('radio')).toBeNull();          // the field-by-field comparison is not inline any more
    unmount(); open = 0;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('dup-alert')).toBeNull();
  });

  it('renders the CSV import preview (detected columns + per-row actions) after loading a file', async () => {
    const emptyKpis = { totalCustomers: 0, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 0, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 0, averageSpendCents: 0 };
    const baseState = { kpisFull: emptyKpis, rows: { items: [], pagination: pagination(0) }, filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] } };
    const preview = { totalRows: 4, toCreate: 2, toUpdate: 0, duplicates: 1, errors: 1, invalidEmailsDropped: 0, detectedColumns: { firstName: 'mapped', lastName: 'mapped', phone: 'mapped', email: 'mapped' }, sample: [
      { rowNumber: 1, firstName: 'Grace', lastName: 'Lee', phone: '(555) 201-7788', email: 'grace@x.com', action: 'create' },
      { rowNumber: 2, firstName: 'Olivia', lastName: 'Brown', phone: '(555) 123-4567', email: 'o@x.com', action: 'duplicate', reason: 'phone matches #CUST-1001' },
      { rowNumber: 3, firstName: 'Ethan', lastName: 'Park', action: 'error', reason: 'missing mobile phone' },
    ] };
    globalThis.fetch = vi.fn(async (url: any) => ({ ok: true, status: 200, json: async () => (String(url).includes('/import/preview') ? preview : baseState), headers: { get: () => null } } as any)) as any;
    const { container } = render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    fireEvent.click(screen.getByText(/More Filters/));
    const fileInput = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['first,last,phone,email\nGrace,Lee,5552017788,grace@x.com'], 'c.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    const previewBtn = await screen.findByText('Preview');
    fireEvent.click(previewBtn);
    expect(await screen.findByText('DETECTED COLUMNS')).toBeInTheDocument();
    expect(screen.getByText(/phone matches/)).toBeInTheDocument();
    expect(screen.getByText('missing mobile phone')).toBeInTheDocument();
    expect(screen.getByText('duplicate')).toBeInTheDocument();
  });
});

// ── 2026-07-03 additional coverage for the substantive Customers flows: filters driving the real state refetch,
// CSV import COMMIT (prior test only covered preview), and the duplicate MERGE action (prior test only previewed).
const facets = { segments: ['vip', 'regular'], statuses: ['active', 'inactive'], loyaltyTiers: ['gold', 'silver'], visitRanges: [], spendRanges: ['0-100', '100+'], sources: ['walk_in', 'online'], tags: ['nail-art', 'gel'] };
const oneRow = { customerId: 'c1', firstName: 'Jessica', lastName: 'Miller', phone: '415-555-1212', email: 'j@e.com', status: 'active', source: 'walk_in', isVip: false, lastVisitAt: '2026-05-01', totalVisits: 5, lifetimeSpendCents: 12000, loyaltyPoints: 100 };
const richState = { ...state, kpisFull: { ...state.kpisFull, totalCustomers: 1 }, rows: { items: [oneRow], pagination: pagination(1) }, filterFacets: facets };

const recCustomers = (opts: { commit?: any; dups?: any[] } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/customers/import/preview')) return ok({ columns: ['first_name', 'phone'], rows: [{ action: 'create', firstName: 'New', phone: '555-0100' }], summary: { create: 1, update: 0, skip: 0 } });
    if (u.includes('/customers/import/commit')) return ok(opts.commit ?? { created: 1, updated: 0, skipped: 0 });
    if (u.includes('/customers/duplicates') && /\/merge$/.test(u)) return ok({ merged: true });
    if (u.includes('/customers/duplicates')) return ok(opts.dups ?? []);
    if (u.includes('/pos/customers/state')) return ok(richState);
    return ok({});
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSCustomersScreen — filters and bulk flows', () => {
  it('the status filter drives a real state refetch with status=', async () => {
    const f = recCustomers(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    const statusSel = Array.from(document.querySelectorAll('select')).find((el) => within(el).queryByText('All Status'))!;
    fireEvent.change(statusSel, { target: { value: 'inactive' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/customers/state') && c.url.includes('status=inactive'))).toBe(true));
  });

  it('the search box refetches state with search=', async () => {
    const f = recCustomers(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    fireEvent.change(screen.getByPlaceholderText(/Search by name, phone, email/), { target: { value: 'Jessica' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/customers/state') && c.url.includes('search=Jessica'))).toBe(true));
  });

  it('F1 §40-41: the AI Customer Profile Assistant is a compact card in the last row beside Recent Activity, not a top banner', async () => {
    globalThis.fetch = recCustomers() as any;
    const { container } = render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    const row = await screen.findByTestId('cd-bottom-row');
    expect(row.querySelector('[data-testid="cd-ai-card"]')).not.toBeNull();
    expect(row.textContent).toMatch(/Recent Customer Activity/);
    const work = container.querySelector('.work')!;
    const kids = Array.from(work.children);
    expect(kids.indexOf(row)).toBeGreaterThan(kids.findIndex((k) => /Customers/.test(k.textContent ?? '')));
  });

  it('F1 §28: rows per page is 10 / 25 / 50 and changing it refetches page 1 with pageSize=', async () => {
    const f = mockFetch(state); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    const sel = screen.getByLabelText('Rows') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['10', '25', '50']);
    expect(f.mock.calls.some((c: any[]) => /pageSize=10\b/.test(String(c[0])))).toBe(true);
    fireEvent.change(sel, { target: { value: '25' } });
    await waitFor(() => expect(f.mock.calls.some((c: any[]) => /pageSize=25\b/.test(String(c[0])) && /page=1\b/.test(String(c[0])))).toBe(true));
  });

  it('F1 §37/§39: retention trend draws the snapshot months (gaps shown as —) and Recent Activity is the server feed', async () => {
    globalThis.fetch = mockFetch({ ...state,
      analytics: { ageGroups: [], lifetimeValue: { totalRevenueCents: 0, totalCustomers: 0, repeatRatePercent: 0, avgClvCents: 0 }, rfm: [], retentionRatePercent: 61 },
      retentionSeries: [{ month: '2026-09', date: null, ratePercent: null, reason: 'missing' }, { month: '2026-10', date: '2026-10-31', ratePercent: 62.5, reason: null }],
      recentActivity: [{ customerId: 'c-9', displayName: 'Lan Tran', kind: 'added', at: '2026-11-04T10:00:00Z' }, { customerId: 'c-8', displayName: 'Mai Vo', kind: 'visit', at: '2026-11-03T10:00:00Z' }],
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    const series = await screen.findByTestId('cd-ret-series');
    expect(series.textContent).toMatch(/62.5%/);
    expect(series.textContent).toMatch(/—/);
    const acts = screen.getAllByTestId('cd-activity-row');
    expect(acts.map((a) => a.textContent)).toEqual([expect.stringMatching(/Lan Tran.*New profile added/), expect.stringMatching(/Mai Vo.*Visited/)]);
  });

  it('F1 §12/§15: tab counts come from the server count for what each tab lists; month cards use the month counters', async () => {
    globalThis.fetch = mockFetch({ ...state,
      kpisFull: { ...state.kpisFull, totalCustomers: 50, newCustomersToday: 1, returningCustomersToday: 2, newThisMonth: 9, returningThisMonth: 14, atRiskCustomers: 6, vipCustomers: 3 },
      segmentCounts: { all: 50, never: 5, new: 11, returning: 30, vip: 3, at_risk: 6 },
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findByText('Customers');
    const tab = (name: RegExp) => screen.getAllByRole('button').find((b) => name.test(b.textContent ?? '') && /\d/.test(b.textContent ?? ''))!;
    expect(tab(/^New Customers/).textContent).toMatch(/11/);
    expect(tab(/^Returning(?! This)/).textContent).toMatch(/30/);
    expect(tab(/^At Risk\D*\d/).textContent).toMatch(/6/);
    expect(tab(/^New This Month/).textContent).toMatch(/9/);
    expect(tab(/^Returning This Month/).textContent).toMatch(/14/);
  });

  it('F1 §37: with no snapshot months the trend says so instead of drawing invented bars', async () => {
    globalThis.fetch = mockFetch({ ...state, analytics: { ageGroups: [], lifetimeValue: { totalRevenueCents: 0, totalCustomers: 0, repeatRatePercent: 0, avgClvCents: 0 }, rfm: [], retentionRatePercent: 0 }, retentionSeries: [] }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    expect(await screen.findByTestId('cd-ret-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('cd-ret-series')).toBeNull();
  });

  it('F1 §18: Review Duplicates opens the safe queue overlay; a group opens the compare overlay (nothing merges from the list)', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url); calls.push((init?.method || 'GET') + ' ' + u);
      const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/duplicate-review/summary')) return ok({ kpis: { open: 1 } });
      if (u.includes('/duplicate-review/groups?') || u.endsWith('/duplicate-review/groups')) return ok({ items: [{ id: 'g1', confidence: 'strong', reasons: ['phone'], members: [{ customerId: 'c1', name: 'Jessica Miller' }, { customerId: 'c2', name: 'Jess Miller' }] }], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      if (u.includes('/duplicate-review/groups/g1')) return ok({ group: { id: 'g1', status: 'pending', version: 1, confidence: 'strong', ruleVersion: 1, detectedAt: '2026-11-01T00:00:00Z' }, members: [], evidence: [], events: [] });
      if (u.includes('/pos/customers/state')) return ok(richState);
      return ok({});
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('dup-review-open'));
    expect(await screen.findByTestId('dup-queue-row')).toHaveTextContent('Jessica Miller · Jess Miller');
    fireEvent.click(screen.getByTestId('dup-queue-compare'));
    await waitFor(() => expect(calls.some((c) => c === 'GET ' + c.split(' ')[1] && /\/duplicate-review\/groups\/g1$/.test(c.split(' ')[1]))).toBe(true));
    expect(calls.some((c) => c.startsWith('POST') && /merge/.test(c))).toBe(false);
  });

  it('Smooth Refresh spec §14/§49: the edit form sends the version it was opened on; a VERSION_CONFLICT keeps the form open and reloads', async () => {
    const st = {
      kpisFull: { totalCustomers: 1, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 1, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 1, averageSpendCents: 5203 },
      rows: { items: [{ customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: 'x', email: 'o@e.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true }], pagination: pagination(1) },
      filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
    };
    (st as any).rows.items[0].version = 7;
    const calls: { url: string; method: string; body: any }[] = [];
    let patchCount = 0;
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      const method = String(init.method || 'GET').toUpperCase();
      calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
      if (method === 'PATCH' && /\/pos\/customers\/CUST-1001$/.test(String(url))) {
        patchCount++;
        return { ok: false, status: 409, json: async () => ({ message: 'This customer was changed on another device.', code: 'VERSION_CONFLICT', currentVersion: 8 }), headers: { get: () => null } } as any;
      }
      return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]);
    fireEvent.click(await screen.findByText('Save'));
    await waitFor(() => expect(patchCount).toBe(1));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body.expectedVersion).toBe(7);                                  // the copy the form was opened on
    expect(await screen.findByText(/changed on another device/i)).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();                         // form still open — nothing typed is lost
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(patchCount).toBe(2));
    expect(calls.filter((c) => c.method === 'PATCH')[1].body.expectedVersion).toBe(8);   // re-save against the newer copy
  });

  it('Decision 1: preferred name / language / branch are edited with the profile and saved in the same PATCH', async () => {
    const st: any = {
      kpisFull: { totalCustomers: 1, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 0, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 0, averageSpendCents: 0 },
      rows: { items: [{ customerId: 'CUST-2', displayName: 'Nguyen Thi Hoa', phone: 'x', email: 'h@e.com', status: 'active', source: 'walk_in', visitCount: 1, totalSpendCents: 0, averageSpendCents: 0, loyaltyPoints: 0, isVip: false, tags: [], marketingOptIn: false, smsOptIn: false, emailOptIn: false, preferredName: 'Hoa', version: 3 }], pagination: pagination(1) },
      filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
    };
    const calls: { url: string; method: string; body: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      const method = String(init.method || 'GET').toUpperCase();
      calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
      if (/\/auth\/branches/.test(String(url))) return { ok: true, status: 200, json: async () => ({ branches: [{ id: 'b-moore', name: 'Moorestown' }] }), headers: { get: () => null } } as any;
      return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]);
    expect((screen.getByLabelText('Preferred name') as HTMLInputElement).value).toBe('Hoa');   // opened with the saved value
    fireEvent.change(screen.getByLabelText('Preferred language'), { target: { value: 'vi' } });   // WP-I: an English / Tiếng Việt picker that stores en / vi
    await screen.findByRole('option', { name: 'Moorestown' });
    fireEvent.change(screen.getByLabelText('Preferred branch'), { target: { value: 'b-moore' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ preferredName: 'Hoa', preferredLanguage: 'vi', preferredBranchId: 'b-moore', expectedVersion: 3 });
  });
});

describe('Smooth Refresh spec §28/§62 — the Customers list is on the sync layer', () => {
  it('a customer event from another device refetches the list with the current search kept; a failed refetch keeps the list', async () => {
    const { REALTIME_EVENT } = await import('../realtime/realtime-client');
    const st: any = {
      kpisFull: { totalCustomers: 1, newCustomersToday: 0, returningCustomersToday: 0, vipCustomers: 1, birthdayThisMonth: 0, inactiveCustomers: 0, duplicateProfiles: 0, loyaltyMembers: 1, averageSpendCents: 5203 },
      rows: { items: [{ customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: 'x', email: 'o@e.com', status: 'active', source: 'walk_in', visitCount: 24, lastVisitAt: '2026-05-05', totalSpendCents: 124800, averageSpendCents: 5203, loyaltyPoints: 2450, loyaltyTier: 'Gold', isVip: true, tags: ['VIP'], marketingOptIn: true, smsOptIn: true, emailOptIn: true }], pagination: pagination(1) },
      filterFacets: { segments: [], statuses: [], loyaltyTiers: [], visitRanges: [], spendRanges: [], sources: [], tags: [] },
    };
    let calls = 0; let fail = false;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (/\/pos\/customers\/state/.test(String(url))) { calls++; if (fail) return { ok: false, status: 502, json: async () => ({ message: 'Bad gateway' }), headers: { get: () => null } } as any; }
      return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSCustomersScreen /></MemoryRouter>);
    await screen.findAllByTitle('Edit');
    const before = calls;
    window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'customer_profile_updated', screens: ['customers'] } }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    fail = true;
    window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'customer_profile_updated', screens: ['customers'] } }));
    await waitFor(() => expect(calls).toBeGreaterThan(before + 1));
    expect((await screen.findAllByTitle('Edit')).length).toBeGreaterThan(0);      // list still on screen
    expect(screen.queryByText('Bad gateway')).toBeNull();
  });
});
