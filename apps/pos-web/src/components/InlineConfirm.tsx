// InlineConfirm.tsx — brand-UI replacement for window.confirm on destructive POS actions (Jul 27, 2026).
//
// The native dialog worked, but it drops OS chrome into the middle of a salon's gold POS and — on a locked-down
// ASUS kiosk or an iPad web-app — can be styled unpredictably or suppressed entirely, which would let a
// destructive action fire (or silently not fire) without the person seeing anything.
//
// This keeps the safety properties that made native confirm defensible and adds the ones it lacked:
//   • the action CANNOT run unless the person taps the confirm button — the callback is invoked from that tap only
//   • the destructive button is visually distinct and is NOT the auto-focused control (Cancel takes focus, so a
//     stray Enter never destroys anything)
//   • Escape cancels; the backdrop is inert so a mis-tap outside can't be read as approval
//   • full question text is shown, wrapped, at readable size on a touch screen
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ConfirmOpts = { confirmLabel?: string; destructive?: boolean };
type Pending = { question: string; onConfirm: () => void; opts: ConfirmOpts };

export function useInlineConfirm(): { confirm: (question: string, onConfirm: () => void, opts?: ConfirmOpts) => void; confirmUi: JSX.Element | null } {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((question: string, onConfirm: () => void, opts: ConfirmOpts = {}) => {
    setPending({ question, onConfirm, opts });
  }, []);

  const close = useCallback(() => setPending(null), []);
  const accept = useCallback(() => {
    if (!pending) return;
    const cb = pending.onConfirm;
    setPending(null);
    cb();
  }, [pending]);

  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);
  useEffect(() => {
    if (!pending) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pending, close]);

  const confirmUi = pending
    ? createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,33,24,.34)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div role="alertdialog" aria-modal="true" aria-label={pending.question} style={{
            width: 'min(460px, 94vw)', background: '#FFFDF9', border: '1px solid var(--line, #E7DCC8)', borderRadius: 14,
            boxShadow: '0 20px 48px rgba(43,33,24,.28)', padding: '16px 18px 14px',
          }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink, #2A2118)', whiteSpace: 'pre-wrap', marginBottom: 14 }}>{pending.question}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {/* Cancel holds focus on purpose: a reflexive Enter must never confirm a destructive action. */}
              <button ref={cancelRef} type="button" className="btn ghost" onClick={close}>Cancel</button>
              <button type="button" className="btn" onClick={accept}
                style={pending.opts.destructive === false ? undefined : { background: '#B85B4D', borderColor: '#B85B4D', color: '#fff' }}>
                {pending.opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { confirm, confirmUi };
}
