// booking-verification-usage.ts — the salon's own verification activity (BUILD_PLAN Phase 4: "usage / failures panel").
//
// Counts, a verify rate, per channel, and the recent failures — with MASKED numbers only. What an owner needs to see
// whether verification is working (codes going out, being delivered, being entered) and where it is not (locked
// sessions, delivery failures, verifications nobody finished), without a support ticket.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { BookingVerificationUsageView } from '@aipowersalon/api-contracts';
import { retentionCronEnabled, retentionDays } from './booking-verification-retention.scheduler';

export async function bookingVerificationUsage(db: AppDatabase | null, tenantId: string, branchId: string | null, days = 30): Promise<BookingVerificationUsageView> {
  // The per-attempt rows only live as long as the retention sweep keeps them (when it is on): the panel never claims a
  // longer window than it can count, so its heading ("Last N days") is always true.
  const d = Math.max(1, Math.min(retentionCronEnabled() ? retentionDays() : 90, Math.floor(days) || 30));
  const empty: BookingVerificationUsageView = { days: d, totals: { requested: 0, codesSent: 0, delivered: 0, verified: 0, overridden: 0, failed: 0, locked: 0, expired: 0, bookingsCompleted: 0 }, verifyRate: null, byChannel: [], recentFailures: [] };
  if (!db) return empty;
  const scope = sql`(${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid) AND created_at > now() - make_interval(days => ${d})`;
  const t: any = (await sql`
    SELECT count(*)::int AS requested,
           coalesce(sum(CASE WHEN last_sent_at IS NOT NULL THEN resend_count + 1 ELSE 0 END), 0)::int AS codes_sent,
           count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
           count(*) FILTER (WHERE status = 'verified' AND override_at IS NULL)::int AS verified,
           count(*) FILTER (WHERE override_at IS NOT NULL)::int AS overridden,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'locked')::int AS locked,
           count(*) FILTER (WHERE status = 'expired')::int AS expired,
           count(*) FILTER (WHERE consumed_appointment_id IS NOT NULL)::int AS completed
    FROM booking_verification_sessions WHERE tenant_id = ${tenantId} AND ${scope}`.execute(db).catch(() => ({ rows: [] }))).rows?.[0] ?? {};
  const ch: any[] = (await sql`
    SELECT channel, count(*)::int AS requested, count(*) FILTER (WHERE status = 'verified' AND override_at IS NULL)::int AS verified
    FROM booking_verification_sessions WHERE tenant_id = ${tenantId} AND ${scope} GROUP BY channel ORDER BY requested DESC`.execute(db).catch(() => ({ rows: [] }))).rows ?? [];
  const fails: any[] = (await sql`
    SELECT updated_at, channel, status, failure_reason, phone_mask FROM booking_verification_sessions
    WHERE tenant_id = ${tenantId} AND ${scope} AND (status IN ('failed', 'locked', 'expired') OR (failure_reason IS NOT NULL AND status <> 'verified'))
    ORDER BY updated_at DESC LIMIT 20`.execute(db).catch(() => ({ rows: [] }))).rows ?? [];
  const requested = Number(t.requested ?? 0), verified = Number(t.verified ?? 0);
  return {
    days: d,
    totals: {
      requested, codesSent: Number(t.codes_sent ?? 0), delivered: Number(t.delivered ?? 0), verified, overridden: Number(t.overridden ?? 0),
      failed: Number(t.failed ?? 0), locked: Number(t.locked ?? 0), expired: Number(t.expired ?? 0), bookingsCompleted: Number(t.completed ?? 0),
    },
    verifyRate: requested ? Math.round((verified / requested) * 1000) / 1000 : null,
    byChannel: ch.map((r) => ({ channel: String(r.channel), requested: Number(r.requested), verified: Number(r.verified) })),
    recentFailures: fails.map((r) => ({ at: new Date(r.updated_at).toISOString(), channel: String(r.channel), status: String(r.status), reason: r.failure_reason ? String(r.failure_reason) : null, maskedPhone: String(r.phone_mask ?? '') })),
  };
}
