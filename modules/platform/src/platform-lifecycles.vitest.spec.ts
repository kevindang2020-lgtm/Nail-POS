// BUILD_PLAN Phase 12 (#27): the platform module's lifecycle machines (platform-lifecycles.ts) — each on a vocabulary
// column with only CHECK-allowed states; AUTOMATION_RULE is exactly RULE_FLOW; today's moves allowed, the closed ones
// (re-cancelling a cancelled subscription, re-applying a scheduled plan change, an approval decided twice) refused.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertTransition, InvalidStateTransitionError, type StateMachine } from '@aipowersalon/database';
import * as P from './platform-lifecycles';
import { canRuleTransition } from './super-admin-automation/automation-core';

const VOCAB: Record<string, string[]> = JSON.parse(readFileSync(new URL('../../../apps/api/db/state-vocabularies.generated.json', import.meta.url), 'utf8')).vocabularies;
const machines = Object.values(P) as StateMachine<string>[];

describe('platform lifecycle machines', () => {
  it('nine machines, each on a vocabulary column, with only CHECK-allowed states', () => {
    expect(machines).toHaveLength(9);
    for (const m of machines) for (const s of m.states) expect(VOCAB[`${m.table}.${m.column}`], `${m.name}: ${s}`).toContain(s);
  });
  it('automation_rule is exactly RULE_FLOW (canRuleTransition)', () => {
    for (const f of P.AUTOMATION_RULE.states) for (const t of P.AUTOMATION_RULE.states) expect(P.AUTOMATION_RULE.can(f, t), `${f} → ${t}`).toBe(canRuleTransition(f, t));
  });
  const cases: Array<[StateMachine<string>, string, string, boolean]> = [
    [P.TENANT_SUBSCRIPTION, 'active', 'paused', true], [P.TENANT_SUBSCRIPTION, 'paused', 'active', true], [P.TENANT_SUBSCRIPTION, 'trialing', 'active', true],
    [P.TENANT_SUBSCRIPTION, 'cancelled', 'cancelled', false], [P.TENANT_SUBSCRIPTION, 'paused', 'paused', false], [P.TENANT_SUBSCRIPTION, 'expired', 'pending_cancellation', false],
    [P.SUBSCRIPTION_CHANGE, 'scheduled', 'applied', true], [P.SUBSCRIPTION_CHANGE, 'applied', 'applied', false], [P.SUBSCRIPTION_CHANGE, 'rejected', 'completed', false],
    [P.PLATFORM_APPROVAL, 'pending', 'approved', true], [P.PLATFORM_APPROVAL, 'approved', 'executed', true], [P.PLATFORM_APPROVAL, 'rejected', 'approved', false], [P.PLATFORM_APPROVAL, 'executed', 'executed', false],
    [P.PLATFORM_FEATURE, 'BETA', 'AVAILABLE', true], [P.PLATFORM_FEATURE, 'EMERGENCY_DISABLED', 'AVAILABLE', false], [P.PLATFORM_FEATURE, 'AVAILABLE', 'EMERGENCY_DISABLED', false],
    [P.AUTOMATION_FAILURE, 'resolved', 'retrying', false], [P.AUTOMATION_EXECUTION, 'failed', 'success', false], [P.SUBSCRIPTION_PLAN_VERSION, 'superseded', 'active', false],
    [P.TENANT_ADD_ON, 'cancelled', 'active', true], [P.TENANT_ADD_ON, 'cancelled', 'cancelled', false],
  ];
  for (const [m, f, t, ok] of cases) it(`${m.name}: ${f} → ${t} ${ok ? 'allowed' : 'refused (409)'}`, () => {
    if (ok) expect(() => assertTransition(m, f, t)).not.toThrow();
    else expect(() => assertTransition(m, f, t)).toThrow(InvalidStateTransitionError);
  });
});
