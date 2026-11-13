// POSCatalogScreens — the Oct 30 2026 rebuilds of Services & Products, Service Pricing, Service Categories and Add-Ons over
// `/pos/catalog/*`: the photo's numbers kept (6 services · $66.33 / $45 / $150 · Nails 4 · CD 4432 1 · CD 6805 1 · French tips
// on four services), honest "—" for figures the data cannot support, the review flags, the reason-required pricing editor,
// the shared-definition vs one-offering edit, and 403s.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { cat, svc, bundles, insights, alerts, invScreen } = vi.hoisted(() => ({
  cat: { dashboard: vi.fn(), charts: vi.fn(), services: vi.fn(), service: vi.fn(), updatePricing: vi.fn(), pricingImpact: vi.fn(), compensationPreview: vi.fn(), pricePreview: vi.fn(), revertPricing: vi.fn(), schedulePricing: vi.fn(), cancelScheduledPricing: vi.fn(), history: vi.fn(), customerHistory: vi.fn(), categorySummary: vi.fn(), categories: vi.fn(), category: vi.fn(), reassign: vi.fn(),
    addOnSummary: vi.fn(), reviewDecision: vi.fn(), addOns: vi.fn(), addOn: vi.fn(), addOnUsage: vi.fn(), addOnProfitability: vi.fn(), createAddOn: vi.fn(), updateAddOn: vi.fn(), archiveAddOn: vi.fn(), restoreAddOn: vi.fn() },
  svc: { exportCsv: vi.fn(), update: vi.fn(), create: vi.fn(), reactivate: vi.fn(), importPreview: vi.fn(), importCommit: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), archiveCategory: vi.fn() },
  bundles: { state: vi.fn(), create: vi.fn() }, insights: { get: vi.fn() }, alerts: { summary: vi.fn(), active: vi.fn() }, invScreen: { products: vi.fn(), product: vi.fn() },
}));
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: cat }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: svc }));
vi.mock('../api/posBundlesApi', () => ({ posBundlesApi: bundles }));
vi.mock('../api/posMenuInsightsApi', () => ({ posMenuInsightsApi: insights }));
vi.mock('../api/posInventoryAlertsApi', () => ({ posInventoryAlertsApi: alerts }));
vi.mock('../api/posInventoryScreenApi', () => ({ posInventoryScreenApi: invScreen }));
import { POSServicesScreen } from './POSServicesScreen';
import { POSServicePricingScreen } from './POSServicePricingScreen';
import { POSServiceCategoriesScreen } from './POSServiceCategoriesScreen';
import { POSServiceAddOnsScreen } from './POSServiceAddOnsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
const S = (id: string, name: string, cat: string, mins: number, cents: number) => ({ serviceId: id, name, categoryId: 'c-' + cat, categoryName: cat, priceCents: cents, durationMinutes: mins, status: 'active', onlineBookable: true, aiBookable: true, addOns: 1, qualifiedTechnicians: 1, sold30d: 1, matchedVia: null, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' });
const SIX = [S('s1', 'Gel Manicure', 'Nails', 45, 5500), S('s2', 'Classic Pedicure', 'Nails', 50, 4800), S('s3', 'CD Mani 4432', 'CD 4432', 30, 5000), S('s4', 'CD Mani 6805', 'CD 6805', 30, 5000), S('s5', 'Haircut', 'Nails', 30, 4500), S('s6', 'Hair Coloring', 'Nails', 120, 15000)];
const STATS = { pricedServices: 6, averagePriceCents: 6633, lowestPriceCents: 4500, highestPriceCents: 15000, priceSumCents: 39800 };
const detail = { ...SIX[0], description: null, categoryArchived: false, addOns: [{ key: 'ao_french', name: 'French tips', priceCents: 1000, durationMinutes: 10, taxable: true, active: true }], categoryAddOns: [],
  technicians: [{ technicianId: 't1', name: 'Vy Tran', primary: true }], branches: [{ branchId: 'b1', name: 'Cherry Hill', current: true, offered: true, status: 'active', priceCents: 5500, durationMinutes: 45, differsFromThis: false }, { branchId: 'b2', name: 'Uptown', current: false, offered: true, status: 'active', priceCents: 6000, durationMinutes: 45, differsFromThis: true }],
  sales90d: { lines: 2, cents: 11000, lastAt: '2026-10-29T12:00:00Z', lastChargedCents: 5500 }, changeCount: 0 };
const AO = (sid: string, sname: string, flag: string | null = null) => ({ offeringId: 'o-' + sid, key: 'ao_french', name: 'French tips', priceCents: 1000, durationMinutes: 10, taxable: true, active: true, serviceId: sid, serviceName: sname, serviceStatus: 'active', categoryName: 'Nails', sharedWith: 4, reviewFlag: flag, createdAt: '2026-10-01T12:00:00Z', updatedAt: null });

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  for (const g of [cat, svc, bundles, insights, alerts, invScreen]) Object.values(g).forEach((f) => (f as any).mockReset());
  cat.dashboard.mockResolvedValue({ period, kpis: { totalServices: 6, activeServices: 6, inactiveServices: 0, activeProducts: 11, allProducts: 11, onlineBookable: 6, onlinePctOfActive: 100, avgServicePriceCents: 6633, pricedServices: 6,
    retailRevenueTodayCents: 1200, retailItemsToday: 1, retailTicketsToday: 1, serviceMixMargin: null, topCategory: 'Nails', topCategoryBasis: 'realized', topCategoryCents: 45600, packageSales: null, activeBundles: 0, addOnConversionPct: 50, addOnTickets: 4, serviceTickets: 8 } });
  cat.charts.mockResolvedValue({ period, serviceMix: [{ label: 'Gel Manicure', cents: 16500, count: 3 }], retailMix: [], categoryRevenue: [{ label: 'Nails', cents: 45600, count: 7 }], addOnConversion: { serviceTickets: 8, withAddOn: 4, pct: 50 } });
  cat.services.mockImplementation(async (q: any) => (q?.pageSize === 1 ? page(SIX.slice(0, 1), { totalItems: 6, stats: STATS }) : page(SIX, { stats: STATS })));
  cat.service.mockResolvedValue(detail);
  cat.categories.mockResolvedValue(page([{ categoryId: 'c-Nails', name: 'Nails', status: 'active', services: 4, activeServices: 4, sharePct: 66.7, matchedServices: [], createdAt: '2026-10-01T12:00:00Z' }]));
  cat.history.mockResolvedValue(page([]));
  cat.customerHistory.mockResolvedValue({ ...page([]), needsQuery: true });
  bundles.state.mockResolvedValue({ kpis: { activeBundles: 0, totalBundles: 0 }, rows: [] });
  insights.get.mockResolvedValue({ hasEnoughData: false, insights: [] });
  alerts.summary.mockResolvedValue({ openAlerts: 11, outOfStock: 2, critical: 3 });
  alerts.active.mockResolvedValue({ total: 1, page: 1, pageSize: 5, pages: 1, rows: [{ productId: 'p1', name: 'OPI Top Coat', onHand: 1, reorderLevel: 4, severity: 'low' }] });
  invScreen.products.mockResolvedValue({ total: 1, page: 1, pageSize: 6, pages: 1, rows: [{ id: 'p1', name: 'OPI Top Coat', sku: 'OPI-T', onHand: 1, retailCents: 1500, costCents: 700, severity: 'low' }] });
  cat.categorySummary.mockResolvedValue({ categories: 3, totalServices: 6, unassigned: 0, breakdown: [{ categoryId: 'c-Nails', name: 'Nails', services: 4, sharePct: 66.7 }, { categoryId: 'c-4432', name: 'CD 4432', services: 1, sharePct: 16.7 }, { categoryId: 'c-6805', name: 'CD 6805', services: 1, sharePct: 16.7 }],
    review: [{ kind: 'code_like_name', categoryId: 'c-4432', categoryName: 'CD 4432' }, { kind: 'service_category_mismatch', categoryId: 'c-Nails', categoryName: 'Nails', serviceId: 's5', serviceName: 'Haircut' }] });
  cat.addOnSummary.mockResolvedValue({ offerings: 4, activeOfferings: 4, definitions: 1, servicesOffering: 4, averagePriceCents: 1000, offeringsOnArchivedServices: 0, categoryAddOnServices: 0 });
  cat.addOns.mockResolvedValue(page([AO('s1', 'Gel Manicure'), AO('s2', 'Classic Pedicure'), AO('s5', 'Haircut', 'nail_add_on_on_hair_service'), AO('s6', 'Hair Coloring', 'nail_add_on_on_hair_service')]));
  cat.addOn.mockResolvedValue({ key: 'ao_french', name: 'French tips', offerings: [AO('s1', 'Gel Manicure'), AO('s2', 'Classic Pedicure'), AO('s5', 'Haircut'), AO('s6', 'Hair Coloring')].map((o) => ({ ...o, withServicePriceCents: 6500, withServiceMinutes: 55 })), differsByService: false, usage: { paidLines: 4, cents: 4000, lastAt: null } });
  cat.addOnUsage.mockResolvedValue({ ...page([]), totals: { paidLines: 0, paidCents: 0 } });
  cat.addOnProfitability.mockResolvedValue({ window: { days: 30, from: '2026-10-14T04:00:00Z', timeZone: 'UTC' }, basis: {}, totals: { unitsSold: 0, revenueCents: 0, costedRevenueCents: 0, recipeCostCents: 0, contributionCents: 0, addOnsWithoutRecipe: 0 }, items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });   // ADD-ONS 09 panel (usage tab, cost viewers)
});
const mount = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('Services & Products', () => {
  it('keeps the ten KPIs, says what the data cannot support, and shows the real branch rows', async () => {
    mount(<POSServicesScreen />);
    expect(await screen.findByText('$66.33')).toBeInTheDocument();
    for (const k of ['Total Services', 'Active Products', 'Online Bookable', 'Low Stock Alerts', 'Avg. Service Price', 'Retail Revenue Today', 'Service Mix Margin', 'Top Category', 'Package Sales', 'Add-On Conversion']) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    expect(screen.getByTestId('kpi-margin')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-add-on-conversion')).toHaveTextContent('50%');
    expect(await screen.findByTestId('branch-table')).toHaveTextContent('Uptown');
    expect(screen.getByTestId('branch-table')).toHaveTextContent('$60.00');
    expect(document.cookie).not.toMatch(/branchOverrides/);
    for (const q of ['qa-addService', 'qa-addProduct', 'qa-editPricing', 'qa-createBundle', 'qa-manageInventory', 'qa-updateBooking', 'qa-importCatalog', 'qa-viewReports']) expect(screen.getByTestId(q)).toBeInTheDocument();
  });
  it('extras (Services & Products 2 · 11): financial labels say which basis they use — menu price, catalog cost proxy, or paid sales', async () => {
    mount(<POSServicesScreen />);
    expect(await screen.findByText('$66.33')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-avg-price')).toHaveTextContent('Menu price, not sales');
    expect(screen.getByTestId('kpi-top-category')).toHaveTextContent('By paid sales in the period');
    const col = await screen.findByTestId('col-list-margin');
    expect(col).toHaveTextContent('List margin');
    expect(col.getAttribute('title')).toMatch(/not from sales/);
    expect(screen.getByTestId('chart-rule')).toHaveTextContent(/paid ticket lines/);
  });
  it('extras (Services & Products 2 · 14): the service and product lists page independently, keep the picked service, and a new search starts both on Page 1', async () => {
    cat.services.mockImplementation(async (q: any) => (q?.pageSize === 1 ? page(SIX.slice(0, 1), { totalItems: 6, stats: STATS })
      : page(q?.page === 2 ? SIX.slice(3) : SIX.slice(0, 3), { page: q?.page ?? 1, pageSize: 3, totalItems: 6, totalPages: 2, stats: STATS })));
    invScreen.products.mockImplementation(async (q: any) => ({ total: 12, page: q?.page ?? 1, pageSize: 6, pages: 2, rows: [{ id: 'p' + (q?.page ?? 1), name: 'Product page ' + (q?.page ?? 1), sku: 'SKU', onHand: 1, retailCents: 1500, costCents: 700, severity: 'ok' }] }));
    mount(<POSServicesScreen />);
    const menu = await screen.findByTestId('service-menu');
    const rows = await within(menu).findAllByTestId('service-row');
    fireEvent.click(rows[1]);                                                    // pick Classic Pedicure
    await waitFor(() => expect(cat.service).toHaveBeenLastCalledWith('s2'));
    fireEvent.click(within(menu).getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(within(menu).getAllByTestId('service-row')[0]).toHaveTextContent('CD Mani 6805'));
    const svcCalls = cat.services.mock.calls.map((c) => c[0]).filter((q: any) => q?.pageSize !== 1);
    expect(svcCalls[svcCalls.length - 1]).toMatchObject({ page: 2 });
    expect(invScreen.products).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));   // the product list did not move
    expect(within(screen.getByTestId('product-catalog')).getByText('Product page 1')).toBeInTheDocument();
    expect(cat.service).toHaveBeenLastCalledWith('s2');                          // the picked service stays picked across pages
    // the product list pages on its own
    fireEvent.click(within(screen.getByTestId('product-catalog')).getByRole('button', { name: 'Page 2' }));
    expect(await within(screen.getByTestId('product-catalog')).findByText('Product page 2')).toBeInTheDocument();
    expect(within(menu).getAllByTestId('service-row')[0]).toHaveTextContent('CD Mani 6805');
    // a new search: both lists back to Page 1, no rows repeated
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'mani' } });
    await waitFor(() => expect(cat.services).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'mani', page: 1 })));
    await waitFor(() => expect(invScreen.products).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'mani', page: 1 })));
    const ids = within(menu).getAllByTestId('service-row').map((r) => r.textContent);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('a phone search shows customer history (what was charged), not a service filter', async () => {
    cat.customerHistory.mockResolvedValue({ ...page([{ lineId: 'l1', ticketId: 't1', ticketNumber: '101', paid: true, at: '2026-10-29T12:00:00Z', customerId: 'cu1', customerName: 'Mai Le', maskedPhone: '••• 1234', item: 'Gel Manicure', kind: 'service', categoryAtSale: 'Nails', catalogPriceAtSaleCents: 5500, chargedCents: 5500, minutes: 45, technician: 'Vy Tran' }]), needsQuery: false });
    mount(<POSServicesScreen />);
    fireEvent.change(await screen.findByTestId('search'), { target: { value: '(856) 555-1234' } });
    expect(await screen.findByText('Mai Le')).toBeInTheDocument();
    expect(screen.getByText('••• 1234')).toBeInTheDocument();
  });
});

