import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { center } = vi.hoisted(() => ({ center: { summary: vi.fn(), products: vi.fn(), activity: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAiInventoryApi', () => ({ posAiInventoryApi: { center, lowStock: vi.fn(), reorder: vi.fn(), slowMoving: vi.fn() } }));
import { POSAiInventoryScreen } from './POSAiInventoryScreen';

describe('AI Inventory permissions', () => {
  it('shows a permission message on 403 (never zeros)', async () => {
    for (const f of Object.values(center)) f.mockRejectedValue({ status: 403 });
    render(<POSAiInventoryScreen />);
    expect((await screen.findAllByText(/cannot see inventory/i)).length).toBeGreaterThan(0);
  });
});
