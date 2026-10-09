// Chat notifications on this device: checking, turning on and off, and testing.
// Each phone or computer is signed up separately.
import { api } from '@/api';
import { isInstalled, phoneKind } from '@/lib/install';

const DEMO_KEY = 'jt_demo_push_on';

export const SAMPLE_NOTIFICATION = {
  title: 'Notifications are on 🦃',
  body: "You'll hear about new chat messages on this device.",
};

const demo = () => api.mode === 'demo';

function demoOn(value) {
  try {
    if (value === undefined) return !!localStorage.getItem(DEMO_KEY);
    if (value) localStorage.setItem(DEMO_KEY, '1');
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    // Private mode.
  }
  return !!value;
}

/** The service worker, or an error if it won't start (old browser, private mode). */
async function worker() {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Notifications couldn't start on this device.")), 8000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

const keyBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function sameKey(subscription, key) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Where notifications stand on this device:
 * 'unsupported' | 'needs-install' (iPhone: add to Home Screen first) | 'blocked' | 'off' | 'on'.
 */
export async function pushState() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return phoneKind() === 'ios' && !isInstalled() ? 'needs-install' : 'unsupported';
  }
  if (phoneKind() === 'ios' && !isInstalled()) return 'needs-install';
  if (!demo() && !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  if (demo()) return demoOn() ? 'on' : 'off';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  return subscription ? 'on' : 'off';
}

/** Asks permission (it must be called from a tap) and signs this device up. Resolves to the new state. */
export async function turnOnPush() {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const registration = await worker();
  if (demo()) {
    demoOn(true);
    await registration.showNotification(SAMPLE_NOTIFICATION.title, {
      body: SAMPLE_NOTIFICATION.body,
      icon: '/icon-192.png',
      tag: 'test',
    });
    return 'on';
  }
  const key = await api.push.publicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription =
    subscription || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api.push.save(subscription);
  return 'on';
}

/** Stops notifications on this device. */
export async function turnOffPush() {
  if (demo()) {
    demoOn(false);
    return 'off';
  }
  if (!('serviceWorker' in navigator)) return 'off';
  // getRegistration (not ready) so signing out never waits on a worker that isn't there.
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    await api.push.remove(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  }
  return 'off';
}

/** Sends a test notification (from the real sender; a local sample in previews). */
export async function sendTestPush() {
  if (demo()) {
    const registration = await worker();
    await registration.showNotification(SAMPLE_NOTIFICATION.title, {
      body: SAMPLE_NOTIFICATION.body,
      icon: '/icon-192.png',
      tag: 'test',
    });
    return { sent: 1, failed: 0 };
  }
  return api.push.test();
}

/** Re-saves this device's subscription if it has one, in case the server lost it or someone else signed in. */
export async function resyncPush() {
  if (demo() || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await api.push.save(subscription);
}
