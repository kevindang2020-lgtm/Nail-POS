// html-escape-gate.vitest.spec.ts — Security Deep Scan §87: the check:html escaping rule (apps/api/scripts/
// audit-html-apps.js) catches a bare API value in a markup template and accepts the escaped / constant forms.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { escapingProblems } = require('../../scripts/audit-html-apps.js');

describe('check:html escaping (§87)', () => {
  it('flags bare values in markup templates — the forms the two apps actually had', () => {
    expect(escapingProblems('el.innerHTML = times.map((t) => `<button data-t="${t}">${t}</button>`).join("");')).toEqual(['t', 't']);
    expect(escapingProblems("x.innerHTML = `<b>${s.durationMinutes ? ' · ' + s.durationMinutes + ' min' : ''}</b>`;")).toEqual(['s.durationMinutes']);
    expect(escapingProblems("render(`<p>${t('more',{n:more})}</p>`);")).toEqual(["t('more',{n:more})"]);
    expect(escapingProblems('render(`<p>${c.name || "guest"}</p>`);')).toEqual(['c.name']);
  });
  it('accepts escaped values, constant i18n keys, literals, nested templates, local html helpers and conditions', () => {
    const js = `function row(x){ return \`<li>\${esc(x.name)}</li>\`; }
      render(\`<div class="\${open ? 'open' : ''}">\${esc(t('see',{name:n}))} \${t('title')} \${money(c.cents)} \${list.map(row).join('')}
        \${items.map(i => \`<i>\${esc(i)}</i>\`).join('')} \${ok && \`<b>\${esc(v)}</b>\`} \${row(z)} \${42}</div>\`);
      const plain = \`no markup \${anything}\`;`;
    expect(escapingProblems(js)).toEqual([]);
  });
});
