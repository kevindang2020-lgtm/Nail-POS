import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceBadge, { sourceLabel } from './SourceBadge';

describe('SourceBadge', () => {
  it('maps domain + channel source values to friendly labels', () => {
    expect(sourceLabel('phone')).toBe('AI Phone');
    expect(sourceLabel('manual')).toBe('Front Desk');
    expect(sourceLabel('online')).toBe('Online');
    expect(sourceLabel('walk_in')).toBe('Walk-In');
    expect(sourceLabel('customer_app')).toBe('Customer App');
    expect(sourceLabel('PARTNER_BOOKING_LINK')).toBe('Partner');
    expect(sourceLabel('SUPER_ADMIN_SUPPORT_MODE')).toBe('Support');
  });
  it('falls back to the raw value for unknown sources and — for empty', () => {
    expect(sourceLabel('mystery')).toBe('Mystery');   // an unknown code is humanised (statusLabel convention, WP-C1)
    expect(sourceLabel(null)).toBe('—');
  });
  it('renders a labeled badge', () => {
    render(<SourceBadge source="phone" />);
    expect(screen.getByText('AI Phone')).toBeInTheDocument();
    expect(screen.getByTitle(/Booking source: AI Phone/)).toBeInTheDocument();
  });
});
