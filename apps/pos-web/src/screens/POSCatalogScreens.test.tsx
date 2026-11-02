// POSCatalogScreens — the Oct 30 2026 rebuilds of Services & Products, Service Pricing, Service Categories and Add-Ons over
// `/pos/catalog/*`: the photo's numbers kept (6 services · $66.33 / $45 / $150 · Nails 4 · CD 4432 1 · CD 6805 1 · French tips
// on four services), honest "—" for figures the data cannot support, the review flags, the reason-required pricing editor,
// the shared-definition vs one-offering edit, and 403s.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { cat, svc, bundles, insights, alerts, invScreen } = vi.hoisted(() => ({
  cat: { dashboard: vi.fn(), charts: vi.fn(), services: vi.fn(), service: vi.fn(), updatePricing: vi.fn(), history: vi.fn(), customerHistory: vi.fn(), categorySummary: vi.fn(), categories: vi.fn(), category: vi.fn(), reassign: vi.fn(),
    addOnSummary: vi.fn(), addOns: vi.fn(), addOn: vi.fn(), addOnUsage: vi.fn(), createAddOn: vi.fn(), updateAddOn: vi.fn(), archiveAddOn: vi.fn(), restoreAddOn: vi.fn() },
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
    expect(screen.getByTestId('pricing-rule')).toHaveTextContent(/takes effect when it is saved/);
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
  it('403 is a permission state', async () => {
    cat.services.mockRejectedValue({ status: 403 });
    mount(<POSServicePricingScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe('Service Categories', () => {
  it('keeps the two cards, the chart and Breakdown, and flags (never fixes) the code-like names and the hair service', async () => {
    mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByTestId('breakdown-table')).toHaveTextContent('66.7%');
    expect(screen.getByTestId('kpi-categories')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-total-services')).toHaveTextContent('6');
    expect(screen.getByTestId('review-code_like_name')).toHaveTextContent('CD 4432');
    expect(screen.getByTestId('review-service_category_mismatch')).toHaveTextContent('Haircut');
    expect(cat.reassign).not.toHaveBeenCalled();
  });
  it('403 is a permission state', async () => {
    cat.categorySummary.mockRejectedValue({ status: 403 });
    mount(<POSServiceCategoriesScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
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
  it('a new add-on must name its services (never all by default)', async () => {
    mount(<POSServiceAddOnsScreen />);
    fireEvent.click(await screen.findByTestId('new-add-on'));
    fireEvent.change(screen.getByTestId('add-on-name'), { target: { value: 'Chrome' } });
    fireEvent.click(screen.getByTestId('add-on-save'));
    expect(await screen.findByTestId('add-on-error')).toBeInTheDocument();
    expect(cat.createAddOn).not.toHaveBeenCalled();
  });
});
