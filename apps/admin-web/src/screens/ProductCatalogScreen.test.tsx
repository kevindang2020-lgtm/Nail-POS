import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const productCatalog = vi.fn();
const productImports = vi.fn();
const productImportErrors = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  productCatalog: (...a: any[]) => productCatalog(...a),
  productImports: (...a: any[]) => productImports(...a),
  productImportErrors: (...a: any[]) => productImportErrors(...a),
} }));

import { ProductCatalogScreen } from './ProductCatalogScreen';

const kpi = (key: string, label: string, value: string | null) => ({ key, label, value, available: value !== null });
const overview = () => ({
  kpis: [
    kpi('total_products', 'Total Products', '8'), kpi('active_brands', 'Active Brands', '6'),
    kpi('duplicate_products', 'Duplicate Products', '2'), kpi('import_errors', 'Import Errors', null),
    kpi('products_with_barcodes', 'Products With Barcodes', '6'), kpi('suggested_retail_configured', 'Suggested Retail Configured', '8'),
    kpi('active_tenants', 'Active Tenants Using Products', '3'), kpi('retired_products', 'Retired Products', '1'),
    kpi('taxable_products', 'Taxable Products', null), kpi('vendors', 'Vendors', '7'),
    kpi('product_categories', 'Product Categories', '5'), kpi('product_sync_updates', 'Product Sync Updates', null),
  ],
  byCategory: [{ label: 'Nail Care', count: 2 }, { label: 'Gel Polish', count: 3 }],
  byBrand: [{ label: 'CND', count: 3 }, { label: 'OPI', count: 1 }],
  retailPriceDistribution: [{ key: '5_10', label: '$5–$10', count: 2 }, { key: '10_20', label: '$10–$20', count: 3 }],
  duplicateDetection: { duplicateSkus: 1, duplicateBarcodes: 1, potentialMatches: 4 },
  atAGlance: { barcodeCoveragePct: 75, duplicateRatePct: 25, retailConfiguredPct: 100, importSuccessRate: null },
  counts: { total: 8, live: 7, retired: 1, tenants: 3, withBarcode: 6, withRetail: 8 },
  directory: [
    { id: 'PRD-1001', name: 'Cuticle Oil', brandName: 'CND', sku: 'CND-CO-15', barcode: '0631234567890', categoryName: 'Nail Care', costCents: 320, retailPriceCents: 899, taxCategory: null, unitType: 'bottle', vendorName: 'CND Supply', tenantId: 't1', tenantName: 'Glamour Studio', activeTenants: 2, importStatus: 'NotConnected', importStatusAvailable: false, duplicateFlag: true, status: 'Active' },
    { id: 'PRD-1008', name: 'Retired Acetone', brandName: 'SuperNail', sku: 'SN-ACE-16', barcode: null, categoryName: 'Liquids', costCents: 210, retailPriceCents: 649, taxCategory: null, unitType: 'bottle', vendorName: 'SuperNail', tenantId: 't3', tenantName: 'The Hair Lounge', activeTenants: 1, importStatus: 'NotConnected', importStatusAvailable: false, duplicateFlag: false, status: 'Retired' },
  ],
  directoryTotal: 8, pagination: { page: 1, pageSize: 10, totalItems: 8, totalPages: 1 },
});

describe('ProductCatalogScreen (master-catalog oversight)', () => {
  beforeEach(() => {
    productCatalog.mockReset(); productCatalog.mockResolvedValue(overview());
    productImports.mockReset(); productImports.mockResolvedValue([{ id: 'PIMP-0001', source: 'csv', filename: 'vendor.csv', status: 'ready', totalRows: 3, validRows: 2, invalidRows: 1, importedRows: 0, failedRows: 0, errorSummary: '1 row error(s)', createdAt: '2026-05-01T00:00:00Z', approvedAt: null, completedAt: null }]);
    productImportErrors.mockReset(); productImportErrors.mockResolvedValue([{ id: 'PIERR-0001', jobId: 'PIMP-0001', rowNumber: 2, errorType: 'invalid_price', productName: 'BadPrice', sourceFile: 'vendor.csv', status: 'open', retryable: true, createdAt: '2026-05-01T00:00:00Z' }]);
  });

  it('renders header, 12 KPIs (with NotConnected), boundary, and 10 actions', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    expect(await screen.findByText('Product Catalog', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('Total Products')).toBeInTheDocument();
    expect(screen.getByText('Taxable Products')).toBeInTheDocument(); // NotConnected KPI still labelled
    expect(screen.getAllByText('NotConnected').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Boundary')).toBeInTheDocument();
    expect(screen.getByText('Create Master Product Records')).toBeInTheDocument();
    expect(screen.getByText('Review Product Sales Across the Platform')).toBeInTheDocument();
  });

  it('shows the master product library with reference columns and duplicate flag', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    expect(await screen.findByText('Cuticle Oil')).toBeInTheDocument();
    expect(screen.getByText('CND-CO-15')).toBeInTheDocument();
    expect(screen.getByText('UPC / Barcode')).toBeInTheDocument();
    expect(screen.getByText('$8.99')).toBeInTheDocument(); // retail money
    expect(screen.getByText('Yes')).toBeInTheDocument(); // duplicate flag on row 1
    expect(screen.getByText('Retired')).toBeInTheDocument(); // status pill on row 2
  });

  it('detect-duplicates action switches to the Duplicate Review tab (server duplicateOnly)', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Detect Duplicate SKUs'));
    await waitFor(() => expect(productCatalog).toHaveBeenCalledWith(expect.objectContaining({ duplicateOnly: true })));
  });

  it('searches server-side', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    await screen.findByText('Cuticle Oil');
    fireEvent.change(screen.getByPlaceholderText(/Search by product name/), { target: { value: 'oil' } });
    await waitFor(() => expect(productCatalog).toHaveBeenCalledWith(expect.objectContaining({ search: 'oil' })));
  });

  it('filters by category client-side', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    await screen.findByText('Cuticle Oil');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Nail Care' } });
    expect(screen.getByText('Cuticle Oil')).toBeInTheDocument();
    expect(screen.queryByText('Retired Acetone')).not.toBeInTheDocument();
  });

  it('shows the Import Error Queue and Recent Import Activity from the pipeline', async () => {
    render(<MemoryRouter><ProductCatalogScreen /></MemoryRouter>);
    await screen.findByText('Cuticle Oil');
    expect(screen.getByText('Import Error Queue')).toBeInTheDocument();
    expect(screen.getByText('Invalid Price')).toBeInTheDocument();
    expect(screen.getByText('Recent Product Import Activity')).toBeInTheDocument();
    expect(screen.getAllByText(/vendor.csv/).length).toBeGreaterThanOrEqual(1);
  });
});
