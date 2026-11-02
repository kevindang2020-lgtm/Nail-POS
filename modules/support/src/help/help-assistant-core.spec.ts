/**
 * help-assistant-core.spec.ts — the AI Support Assistant, exercised deterministically with the Mock provider.
 * Verifies: the grounding prompt forbids outside knowledge and numbers/cites sources; the no-source fallback is
 * honest (ungrounded, low confidence, escalation, never fabricated); the grounded/ungrounded heuristic; and the
 * end-to-end flow — no approved source → fallback with NO model call, sources present → answer cites them.
 */
import { buildGroundingPrompt, noSourceFallback, isGroundedAnswer, buildEscalationTicket, HelpAssistantService, type HelpRetriever } from './help-assistant.service';
import { AiGatewayService, MockAiProvider } from '@aipowersalon/ai';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'owner', permissions: [] };

async function main(): Promise<void> {
  console.log('\n== grounding prompt ==');
  const gp = buildGroundingPrompt('how do refunds work?', [{ title: 'Refunds', summary: 'steps', categoryLabel: 'Payments' }]);
  check('system forbids outside knowledge', /ONLY using the numbered SOURCES/.test(gp.system));
  check('prompt numbers the source', gp.prompt.includes('[1] Refunds'));

  console.log('\n== honest fallback ==');
  const fb = noSourceFallback();
  check('ungrounded + low confidence', fb.grounded === false && fb.confidence === 'low');
  check('offers escalation', fb.escalation.liveChat && fb.escalation.ticket);
  check('non-fabricated answer', /couldn't find/i.test(fb.answer));

  console.log('\n== grounded heuristic ==');
  check('disclaimer → ungrounded', isGroundedAnswer("I don't have enough information") === false);
  check('normal answer → grounded', isGroundedAnswer('Go to Checkout, then tap Refund.') === true);

  console.log('\n== end-to-end (Mock provider) ==');
  const gateway = new AiGatewayService(new MockAiProvider());
  const empty: HelpRetriever = { async articles() { return []; } };
  const withSources: HelpRetriever = { async articles() {
    return [{ id: 'a1', slug: 'r', title: 'Refunds', summary: 'steps', categorySlug: 'pay', categoryLabel: 'Payments', viewCount: 0, readingMinutes: 1, lastUpdatedAt: null }];
  } };

  const a1 = await new HelpAssistantService(empty, gateway).ask(ctx, 'anything');
  check('no approved source → fallback, no sources', a1.grounded === false && a1.sources.length === 0);

  const a2 = await new HelpAssistantService(withSources, gateway).ask(ctx, 'how do refunds work?');
  check('with sources → cites the source', a2.sources.length === 1 && a2.sources[0].title === 'Refunds');
  check('returns a model answer', a2.answer.length > 0);

  const a3 = await new HelpAssistantService(withSources, gateway).ask(ctx, '   ');
  check('blank question → fallback', a3.grounded === false && a3.sources.length === 0);

  console.log('\n== persistence (store port) ==');
  const captured: any[] = [];
  const store = { async saveTurn(_c: any, turn: any) { captured.push(turn); return 'conv-1'; } };
  const a4 = await new HelpAssistantService(withSources, gateway, store).ask(ctx, 'how do refunds work?');
  check('persisted turn returns conversationId', a4.conversationId === 'conv-1');
  check('store received question + sources', captured.length === 1 && captured[0].question.length > 0 && Array.isArray(captured[0].answer.sources));
  check('persisted payload carries no system prompt', JSON.stringify(captured[0]).indexOf('You are the AI Support Assistant') === -1);
  const blankCaptured: any[] = [];
  await new HelpAssistantService(withSources, gateway, { async saveTurn(_c: any, t: any) { blankCaptured.push(t); return 'x'; } }).ask(ctx, '   ');
  check('blank question is not persisted', blankCaptured.length === 0);

  console.log('\n== escalation ticket draft ==');
  const esc = buildEscalationTicket('Card terminal offline', 'Try rebooting the terminal.');
  check('subject from question', esc.subject === 'Card terminal offline');
  check('description bundles Q + reply', /Question: Card terminal offline/.test(esc.description) && /Assistant reply:/.test(esc.description));
  check('default category general', esc.category === 'general');

  console.log('\nhelp-assistant-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
