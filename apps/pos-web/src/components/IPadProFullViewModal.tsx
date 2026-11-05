// IPadProFullViewModal.tsx — ONE reusable iPad Pro 13" full-view modal for the whole POS.
// Any module opens content inside a landscape iPad device frame that is ALWAYS fully visible
// (aspect 4/3 + min(vw, vh*4/3) — never cropped top/bottom/left/right), centered on a dimmed,
// blurred backdrop that leaves the page untouched behind it. Only the inner content scrolls.
// Behaviour: Escape closes; backdrop click closes (unless hasUnsavedChanges); background scroll
// is locked while open and restored on close; focus is moved into the dialog and Tab is trapped;
// high z-index so it always sits above the POS. Cream/gold design tokens (reused, not redefined).
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const V = (n: string) => `var(--${n})`;

export type IPadViewStatus = { label: string; bg: string; fg: string };

export interface IPadProFullViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** emoji/glyph shown in the header badge (ignored when `initials` is set) */
  icon?: ReactNode;
  /** initials shown in a gold avatar in the header */
  initials?: string;
  status?: IPadViewStatus | null;
  /** toolbar row under the header (Day/Week, date nav, filters, …) */
  toolbar?: ReactNode;
  /** pinned footer (e.g. status legend) */
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /** shown when there is no content and not loading/error */
  empty?: ReactNode;
  /** block backdrop-close (unsaved edits); Escape/✕ still close */
  hasUnsavedChanges?: boolean;
  ariaLabel?: string;
  /** accessible label for the ✕ button (default "Close") */
  closeLabel?: string;
  children?: ReactNode;
}

export function IPadProFullViewModal({
  isOpen, onClose, title, subtitle, icon, initials, status, toolbar, footer,
  loading, error, empty, hasUnsavedChanges, ariaLabel, closeLabel = 'Close', children,
}: IPadProFullViewModalProps) {
  const frameRef = useRef<HTMLDivElement>(null);

  // Escape closes; lock background scroll; move focus in + trap Tab; restore on close.
  useEffect(() => {
    if (!isOpen) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab' && frameRef.current) {
        const f = frameRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    frameRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={ariaLabel || (typeof title === 'string' ? title : t('pos.full_view_2'))}
      onMouseDown={() => { if (!hasUnsavedChanges) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(28,20,10,.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: '20px' }}
    >
      {/* iPad Pro 13" frame — landscape 4:3, always fully inside the viewport (fits width AND height), centered */}
      <div
        ref={frameRef} tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(78vw, calc((100vh - 40px) * 1.334), 1180px)',
          aspectRatio: '4 / 3', maxHeight: 'calc(100vh - 40px)',
          background: 'linear-gradient(160deg,#26262B,#141418)', borderRadius: 42,
          padding: 'clamp(12px, 1.6vmin, 20px)', boxShadow: '0 40px 90px rgba(0,0,0,.5), inset 0 0 0 2px #34343B',
          display: 'flex', outline: 'none',
        }}
      >
        {/* front camera */}
        <div style={{ position: 'absolute', top: '50%', left: 9, transform: 'translateY(-50%)', width: 7, height: 7, borderRadius: '50%', background: '#3A3B42', boxShadow: 'inset 0 0 0 1px #1c1c20' }} />
        {/* close button — always visible on the top-right bezel */}
        <button
          onClick={onClose} aria-label={closeLabel}
          style={{ position: 'absolute', top: -14, right: -14, width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: V('gold'), color: '#fff', fontSize: 18, fontWeight: 800, boxShadow: '0 6px 18px rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', lineHeight: 1 }}
        >✕</button>

        {/* SCREEN */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, background: V('page'), borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* sticky header */}
          <div style={{ flexShrink: 0, padding: '14px 18px', borderBottom: `1px solid ${V('line')}`, background: V('card'), display: 'flex', alignItems: 'center', gap: 12 }}>
            {(initials || icon) && (
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: V('grad'), border: '1px solid #C9933B', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: initials ? 16 : 20, color: '#3A2A12', flexShrink: 0 }}>{initials || icon}</div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 19, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {subtitle != null && <div style={{ fontSize: 12, color: V('muted'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
            </div>
            {status && <span style={{ background: status.bg, color: status.fg, fontSize: 11, fontWeight: 800, padding: '4px 11px', borderRadius: 999, whiteSpace: 'nowrap' }}>{status.label}</span>}
          </div>

          {/* optional toolbar */}
          {toolbar && <div style={{ flexShrink: 0, borderBottom: `1px solid ${V('line')}`, background: V('card') }}>{toolbar}</div>}

          {/* content — the ONLY scrolling region (children own their internal scroll/layout) */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {loading ? <SkeletonBody /> : error ? <StateBody tone="error" text={error} /> : (empty != null && !children) ? <StateBody tone="empty" text={empty} /> : children}
          </div>

          {/* pinned footer / legend */}
          {footer && <div style={{ flexShrink: 0, borderTop: `1px solid ${V('line')}`, background: V('card'), padding: '9px 18px' }}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div aria-busy="true" style={{ flex: 1, overflow: 'hidden', padding: '16px 18px', display: 'grid', gap: 10, alignContent: 'start' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 54, borderRadius: 12, background: 'linear-gradient(90deg,#EFE7D6,#F7F1E4,#EFE7D6)', backgroundSize: '200% 100%', animation: 'ipadShimmer 1.2s linear infinite', opacity: 1 - i * 0.08 }} />
      ))}
      <style>{'@keyframes ipadShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'}</style>
    </div>
  );
}

function StateBody({ tone, text }: { tone: 'error' | 'empty'; text: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: '40px 24px' }}>
      <div>
        <div style={{ fontSize: 26, marginBottom: 8 }}>{tone === 'error' ? '⚠️' : '—'}</div>
        <div style={{ fontSize: 13, color: tone === 'error' ? V('danger') : V('muted'), fontWeight: tone === 'error' ? 700 : 500, maxWidth: 420 }}>{text}</div>
      </div>
    </div>
  );
}
