// extras PAYMENTS 14: the protected-action review names the acting person and the salon from the session; never invented.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const st = vi.hoisted(() => ({ principal: null as null | Record<string, unknown>, salonName: null as string | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: st.principal }) }));
vi.mock('../shell/tenant-access', () => ({ useTenantNavAccess: () => ({ role: '', permissions: [], features: [], aiPackages: [], subscriptionStatus: 'active', salonName: st.salonName }) }));
import { ActionActorLine } from './ActionActorLine';

describe('ActionActorLine (extras PAYMENTS 14)', () => {
  it('names the signed-in person and the salon, and says a manager PIN comes before anything moves', () => {
    st.principal = { userId: 'u1', fullName: 'Linh Tran', email: 'l@x.test', role: 'MANAGER', permissions: [] }; st.salonName = 'Lotus Nails';
    render(<ActionActorLine testId="aa" />);
    expect(screen.getByTestId('aa')).toHaveTextContent('Acting: Linh Tran · Salon: Lotus Nails.');
    expect(screen.getByTestId('aa-stepup')).toHaveTextContent('A manager PIN is asked before anything moves.');
  });
  it('falls back to the e-mail, and says the salon name is not set instead of inventing one', () => {
    st.principal = { userId: 'u1', fullName: null, email: 'front@x.test', role: 'STAFF', permissions: [] }; st.salonName = null;
    render(<ActionActorLine testId="aa" />);
    expect(screen.getByTestId('aa')).toHaveTextContent('Acting: front@x.test · Salon: this salon (name not set).');
  });
});
