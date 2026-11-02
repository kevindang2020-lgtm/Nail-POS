// network/ — BUILD_PLAN Phase 13 (Constitution 6 §11–16, §28–32): the one mobile transport, NetworkState and the
// native realtime stream URL (ticket). Re-exported from the package root.
export { createTransport, clientPlatform, newClientRequestId, TIMEOUTS, type Transport, type TransportConfig, type RequestOptions, type TimeoutClass, type MobileAppId, type TransportError } from './transport';
export { networkState, resetNetworkState, DEGRADED_AFTER, type NetworkStatus, type NetworkSnapshot } from './network-state';
export { useNetworkState } from './react';
export { realtimeStreamUrl, bindRealtimeToSession, signalSignedOut, SIGNED_OUT_EVENT } from './realtime';
