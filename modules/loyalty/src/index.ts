// modules/loyalty — the loyalty domain (Constitution 13 §40): the ONE public entry point (§97). Everything else in
// this module is internal; the API composes LoyaltyModule and never imports past this file (§98–99).
export { LoyaltyModule } from './loyalty.module';
export * from './loyalty.dto';
