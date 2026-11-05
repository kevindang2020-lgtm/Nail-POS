// customer-phone-notify.ts — who hears about a phone change (BUILD_PLAN Phase 3; spec "Notifications").
//
// Before: the service took a `notify` port and the module passed `undefined` (audit: "notify passed undefined";
// `notifyOldNumber` never read). Nobody was told anything.
//
//   • The CUSTOMER, on their OLD number (tenant setting notify_old_number, default on): the one channel an attacker who
//     changed the number cannot suppress. Masked: it says THAT the number changed, to ••••1234 — never the full number.
//     Sent on the SALON's own number through the tenant messenger (Phase 2). Never to both numbers: the new number was
//     just proved by the customer, or entered at the desk in front of them.
//   • The salon's MANAGERS (owner_alerts, the Owner app's alert feed): a change waiting for their approval, a conflict
//     only they can resolve, a number set without an SMS, a synchronisation that kept failing.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { maskPhone, phoneKey } from '@aipowersalon/customers';
import { KyselyPhoneSettingsStore } from './customer-phone-settings.kysely';

export interface PhoneChangedNotice { tenantId: string; customerId: string; newPhoneMasked: string; method: string; oldPhoneId?: string | null; branchId?: string | null;
  /** The new number's hash: the old number is told unless it IS the new number (a mask alone cannot tell — two numbers often share their last four digits). */
  newPhoneHash?: string | null }
export interface StaffAlert { tenantId: string; branchId?: string | null; severity: 'info' | 'warning' | 'high'; title: string; body: string; metadata?: Record<string, unknown> }
export interface PhoneNotifier {
  phoneChanged(n: PhoneChangedNotice): Promise<void>;
  staffAlert?(a: StaffAlert): Promise<void>;
}

/** The text to the OLD number. Masked; says what to do. */
export function oldNumberNotice(salonName: string, newPhoneMasked: string): string {
  return `${salonName}: the phone number on your profile was changed to ${newPhoneMasked}. ` +
    `If you did not ask for this, contact the salon right away.`;
}

export class KyselyPhoneNotifier implements PhoneNotifier {
  constructor(private readonly db: AppDatabase | null, private readonly messenger?: TenantMessenger | null) {}

  async phoneChanged(n: PhoneChangedNotice): Promise<void> {
    if (!this.db) return;
    // No branch in the request: the customer's home branch's policy (as for the change itself).
    const branch = n.branchId || ((await sql`SELECT branch_id FROM customers WHERE id = ${n.customerId} AND tenant_id = ${n.tenantId}`
      .execute(this.db as any).catch(() => ({ rows: [] }))).rows?.[0] as any)?.branch_id || null;
    const settings = await new KyselyPhoneSettingsStore(this.db).get(n.tenantId, branch);
    if ((settings?.notifyOldNumber ?? true) && n.oldPhoneId && this.messenger) {
      const old: any = (await sql`SELECT normalized_phone FROM customer_phones WHERE id = ${n.oldPhoneId} AND tenant_id = ${n.tenantId}`
        .execute(this.db as any).catch(() => ({ rows: [] }))).rows?.[0];
      const oldE164 = old?.normalized_phone ? String(old.normalized_phone) : null;
      const same = oldE164 && (n.newPhoneHash ? phoneKey(oldE164) === n.newPhoneHash : maskPhone(oldE164) === n.newPhoneMasked);
      if (oldE164 && !same) {
        const salon: any = (await sql`SELECT display_name FROM tenants WHERE id = ${n.tenantId}`.execute(this.db as any).catch(() => ({ rows: [] }))).rows?.[0];
        // An account/security text: an opt-out does not stop it (the messenger's 'account' purpose).
        await this.messenger.sendSms({ tenantId: n.tenantId, to: oldE164, customerId: n.customerId, purpose: 'account', body: oldNumberNotice(String(salon?.display_name ?? 'Your salon'), n.newPhoneMasked) }).catch(() => undefined);
      }
    }
    if (n.method === 'manual_confirmation') {
      await this.staffAlert({
        tenantId: n.tenantId, branchId: n.branchId ?? null, severity: 'warning',
        title: 'A customer phone number was set without SMS verification',
        body: `A customer's number was changed to ${n.newPhoneMasked} without a verification code (manual confirmation or salon policy). It is labelled "OTP not completed" until the customer verifies it.`,
        metadata: { customerId: n.customerId, method: n.method },
      });
    }
  }

  async staffAlert(a: StaffAlert): Promise<void> {
    if (!this.db) return;
    await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
              VALUES (${a.tenantId}, ${a.branchId || null}, 'customer_phone', ${a.severity}, 'new', ${a.title}, ${a.body}, ${JSON.stringify(a.metadata ?? {})}::jsonb, 'all')`
      .execute(this.db as any).catch(() => undefined);   // an alert never blocks the change it describes
  }
}
