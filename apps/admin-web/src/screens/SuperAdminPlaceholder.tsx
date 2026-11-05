// SuperAdminPlaceholder.tsx — honest stub for approved Super Admin modules not yet built. Renders inside the SA shell
// content area (className="work"). No fabricated data: it names the module, its reference code, and the phase that
// will build it, so every sidebar item routes to a real, clearly-labelled page (never a dead link or blank screen).
// Built from the canonical shared UI kit (@aipowersalon/ui) — proves the kit is wired into the Super Admin app.
import { PageHeader, EmptyState, StatusBadge } from '@aipowersalon/ui';

export function SuperAdminPlaceholder({ title, refCode, phase, note }: { title: string; refCode?: string; phase?: string; note?: string }) {
  return (
    <div className="work">
      <div style={{ maxWidth: 760, margin: '28px auto', padding: '0 16px' }}>
        <PageHeader
          title={title}
          subtitle={`${refCode ? `Reference ${refCode}` : 'Super Admin module'}${phase ? ` · scheduled for ${phase}` : ''}`}
          actions={<StatusBadge tone="info" dot>Planned</StatusBadge>}
        />
        <div style={{ border: '1px solid var(--aps-line)', borderRadius: 'var(--aps-radius)', background: 'var(--aps-card)' }}>
          <EmptyState
            title="Sidebar & routing in place — screen builds in its phase"
            message={note || 'This module is part of the approved Super Admin build. The canonical shell, the exact reference sidebar, and this route are wired now; the screen will be built to match its reference image and connected to live, tenant-safe platform data during its scheduled phase. No placeholder data is shown here on purpose.'}
          />
        </div>
      </div>
    </div>
  );
}
