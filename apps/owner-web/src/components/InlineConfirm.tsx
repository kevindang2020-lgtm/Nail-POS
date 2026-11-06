import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ConfirmOpts = {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Extra content under the question (e.g. the sign-out "Also turn off Face ID" choice). Keeps its own state. */
  extra?: ReactNode;
};

type Pending = { question: string; onConfirm: () => void; opts: ConfirmOpts };

export function useInlineConfirm(): {
  confirm: (question: string, onConfirm: () => void, opts?: ConfirmOpts) => void;
  confirmUi: JSX.Element | null;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback(
    (question: string, onConfirm: () => void, opts: ConfirmOpts = {}) => {
      setPending({ question, onConfirm, opts });
    },
    []
  );

  const close = useCallback(() => setPending(null), []);
  const accept = useCallback(() => {
    if (!pending) return;
    const cb = pending.onConfirm;
    setPending(null);
    cb();
  }, [pending]);

  useEffect(() => {
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pending, close]);

  const confirmUi = pending
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(28, 20, 14, 0.65)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 250,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.opts.title || pending.question}
            style={{
              width: 'min(420px, 92vw)',
              background: 'var(--owner-surface, #FFFFFF)',
              border: '1px solid var(--owner-border-gold, #DFC37B)',
              borderRadius: 20,
              boxShadow:
                '0 20px 50px rgba(44, 33, 24, 0.25), 0 0 0 1px rgba(212, 175, 55, 0.15)',
              padding: '24px 22px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            {/* Header Icon Badge */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'var(--owner-primary-light, #F4E3BF)',
                color: 'var(--owner-primary-dark, #8B5A18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
                border: '1px solid var(--owner-border-gold, #DFC37B)',
              }}
            >
              {pending.opts.destructive === false ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              )}
            </div>

            {/* Optional Title */}
            {pending.opts.title && (
              <div
                className="owner-serif"
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--owner-text, #2C2118)',
                  marginBottom: 6,
                }}
              >
                {pending.opts.title}
              </div>
            )}

            {/* Main Question Text */}
            <div
              style={{
                fontSize: pending.opts.title ? 14 : 16,
                lineHeight: 1.5,
                color: pending.opts.title
                  ? 'var(--owner-text-secondary, #6D5F50)'
                  : 'var(--owner-text, #2C2118)',
                fontWeight: pending.opts.title ? 400 : 600,
                whiteSpace: 'pre-wrap',
                marginBottom: 20,
              }}
            >
              {pending.question}
            </div>
            {pending.opts.extra ? <div style={{ marginTop: -8, marginBottom: 16 }}>{pending.opts.extra}</div> : null}

            {/* Modal Actions */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                width: '100%',
              }}
            >
              <button
                ref={cancelRef}
                type="button"
                className="owner-btn ghost"
                onClick={close}
                style={{
                  height: 46,
                  minHeight: 46,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  border: '1px solid var(--owner-border, #E9DAC4)',
                  background: 'var(--owner-surface, #FFFFFF)',
                  color: 'var(--owner-text, #2C2118)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="owner-btn"
                onClick={accept}
                style={{
                  height: 46,
                  minHeight: 46,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--owner-primary)',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(197, 138, 46, 0.3)',
                }}
              >
                {pending.opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return { confirm, confirmUi };
}
