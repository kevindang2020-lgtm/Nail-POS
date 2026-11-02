// @aipowersalon/events — Constitution 13 §75: the domain event envelope and registry, the consumer helpers and the
// OutboxWriter (Constitution 8 §18–19: the event row commits with the business rows or neither does). Framework-free
// at the root; the Nest module that provides OutboxWriter is behind './nest' (§113). The publisher, transport,
// replay, retention and Super Admin event operations are the API's (later apps/workers), built on this.
export * from './event-consumer';   // moved from apps/api/src/events/event-consumer.ts (Constitution 13 §219)
export * from './event-contract';   // moved from apps/api/src/events/event-contract.ts (Constitution 13 §219)
export * from './outbox-writer';   // moved from apps/api/src/events/outbox-writer.ts (Constitution 13 §219)
