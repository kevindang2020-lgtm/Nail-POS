// ai-checkout-upsell.tools.ts — the ONLY surface the AI model may call (§42). Every tool is read-only this stage, uses
// trusted server-derived context, validates the checkoutId (rejecting anything that isn't a plain id — no injection, no
// tenant/branch selection), and never accepts a model-supplied price. Charge-producing tools (add_service_addon,
// enroll_membership, …) arrive in stage 3 and will each require explicit confirmation + idempotency. The registry is
// frozen so the model cannot add or mutate tools at runtime.
import type { AiCheckoutUpsellService } from './ai-checkout-upsell.service';
import type { AiCheckoutUpsellContext } from './ai-checkout-upsell.dto';

export interface UpsellToolInput { checkoutId?: string }

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
function requireCheckoutId(i: UpsellToolInput): string {
  const id = (i?.checkoutId ?? '').trim();
  if (!ID.test(id)) throw new Error('CHECKOUT_NOT_FOUND'); // reject injection / malformed ids before any lookup
  return id;
}

export interface UpsellTool {
  name: string; description: string; readOnly: boolean;
  run: (svc: AiCheckoutUpsellService, ctx: AiCheckoutUpsellContext, input: UpsellToolInput) => Promise<unknown>;
}

export const AI_CHECKOUT_UPSELL_TOOLS: readonly UpsellTool[] = Object.freeze([
  { name: 'get_checkout_context', description: 'Read-only checkout context (services, subtotal, status, enabled). No customer PII beyond id.', readOnly: true,
    run: async (s, c, i) => s.context(c, requireCheckoutId(i)) },
  { name: 'get_checkout_recommendations', description: 'Ranked, capped, transparent recommendations for this checkout. Read-only; charge-producing actions require separate confirmation.', readOnly: true,
    run: async (s, c, i) => s.recommendations(c, requireCheckoutId(i)) },
]);

/** Every tool is read-only in this stage — asserted by the wiring test so a mutation tool can't slip in unnoticed. */
export function allToolsReadOnly(): boolean { return AI_CHECKOUT_UPSELL_TOOLS.every(t => t.readOnly === true); }
