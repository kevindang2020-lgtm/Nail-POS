// booking-verification-platform.kysely.ts — the two booking-verification reads that span EVERY salon on purpose.
// CROSS-TENANT BY DESIGN: (1) the hard send caps count one IP / one device across all salons — an address texting a
// stream of numbers spreads them over salons precisely to stay under a per-salon count; (2) the expiry sweep closes
// every salon's unproven sessions past their deadline (the reconciliation job, not a request path). Both return counts
// or row ids only — never a phone hash, a mask or a code. Every write that follows is keyed by the row's own id.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

/** Codes sent in the last hour from this IP / this device, across every salon (a session's resends included). */
export async function platformSendsLastHour(db: AppDatabase, ip: string | null, deviceId: string | null): Promise<{ ip: number; device: number }> {
  const r: any = await sql`
    SELECT coalesce(sum(resend_count + 1) FILTER (WHERE ${ip}::text IS NOT NULL AND request_ip = ${ip}), 0)::int AS ip,
           coalesce(sum(resend_count + 1) FILTER (WHERE ${deviceId}::text IS NOT NULL AND device_id = ${deviceId}), 0)::int AS device
    FROM booking_verification_sessions
    WHERE last_sent_at > now() - interval '1 hour'
      AND (request_ip = ${ip} OR device_id = ${deviceId})`.execute(db as any);
  return { ip: Number(r.rows?.[0]?.ip ?? 0), device: Number(r.rows?.[0]?.device ?? 0) };
}

/** Unproven sessions past their deadline, oldest first (ids only). */
export async function staleVerificationIds(db: AppDatabase, limit: number): Promise<string[]> {
  const r: any = await sql`
    SELECT id FROM booking_verification_sessions
    WHERE status IN ('pending', 'sent') AND expires_at < now()
    ORDER BY expires_at LIMIT ${limit}`.execute(db as any).catch(() => ({ rows: [] }));
  return (r.rows ?? []).map((x: any) => String(x.id));
}
