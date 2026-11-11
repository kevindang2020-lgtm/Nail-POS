// FinanceKit useFreshAt + FreshnessLine — stamped only after a successful read; an error keeps the last good time and says so.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFreshAt, FreshnessLine } from './FinanceKit';

function Probe({ data, error }: { data: unknown; error?: unknown }) { const at = useFreshAt(data); return <FreshnessLine at={at} error={error} testId="fresh" />; }
describe('FreshnessLine', () => {
  it('shows nothing before the first good read', () => {
    render(<Probe data={null} />);
    expect(screen.queryByTestId('fresh')).toBeNull();
  });
  it('shows the update time after a read, and the stale wording on an error', () => {
    const v = render(<Probe data={{ a: 1 }} />);
    expect(screen.getByTestId('fresh')).toHaveTextContent(/^Numbers updated /);
    v.rerender(<Probe data={{ a: 1 }} error={new Error('x')} />);
    expect(screen.getByTestId('fresh')).toHaveTextContent(/^Refresh failed — the last good numbers are from /);
    expect(screen.getByTestId('fresh').className).toContain('warn');
  });
});
