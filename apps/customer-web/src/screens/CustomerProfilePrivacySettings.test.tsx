import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerProfilePrivacySettings } from './CustomerProfilePrivacySettings';
import { NS_PUBLIC_PROFILE_WARNING, NS_PUBLIC_CONFIRM_LABEL } from '../api/customerSocialApi';

describe('CustomerProfilePrivacySettings', () => {
  it('renders the exact public disclosure warning when the profile is private', () => {
    render(<CustomerProfilePrivacySettings visibility="private" onUpdate={vi.fn()} />);
    expect(screen.getByText(NS_PUBLIC_PROFILE_WARNING)).toBeInTheDocument();
  });

  it('gates "Make Profile Public" behind the confirm checkbox, then calls onUpdate("public")', () => {
    const onUpdate = vi.fn();
    render(<CustomerProfilePrivacySettings visibility="private" onUpdate={onUpdate} />);
    const btn = screen.getByRole('button', { name: 'Make Profile Public' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(NS_PUBLIC_CONFIRM_LABEL));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onUpdate).toHaveBeenCalledWith('public');
  });

  it('switches to private in one tap when currently public', () => {
    const onUpdate = vi.fn();
    render(<CustomerProfilePrivacySettings visibility="public" onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make Profile Private' }));
    expect(onUpdate).toHaveBeenCalledWith('private');
  });
});
