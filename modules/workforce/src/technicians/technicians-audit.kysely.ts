// technicians-audit.kysely.ts — the POS Technicians audit trail, actually written down.
//
// == WHAT THE AUDIT FOUND ==================================================================================
//
// `TechniciansService.log()` pushes onto `private audit: POSTechniciansAuditLog[]` — an array in memory, read
// by nothing but the tests. Hiring a technician, suspending one, changing a commission rate, granting payment
// permissions: every one of those calls `this.log(...)`, every one of them returns 200, and NONE of them has
// ever reached the database.
//
// That is the same class of bug as `KyselyLoginAttemptSink` (see login-attempt-sink.ts): a security surface
// that reports nothing and looks exactly like a security surface with nothing to report. The Super Admin audit
// screens query `audit_logs` and have been showing a truthful-looking zero for every technician action ever
// taken on this platform.
//
// So the in-memory array STAYS — the Nest-free `technicians-core.spec.ts` harness reads it, and deleting a
// test's fixture to make a feature look done is not something this codebase does — and it now writes through
// to the real table beside it.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { POSTechniciansAuditLog } from './technicians.service';

export interface TechniciansAuditSink {
  record(entry: POSTechniciansAuditLog): Promise<void>;
}

const isUuid = (v: string | null | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export class KyselyTechniciansAuditSink implements TechniciansAuditSink {
  constructor(private readonly db: AppDatabase) {}

  async record(e: POSTechniciansAuditLog): Promise<void> {
    if (!this.db) return;
    try {
      // before/after/metadata collapse into metadata_json — audit_logs has one JSONB column, and inventing a
      // second table for the same event would fragment the trail the Super Admin screens already read.
      const meta = JSON.stringify({
        ...(e.metadata ?? {}),
        ...(e.before ? { before: e.before } : {}),
        ...(e.after ? { after: e.after } : {}),
      });
      await sql`
        insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        values (${isUuid(e.tenantId) ? e.tenantId : null}, ${isUuid(e.branchId) ? e.branchId : null},
                ${isUuid(e.userId) ? e.userId : null}, ${e.role || null}, ${e.actionType}, ${e.entityType},
                ${e.entityId ?? null}, ${meta}::jsonb)`.execute(this.db);
    } catch {
      // Auditing must never block the action being audited. Swallowed — but never faked as written, and the
      // insert above is checked against the real schema by sql-schema-consistency.vitest.spec.ts and by
      // technicians-audit.pgtest.vitest.spec.ts, which asserts the row actually LANDS.
    }
  }
}

/** No database (dev / in-memory repo). Records nothing, and says so by doing nothing — never by pretending. */
export class NoopTechniciansAuditSink implements TechniciansAuditSink {
  async record(): Promise<void> { /* intentionally empty */ }
}
