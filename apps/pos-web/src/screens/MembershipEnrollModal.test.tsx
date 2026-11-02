import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MembershipEnrollModal } from './MembershipEnrollModal';

// Plans/customers fetch mocked empty so the modal mounts without network.
beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [], headers: { get: () => null } } as any)) as any;
});

describe('MembershipEnrollModal', () => {
  it('renders and gates enrollment until customer + plan + consent are set', () => {
    render(<MembershipEnrollModal onClose={() => {}} onEnrolled={() => {}} />);
    expect(screen.getByText('Add New Member')).toBeInTheDocument();
    expect(screen.getByText('Find customer')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enroll member' })).toBeDisabled();
  });
});
