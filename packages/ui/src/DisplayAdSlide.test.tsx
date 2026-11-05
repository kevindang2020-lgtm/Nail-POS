// DisplayAdSlide.test.tsx — the ONE advertisement renderer (customer display + POS preview), 23-inch spec §53–§60, §77–§78.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AdFallbackPanel, AdRotator, DisplayAdSlide, qrPath, type RotatingAd } from './DisplayAdSlide';

const IMG = { url: '/media/display-ads/m1/medium.webp', width: 720, height: 1080 };
afterEach(() => { vi.useRealTimers(); });

describe('DisplayAdSlide', () => {
  it('§53 image only: just the image, filling the panel around the focus point — never distorted', () => {
    const { container } = render(<DisplayAdSlide ad={{ image: IMG, fit: 'cover', focalX: 0.25, focalY: 0.8 }} resolveUrl={(u) => 'https://api.example.com' + u} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('https://api.example.com/media/display-ads/m1/medium.webp');
    expect(imgs[0].style.objectFit).toBe('cover');
    expect(imgs[0].style.objectPosition).toBe('25% 80%');
    expect(container.textContent).toBe('');
  });
  it('§54 contain: the whole image, over a blurred copy of itself instead of empty bars', () => {
    const { container } = render(<DisplayAdSlide ad={{ image: IMG, fit: 'contain', focalX: 0.1, focalY: 0.1 }} />);
    const [backdrop, main] = Array.from(container.querySelectorAll('img'));
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.style.filter).toMatch(/blur/);
    expect(main.style.objectFit).toBe('contain');
    expect(main.style.objectPosition).toBe('50% 50%');
  });
  it('§77: text is text — markup in a headline is shown literally, never rendered', () => {
    const { container } = render(<DisplayAdSlide ad={{ image: IMG, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: '<b>Deluxe</b> <img src=x onerror=alert(1)>', ctaText: 'Book today' }} />);
    expect(screen.getByText('<b>Deluxe</b> <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelectorAll('b')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('Book today')).toBeInTheDocument();
  });
  it('§78: the QR code is drawn from the URL, with its caption', () => {
    render(<DisplayAdSlide ad={{ image: IMG, fit: 'cover', focalX: 0.5, focalY: 0.5, qr: { label: 'Gift cards', url: 'https://salon.example.com/gift' } }} />);
    expect(screen.getByRole('img', { name: 'QR code: Gift cards' })).toBeInTheDocument();
    expect(screen.getByText('Gift cards')).toBeInTheDocument();
  });
  it('qrPath encodes the text as dark modules with a 4-module quiet zone', () => {
    const p = qrPath('https://salon.example.com/gift')!;
    expect(p.size).toBeGreaterThanOrEqual(21 + 8);
    expect(p.d).toMatch(/^M4 4h7v1h-7z/);   // the top-left finder pattern starts at the quiet-zone corner, 7 modules wide
    expect(qrPath('https://salon.example.com/gift')).toEqual(p);
  });
});

const ads: RotatingAd[] = [
  { id: 'a', version: 1, durationSeconds: 10, image: IMG, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: 'First' },
  { id: 'b', version: 1, durationSeconds: 5, image: IMG, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: 'Second' },
];
const visible = (container: HTMLElement) => Array.from(container.querySelectorAll('[aria-hidden="false"]')).map((el) => el.textContent);

describe('AdRotator (§58–§60, §108)', () => {
  it('loops each ad for its own duration and reports every slot it filled', () => {
    vi.useFakeTimers({ now: 0 });
    const shown: [string, number][] = [];
    const { container } = render(<AdRotator ads={ads} onShown={(id, ms) => shown.push([id, ms])} />);
    expect(visible(container)).toEqual(['First']);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(visible(container)).toEqual(['Second']);
    expect(shown).toEqual([['a', 10_000]]);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(visible(container)).toEqual(['First']);
    expect(shown).toEqual([['a', 10_000], ['b', 5_000]]);
  });
  it('a lone ad starts a new slot each duration (one display per slot)', () => {
    vi.useFakeTimers({ now: 0 });
    const shown: [string, number][] = [];
    render(<AdRotator ads={[ads[1]]} onShown={(id, ms) => shown.push([id, ms])} />);
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(5_000); });
    expect(shown).toEqual([['b', 5_000], ['b', 5_000], ['b', 5_000]]);
  });
  it('a new playlist starts from the top; the interrupted slot is reported with the time it really had', () => {
    vi.useFakeTimers({ now: 0 });
    const shown: [string, number][] = [];
    const { container, rerender } = render(<AdRotator ads={ads} onShown={(id, ms) => shown.push([id, ms])} />);
    act(() => { vi.advanceTimersByTime(4_000); });
    rerender(<AdRotator ads={[ads[1]]} onShown={(id, ms) => shown.push([id, ms])} />);
    expect(shown).toEqual([['a', 4_000]]);
    expect(visible(container)).toEqual(['Second']);
  });
  it('§114 nothing to play → the fallback', () => {
    render(<AdRotator ads={[]} fallback={<AdFallbackPanel salonName="Luxury Nails" />} />);
    expect(screen.getByText('Luxury Nails')).toBeInTheDocument();
    expect(screen.getByText('Gift cards available')).toBeInTheDocument();
  });
});
