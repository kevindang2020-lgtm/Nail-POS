// hardware-packages.service.ts — orchestrates the Hardware Packages surface over the repo + pure core. Builds the
// one-shot `state` payload, enforces the status-transition state machine (409 on invalid), auto-advances to shipped when
// tracking is added, guards duplicate device serials, and audits every meaningful action. Super-admin-only (controller guards).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { HardwarePackagesRepo, NewPackage } from './hardware-packages.repository';
import {
  computeSummary, statusBreakdown, packageTypeBreakdown, filterPackages, sortPackages, paginate, canTransition, devicesFor, deviceCountFor, normalizeStatus,
  PACKAGE_STATUSES, PAYMENT_STATUSES, CARRIERS, PACKAGE_TYPES, type PkgRow, type DeviceRow, type HwFilter,
} from './hardware-packages-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { HwQuery } from '@aipowersalon/api-contracts/platform';
import type { HwQuery } from '@aipowersalon/api-contracts/platform';

export class HardwareError extends Error { constructor(public code: 'not_found' | 'conflict' | 'bad_request', message: string) { super(message); } }
export interface AdminCtx { userId?: string; ip?: string }

const PERMS = { view: true, create: true, update: true, assign: true, statusUpdate: true, paymentUpdate: true, trackingUpdate: true, devicesUpdate: true, notesCreate: true, cancel: true, return: true, tenantView: true, billingView: true, auditView: true };
const STATUS_TS: Record<string, string> = { ordered: 'orderedAt', shipped: 'shippedAt', delivered: 'deliveredAt', installed: 'installedAt', complete: 'completedAt', cancelled: 'cancelledAt', returned: 'returnedAt' };
const PRE_SHIPPED = new Set(['not_ordered', 'ready_to_ship', 'ordered', 'processing']);

export class HardwarePackagesService {
  constructor(private readonly repo: HardwarePackagesRepo, private readonly db: AppDatabase = null) {}

  private async withCounts(rows: PkgRow[]): Promise<PkgRow[]> {
    const counts = await this.repo.deviceCounts().catch(() => new Map<string, number>());
    return rows.map((r) => ({ ...r, status: r.status, deviceCount: counts.get(r.id) ?? deviceCountFor(r, []) }));
  }

  async state(q: HwQuery) {
    const all = await this.repo.all();
    const filtered = sortPackages(filterPackages(all, q), q.sortBy, q.sortDirection);
    const { items, pagination } = paginate(filtered, q.page ?? 1, q.limit ?? 10);
    const [packages, recentActivity] = await Promise.all([this.withCounts(items), this.repo.recentActivity(10)]);
    const selected = packages[0] ? await this.detail(packages[0].id) : null;
    return {
      summary: computeSummary(all),
      filters: { search: q.search ?? '', status: q.status ?? 'all', paymentStatus: q.paymentStatus ?? 'all', packageType: q.packageType ?? 'all', carrier: q.carrier ?? 'all', dateFrom: q.dateFrom ?? null, dateTo: q.dateTo ?? null, tenantId: q.tenantId ?? null },
      packages, pagination,
      packagesByStatus: statusBreakdown(all),
      topPackageTypes: packageTypeBreakdown(all),
      recentHardwareActivity: recentActivity,
      recentHardwareEvents: recentActivity,
      selectedPackage: selected,
      permissions: PERMS,
      reference: { statuses: PACKAGE_STATUSES, paymentStatuses: PAYMENT_STATUSES, carriers: CARRIERS, packageTypes: PACKAGE_TYPES },
    };
  }

  async list(q: HwQuery) {
    const all = await this.repo.all();
    const { items, pagination } = paginate(sortPackages(filterPackages(all, q), q.sortBy, q.sortDirection), q.page ?? 1, q.limit ?? 10);
    return { packages: await this.withCounts(items), pagination };
  }
  async summary() { const all = await this.repo.all(); return { summary: computeSummary(all), packagesByStatus: statusBreakdown(all), topPackageTypes: packageTypeBreakdown(all) }; }
  async recentActivity(limit = 10) { return this.repo.recentActivity(limit); }
  async events(limit = 10) { return this.repo.recentActivity(limit); }
  async listTenants(search?: string) { return this.repo.listTenants(search); }

  async detail(id: string) {
    const pkg = await this.repo.getById(id);
    if (!pkg) throw new HardwareError('not_found', 'hardware_package_not_found');
    const [deviceRows, notes] = await Promise.all([this.repo.listDevices(id), this.repo.listNotes(id)]);
    const devices = devicesFor(pkg, deviceRows);
    return { package: { ...pkg, status: pkg.status, deviceCount: devices.reduce((n, d) => n + (d.quantity || 1), 0) }, devices, notes, normalizedStatus: normalizeStatus(pkg.status) };
  }

