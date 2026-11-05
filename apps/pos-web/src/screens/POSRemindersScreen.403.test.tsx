import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/posRemindersApi', () => ({ posRemindersApi: { get: getMock, update: vi.fn() } }));
import { POSRemindersScreen } from './POSRemindersScreen';
describe('Reminders permissions', () => {
  it('shows a permission message on 403', async () => { getMock.mockRejectedValue({ status: 403 }); render(<POSRemindersScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
