import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../api/posMessageTemplatesApi', () => ({ posMessageTemplatesApi: { list: listMock, upsert: vi.fn() } }));
import { POSMessageTemplatesScreen } from './POSMessageTemplatesScreen';
describe('Templates permissions', () => {
  it('shows a permission message on 403', async () => { listMock.mockRejectedValue({ status: 403 }); render(<POSMessageTemplatesScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
