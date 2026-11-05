import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasterRecordsModal } from './ProductCatalogMasterRecords';

const listMasterProducts = vi.fn();
const retireMasterProduct = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  listMasterProducts: (...a: any[]) => listMasterProducts(...a),
  retireMasterProduct: (...a: any[]) => retireMasterProduct(...a),
} }));

const master = (over: any = {}) => ({ id: 'PM-0001', name: 'Cuticle Oil', sku: 'CND-CO-15', normalizedSku: 'CND-CO-15', status: 'draft', brandName: 'CND', categoryName: 'Nail Care', ...over });

describe('MasterRecordsModal', () => {
  beforeEach(() => {
    listMasterProducts.mockReset(); listMasterProducts.mockResolvedValue([master()]);
    retireMasterProduct.mockReset(); retireMasterProduct.mockResolvedValue({ ok: true, product: { id: 'PM-0001', status: 'retired' } });
  });

  it('lists master records with status and a retire action', async () => {
    render(<MasterRecordsModal onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Cuticle Oil')).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(1); // status pill + filter option
    expect(screen.getByText('Retire')).toBeInTheDocument();
  });

  it('retires a record with a reason and refreshes', async () => {
    const onChanged = vi.fn();
    render(<MasterRecordsModal onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Retire'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'discontinued by brand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(retireMasterProduct).toHaveBeenCalledWith('PM-0001', 'discontinued by brand'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringMatching(/retired/)));
    await waitFor(() => expect(listMasterProducts).toHaveBeenCalledTimes(2)); // initial + reload
  });

  it('does not retire when the inline ask is cancelled', async () => {
    render(<MasterRecordsModal onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Retire'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));       // inline bar dismissed — nothing happens
    expect(retireMasterProduct).not.toHaveBeenCalled();
  });

  it('filters by status', async () => {
    render(<MasterRecordsModal onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Cuticle Oil');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'retired' } });
    await waitFor(() => expect(listMasterProducts).toHaveBeenCalledWith({ status: 'retired' }));
  });

  it('shows empty state when there are no records', async () => {
    listMasterProducts.mockResolvedValue([]);
    render(<MasterRecordsModal onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(/No master records/)).toBeInTheDocument();
  });
});
