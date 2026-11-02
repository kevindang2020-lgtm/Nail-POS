// audit-sink.ts — the ONE-OBJECT audit port domain services take, and the adapter that turns it into AuditService.
//
// Why this exists (Phase 1 of BUILD_PLAN_2026-10-06): AuditService.record takes TWO arguments, (ctx, input). Seven
// services — booking-verification settings / override / oversight, the customer-phone update / identity-phone /
// settings services, and the scheduling optimizer's sink — declared their own `{ record(input: any) }` port, were wired
// with `audit as any`, and called `record({ tenantId, module, action, … })` with ONE object. `ctx.tenantId` was set,
// `input` was undefined, `buildAuditRow` threw on `input.actorName`, `record()` swallowed it and returned null. Every
// configuration change, manual override, emergency disable and phone change in those modules left NO audit row, and
// tsc could not see it because of the cast.
//
// The fix is a typed port + one adapter, so a service that takes an AuditSink cannot be handed a raw AuditService, and
// `audit as any` is a gate failure (tooling/ci/check-audit-wiring.mjs).
import type { AuditEventInput } from './audit.dto';
import type { AuditService } from './audit.service';

export interface AuditEntry extends AuditEventInput {
  tenantId?: string | null;   // absent → a PLATFORM event (Super Admin), written to audit_logs with tenant_id NULL
  branchId?: string | null;
  userId?: string | null;
  role?: string | null;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

// Writes a tenant-scoped entry through AuditService.record (audit_events, tenant_id NOT NULL) and a tenant-less one
// through recordPlatform (audit_logs). Never throws into the caller's path — the service already swallows.
export function auditSinkFor(service: Pick<AuditService, 'record' | 'recordPlatform'>): AuditSink {
  return {
    async record(entry: AuditEntry): Promise<void> {
      const { tenantId, branchId, userId, role, ...input } = entry;
      if (tenantId) {
        await service.record({ tenantId, branchId: branchId ?? null, userId: userId ?? null, role: role ?? null, ip: input.ip ?? null, device: input.device ?? null }, input);
        return;
      }
      await service.recordPlatform({ userId: userId ?? null, role: role ?? null, ...input });
    },
  };
}

// A sink that keeps what it was given — for tests that assert on the entries a service records.
export class RecordingAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> { this.entries.push(entry); }
}
