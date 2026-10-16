// Chat photos: how big they're shrunk to, and how a message with photos reads
// where only text fits. See docs/chat.md (Photos).
import { describe, expect, it } from 'vitest';
import { MAX_SIDE, captionOf, fitWithin, isGif, photoBody, photoExtension, photosOf, pickImages, previewText } from '@/lib/photos';

const photo = (path, extra = {}) => ({ type: 'image', path, width: 1600, height: 1200, ...extra });

describe('fitWithin', () => {
  it('shrinks the longest side to 1600 pixels, keeping the shape', () => {
    expect(MAX_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1179, 2556)).toEqual({ width: 738, height: 1600 });
  });

  it('leaves smaller photos their size', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('never rounds a side down to nothing', () => {
    expect(fitWithin(20000, 3)).toEqual({ width: 1600, height: 1 });
  });
});

describe('photoBody', () => {
  it('is what a photo sent without a caption says (every message needs text)', () => {
    expect(photoBody([{ gif: false }])).toBe('📷 Photo');
    expect(photoBody([{ gif: true }])).toBe('🎞️ GIF');
    expect(photoBody([{ gif: false }, { gif: true }, { gif: false }])).toBe('📷 3 photos');
  });
});

describe('captions and previews', () => {
  it('has no caption when the text is just what a photo without one says', () => {
    expect(captionOf({ body: '📷 Photo', attachments: [photo('u/a.jpg')] })).toBe('');
    expect(captionOf({ body: '🎞️ GIF', attachments: [photo('u/a.gif')] })).toBe('');
    expect(captionOf({ body: '📷 2 photos', attachments: [photo('u/a.jpg'), photo('u/b.gif')] })).toBe('');
  });

  it('keeps a real caption, and plain messages are all text', () => {
    expect(captionOf({ body: 'Champions!', attachments: [photo('u/a.jpg')] })).toBe('Champions!');
    expect(captionOf({ body: '📷 Photo' })).toBe('📷 Photo');
  });

  it('quotes a captioned photo with a camera, and a photo alone as its text', () => {
    expect(previewText({ body: 'Champions!', attachments: [photo('u/a.jpg')] })).toBe('📷 Champions!');
    expect(previewText({ body: '📷 Photo', attachments: [photo('u/a.jpg')] })).toBe('📷 Photo');
    expect(previewText({ body: 'Hi' })).toBe('Hi');
  });

  it('reads photos only from a list', () => {
    expect(photosOf({ attachments: null })).toEqual([]);
    expect(photosOf({})).toEqual([]);
    expect(photosOf({ attachments: [photo('u/a.jpg')] })).toHaveLength(1);
  });
});

describe('files', () => {
  it('takes pictures only', () => {
    const files = [{ type: 'image/jpeg' }, { type: 'video/mp4' }, { type: 'image/gif' }, { type: 'application/pdf' }];
    expect(pickImages(files)).toEqual([{ type: 'image/jpeg' }, { type: 'image/gif' }]);
    expect(pickImages(null)).toEqual([]);
  });

  it('names uploads with an extension the database accepts', () => {
    expect(photoExtension('image/jpeg')).toBe('jpg');
    expect(photoExtension('image/gif')).toBe('gif');
    expect(photoExtension('image/png')).toBe('png');
    expect(photoExtension('image/heic')).toBe('jpg');
  });

  it('knows a GIF by its file name, or while sending by its flag', () => {
    expect(isGif(photo('u/a.gif'))).toBe(true);
    expect(isGif(photo('u/a.jpg'))).toBe(false);
    expect(isGif({ gif: true })).toBe(true);
  });
});
