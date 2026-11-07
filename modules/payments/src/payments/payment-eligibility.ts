// payment-eligibility.ts — Fiserv master build §5 (Nov 4 2026): technical configuration is NOT permission to charge.
//
// Pure functions (no I/O), used by PaymentGatewayResolver on EVERY build of a processor / terminal config, and by the
// configuration writers before a row is saved:
//
//   1. classifyProviderHost — the stored base URL must be an https host on the provider's own domain, and its
//      environment (UAT vs production) must match the row's `environment`. Arbitrary domains, http, and UAT↔production
//      mix-ups are refused (§5.3) — the resolver used to build adapters from any DB-stored base_url.
//   2. processModeProblem — the PROCESS declares whether it may move live money (PAYMENTS_LIVE_MODE=1). Default is
//      UAT-only: a production merchant row is refused. A live-mode process refuses sandbox rows ("production code sees a
//      UAT host → hard fail", §8F).
//   3. productionEligibility — a production charge additionally needs the platform's written Fiserv validation, the
//      merchant's Fiserv boarding approval, verified credentials and an explicit production enablement (§5.1).
// Anything not proven → a reason string; callers FAIL CLOSED (no processor is built, no authorization is attempted).

export type ProviderKind = 'gateway' | 'bolt' | 'clover';
export type HostEnvironment = 'uat' | 'production';

export interface HostCheck { ok: boolean; environment?: HostEnvironment; reason?: string }

const UAT_MARK = /(^|[.-])(uat|sandbox|test|dev|staging)([.-]|$)/i;

/** Is `url` an approved provider host for `kind`, and is it UAT or production? */
export function classifyProviderHost(kind: ProviderKind, url: string | null | undefined): HostCheck {
  if (!url) return { ok: false, reason: 'HOST_MISSING' };
  let u: URL;
  try { u = new URL(String(url)); } catch { return { ok: false, reason: 'HOST_INVALID' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'HOST_NOT_HTTPS' };
  if (u.username || u.password) return { ok: false, reason: 'HOST_HAS_CREDENTIALS' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'HOST_PORT_NOT_ALLOWED' };
  const h = u.hostname.toLowerCase();
  const onDomain =
    kind === 'gateway' ? /^[a-z0-9-]+\.cardconnect\.com$/.test(h)
    : kind === 'bolt' ? /^[a-z0-9-]+(\.bolt)?\.cardpointe\.com$/.test(h)
    : h === 'scl.clover.com' || h === 'scl-sandbox.dev.clover.com';
  if (!onDomain) return { ok: false, reason: 'HOST_NOT_ALLOWLISTED' };
  return { ok: true, environment: UAT_MARK.test(h) ? 'uat' : 'production' };
}

/** The row's environment ('sandbox' | 'production') must match the host's. */
export function hostMatchesEnvironment(kind: ProviderKind, url: string | null | undefined, rowEnvironment: string | null | undefined): HostCheck {
  const c = classifyProviderHost(kind, url);
  if (!c.ok) return c;
  const want: HostEnvironment = rowEnvironment === 'production' ? 'production' : 'uat';
  if (c.environment !== want) return { ok: false, environment: c.environment, reason: want === 'production' ? 'UAT_HOST_ON_PRODUCTION_MERCHANT' : 'PRODUCTION_HOST_ON_SANDBOX_MERCHANT' };
  return c;
}

const on = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

/** May THIS process use a merchant row of `rowEnvironment`? */
export function processModeProblem(rowEnvironment: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const live = on(env.PAYMENTS_LIVE_MODE);
  const isProd = rowEnvironment === 'production';
  if (isProd && !live) return 'PRODUCTION_DISABLED_IN_THIS_DEPLOYMENT';
  if (!isProd && live) return 'SANDBOX_MERCHANT_IN_LIVE_DEPLOYMENT';
  return null;
}

export interface PlatformValidation { status: string | null; fiservReference?: string | null; validatedAt?: string | Date | null }
export interface MerchantProductionFacts {
  environment: string | null;
  onboardingStatus: string | null;
  credentialsVerifiedAt: string | Date | null;
  productionEnabledAt: string | Date | null;
}

/** §5.1 — every condition must hold for a production charge. Sandbox rows are not judged here (UAT policy). */
export function productionEligibility(platform: PlatformValidation | null, platformProductionEnabled: boolean, m: MerchantProductionFacts): { ok: boolean; reason?: string } {
  if (m.environment !== 'production') return { ok: true };
  if (!platform || platform.status !== 'approved' || !platform.fiservReference || !platform.validatedAt) return { ok: false, reason: 'PLATFORM_NOT_VALIDATED_BY_FISERV' };
  if (!platformProductionEnabled) return { ok: false, reason: 'PLATFORM_PRODUCTION_DISABLED' };
  if (m.onboardingStatus !== 'approved') return { ok: false, reason: 'MERCHANT_NOT_BOARDED' };
  if (!m.credentialsVerifiedAt) return { ok: false, reason: 'MERCHANT_CREDENTIALS_NOT_VERIFIED' };
  if (!m.productionEnabledAt) return { ok: false, reason: 'MERCHANT_PRODUCTION_NOT_ENABLED' };
  return { ok: true };
}
