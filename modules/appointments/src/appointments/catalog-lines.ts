// catalog-lines.ts — the ONE rule for turning requested services into the lines saved on an appointment, queue item,
// check-in or technician ticket. Booking, check-in, queue, tech-queue and tech-appointments all use it.
//
// Why: the developer tree (Sep 28 2026) changed all five copies so that an id NOT in the salon's catalog was saved as a
// $0, 30-minute "Archived/Custom Service", the client's duration was trusted (a 60-minute service sent as 10 minutes
// frees the chair for a double booking) and any client price was recorded as an "override" with no permission check.
// The standing harness specs that pinned "unknown service rejected" failed from then on, unnoticed.
//
// The rule (Decision 38 — "authorized manual price override"):
//   • a catalog service takes the catalog's name and duration;
//   • an id not in the catalog is refused — EXCEPT one already on the record being edited (an archived service on an
//     existing booking stays as it was; it is never re-priced);
//   • a price different from the catalog, or a line with no service id (a custom service), is a manual override: it
//     needs the override permission (pos.checkout.override_total → checkout.manage_overrides) and a reason.
export interface CatalogService { serviceId: string; name: string; durationMinutes: number; priceCents: number }
export interface CatalogLineInput {
  serviceId?: string; name?: string; serviceName?: string; durationMinutes?: number; priceCents?: number;
  overrideReason?: string; isAddon?: boolean; parentServiceId?: string;
}
export interface ResolvedCatalogLine {
  serviceId: string; serviceName: string; durationMinutes: number; priceCents: number;
  priceOverrideCents?: number; overrideReason?: string; isAddon?: boolean; parentServiceId?: string;
}
export class CatalogLineError extends Error {}
/** The permission that authorizes a manual price or custom service (maps to checkout.manage_overrides). */
export const PRICE_OVERRIDE_PERMISSION = 'pos.checkout.override_total';

export function resolveCatalogLines(args: {
  catalog: CatalogService[];
  ids?: string[];
  lines?: CatalogLineInput[];
  priceOverrides?: Record<string, { priceCents: number; reason?: string }>;
  mayOverride: boolean;
  /** Lines already on the record being edited: an id here that left the catalog is kept unchanged. */
  existing?: ResolvedCatalogLine[];
}): ResolvedCatalogLine[] {
  const { catalog, priceOverrides, mayOverride } = args;
  const byId = new Map(catalog.map((c) => [c.serviceId, c]));
  const kept = new Map((args.existing ?? []).map((l) => [l.serviceId, l]));
  const needOverride = (what: string, reason?: string) => {
    if (!mayOverride) throw new CatalogLineError(`${what} needs a manager (manual price override permission)`);
    if (!String(reason ?? '').trim()) throw new CatalogLineError(`${what} needs a reason`);
  };
  const cents = (v: unknown, what: string): number => {
    if (!Number.isInteger(v) || (v as number) < 0) throw new CatalogLineError(`${what}: price must be whole cents, zero or more`);
    return v as number;
  };
  const fromCatalog = (c: CatalogService, asked: number | undefined, reason: string | undefined, extra: Partial<ResolvedCatalogLine>): ResolvedCatalogLine => {
    const price = asked === undefined ? c.priceCents : cents(asked, c.name);
    const overridden = price !== c.priceCents;
    if (overridden) needOverride(`Changing the price of ${c.name}`, reason);
    return { serviceId: c.serviceId, serviceName: c.name, durationMinutes: c.durationMinutes, priceCents: price, ...(overridden ? { priceOverrideCents: price, overrideReason: reason } : {}), ...extra };
  };
  const unknown = (id: string): ResolvedCatalogLine => {
    const k = kept.get(id);
    if (k) return { ...k };
    throw new CatalogLineError('Unknown service: ' + id);
  };

  if (args.lines && args.lines.length > 0) {
    return args.lines.map((line, idx) => {
      const extra = { ...(line.isAddon ? { isAddon: true } : {}), ...(line.parentServiceId ? { parentServiceId: line.parentServiceId } : {}) };
      const ov = line.serviceId ? priceOverrides?.[line.serviceId] : undefined;
      if (line.serviceId) {
        const c = byId.get(line.serviceId);
        if (!c) return unknown(line.serviceId);
        return fromCatalog(c, ov?.priceCents ?? line.priceCents, ov?.reason || line.overrideReason, extra);
      }
      const name = String(line.serviceName || line.name || '').trim() || 'Custom Service';
      needOverride(`Custom service "${name}"`, line.overrideReason);
      const dur = Number(line.durationMinutes);
      if (!Number.isInteger(dur) || dur <= 0) throw new CatalogLineError(`Custom service "${name}" needs a duration in minutes`);
      const price = cents(line.priceCents ?? 0, name);
      return { serviceId: `custom_${idx}`, serviceName: name, durationMinutes: dur, priceCents: price, priceOverrideCents: price, overrideReason: line.overrideReason, ...extra };
    });
  }
  return (args.ids ?? []).map((id) => {
    const c = byId.get(id);
    if (!c) return unknown(id);
    const ov = priceOverrides?.[id];
    return fromCatalog(c, ov?.priceCents, ov?.reason, {});
  });
}