describe('Service Pricing', () => {
  it('keeps the four cards from the whole catalog and the four columns; Classic Pedicure stays 50 min', async () => {
    mount(<POSServicePricingScreen />);
    expect(await screen.findByText('Classic Pedicure')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-services')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-average')).toHaveTextContent('$66.33');
    expect(screen.getByTestId('kpi-lowest')).toHaveTextContent('$45.00');
    expect(screen.getByTestId('kpi-highest')).toHaveTextContent('$150.00');
    expect(screen.getAllByText('50 min').length).toBeGreaterThan(0);
    expect(screen.getByTestId('pricing-rule')).toHaveTextContent(/takes effect when it is saved, or on the date you schedule/);
  });
  it('Edit Pricing needs a reason and sends the version it opened', async () => {
    cat.updatePricing.mockResolvedValue({ changed: 1 });
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit-pricing'))[0]);
    fireEvent.change(screen.getByTestId('pricing-price'), { target: { value: '58.00' } });
    fireEvent.click(screen.getByTestId('pricing-save'));
    expect(await screen.findByTestId('pricing-error')).toHaveTextContent(/why/i);
    expect(cat.updatePricing).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('pricing-reason'), { target: { value: 'supplier price' } });
    fireEvent.click(screen.getByTestId('pricing-save'));
    await waitFor(() => expect(cat.updatePricing).toHaveBeenCalledWith('s1', { priceCents: 5800, durationMinutes: 45, reason: 'supplier price', expectedUpdatedAt: '2026-10-01T12:00:00Z' }));
  });
  it('D4 gaps: Edit Pricing shows the upcoming bookings it touches (their quoted price is kept)', async () => {
    cat.pricingImpact.mockResolvedValue({ upcoming: 2, quotedTotalCents: 11000, quotedDifferently: 2, wouldRunLonger: 0, items: [{ appointmentId: 'a1', day: '2026-11-10', time: '10:00', customer: 'Mai Le', quotedCents: 5500, bookedMinutes: 45 }] });
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit-pricing'))[0]);
    fireEvent.change(screen.getByTestId('pricing-price'), { target: { value: '58.00' } });
    expect(await screen.findByTestId('pricing-impact', {}, { timeout: 2000 })).toHaveTextContent(/2 upcoming bookings/);
    expect(screen.getByTestId('pricing-impact-list')).toHaveTextContent('Mai Le');
    expect(cat.pricingImpact).toHaveBeenLastCalledWith('s1', { priceCents: '5800', durationMinutes: '45' });
  });
  it('SERVICE PRICING 12: Edit Pricing shows each technician\'s rate (with its source) and pay at the old → new price, and where actual payouts came from', async () => {
    cat.pricingImpact.mockResolvedValue(null);
    cat.compensationPreview.mockResolvedValue({ serviceId: 's1', serviceName: 'Gel Manicure', currentPriceCents: 5500, proposedPriceCents: 5800, techniciansShown: 2, techniciansTotal: 2, changesPayNow: false,
      technicians: [
        { technicianId: 't1', name: 'Vy Tran', commissionType: 'percent', commissionValue: 70, supplyMethod: 'fixed', supplyValue: 500, source: 'Technician + Service', policyId: 'p1', policyVersion: 1, currentEarningsCents: 3500, proposedEarningsCents: 3710, changeCents: 210 },
        { technicianId: 't2', name: 'Lan Do', commissionType: 'percent', commissionValue: 40, supplyMethod: 'none', supplyValue: 0, source: 'Service default', policyId: null, policyVersion: null, currentEarningsCents: 2200, proposedEarningsCents: 2320, changeCents: 120 }],
      actual: { days: 90, lines: 3, techEarningsCents: 9000, bySource: [{ source: 'Technician + Service', lines: 2, grossCents: 11000, techEarningsCents: 7000, lastAt: null }, { source: 'not_recorded', lines: 1, grossCents: 5500, techEarningsCents: 2000, lastAt: null }] } });
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit-pricing'))[0]);
    fireEvent.change(screen.getByTestId('pricing-price'), { target: { value: '58.00' } });
    const list = await screen.findByTestId('pricing-pay-list', {}, { timeout: 2000 });
    expect(cat.compensationPreview).toHaveBeenLastCalledWith('s1', 5800);
    expect(list).toHaveTextContent('Vy Tran · 70% (Technician + service rule) · $35.00 → $37.10');
    expect(list).toHaveTextContent('Lan Do · 40% (The service’s own rate) · $22.00 → $23.20');
    expect(screen.getByTestId('pricing-pay-actual')).toHaveTextContent('Paid in the last 90 days: 3 lines, priced by Technician + service rule 2 · Source not recorded 1');
    // a refused / failed preview hides the section; it never blocks the price edit
    cat.compensationPreview.mockRejectedValue({ status: 403 });
    fireEvent.change(screen.getByTestId('pricing-price'), { target: { value: '59.00' } });
    await waitFor(() => expect(screen.queryByTestId('pricing-pay')).toBeNull(), { timeout: 2000 });
    expect(screen.getByTestId('pricing-save')).not.toBeDisabled();
  });
  it('SERVICE PRICING 08: Preview at checkout shows the server\'s lines, deal, tax and total; add-ons and a proposed price go to the server; nothing is saved', async () => {
    const PV = (o: any = {}) => ({ service: { id: 's1', name: 'Gel Manicure', catalogPriceCents: 5500, previewPriceCents: 5500 },
      lines: [{ kind: 'service', key: null, name: 'Gel Manicure', priceCents: 5500, taxable: true, discountCents: 550, netCents: 4950 }],
      addOnsAvailable: [{ key: 'ao_french', name: 'French tips', priceCents: 1000, taxable: true }],
      discounts: { available: true, policy: 'best_single', totalCents: 550, applied: [{ dealId: 'd1', title: 'Gel week 10%', appliedCents: 550 }], notForWalkIn: [{ dealId: 'd2', title: 'Newcomer', reason: 'new_customers_only' }] },
      tax: { ratePercent: 8, taxableCents: 4950, taxCents: 396 }, totals: { grossCents: 5500, subtotalCents: 4950, totalDueCents: 5346, cardSurcharge: 'off' }, chargesAnyone: false, ...o });
    cat.pricePreview.mockResolvedValue(PV());
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-price-preview'))[0]);
    const dlg = await screen.findByTestId('dlg-price-preview');
    await waitFor(() => expect(within(dlg).getByTestId('pp-total')).toHaveTextContent('$53.46'));
    expect(within(dlg).getByTestId('pp-deal')).toHaveTextContent('Deal: Gel week 10%');
    expect(within(dlg).getByTestId('pp-tax')).toHaveTextContent('$3.96');
    expect(within(dlg).getByTestId('pp-subtotal')).toHaveTextContent('$49.50');
    expect(within(dlg).getByText(/1 offer\(s\) need a known customer or a code/)).toBeInTheDocument();
    expect(cat.pricePreview).toHaveBeenLastCalledWith('s1', { addOns: [], priceCents: null });
    fireEvent.click(within(dlg).getByTestId('pp-addon-ao_french'));
    await waitFor(() => expect(cat.pricePreview).toHaveBeenLastCalledWith('s1', { addOns: ['ao_french'], priceCents: null }));
    fireEvent.change(within(dlg).getByTestId('pp-price'), { target: { value: '60.00' } });
    await waitFor(() => expect(cat.pricePreview).toHaveBeenLastCalledWith('s1', { addOns: ['ao_french'], priceCents: 6000 }));
    cat.pricePreview.mockResolvedValue(PV({ discounts: { available: false, policy: null, totalCents: 0, applied: [], notForWalkIn: [] } }));
    fireEvent.change(within(dlg).getByTestId('pp-price'), { target: { value: '61.00' } });
    expect(await within(dlg).findByTestId('pp-no-deals')).toHaveTextContent(/Deals could not be checked here/);
    expect(cat.updatePricing).not.toHaveBeenCalled();
  });
  it('D4 gaps: Edit Pricing can schedule the change for a date (sent with the time; current price untouched)', async () => {
    cat.schedulePricing.mockResolvedValue({ scheduleId: 'x', scheduled: {} }); cat.pricingImpact.mockResolvedValue(null);
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit-pricing'))[0]);
    fireEvent.change(screen.getByTestId('pricing-price'), { target: { value: '60.00' } });
    fireEvent.change(screen.getByTestId('pricing-reason'), { target: { value: 'New year' } });
    fireEvent.change(screen.getByTestId('pricing-when'), { target: { value: 'later' } });
    fireEvent.click(screen.getByTestId('pricing-save'));
    expect(await screen.findByTestId('pricing-error')).toBeInTheDocument();   // no time yet
    fireEvent.change(screen.getByTestId('pricing-at'), { target: { value: '2027-01-01T09:00' } });
    fireEvent.click(screen.getByTestId('pricing-save'));
    await waitFor(() => expect(cat.schedulePricing).toHaveBeenCalledWith('s1', { priceCents: 6000, effectiveAt: new Date('2027-01-01T09:00').toISOString(), reason: 'New year' }));
    expect(cat.updatePricing).not.toHaveBeenCalled();
  });
  it('403 is a permission state', async () => {
    cat.services.mockRejectedValue({ status: 403 });
    mount(<POSServicePricingScreen />);
    expect(await screen.findByText(/cannot see this information/i)).toBeInTheDocument();
  });
});

