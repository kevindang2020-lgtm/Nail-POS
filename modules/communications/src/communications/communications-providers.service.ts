// communications-providers.service.ts — Configure Communication Providers (§27). Secrets are written into the AES
// vault and NEVER returned. Test-connection validates the stored secret server-side (present + decryptable) WITHOUT
// revealing it, and reports health derived from REAL recent delivery signals (not "credentials configured"). Provider
// config updates and credential rotation are supported; rotation replaces the secret and refreshes the masked hint.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { providerHealth } from './communications-overview-core';
import { secretLast4, type ProviderSecrets } from '@aipowersalon/security';
import { CommunicationsProvidersRepository } from './communications-providers.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const CHANNELS = ['sms', 'email', 'push', 'multi'];
const STATUSES = ['active', 'inactive', 'test', 'degraded', 'down', 'suspended', 'misconfigured'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class CommunicationsProvidersService {
  // Credentials are sealed/opened through the ProviderSecrets port (Constitution 13 §94), never the key ring directly.
  constructor(private readonly repo: CommunicationsProvidersRepository, private readonly secrets: ProviderSecrets) {}

  async list() { return { providers: await this.repo.list() }; }

  async get(id: string) {
    if (!validUuid(id)) throw new BadRequestException('invalid provider id');
    const p = await this.repo.get(id);
    if (!p) throw new NotFoundException('provider not found');
    return { provider: p };
  }

  async create(ctx: AdminCtx, body: any) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestException('name is required');
    const channel = String(body?.channel ?? '');
    if (!CHANNELS.includes(channel)) throw new BadRequestException('invalid channel');
    const secret = typeof body?.credential === 'string' ? body.credential.trim() : '';
    if (!secret) throw new BadRequestException('credential is required');
    const region = typeof body?.region === 'string' && body.region.trim() ? body.region.trim() : null;
    const accountRef = typeof body?.accountReference === 'string' && body.accountReference.trim() ? body.accountReference.trim() : null;
    const apiEndpoint = typeof body?.apiEndpoint === 'string' && body.apiEndpoint.trim() ? body.apiEndpoint.trim() : null;
    const webhookEndpoint = typeof body?.webhookEndpoint === 'string' && body.webhookEndpoint.trim() ? body.webhookEndpoint.trim() : null;
    const priority = Number.isInteger(Number(body?.priority)) ? Number(body.priority) : 100;
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    const { id } = await this.repo.insert({ name, channel, region, accountRef, apiEndpoint, webhookEndpoint, priority, credentialEnc: this.secrets.encrypt(secret), credentialLast4: secretLast4(secret), createdBy });
    return { ok: true, id, status: 'test' }; // unverified until a successful test/validation
  }

  async updateConfig(ctx: AdminCtx, id: string, body: any) {
    if (!validUuid(id)) throw new BadRequestException('invalid provider id');
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException('provider not found');
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
    const region = body?.region !== undefined ? (body.region ? String(body.region).trim() : null) : existing.region;
    const apiEndpoint = body?.apiEndpoint !== undefined ? (body.apiEndpoint ? String(body.apiEndpoint).trim() : null) : existing.api_endpoint;
    const webhookEndpoint = body?.webhookEndpoint !== undefined ? (body.webhookEndpoint ? String(body.webhookEndpoint).trim() : null) : existing.webhook_endpoint;
    const priority = Number.isInteger(Number(body?.priority)) ? Number(body.priority) : existing.priority;
    const status = body?.status && STATUSES.includes(String(body.status)) ? String(body.status) : existing.status;
    // NOTE: config updates never touch the secret — rotation is a separate, explicit operation.
    await this.repo.updateConfig(id, { name, region, apiEndpoint, webhookEndpoint, priority, status });
    return { ok: true, id };
  }

  async rotateCredential(ctx: AdminCtx, id: string, body: any) {
    if (!validUuid(id)) throw new BadRequestException('invalid provider id');
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException('provider not found');
    const secret = typeof body?.credential === 'string' ? body.credential.trim() : '';
    if (!secret) throw new BadRequestException('new credential is required');
    await this.repo.rotateCredential(id, this.secrets.encrypt(secret), secretLast4(secret));
    return { ok: true, id, credentialLast4: secretLast4(secret) }; // never returns the secret itself
  }

  /** Validate the stored credential WITHOUT revealing it, and report health from real delivery signals. */
  async testConnection(_ctx: AdminCtx, id: string) {
    if (!validUuid(id)) throw new BadRequestException('invalid provider id');
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException('provider not found');
    const enc = await this.repo.credentialEnc(id);
    let credentialValid = false;
    if (enc) { try { credentialValid = this.secrets.decrypt(enc).length > 0; } catch { credentialValid = false; } }
    const { delivered, failed } = await this.repo.recentDelivery(id);
    const health = providerHealth(delivered, failed);
    // Honest: this checks the credential is present + decryptable and reports REAL recent-delivery health. It does not
    // perform a live provider round-trip (no outbound network here); the secret is never returned.
    const status = !credentialValid ? 'misconfigured' : (delivered + failed === 0 ? 'test' : health.key === 'down' ? 'down' : health.key === 'degraded' ? 'degraded' : 'active');
    await this.repo.setHealth(id, status);
    return { ok: true, id, credentialValid, health: health.key, healthLabel: health.label, recent: { delivered, failed }, status };
  }
}
