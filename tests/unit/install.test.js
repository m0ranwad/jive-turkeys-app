// Telling phones apart, for the right "Add to Home Screen" steps.
import { describe, expect, it } from 'vitest';
import { phoneKind } from '@/lib/install';

describe('phoneKind', () => {
  it('recognizes iPhones and iPads, including iPads that say they are Macs', () => {
    expect(
      phoneKind({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }),
    ).toBe('ios');
    expect(phoneKind({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 })).toBe(
      'ios',
    );
    expect(
      phoneKind({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe('ios');
  });

  it('recognizes Android', () => {
    expect(
      phoneKind({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130 Mobile',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe('android');
  });

  it('treats computers as not phones', () => {
    expect(
      phoneKind({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBeNull();
    expect(
      phoneKind({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', platform: 'Win32', maxTouchPoints: 0 }),
    ).toBeNull();
  });
});
