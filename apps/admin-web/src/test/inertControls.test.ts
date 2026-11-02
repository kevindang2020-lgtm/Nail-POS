// inertControls.test.ts — SCAN (Oct 12 2026): Super Admin has NO control that looks live but does nothing (a button with
// no handler, a no-op handler, an href="#", a pointer-cursor div with no click, a controlled field that ignores input, a
// mockup's calendar date typed into the UI).
// Disabled-with-a-reason is honest and allowed. The detector itself is proved on a sample so this can never go vacuous.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a plain .mjs tool with no type declarations
import { scanApp, scanSource } from '../../../../tooling/ci/check-inert-controls.mjs';

describe('Super Admin inert controls', () => {
  it('the detector flags each lie shape and passes the honest ones', () => {
    const src = `export const X = () => (<div>
      <button className="btn">View Report</button>
      <button disabled title="not yet">Add Widget</button>
      <button onClick={() => {}}>Noop</button>
      <input value={v} />
      <a href="#">Dead</a>
      <div style={{ cursor: 'pointer' }}>Card</div>
      <form><button>Save</button></form>
      <button onClick={go}>Go</button>
      <span>Today, May 06</span>
      <span>{label}</span>
    </div>);`;
    const kinds = scanSource('x.tsx', src).map((f: any) => `${f.kind}:${f.label}`);
    expect(kinds).toEqual(['INERT-BUTTON:View Report', 'NOOP-HANDLER:button onClick', 'CONTROLLED-NO-ONCHANGE:input', 'DEAD-LINK:Dead', 'POINTER-NO-HANDLER:Card', 'FROZEN-DATE:Today, May 06']);
  });
  it('admin-web has none', () => {
    expect(scanApp('admin-web').map((f: any) => `${f.file}:${f.line} ${f.kind} ${f.label}`)).toEqual([]);
  });
});
