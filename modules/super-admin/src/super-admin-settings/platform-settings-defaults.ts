// platform-settings-defaults.ts — the platform DEFAULTS live in code, not seeded into the DB. Until an administrator
// explicitly changes a setting, the effective platform value IS the default here. The reference-image values are used
// as these development defaults (a legitimate default, not hardcoded production state — an admin change overrides them
// and is versioned + audited).
//
// Colours / logo / favicon are intentionally NOT defined here: they are owned by the existing `branding` module and
// are read from there for the Platform Identity panel. Legal documents, maintenance events, business categories and
// tenant presets are separate versioned entities (built in later units), not scalar platform settings.

import type { OverridePolicy } from './setting-override-core';
import { DISPLAY_AD_PLATFORM_SETTINGS } from '@aipowersalon/api-contracts';

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'color' | 'url' | 'email' | 'locale' | 'currency' | 'timezone';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  valueType: SettingValueType;
  default: unknown;
  policy: OverridePolicy;
  mandatory?: boolean;   // a mandatory platform rule (not overridable, always authoritative)
  sensitive?: boolean;
}

export type SettingGroup =
  | 'platform_identity'
  | 'support_contact'
  | 'localization'
  | 'platform_urls'
  | 'maintenance'
  | 'global_defaults'
  | 'customer_display_ads';

