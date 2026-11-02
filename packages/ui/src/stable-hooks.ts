import { useCallback, useRef } from 'react';

// Hook-dependency helpers (lint ratchet, react-hooks/exhaustive-deps → 0, Oct 27 2026).
//
// useEventCallback — a function whose identity never changes but which always runs the LATEST closure. Effects that
// call a screen's `load()` list it as a dependency without re-firing when the screen re-renders: the effect keeps
// firing on exactly the dependencies it fired on before (same pattern as useEscapeKey's ref; React's useEffectEvent).
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

// useStableValue — the same object identity for as long as the value is structurally equal (JSON), so a query object
// rebuilt on every render can be a hook dependency without re-running the effect. Replaces the `key = JSON.stringify(x)`
// + missing-dependency pattern.
export function useStableValue<T>(value: T): T {
  const key = JSON.stringify(value);
  const ref = useRef<{ key: string; value: T }>({ key, value });
  if (ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}
