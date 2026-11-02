// bookThisLook.ts — ONE place that turns a Nail Showcase post into a booking pre-fill (Technician Profile mandate §46/§47,
// merge Oct 12 2026): technician + service ride as query params, the style reference (caption, first photo, who did it)
// as router state. Pre-fill only — BookScreen applies a service only when this salon offers it, and the server still
// validates availability and eligibility.
import type { NSPostView } from '@aipowersalon/api-contracts/customer';

export function bookThisLookTarget(post: Pick<NSPostView, 'serviceId' | 'technicianId' | 'caption' | 'technicianName' | 'photos'>): { path: string; state: { look: { caption: string | null; imageUrl: string | null; techName: string | null; source: 'showcase' } } } {
  const q = new URLSearchParams();
  if (post.serviceId) q.set('serviceId', post.serviceId);
  if (post.technicianId) q.set('technicianId', post.technicianId);
  const photo = post.photos?.[0];
  return {
    path: `/book${q.toString() ? `?${q}` : ''}`,
    state: { look: { caption: post.caption?.trim() ? post.caption.trim().slice(0, 140) : null, imageUrl: photo ? (photo.thumbnailUrl || photo.imageUrl) : null, techName: post.technicianName ?? null, source: 'showcase' } },
  };
}
