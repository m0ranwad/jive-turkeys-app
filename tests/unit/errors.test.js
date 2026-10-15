// What players and captains are told when a save doesn't go through.
import { describe, expect, it } from 'vitest';
import { friendlyError, saveFailedToast } from '@/lib/errors';

describe('save errors', () => {
  it('say "no connection" for a dropped connection, in any browser', () => {
    for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
      expect(friendlyError(new TypeError(message))).toBe('No connection. Check your signal and try again.');
    }
  });

  it('say to refresh when the sign-in expired', () => {
    expect(friendlyError(new Error('JWT expired'))).toBe('Your sign-in expired. Refresh the page and try again.');
  });

  it("pass along anything else, and are titled \"That didn't save\"", () => {
    expect(saveFailedToast(new Error('Only captains can enter results'))).toEqual({
      title: "That didn't save",
      description: 'Only captains can enter results',
    });
    expect(friendlyError(null)).toBe('Something went wrong. Try again.');
  });
});
