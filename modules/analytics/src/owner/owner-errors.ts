/* owner-errors.ts — typed error for the Owner App surface, mapped to HTTP by the controller. */
export type OwnerErrorCode = 'forbidden' | 'not_found' | 'invalid';
export class OwnerError extends Error {
  constructor(public code: OwnerErrorCode, message: string) { super(message); this.name = 'OwnerError'; }
}
