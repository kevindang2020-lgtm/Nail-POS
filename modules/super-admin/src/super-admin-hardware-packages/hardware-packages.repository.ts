// hardware-packages.repository.ts — data access over hardware_packages (+ child device/note tables), joining tenants /
// applications / users for display fields. Recent activity + events come from audit_logs (entity_type='hardware_package').
// InMemory starts empty (no fabricated data); Kysely uses guarded raw sql.
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { normalizeStatus, type PkgRow, type DeviceRow } from './hardware-packages-core';

export interface HwNote { id: string; note: string; actorUserId: string | null; isInternal: boolean; createdAt: string }
export interface HwActivity { id: string; actionType: string; packageId: string | null; salonName: string | null; createdAt: string; metadata: any }
export interface TenantLite { id: string; name: string; code: string | null }
export interface NewPackage {
  tenantId?: string | null; applicationId?: string | null; packageName?: string | null; packageType?: string | null; status?: string; paymentStatus?: string;
  hardwareCostCents?: number | null; depositCents?: number | null; amountPaidCents?: number | null; financingTerms?: string | null;
  shippingAddress?: string | null; shippingCity?: string | null; shippingState?: string | null; shippingZip?: string | null;
  shippingCarrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; createdByUserId?: string | null;
}

export interface HardwarePackagesRepo {
  all(): Promise<PkgRow[]>;
  getById(id: string): Promise<PkgRow | null>;
  insert(input: NewPackage): Promise<string>;
  update(id: string, patch: Record<string, any>): Promise<void>;
  deviceCounts(): Promise<Map<string, number>>;
  listDevices(pkgId: string): Promise<DeviceRow[]>;
  serialExists(serial: string): Promise<boolean>;
  addDevices(pkgId: string, tenantId: string | null, devices: DeviceRow[]): Promise<void>;
  listNotes(pkgId: string): Promise<HwNote[]>;
  addNote(pkgId: string, actorUserId: string | null, note: string, isInternal: boolean): Promise<void>;
  recentActivity(limit: number): Promise<HwActivity[]>;
  tenantHasActivePackage(tenantId: string): Promise<boolean>;
  listTenants(search?: string): Promise<TenantLite[]>;
  tenantHardware(tenantId: string): Promise<PkgRow | null>;
}

const nowIso = () => new Date().toISOString();
const emptyPkg = (id: string, i: NewPackage): PkgRow => ({
  id, tenantId: i.tenantId ?? null, salonName: null, salonCode: null, ownerName: null, city: i.shippingCity ?? null, state: i.shippingState ?? null,
  packageName: i.packageName ?? null, packageType: i.packageType ?? 'standard', status: i.status ?? 'not_ordered', paymentStatus: i.paymentStatus ?? 'unpaid',
  hardwareCostCents: i.hardwareCostCents ?? null, depositCents: i.depositCents ?? null, amountPaidCents: i.amountPaidCents ?? null, financingTerms: i.financingTerms ?? null,
  shippingAddress: i.shippingAddress ?? null, shippingCity: i.shippingCity ?? null, shippingState: i.shippingState ?? null, shippingZip: i.shippingZip ?? null,
  shippingCarrier: i.shippingCarrier ?? null, trackingNumber: i.trackingNumber ?? null, trackingUrl: i.trackingUrl ?? null,
  imacColor: null, imacSerial: null, cloverFlexSerial: null, checkinDisplaySerial: null,
  orderedAt: null, shippedAt: null, deliveredAt: null, installedAt: null, completedAt: null, cancelledAt: null, returnedAt: null,
  createdAt: nowIso(), updatedAt: nowIso(),
});

