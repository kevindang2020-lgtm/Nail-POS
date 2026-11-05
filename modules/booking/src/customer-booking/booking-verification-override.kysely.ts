// booking-verification-override.kysely.ts — the driver behind OverrideStore.
//
// All the SQL lives here. Note what is NOT here: any statement that writes `booking_verified_phones`.
//
// That is deliberate and it is the strongest safeguard in the feature. The override authorises ONE booking; it must
// grant NO trust window, because otherwise a single manipulated manager hands an attacker a verified phone for 24
// hours and the bypass stops being a bypass and starts being a key. Making that impossible in the DRIVER -- rather
// than remembering not to do it in the service -- means it cannot be reintroduced by someone adding a "helpful"
// line later.
import { canMoveToSql } from '@aipowersalon/database';
import { BOOKING_VERIFICATION_SESSION } from './booking-hold-machine';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { OverrideStore, OpenVerification } from './booking-verification-override.service';
import { createDomainEvent, type OutboxWriter } from '@aipowersalon/events';
import { bookingVerificationAlert } from './booking-verification.kysely';

export class KyselyOverrideStore implements OverrideStore {
  constructor(private readonly db: AppDatabase | null, private readonly outbox?: OutboxWriter) {}

  async bypassBlocked(tenantId: string): Promise<boolean> {
    if (!this.db) return false;
    // Phase 4 (audit): this read blocked_for_tenant — the switch that turns the whole MODULE off — so "forbid manual
    // bypass" could not be set on its own. It has its own column now.
    const r: any = await sql`
      SELECT bypass_blocked FROM booking_verification_platform_policy
      WHERE tenant_id = ${tenantId} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return !!r.rows?.[0]?.bypass_blocked;
  }

  async markSessionOverridden(tenantId: string, branchId: string | null, verificationId: string, by: { userId: string; reason: string; contactMethod: string }): Promise<{ id: string } | null> {
    if (!this.db) return null;
    // The explicit override columns (the audit found 'staff_override:' written into failure_reason with status
    // 'verified' — indistinguishable from an SMS proof). verified_at stays NULL: the proof's time is override_at, and
    // the device-trust and history readers ignore overridden rows.
    const r: any = await (this.db as any).transaction().execute(async (trx: any) => {
      const row: any = (await sql`
        UPDATE booking_verification_sessions
        SET status = 'verified', override_at = now(), override_by_user_id = ${UUID.test(by.userId) ? by.userId : null},
            override_reason = ${by.reason.slice(0, 500)}, override_contact_method = ${by.contactMethod}, updated_at = now()
        WHERE id = ${verificationId} AND tenant_id = ${tenantId}
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
          AND status IN ('pending', 'sent', 'locked') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'verified')} AND consumed_at IS NULL
        RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0];
      if (!row) return null;
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType: 'booking.phone_verification_overridden' as any, tenantId: String(row.tenant_id), branchId: row.branch_id ? String(row.branch_id) : undefined,
          aggregateType: 'booking_verification', aggregateId: String(row.id), actorType: 'user', actorId: by.userId,
          payload: { sessionId: String(row.id), channel: row.channel, maskedPhone: row.phone_mask, contactMethod: by.contactMethod },
        } as any));
      }
      return row;
    });
    if (!r) return null;
    // After the commit: an alert never blocks (or aborts) what it describes.
    // The owner hears about every override (the spec: a bypass nobody can count is a bypass nobody can govern).
    await bookingVerificationAlert(this.db, { tenantId: String(r.tenant_id), branchId: r.branch_id, kind: `override:${r.id}`, severity: 'info', audience: 'owner',
      title: 'A booking was approved without a phone code',
      body: `A manager approved a ${String(r.channel).replace('_', ' ')} booking for ${r.phone_mask} without a verification code (${by.contactMethod.replace(/_/g, ' ')}). Reason: ${by.reason.slice(0, 200)}`,
      metadata: { sessionId: String(r.id), contactMethod: by.contactMethod } });
    return { id: String(r.id) };
  }

  async listOpen(tenantId: string, branchId: string | null): Promise<OpenVerification[]> {
    if (!this.db) return [];
    const r: any = await sql`
      SELECT s.id, s.channel, s.phone_mask, s.status, s.attempt_count, s.created_at, s.expires_at, h.start_time, h.technician_id
      FROM booking_verification_sessions s
      LEFT JOIN booking_holds h ON h.id = s.booking_hold_id
      WHERE s.tenant_id = ${tenantId} AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId}::uuid)
        AND s.status IN ('pending', 'sent', 'locked') AND s.consumed_at IS NULL AND s.expires_at > now() - interval '30 minutes'
      ORDER BY s.created_at DESC LIMIT 100`.execute(this.db as any).catch(() => ({ rows: [] }));
    const iso = (d: any) => (d ? new Date(d).toISOString() : null);
    return (r.rows ?? []).map((x: any) => ({
      id: String(x.id), channel: String(x.channel), maskedPhone: String(x.phone_mask ?? ''), status: String(x.status), attempts: Number(x.attempt_count ?? 0),
      createdAt: iso(x.created_at)!, expiresAt: iso(x.expires_at)!, slotStartsAt: iso(x.start_time), technicianId: x.technician_id ? String(x.technician_id) : null,
    }));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
