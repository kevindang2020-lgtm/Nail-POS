// IPadViewProvider.tsx — ONE global iPad Pro full-view mount for the whole POS.
// Any screen calls `useIPadView().open({ moduleType, title, subtitle, record, ... })` to show a
// module/record inside the shared IPadProFullViewModal. A registry maps moduleType -> a lazy content
// renderer, so we do NOT create a separate popup per module — one shell, many templates. Content
// renderers receive the selected record and are expected to load their own REAL data (no mocks) and
// respect the caller's existing permission/tenant/location guards.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { IPadProFullViewModal, type IPadViewStatus } from './IPadProFullViewModal';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export type IPadModuleType =
  | 'technician-schedule' | 'appointment' | 'customer' | 'checkout-ticket'
  | 'queue-item' | 'report' | 'generic';

export interface IPadOpenRequest {
  moduleType: IPadModuleType;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  initials?: string;
  status?: IPadViewStatus | null;
  /** the domain record the content renderer will load real data for */
  selectedRecord?: unknown;
  toolbar?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  hasUnsavedChanges?: boolean;
  ariaLabel?: string;
  /** direct content override; when omitted the registered renderer for moduleType is used */
  content?: ReactNode;
}

/** A registered content renderer for a module type. Receives the request + a close callback. */
export type IPadContentRenderer = (req: IPadOpenRequest, close: () => void) => ReactNode;

const registry = new Map<IPadModuleType, IPadContentRenderer>();
/** Modules register their iPad content renderer here (call once, e.g. at module import). */
export function registerIPadModule(type: IPadModuleType, renderer: IPadContentRenderer) {
  registry.set(type, renderer);
}

interface IPadViewCtx {
  open: (req: IPadOpenRequest) => void;
  close: () => void;
  isOpen: boolean;
}
const Ctx = createContext<IPadViewCtx | null>(null);

const NOOP_CTX: IPadViewCtx = { open: () => {}, close: () => {}, isOpen: false };
/** Safe outside a provider (returns a no-op) so screens never crash in isolation/tests; the real
 *  provider is mounted at the app root. */
export function useIPadView(): IPadViewCtx {
  return useContext(Ctx) ?? NOOP_CTX;
}

export function IPadViewProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<IPadOpenRequest | null>(null);
  const close = useCallback(() => setReq(null), []);
  const open = useCallback((r: IPadOpenRequest) => setReq(r), []);
  const value = useMemo<IPadViewCtx>(() => ({ open, close, isOpen: req != null }), [open, close, req]);

  // Resolve content: explicit override wins, else the registered renderer, else a graceful notice.
  let content: ReactNode = null;
  if (req) {
    if (req.content != null) content = req.content;
    else {
      const r = registry.get(req.moduleType);
      content = r ? r(req, close)
        : <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13, padding: 40 }}>{t('pos.this_view_isn_t_available_yet')}</div>;
    }
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {req && (
        <IPadProFullViewModal
          isOpen onClose={close}
          title={req.title} subtitle={req.subtitle} icon={req.icon} initials={req.initials}
          status={req.status} toolbar={req.toolbar} footer={req.footer}
          loading={req.loading} error={req.error} hasUnsavedChanges={req.hasUnsavedChanges}
          ariaLabel={req.ariaLabel}
        >
          {content}
        </IPadProFullViewModal>
      )}
    </Ctx.Provider>
  );
}
