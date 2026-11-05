import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { useEventCallback, useStableValue } from './stable-hooks';

describe('useEventCallback', () => {
  it('keeps one identity across renders and calls the latest closure', () => {
    const { result, rerender } = renderHook(({ n }) => useEventCallback(() => n * 2), { initialProps: { n: 1 } });
    const first = result.current;
    rerender({ n: 5 });
    expect(result.current).toBe(first);
    expect(result.current()).toBe(10);
  });
  it('does not re-fire an effect that lists it as a dependency', () => {
    let runs = 0;
    const { rerender } = renderHook(({ n }) => {
      const load = useEventCallback(() => n);
      useEffect(() => { runs++; load(); }, [load]);
    }, { initialProps: { n: 1 } });
    rerender({ n: 2 }); rerender({ n: 3 });
    expect(runs).toBe(1);
  });
});

describe('useStableValue', () => {
  it('returns the same identity while the value is structurally equal, a new one when it changes', () => {
    const { result, rerender } = renderHook(({ q }) => useStableValue(q), { initialProps: { q: { a: 1 } as Record<string, number> } });
    const first = result.current;
    rerender({ q: { a: 1 } });
    expect(result.current).toBe(first);
    rerender({ q: { a: 2 } });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual({ a: 2 });
  });
});
