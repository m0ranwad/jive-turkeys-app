// "Did your $61 go through?": which pay button a player tapped is remembered on
// their device for a day, so My dues can ask when they come back. Expected
// behavior: docs/dues.md, section 10.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_FOR_HOURS, forgetPayOpened, payOpened, rememberPayOpened } from '@/lib/pay-return';

const NOW = new Date('2026-11-02T19:00:00').getTime();
const HOUR = 60 * 60 * 1000;
const SESSION_2 = { year: 2026, session: 2 };
const alex = (extra = {}) => ({ userId: 'alex', year: 2026, session: 2, amount: 122, label: 'Venmo', ...extra });

beforeEach(() => forgetPayOpened());
afterEach(() => vi.unstubAllGlobals());

describe('asking whether a payment went through', () => {
  it('remembers the pay button a player tapped, for that player and session', () => {
    rememberPayOpened(alex(), NOW);
    expect(payOpened('alex', SESSION_2, NOW + HOUR)).toEqual({ ...alex(), at: NOW });
    expect(payOpened('alex', null, NOW)).toMatchObject({ label: 'Venmo', amount: 122 });
    // Session numbers from the page can be strings.
    expect(payOpened('alex', { year: '2026', session: '2' }, NOW)).not.toBeNull();
  });

  it("doesn't ask someone else on the same phone, or about another session", () => {
    rememberPayOpened(alex(), NOW);
    expect(payOpened('jordan', SESSION_2, NOW)).toBeNull();
    expect(payOpened(null, SESSION_2, NOW)).toBeNull();
    expect(payOpened('alex', { year: 2026, session: 1 }, NOW)).toBeNull();
    expect(payOpened('alex', { year: 2025, session: 2 }, NOW)).toBeNull();
  });

  it('stops asking after a day, or once it was answered', () => {
    rememberPayOpened(alex(), NOW);
    expect(ASK_FOR_HOURS).toBe(24);
    expect(payOpened('alex', SESSION_2, NOW + 24 * HOUR)).not.toBeNull();
    expect(payOpened('alex', SESSION_2, NOW + 24 * HOUR + 1)).toBeNull();

    forgetPayOpened();
    expect(payOpened('alex', SESSION_2, NOW)).toBeNull();
    expect(localStorage.getItem('jt_pay_opened_v1')).toBeNull();
  });

  it('the latest tap counts', () => {
    rememberPayOpened(alex(), NOW);
    rememberPayOpened(alex({ label: 'PayPal', amount: 22 }), NOW + 1000);
    expect(payOpened('alex', SESSION_2, NOW + 2000)).toMatchObject({ label: 'PayPal', amount: 22 });
  });

  it('ignores anything odd saved on the phone', () => {
    for (const saved of ['not json', JSON.stringify({ ...alex(), amount: 0, at: NOW }), JSON.stringify({ ...alex() })]) {
      localStorage.setItem('jt_pay_opened_v1', saved);
      expect(payOpened('alex', SESSION_2, NOW)).toBeNull();
    }
  });

  it('still asks during this visit when the phone blocks storage', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    rememberPayOpened(alex(), NOW);
    expect(payOpened('alex', SESSION_2, NOW)).toMatchObject({ amount: 122 });
    forgetPayOpened();
    expect(payOpened('alex', SESSION_2, NOW)).toBeNull();
  });
});
