// salonMemory.ts — the SALON's identity remembered on the display (23-inch spec §13, §72): its name and its branding
// (logo address, tagline, branch name, idle line). Never anything of a customer — the fields are copied one by one from
// the salon's own part of the state. With it, a display that restarts while the network is down still shows the salon's
// header and its saved advertising instead of a spinner (§72: "continue playing cached ads").
import type { CustomerDisplayBranding, CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

export const SALON_STORE_KEY = 'aps.customerDisplay.salon.v1';
export interface SalonMemory { salonName: string; branding?: CustomerDisplayBranding }

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function storage(): Store | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
// only the salon's own stored logo (the server already vets it — safeSalonLogoUrl); anything else is dropped on read
const LOGO = /^(?:https:\/\/[^\s"'<>]+)?\/(?:media\/)?salon-logos\/[A-Za-z0-9_-]{1,64}\/logo-[0-9a-f]{24}\.(?:png|jpg|webp)$/;

/** The salon's part of a display state — nothing else. */
export function salonOf(s: Pick<CustomerDisplayState, 'salonName' | 'branding'>): SalonMemory {
  const b = s.branding;
  return {
    salonName: typeof s.salonName === 'string' ? s.salonName : '',
    ...(b ? { branding: { salonName: b.salonName, logoUrl: b.logoUrl, tagline: b.tagline, branchName: b.branchName, idleMessage: b.idleMessage } } : {}),
  };
}

/** Remember the salon (written only when it changed). Never throws. */
export function rememberSalon(s: Pick<CustomerDisplayState, 'salonName' | 'branding'>, store: Store | null = storage()): void {
  if (!store) return;
  try {
    const v = JSON.stringify(salonOf(s));
    if (store.getItem(SALON_STORE_KEY) !== v) store.setItem(SALON_STORE_KEY, v);
  } catch { /* storage full or blocked: the display simply has no memory */ }
}

/** What was remembered, re-checked field by field (a corrupted or foreign value is ignored), or null. */
export function recallSalon(store: Store | null = storage()): SalonMemory | null {
  if (!store) return null;
  try {
    const j = JSON.parse(store.getItem(SALON_STORE_KEY) || 'null');
    if (!j || typeof j !== 'object' || typeof j.salonName !== 'string') return null;
    const b = j.branding;
    const name = b && typeof b === 'object' ? text(b.salonName, 80) : null;
    const logo = name && typeof b.logoUrl === 'string' && LOGO.test(b.logoUrl) ? b.logoUrl : null;
    return {
      salonName: j.salonName.slice(0, 80),
      ...(name ? { branding: { salonName: name, logoUrl: logo, tagline: text(b.tagline, 60), branchName: text(b.branchName, 60), idleMessage: text(b.idleMessage, 80) } } : {}),
    };
  } catch { return null; }
}
