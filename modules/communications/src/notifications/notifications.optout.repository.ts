// notifications.optout.repository.ts — per-tenant notification opt-out store (SMS STOP / email unsubscribe).
import type { NotificationChannel } from './notifications-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { OptOutRow } from '@aipowersalon/api-contracts/tenant';
import type { OptOutRow } from '@aipowersalon/api-contracts/tenant';


/** who / what changed consent (741 notification_consent_events.source) */
export type ConsentSource = 'inbound_stop' | 'inbound_start' | 'staff' | 'phone_change' | 'system' | 'provider_bounce' | 'provider_complaint' | 'email_unsubscribe';
/** 748 (Email guide): an opt-out's reach — 'marketing' (an email unsubscribe link) never blocks a receipt or a booking
 *  confirmation; 'all' (STOP, a hard bounce, a spam complaint, staff) blocks every message on that channel. */
export type OptOutScope = 'all' | 'marketing';
export interface ConsentMeta { source: ConsentSource; actorUserId?: string | null; consentNote?: string | null; scope?: OptOutScope }

export interface OptOutPort {
  /** purpose 'marketing' also honours marketing-only unsubscribes; any other purpose honours only scope 'all' */
  isOptedOut(tenantId: string, channel: NotificationChannel, address: string, purpose?: string | null): Promise<boolean>;
  optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string, meta?: ConsentMeta): Promise<void>;
  optIn(tenantId: string, channel: NotificationChannel, address: string, meta?: ConsentMeta): Promise<void>;
  list(tenantId: string, limit: number): Promise<OptOutRow[]>;
  /** how the CURRENT opt-out was recorded (the latest opt-out event), or null when not opted out */
  currentOptOutSource?(tenantId: string, channel: NotificationChannel, address: string): Promise<string | null>;
}

export class InMemoryOptOutRepository implements OptOutPort {
  private rows: OptOutRow[] = [];
  private key(t: string, c: string, a: string) { return `${t}|${c}|${a}`; }

  private scopes = new Map<string, OptOutScope>();
  async isOptedOut(tenantId: string, channel: NotificationChannel, address: string, purpose?: string | null): Promise<boolean> {
    const k = this.key(tenantId, channel, address);
    if (!this.rows.some((r) => this.key(r.tenantId, r.channel, r.address) === k)) return false;
    return (this.scopes.get(k) ?? 'all') === 'all' || purpose === 'marketing';
  }
  async optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string, meta?: ConsentMeta): Promise<void> {
    const k = this.key(tenantId, channel, address); const scope = meta?.scope ?? 'all';
    if (this.rows.some((r) => this.key(r.tenantId, r.channel, r.address) === k)) { if (scope === 'all') this.scopes.set(k, 'all'); return; }
    this.rows.unshift({ tenantId, channel, address, reason: reason ?? null, optedOutAt: new Date().toISOString() });
    this.scopes.set(k, scope);
  }
  async optIn(tenantId: string, channel: NotificationChannel, address: string, _meta?: ConsentMeta): Promise<void> {
    this.rows = this.rows.filter((r) => this.key(r.tenantId, r.channel, r.address) !== this.key(tenantId, channel, address));
    this.scopes.delete(this.key(tenantId, channel, address));
  }
  async list(tenantId: string, limit: number): Promise<OptOutRow[]> {
    return this.rows.filter((r) => r.tenantId === tenantId).slice(0, Math.max(1, limit));
  }
}
