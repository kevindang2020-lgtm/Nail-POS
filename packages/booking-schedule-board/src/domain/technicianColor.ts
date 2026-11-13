/**
 * Stable technician identity accent (booking200 addendum §05, P-09).
 *
 * Identity colour and appointment STATUS colour answer different questions and never mix: a confirmed booking keeps
 * its pale-blue status fill and carries a thin identity rail in its technician's accent; the same accent marks the
 * technician's header / number badge and the detail panels.
 *
 * The accent comes from a stable hash of the technician's identity WITHIN the tenant (`tenantId:technicianId`) — never
 * from the visible column index, the page, the roster position, the view (Day/Week) or the filter. So the same person
 * keeps the same accent on page 1 and page 17. With 200 people colours repeat: the avatar, number and name stay the
 * unambiguous identifiers (never colour alone).
 */

/** Twelve deep, white-text-legible accents (contrast ≥ 4.5:1 against #fff), chosen away from the status palette's marks
 *  (confirmed #168AF5, arrived #8374EE, in service #A747EF, walk-in #F96B21, open #13BE98, break gray). */
export const TECHNICIAN_ACCENTS = [
  '#B45309', // amber
  '#0E7490', // cyan
  '#7C3AED', // purple
  '#C2410C', // coral
  '#15803D', // green
  '#BE185D', // rose
  '#1D4ED8', // royal blue
  '#0F766E', // teal
  '#9A3412', // terracotta
  '#6D28D9', // violet
  '#374151', // slate
  '#A16207', // ochre
] as const;

export type TechnicianAccent = (typeof TECHNICIAN_ACCENTS)[number];

/** FNV-1a 32-bit — tiny, deterministic, and the same in every browser / Node. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The technician's identity accent. Pure: same (tenant, technician) → same colour, everywhere, forever. */
export function technicianAccent(tenantId: string, technicianId: string): TechnicianAccent {
  return TECHNICIAN_ACCENTS[fnv1a(`${tenantId}:${technicianId}`) % TECHNICIAN_ACCENTS.length];
}
