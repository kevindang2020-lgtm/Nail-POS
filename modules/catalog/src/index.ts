// modules/catalog — the catalog domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { ServiceAddOnsModule } from './service-add-ons/service-add-ons.module';
export { ServicesModule } from './services/services.module';
export * from './service-add-ons/service-add-ons.dto';
export * from './services/services.dto';
export { ServicesService } from './services/services.service';   // used by the API today
export { SERVICE_CATEGORY } from './catalog-lifecycles';   // Phase 12 (#27)
