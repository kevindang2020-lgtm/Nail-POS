import { storedDateString } from '@aipowersalon/customers';
import { type SmsSender, type EmailSender, type TenantMessenger, type MessagePurpose, MessengerSmsSender } from '@aipowersalon/notifications';
// customer.service.ts — customer-app orchestration & validation. Resolves the customer from the session, composes the
// pure core for home/loyalty/service-progress, and validates profile updates. No I/O beyond the injected port.
import { buildCustomerHome, loyaltySummary, serviceProgress } from './customer-core';
import type { CustomerHome, CustomerLoyaltySummary, CustomerActiveService, CustomerAppointmentItem, CustomerReceiptItem, UpdateCustomerProfileRequest , CustomerNotificationsResult, CustomerGiftCard, CustomerAddress, CreateAddressRequest, CustomerDeal, CustomerReferral, CustomerProfile, CustomerCheckInResult, RewardsView, RedeemResult} from './customer.dto';
import type { CustomerContext, CustomerDataPort } from './customer.repository';

import { computeQueueState, type CustomerQueueState } from './customer-queue';
import { mintClaimToken, hashClaimToken, claimValidity, CLAIM_TTL_DAYS } from '@aipowersalon/gift-cards';
import { buildMediaUrl } from '@aipowersalon/media';
import type { AuditService } from '@aipowersalon/audit';

export type CustomerErrorCode = 'not_customer' | 'invalid';
export class CustomerError extends Error {
  constructor(public code: CustomerErrorCode, message: string) { super(message); this.name = 'CustomerError'; }
}

const validPhone = (p?: string) => !p || /^[+()\-\s\d]{7,}$/.test(p);
const validEmail = (e?: string) => !e || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
// a REAL calendar date (2026-02-30 used to reach the database and fail as a 500) — Birthday Campaigns §05
const validBirthday = (b?: string) => b === undefined || b === '' || (/^\d{4}-\d{2}-\d{2}$/.test(b) && storedDateString(b) !== null);

export class CustomerService {
  constructor(private readonly repo: CustomerDataPort, private readonly sms: SmsSender = { send: async () => ({ sid: 'noop' }) }, private readonly audit?: AuditService, private readonly email: EmailSender = { send: async () => ({ id: 'noop' }) },
    /** Phase 2: the tenant messenger — a customer's texts are the salon's (its number, ledger, communication.* events). */
    private readonly messenger?: TenantMessenger,
    /** D11 (Oct 21 2026): the deposit ends with the guest's cancellation — refunded inside the window, forfeited late. */
    private readonly deposits?: { onCancelled(ctx: { tenantId: string; branchId?: string | null; userId?: string | null }, appointmentId: string, by: 'customer' | 'salon'): Promise<unknown> } | null) {}

  /** The salon's sender for one text; the env sender only where the messenger is not loaded (module tests). */
  private smsFor(ctx: CustomerContext, purpose: MessagePurpose, customerId: string | null): Pick<SmsSender, 'send'> {
    return this.messenger ? new MessengerSmsSender(this.messenger, { tenantId: ctx.tenantId, purpose, customerId }) : this.sms;
  }

  async resolveCustomerId(ctx: CustomerContext): Promise<string | null> {
    return this.repo.resolveCustomerId(ctx);
  }

  private async requireCustomer(ctx: CustomerContext): Promise<string> {
    const id = await this.repo.resolveCustomerId(ctx);
    if (!id) throw new CustomerError('not_customer', 'No customer profile is linked to this account.');
    return id;
  }

  // ── Default salon (Kevin, Oct 3 2026): chosen at sign-up from the salon list / nearby, changeable later ──
  async getHomeSalon(ctx: CustomerContext) {
    const id = await this.requireCustomer(ctx);
    return (await this.repo.homeSalon?.(ctx, id)) ?? null;
  }
  async setHomeSalon(ctx: CustomerContext, salonId: unknown) {
    const id = await this.requireCustomer(ctx);
    const sid = String(salonId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new CustomerError('invalid', 'Choose a salon.');
    if (!this.repo.setHomeSalon) throw new CustomerError('invalid', 'Changing your salon is not available yet.');
    const r = await this.repo.setHomeSalon(ctx, id, sid);
    if (!r.ok) throw new CustomerError('invalid', r.message || 'That salon is not available.');
    void this.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, {
      module: 'customer', action: 'home_salon_changed', resourceType: 'customers', resourceId: id,
      summary: `Chose ${r.salonName ?? 'a salon'} as their default salon`, metadata: { salonId: sid, requiresSignIn: !!r.requiresSignIn },
    });
    return r;
  }