  async tenantHardware(tenantId: string) {
    const pkg = await this.repo.tenantHardware(tenantId);
    if (!pkg) return { package: null };
    return this.detail(pkg.id);
  }

  async create(ctx: AdminCtx, body: any) {
    if (!body?.tenantId && !body?.applicationId) throw new HardwareError('bad_request', 'tenant_required');
    if (body?.hardwareCostCents != null && !Number.isFinite(Number(body.hardwareCostCents))) throw new HardwareError('bad_request', 'invalid_cost');
    if (body?.tenantId && !body?.confirmDuplicate && !body?.force && (await this.repo.tenantHasActivePackage(body.tenantId))) throw new HardwareError('conflict', 'tenant_has_active_package');
    const input: NewPackage = {
      tenantId: body.tenantId ?? null, applicationId: body.applicationId ?? null, packageName: body.packageName ?? null, packageType: this.coerce(body.packageType, PACKAGE_TYPES, 'standard'),
      status: body.status ? this.coerceStatus(body.status) : 'not_ordered', paymentStatus: this.coerce(body.paymentStatus, PAYMENT_STATUSES, 'unpaid'),
      hardwareCostCents: numOrNull(body.hardwareCostCents), depositCents: numOrNull(body.depositCents), financingTerms: body.financingTerms ?? null,
      shippingAddress: body.shippingAddress ?? null, shippingCity: body.shippingCity ?? null, shippingState: body.shippingState ?? null, shippingZip: body.shippingZip ?? null,
      shippingCarrier: this.coerceCarrier(body.shippingCarrier), trackingNumber: body.trackingNumber ?? null, createdByUserId: ctx.userId ?? null,
    };
    const id = await this.repo.insert(input);
    if (Array.isArray(body?.devices) && body.devices.length) await this.addDevicesInternal(id, input.tenantId ?? null, body.devices);
    if (body?.notes?.trim()) await this.repo.addNote(id, ctx.userId ?? null, body.notes.trim(), true);
    await this.audit(ctx, 'hardware_package_created', id, body.tenantId ?? null, { packageType: input.packageType });
    await this.audit(ctx, 'hardware_package_assigned', id, body.tenantId ?? null, { packageName: input.packageName });
    return this.detail(id);
  }

  async update(ctx: AdminCtx, id: string, body: any) {
    const pkg = await this.require(id);
    const patch: Record<string, any> = { updatedByUserId: ctx.userId ?? null };
    for (const k of ['packageName', 'packageType', 'financingTerms', 'shippingAddress', 'shippingCity', 'shippingState', 'shippingZip']) if (body?.[k] !== undefined) patch[k] = body[k];
    if (body?.packageType !== undefined) patch.packageType = this.coerce(body.packageType, PACKAGE_TYPES, pkg.packageType ?? 'standard');
    if (body?.hardwareCostCents !== undefined) patch.hardwareCostCents = numOrNull(body.hardwareCostCents);
    if (body?.depositCents !== undefined) patch.depositCents = numOrNull(body.depositCents);
    if (body?.amountPaidCents !== undefined) patch.amountPaidCents = numOrNull(body.amountPaidCents);
    await this.repo.update(id, patch);
    await this.audit(ctx, 'hardware_package_updated', id, pkg.tenantId, {});
    return this.detail(id);
  }

  async setStatus(ctx: AdminCtx, id: string, status: string, force = false) {
    const pkg = await this.require(id);
    const to = this.coerceStatus(status);
    const from = normalizeStatus(pkg.status);
    if (!canTransition(from, to, force)) throw new HardwareError('conflict', 'invalid_status_transition');
    const patch: Record<string, any> = { status: to, updatedByUserId: ctx.userId ?? null };
    if (STATUS_TS[to]) patch[STATUS_TS[to]] = new Date().toISOString();
    await this.repo.update(id, patch);
    await this.audit(ctx, 'hardware_package_status_changed', id, pkg.tenantId, { from, to });
    await this.audit(ctx, 'tenant_hardware_status_updated', id, pkg.tenantId, { status: to });
    return this.detail(id);
  }