export class InMemoryHardwarePackagesRepo implements HardwarePackagesRepo {
  public pkgs: PkgRow[] = [];
  public devices: (DeviceRow & { id: string; pkgId: string })[] = [];
  public notes: (HwNote & { pkgId: string })[] = [];
  public activity: HwActivity[] = [];
  public tenants: TenantLite[] = [];
  async all() { return this.pkgs.map((p) => ({ ...p })); }
  async getById(id: string) { return this.pkgs.find((p) => p.id === id) ?? null; }
  async insert(i: NewPackage) { const id = randomUUID(); this.pkgs.unshift(emptyPkg(id, i)); return id; }
  async update(id: string, patch: Record<string, any>) { const p = this.pkgs.find((x) => x.id === id); if (!p) return; Object.assign(p, patch, { updatedAt: nowIso() }); }
  async deviceCounts() { const m = new Map<string, number>(); for (const d of this.devices) m.set(d.pkgId, (m.get(d.pkgId) ?? 0) + (d.quantity || 1)); return m; }
  async listDevices(pkgId: string) { return this.devices.filter((d) => d.pkgId === pkgId).map(({ id, deviceType, deviceName, serialNumber, assetTag, quantity, status }) => ({ id, deviceType, deviceName, serialNumber, assetTag, quantity, status })); }
  async serialExists(serial: string) { return this.devices.some((d) => d.serialNumber === serial); }
  async addDevices(pkgId: string, tenantId: string | null, devices: DeviceRow[]) { for (const d of devices) this.devices.push({ ...d, id: randomUUID(), pkgId, quantity: d.quantity || 1 }); void tenantId; }
  async listNotes(pkgId: string) { return this.notes.filter((n) => n.pkgId === pkgId).map(({ id, note, actorUserId, isInternal, createdAt }) => ({ id, note, actorUserId, isInternal, createdAt })); }
  async addNote(pkgId: string, actorUserId: string | null, note: string, isInternal: boolean) { this.notes.unshift({ id: randomUUID(), pkgId, note, actorUserId, isInternal, createdAt: nowIso() }); }
  async recentActivity(limit: number) { return this.activity.slice(0, limit); }
  async tenantHasActivePackage(tenantId: string) { return this.pkgs.some((p) => p.tenantId === tenantId && !['cancelled', 'returned'].includes(normalizeStatus(p.status))); }
  async listTenants() { return this.tenants.map((t) => ({ ...t })); }
  async tenantHardware(tenantId: string) { return this.pkgs.find((p) => p.tenantId === tenantId) ?? null; }
}