  async getHome(ctx: CustomerContext, nowMs?: number): Promise<CustomerHome> {
    const customerId = await this.requireCustomer(ctx);
    const [raw, tiers] = await Promise.all([this.repo.homeRaw(ctx, customerId), this.repo.getLoyaltyConfig(ctx)]);
    raw.avatarUrl = buildMediaUrl(raw.avatarUrl ?? null);
    return buildCustomerHome({ ...raw, tiers, nowMs });
  }

  async getLoyalty(ctx: CustomerContext): Promise<CustomerLoyaltySummary> {
    const customerId = await this.requireCustomer(ctx);
    const [points, tiers] = await Promise.all([this.repo.loyaltyPoints(ctx, customerId), this.repo.getLoyaltyConfig(ctx)]);
    return loyaltySummary(points, tiers);
  }

  async getAppointments(ctx: CustomerContext): Promise<CustomerAppointmentItem[]> {
    return this.repo.appointments(ctx, await this.requireCustomer(ctx));
  }

  async getReceipts(ctx: CustomerContext): Promise<CustomerReceiptItem[]> {
    return this.repo.receipts(ctx, await this.requireCustomer(ctx));
  }

  async getServiceProgress(ctx: CustomerContext, nowMs?: number): Promise<CustomerActiveService | null> {
    if (!(await this.repo.serviceProgressEnabled(ctx))) return null; // §26: tenant disabled customer visibility
    const customerId = await this.requireCustomer(ctx);
    const raw = await this.repo.activeService(ctx, customerId);
    if (!raw) return null;
    const p = serviceProgress(raw.startedAt, raw.durationMinutes, nowMs);
    return { ticketId: raw.ticketId, serviceName: raw.serviceName, status: raw.status, startedAt: raw.startedAt, elapsedSeconds: p.elapsedSeconds, progressPercent: p.progressPercent, estimatedFinishTime: p.estimatedFinishTime };
  }

  async getSalon(ctx: CustomerContext) { return this.repo.salonInfo(ctx); }

  /**
   * "Verify my phone number" — DELEGATED to the canonical phone service (BUILD_PLAN Phase 3, audit duplicate #1).
   * This used to be a second OTP implementation: a code generated here, hashed into customer_phone_verifications, sent
   * on the platform's Twilio, and a third notion of "verified" stamped straight onto customers.phone_verified_at. Now the
   * code is the salon's (booking verification on the tenant's Twilio), the number becomes active_verified through the one
   * activation path, and customer.phone_verified is recorded by it.
   */
  async getRewards(ctx: CustomerContext): Promise<RewardsView> {
    const id = await this.repo.resolveCustomerId(ctx);
    if (!id) return { points: 0, rewards: [] };
    return this.repo.listRewards(ctx, id);
  }

  async redeemReward(ctx: CustomerContext, rewardId: string): Promise<RedeemResult> {
    const id = await this.repo.resolveCustomerId(ctx);
    if (!id) return { ok: false, message: 'Not a customer account.' };
    return this.repo.redeemReward(ctx, id, rewardId);
  }

  async checkIn(ctx: CustomerContext, appointmentId: string): Promise<CustomerCheckInResult> {
    const id = await this.repo.resolveCustomerId(ctx);
    if (!id) return { ok: false, message: 'Not a customer account.' };
    return this.repo.checkInAppointment(ctx, id, appointmentId);
  }

  async getProfile(ctx: CustomerContext): Promise<CustomerProfile | null> {
    const id = await this.repo.resolveCustomerId(ctx);
    return id ? this.repo.profile(ctx, id) : null;
  }

