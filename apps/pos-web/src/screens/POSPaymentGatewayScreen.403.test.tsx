import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../api/posPaymentGatewayApi', () => ({ posPaymentGatewayApi: { status: statusMock } }));
import { POSPaymentGatewayScreen } from './POSPaymentGatewayScreen';
describe('Payment gateway permissions', () => {
  it('shows a permission message on 403', async () => { statusMock.mockRejectedValue({ status: 403 }); render(<POSPaymentGatewayScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
