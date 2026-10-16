// Photos in the chat: getting them ready to upload (shrunk on the phone, so
// uploads are quick and the free storage lasts), and how a message with
// photos reads where only text fits (room list, notifications, reply quotes).

/** Photos one message can carry. The database allows the same. */
export const MAX_PHOTOS = 4;
/** Longest side of an uploaded photo, in pixels. */
export const MAX_SIDE = 1600;
/** GIFs go up as they are (shrinking would stop them moving), so they have a size limit instead. */
export const MAX_GIF_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

/** The text a message with photos and no caption is saved with: every message needs some. */
export function photoBody(photos) {
  if (photos.length > 1) return `📷 ${photos.length} photos`;
  return photos[0]?.gif ? '🎞️ GIF' : '📷 Photo';
}

/** A message's photos (an empty list for plain messages). */
export const photosOf = (message) => (Array.isArray(message?.attachments) ? message.attachments : []);

export const isGif = (photo) => /\.gif$/i.test(photo?.path || '') || !!photo?.gif;

/** The caption the player wrote, or '' for photos sent without one. */
export function captionOf(message) {
  const photos = photosOf(message);
  if (!photos.length) return message.body;
  return message.body === photoBody(photos.map((p) => ({ gif: isGif(p) }))) ? '' : message.body;
}

/** One line for a reply quote: the caption with a camera, or just "📷 Photo". */
export function previewText(message) {
  const photos = photosOf(message);
  const caption = captionOf(message);
  return photos.length && caption ? `📷 ${caption}` : message.body;
}

/** The size to shrink to, keeping the shape: the longest side at most `max`. */
export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pictures from the file picker or a paste; anything else (videos, PDFs) is left out. */
export const pickImages = (files) => [...(files || [])].filter((f) => f.type.startsWith('image/'));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That photo couldn't be opened. Try a JPEG or PNG."));
    img.src = url;
  });
}

/**
 * Gets a picked photo ready to upload: shrunk to MAX_SIDE as a JPEG (which also
 * drops its location and other camera details), or a GIF as it is. Resolves to
 * { blob, width, height, gif, preview } where preview is a local link to show it.
 */
export async function preparePhoto(file) {
  const original = URL.createObjectURL(file);
  try {
    const img = await loadImage(original);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
    if (file.type === 'image/gif') {
      if (file.size > MAX_GIF_BYTES) throw new Error('That GIF is too big. GIFs can be up to 5 MB.');
      return { blob: file, width, height, gif: true, preview: original };
    }
    const size = fitWithin(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    // See-through parts of a PNG would turn black in a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
    URL.revokeObjectURL(original);
    return { blob, ...size, gif: false, preview: URL.createObjectURL(blob) };
  } catch (err) {
    URL.revokeObjectURL(original);
    throw err;
  }
}

/** The file name extension the database accepts for an upload. */
export function photoExtension(type) {
  return { 'image/gif': 'gif', 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg';
}
