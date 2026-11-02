// step-up.ts — Constitution 7 §8: when the API answers 403 STEP_UP_REQUIRED, the client asks the registered handler (the
// StepUpHost prompt) to re-confirm the password + code, then retries the original request ONCE. No handler, a cancelled
// prompt, or a second refusal → the original error reaches the screen as before.
let handler: (() => Promise<boolean>) | null = null;
export function setStepUpHandler(h: (() => Promise<boolean>) | null): void { handler = h; }
export function stepUpHandler(): (() => Promise<boolean>) | null { return handler; }
export const isStepUpRequired = (status: number, json: unknown): boolean => status === 403 && !!json && typeof json === 'object' && ((json as any).code === 'STEP_UP_REQUIRED' || (json as any).error?.code === 'STEP_UP_REQUIRED');
