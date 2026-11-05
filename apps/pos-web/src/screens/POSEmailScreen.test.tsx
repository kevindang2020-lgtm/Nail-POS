import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { getMock, updateMock } = vi.hoisted(() => ({ getMock: vi.fn(), updateMock: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: getMock, updateCategory: updateMock } }));
import { POSEmailScreen } from './POSEmailScreen';
beforeEach(() => { getMock.mockReset(); updateMock.mockReset(); });

describe('POSEmailScreen', () => {
  it('loads and reflects email settings', async () => {
    getMock.mockResolvedValue({ senderBrand: 'Glow Bar', emailConfirmation: true, receiptDelivery: ['SMS', 'Email'] });
    render(<POSEmailScreen />);
    expect(await screen.findByDisplayValue('Glow Bar')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);  // email confirmations
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);  // email receipts (Email in receiptDelivery)
  });
  it('saves email fields, preserving non-email receipt channels', async () => {
    getMock.mockResolvedValue({ senderBrand: 'Glow Bar', emailConfirmation: false, receiptDelivery: ['SMS'] });
    updateMock.mockResolvedValue({ senderBrand: 'Glow Bar', emailConfirmation: true, receiptDelivery: ['SMS', 'Email'] });
    render(<POSEmailScreen />);
    await screen.findByDisplayValue('Glow Bar');
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]);  // enable email confirmations
    fireEvent.click(boxes[1]);  // enable email receipts
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const [cat, body] = updateMock.mock.calls[0];
    expect(cat).toBe('notifications-reminders');
    expect(body.emailConfirmation).toBe(true);
    expect(body.receiptDelivery).toContain('SMS');   // preserved
    expect(body.receiptDelivery).toContain('Email');
  });
});
