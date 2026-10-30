export {
  isInternalEmail, makeRecoveryCode, normalizeRecoveryCode, normalizeUsername, recoveryHash, usernameProblem,
} from '../../supabase/functions/_shared/username.js';

// A new recovery code stays on this device until the player ticks that they
// saved it, so a reload (Safari often reloads a tab after switching apps)
// can't lose it. RecoveryCodeGate shows it again to the same signed-in player.
const PENDING_KEY = 'jt_unsaved_recovery_code';
export function rememberRecoveryCode(username, code) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ username, code }));
  } catch {
    // Private browsing: the code is still on screen.
  }
}
export function unsavedRecoveryCode(username) {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY));
    return username && saved?.username === username ? saved.code : null;
  } catch {
    return null;
  }
}
export function forgetRecoveryCode() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing was saved.
  }
}