  async getAddresses(ctx: CustomerContext): Promise<CustomerAddress[]> {
    const id = await this.repo.resolveCustomerId(ctx);
    return id ? this.repo.listAddresses(ctx, id) : [];
  }
  async addAddress(ctx: CustomerContext, body: CreateAddressRequest): Promise<CustomerAddress> {
    const id = await this.requireCustomer(ctx);
    const line1 = (body?.line1 ?? '').trim();
    if (!line1) throw new CustomerError('invalid', 'Street address is required.');
    return this.repo.createAddress(ctx, id, { ...body, line1 });
  }
  async removeAddress(ctx: CustomerContext, addressId: string): Promise<{ ok: boolean }> {
    const id = await this.repo.resolveCustomerId(ctx);
    return id ? { ok: await this.repo.deleteAddress(ctx, id, addressId) } : { ok: false };
  }
  async makeDefaultAddress(ctx: CustomerContext, addressId: string): Promise<{ ok: boolean }> {
    const id = await this.repo.resolveCustomerId(ctx);
    return id ? { ok: await this.repo.setDefaultAddress(ctx, id, addressId) } : { ok: false };
  }
  async getDeals(ctx: CustomerContext): Promise<CustomerDeal[]> { return this.repo.listDeals(ctx); }
  async getReferral(ctx: CustomerContext): Promise<CustomerReferral | null> {
    const id = await this.repo.resolveCustomerId(ctx);
    if (!id) return null;
    const code = await this.repo.getOrCreateReferralCode(ctx, id);
    const o = this.repo.referralOffer ? await this.repo.referralOffer(ctx) : { salonName: null, offer: null };
    const $ = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
    const where = o.salonName ? ` at ${o.salonName}` : '';
    // the share text promises money ONLY when the salon has a live, funded offer (Refer a Friend build R031)
    const shareMessage = o.offer
      ? `Get ${$(o.offer.friendRewardCents)} off your first visit${where}${o.offer.minSpendCents ? ` (minimum spend ${$(o.offer.minSpendCents)})` : ''}! Use my code ${code} when you sign up.`
      : `Book your next appointment${where} with me! Use my code ${code} when you sign up.`;
    return { code, shareMessage, salonName: o.salonName, offer: o.offer };
  }

