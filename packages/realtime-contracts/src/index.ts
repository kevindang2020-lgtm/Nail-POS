// @aipowersalon/realtime-contracts — Constitution 13 §77: client-safe realtime event contracts, kept separate from
// the internal domain-event contracts (packages/events). ONE registry: apps/api emits from it, packages/realtime-client
// routes from it, and the parity copy the client package used to carry is gone.
//
// Dependency-free and browser-safe (§111): nothing here may import from outside the package. The emitter PORT
// (REALTIME token + RealtimeEmitter interface, in ./port) is server-side by use but carries no runtime dependency —
// a domain module publishes through the port; the API's InProcessEmitter/Redis emitter implement it (§113 kept simple:
// one entry, no server-only code).
export * from './realtime-core';   // moved from apps/api/src/realtime/realtime-core.ts (Constitution 13 §219)
export * from './port';
export * from './settings-changed';   // moved from apps/api/src/realtime/settings-changed.ts (Constitution 13 §219)
