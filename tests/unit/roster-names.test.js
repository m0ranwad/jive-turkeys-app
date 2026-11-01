// Names a captain pastes into "Add players to the roster" (src/lib/team-logic.js):
// someone already on the roster, even under a shorter name, mustn't be added
// twice, or they'd be counted twice in the dues.
import { describe, expect, it } from 'vitest';
import { likelyAccount, lookalikeAccounts, nameList, sameName, skippedRosterName, sortPastedNames } from '@/lib/team-logic';

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

describe('likelyAccount', () => {
  // Cory signed up twice; his first account picked "Cory K" and a captain took it off again.
  const cory = { id: 'g1', display_name: 'Cory K' };
  const players = [
    { user_id: 'u1', display_name: 'Cory Kircher' },
    { user_id: 'u2', display_name: 'Cory K.' },
    { user_id: 'u3', display_name: 'Dana Wells' },
  ];

  it('suggests the account with a name like the roster name', () => {
    expect(likelyAccount(cory, players)?.user_id).toBe('u1');
    expect(likelyAccount({ id: 'g2', display_name: 'Mike Russo' }, players)).toBeNull();
  });

  it('skips an account the name was taken off, and one that has another roster name', () => {
    const undone = [{ guest_id: 'g1', user_id: 'u1', unlinked_at: '2026-10-18T12:00:00Z' }];
    expect(likelyAccount(cory, players, [], undone)?.user_id).toBe('u2');
    expect(likelyAccount(cory, players, [{ id: 'g3', linked_user_id: 'u2' }], undone)).toBeNull();
    // A pick that still stands isn't one a captain took off.
    expect(likelyAccount(cory, players, [], [{ guest_id: 'g1', user_id: 'u1', unlinked_at: null }])?.user_id).toBe('u1');
  });
});

describe('lookalikeAccounts', () => {
  const josh = { user_id: 'u1', display_name: 'Josh' };
  const joshA = { user_id: 'u2', display_name: 'Josh A' };
  const joshAllen = { user_id: 'u3', display_name: 'Josh Allen' };
  const joshBernard = { user_id: 'u4', display_name: 'Josh Bernard' };
  const accounts = [josh, joshA, joshAllen, joshBernard];
  const names = (list) => list.map((p) => p.display_name);

  it('finds every account that might be the same person', () => {
    expect(names(lookalikeAccounts(joshA, accounts))).toEqual(['Josh', 'Josh Allen']);
    expect(names(lookalikeAccounts(josh, accounts))).toEqual(['Josh A', 'Josh Allen', 'Josh Bernard']);
    // Two full names that differ are two people.
    expect(names(lookalikeAccounts(joshBernard, accounts))).toEqual(['Josh']);
  });

  it('leaves out two accounts that each picked a roster name', () => {
    const guests = [
      { id: 'g1', linked_user_id: 'u1' },
      { id: 'g2', linked_user_id: 'u3' },
    ];
    expect(names(lookalikeAccounts(josh, accounts, guests))).toEqual(['Josh A', 'Josh Bernard']);
  });

  it('leaves out pairs a captain said are different people, either way round', () => {
    const checks = [{ kind: 'different_people', user_id: 'u2', other_user_id: 'u1' }, { kind: 'not_on_roster', user_id: 'u3' }];
    expect(names(lookalikeAccounts(josh, accounts, [], checks))).toEqual(['Josh Allen', 'Josh Bernard']);
    expect(names(lookalikeAccounts(joshA, accounts, [], checks))).toEqual(['Josh Allen']);
  });

  it('lists names in plain words', () => {
    expect(nameList(['Josh'])).toBe('Josh');
    expect(nameList(['Josh A', 'Josh Allen'])).toBe('Josh A and Josh Allen');
    expect(nameList(['Josh', 'Josh A', 'Josh Allen'])).toBe('Josh, Josh A and Josh Allen');
  });
});

describe('skippedRosterName', () => {
  const guests = [
    { id: 'g1', display_name: 'Bob Smith', removed: false, linked_user_id: null, created_date: '2026-10-10T12:00:00Z' },
    { id: 'g2', display_name: 'Dana Wells', removed: false, linked_user_id: 'u9', created_date: '2026-10-11T12:00:00Z' },
  ];
  const robert = { user_id: 'u1', display_name: 'Robert Smith', created_date: '2026-10-15T12:00:00Z' };
  const early = { user_id: 'u2', display_name: 'Casey Captain', created_date: '2026-10-01T12:00:00Z' };

  it('flags someone who joined without picking a name while names were waiting', () => {
    expect(skippedRosterName(robert, guests)).toBe(true);
  });

  it('not players from before the roster had names, or who have a name, or once a captain answers', () => {
    expect(skippedRosterName(early, guests)).toBe(false);
    expect(skippedRosterName({ ...robert, user_id: 'u9' }, guests)).toBe(false);
    expect(skippedRosterName(robert, guests, [{ kind: 'not_on_roster', user_id: 'u1' }])).toBe(false);
  });

  it('not once every name on the roster has been picked or removed', () => {
    expect(skippedRosterName(robert, [{ ...guests[0], removed: true }, guests[1]])).toBe(false);
    expect(skippedRosterName(robert, [])).toBe(false);
  });
});