// Order within a group is display order.
export const SETTING_DEFS: SettingDef[] = [
  // 1. Platform Identity (name only; colours/logo/favicon come from branding)
  { key: 'platform.name', group: 'platform_identity', label: 'Platform Name', valueType: 'string', default: 'AI PowerSalon', policy: 'mandatory', mandatory: true },
  { key: 'platform.short_name', group: 'platform_identity', label: 'Short Name', valueType: 'string', default: 'AI PowerSalon', policy: 'mandatory', mandatory: true },
  { key: 'platform.legal_name', group: 'platform_identity', label: 'Legal Name', valueType: 'string', default: 'AI PowerSalon, Inc.', policy: 'mandatory', mandatory: true },
  { key: 'platform.theme', group: 'platform_identity', label: 'Active Brand Theme', valueType: 'string', default: 'Sunset Orange', policy: 'mandatory', mandatory: true },

  // 2. Support Contact Information (platform support — mandatory platform rule)
  { key: 'support.email', group: 'support_contact', label: 'Support Email', valueType: 'email', default: 'support@aipowersalon.com', policy: 'mandatory', mandatory: true },
  { key: 'support.phone', group: 'support_contact', label: 'Support Phone', valueType: 'string', default: '+1 (855) 123-4567', policy: 'mandatory', mandatory: true },
  { key: 'support.help_center_url', group: 'support_contact', label: 'Help Center URL', valueType: 'url', default: 'https://help.aipowersalon.com', policy: 'mandatory', mandatory: true },
  { key: 'support.office_address', group: 'support_contact', label: 'Office Address', valueType: 'string', default: '123 Innovation Drive, Suite 500, Miami, FL 33131, USA', policy: 'mandatory', mandatory: true },

  // 3. Localization & Formatting (platform defaults tenants may override)
  { key: 'localization.default_language', group: 'localization', label: 'Default Language', valueType: 'locale', default: 'en-US', policy: 'overridable' },
  { key: 'localization.default_currency', group: 'localization', label: 'Default Currency', valueType: 'currency', default: 'USD', policy: 'overridable' },
  { key: 'localization.default_timezone', group: 'localization', label: 'Default Time Zone', valueType: 'timezone', default: 'America/New_York', policy: 'overridable' },
  { key: 'localization.date_format', group: 'localization', label: 'Date Format', valueType: 'string', default: 'MMM dd, yyyy', policy: 'overridable' },
  { key: 'localization.time_format', group: 'localization', label: 'Time Format', valueType: 'string', default: '12h', policy: 'overridable' },
  { key: 'localization.number_format', group: 'localization', label: 'Number Format', valueType: 'string', default: '1,234.56', policy: 'overridable' },

  // 7. Platform Links & URLs (mandatory platform rules; HTTPS enforced in the service)
  { key: 'urls.main_website', group: 'platform_urls', label: 'Main Website', valueType: 'url', default: 'https://www.aipowersalon.com', policy: 'mandatory', mandatory: true },
  { key: 'urls.admin_portal', group: 'platform_urls', label: 'Admin Portal URL', valueType: 'url', default: 'https://admin.aipowersalon.com', policy: 'mandatory', mandatory: true },
  { key: 'urls.tenant_portal', group: 'platform_urls', label: 'Tenant Portal URL', valueType: 'url', default: 'https://pos.aipowersalon.com', policy: 'mandatory', mandatory: true },   // pos.* is the host actually served (DEPLOY_RUNBOOK + WEB_CORS_ORIGINS + Terraform). The previous 'app.*' default existed in NO DNS/CloudFront/CORS config, so links built from it were dead. If you standardize on app.*, provision DNS + add it to WEB_CORS_ORIGINS — platform-urls-consistency.vitest.spec.ts enforces that both move together.
  { key: 'urls.api_base', group: 'platform_urls', label: 'API Base URL', valueType: 'url', default: 'https://api.aipowersalon.com/v1', policy: 'mandatory', mandatory: true, sensitive: false },
  { key: 'urls.ios_app', group: 'platform_urls', label: 'iOS App URL', valueType: 'url', default: 'https://apps.apple.com/app/aipowersalon', policy: 'mandatory', mandatory: true },
  { key: 'urls.android_app', group: 'platform_urls', label: 'Android App URL', valueType: 'url', default: 'https://play.google.com/store/apps/details?id=com.aipowersalon', policy: 'mandatory', mandatory: true },

  // 6. Maintenance & Messaging (mandatory platform rule; enforced by middleware in a later unit)
  { key: 'maintenance.mode', group: 'maintenance', label: 'Maintenance Mode', valueType: 'boolean', default: false, policy: 'mandatory', mandatory: true },
  { key: 'maintenance.message', group: 'maintenance', label: 'Maintenance Message', valueType: 'string', default: '', policy: 'mandatory', mandatory: true },
  { key: 'maintenance.announcement_banner', group: 'maintenance', label: 'Announcement Banner', valueType: 'string', default: '', policy: 'mandatory', mandatory: true },

  // 8. Global Defaults (platform defaults tenants may override)
  { key: 'defaults.tenant_trial_days', group: 'global_defaults', label: 'Default Tenant Trial Period', valueType: 'number', default: 14, policy: 'overridable' },
  { key: 'defaults.booking_interval_min', group: 'global_defaults', label: 'Default Booking Interval', valueType: 'number', default: 30, policy: 'overridable' },
  { key: 'defaults.customer_limit', group: 'global_defaults', label: 'Default Customer Limit', valueType: 'json', default: null, policy: 'overridable' }, // null = Unlimited
  // Master on/off for the per-tenant API rate limiter (noisy-neighbor throttle). Default ON since BUILD_PLAN Phase 11
  // (Constitution 4 §12): the budget is per salon location and sized above a busy location's measured refresh load
  // (apps/api/src/common/tenant-rate-limit.ts). Turn OFF here, or with the env TENANT_RATE_LIMIT=off, which wins.
  { key: 'rate_limit.tenant_api_enabled', group: 'global_defaults', label: 'Per-Tenant API Rate Limiting', valueType: 'boolean', default: true, policy: 'overridable' },
  { key: 'defaults.technician_limit', group: 'global_defaults', label: 'Default Technician Limit', valueType: 'json', default: null, policy: 'overridable' }, // null = Unlimited
  { key: 'defaults.notifications_enabled', group: 'global_defaults', label: 'Notifications by Default', valueType: 'boolean', default: true, policy: 'overridable' },

  // 9. Customer Display Advertising — 23-inch dual-screen spec §110. The defs (keys, labels, defaults, bounds) are the ONE
  // copy in packages/api-contracts, which the marketing module enforces — so this screen and the rule can't disagree.
  // "Advertising Feature Enabled" is the Feature Registry entry 'customer_display_ads' (plus plan / per-salon overrides).
  ...DISPLAY_AD_PLATFORM_SETTINGS.map((d): SettingDef => ({ key: d.key, group: 'customer_display_ads', label: d.label, valueType: d.valueType, default: d.default, policy: 'mandatory', mandatory: true })),
];

const BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));
export function settingDef(key: string): SettingDef | undefined { return BY_KEY.get(key); }
export function isKnownSettingKey(key: string): boolean { return BY_KEY.has(key); }

export const SETTING_GROUP_ORDER: SettingGroup[] = [
  'platform_identity', 'support_contact', 'localization', 'global_defaults', 'platform_urls', 'maintenance', 'customer_display_ads',
];
