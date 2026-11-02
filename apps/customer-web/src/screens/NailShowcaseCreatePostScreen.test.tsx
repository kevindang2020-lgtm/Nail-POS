// NailShowcaseCreatePostScreen (customer mutation, two-step): create post then upload photos. Verifies the photo
// validation (type/size), the no-photo guard, the create payload (tags/visibility/anonymous), the create->upload->navigate
// flow using the returned post.id, and error recovery.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockNav = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNav }));
vi.mock('../api/customerNailShowcaseApi', () => ({ customerNailShowcaseApi: { createPost: vi.fn(), uploadPhotos: vi.fn() } }));

import { customerNailShowcaseApi } from '../api/customerNailShowcaseApi';
import { NailShowcaseCreatePostScreen } from './NailShowcaseCreatePostScreen';

const jpg = (name = 'nails.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  (customerNailShowcaseApi.createPost as any).mockResolvedValue({ id: 'post1', caption: '', tags: [], visibility: 'salon_only', postType: 'manual_upload', status: 'active' });
  (customerNailShowcaseApi.uploadPhotos as any).mockResolvedValue({ photos: [] });
  (global.URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (global.URL as any).revokeObjectURL = vi.fn();
});

describe('NailShowcaseCreatePostScreen', () => {
  it('requires at least one photo', () => {
    render(<NailShowcaseCreatePostScreen />);
    fireEvent.click(screen.getByText('Share Post'));
    expect(screen.getByText('Add at least one photo or video of your nails.')).toBeInTheDocument();
    expect(customerNailShowcaseApi.createPost).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type', () => {
    const { container } = render(<NailShowcaseCreatePostScreen />);
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText('doc.pdf: use JPG, PNG, WEBP, MP4, or MOV.')).toBeInTheDocument();
  });

  it('rejects a file over the size limit', () => {
    const { container } = render(<NailShowcaseCreatePostScreen />);
    const big = jpg('big.jpg');
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });   // the limit is 50MB since the photos+videos redesign
    fireEvent.change(fileInput(container), { target: { files: [big] } });
    expect(screen.getByText('big.jpg: exceeds 50MB.')).toBeInTheDocument();
  });

  it('creates the post then uploads photos and navigates using the returned id', async () => {
    const { container } = render(<NailShowcaseCreatePostScreen />);
    const file = jpg();
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Share Post'));
    await waitFor(() => expect(customerNailShowcaseApi.createPost).toHaveBeenCalledWith(expect.objectContaining({
      tags: [], visibility: 'salon_only', allowComments: true, isAnonymous: false,
    })));
    await waitFor(() => expect(customerNailShowcaseApi.uploadPhotos).toHaveBeenCalledWith('post1', [file]));
    expect(mockNav).toHaveBeenCalledWith('/nail-showcase/post1');
  });

  it('includes selected tags, visibility and anonymous in the payload', async () => {
    const { container } = render(<NailShowcaseCreatePostScreen />);
    fireEvent.change(fileInput(container), { target: { files: [jpg()] } });
    fireEvent.click(screen.getByText('Chrome'));
    fireEvent.click(screen.getByText('Only me'));            // visibility -> private
    fireEvent.click(screen.getByText('Post anonymously'));   // anonymous -> true
    fireEvent.click(screen.getByText('Share Post'));
    await waitFor(() => expect(customerNailShowcaseApi.createPost).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['Chrome'], visibility: 'private', isAnonymous: true,
    })));
  });

  it('shows an error and re-enables the button if create fails', async () => {
    (customerNailShowcaseApi.createPost as any).mockRejectedValue(new Error('Post could not be created'));
    const { container } = render(<NailShowcaseCreatePostScreen />);
    fireEvent.change(fileInput(container), { target: { files: [jpg()] } });
    fireEvent.click(screen.getByText('Share Post'));
    expect(await screen.findByText('Post could not be created')).toBeInTheDocument();
    expect(screen.getByText('Share Post')).toBeInTheDocument();   // back to idle label, not "Sharing…"
    expect(customerNailShowcaseApi.uploadPhotos).not.toHaveBeenCalled();
  });
});
