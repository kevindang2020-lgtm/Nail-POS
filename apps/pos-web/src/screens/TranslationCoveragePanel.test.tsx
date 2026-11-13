// round 10 (Localization 04): the Translation coverage dashboard opens on demand and shows the catalogue counts and keys.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranslationCoveragePanel } from '../components/TranslationCoveragePanel';

describe('TranslationCoveragePanel', () => {
  it('computes only when opened; shows the percentage, the three lists and names the build checks', () => {
    render(<TranslationCoveragePanel />);
    expect(screen.queryByTestId('tcov-body')).toBeNull();
    const d = screen.getByTestId('tcov') as HTMLDetailsElement;
    d.open = true; fireEvent(d, new Event('toggle'));
    expect(screen.getByTestId('tcov-summary').textContent).toMatch(/^\d+(\.\d)?% of the screen text has Vietnamese \(\d[\d,]* of \d[\d,]* keys\)\.$/);
    expect(screen.getByTestId('tcov-body')).toHaveTextContent('No Vietnamese yet');
    expect(screen.getByTestId('tcov-body')).toHaveTextContent('Error messages without Vietnamese');
    expect(screen.getByTestId('tcov-gates')).toHaveTextContent('check-pos-i18n');
  });
});
