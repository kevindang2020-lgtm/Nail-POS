// template-mutations-core.ts — pure validation/normalization for service-template create/edit + publish/retire
// transition rules. No I/O. Money is integer cents; prices are non-negative integers with min <= max.

export const TAX_SETTINGS = ['taxable', 'non_taxable'] as const;
export const TEMPLATE_STATUSES = ['draft', 'published', 'retired'] as const;

export type NormalizedResource = { label: string; quantity: number };
export type NormalizedAddon = { name: string; priceCents: number };
export type NormalizedCreateTemplate = {
  name: string; categoryCode: string; description: string | null; durationMinutes: number;
  priceMinCents: number; priceMaxCents: number; taxSetting: string; commissionEligible: boolean;
  isCustomizable: boolean; resources: NormalizedResource[]; addons: NormalizedAddon[];
};
export type NormalizedTemplatePatch = Partial<NormalizedCreateTemplate> & { changeNote?: string };

const str = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
const isInt = (v: any) => Number.isInteger(v);

function coerceResources(input: any): NormalizedResource[] {
  if (!Array.isArray(input)) return [];
  return input.map((r) => {
    const label = str(r?.label, 80);
    if (!label) throw new Error('resource label is required');
    const quantity = isInt(r?.quantity) && r.quantity > 0 ? r.quantity : 1;
    return { label, quantity };
  });
}
function coerceAddons(input: any): NormalizedAddon[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.map((a) => {
    const name = str(a?.name, 80);
    if (!name) throw new Error('add-on name is required');
    if (seen.has(name.toLowerCase())) throw new Error(`duplicate add-on: ${name}`);
    seen.add(name.toLowerCase());
    if (!isInt(a?.priceCents) || a.priceCents < 0) throw new Error(`add-on "${name}" price must be a non-negative integer (cents)`);
    return { name, priceCents: a.priceCents };
  });
}

function validatePrices(min: any, max: any) {
  if (!isInt(min) || min < 0) throw new Error('priceMinCents must be a non-negative integer');
  if (!isInt(max) || max < 0) throw new Error('priceMaxCents must be a non-negative integer');
  if (max < min) throw new Error('priceMaxCents must be >= priceMinCents');
}

export function normalizeCreateTemplate(input: any): NormalizedCreateTemplate {
  const name = str(input?.name, 120);
  if (!name) throw new Error('name is required');
  const categoryCode = str(input?.categoryCode, 80);
  if (!categoryCode) throw new Error('categoryCode is required');
  const durationMinutes = isInt(input?.durationMinutes) && input.durationMinutes >= 0 ? input.durationMinutes : (() => { throw new Error('durationMinutes must be a non-negative integer'); })();
  validatePrices(input?.priceMinCents, input?.priceMaxCents);
  const taxSetting = TAX_SETTINGS.includes(input?.taxSetting) ? input.taxSetting : 'taxable';
  return {
    name, categoryCode, description: str(input?.description, 2000) || null, durationMinutes,
    priceMinCents: input.priceMinCents, priceMaxCents: input.priceMaxCents, taxSetting,
    commissionEligible: input?.commissionEligible !== false,
    isCustomizable: input?.isCustomizable !== false,
    resources: coerceResources(input?.resources), addons: coerceAddons(input?.addons),
  };
}

export function normalizeTemplatePatch(input: any): NormalizedTemplatePatch {
  const patch: NormalizedTemplatePatch = {};
  if (input?.name !== undefined) { const n = str(input.name, 120); if (!n) throw new Error('name cannot be empty'); patch.name = n; }
  if (input?.categoryCode !== undefined) { const c = str(input.categoryCode, 80); if (!c) throw new Error('categoryCode cannot be empty'); patch.categoryCode = c; }
  if (input?.description !== undefined) patch.description = str(input.description, 2000) || null;
  if (input?.durationMinutes !== undefined) { if (!isInt(input.durationMinutes) || input.durationMinutes < 0) throw new Error('durationMinutes must be a non-negative integer'); patch.durationMinutes = input.durationMinutes; }
  if (input?.priceMinCents !== undefined || input?.priceMaxCents !== undefined) {
    const min = input?.priceMinCents; const max = input?.priceMaxCents;
    if (min === undefined || max === undefined) throw new Error('provide both priceMinCents and priceMaxCents together');
    validatePrices(min, max); patch.priceMinCents = min; patch.priceMaxCents = max;
  }
  if (input?.taxSetting !== undefined) { if (!TAX_SETTINGS.includes(input.taxSetting)) throw new Error('invalid taxSetting'); patch.taxSetting = input.taxSetting; }
  if (input?.commissionEligible !== undefined) patch.commissionEligible = !!input.commissionEligible;
  if (input?.isCustomizable !== undefined) patch.isCustomizable = !!input.isCustomizable;
  if (input?.resources !== undefined) patch.resources = coerceResources(input.resources);
  if (input?.addons !== undefined) patch.addons = coerceAddons(input.addons);
  if (input?.changeNote !== undefined) patch.changeNote = str(input.changeNote, 500) || undefined;
  if (Object.keys(patch).length === 0) throw new Error('no fields to update');
  return patch;
}

// Publish requires a complete, publishable template from draft. Returns nothing; throws on invalid transition/fields.
export function assertPublishable(current: { status: string; name: string; categoryCode: string | null; durationMinutes: number; priceMinCents: number; priceMaxCents: number }): void {
  if (current.status === 'published') throw new Error('template is already published');
  if (current.status === 'retired') throw new Error('a retired template cannot be published; restore it first');
  if (!current.name) throw new Error('cannot publish: name is missing');
  if (!current.categoryCode) throw new Error('cannot publish: category is missing');
  if (current.durationMinutes <= 0) throw new Error('cannot publish: suggested duration must be greater than 0');
  if (current.priceMaxCents <= 0 || current.priceMaxCents < current.priceMinCents) throw new Error('cannot publish: a valid suggested price range is required');
}

// Retire requires a reason; allowed from draft or published (non-destructive, preserves history + deployments).
export function assertRetirable(current: { status: string }, reason: string): string {
  if (current.status === 'retired') throw new Error('template is already retired');
  const r = str(reason, 500);
  if (!r) throw new Error('a retirement reason is required');
  return r;
}

// Computes the next display version label from an integer version number (e.g. 3 -> 'v3.0').
export function nextVersionLabel(nextVersionNumber: number): string {
  return `v${nextVersionNumber}.0`;
}

export const CATEGORY_STATUSES = ['active', 'archived'] as const;

export function normalizeCategoryCreate(input: any): { name: string; iconKey: string | null } {
  const name = str(input?.name, 80);
  if (!name) throw new Error('category name is required');
  return { name, iconKey: str(input?.iconKey, 40) || null };
}

export function normalizeCategoryPatch(input: any): { name?: string; iconKey?: string | null; displayOrder?: number; status?: string } {
  const patch: { name?: string; iconKey?: string | null; displayOrder?: number; status?: string } = {};
  if (input?.name !== undefined) { const n = str(input.name, 80); if (!n) throw new Error('category name cannot be empty'); patch.name = n; }
  if (input?.iconKey !== undefined) patch.iconKey = str(input.iconKey, 40) || null;
  if (input?.displayOrder !== undefined) { if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) throw new Error('displayOrder must be a non-negative integer'); patch.displayOrder = input.displayOrder; }
  if (input?.status !== undefined) { if (!CATEGORY_STATUSES.includes(input.status)) throw new Error('invalid category status'); patch.status = input.status; }
  if (Object.keys(patch).length === 0) throw new Error('no fields to update');
  return patch;
}
