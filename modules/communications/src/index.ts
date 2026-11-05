// modules/communications — the communications domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { CampaignsModule } from './campaigns/campaigns.module';
export { MessagingReadinessModule } from './messaging-readiness/messaging-readiness.module';
export { PushModule } from './push/push.module';
export { SmsPackagesModule } from './sms-packages/sms-packages.module';
export { TenantA2pModule } from './tenant-a2p/tenant-a2p.module';
export * from './campaigns/campaigns.dto';
export { CampaignsContext } from './campaigns/campaigns.repository';   // used by the API today
export { CampaignsService, ForbiddenError, NotFoundError, ValidationError } from './campaigns/campaigns.service';   // used by the API today
export { MockPushProvider } from './push/push-providers';   // used by the API today
export { InMemoryPushRepository } from './push/push.repository';   // used by the API today
export { PushService } from './push/push.service';   // used by the API today
export { SmsEntitlementService, SmsPurpose, smsVerificationSource, SMS_VERIFICATION_KIND } from './sms-packages/sms-entitlement.service';   // used by the API today; Phase 12: the 'sms_verification' entitlement source
export { SmsTenantPlanService } from './sms-packages/sms-tenant-plan.service';   // used by the API today
// joined by --into (notifications):
export { NotificationsModule, MessengerModule } from './notifications/notifications.module';
export * from './notifications/notifications.dto';
export { NotificationsService } from './notifications/notifications.service';   // used by the API today
// joined by --into (communications, tenant-messaging):
export { CommunicationsModule } from './communications/communications.module';
export { TenantMessagingModule } from './tenant-messaging/tenant-messaging.module';
export * from './communications/communications.dto';
export { CommunicationsLimitsService } from './communications/communications-limits.service';   // used by the API today
export { renderPreview, validateTemplate } from './communications/communications-templates-core';   // used by the API today
export { CommunicationsService } from './communications/communications.service';   // used by the API today
// joined by --into (reminders):
export { RemindersModule } from './reminders/reminders.module';
// joined by --into (end-of-day-followups):
export { EndOfDayFollowUpModule } from './end-of-day-followups/end-of-day-followups.module';
export * from './end-of-day-followups/end-of-day-followups.dto';
export { KyselyDailyFollowUpRepository } from './end-of-day-followups/end-of-day-followups.kysely.repository';   // used by the API today
// joined by --into (messaging-inbound):
export { MessagingInboundModule } from './messaging-inbound/messaging-inbound.module';
export { KyselyRemindersRepository } from './reminders/reminders.kysely.repository';   // used by the API's suspended-salon pgtest
export * from './communications-lifecycles';   // BUILD_PLAN Phase 12 (#27): the communications status machines
export { KyselyNotificationsRepository } from './notifications/notifications.kysely.repository';   // Phase 12 (#27): the API's state-machine pgtest drives the delivery-status writer
// Platform Announcements on the POS top bar (Oct 22 2026): Super Admin authoring + the POS snapshot / receipts
export { PlatformNoticeModule } from './platform-announcements/platform-notice.module';
export { PlatformNoticeService, PlatformNoticeError } from './platform-announcements/platform-notice.service';
export * as platformNotice from './platform-announcements/platform-notice-core';

