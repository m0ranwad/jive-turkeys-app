import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_MAX_WIDTH, PHOTO_QUALITY, resizeChatPhoto } from '@/lib/chat-image';

describe('resizeChatPhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses non-images', async () => {
    await expect(resizeChatPhoto(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/photo/i);
  });

  it('accepts a blank MIME type when the file name looks like a photo', async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb) => cb(new Blob(['webp'], { type: 'image/webp' })),
    };
    vi.stubGlobal('Image', class {
      width = 100;
      height = 80;
      set src(_) {
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal('document', { createElement: (tag) => (tag === 'canvas' ? canvas : null) });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: vi.fn() });

    const result = await resizeChatPhoto(new File(['x'], 'shot.png', { type: '' }));
    expect(result.ext).toBe('webp');
    expect(result.width).toBe(100);
  });

  it('scales wide images down to the max width and prefers WebP', async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb, type) => {
        if (type === 'image/webp') cb(new Blob(['webp'], { type: 'image/webp' }));
        else cb(new Blob(['jpg'], { type: 'image/jpeg' }));
      },
    };
    vi.stubGlobal('Image', class {
      width = 3200;
      height = 1800;
      set src(_) {
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal('document', {
      createElement: (tag) => {
        if (tag === 'canvas') return canvas;
        throw new Error(`unexpected element ${tag}`);
      },
    });
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: vi.fn(),
    });

    const result = await resizeChatPhoto(new File(['x'], 'wide.jpg', { type: 'image/jpeg' }));
    expect(result.width).toBe(PHOTO_MAX_WIDTH);
    expect(result.height).toBe(Math.round(1800 * (PHOTO_MAX_WIDTH / 3200)));
    expect(result.ext).toBe('webp');
    expect(result.blob.type).toBe('image/webp');
    expect(drawImage).toHaveBeenCalled();
    expect(PHOTO_QUALITY).toBe(0.8);
  });
});