describe('Service Categories', () => {
  it('SERVICE PRICING 04 (round 10): Edit Pricing also names technician availability conflicts and open tickets at another price', async () => {
    cat.pricingImpact.mockResolvedValue({ upcoming: 1, quotedTotalCents: 5500, quotedDifferently: 1, wouldRunLonger: 1, availabilityConflicts: 1, staleOpenTickets: 2,
      conflictItems: [{ appointmentId: 'a1', day: '2026-11-10', time: '10:00', nextAppointmentId: 'a2', nextTime: '10:50' }], items: [] });
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit-pricing'))[0]);
    fireEvent.change(screen.getByTestId('pricing-duration'), { target: { value: '60' } });
    expect(await screen.findByTestId('pricing-impact-conflicts', {}, { timeout: 2000 })).toHaveTextContent('1 booked visit(s) would then run into the same technician’s next appointment · 2026-11-10 10:00 → 10:50');
    expect(screen.getByTestId('pricing-impact-stale')).toHaveTextContent('2 open ticket(s) already carry this service at another price');
  });
  it('SERVICE PRICING 10 (round 10): the details drawer shows previous → current → pending prices in one timeline', async () => {
    cat.service.mockResolvedValue({ ...detail, scheduled: { id: 'sc1', priceCents: 6000, durationMinutes: null, effectiveAt: '2026-12-01T14:00:00Z', reason: 'New year' } });
    cat.history.mockImplementation(async (q: any) => (q?.field === 'price' ? page([{ id: 'h2', field: 'price_cents', oldValue: '5000', newValue: '5500', changedAt: '2026-10-20T12:00:00Z', effectiveAt: null },
      { id: 'h1', field: 'price_cents', oldValue: '4500', newValue: '5000', changedAt: '2026-09-01T12:00:00Z', effectiveAt: null }]) : page([])));
    mount(<POSServicePricingScreen />);
    fireEvent.click((await screen.findAllByTestId('row-details'))[0]);
    const tl = await screen.findByTestId('pd-timeline');
    await waitFor(() => expect(screen.getAllByTestId('pd-tl-prev')).toHaveLength(2));
    expect(screen.getAllByTestId('pd-tl-prev').map((x) => x.textContent)).toEqual([expect.stringContaining('$45.00 → $50.00'), expect.stringContaining('$50.00 → $55.00')]);   // oldest first
    expect(screen.getByTestId('pd-tl-now')).toHaveTextContent('Now: $55.00');
    expect(screen.getByTestId('pd-tl-next')).toHaveTextContent('Pending: $60.00');
    expect(tl.parentElement).toHaveTextContent('One scheduled change at a time');
    expect(cat.history).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 's1', field: 'price', pageSize: 3 }));
  });
  it('SERVICE PRICING 09 (round 10): a customer-history row says why the charged price differs (server reasons, in words)', async () => {
    cat.customerHistory.mockResolvedValue({ ...page([{ lineId: 'l1', ticketId: 't1', ticketNumber: '101', paid: true, at: '2026-10-29T12:00:00Z', customerId: 'cu1', customerName: 'Mai Le', maskedPhone: '••• 1234', item: 'Gel Manicure', kind: 'service', categoryAtSale: 'Nails', catalogPriceAtSaleCents: 5500, chargedCents: 5000, minutes: 45, technician: 'Vy Tran',
      priceExplanation: { catalogNowCents: 5500, catalogAtSaleCents: 5500, quantity: 1, chargedCents: 5000, differenceFromCatalogNowCents: -500, reasons: [{ code: 'manual_override', cents: -500, by: 'Pat Owner', at: '2026-10-29T12:00:00Z' }, { code: 'not_recorded', cents: 0 }] } }]), needsQuery: false });
    mount(<POSServicesScreen />);
    fireEvent.change(await screen.findByTestId('search'), { target: { value: '(856) 555-1234' } });
    const why = await screen.findByTestId('price-why');
    expect(why).toHaveTextContent('price changed by Pat Owner (−$5.00)'); expect(why.textContent).not.toMatch(/manual_override|not_recorded/);
  });
  it('SERVICE PRICING 06 (round 10): a cross-domain finding names both domains in words', async () => {
    cat.categorySummary.mockResolvedValue({ categories: 1, totalServices: 1, unassigned: 0, breakdown: [{ categoryId: 'c-h', name: 'Hair Studio', services: 1, sharePct: 100 }],
      review: [{ kind: 'service_category_mismatch', categoryId: 'c-h', categoryName: 'Hair Studio', serviceId: 's9', serviceName: 'Spa Pedicure', categoryDomain: 'hair', serviceDomain: 'nails', status: 'open', lastDecision: null }] });
    mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByTestId('review-service_category_mismatch')).toHaveTextContent('The service reads as nails but its category reads as hair');
    expect(cat.reassign).not.toHaveBeenCalled();
  });
  it('keeps the two cards, the chart and Breakdown, and flags (never fixes) the code-like names and the hair service', async () => {
    mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByTestId('breakdown-table')).toHaveTextContent('66.7%');
    expect(screen.getByTestId('kpi-categories')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-total-services')).toHaveTextContent('6');
    expect(screen.getByTestId('review-code_like_name')).toHaveTextContent('CD 4432');
    expect(screen.getByTestId('review-service_category_mismatch')).toHaveTextContent('Haircut');
    expect(cat.reassign).not.toHaveBeenCalled();
  });
  it('SERVICE PRICING 13: owner review — approve a finding as is with a required note (the catalog is not changed), approved findings show who/when/why and can be reopened', async () => {
    const base = await cat.categorySummary();
    cat.categorySummary.mockResolvedValue({ ...base, review: [
      { kind: 'code_like_name', categoryId: 'c-4432', categoryName: 'CD 4432', status: 'open', lastDecision: null },
      { kind: 'service_category_mismatch', categoryId: 'c-Nails', categoryName: 'Nails', serviceId: 's5', serviceName: 'Haircut', status: 'approved',
        lastDecision: { decision: 'approved_as_is', note: 'Kids combo', by: 'Pat Owner', at: '2026-11-10T15:00:00Z' } }] });
    cat.reviewDecision.mockResolvedValue({ item: {}, history: [], changesCatalog: false });
    mount(<POSServiceCategoriesScreen />);
    const panel = await screen.findByTestId('review');
    expect(panel).toHaveTextContent('Review notes · 1');                       // open findings only
    const approved = screen.getByTestId('review-service_category_mismatch');
    expect(approved.getAttribute('data-status')).toBe('approved');
    expect(within(approved).getByTestId('review-approved')).toHaveTextContent(/Approved as is\s*by Pat Owner on Nov 10, 2026 — Kids combo/);
    // approve the open one: a note is required
    fireEvent.click(within(screen.getByTestId('review-code_like_name')).getByTestId('review-decide'));
    fireEvent.click(await screen.findByTestId('review-decision-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write a short note');
    expect(cat.reviewDecision).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('review-decision-note'), { target: { value: 'Supplier code — we keep it' } });
    fireEvent.click(screen.getByTestId('review-decision-save'));
    await waitFor(() => expect(cat.reviewDecision).toHaveBeenCalledWith('c-4432', { kind: 'code_like_name', serviceId: null, decision: 'approve', note: 'Supplier code — we keep it' }));
    expect(await screen.findByTestId('note')).toHaveTextContent('Nothing in the catalog was changed.');
    // reopen the approved one
    fireEvent.click(within(screen.getByTestId('review-service_category_mismatch')).getByTestId('review-decide'));
    fireEvent.change(await screen.findByTestId('review-decision-note'), { target: { value: 'Move it after all' } });
    fireEvent.click(screen.getByTestId('review-decision-save'));
    await waitFor(() => expect(cat.reviewDecision).toHaveBeenLastCalledWith('c-Nails', { kind: 'service_category_mismatch', serviceId: 's5', decision: 'reopen', note: 'Move it after all' }));
    expect(cat.reassign).not.toHaveBeenCalled();
  });
  it('extras row 10: the counted scope is stated — one branch with its shared rows, or every branch listed separately; nothing when the server sends no scope', async () => {
    const base = await cat.categorySummary();
    cat.categorySummary.mockResolvedValue({ ...base, scope: { mode: 'branch', branchId: 'b1', branchName: 'Main', branchServices: 6, salonWideServices: 2, branches: [{ branchId: 'b1', name: 'Main', services: 6 }] } });
    const v = mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByTestId('catalog-scope')).toHaveTextContent('Counting Main: its own 6 service rows plus 2 shared salon-wide rows.');
    v.unmount();
    cat.categorySummary.mockResolvedValue({ ...base, scope: { mode: 'salon', branchId: null, branchName: null, branchServices: null, salonWideServices: 0, branches: [{ branchId: 'b1', name: 'Main', services: 6 }, { branchId: 'b2', name: 'Uptown', services: 1 }] } });
    const v2 = mount(<POSServiceCategoriesScreen />);
    const line = await screen.findByTestId('catalog-scope');
    expect(line).toHaveTextContent('Counting all 2 branches, each separately: Main 6 · Uptown 1.');
    expect(line).toHaveTextContent('the same service at two branches counts twice');
    v2.unmount();
    cat.categorySummary.mockResolvedValue(base);
    mount(<POSServiceCategoriesScreen />);
    await screen.findByTestId('breakdown-table');
    expect(screen.queryByTestId('catalog-scope')).toBeNull();
  });
  it('extras (Nov 11 2026): a chart bar filters the directory to that category, with a visible Clear', async () => {
    mount(<POSServiceCategoriesScreen />);
    await screen.findByTestId('breakdown-table');
    fireEvent.click(screen.getAllByTestId('bars-categories-pick')[0]);
    expect(await screen.findByTestId('chart-drill')).toHaveTextContent('Nails');
    await waitFor(() => expect(cat.categories).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Nails' })));
    fireEvent.click(screen.getByTestId('chart-drill-clear'));
    expect(screen.queryByTestId('chart-drill')).toBeNull();
  });
  it('Saved filter state: the search comes back after leaving and returning to the screen', async () => {
    const v = mount(<POSServiceCategoriesScreen />);
    await screen.findByTestId('breakdown-table');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'Nails' } });
    await waitFor(() => expect(cat.categories).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Nails' })));
    v.unmount(); cat.categories.mockClear();
    mount(<POSServiceCategoriesScreen />);
    expect((await screen.findByTestId('search') as HTMLInputElement).value).toBe('Nails');
    await waitFor(() => expect(cat.categories).toHaveBeenCalledWith(expect.objectContaining({ q: 'Nails' })));
  });
  it('403 is a permission state', async () => {
    cat.categorySummary.mockRejectedValue({ status: 403 });
    mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByText(/cannot see this information/i)).toBeInTheDocument();
  });
});

