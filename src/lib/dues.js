// Dues: the session fee as the league bills it (a league fee plus a ref fee
// for every game), how it splits across the active roster, and the links
// players pay with. The database function public.my_dues() splits the same
// way for a player's own view, so keep the two in step.

export const DUES_DEFAULTS = { league_fee: 595, ref_fee: 18, game_count: 7 };

const num = (value) => Number(value) || 0;
const cents = (value) => Math.round(num(value) * 100);
const fromCents = (value) => value / 100;

/** "$73" or "$40.50". */
export const dollars = (value) => `$${Number.isInteger(num(value)) ? num(value) : num(value).toFixed(2)}`;

/** League fee plus the ref fee for every game. */
export function feeTotal({ league_fee, ref_fee, game_count }) {
  return fromCents(cents(league_fee) + cents(ref_fee) * Math.max(0, Math.floor(num(game_count))));
}

/** A saved session_dues row's fee parts. Rows saved before the breakdown existed only have a total. */
export function feeParts(row) {
  if (row.league_fee == null) return { league_fee: num(row.total_fee), ref_fee: 0, game_count: DUES_DEFAULTS.game_count };
  return { league_fee: num(row.league_fee), ref_fee: num(row.ref_fee), game_count: num(row.game_count) };
}

/**
 * Splits a session's total across the active roster: custom amounts first,
 * then an even share of what's left for everyone else, rounded up to whole
 * dollars. `active` is the active players' user ids, `payments` that
 * session's dues_payments rows.
 */
export function splitDues(total, active, payments) {
  const byUser = new Map(payments.map((p) => [p.user_id, p]));
  const override = (id) => {
    const value = byUser.get(id)?.override_amount;
    return value == null ? null : Number(value);
  };
  const custom = active.filter((id) => override(id) != null);
  const autoCount = active.length - custom.length;
  const left = cents(total) - custom.reduce((sum, id) => sum + cents(override(id)), 0);
  const perPlayer = autoCount ? Math.ceil(Math.max(0, left) / (autoCount * 100)) : 0;

  const players = active.map((id) => {
    const payment = byUser.get(id);
    return {
      user_id: id,
      amount: override(id) ?? perPlayer,
      custom: override(id) != null,
      paid: !!payment?.paid,
      paid_date: payment?.paid_date ?? null,
    };
  });
  const sum = (rows) => fromCents(rows.reduce((s, p) => s + cents(p.amount), 0));
  const owed = sum(players);
  const collected = sum(players.filter((p) => p.paid));
  return {
    perPlayer,
    players,
    owed,
    collected,
    stillOwed: fromCents(cents(owed) - cents(collected)),
    paidCount: players.filter((p) => p.paid).length,
    // Above zero: rounding up collects a little more than the fee. Below: custom amounts leave some uncovered.
    extra: fromCents(cents(owed) - cents(total)),
  };
}

/** "the $595 league fee plus $18 refs × 7 games = $721", or "the $721 session fee" without a ref fee. */
export function feeSentence(parts) {
  const total = feeTotal(parts);
  if (!num(parts.ref_fee) || !num(parts.game_count)) return `the ${dollars(total)} session fee`;
  return `the ${dollars(parts.league_fee)} league fee plus ${dollars(parts.ref_fee)} refs × ${num(parts.game_count)} games = ${dollars(total)}`;
}

/** The note players' payments carry, so the captain can tell what they're for. */
export const payNote = (year, session) => `Jive Turkeys dues · Session ${session} ${year}`;

/** The ways to pay the captains have set up, with the amount filled in where the app allows it. */
export function payOptions(settings, amount, note) {
  const options = [];
  const amountText = dollars(amount).slice(1);
  const venmo = (settings?.pay_venmo || '').trim().replace(/^@/, '');
  if (venmo) {
    const query = `txn=pay&audience=private&amount=${amountText}&note=${encodeURIComponent(note)}`;
    options.push({ key: 'venmo', label: 'Venmo', handle: `@${venmo}`, href: `https://venmo.com/${encodeURIComponent(venmo)}?${query}` });
  }
  const cashtag = (settings?.pay_cashapp || '').trim().replace(/^\$/, '');
  if (cashtag) {
    options.push({ key: 'cashapp', label: 'Cash App', handle: `$${cashtag}`, href: `https://cash.app/$${encodeURIComponent(cashtag)}/${amountText}` });
  }
  const zelle = (settings?.pay_zelle || '').trim();
  if (zelle) options.push({ key: 'zelle', label: 'Zelle', handle: zelle, href: null });
  return options;
}

/** A nudge for the team chat or group text naming who still owes. `unpaid` is [{ name, amount }]. */
export function reminderText({ session, parts, perPlayer, activeCount, unpaid, link }) {
  const names = unpaid.map((p) => (p.amount === perPlayer ? p.name : `${p.name} (${dollars(p.amount)})`));
  return [
    `🦃 Jive Turkeys — Session ${session} dues: ${dollars(perPlayer)} each`,
    `That's ${feeSentence(parts)}, split across ${activeCount} players.`,
    `Still to pay: ${names.join(', ')}`,
    `See your amount and pay: ${link}`,
  ].join('\n');
}

/** The session to open on: the next game's, else the latest game's, else this year's first. */
export function currentSession(games, today) {
  const upcoming = games.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const latest = [...games].sort((a, b) => b.date.localeCompare(a.date))[0];
  const game = upcoming || latest;
  return game ? { year: game.season_year, session: game.session } : { year: Number(today.slice(0, 4)), session: 1 };
}
