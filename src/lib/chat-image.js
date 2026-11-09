// Resize a picked photo before upload so chat-media stays small (idea #199):
// longest side at most 1600px, JPEG at ~80% quality. Safari can't encode WebP
// (toBlob returns a PNG labelled as webp), so JPEG only.

export const PHOTO_MAX_WIDTH = 1600;
export const PHOTO_QUALITY = 0.8;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo couldn't be opened."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Reads an image file, scales it down if needed, and returns a compressed blob
 * plus pixel size for the message attachment.
 */
function looksLikeImage(file) {
  if (!file) return false;
  if (String(file.type || '').startsWith('image/')) return true;
  // Some browsers (and Playwright's setInputFiles) leave type blank; fall back to the name.
  return /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(file.name || '');
}

export async function resizeChatPhoto(file) {
  if (!looksLikeImage(file)) {
    throw new Error('Pick a photo (JPEG, PNG, WebP, …).');
  }
  const img = await loadImage(file);
  const scale = Math.min(1, PHOTO_MAX_WIDTH / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("That photo couldn't be resized.");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, 'image/jpeg', PHOTO_QUALITY);
  if (!blob) throw new Error("That photo couldn't be compressed.");
  return { blob, width, height, ext: 'jpg' };
}
