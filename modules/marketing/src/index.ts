// modules/marketing — the marketing domain (Constitution 13 §40, §97): the ONE public entry point. Today it owns the
// salon's own advertising on its customer display (23-inch dual-screen spec §47–§114, §112 "Advertising belongs to
// Marketing / Customer Display ... not Checkout"). The API composes DisplayAdvertisingModule and imports only from here.
export { DisplayAdvertisingModule } from './display-advertising/display-ads.module';
// the customer-display device routes (apps/api) resolve the device, then ask for its playlist / record its displays
export { DisplayAdsPlaylistService, type DisplayIdentity } from './display-advertising/display-ads-playlist.service';
export { DisplayAdError } from './display-advertising/display-ads-core';
export { AdvertisingPolicyStore, PlatformAdvertisingService, assertTenantAdvertisingAllowed, type AdvertisingPolicy, type AdvertisingMode } from './display-advertising/platform-advertising';
