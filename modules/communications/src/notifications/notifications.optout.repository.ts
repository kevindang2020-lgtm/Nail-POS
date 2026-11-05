// notifications.optout.repository.ts — per-tenant notification opt-out store (SMS STOP / email unsubscribe).
import type { NotificationChannel } from './notifications-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { OptOutRow } from '@aipowersalon/api-contracts/tenant';
import type { OptOutRow } from '@aipowersalon/api-contracts/tenant';


export interface OptOutPort {
  isOptedOut(tenantId: string, channel: NotificationChannel, address: string): Promise<boolean>;
  optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string): Promise<void>;
  optIn(tenantId: string, channel: NotificationChannel, address: string): Promise<void>;
  list(tenantId: string, limit: number): Promise<OptOutRow[]>;
}

export class InMemoryOptOutRepository implements OptOutPort {
  private rows: OptOutRow[] = [];
  private key(t: string, c: string, a: string) { return `${t}|${c}|${a}`; }

  async isOptedOut(tenantId: string, channel: NotificationChannel, address: string): Promise<boolean> {
    return this.rows.some((r) => this.key(r.tenantId, r.channel, r.address) === this.key(tenantId, channel, address));
  }
  async optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string): Promise<void> {
    if (await this.isOptedOut(tenantId, channel, address)) return;
    this.rows.unshift({ tenantId, channel, address, reason: reason ?? null, optedOutAt: new Date().toISOString() });
  }
  async optIn(tenantId: string, channel: NotificationChannel, address: string): Promise<void> {
    this.rows = this.rows.filter((r) => this.key(r.tenantId, r.channel, r.address) !== this.key(tenantId, channel, address));
  }
  async list(tenantId: string, limit: number): Promise<OptOutRow[]> {
    return this.rows.filter((r) => r.tenantId === tenantId).slice(0, Math.max(1, limit));
  }
}
