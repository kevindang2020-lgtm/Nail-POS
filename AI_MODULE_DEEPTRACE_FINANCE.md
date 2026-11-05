# AI Finance Modules — Deep-Chain Trace (ai_money_protection, ai_deposit_reconciliation)

Both are **tenant-scoped POS modules** (not Super Admin) — money protection and reconciliation are operated by
the tenant, with the AI gateway providing detection/explanations. Both behind
`@UseGuards(TenantAuthGuard, RolePermissionGuard)` with granular `@RequirePermission`, registered in AppModule
(`MoneyProtectionModule`, `DepositReconciliationModule`), integer-cents money (no floats), gateway-backed
explanations, and evidence/usage trails.

## ai_money_protection  → `pos/ai-money-protection`

- Permissions: `ai_money_protection.view` / `.view_alerts` / `.investigate` / `.resolve` / `.manage_rules` /
  `.manage_settings`.
- Endpoints: `GET state|rules|settings|alerts|investigations|investigations/:id`;
  `POST settings/:ruleId|evaluate|alerts/:id/explain|investigations|investigations/:id/notes|/assign|/status|/resolve`.
- **Detection**: `POST evaluate` runs the rule engine (duplicate charges, unusual refunds/voids, suspicious
  discounts, abnormal tips, repeated failures, ticket↔payment mismatch). `alerts/:id/explain` routes through
  the AI gateway (`ai-money-protection-explain.service.ts`) — no direct provider call.
- **Evidence / audit**: the investigation workflow (create → notes → assign → status → resolve) preserves
  evidence; backed by migration **289** (audit_investigations), **323** (alerts), **324** (investigations),
  **325** (rule_settings).
- **Money**: 155 integer-cent references, **0 floating-point money operations**.
- Tests: **18 spec files**. **Status: Complete.**

## ai_deposit_reconciliation  → `pos/deposit-reconciliation`

- Permissions: `reconciliation.view` / `.manage` / `.approve`.
- Endpoints: `GET state|bank-accounts|deposits|fee-schedules|fee-reconciliation|adjustments|duplicates|
  exceptions|reports/daily|reports/summary|reports/daily/export|periods|periods/:id/check-close`;
  `POST bank-accounts|deposits|deposits/:id/link|fee-schedules|exceptions|exceptions/:id/assign|/transition|
  /resolve|/reopen|explain/settlement/:id|periods|periods/:id/close|/reopen|rescan`.
- **Matching**: transaction→batch→settlement→bank-deposit matching, missing-deposit / difference / fee-variance
  detection, duplicate-settlement detection, with a human-approval **exception** workflow
  (assign → transition → resolve/reopen) and period close/reopen with a check-close gate.
- **AI explanation + usage**: `explain/settlement/:id` → `deposit-reconciliation.explain.service.ts` (gateway),
  and `deposit-reconciliation.explain.usage.ts` writes real usage into the canonical **`ai_usage_logs`** table
  (`tenant_id, package_code, model_provider, model_name, input/output/total_tokens, cost_estimate_cents,
  status`) — so finance AI usage is tracked with a non-null `package_code`.
- **Money**: 243 integer-cent references; safe decimal handling, no floats.
- Tests: **18 spec files**. **Status: Complete.**

## Invariants confirmed (both)
- Tenant-scoped enforcement (`TenantAuthGuard` + `RolePermissionGuard`); server-derived identity.
- AI explanations run through the shared gateway — **no direct provider calls**.
- Integer-cents money throughout; **no floating-point arithmetic** on money.
- Evidence preserved via investigation/exception records; deposit-recon AI usage logged to `ai_usage_logs`.
- Sensitive actions (rule/settings changes, exception resolution, period close, deposit linking) are
  permission-gated.
