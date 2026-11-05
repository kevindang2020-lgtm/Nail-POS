// actor-stamp.ts — who the Kysely actor-stamp plugin records in created_by / updated_by / deleted_by (Constitution 1 §34).
// A PERSON only: a staff user, a technician, a customer or a Super Admin, by id. A device, an integration grant, a worker
// principal (`worker:<job>`) or the system are not people — they stamp nothing (NULL on update) and the audit row names
// them. The plugin additionally refuses anything that is not a uuid.
import { getContext } from '@aipowersalon/observability';

const PEOPLE = new Set(['user', 'technician', 'customer', 'super_admin']);
export function stampActor(): string | null {
  const c = getContext();
  if (!c?.actorId || !PEOPLE.has(String(c.actorType ?? ''))) return null;
  return c.actorId;
}
