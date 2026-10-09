// Adding the site to a phone's Home Screen, so it opens like an app.

let deferredPrompt = null;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

// Android Chrome offers its own install prompt; hold on to it for our Install button.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    changed();
  });
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/** True when opened from the Home Screen icon rather than in the browser. */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** 'ios', 'android', or null for computers. iPads report themselves as Macs, but with touch. */
export function phoneKind({ userAgent, platform, maxTouchPoints } = navigator) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return null;
}

export const canPromptInstall = () => !!deferredPrompt;

/** Shows Android's install prompt. Resolves true if the player installed. */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  changed();
  event.prompt();
  const choice = await event.userChoice;
  return choice?.outcome === 'accepted';
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
