import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { recentMock } = vi.hoisted(() => ({ recentMock: vi.fn() }));
vi.mock('../api/posNotificationsApi', () => ({ posNotificationsApi: { recent: recentMock, optOuts: vi.fn().mockResolvedValue({ items: [] }), optIn: vi.fn(), optOut: vi.fn(), send: vi.fn() } }));
import { POSNotificationsScreen } from './POSNotificationsScreen';
describe('Notifications permissions', () => {
  it('shows a permission message on 403', async () => { recentMock.mockRejectedValue({ status: 403 }); render(<POSNotificationsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
