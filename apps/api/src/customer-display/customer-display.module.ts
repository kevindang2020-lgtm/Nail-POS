// customer-display.module.ts — wires the customer display: the device-facing API (public, the display's own credential),
// the POS side of its devices and registers (/pos/customer-displays), and the pairing that joins them. Kysely-backed when
// a DB handle exists, else in-memory.
import { CustomerPhoneModule, CustomerPhoneUpdateService } from '@aipowersalon/booking';
import { CardPointeBoltClient, PaymentGatewayResolver, type BoltConfig, type FetchLike } from '@aipowersalon/payments';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { CheckoutModule, CheckoutService } from '@aipowersalon/checkout';
import { GoCheckInModule, GoCheckInService } from '@aipowersalon/queue';
import { DisplayAdvertisingModule, DisplayAdsPlaylistService } from '@aipowersalon/marketing';
import { instrumentedFetch } from '@aipowersalon/observability';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { CustomerDisplayController } from './customer-display.controller';
import { DisplayDevicesController } from './display-devices.controller';
import { PosTerminalPayController } from './pos-terminal-pay.controller';
import { CustomerDisplayService } from './customer-display.service';
import { DisplayDevicesService } from './display-devices.service';
import { InMemoryDisplayRepository, KyselyDisplayRepository, type DisplayDataPort } from './customer-display.repository';
import { KyselyDisplayPairingRepository, type DisplayPairingPort } from './display-pairing.repository';
import { InMemoryDisplayDevices, KyselyDisplayDevicesRepository, type DisplayDevicesPort } from './display-devices.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { TerminalCaptureService, type TerminalCapturePort } from './terminal-capture.service';
import { decryptSecret } from '../common/mfa-enc';

@Module({
  imports: [EventsCoreModule, GoCheckInModule, DisplayAdvertisingModule, CheckoutModule, CustomerPhoneModule],   // CustomerPhoneModule: the phone-change code on the display (Phase 3)
  controllers: [CustomerDisplayController, DisplayDevicesController, PosTerminalPayController],   // Fiserv §8B: front-desk Pay on Clover Compact
  providers: [
    { provide: 'DisplayDataPort', useFactory: (db: AppDatabase): DisplayDataPort => (db ? new KyselyDisplayRepository(db) : new InMemoryDisplayRepository()), inject: [DATABASE] },
    // 23-inch spec §8–§12, §86: one in-memory store backs BOTH ports without a database (a claimed code is a listed display)
    { provide: 'DisplayDevicesMemory', useFactory: (): InMemoryDisplayDevices => new InMemoryDisplayDevices() },
    { provide: 'DisplayPairingPort', useFactory: (db: AppDatabase, mem: InMemoryDisplayDevices): DisplayPairingPort => (db ? new KyselyDisplayPairingRepository(db) : mem), inject: [DATABASE, 'DisplayDevicesMemory'] },
    { provide: 'DisplayDevicesPort', useFactory: (db: AppDatabase, mem: InMemoryDisplayDevices): DisplayDevicesPort => (db ? new KyselyDisplayDevicesRepository(db) : mem), inject: [DATABASE, 'DisplayDevicesMemory'] },
    { provide: DisplayDevicesService, useFactory: (pairing: DisplayPairingPort, devices: DisplayDevicesPort, rt: RealtimeEmitter) => new DisplayDevicesService(pairing, devices, rt), inject: ['DisplayPairingPort', 'DisplayDevicesPort', REALTIME] },
    {
      provide: 'TerminalCapturePort',
      useFactory: (db: AppDatabase, outbox: OutboxWriter, checkout: CheckoutService, paymentSecrets: PaymentSecrets): TerminalCapturePort | undefined => {
        if (!db) return undefined; // terminal capture is DB-backed only; without a DB the kiosk stays front-desk
        const transport: FetchLike = instrumentedFetch('cardpointe', (url, init) => (globalThis.fetch as unknown as FetchLike)(url, init), undefined, { timeoutMs: 180_000, breaker: false });   // authCard blocks while the customer taps; a customer who walks away is not a provider outage (Phase 2 breaker opt-out)
        // Phase 15 round 2: an approval is recorded through the canonical paid path, its domain events through this outbox
        // Phase 15 round 3: … and the POS's post-payment work (gift cards activated, deals redeemed, compensation, …) runs for it
        // wave 3 PAYI §13/§17: the Bolt key is routed (terminal → branch merchant → tenant default) and opened with the
        // PAYMENT secrets by the ONE provider router — never read off a table here.
        return new TerminalCaptureService(db, (cfg: BoltConfig) => new CardPointeBoltClient(cfg, transport), decryptSecret, undefined, undefined, undefined, outbox, undefined, checkout, new PaymentGatewayResolver(db, paymentSecrets));
      },
      inject: [DATABASE, OutboxWriter, CheckoutService, PAYMENT_SECRETS],
    },
    {
      provide: CustomerDisplayService,
      useFactory: (repo: DisplayDataPort, rt: RealtimeEmitter, tc: TerminalCapturePort | undefined, goCheckIn: GoCheckInService, ads: DisplayAdsPlaylistService, checkout: CheckoutService, devices: DisplayDevicesService, phone?: CustomerPhoneUpdateService) =>
        new CustomerDisplayService(repo, rt, tc, goCheckIn, ads, checkout, devices, phone ?? undefined),
      inject: ['DisplayDataPort', REALTIME, 'TerminalCapturePort', GoCheckInService, DisplayAdsPlaylistService, CheckoutService, DisplayDevicesService, { token: CustomerPhoneUpdateService, optional: true }],
    },
  ],
})
export class CustomerDisplayModule {}
