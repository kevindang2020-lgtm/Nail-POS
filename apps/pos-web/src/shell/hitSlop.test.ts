// hitSlop.test.ts — §78 hit areas: the layout maths (computeSlop) and the DOM wiring (applyHitSlop writes the variables,
// never touches the layout box). The real geometry (elementFromPoint at the 44 px box) is checked in a real Chromium by
// tooling/e2e/pos-vi-one-screen.mjs → measureHitAreas and tooling/e2e/pos-vi-one-screen.test.mjs.
import { describe, expect, it } from 'vitest';
import { applyHitSlop, computeSlop, HIT_MIN, type Box } from './hitSlop';

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });
const grownH = (b: Box, s: { t: number; b: number }) => b.bottom - b.top + s.t + s.b;
const grownW = (b: Box, s: { l: number; r: number }) => b.right - b.left + s.l + s.r;
const hitRect = (b: Box, s: { t: number; r: number; b: number; l: number }) => ({ left: b.left - s.l, top: b.top - s.t, right: b.right + s.r, bottom: b.bottom + s.b });
const overlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1e-9 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1e-9;

describe('computeSlop (§78)', () => {
  it('a lone 25 px button grows to a 44 × 44 hit area, centred', () => {
    const b = box(100, 100, 30, 25);
    const [s] = computeSlop([b], [true], [null]);
    expect(grownH(b, s)).toBeCloseTo(HIT_MIN, 6);
    expect(grownW(b, s)).toBeCloseTo(HIT_MIN, 6);
    expect(s.t).toBeCloseTo(s.b, 6); expect(s.l).toBeCloseTo(s.r, 6);
  });

  it('a control already ≥ 44 px does not grow on that axis', () => {
    const [s] = computeSlop([box(0, 100, 200, 20)], [true], [null]);
    expect(s.l).toBe(0); expect(s.r).toBe(0); expect(s.t).toBe(12); expect(s.b).toBe(12);
  });

  it('two stacked rows 27 px apart split the gap: each reaches the midpoint, the hit areas never overlap', () => {
    const a = box(0, 100, 60, 21), b = box(0, 127, 60, 21);   // 6 px gap between them
    const [sa, sb] = computeSlop([a, b], [true, true], [null, null]);
    expect(overlap(hitRect(a, sa), hitRect(b, sb))).toBe(false);
    expect(sa.b + sb.t).toBeCloseTo(6, 6);                    // the whole gap is used — the maximum non-overlapping area
    expect(sa.t).toBeCloseTo((HIT_MIN - 21) / 2, 6);          // the free side still gets the full growth
  });

  it('two side-by-side buttons 3 px apart split the gap horizontally and still grow vertically', () => {
    const a = box(100, 100, 30, 20), b = box(133, 100, 30, 20);
    const [sa, sb] = computeSlop([a, b], [true, true], [null, null]);
    expect(overlap(hitRect(a, sa), hitRect(b, sb))).toBe(false);
    expect(sa.r + sb.l).toBeCloseTo(3, 6);
    expect(grownH(a, sa)).toBeCloseTo(HIT_MIN, 6); expect(grownH(b, sb)).toBeCloseTo(HIT_MIN, 6);
  });

  it('a text field is an obstacle: never grows, and the button next to it may take the whole gap but not enter it', () => {
    const btn = box(100, 100, 30, 20), field = box(100, 126, 200, 30);   // 6 px below
    const [sb, sf] = computeSlop([btn, field], [true, false], [null, null]);
    expect(sf).toEqual({ t: 0, r: 0, b: 0, l: 0 });
    expect(sb.b).toBeCloseTo(6, 6);
    expect(overlap(hitRect(btn, sb), field)).toBe(false);
  });

  it('stays inside its bounds (a scroll extent / the viewport): never adds a scrollbar', () => {
    const b = box(5, 3, 30, 20);
    const [s] = computeSlop([b], [true], [box(0, 0, 500, 500)]);
    expect(s.t).toBe(3); expect(s.l).toBe(5); expect(s.b).toBe(12);
  });

  it('a dense grid of 200 small buttons: no two hit areas overlap', () => {
    const boxes: Box[] = [];
    for (let r = 0; r < 20; r++) for (let c = 0; c < 10; c++) boxes.push(box(c * 34, r * 29, 30, 25));
    const s = computeSlop(boxes, boxes.map(() => true), boxes.map(() => null));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      expect(overlap(hitRect(boxes[i], s[i]), hitRect(boxes[j], s[j]))).toBe(false);
    }
    // an inner button gets the whole 4 px gaps around it: 30 + 4 = 34 wide, 25 + 4 = 29 tall
    const inner = 5 * 10 + 5;
    expect(grownW(boxes[inner], s[inner])).toBeCloseTo(34, 6);
    expect(grownH(boxes[inner], s[inner])).toBeCloseTo(29, 6);
  });
});

describe('applyHitSlop (DOM wiring)', () => {
  it('marks a compact button with a pseudo-element mode and negative insets; leaves its own style box alone', () => {
    document.body.innerHTML = '<div class="main"><button id="b" style="display:inline-block">Notify</button><input id="i" /></div>';
    const b = document.getElementById('b')!, i = document.getElementById('i')!;
    // jsdom has no layout: give the two controls boxes
    b.getBoundingClientRect = () => ({ left: 100, top: 100, right: 150, bottom: 125, width: 50, height: 25, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    i.getBoundingClientRect = () => ({ left: 100, top: 300, right: 300, bottom: 330, width: 200, height: 30, x: 100, y: 300, toJSON: () => ({}) }) as DOMRect;
    const res = applyHitSlop(document);
    expect(res.grown).toBe(1);
    expect(b.getAttribute('data-hs')).toBe('a');
    // the insets are measured from the padding box, so the (jsdom default 2 px) border is added
    const bw = parseFloat(getComputedStyle(b).borderTopWidth) || 0;
    expect(b.style.getPropertyValue('--hs')).toBe(`${-(9.5 + bw)}px ${-bw}px ${-(9.5 + bw)}px ${-bw}px`);
    expect(b.style.width).toBe(''); expect(b.style.height).toBe(''); expect(b.style.padding).toBe(''); expect(b.style.margin).toBe('');
    expect(i.hasAttribute('data-hs')).toBe(false);
  });

  it('a button whose own overflow clips a pseudo-element is left alone and counted', () => {
    document.body.innerHTML = '<div class="main"><button id="b" style="display:inline-block;overflow:hidden">Long label</button></div>';
    const b = document.getElementById('b')!;
    b.getBoundingClientRect = () => ({ left: 0, top: 0, right: 60, bottom: 20, width: 60, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const res = applyHitSlop(document);
    expect(res.grown).toBe(0);
    expect(res.skipped['own-overflow']).toBe(1);
    expect(b.hasAttribute('data-hs')).toBe(false);
  });
});
