import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { isValidUpc, AddProductModal } from './ProductCatalogAddProduct';

const createMasterProduct = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { createMasterProduct: (...a: any[]) => createMasterProduct(...a) } }));

describe('isValidUpc', () => {
  it('validates UPC-A / EAN-13 and rejects bad codes', () => {
    expect(isValidUpc('036000291452')).toBe(true);
    expect(isValidUpc('036000291453')).toBe(false);
    expect(isValidUpc('4006381333931')).toBe(true);
    expect(isValidUpc('123')).toBe(false);
  });
});

describe('AddProductModal', () => {
  beforeEach(() => { createMasterProduct.mockReset(); createMasterProduct.mockResolvedValue({ ok: true, product: { id: 'PM-0001', name: 'Cuticle Oil', status: 'draft' } }); });

  const fill = () => {
    fireEvent.change(screen.getByLabelText('Product name *'), { target: { value: 'Cuticle Oil' } });
    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: 'Nail Care' } });
  };

  it('blocks submit with client validation errors (no API call)', () => {
    render(<AddProductModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Create master product'));
    expect(screen.getByText(/Product name is required/)).toBeInTheDocument();
    expect(screen.getByText(/Category is required/)).toBeInTheDocument();
    expect(createMasterProduct).not.toHaveBeenCalled();
  });

  it('rejects an invalid UPC before hitting the API', () => {
    render(<AddProductModal onClose={() => {}} onCreated={() => {}} />);
    fill();
    fireEvent.change(screen.getByLabelText('UPC / EAN'), { target: { value: '036000291453' } });
    fireEvent.click(screen.getByText('Create master product'));
    expect(screen.getByText(/UPC\/EAN check digit is invalid/)).toBeInTheDocument();
    expect(createMasterProduct).not.toHaveBeenCalled();
  });

  it('converts dollars to cents and creates', async () => {
    const onCreated = vi.fn();
    render(<AddProductModal onClose={() => {}} onCreated={onCreated} />);
    fill();
    fireEvent.change(screen.getByLabelText('Cost ($)'), { target: { value: '3.20' } });
    fireEvent.change(screen.getByLabelText('Suggested retail ($)'), { target: { value: '8.99' } });
    fireEvent.click(screen.getByText('Create master product'));
    await waitFor(() => expect(createMasterProduct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cuticle Oil', categoryName: 'Nail Care', costCents: 320, suggestedRetailCents: 899, confirmDuplicates: false })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Cuticle Oil', 'PM-0001'));
  });

  it('shows duplicate candidates then creates on confirm', async () => {
    createMasterProduct.mockResolvedValueOnce({ ok: false, requiresConfirmation: true, candidates: [{ id: 'PM-9', name: 'Cuticle Oil', reason: 'exact_sku', confidence: 1 }] });
    const onCreated = vi.fn();
    render(<AddProductModal onClose={() => {}} onCreated={onCreated} />);
    fill();
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'CND-CO-15' } });
    fireEvent.click(screen.getByText('Create master product'));
    expect(await screen.findByText(/Possible duplicates found/)).toBeInTheDocument();
    expect(screen.getByText(/same SKU/)).toBeInTheDocument();
    createMasterProduct.mockResolvedValueOnce({ ok: true, product: { id: 'PM-0002', name: 'Cuticle Oil', status: 'draft' } });
    fireEvent.click(screen.getByText('Create anyway'));
    await waitFor(() => expect(createMasterProduct).toHaveBeenLastCalledWith(expect.objectContaining({ confirmDuplicates: true })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Cuticle Oil', 'PM-0002'));
  });
});
