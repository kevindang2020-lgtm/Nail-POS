// modules/audit — the audit domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { AuditPartitionModule } from './audit-partition.service';
export { AuditModule } from './audit.module';
export * from './audit.dto';
export { InMemoryAuditRepository, type PlatformAuditInput } from './audit.repository';   // used by the API today
export { auditSinkFor, RecordingAuditSink, type AuditSink, type AuditEntry } from './audit-sink';   // the one-object port domain services take
export { AuditService } from './audit.service';
export { KyselyAuditRepository } from './audit.kysely.repository';   // used by the API today
export { recordAuditStrict, recordPlatformAuditStrict, type StrictAuditActor, type StrictAuditInput, type StrictPlatformAuditActor, type StrictPlatformAuditInput } from './audit-strict';   // Finish the Five: fail-closed audit rows (review transitions, report exports)
