// nail-showcase-ownership.vitest.spec — Customer Directory guide §52 / §78 (Nov 6 2026). The live IDOR sweep exempts the
// customer NailShowcase write routes because the SERVICE checks the author; this proves it: customer B cannot edit or
// delete customer A's post or comment, nothing is written, and B's reaction removal only ever names B.
import { describe, it, expect, vi } from 'vitest';
import { NailShowcaseService } from './nail-showcase.service';

const A = 'cust-a', B = 'cust-b';
function harness() {
  const post = { id: 'p1', tenantId: 't1', customerId: A, caption: 'mine', tags: [], visibility: 'public', allowComments: true };
  const comment = { id: 'c1', postId: 'p1', customerId: A, body: 'nice' };
  const repo: any = {
    postById: vi.fn(async (id: string) => (id === 'p1' ? post : null)),
    commentById: vi.fn(async (id: string) => (id === 'c1' ? comment : null)),
    updatePost: vi.fn(), softDeletePost: vi.fn(), softDeleteComment: vi.fn(), syncCommentCount: vi.fn(), deleteReaction: vi.fn(), syncReactionCounts: vi.fn(async () => ({ likeCount: 0, dislikeCount: 0 })),
  };
  return { repo, svc: new NailShowcaseService(repo) };
}
const ctx = (userId: string) => ({ userId, tenantId: 't1' } as any);

describe('NailShowcase: a customer acts on their own content only', () => {
  it("B cannot edit A's post", async () => {
    const { repo, svc } = harness();
    await expect(svc.updatePost(ctx(B), 'p1', { caption: 'hijack' })).rejects.toMatchObject({ code: 'forbidden', apiCode: 'OWN_CONTENT_ONLY' });
    expect(repo.updatePost).not.toHaveBeenCalled();
  });
  it("B cannot delete A's post", async () => {
    const { repo, svc } = harness();
    await expect(svc.deletePost(ctx(B), 'p1')).rejects.toMatchObject({ code: 'forbidden', apiCode: 'OWN_CONTENT_ONLY' });
    expect(repo.softDeletePost).not.toHaveBeenCalled();
  });
  it("B cannot delete A's comment", async () => {
    const { repo, svc } = harness();
    await expect(svc.deleteComment(ctx(B), 'c1')).rejects.toMatchObject({ code: 'forbidden', apiCode: 'OWN_CONTENT_ONLY' });
    expect(repo.softDeleteComment).not.toHaveBeenCalled();
  });
  it('an unknown id is not found (no hint whether it exists elsewhere)', async () => {
    const { svc } = harness();
    await expect(svc.deletePost(ctx(B), 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.deleteComment(ctx(B), 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
  it("removing a reaction only ever removes the caller's own", async () => {
    const { repo, svc } = harness();
    await svc.removeReaction(ctx(B), 'p1');
    expect(repo.deleteReaction).toHaveBeenCalledTimes(1);
    expect(repo.deleteReaction).toHaveBeenCalledWith('p1', B);
  });
  it('no customer session → refused before any read', async () => {
    const { repo, svc } = harness();
    await expect(svc.deletePost({ tenantId: 't1' } as any, 'p1')).rejects.toMatchObject({ code: 'not_customer' });
    expect(repo.postById).not.toHaveBeenCalled();
  });
});
