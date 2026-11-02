// Client-side drop eligibility for the Tech Queue Workload Board. This is the fast, local feedback gate only —
// the server (queue.service) remains authoritative for skill qualification, tenant/location, and conflicts via the
// canonical skillMatch. Here we just decide whether a waiting guest may be dropped onto a technician card now.
// Vietnamese POS mandate (WP-C1): `reasonKey` is the catalogue key (keep it in a note, translated at render); `reason` is
// that text in the current language, read when this is called (never at import).
import { t } from '@aipowersalon/mobile-sdk/i18n';
export type DropTechStatus = string; // available | finishing_soon | in_service | on_break | off_today | ...
const no = (reasonKey: string) => ({ ok: false as const, mode: null, reasonKey, reason: t(reasonKey) });

export function dropEligibility(techStatus: DropTechStatus): { ok: boolean; mode: "now" | "next" | null; reason?: string; reasonKey?: string } {
  if (techStatus === "available") return { ok: true, mode: "now" };
  if (techStatus === "finishing_soon") return { ok: true, mode: "next" }; // queued as the technician's next assignment
  if (techStatus === "in_service") return no("ops.techQueue.drop.midService");
  if (techStatus === "on_break") return no("ops.techQueue.drop.onBreak");
  if (techStatus === "off_today" || techStatus === "scheduled_later") return no("ops.techQueue.drop.off");
  return no("ops.techQueue.drop.unavailable");
}