export class KyselyHardwarePackagesRepo implements HardwarePackagesRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): PkgRow => ({
    id: String(r.id), tenantId: r.tenant_id ?? null, salonName: r.salon_name ?? null, salonCode: r.salon_code ?? null, ownerName: r.owner_name ?? null, city: r.city ?? null, state: r.state ?? null,
    packageName: r.package_name ?? null, packageType: r.package_type ?? null, status: String(r.status), paymentStatus: String(r.payment_status ?? 'unpaid'),
    hardwareCostCents: num(r.hardware_cost_cents), depositCents: num(r.deposit_cents), amountPaidCents: num(r.amount_paid_cents), financingTerms: r.financing_terms ?? null,
    shippingAddress: r.shipping_address ?? null, shippingCity: r.shipping_city ?? null, shippingState: r.shipping_state ?? null, shippingZip: r.shipping_zip ?? null,
    shippingCarrier: r.shipping_carrier ?? null, trackingNumber: r.tracking_number ?? null, trackingUrl: r.tracking_url ?? null,
    imacColor: r.imac_color ?? null, imacSerial: r.imac_serial ?? null, cloverFlexSerial: r.clover_flex_serial ?? null, checkinDisplaySerial: r.checkin_display_serial ?? null,
    orderedAt: iso(r.ordered_at), shippedAt: iso(r.shipped_at), deliveredAt: iso(r.delivered_at), installedAt: iso(r.installed_at), completedAt: iso(r.completed_at), cancelledAt: iso(r.cancelled_at), returnedAt: iso(r.returned_at),
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  });
  private readonly SELECT = sql`
    select h.*, coalesce(t.display_name, app.salon_name) salon_name, t.tenant_code salon_code,
      coalesce(u.full_name, app.owner_name) owner_name, coalesce(app.city, h.shipping_city) city, coalesce(app.state, h.shipping_state) state
    from hardware_packages h
    left join tenants t on t.id = h.tenant_id
    left join tenant_applications app on app.id = h.application_id
    left join users u on u.id = t.owner_user_id`;
  async all(): Promise<PkgRow[]> {
    return sql`${this.SELECT} order by h.updated_at desc`.execute(this.db as any).then((r: any) => r.rows.map(this.map)).catch(() => []);
  }
  async getById(id: string): Promise<PkgRow | null> {
    return sql`${this.SELECT} where h.id = ${id}`.execute(this.db as any).then((r: any) => (r.rows[0] ? this.map(r.rows[0]) : null)).catch(() => null);
  }
  async insert(i: NewPackage): Promise<string> {
    const r: any = await sql`
      insert into hardware_packages (tenant_id, application_id, package_name, package_type, status, payment_status, hardware_cost_cents, deposit_cents, amount_paid_cents, financing_terms, shipping_address, shipping_city, shipping_state, shipping_zip, shipping_carrier, tracking_number, tracking_url, created_by_user_id, ordered_at)
      values (${i.tenantId ?? null}, ${i.applicationId ?? null}, ${i.packageName ?? null}, ${i.packageType ?? 'standard'}, ${i.status ?? 'not_ordered'}, ${i.paymentStatus ?? 'unpaid'}, ${i.hardwareCostCents ?? null}, ${i.depositCents ?? null}, ${i.amountPaidCents ?? null}, ${i.financingTerms ?? null}, ${i.shippingAddress ?? null}, ${i.shippingCity ?? null}, ${i.shippingState ?? null}, ${i.shippingZip ?? null}, ${i.shippingCarrier ?? null}, ${i.trackingNumber ?? null}, ${i.trackingUrl ?? null}, ${i.createdByUserId ?? null}, ${i.status && i.status !== 'not_ordered' ? new Date().toISOString() : null})
      returning id`.execute(this.db as any);
    return String(r.rows[0].id);
  }
  async update(id: string, patch: Record<string, any>): Promise<void> {
    const cols: Record<string, string> = { packageName: 'package_name', packageType: 'package_type', status: 'status', paymentStatus: 'payment_status', hardwareCostCents: 'hardware_cost_cents', depositCents: 'deposit_cents', amountPaidCents: 'amount_paid_cents', financingTerms: 'financing_terms', shippingAddress: 'shipping_address', shippingCity: 'shipping_city', shippingState: 'shipping_state', shippingZip: 'shipping_zip', shippingCarrier: 'shipping_carrier', trackingNumber: 'tracking_number', trackingUrl: 'tracking_url', orderedAt: 'ordered_at', shippedAt: 'shipped_at', deliveredAt: 'delivered_at', installedAt: 'installed_at', completedAt: 'completed_at', cancelledAt: 'cancelled_at', returnedAt: 'returned_at', updatedByUserId: 'updated_by_user_id' };
    const sets = Object.entries(patch).filter(([k]) => cols[k] !== undefined).map(([k, v]) => sql`${sql.ref(cols[k])} = ${v as any}`);
    if (!sets.length) return;
    await sql`update hardware_packages set ${sql.join(sets, sql`, `)}, updated_at = now() where id = ${id}`.execute(this.db as any).catch(() => undefined);
  }
  async deviceCounts(): Promise<Map<string, number>> {
    return sql`select hardware_package_id, sum(quantity)::int n from hardware_package_devices group by hardware_package_id`
      .execute(this.db as any).then((r: any) => new Map<string, number>(r.rows.map((x: any) => [String(x.hardware_package_id), Number(x.n)]))).catch(() => new Map());
  }
  async listDevices(pkgId: string): Promise<DeviceRow[]> {
    return sql`select id, device_type, device_name, serial_number, asset_tag, quantity, status from hardware_package_devices where hardware_package_id = ${pkgId} order by created_at`
      .execute(this.db as any).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), deviceType: String(x.device_type), deviceName: String(x.device_name), serialNumber: x.serial_number ?? null, assetTag: x.asset_tag ?? null, quantity: Number(x.quantity), status: x.status }))).catch(() => []);
  }
  async serialExists(serial: string): Promise<boolean> {
    return sql`select 1 from hardware_package_devices where serial_number = ${serial} limit 1`.execute(this.db as any).then((r: any) => r.rows.length > 0).catch(() => false);
  }
  async addDevices(pkgId: string, tenantId: string | null, devices: DeviceRow[]): Promise<void> {
    for (const d of devices) await sql`insert into hardware_package_devices (hardware_package_id, tenant_id, device_type, device_name, serial_number, asset_tag, quantity) values (${pkgId}, ${tenantId}, ${d.deviceType}, ${d.deviceName}, ${d.serialNumber ?? null}, ${d.assetTag ?? null}, ${d.quantity || 1})`.execute(this.db as any).catch(() => undefined);
  }
  async listNotes(pkgId: string): Promise<HwNote[]> {
    return sql`select id, note, actor_user_id, is_internal, created_at from hardware_package_notes where hardware_package_id = ${pkgId} order by created_at desc`
      .execute(this.db as any).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), note: String(x.note), actorUserId: x.actor_user_id ?? null, isInternal: !!x.is_internal, createdAt: iso(x.created_at)! }))).catch(() => []);
  }
  async addNote(pkgId: string, actorUserId: string | null, note: string, isInternal: boolean): Promise<void> {
    await sql`insert into hardware_package_notes (hardware_package_id, actor_user_id, note, is_internal) values (${pkgId}, ${actorUserId}, ${note}, ${isInternal})`.execute(this.db as any).catch(() => undefined);
  }
  async recentActivity(limit: number): Promise<HwActivity[]> {
    return sql`select a.id, a.action_type, a.entity_id, a.metadata_json, a.created_at, coalesce(t.display_name, app.salon_name) salon_name
      from audit_logs a left join hardware_packages h on h.id::text = a.entity_id left join tenants t on t.id = h.tenant_id left join tenant_applications app on app.id = h.application_id
      where a.entity_type = 'hardware_package' order by a.created_at desc limit ${limit}`
      .execute(this.db as any).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), actionType: String(x.action_type), packageId: x.entity_id ?? null, salonName: x.salon_name ?? null, createdAt: iso(x.created_at)!, metadata: x.metadata_json ?? null }))).catch(() => []);
  }
  async tenantHasActivePackage(tenantId: string): Promise<boolean> {
    return sql`select 1 from hardware_packages where tenant_id = ${tenantId} and status not in ('cancelled','returned') limit 1`.execute(this.db as any).then((r: any) => r.rows.length > 0).catch(() => false);
  }
  async listTenants(search?: string): Promise<TenantLite[]> {
    const like = `%${(search ?? '').toLowerCase()}%`;
    return sql`select id, display_name, tenant_code from tenants where (${search ? sql`lower(display_name) like ${like}` : sql`true`}) order by display_name limit 50`
      .execute(this.db as any).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), name: String(x.display_name), code: x.tenant_code ?? null }))).catch(() => []);
  }
  async tenantHardware(tenantId: string): Promise<PkgRow | null> {
    return sql`${this.SELECT} where h.tenant_id = ${tenantId} order by h.updated_at desc limit 1`.execute(this.db as any).then((r: any) => (r.rows[0] ? this.map(r.rows[0]) : null)).catch(() => null);
  }
}

const num = (v: any): number | null => (v == null ? null : Number(v));
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
