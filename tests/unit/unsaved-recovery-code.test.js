import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetRecoveryCode, rememberRecoveryCode, unsavedRecoveryCode } from '@/lib/username';

afterEach(() => {
  vi.restoreAllMocks();
  forgetRecoveryCode();
  localStorage.clear();
});

describe('an unsaved recovery code', () => {
  it('is kept for the same player until they say they saved it', () => {
    expect(rememberRecoveryCode('jordan', 'aaaa-bbbb')).toBe(true);
    expect(unsavedRecoveryCode('jordan')).toBe('aaaa-bbbb');
    expect(unsavedRecoveryCode('someone_else')).toBeNull();
    expect(unsavedRecoveryCode(null)).toBeNull();
    forgetRecoveryCode();
    expect(unsavedRecoveryCode('jordan')).toBeNull();
  });

  it('says when the browser would not store it, keeps it for this visit, and drops an older one', () => {
    rememberRecoveryCode('jordan', 'old-code');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(rememberRecoveryCode('jordan', 'new-code')).toBe(false);
    expect(unsavedRecoveryCode('jordan')).toBe('new-code');
    expect(localStorage.getItem('jt_unsaved_recovery_code')).toBeNull();
  });
});