  async getNotifications(ctx: CustomerContext): Promise<CustomerNotificationsResult> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) return { unreadCount: 0, items: [] };
    const items = await this.repo.notifications(ctx, customerId);
    return { unreadCount: items.filter((n) => !n.readAt).length, items };
  }
  async getGiftCards(ctx: CustomerContext): Promise<{ cards: CustomerGiftCard[]; totalBalanceCents: number }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) return { cards: [], totalBalanceCents: 0 };
    const cards = await this.repo.giftCards(ctx, customerId);
    const totalBalanceCents = cards.filter((c) => c.status === 'active' || c.status === 'partially_redeemed').reduce((a, c) => a + c.balanceCents, 0);
    return { cards, totalBalanceCents };
  }

  // Send-to-friend (§10) — create a claim token for a card the customer owns, and return the raw token so the app can
  // build a shareable claim link. The card must be owned by the sender, active, and have a balance. Actual SMS/email
  // delivery and non-account-recipient phone verification are later phases; the token itself is the transfer mechanism.
  async sendGiftCard(ctx: CustomerContext, cardId: string, body: { name?: string; phone?: string; email?: string; message?: string }): Promise<{ claimToken: string; expiresAt: string; claimUrl: string | null; delivery?: { channel: string; status: string } }> {
    const senderId = await this.requireCustomer(ctx);
    const card = await this.repo.giftCardForTransfer(ctx, senderId, cardId);
    if (!card) throw new CustomerError('invalid', 'Gift card not found.');
    if (!(card.status === 'active' || card.status === 'partially_redeemed') || card.balanceCents <= 0) throw new CustomerError('invalid', 'This gift card can\u2019t be sent \u2014 it must be active with a remaining balance.');
    const phone = (body.phone || '').trim() || undefined;
    const email = (body.email || '').trim() || undefined;
    if (!phone && !email) throw new CustomerError('invalid', 'Enter the recipient\u2019s phone number or email.');
    if (!validPhone(phone)) throw new CustomerError('invalid', 'That phone number doesn\u2019t look right.');
    if (!validEmail(email)) throw new CustomerError('invalid', 'That email address doesn\u2019t look right.');
    const { token, tokenHash } = mintClaimToken();
    const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000);
    const { senderName } = await this.repo.createGiftCardClaim(ctx, { cardId, senderCustomerId: senderId, tokenHash, recipientName: (body.name || '').trim() || undefined, recipientPhone: phone, recipientEmail: email, message: (body.message || '').trim() || undefined, expiresAt });

    // Build the shareable claim link (customer web app base URL, mirrors PUBLIC_BOOKING_BASE_URL).
    const base = (process.env.PUBLIC_CUSTOMER_BASE_URL || '').replace(/\/+$/, '');
    const claimUrl = base ? `${base}/gift-cards/claim?token=${encodeURIComponent(token)}` : null;

    // Best-effort delivery. SMS goes out via the salon's provider; if it isn't configured or fails, the sender still has
    // the link to share. If an email provider is configured the link is emailed; otherwise it's recorded pending.
    const amount = (card.balanceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const lead = senderName ? `${senderName} sent you` : 'You have been sent';
    let delivery: { channel: string; status: string } | undefined;
    if (phone && claimUrl) {
      const smsBody = `${lead} a ${amount} gift card! Tap to claim: ${claimUrl} - expires in ${CLAIM_TTL_DAYS} days.`;
      try {
        const r = await this.smsFor(ctx, 'notification', null).send(phone, smsBody);
        await this.repo.recordGiftCardDelivery(ctx, { cardId, channel: 'sms', destination: phone, status: 'sent', providerMessageId: r.sid });
        delivery = { channel: 'sms', status: 'sent' };
      } catch (e: any) {
        await this.repo.recordGiftCardDelivery(ctx, { cardId, channel: 'sms', destination: phone, status: 'failed', failureReason: String(e?.message || 'sms_failed').slice(0, 200) });
        delivery = { channel: 'sms', status: 'failed' };
      }
    } else if (email && claimUrl) {
      const subject = senderName ? `${senderName} sent you a gift card` : 'You received a gift card';
      const emailBody = `${lead} a ${amount} gift card!\n\nClaim it here: ${claimUrl}\n\nThis link works once and expires in ${CLAIM_TTL_DAYS} days.`;
      try {
        const r = await this.email.send(email, subject, emailBody);
        await this.repo.recordGiftCardDelivery(ctx, { cardId, channel: 'email', destination: email, status: 'sent', providerMessageId: r.id });
        delivery = { channel: 'email', status: 'sent' };
      } catch (e: any) {
        await this.repo.recordGiftCardDelivery(ctx, { cardId, channel: 'email', destination: email, status: 'failed', failureReason: String(e?.message || 'email_failed').slice(0, 200) });
        delivery = { channel: 'email', status: 'failed' };
      }
    } else if (email) {
      // No base URL configured — can't build a claim link; record the intent and return the (null) link for manual sharing.
      await this.repo.recordGiftCardDelivery(ctx, { cardId, channel: 'email', destination: email, status: 'pending' });
      delivery = { channel: 'email', status: 'pending' };
    }
    void this.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, {
      module: 'gift_card', action: 'sent', resourceType: 'gift_cards', resourceId: cardId,
      summary: `Sent a gift card (${(card.balanceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`,
      metadata: { balanceCents: card.balanceCents, channel: delivery?.channel ?? null, deliveryStatus: delivery?.status ?? null },
    });
    return { claimToken: token, expiresAt: expiresAt.toISOString(), claimUrl, delivery };
  }

  // Claim a gift card sent to me: re-hash the presented token, validate (unclaimed, unrevoked, unexpired), and transfer
  // ownership to the claimer. Single-use is enforced atomically in the repo. Returns a safe summary (no code).
  async claimGiftCard(ctx: CustomerContext, token: string): Promise<{ ok: boolean; reference?: string; balanceCents?: number; senderName?: string; message?: string; reason?: string }> {
    const claimerId = await this.requireCustomer(ctx);
    const t = (token || '').trim();
    if (!t) throw new CustomerError('invalid', 'This claim link is missing its code.');
    const claim = await this.repo.findGiftCardClaimByHash(ctx, hashClaimToken(t));
    const v = claimValidity(claim, Date.now());
    if (!v.ok) return { ok: false, reason: v.reason };
    const res = await this.repo.claimGiftCardTransfer(ctx, claim!.id, claim!.giftCardId, claimerId);
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    void this.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, {
      module: 'gift_card', action: 'claimed', resourceType: 'gift_cards', resourceId: claim!.giftCardId,
      summary: `Claimed a gift card (${res.reference || ''})`,
      metadata: { balanceCents: res.balanceCents ?? null, reference: res.reference ?? null },
    });
    return { ok: true, reference: res.reference, balanceCents: res.balanceCents, senderName: res.senderName, message: res.message };
  }

  // §22 report lost/stolen: the owner freezes their own card from the app (steps 1–2). A replacement card is issued
  // later by staff at the salon. Freezing protects the balance and kills any outstanding barcode.
  async reportLostGiftCard(ctx: CustomerContext, cardId: string): Promise<{ ok: boolean; reason?: string }> {
    const customerId = await this.requireCustomer(ctx);
    const res = await this.repo.reportGiftCardLost(ctx, customerId, cardId);
    if (res.ok) {
      void this.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, {
        module: 'gift_card', action: 'reported_lost', resourceType: 'gift_cards', resourceId: cardId,
        summary: 'Customer reported a gift card lost/stolen; card frozen pending replacement',
      });
    }
    return res;
  }
  async markNotificationsRead(ctx: CustomerContext): Promise<{ ok: true }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (customerId) await this.repo.markNotificationsRead(ctx, customerId);
    return { ok: true };
  }
  async cancelAppointment(ctx: CustomerContext, appointmentId: string): Promise<{ ok: boolean; deposit?: unknown }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) return { ok: false };
    const ok = await this.repo.cancelAppointment(ctx, customerId, appointmentId);
    // D11: the guest cancelled — her deposit is refunded inside the salon's window, kept (forfeited) after it. The
    // cancellation stands either way; a refund the processor refuses surfaces as an error, never silently.
    const deposit = ok && this.deposits ? await this.deposits.onCancelled({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, appointmentId, 'customer') : undefined;
    return deposit ? { ok, deposit } : { ok };
  }

  async getQueue(ctx: CustomerContext, nowMs?: number): Promise<CustomerQueueState> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) return { inQueue: false };
    const raw = await this.repo.customerQueue(ctx, customerId);
    return computeQueueState(raw, nowMs);
  }

  async updateProfile(ctx: CustomerContext, body: UpdateCustomerProfileRequest): Promise<{ ok: true }> {
    const customerId = await this.requireCustomer(ctx);
    if (!validPhone(body.phone)) throw new CustomerError('invalid', 'Phone is not valid.');
    if (!validEmail(body.email)) throw new CustomerError('invalid', 'Email is not valid.');
    // Birthday Campaigns (750): a salon-recorded month/day-only birthday is read back as "--MM-DD"; the profile form sends it
    // back unchanged on every save — that is "no change", never a refusal and never a cleared birthday
    if (typeof body.birthday === 'string' && /^--\d{2}-\d{2}$/.test(body.birthday)) body = { ...body, birthday: undefined };
    if (!validBirthday(body.birthday)) throw new CustomerError('invalid', 'Birthday must be YYYY-MM-DD.');
    const nameTouched = body.firstName !== undefined || body.lastName !== undefined;
    const firstName = (body.firstName ?? '').trim();
    const lastName = (body.lastName ?? '').trim();
    if (nameTouched && (!firstName || !lastName)) throw new CustomerError('invalid', 'First and last name are required.');
    const patch: UpdateCustomerProfileRequest = {
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.marketingOptIn !== undefined ? { marketingOptIn: body.marketingOptIn } : {}),
      ...(body.smsOptIn !== undefined ? { smsOptIn: body.smsOptIn } : {}),
      ...(body.emailOptIn !== undefined ? { emailOptIn: body.emailOptIn } : {}),
      ...(nameTouched ? { firstName, lastName } : {}),
      ...(body.birthday !== undefined ? { birthday: body.birthday } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
    };
    await this.repo.updateProfile(ctx, customerId, patch);
    return { ok: true };
  }

  async setAvatar(ctx: CustomerContext, key: string): Promise<{ ok: true }> {
    const customerId = await this.requireCustomer(ctx);
    await this.repo.updateProfile(ctx, customerId, { avatarUrl: key });
    return { ok: true };
  }
}
