// customer-booking.module.ts — customer self-booking + BOOKING PHONE VERIFICATION.
//
// ── Why the verification pieces are wired HERE ──────────────────────────────────────────────────────────
// The guard is EXPORTED, and the public booking page (ai-booking) and the AI receptionist (voice-booking) both
// inject it. One guard, three channels — because booking abuse works by probing every entrance until one is
// unlocked, and three modules each wiring their own gate is three chances to leave one open.
//
// ── The fail-closed chain, end to end ───────────────────────────────────────────────────────────────────
//   no DB            → no store, no config  → guard unbound       → bookings proceed (module not deployed)
//   DB, no tenant    → tenant settings row absent                → policy `disabled`   → bookings proceed
//   settings enabled → tenant has no Twilio → `not_configured`   → policy BLOCKS       → booking REFUSED
//   Twilio, never validated → `healthy: false` → policy BLOCKS   → booking REFUSED
//   all good, phone unproven → policy `required` → guard refuses → 428, then send/check, then retry
//
// The two ends of that chain are both deliberate. An undeployed module must not start refusing bookings at
// tenants who never asked for the feature; and a tenant who DID ask for it must never have it silently skipped
// because their provider is broken. Those are opposite failure modes, and each is wrong in its own direction.
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { DealsModule, DealsService } from '@aipowersalon/deals';
import { PushModule, PushService, SmsPackagesModule, SmsEntitlementService } from '@aipowersalon/communications';
import { AuditModule, AuditService, auditSinkFor } from '@aipowersalon/audit';
import { Module } from '@nestjs/common';
import { CustomerBookingController } from './customer-booking.controller';
import { CustomerBookingService, PhoneVerificationRequiredError, PhoneVerificationUnavailableError, BookingValidationError, BookingConflictError, type BookingAdmissionPort } from './customer-booking.service';
import { InMemoryCustomerBookingRepository, type CustomerBookingDataPort } from './customer-booking.repository';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';
import { DATABASE, branchTimeZone, type AppDatabase } from '@aipowersalon/database';
import { localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { TwilioSmsSender } from '@aipowersalon/notifications';
import { openBookingSession } from './booking-session-token';
import { VerifiedBookingFlow, type Admission } from './booking-verification-flow';

import { BookingVerificationController } from './booking-verification.controller';
import { BookingVerificationService } from './booking-verification.service';
import { BookingVerificationGuard, BookingPhoneNotVerifiedError, BookingVerificationUnavailableError, BookingPhoneInvalidError, type BookingVerificationConfigPort } from './booking-verification-guard';
import { TwilioVerifyProvider, type TenantCredentialResolver } from './booking-verification-provider';
import {
  KyselyTenantCredentialResolver, KyselyBookingVerificationConfig, KyselyVerificationStore,
} from './booking-verification.kysely';
import { BookingHoldService, KyselyHoldRepository, HoldSlotTakenError } from './booking-hold.kysely';
import { BookingVerificationSettingsController } from './booking-verification-settings.controller';
import { BookingVerificationSettingsService, type VerificationSettingsStore } from './booking-verification-settings.service';
import { KyselyVerificationSettingsStore } from './booking-verification-settings.kysely';
import { BookingHoldSweepScheduler } from './booking-hold-sweep.scheduler';
import { RemoteBookingAdmission } from './booking-verification-remote';
import { BookingVerificationOversightController } from './booking-verification-oversight.controller';
import { BookingVerificationOversightService } from './booking-verification-oversight.service';
import { KyselyRiskCounters, makeCaptchaVerifier } from './booking-verification-fraud.adapters';
import { KyselyCustomerPhoneLookup } from './customer-phone-lookup.kysely';
import type { CustomerPhoneLookup } from './booking-verification.controller';
import { KyselySessionCustomer } from '../customer-phone/session-customer.kysely';
import { BookingVerificationWebhookController, BookingVerificationWebhookJobs } from './booking-verification-webhook.controller';
import { BookingVerificationRetentionScheduler } from './booking-verification-retention.scheduler';
import { BookingVerificationOverrideController } from './booking-verification-override.controller';
import { BookingVerificationOverrideService } from './booking-verification-override.service';
import { KyselyOverrideStore } from './booking-verification-override.kysely';

@Module({
  imports: [SmsPackagesModule, PushModule, AuditModule, DealsModule, EventsCoreModule],   // Phase 4: booking.phone_verification_* commit with their facts
  controllers: [CustomerBookingController, BookingVerificationController, BookingVerificationSettingsController, BookingVerificationOversightController, BookingVerificationWebhookController, BookingVerificationOverrideController],
  providers: [
    { provide: 'CustomerBookingDataPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): CustomerBookingDataPort => (db ? new KyselyCustomerBookingRepository(db, outbox) : new InMemoryCustomerBookingRepository()), inject: [DATABASE, OutboxWriter] },

    // The tenant's OWN Twilio. Fails closed — never the platform's shared account. See the long note in
    // booking-verification-provider.ts for why that fallback would have been a genuine bug and not a shortcut.
    { provide: 'TenantCredentialResolver', useFactory: (db: AppDatabase, secrets: ProviderSecrets): TenantCredentialResolver => new KyselyTenantCredentialResolver(db ?? null, secrets), inject: [DATABASE, PROVIDER_SECRETS] },

    { provide: 'BookingVerificationConfigPort', useFactory: (db: AppDatabase, creds: TenantCredentialResolver): BookingVerificationConfigPort => new KyselyBookingVerificationConfig(db ?? null, creds), inject: [DATABASE, 'TenantCredentialResolver'] },

    // EXPORTED. The public booking page and the AI receptionist inject this exact instance.
    { provide: BookingVerificationGuard, useFactory: (cfg: BookingVerificationConfigPort) => new BookingVerificationGuard(cfg), inject: ['BookingVerificationConfigPort'] },
    { provide: 'BookingVerificationGuard', useExisting: BookingVerificationGuard },

    // The session store (and proof store): one instance, with the outbox, so every lifecycle fact is a domain event.
    { provide: KyselyVerificationStore, useFactory: (db: AppDatabase, outbox: OutboxWriter) => new KyselyVerificationStore(db as any, outbox), inject: [DATABASE, OutboxWriter] },
    {
      provide: BookingVerificationService,
      useFactory: (creds: TenantCredentialResolver, entitlement: SmsEntitlementService, store: KyselyVerificationStore) =>
        new BookingVerificationService(
          creds,
          // Twilio Verify is preferred because WE NEVER HOLD THE CODE.
          { twilio_verify: new TwilioVerifyProvider() },
          store,
          // Phase 4: the internal fallback, bound — a salon with a sending number and no Verify Service gets a
          // securely generated code texted from ITS OWN number, of which only the hash is kept. The salon chose it by
          // connecting a number without a Verify Service; the settings screen says which mechanism is in use.
          async (c, to, body) => new TwilioSmsSender({ accountSid: c.accountSid, authToken: c.authToken, from: String(c.fromNumber ?? '') }).send(to, body),
          entitlement,             // §14 gate: precheck before send, ledger after acceptance (sms-packages P2)
        ),
      inject: ['TenantCredentialResolver', SmsEntitlementService, KyselyVerificationStore],
    },

    // The tenant's own settings. A tenant cannot ENABLE verification without a Twilio account that is connected
    // AND tested — because the policy resolver correctly BLOCKS a remote booking when verification is required
    // and cannot be performed, so enabling it with a broken provider does not degrade the feature: it stops the
    // salon's online booking entirely.
    { provide: 'VerificationSettingsStore', useFactory: (db: AppDatabase): VerificationSettingsStore => new KyselyVerificationSettingsStore(db ?? null), inject: [DATABASE] },
    {
      provide: BookingVerificationSettingsService,
      useFactory: (store: VerificationSettingsStore, creds: TenantCredentialResolver, audit: AuditService) =>
        new BookingVerificationSettingsService(store, creds, auditSinkFor(audit)),
      inject: ['VerificationSettingsStore', 'TenantCredentialResolver', AuditService],
    },

    // ── the fraud engine, ACTUALLY WIRED ───────────────────────────────────────────────────────────────
    //
    // `assessSendRisk()` was injected as @Optional() and provided by nothing, so it was DEAD CODE: `screen()`
    // returned immediately on every request and its 19 tests described a code path that could never run. That is
    // the easiest bug in this codebase to ship — everything green, nothing connected — and it is the one I have
    // spent all day finding in other people's modules.
    { provide: 'BookingRiskCounters', useFactory: (db: AppDatabase) => new KyselyRiskCounters(db ?? null), inject: [DATABASE] },

    // With no CAPTCHA_SECRET_KEY this is NULL, and the send route then REFUSES any request it wanted to
    // challenge. Deliberate: a challenge we cannot perform is a challenge that was not passed, and waving those
    // through would make the whole risk engine decorative.
    { provide: 'CaptchaVerifier', useFactory: () => makeCaptchaVerifier() },

    // The signed-in customer's OWN phone. The client cannot choose which number it verifies — see the note on
    // CustomerPhoneLookup: a client-supplied phone lets someone verify a number they control and book against
    // another.
    { provide: 'CustomerPhoneLookup', useFactory: (db: AppDatabase) => new KyselyCustomerPhoneLookup(db ?? null), inject: [DATABASE] },
    // Phase 4: the signed-in user's customer record at this salon (customers.user_id) — the audit found the user id
    // used as the customer id, so the phone lookup always missed.
    { provide: 'BookingSessionCustomer', useFactory: (db: AppDatabase) => new KyselySessionCustomer(db ?? null), inject: [DATABASE] },

    // The manual staff bypass. Owner/Manager only — NOT receptionists, who are exactly who a social engineer
    // calls. It authorises ONE booking and writes NO verified-phone record, so it grants no trust window: the next
    // booking on that number asks for a code again. Otherwise one manipulated receptionist hands an attacker a
    // verified phone for 24 hours, and the bypass stops being a bypass and starts being a key.
    { provide: BookingVerificationOverrideService, useFactory: (db: AppDatabase, audit: AuditService, outbox: OutboxWriter) => new BookingVerificationOverrideService(new KyselyOverrideStore(db ?? null, outbox), auditSinkFor(audit)), inject: [DATABASE, AuditService, OutboxWriter] },

    // Super Admin oversight. Cannot return a code, a credential, or a full phone number — the service never has
    // them, which is a stronger guarantee than a controller remembering to strip a field.
    { provide: BookingVerificationOversightService, useFactory: (db: AppDatabase, audit: AuditService) => new BookingVerificationOversightService(db ?? null, auditSinkFor(audit)), inject: [DATABASE, AuditService] },

    // Slot reservation while the customer verifies. With no DB there is no hold store — and no holds, which is
    // the same state as "the module is not deployed".
    { provide: KyselyHoldRepository, useFactory: (db: AppDatabase) => new KyselyHoldRepository(db as any), inject: [DATABASE] },
    { provide: BookingHoldService, useFactory: (repo: KyselyHoldRepository) => new BookingHoldService(repo), inject: [KyselyHoldRepository] },

    // Phase 4: THE way every remote channel admits a booking — policy, proof (consumed by one appointment), holds.
    {
      provide: VerifiedBookingFlow,
      useFactory: (guard: BookingVerificationGuard, store: KyselyVerificationStore, holds: BookingHoldService, repo: KyselyHoldRepository) =>
        new VerifiedBookingFlow(guard, store, { service: holds, repo }),
      inject: [BookingVerificationGuard, KyselyVerificationStore, BookingHoldService, KyselyHoldRepository],
    },

    // The public link, the AI receptionist and the kiosk book through the staff engine; they share this adapter (slot
    // in the branch's zone, booking session sealed for their principal) around the same flow.
    { provide: RemoteBookingAdmission, useFactory: (flow: VerifiedBookingFlow, db: AppDatabase) => new RemoteBookingAdmission(flow, db), inject: [VerifiedBookingFlow, DATABASE] },

    // The optional per-minute hold sweep (BOOKING_HOLD_SWEEP_CRON_ENABLED). The API's 20 s sync reconciliation
    // already releases expired holds — and, since Phase 4, expires unproven verifications — by default.
    BookingHoldSweepScheduler,
    // Phase 4: Twilio's status callbacks are applied from the job queue, once per (SID, status).
    BookingVerificationWebhookJobs,

    // Rolls usage up, THEN deletes the per-attempt trail. We never hold a code (Twilio Verify does), but the
    // sessions hold a phone hash, an IP and a device id — a durable record of who tried to book where, from what
    // network. Its only remaining purpose after a day is fraud velocity, which looks back one hour.
    BookingVerificationRetentionScheduler,

    {
      provide: CustomerBookingService,
      useFactory: (repo: CustomerBookingDataPort, push: PushService, flow: VerifiedBookingFlow, db: AppDatabase, deals: DealsService, phones: CustomerPhoneLookup, holds: KyselyHoldRepository) =>
        // With no database there is no policy store and no credential store, so the admission is left UNBOUND and
        // bookings proceed — the "module not deployed" state, which the policy resolver already calls `disabled`.
        new CustomerBookingService(repo, push, db ? customerAppAdmission(flow, phones, db, holds) : undefined, deals),
      inject: ['CustomerBookingDataPort', PushService, VerifiedBookingFlow, DATABASE, DealsService, 'CustomerPhoneLookup', KyselyHoldRepository],
    },
  ],
  exports: [CustomerBookingService, BookingVerificationGuard, 'BookingVerificationGuard', BookingHoldService, BookingVerificationService, VerifiedBookingFlow, RemoteBookingAdmission, KyselyVerificationStore, 'TenantCredentialResolver', 'BookingRiskCounters', 'CaptchaVerifier'],
})
export class CustomerBookingModule {}

/**
 * The customer app's admission: the shared flow, asked about THIS customer's own number (resolved from their record —
 * the audit found the old adapter passing `customerPhone: null`, so the history was never read and the app looped on
 * 428), for the slot being booked (in the branch's own time zone), continuing the booking session the 428 issued.
 */
export function customerAppAdmission(flow: VerifiedBookingFlow, phones: CustomerPhoneLookup, db: AppDatabase, holds?: KyselyHoldRepository): BookingAdmissionPort {
  return {
    async admit(ctx, i) {
      const phone = await phones.phoneFor(ctx.tenantId, i.customerId).catch(() => null);
      const tz = await branchTimeZone(db, ctx.tenantId, ctx.branchId || null);
      const slot = { technicianId: i.technicianId, startsAt: localDateTimeToEpochMs(i.date, i.startTime, tz), endsAt: localDateTimeToEpochMs(i.date, i.endTime, tz), serviceIds: i.serviceIds };
      // The token is bound to this salon and THIS signed-in user; anybody else's token opens to nothing.
      const session = i.bookingSessionToken ? openBookingSession(i.bookingSessionToken, { tenantId: ctx.tenantId, customerId: ctx.userId }) : null;
      try {
        return await flow.admit({ tenantId: ctx.tenantId, branchId: ctx.branchId, channel: 'customer_app' }, { phone, bookingSessionId: session, slot, customerId: i.customerId, deviceId: i.deviceId ?? null });
      } catch (e) {
        if (e instanceof BookingPhoneNotVerifiedError) throw new PhoneVerificationRequiredError(e.message, e.bookingSessionId ?? '', e.maskedPhone, e.policyReason, e.holdExpiresAt);
        if (e instanceof BookingVerificationUnavailableError) throw new PhoneVerificationUnavailableError(e.message, e.policyReason);
        if (e instanceof BookingPhoneInvalidError) throw new BookingValidationError('Add a mobile number to your profile to book online — this salon verifies it with a code.');
        if (e instanceof HoldSlotTakenError) throw new BookingConflictError(e.message);
        throw e;
      }
    },
    complete: (ctx, ticket, appointmentId) => flow.complete({ tenantId: ctx.tenantId, branchId: ctx.branchId, channel: 'customer_app' }, ticket as Admission, appointmentId),
    abandon: (ticket) => flow.abandon(ticket as Admission),
    async heldSlots(ctx, date, ownSessionId) {
      if (!holds) return [];
      const tz = await branchTimeZone(db, ctx.tenantId, ctx.branchId || null);
      const from = localDateTimeToEpochMs(date, '00:00', tz);
      const live = await holds.liveHolds(ctx.tenantId, ctx.branchId, from, from + 24 * 3_600_000);
      const hhmm = (ms: number) => { const p = zonedParts(new Date(ms), tz); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
      return live.filter((h) => !ownSessionId || h.bookingSessionId !== ownSessionId)
        .map((h) => ({ technicianId: h.technicianId, startTime: hhmm(h.startsAt), endTime: hhmm(h.endsAt) }));
    },
  };
}
