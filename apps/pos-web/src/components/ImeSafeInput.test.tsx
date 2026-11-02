// ImeSafeInput.test — Vietnamese POS mandate §40 (WP-E): Telex / VNI typing builds "Nguyễn" over several keystrokes inside
// an IME composition. Nothing may search mid-composition, the half-typed accent may never be wiped, and the composed text
// is reported exactly once when the composition ends — in Chrome's event order and in Safari's.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { ImeSafeInput } from './ImeSafeInput';

/** A parent shaped like the POS search boxes: controlled value + an effect that "searches" whenever the value changes. */
function Harness({ onSearch, onKeyDown }: { onSearch: (q: string) => void; onKeyDown?: (key: string) => void }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (q) onSearch(q); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <ImeSafeInput aria-label="search" value={q} onValue={setQ} onKeyDown={(e) => onKeyDown?.(e.key)} />
      <button onClick={() => setQ('')}>clear</button>
      <button onClick={() => setQ('Trần')}>recent</button>
      <output data-testid="q">{q}</output>
    </>
  );
}

const box = () => screen.getByLabelText('search') as HTMLInputElement;

/** Drive one IME composition: start, one `input` per intermediate state, then end (Chrome order: last input, then end). */
function compose(el: HTMLInputElement, states: string[], order: 'chrome' | 'safari' = 'chrome') {
  fireEvent.compositionStart(el);
  const finalText = states[states.length - 1];
  const during = order === 'chrome' ? states : states.slice(0, -1);
  for (const s of during) fireEvent.change(el, { target: { value: s } });
  if (order === 'chrome') { fireEvent.compositionEnd(el, { data: finalText }); return; }
  // Safari: compositionend fires BEFORE the final input event
  el.value = finalText;
  fireEvent.compositionEnd(el, { data: finalText });
  fireEvent.change(el, { target: { value: finalText } });
}

// The DOM states an IME shows while typing "Nguyễn" (prefix "Ngu" typed plainly, then the composed syllable).
const TELEX = ['Nguy', 'Nguye', 'Nguyee', 'Nguyê', 'Nguyên', 'Nguyễn'];          // y e e(→ê) n x(→ngã)
const VNI = ['Nguy', 'Nguye', 'Nguyê', 'Nguyên', 'Nguyễn'];                       // y e 6(→ê) n 4(→ngã)

describe('ImeSafeInput', () => {
  it('ordinary typing reports every value (no composition involved)', () => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    fireEvent.change(box(), { target: { value: 'O' } });
    fireEvent.change(box(), { target: { value: 'Ol' } });
    expect(onSearch.mock.calls.map((c) => c[0])).toEqual(['O', 'Ol']);
  });

  it.each([['Telex', TELEX], ['VNI', VNI]])('%s: no search mid-composition, one search with the composed text at the end', (_name, states) => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    fireEvent.change(box(), { target: { value: 'Ngu' } });
    onSearch.mockClear();
    compose(box(), states);
    expect(onSearch.mock.calls.map((c) => c[0])).toEqual(['Nguyễn']);
    expect(box().value).toBe('Nguyễn');
    expect(screen.getByTestId('q').textContent).toBe('Nguyễn');
  });

  it('Safari order (compositionend before the final input) still reports the composed text exactly once', () => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    compose(box(), ['Đ', 'Đa', 'Đă', 'Đặ', 'Đặng'], 'safari');
    expect(onSearch.mock.calls.map((c) => c[0])).toEqual(['Đặng']);
    expect(box().value).toBe('Đặng');
  });

  it('the half-composed text stays on screen while composing (the parent value is not forced back over it)', () => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    fireEvent.compositionStart(box());
    fireEvent.change(box(), { target: { value: 'Nguyê' } });
    expect(box().value).toBe('Nguyê');                       // a plain controlled input would snap back to ''
    expect(screen.getByTestId('q').textContent).toBe('');    // the parent has not been told yet
    fireEvent.change(box(), { target: { value: 'Nguyên' } });
    expect(box().value).toBe('Nguyên');
    fireEvent.compositionEnd(box(), { data: 'Nguyên' });
    expect(screen.getByTestId('q').textContent).toBe('Nguyên');
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('keys pressed inside a composition (the IME\'s own Enter / arrows) are not passed on; afterwards they are', () => {
    const keys = vi.fn();
    render(<Harness onSearch={() => {}} onKeyDown={keys} />);
    fireEvent.compositionStart(box());
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.compositionEnd(box(), { data: 'ễ' });
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });   // Safari's commit keydown after the end
    expect(keys).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(keys).toHaveBeenCalledWith('Enter');
  });

  it('adopts a value the parent sets itself (clear, recent search)', () => {
    render(<Harness onSearch={() => {}} />);
    fireEvent.change(box(), { target: { value: 'abc' } });
    act(() => { fireEvent.click(screen.getByText('clear')); });
    expect(box().value).toBe('');
    act(() => { fireEvent.click(screen.getByText('recent')); });
    expect(box().value).toBe('Trần');
  });

  it('a parent value change that lands mid-composition does not wipe the composition', () => {
    function Pusher() {
      const [q, setQ] = useState('');
      return (<><ImeSafeInput aria-label="search" value={q} onValue={setQ} /><button onClick={() => setQ('Trần')}>push</button></>);
    }
    render(<Pusher />);
    fireEvent.compositionStart(box());
    fireEvent.change(box(), { target: { value: 'Nguyê' } });
    act(() => { fireEvent.click(screen.getByText('push')); });
    expect(box().value).toBe('Nguyê');
  });
});
