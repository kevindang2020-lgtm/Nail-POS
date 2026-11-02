// modules/tenants — the tenants domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { BrandingModule } from './branding/branding.module';
export { PublicBrandingController } from './branding/branding.controller';   // used by the API today
export { renderBrandedEmail } from './branding/email-layout';   // used by the API today
// joined by --into (devices, owner-portfolio):
export { DevicesModule } from './devices/devices.module';
export { OwnerPortfolioModule } from './owner-portfolio/owner-portfolio.controller';
export * from './devices/devices.dto';
export { RawDevice, deviceStatus, relativeLabel } from './devices/devices-overview-core';   // used by the API today
export { summarize, topSalons } from './owner-portfolio/owner-portfolio-core';   // used by the API today
export { KyselyOwnerPortfolioRepo } from './owner-portfolio/owner-portfolio.repository';   // used by the API today
// joined by --into (settings):
export { PosSettingsModule } from './settings/settings.module';
export { TERMINAL_PROBE_PORT, type TerminalProbePort } from './settings/settings.integrations';   // wave 3 PAYI §166: apps/api supplies the Bolt ping through this port
export * from './settings/settings.dto';
// the salon logo (23-inch customer display header, receipts): the display reads it and must accept only a stored logo
export { SALON_LOGO_CATEGORY, safeSalonLogoUrl, parseSalonLogo, type SalonLogo } from './settings/salon-logo';
// joined by --into (tenant-entitlements, tenant-locations, tenant-navigation):
export { TenantEntitlementsModule } from './tenant-entitlements/tenant-entitlements.module';
export { TenantLocationsModule } from './tenant-locations/tenant-locations.module';
export { TenantNavigationModule } from './tenant-navigation/tenant-navigation.module';
// joined by --into (pos-social):
export { SocialModule } from './pos-social/pos-social.module';
export * from './pos-social/pos-social.dto';
