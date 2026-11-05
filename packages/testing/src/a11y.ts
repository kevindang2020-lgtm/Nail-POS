// a11y.ts — Oct 14 build plan §220 ("automated accessibility checks"), rebuilt Oct 21 2026: axe-core over a rendered
// screen in jsdom. `expectNoA11yViolations(container)` fails the test with every violation's rule, impact, help text and
// the first offending node — the checks a screen reader user would hit: missing labels / names, roles, contrast
// (skipped in jsdom: no layout), landmarks, duplicate ids, form fields without labels. Rules that need layout or real
// paint are off (jsdom cannot compute them); everything else is on at WCAG 2.1 A / AA.
// @ts-ignore
import axe from 'axe-core';

const DISABLED = ['color-contrast', 'scrollable-region-focusable', 'region', 'landmark-one-main', 'page-has-heading-one'];

export async function a11yViolations(container: Element): Promise<{ id: string; impact: string | null; help: string; node: string }[]> {
  const results = await (axe as any).run(container, { rules: Object.fromEntries(DISABLED.map((r) => [r, { enabled: false }])), resultTypes: ['violations'] });
  return (results?.violations || []).map((v: any) => ({ id: v.id, impact: v.impact ?? null, help: v.help, node: v.nodes[0]?.html?.slice(0, 160) ?? '' }));
}

export async function expectNoA11yViolations(container: Element, opts: { allow?: string[] } = {}): Promise<void> {
  const v = (await a11yViolations(container)).filter((x) => !(opts.allow ?? []).includes(x.id));
  if (v.length) throw new Error('accessibility violations:\n' + v.map((x) => `  [${x.impact ?? '?'}] ${x.id} — ${x.help}\n      ${x.node}`).join('\n'));
}
