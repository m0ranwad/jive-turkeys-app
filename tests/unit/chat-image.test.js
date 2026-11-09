import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_MAX_WIDTH, PHOTO_QUALITY, resizeChatPhoto } from '@/lib/chat-image';

function stubImage({ width, height }) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (cb, type) => {
      expect(type).toBe('image/jpeg');
      cb(new Blob(['jpg'], { type: 'image/jpeg' }));
    },
  };
  vi.stubGlobal('Image', class {
    width = width;
    height = height;
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
  return { drawImage, canvas };
}

describe('resizeChatPhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses non-images', async () => {
    await expect(resizeChatPhoto(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/photo/i);
  });

  it('accepts a blank MIME type when the file name looks like a photo', async () => {
    stubImage({ width: 100, height: 80 });
    const result = await resizeChatPhoto(new File(['x'], 'shot.png', { type: '' }));
    expect(result.ext).toBe('jpg');
    expect(result.width).toBe(100);
  });

  it('scales by the longest side and always encodes JPEG', async () => {
    const { drawImage } = stubImage({ width: 3200, height: 1800 });
    const result = await resizeChatPhoto(new File(['x'], 'wide.jpg', { type: 'image/jpeg' }));
    expect(result.width).toBe(PHOTO_MAX_WIDTH);
    expect(result.height).toBe(Math.round(1800 * (PHOTO_MAX_WIDTH / 3200)));
    expect(result.ext).toBe('jpg');
    expect(result.blob.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalled();
    expect(PHOTO_QUALITY).toBe(0.8);
  });

  it('scales a tall screenshot so the height stays under the max', async () => {
    stubImage({ width: 1080, height: 12000 });
    const result = await resizeChatPhoto(new File(['x'], 'tall.png', { type: 'image/png' }));
    expect(result.height).toBe(PHOTO_MAX_WIDTH);
    expect(result.width).toBe(Math.round(1080 * (PHOTO_MAX_WIDTH / 12000)));
    expect(result.ext).toBe('jpg');
  });
});
