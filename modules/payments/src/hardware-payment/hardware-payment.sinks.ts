// hardware-payment.sinks.ts — DB-backed audit (§17) + alert (§18) sinks. Reuse existing surfaces:
//   • alerts → owner_alerts (the Super-Admin/owner alert dashboard), category 'hardware_payment'
//   • audit  → owner_audit_log (tenant audit trail), entity_type 'hardware_payment'
// Both swallow errors so logging never blocks a charge/reconcile. Platform-level ('*') audits are skipped here since the
// owner tables are tenant-scoped (tenant_id uuid NOT NULL).
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AlertSink, AlertInput, AuditSink, AuditInput } from './hardware-payment.dto';

const isUuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

export class DbAlertSink implements AlertSink {
  constructor(private readonly db: Kysely<DB>) {}
  async raise(a: AlertInput): Promise<void> {
    if (!isUuid(a.tenantId)) return;
    try {
      await this.db.insertInto('owner_alerts').values({
        tenant_id: a.tenantId, branch_id: null, category: 'hardware_payment', severity: a.severity, status: 'new',
        title: a.code, body: a.message, metadata: JSON.stringify(a.meta ?? {}),
      } as any).execute();
    } catch { /* alerts never block */ }
  }
}

export class DbAuditSink implements AuditSink {
  constructor(private readonly db: Kysely<DB>) {}
  async log(a: AuditInput): Promise<void> {
    if (!isUuid(a.tenantId)) return; // platform-level global-settings audits are not tenant rows
    try {
      await this.db.insertInto('owner_audit_log').values({
        tenant_id: a.tenantId, branch_id: null, user_id: isUuid(a.userId) ? a.userId : null, role: a.role ?? null,
        action: a.action, entity_type: 'hardware_payment', entity_id: null,
        metadata: JSON.stringify({ oldValue: a.oldValue ?? null, newValue: a.newValue ?? null, ipAddress: a.ipAddress ?? null, deviceInfo: a.deviceInfo ?? null }),
      } as any).execute();
    } catch { /* audit never blocks */ }
  }
}
