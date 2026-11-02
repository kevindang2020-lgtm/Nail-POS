import { nextTemplateVersion, canPublishTemplate, canArchiveTemplate, validateTemplateSections, buildGroundedNarrative, extractNumbers, validateNarrativeGrounding } from './report-template-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// versioning
eq(nextTemplateVersion([]), 1, 'first version');
eq(nextTemplateVersion([1, 2, 3]), 4, 'next after 3');
eq(nextTemplateVersion([2, 5, 3]), 6, 'max+1');
ok(canPublishTemplate('draft') && !canPublishTemplate('published'), 'publish only draft');
ok(canArchiveTemplate('draft') && canArchiveTemplate('published') && !canArchiveTemplate('archived'), 'archive draft/published');
// sections validation
ok(!validateTemplateSections([]).ok, 'empty sections rejected');
ok(!validateTemplateSections([{ id: '', title: 'x', metricKeys: [] }]).ok, 'missing id rejected');
ok(!validateTemplateSections([{ id: 's1', title: '', metricKeys: [] }]).ok, 'missing title rejected');
{ const r = validateTemplateSections([{ id: 's1', title: 'Revenue', metricKeys: ['revenueCents', 'bookings'] }]); ok(r.ok, 'valid sections'); }
// grounded narrative: present resolves, missing → — grounded:false
{ const g = buildGroundedNarrative([{ id: 's1', title: 'Revenue', metricKeys: ['revenueCents', 'refundsCents', 'ghost'] }], { revenueCents: 128000, refundsCents: 2000 });
  eq(g.sections[0].lines[0], { key: 'revenueCents', value: 128000, grounded: true }, 'present metric grounded');
  eq(g.sections[0].lines[2], { key: 'ghost', value: '—', grounded: false }, 'missing metric → — not fabricated');
  ok(g.allGrounded === false, 'allGrounded false when a metric missing'); }
{ const g = buildGroundedNarrative([{ id: 's1', title: 'B', metricKeys: ['bookings'] }], { bookings: 42 }); ok(g.allGrounded === true, 'allGrounded true when all present'); }
// number extraction + grounding gate (anti-hallucination)
eq(extractNumbers('Revenue was 1,280.00 across 42 bookings'), [1280, 42], 'extracts numbers incl. commas');
ok(validateNarrativeGrounding('Revenue 1280 across 42 bookings', [1280, 42, 3]).ok, 'all numbers grounded → ok');
{ const r = validateNarrativeGrounding('Revenue 1280 across 99 bookings', [1280, 42]); ok(!r.ok && (r as any).offending.includes(99), 'invented 99 rejected'); }
{ const r = validateNarrativeGrounding('Growth of 500%', [128000, 42]); ok(!r.ok && (r as any).offending.includes(500), 'invented 500 rejected'); }
console.log(`report-template-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
