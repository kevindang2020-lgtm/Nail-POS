// customer-phone.module.ts — the ONE canonical phone-update path.
//
// The audit found `PATCH /pos/customers/:id` writing `normalized_phone` directly: no E.164, no duplicate check, no
// verification, no optimistic lock, no audit. That path is now closed, and this is the only one -- which is the
// spec's first rule, and it exists because a second path is a second set of rules, and the fraud moves to whichever
// set is weaker.
import { CustomerBookingModule } from '../customer-booking/customer-booking.module';
import { BookingVerificationService } from '../customer-booking/booking-verification.service';
import { CustomerIdentityModule, CustomerIdentityService } from '@aipowersalon/customers';
import { AuditModule, AuditService, auditSinkFor } from '@aipowersalon/audit';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxWriter } from '@aipowersalon/events';

import { CustomerPhoneController } from './customer-phone.controller';
import { CustomerPhoneUpdateService, type PhoneStore, type SyncPort, type VerificationPort } from './customer-phone-update.service';
import { KyselyPhoneStore, KyselySyncPort } from './customer-phone.kysely';
import { CustomerPhoneSyncScheduler } from './customer-phone-sync.scheduler';
import { CustomerPhoneAppController, type SessionCustomerResolver } from './customer-phone-app.controller';
import { KyselySessionCustomer } from './session-customer.kysely';
import { CustomerPhoneSettingsController, CustomerPhoneOversightController } from './customer-phone-settings.controller';
import { CustomerPhoneSettingsService, type PhoneSettingsStore } from './customer-phone-settings.service';
import { KyselyPhoneSettingsStore } from './customer-phone-settings.kysely';
import { CustomerIdentityPhoneService } from './customer-identity-phone.service';
import { KyselyIdentityStore, KyselyAuthPort, SmsSecurityNotifier } from './customer-identity-phone.kysely';
import { KyselyPhoneNotifier } from './customer-phone-notify';
import { type SmsSender, TENANT_MESSENGER, type TenantMessenger, smsSenderFromEnv, isSimulatedSender } from '@aipowersalon/notifications';

/**
 * The platform's existing sender, with the platform's EXACT env vars.
 *
 * `TWILIO_FROM`, not `TWILIO_FROM_NUMBER` — I wrote the latter first, and it would have quietly failed the check,
 * fallen through to the mock, and the account-takeover warning would never have sent. A wrong env var name is a
 * silently disabled security control.
 */
function smsSender(): SmsSender {
  // Development/test only. In production a simulated security warning stops the change (CustomerIdentityPhoneService).
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}

