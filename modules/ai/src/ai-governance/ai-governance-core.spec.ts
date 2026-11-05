/** ai-governance-core.spec.ts — enforcement matrix (§3–§4), conservative defaults, permission gating, isolation. */
import { canRun, canRecommend, canDraft, requiresApproval, canAutoExecute, withDefaults, DEFAULT_MODE, isControlMode } from './ai-governance.dto';
import { InMemoryAiGovernanceRepo } from './ai-governance.repository';
import { AiGovernanceService } from './ai-governance.service';

let pass = 0, fail = 0;
function check(n: string, c: boolean): void { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } }

async function main(): Promise<void> {
  console.log('\n== enforcement matrix ==');
  check('disabled cannot run', !canRun('disabled'));
  check('observe_only runs but cannot recommend', canRun('observe_only') && !canRecommend('observe_only'));
  check('recommendation_only recommends, no draft', canRecommend('recommendation_only') && !canDraft('recommendation_only'));
  check('draft_only can draft', canDraft('draft_only'));
  check('only approved_automation auto-executes (standard)', canAutoExecute('approved_automation', 'standard') && !canAutoExecute('confirm_before_action', 'standard'));
  check('SENSITIVE never auto-executes even under approved_automation (§4)', !canAutoExecute('approved_automation', 'sensitive') && requiresApproval('approved_automation', 'sensitive'));
  check('approval_required needs approval', requiresApproval('approval_required', 'standard'));

  console.log('\n== conservative default ==');
  check('default mode is recommendation_only', DEFAULT_MODE === 'recommendation_only');
  const d = withDefaults([], ['ai_booking_assistant', 'ai_reception_copilot']);
  check('unset assistants default safely', d.length === 2 && d.every((a) => a.mode === 'recommendation_only'));
  check('isControlMode rejects junk', !isControlMode('full_autonomy') && isControlMode('draft_only'));

  console.log('\n== service: permission gating + persistence ==');
  const svc = new AiGovernanceService(new InMemoryAiGovernanceRepo(), () => ['ai_booking_assistant', 'ai_reception_copilot']);
  let threw = false; try { await svc.setMode({ tenantId: 't1', userId: 'u1', role: 'receptionist', permissions: [] }, 'ai_booking_assistant', 'approved_automation'); } catch { threw = true; }
  check('non-owner cannot change mode', threw);
  // BUILD_PLAN Phase 9: the gate is ai.control.manage (owners hold every tenant key) — the role name alone is no longer enough
  let threwOwnerNoKey = false; try { await svc.setMode({ tenantId: 't1', userId: 'u9', role: 'OWNER', permissions: [] }, 'ai_booking_assistant', 'approval_required'); } catch { threwOwnerNoKey = true; }
  check('an OWNER-role session without ai.control.manage (DENIED) cannot change mode', threwOwnerNoKey);
  const updated = await svc.setMode({ tenantId: 't1', userId: 'u9', role: 'OWNER', permissions: ['ai.control.manage'] }, 'ai_booking_assistant', 'approval_required');
  check('owner sets mode + records actor', updated.mode === 'approval_required' && updated.updatedByUserId === 'u9');
  let threw2 = false; try { await svc.setMode({ tenantId: 't1', userId: 'u9', role: 'OWNER', permissions: ['ai.control.manage'] }, 'ai_booking_assistant', 'full_autonomy'); } catch { threw2 = true; }
  check('invalid mode rejected', threw2);
  const decision = await svc.decide('t1', 'ai_booking_assistant', 'standard');
  check('decide reflects stored mode (approval_required -> needsApproval)', decision.needsApproval === true && decision.autoExecute === false);

  console.log('\n== audit (spec §54: mutation is audited) ==');
  const calls: any[] = [];
  const audited = new AiGovernanceService(new InMemoryAiGovernanceRepo(), () => ['ai_booking_assistant'], { record: async (ctx, input) => { calls.push({ ctx, input }); return null; } });
  await audited.setMode({ tenantId: 't1', userId: 'u9', role: 'OWNER', permissions: ['ai.control.manage'] }, 'ai_booking_assistant', 'disabled');
  check('setMode writes an audit event with actor + new mode', calls.length === 1 && calls[0].input.action === 'ai.control_mode.changed' && calls[0].input.metadata.mode === 'disabled' && calls[0].ctx.userId === 'u9');

  console.log(`\nai-governance-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
