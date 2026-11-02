// login-attempt-sink.ts — records every login attempt (success and failure) into the EXISTING `login_attempts`
// table (migration 001).
//
// Why this exists: the Super Admin Security dashboard already READS this table — failed logins today, failed
// logins over the last 7 days, per-user failure counts, and a retention policy all query it — but nothing in
// the codebase ever WROTE to it. Those metrics were therefore permanently zero, which is worse than having no
// dashboard at all: it reports "no failed logins" no matter how many there are.
//
// Privacy: the identifier is stored as supplied for security forensics (it is the account being attempted, and
// the Super Admin security screens key off it), but the PASSWORD is never touched, and the tenant id is only
// recorded when the salon code actually resolved to a tenant — a failed attempt against an unknown store code
// records no tenant, so this can't be used to enumerate tenants.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { safeInet } from '@aipowersalon/database';   // INET is a trap — see the helper. Losing the IP is fine; losing the ATTEMPT is not.

export interface LoginAttemptRecord {
  tenantId: string | null;      // null when the store code did not resolve
  identifier: string;           // email/phone as supplied (never the password)
  ip: string | null;
  success: boolean;
  reason: string;               // the login outcome, e.g. SUCCESS | INVALID_CREDENTIALS | BRANCH_INACTIVE
}

export interface LoginAttemptSink {
  record(a: LoginAttemptRecord): Promise<void>;
}

const isUuid = (v: string | null | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);


export class KyselyLoginAttemptSink implements LoginAttemptSink {
  constructor(private readonly db: AppDatabase) {}
  async record(a: LoginAttemptRecord): Promise<void> {
    if (!this.db) return;
    try {
      await sql`
        insert into login_attempts (tenant_id, identifier, ip_address, success, reason)
        values (${isUuid(a.tenantId) ? a.tenantId : null}, ${a.identifier || ''}, ${safeInet(a.ip)},
                ${a.success}, ${a.reason || ''})`.execute(this.db);
    } catch {
      // Auditing must never block a sign-in. A failure here is swallowed, but it is also never faked as success.
    }
  }
}

/** In-memory sink for tests / no-DB dev. */
export class InMemoryLoginAttemptSink implements LoginAttemptSink {
  attempts: LoginAttemptRecord[] = [];
  async record(a: LoginAttemptRecord): Promise<void> { this.attempts.push(a); }
}
