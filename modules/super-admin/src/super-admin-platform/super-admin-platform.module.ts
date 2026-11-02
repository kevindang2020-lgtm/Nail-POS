// super-admin-platform.module.ts — applications, leads, hardware packages, support access (iPad Super Admin spec).
import { MFA_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { CustomerSalonsModule } from '@aipowersalon/customers';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ApplicationConfirmationSender, emailSenderFromEnv, smsSenderFromEnv } from './application-confirmation';
import { SuperAdminPlatformController } from './super-admin-platform.controller';
import { PublicWebsiteController } from './public-website.controller';
import { MyAccessRequestsController } from './my-access-requests.controller';
import { ScheduledReportsCronController } from './scheduled-reports.cron.controller';
import { SalonStaffInvitationsController } from './salon-staff-invitations.controller';   // wave 4 pilot: the salon invites its front desk / manager
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo, KyselySuperAdminPlatformRepo, type SuperAdminPlatformRepo } from './super-admin-platform.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';
import { credentialDeliveryFor } from '../admin-credential-delivery';

@Module({
  imports: [CustomerSalonsModule, OnboardingModule],
  controllers: [SuperAdminPlatformController, PublicWebsiteController, MyAccessRequestsController, ScheduledReportsCronController, SalonStaffInvitationsController],
  providers: [
    { provide: 'SuperAdminPlatformRepo', useFactory: (db: AppDatabase): SuperAdminPlatformRepo => (db ? new KyselySuperAdminPlatformRepo(db) : new InMemorySuperAdminPlatformRepo()), inject: [DATABASE] },
    // C2 / A3: user resets and invite re-sends reach the account holder only (credentialDeliveryFor)
    { provide: SuperAdminPlatformService, useFactory: (repo: SuperAdminPlatformRepo, db: AppDatabase, onboarding: OnboardingService, mfa: ProviderSecrets, messenger?: TenantMessenger) => new SuperAdminPlatformService(repo, db || undefined, onboarding, new ApplicationConfirmationSender({ email: emailSenderFromEnv(), sms: smsSenderFromEnv(), db: db || null }), mfa, credentialDeliveryFor(db, messenger)), inject: ['SuperAdminPlatformRepo', DATABASE, OnboardingService, MFA_SECRETS, { token: TENANT_MESSENGER, optional: true }] },
  ],
  exports: [SuperAdminPlatformService],
})
export class SuperAdminPlatformModule {}
