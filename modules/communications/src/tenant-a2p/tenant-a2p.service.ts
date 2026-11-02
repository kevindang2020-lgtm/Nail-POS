// tenant-a2p.service.ts — Super-Admin-driven orchestration of a salon's A2P 10DLC registration under the ISV account.
// Persists every Twilio SID + status to tenant_a2p_registrations and advances the overall status. Uses the ISV primary
// account credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). Honest: with no ISV credentials it returns
// not_configured and performs NO calls; it never fabricates SIDs. Fee-safe: mock=true uses Twilio's Mock brands.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { TwilioA2pClient, type A2pCreds } from './twilio-a2p-client';
import { TwilioTrustHubClient, type BusinessInfo, type TrustHubCreds } from './twilio-trusthub-client';

export type A2pOverallStatus = 'not_started' | 'brand_submitted' | 'brand_approved' | 'campaign_submitted' | 'campaign_approved' | 'number_attached' | 'live' | 'failed';

export interface A2pRegistrationView {
  tenantId: string; configured: boolean; status: A2pOverallStatus;
  brandSid: string | null; brandStatus: string | null;
  messagingServiceSid: string | null; campaignSid: string | null; campaignStatus: string | null;
  numberSid: string | null; isMock: boolean; lastError: string | null;
  secondaryProfileStatus: string | null; a2pProfileStatus: string | null; businessInfo: any | null;
  inputs: { customerProfileBundleSid: string | null; a2pProfileBundleSid: string | null; brandType: string; campaignUsecase: string | null };
}

// Pure: map Twilio brand + campaign statuses onto our overall status. Kept pure so it's unit-testable without Twilio.
export function deriveOverallStatus(cur: A2pOverallStatus, opts: { brandStatus?: string | null; campaignStatus?: string | null; numberAttached?: boolean }): A2pOverallStatus {
  const b = (opts.brandStatus || '').toUpperCase();
  const c = (opts.campaignStatus || '').toUpperCase();
  if (b === 'FAILED' || c === 'FAILED') return 'failed';
  if (opts.numberAttached) return 'live';
  if (c === 'VERIFIED' || c === 'APPROVED') return 'campaign_approved';
  if (c && c !== '') return 'campaign_submitted';
  if (b === 'APPROVED') return 'brand_approved';
  if (b && b !== '') return 'brand_submitted';
  return cur;
}

