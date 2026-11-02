// realtime-core.ts — Constitution 9 Phase 15 (§174): the POS core now IS the shared package. This shim keeps the
// existing imports (`./realtime-core`) working; the registry lives in @aipowersalon/realtime-client and is held
// byte-identical to the server's by the package's parity test — the local copy had drifted 27 events behind.
export * from '@aipowersalon/realtime-client/core';
