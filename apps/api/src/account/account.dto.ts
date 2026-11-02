// account.dto.ts — Apple-compliance account requests (deletion/deactivation) + privacy export.
export type RequestType = 'delete' | 'deactivate';
export interface DeletionRequestResult {
  requestId: string; status: string; requestType: RequestType; submittedAt: string;
  willRemove: string[]; willRetain: string[]; contactEmail: string | null; message: string;
}
export class AccountError extends Error { constructor(public code: string, message: string, public httpStatus = 400) { super(message); } }
export const isUuid = (x: any): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
