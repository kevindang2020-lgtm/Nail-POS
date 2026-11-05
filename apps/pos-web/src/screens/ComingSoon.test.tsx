import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

describe('ComingSoon', () => {
  it('renders the title and the honest pending badge', () => {
    render(<ComingSoon title="Inventory" />);
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('React conversion pending')).toBeInTheDocument();
  });
});
