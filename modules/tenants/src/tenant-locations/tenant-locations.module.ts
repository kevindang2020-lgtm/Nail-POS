// tenant-locations.module.ts — Salon Location management (tenant manager + super-admin verification).
// Reuses the canonical `branches` record + customer-salons discovery; adds the missing manager side.
import { SuperAdminPlansModule, EntitlementsService } from '@aipowersalon/platform';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MapsGeocodingProvider } from './maps-geocoding.provider';
import { TenantLocationService } from './tenant-location.service';
import { TenantLocationsController } from './tenant-locations.controller';
import { SuperAdminLocationService } from './super-admin-location.service';
import { SuperAdminLocationsController } from './super-admin-locations.controller';

@Module({
  imports: [SuperAdminPlansModule],
  controllers: [TenantLocationsController, SuperAdminLocationsController],
  providers: [
    MapsGeocodingProvider,
    { provide: TenantLocationService, useFactory: (db: AppDatabase, maps: MapsGeocodingProvider, ent: EntitlementsService) => new TenantLocationService(db, maps, undefined, ent), inject: [DATABASE, MapsGeocodingProvider, EntitlementsService] },
    { provide: SuperAdminLocationService, useFactory: (db: AppDatabase) => new SuperAdminLocationService(db), inject: [DATABASE] },
  ],
  exports: [TenantLocationService, SuperAdminLocationService],
})
export class TenantLocationsModule {}
