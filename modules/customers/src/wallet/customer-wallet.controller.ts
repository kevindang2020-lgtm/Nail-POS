// customer-wallet.controller.ts — customer-facing wallet read (/customer/wallet). Resolves the customer from the
// session (no ids from the client); returns balance + recent transactions. An unlinked session gets an honest empty
// wallet rather than an error. (Funding a top-up requires the per-tenant payment gateway — a separate endpoint.)
import { Controller, Get, Req } from '@nestjs/common';
import { WalletLedgerService } from './wallet.service';
import type { WalletState } from './wallet-ledger';

@Controller('customer')
export class CustomerWalletController {
  constructor(private readonly svc: WalletLedgerService) {}

  @Get('wallet')
  async wallet(@Req() r: any): Promise<WalletState> {
    const c = r?.ctx || {};
    const customerId = c.tenantId && c.userId ? await this.svc.resolveCustomerId(c.tenantId, c.userId) : null;
    if (!customerId) return { balanceCents: 0, currency: 'USD', transactions: [] };
    return this.svc.getWallet(c.tenantId, customerId);
  }
}
