// Names a captain pastes into "Add players to the roster" (src/lib/team-logic.js):
// someone already on the roster, even under a shorter name, mustn't be added
// twice, or they'd be counted twice in the dues.
import { describe, expect, it } from 'vitest';
import { sameName, sortPastedNames } from '@/lib/team-logic';

describe('sameName', () => {
  it('matches a short last name or a first name alone', () => {
    expect(sameName('Brian Kircher', 'Brian K.')).toBe(true);
    expect(sameName('brian k', 'Brian Kircher')).toBe(true);
    expect(sameName('Brian', 'Brian Kircher')).toBe(true);
    expect(sameName('Brian Kircher', 'brian')).toBe(true);
    expect(sameName('Mary Ann Lee', 'Mary Ann Lee')).toBe(true);
    // A player who adds their last name when they join.
    expect(sameName('Sam Ortiz', 'Sam O')).toBe(true);
  });

  it('keeps different people apart', () => {
    expect(sameName('Brian Kircher', 'Brian Smith')).toBe(false);
    expect(sameName('Brian Kircher', 'Brian S.')).toBe(false);
    expect(sameName('Brian Kircher', 'Bryan Kircher')).toBe(false);
    expect(sameName('Kim Kircher', 'Brian Kircher')).toBe(false);
    expect(sameName('Brian Kirk', 'Brian Kircher')).toBe(false);
    expect(sameName('', 'Brian')).toBe(false);
    expect(sameName('Sam Adams', 'Sam B')).toBe(false);
    expect(sameName('Sam A', 'Sam B')).toBe(false);
  });
});

describe('sortPastedNames', () => {
  const roster = ['Brian K.', 'Dana Wells', 'Sam'];

  it('sorts new names, ones already on the roster, look-alikes and ones too long', () => {
    const long = 'A'.repeat(61);
    const text = ['Mike Russo', '  dana   wells ', 'Brian Kircher', 'Sam Patel', long, 'Rosa Diaz'].join('\n');
    expect(sortPastedNames(text, roster)).toEqual({
      fresh: ['Mike Russo', 'Rosa Diaz'],
      existing: ['dana wells'],
      lookalike: [
        { name: 'Brian Kircher', like: 'Brian K.' },
        { name: 'Sam Patel', like: 'Sam' },
      ],
      tooLong: [long],
    });
  });

  it('drops blank lines and repeats, keeps the spacing tidy, and allows 60 letters', () => {
    const sixty = 'B'.repeat(60);
    expect(sortPastedNames('\nMike  Russo\n\nmike russo\r\n' + sixty + '\n', []).fresh).toEqual(['Mike Russo', sixty]);
    expect(sortPastedNames('', roster)).toEqual({ fresh: [], existing: [], lookalike: [], tooLong: [] });
  });
});
