import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, KpiCard, EmptyState } from '@aipowersalon/ui';

// Confirms the canonical shared UI kit is wired into the tenant POS app via the workspace alias (Vite + vitest +
// tsconfig), the same way it is in admin-web. Both canonical apps now consume one design system.
describe('@aipowersalon/ui wired into pos-web', () => {
  it('renders kit components through the alias', () => {
    render(<>
      <StatusBadge tone="success">Live</StatusBadge>
      <KpiCard label="Today's Revenue" value="$5,287.30" />
      <EmptyState title="No data" />
    </>);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText('$5,287.30')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});
