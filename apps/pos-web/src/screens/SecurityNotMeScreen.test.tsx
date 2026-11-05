// SecurityNotMeScreen.test.tsx — Constitution 3 Step 10a: the "This wasn't me" landing page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const post = vi.fn();
vi.mock('../api/client', () => ({ api: { post: (...a: any[]) => post(...a) } }));
import { SecurityNotMeScreen } from './SecurityNotMeScreen';
beforeEach(() => { post.mockReset(); window.history.replaceState({}, '', '/security/not-me?token=nm_abc'); });
describe('SecurityNotMeScreen', () => {
  it('one tap secures the account with the link’s token, then offers a new password', async () => {
    post.mockResolvedValue({ message: 'Done. Every device on your account is signed out.' });
    render(<SecurityNotMeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /It wasn't me/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Every device');
    expect(post).toHaveBeenCalledWith('/public/security/not-me', { token: 'nm_abc' });
    expect(screen.getByRole('link', { name: 'Choose a new password' })).toHaveAttribute('href', '/forgot-password');
  });
  it('a used or expired link shows the server’s reason; no token → no button', async () => {
    post.mockRejectedValue(new Error('This link was already used — your account was secured then.'));
    render(<SecurityNotMeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /It wasn't me/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already used');
  });
  it('without a token there is nothing to press', () => {
    window.history.replaceState({}, '', '/security/not-me');
    render(<SecurityNotMeScreen />);
    expect(screen.queryByRole('button')).toBeNull(); expect(screen.getByRole('alert')).toHaveTextContent('incomplete');
  });
});
