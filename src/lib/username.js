export {
  isInternalEmail, makeRecoveryCode, normalizeRecoveryCode, normalizeUsername, recoveryHash, usernameProblem,
} from '../../supabase/functions/_shared/username.js';

// A new recovery code stays on this device until the player ticks that they
// saved it, so a reload (Safari often reloads a tab after switching apps)
// can't lose it. RecoveryCodeGate shows it again to the same signed-in player.
// The copy in memory covers this visit when the browser won't store it.
const PENDING_KEY = 'jt_unsaved_recovery_code';
let unsaved = null;

/** Whether the code will also survive a reload. If not, show it before leaving the page. */
export function rememberRecoveryCode(username, code) {
  unsaved = { username, code };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(unsaved));
    return true;
  } catch {
    // Storage full or blocked. Don't leave an older, replaced code behind either.
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // Nothing to remove.
    }
    return false;
  }
}
export function unsavedRecoveryCode(username) {
  if (!username) return null;
  if (unsaved) return unsaved.username === username ? unsaved.code : null;
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY));
    return saved?.username === username ? saved.code : null;
  } catch {
    return null;
  }
}
export function forgetRecoveryCode() {
  unsaved = null;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing was saved.
  }
}