describe('Add-Ons', () => {
  it('keeps the four cards and eight columns; French tips is ONE add-on on four services with the hair rows flagged', async () => {
    mount(<POSServiceAddOnsScreen />);
    expect((await screen.findAllByTestId('add-on-row')).length).toBe(4);
    expect(screen.getByTestId('kpi-total')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-avg')).toHaveTextContent('$10.00');
    for (const h of ['Add-on', 'Service', 'Category', 'Price', '+ Time', 'Taxable', 'Status', 'Actions']) expect(screen.getAllByText(new RegExp('^' + h.replace('+', '\\+') + '$', 'i')).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('review-flag').length).toBe(2);
    for (const l of ['link-services', 'link-categories', 'link-pricing']) expect(screen.getByTestId(l)).toBeInTheDocument();
  });
  it('editing a shared add-on from a row changes only that offering unless the definition is chosen', async () => {
    cat.updateAddOn.mockResolvedValue({ changed: 1 });
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit'))[0]);
    expect(await screen.findByTestId('scope-offering')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByTestId('edit-price'), { target: { value: '12.00' } });
    fireEvent.change(screen.getByTestId('edit-reason'), { target: { value: 'gel tips cost more' } });
    fireEvent.click(screen.getByTestId('add-on-edit-save'));
    await waitFor(() => expect(cat.updateAddOn).toHaveBeenCalledWith('ao_french', expect.objectContaining({ scope: 'offering', serviceId: 's1', priceCents: 1200, reason: 'gel tips cost more' })));
  });
  it('ADD-ONS 08: a shared-definition edit is reviewed first (server dryRun, nothing saved) — affected count, old → new per offering, undo note; the next press saves', async () => {
    cat.updateAddOn.mockImplementation(async (_k: string, b: any) => (b.dryRun ? { changed: 3, dryRun: true, changes: [
      { serviceId: 's1', field: 'price_cents', oldValue: 1000, newValue: 1200 }, { serviceId: 's2', field: 'price_cents', oldValue: 800, newValue: 1200 },
      { serviceId: 's5', field: 'is_active', oldValue: true, newValue: false }] } : { changed: 3 }));
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit'))[0]);
    fireEvent.click(await screen.findByTestId('scope-definition'));
    fireEvent.change(screen.getByTestId('edit-price'), { target: { value: '12.00' } });
    fireEvent.change(screen.getByTestId('edit-reason'), { target: { value: 'new tip cost' } });
    expect(screen.getByTestId('add-on-edit-save')).toHaveTextContent('Review changes');
    fireEvent.click(screen.getByTestId('add-on-edit-save'));
    const p = await screen.findByTestId('mass-preview');
    expect(cat.updateAddOn).toHaveBeenCalledTimes(1);
    expect(cat.updateAddOn).toHaveBeenLastCalledWith('ao_french', expect.objectContaining({ scope: 'definition', priceCents: 1200, dryRun: true }));
    expect(screen.getByTestId('mass-preview-count')).toHaveTextContent('3 changes across 3 offerings');
    const items = [...screen.getByTestId('mass-preview-list').querySelectorAll('li')].map((li) => li.textContent);
    expect(items[0]).toMatch(/Gel Manicure · Price\$10\.00 → \$12\.00/);
    expect(items[1]).toMatch(/Classic Pedicure · Price\$8\.00 → \$12\.00/);
    expect(items[2]).toMatch(/Haircut · Status\s*Active → Inactive/);
    expect(p).toHaveTextContent('Audit history');
    expect(screen.getByTestId('add-on-edit-save')).toHaveTextContent('Save Changes');
    // changing a field after the review asks for a new review (what is saved is always what was reviewed)
    fireEvent.change(screen.getByTestId('edit-price'), { target: { value: '13.00' } });
    expect(screen.queryByTestId('mass-preview')).toBeNull();
    expect(screen.getByTestId('add-on-edit-save')).toHaveTextContent('Review changes');
    fireEvent.change(screen.getByTestId('edit-price'), { target: { value: '14.00' } });
    fireEvent.click(screen.getByTestId('add-on-edit-save'));
    await waitFor(() => expect(cat.updateAddOn).toHaveBeenCalledTimes(2));
    expect(cat.updateAddOn.mock.calls[1][1]).toMatchObject({ priceCents: 1400, dryRun: true });
    expect(await screen.findByTestId('mass-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-on-edit-save'));
    await waitFor(() => expect(cat.updateAddOn).toHaveBeenCalledTimes(3));
    expect(cat.updateAddOn.mock.calls[2][1]).not.toHaveProperty('dryRun');
    expect(cat.updateAddOn.mock.calls[2][1]).toMatchObject({ scope: 'definition', priceCents: 1400 });
  });
  it('ADD-ONS 07: editing +time shows the upcoming appointments that booked it and how many would run longer; archive warns too', async () => {
    const up = { appointments: 2, policy: 'booked_quotes_kept', items: [
      { appointmentId: 'ap1', day: '2026-11-20', time: '09:00', customer: null, serviceId: 's1', serviceName: 'Gel Manicure', bookedMinutes: 10, quotedCents: 1000 },
      { appointmentId: 'ap2', day: '2026-11-21', time: '11:00', customer: null, serviceId: 's2', serviceName: 'Classic Pedicure', bookedMinutes: 20, quotedCents: 1000 }] };
    cat.addOn.mockResolvedValue({ key: 'ao_french', name: 'French tips', upcoming: up, offerings: [AO('s1', 'Gel Manicure'), AO('s2', 'Classic Pedicure')].map((o) => ({ ...o, withServicePriceCents: 6500, withServiceMinutes: 55 })), differsByService: false, usage: { paidLines: 0, cents: 0, lastAt: null } });
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit'))[0]);   // the Gel Manicure offering
    const note = await screen.findByTestId('add-on-impact');
    expect(note).toHaveTextContent('1 upcoming appointments have this add-on booked.');   // only this offering's service
    fireEvent.change(screen.getByTestId('edit-minutes'), { target: { value: '15' } });
    expect(screen.getByTestId('add-on-impact')).toHaveTextContent('1 would run longer at the new time.');
    fireEvent.click(screen.getByTestId('scope-definition'));
    expect(screen.getByTestId('add-on-impact')).toHaveTextContent('2 upcoming appointments');
    expect(screen.getByTestId('add-on-impact-list').querySelectorAll('li')).toHaveLength(2);
    expect(cat.updateAddOn).not.toHaveBeenCalled();
  });
  it('ADD-ONS 07: archiving one offering names who still has it booked (only that service), before anything is archived', async () => {
    const up = { appointments: 2, items: [
      { appointmentId: 'ap1', day: '2026-11-20', time: '09:00', customer: 'Mai Le', serviceId: 's1', serviceName: 'Gel Manicure', bookedMinutes: 10, quotedCents: 1000 },
      { appointmentId: 'ap2', day: '2026-11-21', time: '11:00', customer: null, serviceId: 's2', serviceName: 'Classic Pedicure', bookedMinutes: 10, quotedCents: 1000 }] };
    cat.addOn.mockResolvedValue({ key: 'ao_french', name: 'French tips', upcoming: up, offerings: [], differsByService: false, usage: { paidLines: 0, cents: 0, lastAt: null } });
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click((await screen.findAllByTestId('row-archive'))[0]);
    const note = await screen.findByTestId('add-on-impact');
    expect(note).toHaveTextContent('1 upcoming appointments still have this add-on booked');
    expect(note).toHaveTextContent('Mai Le');
    fireEvent.click(screen.getByTestId('archive-all'));
    expect(screen.getByTestId('add-on-impact')).toHaveTextContent('2 upcoming appointments');
    expect(cat.archiveAddOn).not.toHaveBeenCalled();
  });
  it('ADD-ONS 07: with nothing booked the editor says so quietly', async () => {
    cat.addOn.mockResolvedValue({ key: 'ao_french', name: 'French tips', upcoming: { appointments: 0, items: [] }, offerings: [AO('s1', 'Gel Manicure')].map((o) => ({ ...o, withServicePriceCents: 6500, withServiceMinutes: 55 })), differsByService: false, usage: { paidLines: 0, cents: 0, lastAt: null } });
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click((await screen.findAllByTestId('row-edit'))[0]);
    expect(await screen.findByTestId('add-on-impact-none')).toBeInTheDocument();
    expect(screen.queryByTestId('add-on-impact')).toBeNull();
  });
  it('ADD-ONS 14: a usage row explains why the charged amount differs from the default price', async () => {
    cat.addOnUsage.mockResolvedValue({ ...page([{ lineId: 'l1', addOn: 'French tips', chargedCents: 1500, minutes: 10, at: '2026-10-29T12:00:00Z', paid: true, ticketId: 't1', ticketNumber: '102', customerName: 'Mai Le', maskedPhone: '••• 1234', technician: 'Vy Tran', mainServices: 'Classic Pedicure',
      quantity: 2, quotedCents: 1000, menuPriceCents: null, priceReasons: ['quantity', 'line_reduced', 'price_varies_by_service', 'tax_on_ticket', 'not_a_known_code'] }]), totals: { paidLines: 1, paidCents: 1500 } });
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click(await screen.findByTestId('tab-usage'));
    const why = await screen.findByTestId('price-reasons');
    expect(why).toHaveTextContent('Quantity 2');
    expect(why).toHaveTextContent('Charged below the $10.00 it was added at');
    expect(why).toHaveTextContent('Default price differs by service');
    expect(why).toHaveTextContent('tax is added on the ticket');
    expect(why.textContent).not.toMatch(/not_a_known_code/);
  });
  it('a new add-on must name its services (never all by default)', async () => {
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click(await screen.findByTestId('new-add-on'));
    fireEvent.change(screen.getByTestId('add-on-name'), { target: { value: 'Chrome' } });
    fireEvent.click(screen.getByTestId('add-on-save'));
    expect(await screen.findByTestId('add-on-error')).toBeInTheDocument();
    expect(cat.createAddOn).not.toHaveBeenCalled();
  });
});
