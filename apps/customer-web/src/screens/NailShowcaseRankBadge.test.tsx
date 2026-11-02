import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NailShowcaseRankBadge, rankTier } from './NailShowcaseRankBadge';

describe('NailShowcaseRankBadge', () => {
  it('shows #rank plus the correct tier pill', () => {
    render(<NailShowcaseRankBadge rank={8} />);
    expect(screen.getByText('#8')).toBeInTheDocument();
    expect(screen.getByText('Top 10')).toBeInTheDocument();
  });

  it('computes the tier at each boundary', () => {
    expect(rankTier(1)).toBe('Top 10');
    expect(rankTier(10)).toBe('Top 10');
    expect(rankTier(11)).toBe('Top 20');
    expect(rankTier(100)).toBe('Top 100');
    expect(rankTier(500)).toBe('Top 500');
    expect(rankTier(501)).toBe(null);
    expect(rankTier(0)).toBe(null);
    expect(rankTier(null)).toBe(null);
  });

  it('renders nothing for an unranked customer', () => {
    const { container } = render(<NailShowcaseRankBadge rank={null} />);
    expect(container.firstChild).toBeNull();
  });
});
