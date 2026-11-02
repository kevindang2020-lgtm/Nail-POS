// react.ts — the React face of NetworkState (Constitution 6 §16): `useNetworkState()` re-renders on every change.
import { useSyncExternalStore } from 'react';
import { networkState, type NetworkSnapshot } from './network-state';

export function useNetworkState(): NetworkSnapshot {
  return useSyncExternalStore(networkState.subscribe, () => networkState.get(), () => networkState.get());
}
