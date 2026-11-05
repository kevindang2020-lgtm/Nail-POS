/* tech-errors.ts — shared TechError so both the service (orchestration) and the repository (data access) can throw
 * the same typed error mapped to HTTP by the controller (forbidden/not_technician → 403, not_found → 404, else 400). */
export type TechErrorCode = 'not_technician' | 'not_found' | 'forbidden' | 'invalid_state' | 'conflict';
export class TechError extends Error {
  constructor(public code: TechErrorCode, message: string) { super(message); this.name = 'TechError'; }
}
