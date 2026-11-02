// OAuthConsentScreen.test.tsx — Constitution 3 Step 10d: the owner's consent page for a partner app.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const get = vi.fn(), post = vi.fn();
vi.mock('../api/client', () => ({ api: { get: (...a: any[]) => get(...a), post: (...a: any[]) => post(...a) } }));
import { OAuthConsentScreen } from './OAuthConsentScreen';
const assign = vi.fn();
beforeEach(() => { get.mockReset(); post.mockReset(); assign.mockReset(); Object.defineProperty(window, 'location', { value: { ...window.location, search: '?client_id=app_x&redirect_uri=https%3A%2F%2Fw.example%2Fcb&scope=pos.booking.view&state=s1&code_challenge=c&code_challenge_method=S256', assign }, writable: true }); });
describe('OAuthConsentScreen', () => {
  it('shows what the app may see in plain words; Allow posts the same request and follows the redirect', async () => {
    get.mockResolvedValue({ clientName: 'Widget Co', scopes: ['pos.booking.view'] });
    post.mockResolvedValue({ redirect: 'https://w.example/cb?code=oac_1&state=s1' });
    render(<OAuthConsentScreen />);
    expect(await screen.findByText('See your booking calendar')).toBeInTheDocument();
    expect(screen.getByText('Widget Co')).toBeInTheDocument(); expect(screen.getByText(/cannot change anything/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://w.example/cb?code=oac_1&state=s1'));
    expect(post.mock.calls[0][1]).toMatchObject({ client_id: 'app_x', redirect_uri: 'https://w.example/cb', state: 's1' });
  });
  it('an invalid request shows the server reason and no Allow button', async () => {
    get.mockRejectedValue(new Error("This application's return address is not registered."));
    render(<OAuthConsentScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('return address');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