  async setPaymentStatus(ctx: AdminCtx, id: string, paymentStatus: string) {
    if (!(PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) throw new HardwareError('bad_request', 'invalid_payment_status');
    const pkg = await this.require(id);
    await this.repo.update(id, { paymentStatus, updatedByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'hardware_package_payment_status_changed', id, pkg.tenantId, { from: pkg.paymentStatus, to: paymentStatus });
    return this.detail(id);
  }

  async updateTracking(ctx: AdminCtx, id: string, body: any) {
    const pkg = await this.require(id);
    const patch: Record<string, any> = { updatedByUserId: ctx.userId ?? null };
    if (body?.carrier !== undefined) patch.shippingCarrier = this.coerceCarrier(body.carrier);
    if (body?.trackingNumber !== undefined) patch.trackingNumber = body.trackingNumber || null;
    if (body?.trackingUrl !== undefined) patch.trackingUrl = body.trackingUrl || null;
    if (body?.shippedDate) patch.shippedAt = body.shippedDate;
    if (body?.deliveredDate) patch.deliveredAt = body.deliveredDate;
    let autoShipped = false;
    if ((body?.trackingNumber || '').trim() && PRE_SHIPPED.has(normalizeStatus(pkg.status))) { patch.status = 'shipped'; patch.shippedAt = patch.shippedAt ?? new Date().toISOString(); autoShipped = true; }
    await this.repo.update(id, patch);
    await this.audit(ctx, 'hardware_package_tracking_updated', id, pkg.tenantId, { carrier: patch.shippingCarrier, trackingNumber: patch.trackingNumber });
    if (autoShipped) await this.audit(ctx, 'hardware_package_status_changed', id, pkg.tenantId, { from: normalizeStatus(pkg.status), to: 'shipped', via: 'tracking' });
    return this.detail(id);
  }

  async addDevices(ctx: AdminCtx, id: string, devices: any[]) {
    const pkg = await this.require(id);
    const added = await this.addDevicesInternal(id, pkg.tenantId, devices);
    await this.audit(ctx, 'hardware_package_device_added', id, pkg.tenantId, { count: added });
    return this.detail(id);
  }
  private async addDevicesInternal(id: string, tenantId: string | null, devices: any[]): Promise<number> {
    const clean: DeviceRow[] = [];
    const seen = new Set<string>();
    for (const d of devices) {
      const serial = (d?.serialNumber ?? '').trim() || null;
      if (serial) { if (seen.has(serial)) throw new HardwareError('conflict', 'duplicate_serial_number'); if (await this.repo.serialExists(serial)) throw new HardwareError('conflict', 'duplicate_serial_number'); seen.add(serial); }
      clean.push({ deviceType: String(d?.deviceType ?? 'device'), deviceName: String(d?.deviceName ?? d?.deviceType ?? 'Device'), serialNumber: serial, assetTag: d?.assetTag ?? null, quantity: Number(d?.quantity) || 1 });
    }
    if (clean.length) await this.repo.addDevices(id, tenantId, clean);
    return clean.length;
  }

  async addNote(ctx: AdminCtx, id: string, note: string, isInternal = true) {
    if (!note?.trim()) throw new HardwareError('bad_request', 'empty_note');
    const pkg = await this.require(id);
    await this.repo.addNote(id, ctx.userId ?? null, note.trim(), isInternal);
    await this.audit(ctx, 'hardware_package_note_added', id, pkg.tenantId, {});
    return this.detail(id);
  }

  async cancel(ctx: AdminCtx, id: string, reason?: string) {
    const pkg = await this.require(id);
    if (normalizeStatus(pkg.status) === 'cancelled') throw new HardwareError('conflict', 'already_cancelled');
    await this.repo.update(id, { status: 'cancelled', cancelledAt: new Date().toISOString(), updatedByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'hardware_package_cancelled', id, pkg.tenantId, { reason: reason ?? null });
    return this.detail(id);
  }
  async return_(ctx: AdminCtx, id: string, reason?: string) {
    const pkg = await this.require(id);
    const from = normalizeStatus(pkg.status);
    if (!['shipped', 'delivered', 'installed', 'complete'].includes(from)) throw new HardwareError('conflict', 'cannot_return_from_state');
    await this.repo.update(id, { status: 'returned', returnedAt: new Date().toISOString(), updatedByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'hardware_package_returned', id, pkg.tenantId, { reason: reason ?? null, from });
    return this.detail(id);
  }

  // helpers
  private async require(id: string): Promise<PkgRow> { const p = await this.repo.getById(id); if (!p) throw new HardwareError('not_found', 'hardware_package_not_found'); return p; }
  private coerce(v: any, allowed: readonly string[], dflt: string): string { const s = String(v ?? '').toLowerCase(); return allowed.includes(s) ? s : dflt; }
  private coerceStatus(v: any): string { const s = normalizeStatus(String(v ?? '')); return s; }
  private coerceCarrier(v: any): string | null { if (v == null) return null; const s = String(v).toLowerCase(); return (CARRIERS as readonly string[]).includes(s) ? s : 'other'; }
  private async audit(ctx: AdminCtx, action: string, packageId: string, tenantId: string | null, meta: any) {
    if (!this.db) return;
    await sql`insert into audit_logs (id, tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (gen_random_uuid(), ${tenantId}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'hardware_package', ${packageId}, ${JSON.stringify(meta)})`
      .execute(this.db as any).catch(() => undefined);
  }
}

const numOrNull = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
