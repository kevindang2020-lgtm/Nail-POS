#!/usr/bin/env node
// run-ai-evals.mjs — Constitution 10 §37: actual evaluation RESULTS, not a description of a framework.
//
// Honest framing: with no provider key configured this runs a deterministic stand-in, so what it proves is that
// the harness discriminates — a correct output passes, a wrong one fails for the stated reason, and the
// comparison verdicts behave. Against a real provider the same command yields real quality numbers. A report
// section claiming quality scores from a mock would be exactly the invented figure §174 refuses.
const tsx = await import('tsx/esm/api').catch(() => null);
if (tsx) tsx.register();
const { GOLDEN_CASES, scoreCaseWithSchema, compareRuns } = await import('../../../modules/ai/src/ai/ai-evaluation.ts');

/** A stand-in that answers each golden case correctly — the "incumbent". */
const CORRECT = {
  'rev-neg-wait': { sentiment: 'negative', theme: 'wait time', confidence: 0.9 },
  'rev-pos-plain': { sentiment: 'positive', theme: 'gel quality', confidence: 0.95 },
  'rev-sarcasm': { sentiment: 'negative', theme: 'wait time', confidence: 0.7 },
  'rev-injection': { sentiment: 'neutral', theme: 'brief review', confidence: 0.4 },
  'resp-no-refund': { reply: 'We are sorry the polish did not last. Please call us and we will make it right.', tone: 'apologetic' },
  'resp-no-invented-staff': { reply: 'Thank you so much — we are delighted you enjoyed your visit.', tone: 'warm' },
  'ocr-cents': { vendor: 'Beauty Supply Co', date: '2026-08-14', line_items: [], subtotal_cents: 4200, tax_cents: 290, total_cents: 4490, confidence: 0.88 },
  'recon-no-adjust': { likely_causes: [{ cause: 'A deposit was split across two bank batches', check: 'the bank statement for a second credit' }], summary: 'The shortfall matches a split deposit.' },
  'queue-no-substitute': { explanation: 'T-1 has the closest skill match and the shortest projected wait.', key_factor: 'skill match' },
  'iso-other-tenant': { narrative: 'August revenue was $4,500 across the period.', highlights: ['revenue steady'] },
};
/** A "candidate" that is better on one case and WORSE on a safety case — the situation §123 is about. */
const CANDIDATE = { ...CORRECT,
  'rev-pos-plain': { sentiment: 'positive', theme: 'long-lasting gel', confidence: 0.99 },
  'resp-no-refund': { reply: 'We are so sorry — we would like to offer you a refund for the service.', tone: 'apologetic' },
};

const run = (label, answers, latency, cost) => ({ label, results: GOLDEN_CASES.map((c) => scoreCaseWithSchema(c, answers[c.id], { latencyMs: latency, costMicroUsd: cost })) });

const incumbent = run('incumbent', CORRECT, 420, 45);
const candidate = run('candidate', CANDIDATE, 610, 190);

console.log('§37 Evaluation results — golden dataset\n');
for (const r of incumbent.results) console.log(`  ${r.passed ? '✓' : '✗'} ${r.caseId.padEnd(24)} ${r.kind.padEnd(18)}${r.passed ? '' : ' → ' + r.failures.join('; ')}`);
const pass = incumbent.results.filter((r) => r.passed).length;
console.log(`\n  incumbent: ${pass}/${incumbent.results.length} passed\n`);

console.log('§122/§123 Regression comparison — a candidate that improves quality but breaks one SAFETY case\n');
for (const r of candidate.results) if (!r.passed) console.log(`  ✗ ${r.caseId} (${r.kind}) → ${r.failures.join('; ')}`);
const cmp = compareRuns(incumbent, candidate);
console.log(`\n  incumbent  pass ${(cmp.incumbent.passRate * 100).toFixed(0)}%  safety ${(cmp.incumbent.safetyPassRate * 100).toFixed(0)}%  ${cmp.incumbent.avgLatencyMs} ms  ${cmp.incumbent.avgCostMicroUsd} µUSD`);
console.log(`  candidate  pass ${(cmp.candidate.passRate * 100).toFixed(0)}%  safety ${(cmp.candidate.safetyPassRate * 100).toFixed(0)}%  ${cmp.candidate.avgLatencyMs} ms  ${cmp.candidate.avgCostMicroUsd} µUSD`);
console.log(`  regressions ${cmp.regressions.join(', ') || 'none'} · improvements ${cmp.improvements.join(', ') || 'none'}`);
console.log(`\n  VERDICT: ${cmp.verdict.toUpperCase()} — ${cmp.reasons.join('; ')}`);

console.log('\nNOTE: no provider key is configured, so these answers come from a deterministic stand-in. What this');
console.log('demonstrates is that the harness DISCRIMINATES. Real quality numbers require the same command with a');
console.log('provider key; publishing mock-derived quality scores would be the invented figure §174 refuses.');
process.exit(cmp.verdict === 'reject' ? 0 : 1);   // this scenario MUST reject; anything else means the gate is broken
