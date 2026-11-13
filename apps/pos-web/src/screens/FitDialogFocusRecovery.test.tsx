// FitDialog — round 10 (English Vietnamese POS Localization 10) field focus recovery: when a save fails and an error appears,
// focus moves to the first invalid field (else the error itself) — never away from a field the person is typing in.
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FitDialog } from '../components/FitKit';

function Form({ markInvalid }: { markInvalid: boolean }) {
  const [err, setErr] = useState(false);
  return <FitDialog title="Edit" onClose={() => {}} footer={<button type="button" onClick={() => setErr(true)} data-testid="save">Save</button>}>
    <input data-testid="name" aria-label="Name" />
    <input data-testid="phone" aria-label="Phone" aria-invalid={err && markInvalid ? 'true' : undefined} />
    {err ? <div className="fk-error" role="alert" data-testid="err">Enter a valid phone.</div> : null}
  </FitDialog>;
}

describe('FitDialog field focus recovery', () => {
  it('a failed save puts focus on the invalid field', async () => {
    render(<Form markInvalid />);
    screen.getByTestId('save').focus(); fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('phone')));
  });
  it('with no field marked, the error itself takes focus (read aloud, focusable)', async () => {
    render(<Form markInvalid={false} />);
    screen.getByTestId('save').focus(); fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('err')));
    expect(screen.getByTestId('err').getAttribute('tabindex')).toBe('-1');
  });
  it('never steals focus from a field being typed in', async () => {
    render(<Form markInvalid />);
    const name = screen.getByTestId('name'); name.focus();
    fireEvent.click(screen.getByTestId('save'));   // the click itself does not move focus in jsdom
    await screen.findByTestId('err');
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(name);
  });
});
