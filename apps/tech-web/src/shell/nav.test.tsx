// nav.test.tsx — the technician app navigates with an in-memory state machine (not a URL router). These tests pin the
// five primary tabs, the six pushed detail views, and the rule that switching tabs clears any pushed view.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechNavProvider, useTechNav } from './nav';

function Probe() {
  const n = useTechNav();
  return (
    <div>
      <div data-testid="tab">{n.tab}</div>
      <div data-testid="pushed">{n.pushed ? n.pushed.kind : 'none'}</div>
      <div data-testid="ticketId">{n.pushed?.kind === 'ticket' ? n.pushed.ticketId : ''}</div>
      <button onClick={() => n.go('schedule')}>go-schedule</button>
      <button onClick={() => n.go('earnings')}>go-earnings</button>
      <button onClick={() => n.openTicket('t9')}>open-ticket</button>
      <button onClick={() => n.openQueue()}>open-queue</button>
      <button onClick={() => n.openNotifications()}>open-notifs</button>
      <button onClick={() => n.openSettings()}>open-settings</button>
      <button onClick={() => n.openProfile()}>open-profile</button>
      <button onClick={() => n.openFollowUps()}>open-followups</button>
      <button onClick={() => n.back()}>back</button>
    </div>
  );
}
const renderNav = () => render(<TechNavProvider><Probe /></TechNavProvider>);

describe('TechNav state machine', () => {
  it('defaults to the home tab with no pushed view', () => {
    renderNav();
    expect(screen.getByTestId('tab')).toHaveTextContent('home');
    expect(screen.getByTestId('pushed')).toHaveTextContent('none');
  });

  it('go() switches the active tab', () => {
    renderNav();
    fireEvent.click(screen.getByText('go-schedule'));
    expect(screen.getByTestId('tab')).toHaveTextContent('schedule');
  });

  it('each open* pushes the matching detail view and back() clears it', () => {
    renderNav();
    const cases: [string, string][] = [
      ['open-queue', 'queue'], ['open-notifs', 'notifications'], ['open-settings', 'settings'],
      ['open-profile', 'profile'], ['open-followups', 'followups'],
    ];
    for (const [btn, kind] of cases) {
      fireEvent.click(screen.getByText(btn));
      expect(screen.getByTestId('pushed')).toHaveTextContent(kind);
      fireEvent.click(screen.getByText('back'));
      expect(screen.getByTestId('pushed')).toHaveTextContent('none');
    }
  });

  it('openTicket carries the id, and switching tabs clears the pushed view', () => {
    renderNav();
    fireEvent.click(screen.getByText('open-ticket'));
    expect(screen.getByTestId('pushed')).toHaveTextContent('ticket');
    expect(screen.getByTestId('ticketId')).toHaveTextContent('t9');
    fireEvent.click(screen.getByText('go-earnings'));
    expect(screen.getByTestId('tab')).toHaveTextContent('earnings');
    expect(screen.getByTestId('pushed')).toHaveTextContent('none');
  });
});
