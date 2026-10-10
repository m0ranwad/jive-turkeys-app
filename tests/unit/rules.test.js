// The Field Rules page sorts the captains' rule list into sections.
import { describe, expect, it } from 'vitest';
import { groupRules, isCardsRule, isThreeLineRule } from '@/lib/rules';

describe('groupRules', () => {
  it('starts a section at each line ending with a colon', () => {
    expect(groupRules(['Before you play:', 'Waiver on file.', 'Shin guards.', 'Coed rules:', 'Women take all kicks.'])).toEqual([
      { title: 'Before you play', rules: ['Waiver on file.', 'Shin guards.'], coed: false },
      { title: 'Coed rules', rules: ['Women take all kicks.'], coed: true },
    ]);
  });

  it('keeps rules before the first heading in an untitled section', () => {
    expect(groupRules(['Offside rules do not apply.', 'Coed:', 'Two-goal limit per male.'])).toEqual([
      { title: '', rules: ['Offside rules do not apply.'], coed: false },
      { title: 'Coed', rules: ['Two-goal limit per male.'], coed: true },
    ]);
  });

  it('treats a list without headings as one untitled section', () => {
    expect(groupRules(['One.', '  Two.  ', ''])).toEqual([{ title: '', rules: ['One.', 'Two.'], coed: false }]);
  });

  it('handles an empty or missing list', () => {
    expect(groupRules([])).toEqual([]);
    expect(groupRules()).toEqual([]);
  });

  it('only treats a colon at the end as a heading', () => {
    const rule = 'Cards: An offending player is sent off for two minutes.';
    expect(groupRules([rule])).toEqual([{ title: '', rules: [rule], coed: false }]);
  });

  it('highlights the coed section the live rules already have, before anyone re-sorts them', () => {
    const [, coed] = groupRules([
      'Offside rules do not apply.',
      'Coed division rules are the same as all other age groups with these exceptions:',
      'Two-goal limit per male.',
    ]);
    expect(coed).toMatchObject({ coed: true, rules: ['Two-goal limit per male.'] });
    expect(groupRules(['Co-ed extras:', 'x'])[0].coed).toBe(true);
    expect(groupRules(['Recorded fouls:', 'x'])[0].coed).toBe(false);
  });
});

describe('rules that get a picture', () => {
  it('spots the three-line rule and the cards rule', () => {
    expect(isThreeLineRule('Three-line violations occur when a ball is played in the air over all three lines.')).toBe(true);
    expect(isThreeLineRule('3 line violation: restart for the other team.')).toBe(true);
    expect(isThreeLineRule('Out-of-bounds balls are brought back into play at the point they went out.')).toBe(false);
    expect(isCardsRule('Three blue cards on the same player result in a red card.')).toBe(true);
    expect(isCardsRule('Slide tackling may result in a red card.')).toBe(false);
  });
});
