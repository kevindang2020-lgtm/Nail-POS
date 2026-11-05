// feature-entitlements.module.ts — BUILD_PLAN Phase 12 (#13): provides the ONE EntitlementService under
// ENTITLEMENT_SERVICE, globally, so the plan-feature guard (APP_GUARD), the AI package guard and every write path that
// changes a plan / add-on / override share one instance (one cache, one invalidation).
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { ENTITLEMENT_SERVICE } from '@aipowersalon/permissions';
import { FeatureRegistry } from './feature-registry';
import { createEntitlementService } from './plan-feature-source';

@Global()
@Module({
  providers: [{ provide: ENTITLEMENT_SERVICE, useFactory: (db: AppDatabase) => createEntitlementService(db, db ? new FeatureRegistry(db) : null), inject: [DATABASE] }],
  exports: [ENTITLEMENT_SERVICE],
})
export class FeatureEntitlementsModule {}
