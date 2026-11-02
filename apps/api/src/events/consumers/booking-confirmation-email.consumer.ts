// booking-confirmation-email.consumer.ts — Email guide §09 (Oct 31 2026): "Send booking confirmations by email" did nothing —
// no code read the setting and no booking confirmation email existed. This consumer sends ONE confirmation per appointment
// from the authoritative Booking row (appointment.created, committed by THE appointment writer together with the row):
//   • the salon's setting, its sender name / reply-to, suppression and the ledger are enforced by the ONE email path
//     (TenantMessenger.sendEmail, category 'booking_confirmation') — switched off, the attempt is recorded as blocked;
//   • the idempotency key booking_confirmation:<appointment id> is claimed BEFORE the provider is called, so a replay, a
//     retry or a second worker never sends a second confirmation (claim-before-send, 748 email_send_keys);
//   • English only (customer-facing messages mandate); an email never counts as SMS phone verification — the booking
//     reached appointment.created only after its own verification rules ran;
//   • a cancelled / no-show appointment, a walk-in without a customer, or a customer without an email gets nothing.
// A provider failure is NOT retried automatically (it is in Communications → Email with a protected Resend).
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { withCode } from '@aipowersalon/api-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time12 = (hhmm: string) => { const [h, m] = String(hhmm ?? '').split(':').map(Number); if (!Number.isFinite(h)) return String(hhmm ?? ''); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ap}`; };
const day = (iso: string) => { const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

/** the confirmation text (pure — tested directly). Plain text; the send path wraps it in the branded layout. */
export function bookingConfirmationEmail(x: { salon: string; branch: string | null; address: string | null; date: string; start: string; services: string[]; technician: string | null; customerFirst: string | null; reference: string }): { subject: string; body: string } {
  const when = `${day(x.date)} at ${time12(x.start)}`;
  const lines = [
    `Hi ${x.customerFirst?.trim() || 'there'},`,
    `Your appointment at ${x.salon}${x.branch && x.branch !== x.salon ? ` (${x.branch})` : ''} is confirmed for ${when}.`,
    x.services.length ? `Services: ${x.services.join(', ')}` : null,
    x.technician ? `With: ${x.technician}` : null,
    x.address ? `Where: ${x.address}` : null,
    `Booking reference: ${x.reference}`,
    `Need to change it? Reply to this email or call the salon.`,
  ].filter(Boolean);
  return { subject: `Your appointment at ${x.salon} — ${day(x.date)}, ${time12(x.start)}`, body: lines.join('\n\n') };
}

export class BookingConfirmationEmailConsumer implements EventConsumer {
  readonly name = 'email.booking_confirmation';
  readonly eventTypes = [DOMAIN_EVENTS.APPOINTMENT_CREATED] as const;
  readonly critical = false;
  readonly timeoutMs = 20_000;
  readonly replay = 'NOT_REPLAYABLE' as const;   // the claim key makes a replay harmless, but a replay is never needed

  constructor(private readonly messenger: TenantMessenger | null) {}

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    if (!this.messenger?.sendEmail) return;   // no email path in this process: nothing to send (never a fallback sender)
    const tenantId = String(e.tenantId ?? ''); const apptId = String(e.payload?.appointmentId ?? e.aggregateId ?? '');
    if (!UUID.test(tenantId) || !UUID.test(apptId)) return;
    const a = (await sql<any>`select a.tenant_id, a.branch_id, a.customer_id, a.status, a.appt_date::text as d, a.start_time::text as st, a.services,
          c.email, c.first_name, tech.full_name as tech_name, b.name as branch_name, b.address, b.address_line2, b.city, b.state, b.zip,
          coalesce(nullif(t.display_name, ''), t.legal_name) as salon
        from pos_tech_appointments a
        join tenants t on t.id = a.tenant_id
        left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
        left join technicians tech on tech.id = a.technician_id and tech.tenant_id = a.tenant_id
        left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
       where a.id = ${apptId}::uuid`.execute(trx)).rows[0];
    if (!a) return;
    if (String(a.tenant_id) !== tenantId) throw withCode(new TenantMismatchError(`appointment ${apptId} belongs to another tenant`), 'TENANT_ACCESS_DENIED');   // §14: a security failure, never a retry
    if (!a.customer_id || !String(a.email ?? '').trim() || ['cancelled', 'canceled', 'no_show'].includes(String(a.status))) return;
    let services: string[] = [];
    try { const s = typeof a.services === 'string' ? JSON.parse(a.services) : a.services; services = (Array.isArray(s) ? s : []).map((x: any) => String(x?.name ?? x?.serviceName ?? '').trim()).filter(Boolean).slice(0, 8); } catch { services = []; }
    const address = [a.address, a.address_line2, [a.city, a.state].filter(Boolean).join(', '), a.zip].map((x: any) => String(x ?? '').trim()).filter(Boolean).join(', ') || null;
    const mail = bookingConfirmationEmail({ salon: String(a.salon ?? 'your salon'), branch: a.branch_name ?? null, address, date: a.d, start: a.st, services, technician: a.tech_name ?? null, customerFirst: a.first_name ?? null, reference: apptId.slice(0, 8).toUpperCase() });
    await this.messenger.sendEmail({ tenantId, branchId: a.branch_id ? String(a.branch_id) : null, customerId: String(a.customer_id), to: String(a.email), subject: mail.subject, body: mail.body,
      purpose: 'notification', category: 'booking_confirmation', source: { type: 'appointment', id: apptId }, idempotencyKey: `booking_confirmation:${apptId}` });
  }
}
