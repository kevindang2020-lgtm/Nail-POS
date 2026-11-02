// booking-deposits.module.ts — D11 (Oct 21 2026): ONE provider of the deposit domain, imported by the customer booking
// module (create / pay) and the POS booking module (cancel / no-show), so both act on the same rows through the same rules.
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { BookingDepositService, type DepositGatewayPort } from './booking-deposit.service';

/** the ONE provider router, bound by the API under this string token (payments' PaymentGatewayModule) — §105: booking never imports payments */
export const PAYMENT_GATEWAY_TOKEN = 'PAYMENT_GATEWAY';

/** the string token the checkout domain binds the deposit port by (checkout never imports booking) */
export const BOOKING_DEPOSITS_TOKEN = 'BOOKING_DEPOSITS';

@Global()
@Module({
  imports: [EventsCoreModule],
  providers: [
    // DB-backed only: without a database (or without the payment gateway bound) there is no deposit (null) and bookings proceed without one.
    { provide: BookingDepositService, useFactory: (db: AppDatabase, outbox: OutboxWriter, gateway: DepositGatewayPort | null) => (db && gateway ? new BookingDepositService(db, gateway, outbox) : null), inject: [DATABASE, OutboxWriter, { token: PAYMENT_GATEWAY_TOKEN, optional: true }] },
    { provide: BOOKING_DEPOSITS_TOKEN, useExisting: BookingDepositService },
  ],
  exports: [BookingDepositService, BOOKING_DEPOSITS_TOKEN],
})
export class BookingDepositsModule {}
