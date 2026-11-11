// extras (Nov 11 2026): the forecasting tab is kept in the address
import { describe, it, expect, vi } from 'vitest';
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: {} }));
import { readTab } from './POSAiForecastingScreen';
describe('forecast tab in the URL', () => {
  it('reads a known tab, ignores anything else', () => {
    expect(readTab('?tab=revenue')).toBe('revenue');
    expect(readTab('?tab=noshow&x=1')).toBe('noshow');
    expect(readTab('?tab=evil')).toBe('appointments');
    expect(readTab('')).toBe('appointments');
  });
});
