// terminal-probe.module.ts — Payments mandate §166 (wave 3): "Test Terminal Connection" verifies terminal readiness
// WITHOUT charging. The tenants module (Settings → Payments → Terminals) asks through the TerminalProbePort; this module
// answers with a Bolt ping (CardPointe Integrated Terminal: connect + ping for the terminal's HSN) through THE provider
// router (terminal's merchant → branch merchant → tenant default; the key opened with the payment secrets). @Global so
// the tenants module can inject the token without depending on @aipowersalon/payments (ai → tenants → payments would
// be a cycle).
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { CardPointeBoltClient, PaymentGatewayResolver, type BoltConfig, type FetchLike, type TerminalDevicePort } from '@aipowersalon/payments';
import { TERMINAL_PROBE_PORT, type TerminalProbePort } from '@aipowersalon/tenants';
import { instrumentedFetch } from '@aipowersalon/observability';

export type ProbeDeviceFactory = (cfg: BoltConfig) => Pick<TerminalDevicePort, 'ping'>;

/** Pure of Nest: tests build it with a fake device factory. */
export function terminalProbe(router: Pick<PaymentGatewayResolver, 'resolveTerminalConfig'>, device: ProbeDeviceFactory): TerminalProbePort {
  return {
    async probe(ctx, terminal) {
      if (!terminal.hsn) return { probed: false, reachable: false, detail: 'this terminal has no HSN — enter the Clover\'s serial (HSN) to test it' };
      const r = await router.resolveTerminalConfig(ctx.tenantId, ctx.branchId, terminal.merchantAccountId);
      if (!r.config) {
        const detail = r.reason === 'MERCHANT_SUSPENDED' ? 'card payments for this location are paused (MERCHANT_SUSPENDED)'
          : r.reason === 'SECRET_UNREADABLE' ? 'the terminal API key could not be opened — ask AIPowerSalon support to re-enter it'
          : r.reason === 'MERCHANT_NOT_CONFIGURED' ? 'no active merchant account for this location (MERCHANT_NOT_CONFIGURED)'
          : r.reason === 'MERCHANT_BRANCH_MISMATCH' ? 'this terminal belongs to a different location\'s merchant account (MERCHANT_BRANCH_MISMATCH)'
          : r.reason === 'HOST_NOT_ALLOWED' ? 'the terminal API address is not an approved Fiserv host for this environment (HOST_NOT_ALLOWED)'
          : r.reason === 'PRODUCTION_NOT_APPROVED' ? 'live card payments are not approved for this merchant yet (PRODUCTION_NOT_APPROVED)'
          : 'the terminal API (Bolt) is not configured for this location (TERMINAL_NOT_CONFIGURED)';
        return { probed: false, reachable: false, detail };
      }
      let ok = false;
      try { ok = await device(r.config).ping(terminal.hsn); } catch { ok = false; }
      return { probed: true, reachable: ok, detail: ok ? 'the terminal answered the ping' : 'the terminal did not answer — check that it is powered on, online and registered with the processor' };
    },
  };
}

@Global()
@Module({
  providers: [{
    provide: TERMINAL_PROBE_PORT,
    useFactory: (db: AppDatabase, secrets: PaymentSecrets): TerminalProbePort | undefined => {
      if (!db) return undefined;
      const transport: FetchLike = instrumentedFetch('cardpointe', (url, init) => (globalThis.fetch as unknown as FetchLike)(url, init), undefined, { timeoutMs: 20_000 });
      return terminalProbe(new PaymentGatewayResolver(db, secrets), (cfg) => new CardPointeBoltClient(cfg, transport));
    },
    inject: [DATABASE, PAYMENT_SECRETS],
  }],
  exports: [TERMINAL_PROBE_PORT],
})
export class TerminalProbeModule {}
