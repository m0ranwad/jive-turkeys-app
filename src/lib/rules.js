// The Field Rules page. Captains type one rule per line; a line ending with a
// colon ("Coed rules:") starts a new section.

export const isRuleHeading = (line) => /:\s*$/.test(line);

/** Coed sections get their own highlighted box. */
export const isCoedHeading = (title) => /\bco-?ed\b/i.test(title);

/** The rules that get a picture beside them. */
export const isThreeLineRule = (rule) => /\b(three|3)[- ]line/i.test(rule);
export const isCardsRule = (rule) => /\bblue cards?\b/i.test(rule);

/**
 * ['Rule', 'Coed rules:', 'Women take all kicks'] ->
 * [{ title: '', rules: ['Rule'], coed: false }, { title: 'Coed rules', rules: ['Women take all kicks'], coed: true }]
 */
export function groupRules(lines = []) {
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = String(raw ?? '').trim();
    if (!line) continue;
    if (isRuleHeading(line)) {
      const title = line.replace(/:\s*$/, '').trim();
      current = { title, rules: [], coed: isCoedHeading(title) };
      sections.push(current);
    } else {
      if (!current) {
        current = { title: '', rules: [], coed: false };
        sections.push(current);
      }
      current.rules.push(line);
    }
  }
  return sections;
}
