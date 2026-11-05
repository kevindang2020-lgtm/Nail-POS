// Security Deep Scan A5: avatars never fall back to a third-party bucket.
import { describe, it, expect } from 'vitest';
import { resolveAvatarUrl } from './ProfileAvatarWithPreview';

describe('resolveAvatarUrl (no VITE_LIVE_IMAGE_BASE)', () => {
  it('a bare key or images/ path shows initials (null), never a foreign host', () => {
    expect(resolveAvatarUrl('avatar-1787745385785.png')).toBeNull();
    expect(resolveAvatarUrl('uploads/images/avatar-1.png')).toBeNull();
  });
  it('full URLs and same-origin media paths pass through', () => {
    expect(resolveAvatarUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(resolveAvatarUrl('/media/t/a.png')).toBe('/media/t/a.png');
    expect(resolveAvatarUrl('')).toBeNull();
  });
});
