/**
 * Small inline UI primitives. No native dialogs anywhere (the host enforces
 * `check:dialogs`); confirmations and prompts are rendered in-board.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from './icons';
import { useBoardText } from '../i18n/boardText';

export function SidePanel({ title, onClose, children, footer, wide, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  const { t } = useBoardText();
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, button, textarea, [tabindex]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bsb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`bsb-panel${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={headingId} data-testid={testId}>
        <div className="bsb-panel-head">
          <h3 id={headingId}>{title}</h3>
          <button type="button" className="bsb-btn is-ghost bsb-close" onClick={onClose} aria-label={t('ui.close')}><CloseIcon /></button>
        </div>
        <div className="bsb-panel-body">{children}</div>
        {footer && <div className="bsb-panel-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ToastState { id: number; kind: 'info' | 'error'; message: string; actionLabel?: string; onAction?: () => void }

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const { t } = useBoardText();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, toast.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div className={`bsb-toast${toast.kind === 'error' ? ' is-error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'} data-testid="bsb-toast">
      <span>{toast.message}</span>
      {toast.actionLabel && <button type="button" onClick={() => { toast.onAction?.(); onDismiss(); }}>{toast.actionLabel}</button>}
      <button type="button" onClick={onDismiss} aria-label={t('ui.dismiss')}>×</button>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const show = (t: Omit<ToastState, 'id'>) => setToast({ ...t, id: ++seq.current });
  return { toast, show, dismiss: () => setToast(null) };
}

/** Click-outside + Escape for popovers / menus. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  return ref;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