@Injectable()
export class TenantA2pService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService) {}

  private isvCreds(): A2pCreds | null {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    return accountSid && authToken ? { accountSid, authToken } : null;
  }
  private client(): TwilioA2pClient | null {
    const c = this.isvCreds();
    return c ? new TwilioA2pClient(c) : null;
  }

  private trustHubCreds(): TrustHubCreds | null {
    const c = this.isvCreds();
    const isvEmail = process.env.TWILIO_ISV_EMAIL || '';
    return c && isvEmail ? { ...c, isvEmail } : null;
  }
  private trustHub(): TwilioTrustHubClient | null {
    const c = this.trustHubCreds();
    return c ? new TwilioTrustHubClient(c) : null;
  }

  async get(tenantId: string): Promise<A2pRegistrationView> {
    const empty: A2pRegistrationView = { tenantId, configured: !!this.isvCreds(), status: 'not_started', brandSid: null, brandStatus: null, messagingServiceSid: null, campaignSid: null, campaignStatus: null, numberSid: null, isMock: false, lastError: null, secondaryProfileStatus: null, a2pProfileStatus: null, businessInfo: null, inputs: { customerProfileBundleSid: null, a2pProfileBundleSid: null, brandType: 'STANDARD', campaignUsecase: null } };
    if (!this.db) return empty;
    const res: any = await sql`SELECT * FROM tenant_a2p_registrations WHERE tenant_id = ${tenantId} LIMIT 1`.execute(this.db);
    const r = res.rows?.[0];
    if (!r) return empty;
    return this.toView(r);
  }

  private toView(r: any): A2pRegistrationView {
    return {
      tenantId: r.tenant_id, configured: !!this.isvCreds(), status: r.status,
      brandSid: r.brand_sid ?? null, brandStatus: r.brand_status ?? null,
      messagingServiceSid: r.messaging_service_sid ?? null, campaignSid: r.campaign_sid ?? null, campaignStatus: r.campaign_status ?? null,
      numberSid: r.number_sid ?? null, isMock: !!r.is_mock, lastError: r.last_error ?? null,
      secondaryProfileStatus: r.secondary_profile_status ?? null, a2pProfileStatus: r.a2p_profile_status ?? null, businessInfo: (typeof r.business_info === 'string' ? JSON.parse(r.business_info || 'null') : (r.business_info ?? null)),
      inputs: { customerProfileBundleSid: r.customer_profile_bundle_sid ?? null, a2pProfileBundleSid: r.a2p_profile_bundle_sid ?? null, brandType: r.brand_type ?? 'STANDARD', campaignUsecase: r.campaign_usecase ?? null },
    };
  }

  /** Save the registration inputs (bundle SIDs + campaign content) collected in Super Admin. No Twilio calls. */
  async saveInputs(actorUserId: string, tenantId: string, input: any): Promise<A2pRegistrationView> {
    if (!this.db) return this.get(tenantId);
    const samples = Array.isArray(input?.messageSamples) ? JSON.stringify(input.messageSamples) : JSON.stringify([]);
    await sql`
      INSERT INTO tenant_a2p_registrations (tenant_id, customer_profile_bundle_sid, a2p_profile_bundle_sid, brand_type, is_mock,
        campaign_usecase, campaign_description, message_samples, message_flow, opt_in_message, opt_out_message, help_message,
        privacy_policy_url, terms_and_conditions_url, has_embedded_links, has_embedded_phone, updated_by_user_id)
      VALUES (${tenantId}, ${input?.customerProfileBundleSid ?? null}, ${input?.a2pProfileBundleSid ?? null}, ${input?.brandType ?? 'STANDARD'}, ${!!input?.isMock},
        ${input?.campaignUsecase ?? null}, ${input?.campaignDescription ?? null}, ${samples}::jsonb, ${input?.messageFlow ?? null}, ${input?.optInMessage ?? null}, ${input?.optOutMessage ?? null}, ${input?.helpMessage ?? null},
        ${input?.privacyPolicyUrl ?? null}, ${input?.termsAndConditionsUrl ?? null}, ${!!input?.hasEmbeddedLinks}, ${!!input?.hasEmbeddedPhone}, ${actorUserId})
      ON CONFLICT (tenant_id) DO UPDATE SET
        customer_profile_bundle_sid = EXCLUDED.customer_profile_bundle_sid, a2p_profile_bundle_sid = EXCLUDED.a2p_profile_bundle_sid,
        brand_type = EXCLUDED.brand_type, is_mock = EXCLUDED.is_mock, campaign_usecase = EXCLUDED.campaign_usecase,
        campaign_description = EXCLUDED.campaign_description, message_samples = EXCLUDED.message_samples, message_flow = EXCLUDED.message_flow,
        opt_in_message = EXCLUDED.opt_in_message, opt_out_message = EXCLUDED.opt_out_message, help_message = EXCLUDED.help_message,
        privacy_policy_url = EXCLUDED.privacy_policy_url, terms_and_conditions_url = EXCLUDED.terms_and_conditions_url,
        has_embedded_links = EXCLUDED.has_embedded_links, has_embedded_phone = EXCLUDED.has_embedded_phone,
        updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
    `.execute(this.db);
    await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.inputs_saved', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: 'A2P registration inputs saved' }).catch(() => undefined);
    return this.get(tenantId);
  }

  private async row(tenantId: string): Promise<any | null> {
    if (!this.db) return null;
    const res: any = await sql`SELECT * FROM tenant_a2p_registrations WHERE tenant_id = ${tenantId} LIMIT 1`.execute(this.db);
    return res.rows?.[0] ?? null;
  }

  /** Save the salon's business identity info (collected in Super Admin) for TrustHub provisioning. No Twilio calls. */
  async saveBusinessInfo(actorUserId: string, tenantId: string, info: any): Promise<A2pRegistrationView> {
    await this.write(tenantId, { business_info: JSON.stringify(info || {}) });
    await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.business_info_saved', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: 'A2P business info saved' }).catch(() => undefined);
    return this.get(tenantId);
  }

  /**
   * Automate creation of the salon's Secondary Customer Profile + A2P profile bundle in TrustHub, then store the
   * resulting BU SIDs so the Brand step (submitBrand) can consume them. Runs the full documented sequence: customer
   * profile → business-info + authorized-rep end users → address + supporting document → entity assignments (incl. the
   * ISV Primary Profile) → evaluate → submit; then the A2P TrustProduct similarly. Honest: needs ISV creds +
   * TWILIO_ISV_EMAIL + TWILIO_PRIMARY_PROFILE_SID + business info; fabricates nothing and records the real Twilio error
   * on any failure. Cannot be live-validated from here — verify Policy SIDs + business-info fields with your account.
   */
  async provisionSecondaryProfile(actorUserId: string, tenantId: string): Promise<A2pRegistrationView> {
    const th = this.trustHub();
    if (!th) return this.fail(tenantId, 'ISV Twilio credentials + TWILIO_ISV_EMAIL are required.');
    const primarySid = process.env.TWILIO_PRIMARY_PROFILE_SID || '';
    if (!/^BU[0-9a-fA-F]{32}$/.test(primarySid)) return this.fail(tenantId, 'TWILIO_PRIMARY_PROFILE_SID (your approved ISV Primary Customer Profile, BU…) is required.');
    const r = await this.row(tenantId);
    const infoRaw = r?.business_info;
    const info: BusinessInfo | null = infoRaw ? (typeof infoRaw === 'string' ? JSON.parse(infoRaw) : infoRaw) : null;
    if (!info?.businessName || !info?.einTaxId || !info?.street || !info?.repFirstName || !info?.repEmail) {
      return this.fail(tenantId, 'Business info is incomplete (name, EIN/Tax ID, address, and an authorized representative are required).');
    }
    const name = info.businessName;
    try {
      // Secondary Customer Profile
      const cp = await th.createCustomerProfile(`${name} Secondary Profile`);
      await this.write(tenantId, { customer_profile_bundle_sid: cp.sid, secondary_profile_status: 'draft', last_error: null });
      const bi = await th.createBusinessInfoEndUser(`${name} Business Info`, info); await th.assignToCustomerProfile(cp.sid, bi.sid);
      const rep = await th.createAuthorizedRep(`${name} Auth Rep`, info); await th.assignToCustomerProfile(cp.sid, rep.sid);
      const addr = await th.createAddress(`${name} Address`, info);
      const doc = await th.createAddressSupportingDocument(`${name} Address Doc`, addr.sid); await th.assignToCustomerProfile(cp.sid, doc.sid);
      await th.assignToCustomerProfile(cp.sid, primarySid);
      const evalCp = await th.evaluateCustomerProfile(cp.sid);
      if (evalCp.status === 'compliant') { const sub = await th.submitCustomerProfile(cp.sid); await this.write(tenantId, { secondary_profile_status: sub.status }); }
      else { await this.write(tenantId, { secondary_profile_status: 'noncompliant', last_error: 'Secondary profile evaluation was noncompliant — check the business info fields.' }); return this.get(tenantId); }

      // A2P Messaging TrustProduct
      const tp = await th.createTrustProduct(`${name} A2P Profile`);
      const a2pEu = await th.createA2pMessagingEndUser(`${name} A2P Messaging Info`, (info as any).companyType || 'private_for_profit');
      await th.assignToTrustProduct(tp.sid, a2pEu.sid);
      await th.assignToTrustProduct(tp.sid, cp.sid);
      const evalTp = await th.evaluateTrustProduct(tp.sid);
      if (evalTp.status === 'compliant') { const subTp = await th.submitTrustProduct(tp.sid); await this.write(tenantId, { a2p_profile_bundle_sid: tp.sid, a2p_profile_status: subTp.status, last_error: null }); }
      else { await this.write(tenantId, { a2p_profile_bundle_sid: tp.sid, a2p_profile_status: 'noncompliant', last_error: 'A2P profile evaluation was noncompliant.' }); }

      await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.secondary_profile_provisioned', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: `Secondary profile ${cp.sid} + A2P profile provisioned` }).catch(() => undefined);
      return this.get(tenantId);
    } catch (e: any) {
      return this.fail(tenantId, String(e?.message || 'profile provisioning failed').replace(/^trusthub_failed:/, 'Twilio TrustHub: '));
    }
  }

  /** Submit the Brand to Twilio (real or mock). Requires ISV creds + the salon's bundle SIDs. */
  async submitBrand(actorUserId: string, tenantId: string): Promise<A2pRegistrationView> {
    const client = this.client();
    if (!client) return this.fail(tenantId, 'ISV Twilio credentials not configured (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).');
    const r = await this.row(tenantId);
    if (!r?.customer_profile_bundle_sid || !r?.a2p_profile_bundle_sid) return this.fail(tenantId, 'Secondary Customer Profile and A2P profile bundle SIDs are required first.');
    try {
      const brand = await client.createBrand({ customerProfileBundleSid: r.customer_profile_bundle_sid, a2pProfileBundleSid: r.a2p_profile_bundle_sid, brandType: r.brand_type || 'STANDARD', mock: !!r.is_mock });
      await this.write(tenantId, { brand_sid: brand.sid, brand_status: brand.status, status: deriveOverallStatus(r.status, { brandStatus: brand.status }), last_error: null });
      await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.brand_submitted', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: `A2P brand submitted (${brand.sid})`, metadata: { mock: !!r.is_mock } }).catch(() => undefined);
      return this.get(tenantId);
    } catch (e: any) { return this.fail(tenantId, String(e?.message || 'brand submission failed').replace(/^a2p_failed:/, 'Twilio: ')); }
  }

  /** Create the Messaging Service + submit the Campaign. Brand must be APPROVED first (Twilio rule). */
  async submitCampaign(actorUserId: string, tenantId: string): Promise<A2pRegistrationView> {
    const client = this.client();
    if (!client) return this.fail(tenantId, 'ISV Twilio credentials not configured.');
    const r = await this.row(tenantId);
    if (!r?.brand_sid) return this.fail(tenantId, 'Submit the brand first.');
    if ((r.brand_status || '').toUpperCase() !== 'APPROVED') return this.fail(tenantId, `Brand must be APPROVED before the campaign (currently ${r.brand_status || 'PENDING'}). Refresh status once TCR approves.`);
    if (!r.message_flow || !r.privacy_policy_url || !r.terms_and_conditions_url || !r.campaign_usecase) return this.fail(tenantId, 'Campaign use case, message flow, privacy policy URL, and terms URL are required.');
    try {
      let msgSid = r.messaging_service_sid;
      if (!msgSid) { const ms = await client.createMessagingService(`AIPowerSalon A2P ${tenantId.slice(0, 8)}`); msgSid = ms.sid; await this.write(tenantId, { messaging_service_sid: msgSid }); }
      const samples = Array.isArray(r.message_samples) ? r.message_samples : (typeof r.message_samples === 'string' ? JSON.parse(r.message_samples || '[]') : []);
      const camp = await client.createCampaign(msgSid, {
        brandRegistrationSid: r.brand_sid, description: r.campaign_description || '', messageSamples: samples, usAppToPersonUsecase: r.campaign_usecase,
        messageFlow: r.message_flow, optInMessage: r.opt_in_message, optOutMessage: r.opt_out_message, helpMessage: r.help_message,
        privacyPolicyUrl: r.privacy_policy_url, termsAndConditionsUrl: r.terms_and_conditions_url, hasEmbeddedLinks: !!r.has_embedded_links, hasEmbeddedPhone: !!r.has_embedded_phone,
      });
      await this.write(tenantId, { campaign_sid: camp.sid, campaign_status: camp.status, status: deriveOverallStatus(r.status, { brandStatus: r.brand_status, campaignStatus: camp.status }), last_error: null });
      await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.campaign_submitted', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: 'A2P campaign submitted' }).catch(() => undefined);
      return this.get(tenantId);
    } catch (e: any) { return this.fail(tenantId, String(e?.message || 'campaign submission failed').replace(/^a2p_failed:/, 'Twilio: ')); }
  }

  /** Attach a provisioned number (PN sid) to the salon's Messaging Service. Campaign should be approved first. */
  async attachNumber(actorUserId: string, tenantId: string, phoneNumberSid: string): Promise<A2pRegistrationView> {
    const client = this.client();
    if (!client) return this.fail(tenantId, 'ISV Twilio credentials not configured.');
    const r = await this.row(tenantId);
    if (!r?.messaging_service_sid) return this.fail(tenantId, 'Create the campaign (and its Messaging Service) first.');
    if (!/^PN[0-9a-fA-F]{32}$/.test(phoneNumberSid || '')) return this.fail(tenantId, 'A valid phone number SID (PN…) is required.');
    try {
      await client.attachNumber(r.messaging_service_sid, phoneNumberSid);
      await this.write(tenantId, { number_sid: phoneNumberSid, status: deriveOverallStatus(r.status, { brandStatus: r.brand_status, campaignStatus: r.campaign_status, numberAttached: true }), last_error: null });
      // wave 3 PAYI §137 / §55: a phone-number change on the salon's Messaging Service is audited
      await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'a2p.number_attached', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: `Number ${phoneNumberSid} attached to the A2P Messaging Service`, metadata: { numberSid: phoneNumberSid, messagingServiceSid: r.messaging_service_sid } }).catch(() => undefined);
      return this.get(tenantId);
    } catch (e: any) { return this.fail(tenantId, String(e?.message || 'number attach failed').replace(/^a2p_failed:/, 'Twilio: ')); }
  }

  /** Refresh brand + campaign status from Twilio (poll while TCR review is in progress). */
  async refresh(tenantId: string): Promise<A2pRegistrationView> {
    const client = this.client();
    const r = await this.row(tenantId);
    if (!client || !r) return this.get(tenantId);
    const fields: Record<string, any> = {};
    try {
      if (r.brand_sid) { const b = await client.getBrand(r.brand_sid); fields.brand_status = b.status; }
      if (r.messaging_service_sid) { const c = await client.getCampaign(r.messaging_service_sid); fields.campaign_status = c.status; }
      fields.status = deriveOverallStatus(r.status, { brandStatus: fields.brand_status ?? r.brand_status, campaignStatus: fields.campaign_status ?? r.campaign_status, numberAttached: !!r.number_sid });
      await this.write(tenantId, fields);
      // wave 3 PAYI §137: a carrier-review status change (brand / campaign / overall) is audited — system actor, from → to
      const from = { status: r.status ?? null, brandStatus: r.brand_status ?? null, campaignStatus: r.campaign_status ?? null };
      const to = { status: fields.status ?? null, brandStatus: fields.brand_status ?? from.brandStatus, campaignStatus: fields.campaign_status ?? from.campaignStatus };
      if (from.status !== to.status || from.brandStatus !== to.brandStatus || from.campaignStatus !== to.campaignStatus) {
        await this.audit.record({ tenantId, userId: null }, { module: 'messaging', action: 'a2p.status_changed', resourceType: 'tenant_a2p_registrations', resourceId: tenantId, summary: `A2P status ${from.status} → ${to.status} (campaign ${from.campaignStatus ?? '—'} → ${to.campaignStatus ?? '—'})`, metadata: { from, to } }).catch(() => undefined);
      }
    } catch (e: any) { await this.write(tenantId, { last_error: String(e?.message || 'refresh failed').replace(/^a2p_failed:/, 'Twilio: ') }); }
    return this.get(tenantId);
  }

  private async fail(tenantId: string, message: string): Promise<A2pRegistrationView> {
    await this.write(tenantId, { last_error: message });
    const v = await this.get(tenantId);
    return { ...v, lastError: message };
  }

  // Parameterized write of an arbitrary set of columns for this tenant (safe: fixed column whitelist via keys we set).
  private async write(tenantId: string, fields: Record<string, any>): Promise<void> {
    if (!this.db || !Object.keys(fields).length) return;
    // Upsert the row first (so updates land even before the inputs row exists), then set fields individually.
    await sql`INSERT INTO tenant_a2p_registrations (tenant_id) VALUES (${tenantId}) ON CONFLICT (tenant_id) DO NOTHING`.execute(this.db);
    for (const [k, v] of Object.entries(fields)) {
      await sql`${sql.raw(`UPDATE tenant_a2p_registrations SET ${k} = `)}${v}${sql.raw(', updated_at = now() WHERE tenant_id = ')}${tenantId}`.execute(this.db);
    }
  }
}
