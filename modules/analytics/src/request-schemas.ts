// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the analytics module's request-body schemas (Owner App + the AI
// Business Assistant), applied with @Body(ValidatedBody(SCHEMA)). Written from each handler and the service method it
// calls (the keys actually read) and from owner-web (ownerApi) and pos-web (posAiBusinessApi, POSAiAlertsScreen) —
// every body sent today passes. The services keep their domain rules (bounded metric / intent ids, YYYY-MM-DD,
// integer cents ≥ 0) and answer them with their own messages; the schema fixes the shape. Unknown fields are stripped —
// which also closes POST /owner/expenses spreading the whole body into the repository write.
import { S, type BodySchema } from '@aipowersalon/permissions';

const text = (max: number): BodySchema => S.nullable(S.text(max));
const pin: BodySchema = { type: ['string', 'number', 'null'], maxLength: 32 };

// ── Owner App (owner-web ownerApi) ──────────────────────────────────────────────────────────────────────────────────
export const OWNER_ACTIVITY_BODY: BodySchema = S.object({ screen: text(32), branchId: text(64) });
export const OWNER_CONTEXT_SELECT_BODY: BodySchema = S.object({ mode: text(16), branchId: text(64), pin });
export const OWNER_ACCESS_CODE_BODY: BodySchema = S.object({ currentPassword: text(1024), newCode: { type: ['string', 'number', 'null'], maxLength: 64 } });
const EXPENSE: Record<string, BodySchema> = {
  category: S.text(200), amountCents: S.number(), description: text(4000), vendor: text(500), incurredOn: S.text(32), branchId: text(64),
};
export const OWNER_EXPENSE_CREATE_BODY: BodySchema = S.object(EXPENSE);
export const OWNER_EXPENSE_UPDATE_BODY: BodySchema = S.object(EXPENSE);
/** approve / lock / reopen a payroll period: the owner's PIN only (the period's status moves in the workforce module). */
export const OWNER_PAYROLL_PIN_BODY: BodySchema = S.object({ pin }, [], { 'x-forbidden': ['status', 'state'] });
/** reopen also carries the mandatory written reason (Payroll mandate §124; stored on the period, migration 589) */
/** Weekly Paycheck (Oct 21 2026, §9): APPROVE ALL / APPROVE SELECTED (hold the rest) with the owner's PIN; RETURN / REJECT need a note. */
export const OWNER_PAYCHECK_APPROVE_BODY: BodySchema = S.object({ pin, expectedVersion: S.nullable(S.integer({ minimum: 1 })), calculationHash: S.nullable(S.text(64)), holdTechnicianIds: S.nullable(S.array(S.text(64), { maxItems: 500 })) }, [], { 'x-forbidden': ['status', 'state', 'payableCents'] });
export const OWNER_PAYCHECK_DECISION_BODY: BodySchema = S.object({ note: S.text(1000), expectedVersion: S.nullable(S.integer({ minimum: 1 })) }, ['note']);
export const OWNER_PAYROLL_REOPEN_BODY: BodySchema = S.object({ pin, reason: S.nullable(S.text(500)) }, [], { 'x-forbidden': ['status', 'state'] });

// ── AI Business Assistant (pos-web posAiBusinessApi) ───────────────────────────────────────────────────────────────
export const AI_BUSINESS_REPORT_BODY: BodySchema = S.object({ reportType: text(64) });
export const AI_BUSINESS_ASK_BODY: BodySchema = S.object({ question: text(2000), intent: text(64), preset: text(32), comparePreset: text(32) });
export const AI_BUSINESS_SAVED_QUESTION_BODY: BodySchema = S.object({
  title: text(500), intent: text(64), preset: text(32), comparePreset: text(32), question: text(2000), sharingScope: text(16),
});
export const AI_BUSINESS_ALERT_CREATE_BODY: BodySchema = S.object({
  title: text(500), metricId: text(64), operator: text(8), threshold: S.number(), preset: text(32), minSampleSize: S.nullable(S.number()), frequency: text(16), channel: text(16),
});
export const AI_BUSINESS_ALERT_UPDATE_BODY: BodySchema = S.object({ active: S.boolean(), threshold: S.number(), title: S.text(500) });
