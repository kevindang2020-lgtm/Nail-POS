import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PushToTenantsModal } from './ProductCatalogPush';

const listMasterProducts = vi.fn();
const distributeProduct = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  listMasterProducts: (...a: any[]) => listMasterProducts(...a),
  distributeProduct: (...a: any[]) => distributeProduct(...a),
} }));

const tenants = [{ id: 't1', name: 'Glamour Studio' }, { id: 't2', name: 'Luxe Salon & Spa' }];

describe('PushToTenantsModal', () => {
  beforeEach(() => {
    listMasterProducts.mockReset(); listMasterProducts.mockResolvedValue([{ id: 'PM-0001', name: 'Cuticle Oil', sku: 'CND-CO-15', status: 'draft' }]);
    distributeProduct.mockReset(); distributeProduct.mockResolvedValue({ ok: true, summary: { total: 2, created: 1, skippedExisting: 1, alreadyDistributed: 0 }, results: [{ tenantId: 't1', action: 'create', tenantProductId: 'TPROD-0001' }, { tenantId: 't2', action: 'skip_existing' }] });
  });

  it('validates that a tenant is selected before distributing', async () => {
    render(<PushToTenantsModal tenantOptions={tenants} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText(/Cuticle Oil/); // master loaded
    fireEvent.click(screen.getByText('Distribute'));
    expect(await screen.findByText(/Select at least one tenant/)).toBeInTheDocument();
    expect(distributeProduct).not.toHaveBeenCalled();
  });

  it('distributes to selected tenants and shows per-tenant outcomes', async () => {
    render(<PushToTenantsModal tenantOptions={tenants} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText(/Cuticle Oil/);
    fireEvent.click(screen.getByLabelText('Glamour Studio'));
    fireEvent.click(screen.getByLabelText('Luxe Salon & Spa'));
    fireEvent.click(screen.getByText('Distribute'));
    await waitFor(() => expect(distributeProduct).toHaveBeenCalledWith(expect.objectContaining({ masterProductId: 'PM-0001', tenantIds: ['t1', 't2'], skipExisting: true })));
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(screen.getByText(/Skipped/)).toBeInTheDocument();
  });

  it('prompts to create a master product when none exist', async () => {
    listMasterProducts.mockResolvedValue([]);
    render(<PushToTenantsModal tenantOptions={tenants} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/No master products yet/)).toBeInTheDocument();
  });
});
