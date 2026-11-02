import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock('../api/posAiInventoryApi', () => ({ posAiInventoryApi: { context: contextMock, lowStock: vi.fn(), reorder: vi.fn(), slowMoving: vi.fn() } }));
import { POSAiInventoryScreen } from './POSAiInventoryScreen';

describe('AI Inventory permissions', () => {
  it('shows a permission message on 403', async () => {
    contextMock.mockRejectedValue({ status: 403 });
    render(<POSAiInventoryScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
