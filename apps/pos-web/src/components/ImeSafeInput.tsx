// ImeSafeInput.tsx — Vietnamese POS mandate §40 (WP-E). A text input that is safe for IME / composition typing (Telex,
// VNI, VIQR, the iPad Vietnamese keyboard, macOS "Vietnamese – Telex"): "Nguyeenx" builds "Nguyễn" over several keystrokes,
// and every intermediate value ("Nguye", "Nguyê", …) is part of an open COMPOSITION.
//
// The contract:
//   * `onValue(v)` never fires while a composition is open. It fires on ordinary (non-composing) input, and exactly once
//     when a composition ends, with the composed text. Consecutive identical values are reported once (Safari fires the
//     final `input` AFTER `compositionend`, Chrome before — both orders give a single report).
//   * The text on screen is never clobbered mid-composition. A plain React controlled input (`value={q}` +
//     `onChange={setQ}`) is restored to the parent's value after every change event; if the parent only learns the value
//     at composition end, React would wipe the half-composed accent. So the DOM value is driven by LOCAL state that
//     follows every keystroke, and the parent's `value` is adopted only when no composition is open (e.g. "clear", or a
//     recent search picked from a list).
//   * Enter / arrow keys pressed to COMMIT or navigate a composition candidate are not passed to `onKeyDown` (no search,
//     no "open first result" fired by the IME's own Enter).
import { forwardRef, useEffect, useRef, useState, type CompositionEvent, type InputHTMLAttributes, type KeyboardEvent } from 'react';

export type ImeSafeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue'> & {
  /** The committed value (controlled). Adopted whenever no composition is open. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /** The committed value: ordinary input, or the composed text when a composition ends. Never mid-composition. */
  onValue: (value: string) => void;
};

/** True for a keydown that belongs to an open IME composition (Chrome/Firefox set isComposing; Safari reports keyCode 229). */
export function isImeKeyDown(e: KeyboardEvent<HTMLInputElement>): boolean {
  return !!(e.nativeEvent as globalThis.KeyboardEvent).isComposing || e.keyCode === 229;
}

export const ImeSafeInput = forwardRef<HTMLInputElement, ImeSafeInputProps>(function ImeSafeInput(
  { value, defaultValue, onValue, onCompositionStart, onCompositionEnd, onKeyDown, ...rest }, ref,
) {
  const composing = useRef(false);
  const lastReported = useRef<string>(value ?? defaultValue ?? '');
  const [text, setText] = useState<string>(value ?? defaultValue ?? '');

  // Adopt a value the parent changed itself (clear, recent search) — never while the user is mid-composition.
  useEffect(() => {
    if (value === undefined || composing.current) return;
    lastReported.current = value;
    setText(value);
  }, [value]);

  const report = (v: string) => {
    if (v === lastReported.current) return;
    lastReported.current = v;
    onValue(v);
  };

  return (
    <input
      {...rest}
      ref={ref}
      value={text}
      onCompositionStart={(e: CompositionEvent<HTMLInputElement>) => { composing.current = true; onCompositionStart?.(e); }}
      onCompositionEnd={(e: CompositionEvent<HTMLInputElement>) => {
        composing.current = false;
        const v = e.currentTarget.value;
        setText(v);
        onCompositionEnd?.(e);
        report(v);
      }}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setText(v);   // the screen always follows the keyboard, composing or not
        if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
        report(v);
      }}
      onKeyDown={(e) => { if (composing.current || isImeKeyDown(e)) return; onKeyDown?.(e); }}
    />
  );
});
