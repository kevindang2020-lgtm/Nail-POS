import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posMultiLocationApi', () => ({ posMultiLocationApi: { state: stateMock } }));
vi.mock('../components/FinanceKit', () => ({
  RangeCalendar: ({ onApply }: { onApply: (r: { from: string; to: string }) => void }) => <button type="button" onClick={() => onApply({ from: '2026-10-01', to: '2026-10-31' })}>apply-range</button>,
}));
import { POSMultiLocationScreen } from './POSMultiLocationScreen';
describe('Multi-location custom dates', () => {
  it('asks the comparison for the chosen days and shows the window', async () => {
    stateMock.mockResolvedValue({ branches: [], period: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', comparisonFrom: '2026-08-31T00:00:00.000Z', comparisonTo: '2026-10-01T00:00:00.000Z' } });
    render(<POSMultiLocationScreen />);
    fireEvent.click(await screen.findByTestId('ml-custom'));
    fireEvent.click(screen.getByText('apply-range'));
    await waitFor(() => expect(stateMock).toHaveBeenLastCalledWith(expect.anything(), { from: '2026-10-01', to: '2026-10-31' }));
    expect(await screen.findByTestId('ml-window')).toHaveTextContent(/Oct 31, 2026/);
  });
});
