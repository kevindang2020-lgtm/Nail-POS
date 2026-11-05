# Accessibility Review Report

Audited the actual source of the three apps (not a generic checklist). Baseline is **strong**; a few concrete gaps.

## What's already good (measured)
- **Semantic buttons everywhere:** customer-web 208 `<button>`, tech-web 103, owner-web 62. Tapable actions are real
  buttons (focusable, VoiceOver-actionable), not click-only `<div>`s in the vast majority of cases.
- **Labels:** `aria-label` used heavily (customer 81, tech 52, owner 26). Icon-only controls (back, favorite, toggles)
  carry labels.
- **Dialogs/state:** `aria-modal`, `aria-expanded`, `aria-live`, `aria-hidden` used (customer 71, owner 11, tech 7).
  Modals announce; decorative glyphs are `aria-hidden`.
- **Form inputs:** search/inputs have `aria-label`; toggles are real `<input type="checkbox">` with labels.

## Concrete gaps to fix (small, specific)
1. **`<div onClick>` without keyboard support** — INVESTIGATED & RESOLVED. The raw count over-stated this: nearly all
   matches were `onClick={(e) => e.stopPropagation()}` on modal *content* wrappers (correct — they stop the backdrop's
   close handler, and are not interactive controls). The one genuinely interactive non-button element (the nail-showcase
   post caption) is now keyboard-activatable (`role="button"` + `tabIndex` + Enter/Space `onKeyDown`). The card's primary
   actions (image, reactions, Book Similar) were already real `<button>`s.
   **Plus:** every modal/sheet now closes on **Escape** (new `useEscapeKey` hook) in addition to the backdrop tap and the
   visible close button. The modals already carried `role="dialog"` + `aria-modal="true"`, so dialog semantics were
   sound; Escape closes the last keyboard gap. (owner-web's branch selector already had Escape.)
2. **Small secondary text** — a number of badges/sub-labels render at 10–11.5px (`fontSize: 10`…`11.5`). Fine for
   decoration but tight for low-vision users. Recommend an 11px floor for meaningful text and verifying it scales with
   iOS Dynamic Type once in the WebView (set the viewport to allow user scaling; avoid `maximum-scale=1`).
3. **Color-only status** — status chips (e.g. open/reconciled/discrepancy, ticket states) carry a text label *and*
   color, which is correct. Keep that invariant: never signal state by color alone (verified current chips include text).
4. **Image alt** — owner-web has 0 `<img alt>` because it uses no content images (icons are inline SVG with
   `aria-hidden`). Where avatars render an `<img>` (customer/tech), confirm `alt=""` for decorative or a name for
   meaningful avatars.

## iOS-specific (after wrapping)
- Ensure the WebView viewport allows pinch-zoom / Dynamic Type (don't lock scaling).
- Test a full VoiceOver pass on the primary flows (login → book/check-in → pay; tech ticket lifecycle; owner dashboard).
- Verify tap targets ≥ 44×44pt (most buttons already exceed this; check small icon buttons like the favorite heart).

## Verdict
No blockers. The apps were built with accessibility in mind. The two highest-value items (interactive-caption keyboard support and modal Escape-to-close) are now done. The
remaining items (Dynamic Type behavior in the WebView, a full on-device VoiceOver sweep) are genuinely best verified on
a device during the native-shell pass.
