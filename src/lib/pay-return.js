// "Sent $61 on Venmo?" Venmo, PayPal and Cash App don't tell the site
// when someone pays, so tapping one of their pay buttons is remembered on this
// device, and My dues asks when the player comes back (docs/dues.md, section 10).
// Nothing here marks anyone paid: only the player's answer does.

const KEY = 'jt_pay_opened_v1';
/** How long after tapping a pay button the question still comes up. */
export const ASK_FOR_HOURS = 24;

// Private browsing can block storage; then the question still works until the page closes.
let memory = null;

function read() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return memory;
  }
}

/** Remembers which pay button the player tapped, for what amount, and when. */
export function rememberPayOpened({ userId, year, session, amount, label }, now = Date.now()) {
  const opened = { userId, year: Number(year), session: Number(session), amount, label, at: now };
  memory = opened;
  try {
    localStorage.setItem(KEY, JSON.stringify(opened));
  } catch {
    // The in-memory copy covers this visit.
  }
  return opened;
}

/**
 * The pay button this player tapped in the last day, or null. With a `period`,
 * only one for that session.
 */
export function payOpened(userId, period = null, now = Date.now()) {
  const opened = read();
  if (!opened || !userId || opened.userId !== userId) return null;
  if (!(opened.amount > 0) || !Number.isFinite(opened.at)) return null;
  if (now - opened.at > ASK_FOR_HOURS * 60 * 60 * 1000 || opened.at > now + 60 * 1000) return null;
  if (period && (opened.year !== Number(period.year) || opened.session !== Number(period.session))) return null;
  return opened;
}

/** Answered (or nothing left to pay): don't ask again. */
export function forgetPayOpened() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing saved to clear.
  }
}
