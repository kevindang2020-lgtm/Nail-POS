// mobile-shell.test.tsx — BUILD_PLAN Phase 13 D: a route opens only inside the signed-in tree, from this app's table.
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createMobileShell, useMobileRoutes } from './mobile-shell';

function Signed({ shell, log }: { shell: any; log: string[] }) {
  useMobileRoutes(shell, { queue: () => log.push('queue'), 'queue-ticket': (r) => log.push('ticket:' + r.params.techQueueTicketId) });
  return null;
}
describe('createMobileShell + useMobileRoutes', () => {
  it('a tap before sign-in waits; mounting the signed-in tree opens it; a route the app lacks never opens; sign-out unbinds', async () => {
    const shell = createMobileShell({ app: 'tech', pushApp: 'tech', http: { post: async () => ({}) }, isNative: () => false });
    const log: string[] = [];
    await shell.push.handleTap({ category: 'QUEUE_ASSIGNMENT', route: 'queue-ticket', techQueueTicketId: 't9' });
    expect(log).toEqual([]);
    const { unmount } = render(<Signed shell={shell} log={log} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['ticket:t9']);
    await shell.push.handleTap({ category: 'APPROVAL_REQUIRED' });          // an owner route: not in the tech table
    expect(log).toEqual(['ticket:t9']);
    unmount(); cleanup();
    await shell.push.handleTap({ category: 'QUEUE_ASSIGNMENT' });
    expect(log).toEqual(['ticket:t9']);                                   // signed out: nothing opens
  });
});
