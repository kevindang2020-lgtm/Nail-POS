// integrations-production-config.ts — Payments / Twilio mandate §125–§126 (wave 3): validate the provider environment at
// STARTUP, not during the first live customer transaction. Pure; the API's production-config check folds these in.
// Tenant credentials live in the database (sealed) and are validated when saved (§164); what this checks is the
// process environment the adapters and webhooks depend on.
const on = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const SANDBOX_HOST = /uat|sandbox|test|staging|-dev\.|dev\.clover/i;

export function integrationsProductionProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const out: string[] = [];
  // §44 / §126: payment webhook signatures are verified over the EXACT bytes the processor signed
  if (!on(env.PAYMENTS_WEBHOOK_RAW_BODY)) out.push('PAYMENTS_WEBHOOK_RAW_BODY=1 is required in production: payment webhook signatures must be verified over the raw request bytes (§44)');
  // §125: no sandbox processor host behind a production process (the env gateway is already refused; the UAT tokenizer / Bolt hosts too)
  for (const k of ['CARDPOINTE_BASE_URL', 'FISERV_BASE_URL', 'CARDPOINTE_BOLT_BASE_URL', 'CLOVER_BASE_URL']) {
    const v = String(env[k] ?? '').trim();
    if (v && SANDBOX_HOST.test(v)) out.push(`${k} points at a sandbox / UAT host (${v}) — a production process must not name sandbox processor endpoints (§125)`);
  }
  // §126 / §157: a shared Twilio sender that is half-configured would make every salon's text fail at send time
  const sid = String(env.TWILIO_ACCOUNT_SID ?? '').trim(), tok = String(env.TWILIO_AUTH_TOKEN ?? '').trim(), from = String(env.TWILIO_FROM ?? '').trim();
  if ((sid || tok || from) && !(sid && tok && from)) out.push('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM must be set together (the shared sender is half-configured)');
  if (sid && !/^AC[0-9a-fA-F]{32}$/.test(sid)) out.push('TWILIO_ACCOUNT_SID is not an Account SID (AC + 32 hex)');
  if (from && !/^(\+[1-9]\d{6,15}|MG[0-9a-fA-F]{32})$/.test(from)) out.push('TWILIO_FROM must be an E.164 number or a Messaging Service SID (MG…)');
  // §126: the callback URLs Twilio must reach (inbound SMS / STOP, delivery status) need the public API base
  const base = String(env.PUBLIC_API_BASE_URL ?? env.APS_API_BASE ?? '').trim();
  if (sid && !base) out.push('PUBLIC_API_BASE_URL is required when Twilio is configured: inbound SMS (STOP / HELP) and delivery-status webhooks are registered from it (§70, §87)');
  if (base && !/^https:\/\//i.test(base)) out.push(`PUBLIC_API_BASE_URL must be https:// in production (webhooks carry signed provider payloads): ${base}`);
  const cb = String(env.TWILIO_STATUS_CALLBACK_URL ?? '').trim();
  if (cb && !/^https:\/\//i.test(cb)) out.push('TWILIO_STATUS_CALLBACK_URL must be https:// in production');
  return out;
}
