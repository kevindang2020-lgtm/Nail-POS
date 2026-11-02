// provider-registry.ts — the ONLY providers that may be connected. Arbitrary provider URLs / webhook destinations are
// never accepted; every connection must resolve to a registry entry, and OAuth redirect URIs are validated against a
// per-provider allowlist of hosts. Each entry declares category, auth methods, default scopes, webhook/sync
// capability, and (for OAuth) the allowed redirect hosts. The adapter factory returns a ReferenceAdapter today; a
// real provider adapter drops in here without changing any service/controller code.

import type { AuthMethod, IntegrationAdapter } from './adapter.contract';
import { ReferenceAdapter } from './reference-adapter';

export type ProviderDef = {
  key: string; name: string; category: string; authMethods: AuthMethod[]; defaultScopes: string[];
  webhookCapable: boolean; syncCapable: boolean; allowedRedirectHosts: string[];
};

// OAuth redirect allowlist. This previously allowed app.aipowersalon.com (which is served nowhere) while
// OMITTING pos.aipowersalon.com — the host that actually runs the POS — so a provider OAuth callback to the real
// app would have been rejected. Both tenant + admin hosts are listed now.
const HOSTS = ['pos.aipowersalon.com', 'admin.aipowersalon.com', 'localhost'];

export const PROVIDERS: Record<string, ProviderDef> = {
  fiserv: { key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway', authMethods: ['api_key'], defaultScopes: [], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  clover: { key: 'clover', name: 'Clover', category: 'Payments', authMethods: ['oauth2', 'api_key'], defaultScopes: ['read:orders', 'read:payments'], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  twilio: { key: 'twilio', name: 'Twilio', category: 'Communication', authMethods: ['api_key'], defaultScopes: [], webhookCapable: true, syncCapable: false, allowedRedirectHosts: HOSTS },
  retell_ai: { key: 'retell_ai', name: 'Retell AI', category: 'AI & Voice', authMethods: ['api_key'], defaultScopes: [], webhookCapable: true, syncCapable: false, allowedRedirectHosts: HOSTS },
  quickbooks: { key: 'quickbooks', name: 'QuickBooks', category: 'Accounting', authMethods: ['oauth2'], defaultScopes: ['com.intuit.quickbooks.accounting'], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  xero: { key: 'xero', name: 'Xero', category: 'Accounting', authMethods: ['oauth2'], defaultScopes: ['accounting.transactions', 'accounting.contacts'], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  google_business_profile: { key: 'google_business_profile', name: 'Google Business Profile', category: 'Reviews & Reputation', authMethods: ['oauth2'], defaultScopes: ['https://www.googleapis.com/auth/business.manage'], webhookCapable: false, syncCapable: true, allowedRedirectHosts: HOSTS },
  facebook_pages: { key: 'facebook_pages', name: 'Facebook Pages', category: 'Reviews & Reputation', authMethods: ['oauth2'], defaultScopes: ['pages_read_engagement', 'pages_manage_engagement'], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  google_calendar: { key: 'google_calendar', name: 'Google Calendar', category: 'Productivity', authMethods: ['oauth2'], defaultScopes: ['https://www.googleapis.com/auth/calendar'], webhookCapable: true, syncCapable: true, allowedRedirectHosts: HOSTS },
  gmail: { key: 'gmail', name: 'Gmail', category: 'Email', authMethods: ['oauth2'], defaultScopes: ['https://www.googleapis.com/auth/gmail.send'], webhookCapable: false, syncCapable: false, allowedRedirectHosts: HOSTS },
  outlook: { key: 'outlook', name: 'Outlook', category: 'Email', authMethods: ['oauth2'], defaultScopes: ['Mail.Send', 'offline_access'], webhookCapable: false, syncCapable: false, allowedRedirectHosts: HOSTS },
  hardware_connectors: { key: 'hardware_connectors', name: 'Hardware Connectors', category: 'Hardware', authMethods: ['api_key'], defaultScopes: [], webhookCapable: false, syncCapable: false, allowedRedirectHosts: HOSTS },
};

export function getProvider(key: string): ProviderDef | undefined { return PROVIDERS[key]; }

export function isApprovedProvider(key: string): boolean { return !!PROVIDERS[key]; }

// Redirect URIs must be https (localhost may be http for dev) and their host must be on the provider allowlist.
export function isAllowedRedirect(providerKey: string, redirectUri: string): boolean {
  const p = PROVIDERS[providerKey]; if (!p) return false;
  let u: URL; try { u = new URL(redirectUri); } catch { return false; }
  if (u.protocol !== 'https:' && !(u.hostname === 'localhost' && u.protocol === 'http:')) return false;
  return p.allowedRedirectHosts.includes(u.hostname);
}

// Scopes must be a subset of the provider's declared scopes (no unvalidated scope escalation).
export function scopesAllowed(providerKey: string, scopes: string[]): boolean {
  const p = PROVIDERS[providerKey]; if (!p) return false;
  return scopes.every((s) => p.defaultScopes.includes(s));
}

export type AdapterFactory = (key: string) => IntegrationAdapter | undefined;

export const defaultAdapterFactory: AdapterFactory = (key: string) => {
  const p = PROVIDERS[key]; if (!p) return undefined;
  return new ReferenceAdapter(p.key, p.category, p.authMethods, p.defaultScopes, p.webhookCapable, p.syncCapable);
};
