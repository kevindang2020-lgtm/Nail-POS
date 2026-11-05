// InlineAsk.tsx — the ONE inline replacement for window.prompt in the Super Admin console (Jul 27, 2026).
//
// Twenty-three admin actions collected a short reason/note/value through the browser's native prompt dialog.
// This hook keeps each call site a one-liner while moving the capture into brand UI: `ask(question, onConfirm)`
// opens a slim bottom-center bar (portal — no per-screen layout work) with a labelled input, Confirm/Cancel,
// Enter/Escape keys, and required-by-default validation. The value handed to onConfirm is trimmed; a required
// ask refuses an empty confirm with an inline message instead of silently closing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type AskOpts = { defaultValue?: string; confirmLabel?: string; optional?: boolean; inputLabel?: string; minLength?: number; multiline?: boolean };
type Pending = { question: string; onConfirm: (value: string) => void; opts: AskOpts };

export function useInlineAsk(): { ask: (question: string, onConfirm: (value: string) => void, opts?: AskOpts) => void; askUi: JSX.Element | null } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);   // also used for the multiline textarea

  const ask = useCallback((question: string, onConfirm: (value: string) => void, opts: AskOpts = {}) => {
    setPending({ question, onConfirm, opts });
    setValue(opts.defaultValue ?? '');
    setErr(null);
  }, []);

  const close = useCallback(() => { setPending(null); setValue(''); setErr(null); }, []);
  const confirm = useCallback(() => {
    if (!pending) return;
    const v = value.trim();
    if (!v && !pending.opts.optional) { setErr('This field is required.'); return; }
    const min = pending.opts.minLength ?? 0;
    if (v && min > 0 && v.length < min) { setErr(`Enter at least ${min} characters.`); return; }
    const cb = pending.onConfirm;
    close();
    cb(v);
  }, [pending, value, close]);

  useEffect(() => { if (pending) inputRef.current?.focus(); }, [pending]);

  const askUi = pending
    ? createPortal(
        <div role="group" aria-label={pending.question} style={{
          position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 240,
          background: '#FFFDF9', border: '1px solid #D8A646', borderRadius: 12, boxShadow: '0 14px 34px rgba(43,33,24,.25)',
          padding: '10px 12px', width: 'min(560px, 94vw)',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#2A2118', whiteSpace: 'pre-wrap', marginBottom: 7 }}>{pending.question}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: pending.opts.multiline ? 'flex-end' : 'center' }}>
            {pending.opts.multiline ? (
              // Long-form answers (e.g. pasting a prompt version) need room and must accept newlines, so Enter
              // inserts a line break here instead of confirming; Escape still cancels.
              <textarea
                ref={inputRef as unknown as React.RefObject<HTMLTextAreaElement>}
                aria-label={pending.opts.inputLabel || 'Your answer'}
                value={value}
                onChange={(e) => { setValue(e.target.value); if (err) setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
                placeholder={pending.opts.optional ? 'Optional' : 'Required'}
                rows={5}
                style={{ flex: 1, minHeight: 96, border: '1px solid #E7DCC8', borderRadius: 9, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
              />
            ) : (
              <input
                ref={inputRef}
                aria-label={pending.opts.inputLabel || 'Your answer'}
                value={value}
                onChange={(e) => { setValue(e.target.value); if (err) setErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); }}
                placeholder={pending.opts.optional ? 'Optional' : 'Required'}
                style={{ flex: 1, minHeight: 38, border: '1px solid #E7DCC8', borderRadius: 9, padding: '0 10px', fontSize: 13, fontFamily: 'inherit' }}
              />
            )}
            <button type="button" className="btn" onClick={confirm}>{pending.opts.confirmLabel || 'Confirm'}</button>
            <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          </div>
          {err ? <div style={{ fontSize: 11.5, color: '#B85B4D', marginTop: 5 }}>{err}</div> : null}
        </div>,
        document.body,
      )
    : null;

  return { ask, askUi };
}
