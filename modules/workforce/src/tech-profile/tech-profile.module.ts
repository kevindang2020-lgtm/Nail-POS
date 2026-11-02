import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { makeMediaStorage } from '@aipowersalon/media';
import { MediaController } from './media.controller';
import { TechProfileController } from './tech-profile.controller';
import { PosServiceTechMatchController, PosTechMembershipController, PosTechProfileChangesController, PosTechProfileController, PosTechProfilePolicyController } from './pos-tech-profile.controller';
import { CustomerTechController } from './customer-tech.controller';
import { TechProfileSuperAdminController } from './tech-profile.super-admin.controller';
import { MEDIA_STORAGE, TechProfileService } from './tech-profile.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { TechWorkplacesService } from './tech-workplaces.service';
import { TechWorkplacesController } from './tech-workplaces.controller';
import { MediaAccessService } from './media-access.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { StaffAvatarController } from './staff-avatar.controller';   // developer merge Sep 2026

@Module({
  imports: [EventsCoreModule],
  controllers: [StaffAvatarController, TechProfileController, TechWorkplacesController, MediaController, PosTechProfileController, PosTechMembershipController, PosTechProfilePolicyController, PosTechProfileChangesController, PosServiceTechMatchController, CustomerTechController, TechProfileSuperAdminController],
  providers: [
    TechProfileService,
    // factory (NOT class) so Nest never introspects the optional ctor param — the bug-#15 DI lesson
    { provide: MEDIA_STORAGE, useFactory: () => makeMediaStorage() },
    // same lesson: both identity providers are factories, so no optional ctor param is ever introspected.
    { provide: GlobalTechDirectory, useFactory: (db: AppDatabase) => new GlobalTechDirectory(db), inject: [DATABASE] },
    { provide: GlobalTechIdentityService, useFactory: (db: AppDatabase, dir: GlobalTechDirectory) => new GlobalTechIdentityService(db, dir), inject: [DATABASE, GlobalTechDirectory] },
    { provide: TechWorkplacesService, useFactory: (db: AppDatabase) => new TechWorkplacesService(db), inject: [DATABASE] },
    // /media/* authorizer (facts from the referencing tables + signed-URL minting); factory for the same DI reason.
    { provide: MediaAccessService, useFactory: (db: AppDatabase) => new MediaAccessService(db), inject: [DATABASE] },
  ],
  exports: [TechProfileService, MEDIA_STORAGE, GlobalTechDirectory, GlobalTechIdentityService, TechWorkplacesService, MediaAccessService],
})
export class TechProfileModule {}
