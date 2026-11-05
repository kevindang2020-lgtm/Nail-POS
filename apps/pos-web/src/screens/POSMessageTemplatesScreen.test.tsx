import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, upsertMock } = vi.hoisted(() => ({ listMock: vi.fn(), upsertMock: vi.fn() }));
vi.mock('../api/posMessageTemplatesApi', () => ({ posMessageTemplatesApi: { list: listMock, upsert: upsertMock } }));
import { POSMessageTemplatesScreen } from './POSMessageTemplatesScreen';
beforeEach(() => { listMock.mockReset(); upsertMock.mockReset(); });

const t = { id: 'tpl1', channel: 'sms' as const, name: 'Confirmation', body: 'Hi {name}, your visit is confirmed.' };

describe('POSMessageTemplatesScreen', () => {
  it('lists templates from the real store', async () => {
    listMock.mockResolvedValue([t]);
    render(<POSMessageTemplatesScreen />);
    expect(await screen.findByText('Confirmation')).toBeInTheDocument();
    expect(screen.getByText(/your visit is confirmed/)).toBeInTheDocument();
  });
  it('creates a new template via upsert', async () => {
    listMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue({ ...t, id: 'new1' });
    render(<POSMessageTemplatesScreen />);
    await screen.findByText(/No templates yet/);
    fireEvent.change(screen.getByPlaceholderText(/Appointment confirmation/), { target: { value: 'Welcome' } });
    fireEvent.change(screen.getByPlaceholderText(/reminder about your appointment/), { target: { value: 'Welcome to the salon!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(upsertMock).toHaveBeenCalled());
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ name: 'Welcome', body: 'Welcome to the salon!', channel: 'sms' });
  });
  it('edit pre-fills the form with the template id (update path)', async () => {
    listMock.mockResolvedValue([t]);
    upsertMock.mockResolvedValue(t);
    render(<POSMessageTemplatesScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit Template')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(upsertMock).toHaveBeenCalled());
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ id: 'tpl1' });
  });
});
