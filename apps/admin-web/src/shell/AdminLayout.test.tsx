import { NAV_DOMAIN_VIEW_KEY } from './navPermissions';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../auth/AuthContext', () => ({
  // a PLATFORM_SUPER_ADMIN principal carries every view key the sidebar asks for (Constitution 7 §10)
  useAuth: () => ({ principal: { fullName: 'Super Admin', permissions: Object.values(NAV_DOMAIN_VIEW_KEY) }, logout: vi.fn(), loading: false }),
}));
vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    platformState: () => Promise.resolve({ counts: { newApplications: 0, newLeads: 0, hardwarePending: 0, activeSupportSessions: 0 } }),
    alertsUnreadCount: () => Promise.resolve(0),
    systemHealth: () => Promise.resolve({ ok: true, database: { ok: true }, gateway: { ok: true } }),
  },
}));

import { AdminLayout, NAV_GROUPS } from './AdminLayout';
import { SuperAdminPlaceholder } from '../screens/SuperAdminPlaceholder';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route path="dashboard" element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Super Admin sidebar (reference 8-section IA)', () => {
  it('renders the eight reference section groups', () => {
    renderShell();
    for (const s of ['Platform Overview', 'Tenant Management', 'Operations Oversight', 'Payments & Revenue', 'Business Management', 'AI & Automation', 'System Settings', 'Support']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
  });

  it('renders the reference-named sidebar items (existing routes preserved + relabelled)', () => {
    renderShell();
    const items = [
      'Overview', 'Live Operations', 'Analytics',
      'Tenants', 'Branches', 'Users & Roles', 'Onboarding & Approvals', 'Plans & Feature Limits',
      'Appointment Oversight', 'Customer Data Oversight', 'Workforce Oversight', 'Booking & Check-In Monitor', 'Live Queue Monitor', 'Catalog Management', 'Service Templates', 'Product Catalog',
      'Payments & Transactions', 'Merchant Accounts', 'Revenue & Refunds',
      'Marketing & Campaigns', 'Promotions & Offers', 'Membership Programs', 'Loyalty Programs', 'Communications',
      'AI Insights', 'AI Reports', 'AI Forecasting', 'Smart Reminders', 'Automation Rules', 'AI Usage & Configuration',
      'General Settings', 'Billing & Subscriptions', 'Integrations', 'Device Management', 'Security & Compliance', 'Audit Logs',
      'Support Center',
    ];
    for (const l of items) expect(screen.getByText(l)).toBeInTheDocument();
  });

  it('links Settlements & Deposits to its live route (seven-package merge: package 4 shipped the real surface)', () => {
    renderShell();
    const link = screen.getByText('Settlements & Deposits').closest('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/settlements-deposits');
  });

  it('links Chargebacks & Disputes to its live route', () => {
    renderShell();
    const link = screen.getByText('Chargebacks & Disputes').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/chargebacks-disputes');
  });

  it('keeps the Help Center link and All-Systems-Operational status footer', async () => {
    renderShell();
    expect(screen.getByText('Visit AI PowerSalon Help Center')).toBeInTheDocument();
    expect(await screen.findByText('All Systems Operational')).toBeInTheDocument();
    expect(screen.getByText('v2.4.1')).toBeInTheDocument();
  });

  it('surfaces every previously-orphaned module (full-wiring pass 2026-07-03)', () => {
    renderShell();
    const wired: Array<[string, string]> = [
      ['Platform Dashboard', '/platform-dashboard'],
      ['Tenant Applications', '/tenant-applications'],
      ['Payment Gateways', '/payment-gateways'],
      ['AI Subscriptions', '/ai-subscriptions'],
      ['Usage Limits', '/usage-limits'],
      ['System Health', '/system-health'],
      ['Project Status', '/project-status'],
    ];
    for (const [label, href] of wired) {
      const link = screen.getByText(label).closest('a');
      expect(link, label).toBeTruthy();
      expect(link!.getAttribute('href'), label).toBe(href);
    }
  });

  it('Catalog Management and Product Catalog are distinct modules (duplicate /product-catalog fixed)', () => {
    renderShell();
    const catalogMgmt = screen.getByText('Catalog Management').closest('a');
    const productCatalog = screen.getByText('Product Catalog').closest('a');
    expect(catalogMgmt!.getAttribute('href')).toBe('/services');
    expect(productCatalog!.getAttribute('href')).toBe('/product-catalog');
  });

  it('no two top-level sidebar items share a route (React key + UX invariant)', () => {
    const tops = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    const dupes = tops.filter((t, i) => tops.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('Sidebar ↔ route wiring invariant (every nav target resolves to a registered route)', () => {
  // vitest runs with cwd = apps/admin-web; import.meta.url is not a file: URL under the jsdom transform.
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const registered = [...appSrc.matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => '/' + m[1].replace(/^\//, ''))
    .filter((p) => p !== '/*');
  const matches = (target: string) => {
    const p = target.split('?')[0];
    return registered.some((r) => {
      if (!r.includes(':')) return r === p;
      const rx = new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$');
      return rx.test(p);
    });
  };

  it('every top-level item and every child link points at a registered App.tsx route', () => {
    const bad: string[] = [];
    for (const g of NAV_GROUPS) {
      for (const it of g.items) {
        if (!it.disabled && !matches(it.to)) bad.push(`${g.section} › ${it.label} → ${it.to}`);
        for (const c of it.children || []) if (!matches(c.to)) bad.push(`${g.section} › ${it.label} › ${c.label} → ${c.to}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every routed screen is reachable from the sidebar (no orphan modules)', () => {
    // Aliases/redirects + destinations reached from chrome outside the sidebar (profile menu) are exempt.
    const exempt = new Set(['/', '/billing', '/products', '/memberships', '/appointments', '/customers', '/account', '/help-center']);
    const navTargets = new Set<string>();
    for (const g of NAV_GROUPS) for (const it of g.items) {
      navTargets.add(it.to.split('?')[0]);
      for (const c of it.children || []) navTargets.add(c.to.split('?')[0]);
    }
    const orphans = registered.filter((r) => !r.includes(':') && !exempt.has(r) && !navTargets.has(r));
    expect(orphans).toEqual([]);
  });
});

describe('SuperAdminPlaceholder', () => {
  it('shows the module title, reference code, and phase without fabricated data', () => {
    render(<SuperAdminPlaceholder title="Branches" refCode="S04" phase="Phase 8" />);
    expect(screen.getByText('Branches')).toBeInTheDocument();
    expect(screen.getByText(/Reference S04/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 8/)).toBeInTheDocument();
  });
});
