// The number on the site's Home Screen icon (the Badging API). iPhones show it
// for the Home Screen app (iOS 16.4 and newer) once notifications are allowed;
// computers show it for the installed app. Android has no number: most Android
// phones put a dot on the icon by themselves while a notification is waiting.
// public/sw.js sets it when a notification arrives with the site closed.

/** Shows `count` on the icon, or clears it at 0. Quietly does nothing where it isn't supported. */
export function setHomeScreenBadge(count) {
  try {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
    done?.catch?.(() => {});
  } catch {
    // Not allowed here (no notification permission): no badge.
  }
}