@Module({
  imports: [AuditModule, CustomerBookingModule, CustomerIdentityModule, EventsCoreModule],   // Phase 3: customer.phone_* commit with their facts
  controllers: [CustomerPhoneController, CustomerPhoneAppController, CustomerPhoneSettingsController, CustomerPhoneOversightController],
  providers: [
    { provide: 'PhoneStore', useFactory: (db: AppDatabase, outbox: OutboxWriter): PhoneStore => new KyselyPhoneStore(db ?? null, outbox), inject: [DATABASE, OutboxWriter] },
    { provide: 'PhoneSyncPort', useFactory: (db: AppDatabase): SyncPort => new KyselySyncPort(db ?? null), inject: [DATABASE] },

    // The OTP is the booking-verification module's, not ours. Same tenant-owned Twilio, same hashed storage, same
    // attempt limits, same enumeration-safety. A second OTP store would be a second place to leak a code from.
    {
      provide: 'PhoneVerificationPort',
      useFactory: (bv: BookingVerificationService): VerificationPort => ({
        async send(ctx, phone) {
          const out = await bv.send({ tenantId: ctx.tenantId, branchId: ctx.branchId, channel: 'customer_app', bookingSessionId: ctx.bookingSessionId, customerId: ctx.customerId, purpose: 'CUSTOMER_PHONE_CHANGE' }, phone);   // §17: phone changes ledger under their own purpose, not BOOKING_VERIFICATION
          return { status: out.status, maskedPhone: (out as any).maskedPhone, message: out.message };
        },
        async check(ctx, phone, code) {
          const out = await bv.check({ tenantId: ctx.tenantId, branchId: ctx.branchId, channel: 'customer_app', bookingSessionId: ctx.bookingSessionId, customerId: ctx.customerId }, phone, code);
          return { status: out.status, message: out.message };
        },
      }),
      inject: [BookingVerificationService],
    },

    {
      provide: CustomerPhoneUpdateService,
      useFactory: (store: PhoneStore, verify: VerificationPort, sync: SyncPort, audit: AuditService, identity: CustomerIdentityService, db: AppDatabase, messenger?: TenantMessenger) =>
        // `notify` was passed as undefined here, so nobody was ever told about a change (audit). Phase 3: the old
        // number (salon policy, on the salon's own number) and the salon's managers (owner alerts).
        new CustomerPhoneUpdateService(store, verify, sync, auditSinkFor(audit), new KyselyPhoneNotifier(db ?? null, messenger ?? null), identity),
      inject: ['PhoneStore', 'PhoneVerificationPort', 'PhoneSyncPort', AuditService, CustomerIdentityService, DATABASE, { token: TENANT_MESSENGER, optional: true }],
    },

    // Drains `synchronization_failed`. A state nothing drains is just a nicer word for "lost": the customer
    // believes their number is changed, and their reminders keep going to a phone they no longer own.
    CustomerPhoneSyncScheduler,

    // Changing the number you SIGN IN with. A different thing from a contact number, with a different threat:
    // ACCOUNT TAKEOVER. Reauthenticate, require an already-verified number, notify the OLD number BEFORE the
    // change, revoke every session after it.
    {
      provide: CustomerIdentityPhoneService,
      useFactory: (db: AppDatabase, audit: AuditService, messenger?: TenantMessenger) =>
        new CustomerIdentityPhoneService(
          new KyselyIdentityStore(db ?? null),
          new KyselyAuthPort(db ?? null),
          // THE WARNING ACTUALLY SENDS.
          //
          // My first version bound `async () => undefined` here — a no-op — which would have made the single most
          // important control in this feature silently do nothing. The notification to the OLD number is the ONE
          // channel an attacker cannot suppress, and it is how a real customer discovers their account is being
          // taken while the number is still theirs. A no-op there is not a degradation; it is the control removed.
          //
          // Same sender the platform already uses (`smsFromEnv`, as in customer.module) — Twilio when configured,
          // the mock otherwise, and the mock LOGS rather than silently dropping.
          // Phase 2: through the messenger (a platform security text — an opt-out never stops it), env sender as fallback.
          // Phase 3: on the SALON's number (the messenger, tenant Twilio) when the request came through a salon; what
          // the sender reports (sent / simulated) decides, in production, whether the change may proceed.
          new SmsSecurityNotifier(async (to, body, tenantId) => {
            if (messenger) {
              const r = await messenger.sendSms({ tenantId, to, body, purpose: 'account' });
              return { sent: r.sent, simulated: !!r.simulated };
            }
            const sender = smsSender();
            await sender.send(to, body);
            return { sent: true, simulated: isSimulatedSender(sender) };
          }),
          auditSinkFor(audit),
        ),
      inject: [DATABASE, AuditService, { token: TENANT_MESSENGER, optional: true }],
    },

    // Tenant policy. `allowManualConfirmation` is OFF by default and must stay that way: a manually confirmed
    // number is a manager's JUDGEMENT, not cryptographic evidence, and defaulting it on would quietly turn every
    // salon into one where a phone can be marked usable without anybody ever proving it.
    { provide: 'PhoneSettingsStore', useFactory: (db: AppDatabase): PhoneSettingsStore => new KyselyPhoneSettingsStore(db ?? null), inject: [DATABASE] },
    {
      provide: CustomerPhoneSettingsService,
      useFactory: (store: PhoneSettingsStore, audit: AuditService) => new CustomerPhoneSettingsService(store, auditSinkFor(audit)),
      inject: ['PhoneSettingsStore', AuditService],
    },

    // The signed-in customer's OWN record, resolved from the SESSION. There is no path that takes a customer id
    // from a request — which is what makes "change my phone" mean *mine*, on an endpoint that decides where a
    // person's booking codes and appointment reminders are delivered.
    { provide: 'SessionCustomerResolver', useFactory: (db: AppDatabase): SessionCustomerResolver => new KyselySessionCustomer(db ?? null), inject: [DATABASE] },
  ],
  exports: [CustomerPhoneUpdateService],
})
export class CustomerPhoneModule {}
