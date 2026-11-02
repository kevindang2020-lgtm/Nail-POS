// useTechnicianNames.ts — 200-technician mandate §2 (Oct 26 2026): screens that only need the NAMES of a few technicians
// (the AI Scheduling Optimizer's recommendations, a preselected technician on New Booking) used to download the whole
// roster (`filters.technicians`, every technician of the salon) to look them up. This resolves names on demand instead:
// names already known on the screen are seeded, and an unknown id is looked up ONCE through the server-paged technician
// read (GET /pos/booking/technicians?locate=<id>&pageSize=1&status=all — one technician, never a roster page).
import { useCallback, useRef, useState } from 'react';
import { posBookingApi } from '../api/posBookingApi';

export type TechnicianName = { technicianId: string; name: string };

/** Looks one technician up by id (one row). Resolves undefined when the server does not know her (or the read fails). */
export async function lookupTechnicianName(technicianId: string, date?: string): Promise<string | undefined> {
  const r = await posBookingApi.technicians({ locate: technicianId, pageSize: 1, status: 'all', date }).catch(() => null);
  const t = r && Array.isArray(r.technicians) ? r.technicians.find((x) => x.technicianId === technicianId) : undefined;
  return t?.name;
}

export function useTechnicianNames(seed: TechnicianName[] = []): { name: (id: string | null | undefined) => string | undefined; remember: (id: string, name: string) => void } {
  const known = useRef(new Map<string, string>());
  const asked = useRef(new Set<string>());
  const [, bump] = useState(0);
  for (const s of seed) if (s.technicianId && s.name && !known.current.has(s.technicianId)) known.current.set(s.technicianId, s.name);
  const remember = useCallback((id: string, nm: string) => { if (id && nm && known.current.get(id) !== nm) { known.current.set(id, nm); bump((x) => x + 1); } }, []);
  const name = useCallback((id: string | null | undefined) => {
    if (!id) return undefined;
    const hit = known.current.get(id);
    if (hit !== undefined) return hit;
    if (!asked.current.has(id)) {
      asked.current.add(id);
      // outside render: one lookup per unknown id, a re-render when it lands
      queueMicrotask(() => { void lookupTechnicianName(id).then((nm) => { if (nm) { known.current.set(id, nm); bump((x) => x + 1); } }); });
    }
    return undefined;
  }, []);
  return { name, remember };
}
