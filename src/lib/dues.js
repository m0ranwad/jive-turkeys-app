// Dues: the session fee as the league bills it (a league fee plus a ref fee
// for every game), how it splits across the active roster, couples who pay
// together, and the links players pay with.

import { SESSIONS } from './constants';
import { seasonName, sessionOf, shortName } from './format';

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

/**
 * What's wrong with a fee as typed in the fee box (strings), or null: every box
 * filled in, nothing below $0, and a whole number of games.
 */
export function feeProblem({ league_fee, ref_fee, game_count }) {
  const blank = (value) => String(value ?? '').trim() === '';
  if (blank(league_fee)) return 'Enter the league fee.';
  if (blank(ref_fee)) return 'Enter the ref fee per game (0 if there is none).';
  if (blank(game_count)) return 'Enter the number of games.';
  const values = [league_fee, ref_fee, game_count].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return 'Use numbers only.';
  if (values.some((value) => value < 0)) return "A fee can't be below $0.";
  if (!Number.isInteger(values[2])) return 'Games is a whole number.';
  return null;
}

/** A fee worth a second look before it saves: 'zero', or 'big' for more than double the one before. */
export function feeWarning(total, previous) {
  if (cents(total) === 0) return 'zero';
  if (cents(previous) > 0 && cents(total) > 2 * cents(previous)) return 'big';
  return null;
}

/** A saved session_dues row's fee parts. Rows saved before the breakdown existed only have a total. */
export function feeParts(row) {
  if (row.league_fee == null) return { league_fee: num(row.total_fee), ref_fee: 0, game_count: DUES_DEFAULTS.game_count };
  return { league_fee: num(row.league_fee), ref_fee: num(row.ref_fee), game_count: num(row.game_count) };
}

/** What a payment row says was paid, or null: not paid, or marked paid before amounts were recorded. */
const recordedAmount = (payment) => (payment?.paid && payment.paid_amount != null ? Number(payment.paid_amount) : null);

/**
 * Splits a session's total across the active roster: custom amounts first,
 * then an even share of what's left for everyone else, rounded up to whole
 * dollars. `active` is the active players' user ids, `payments` that
 * session's dues_payments rows.
 *
 * Each player's `paid_amount` is what they paid: the amount recorded when they
 * were marked paid, or their share for payments from before amounts were
 * recorded. If their share has gone up since, `shortBy` is the difference.
 * A share that has gone down leaves what they paid as it is.
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
    const amount = override(id) ?? perPlayer;
    const paid = !!payment?.paid;
    const recorded = recordedAmount(payment);
    return {
      user_id: id,
      amount,
      custom: override(id) != null,
      paid,
      paid_date: payment?.paid_date ?? null,
      paid_amount: paid ? (recorded ?? amount) : null,
      shortBy: recorded == null ? 0 : fromCents(Math.max(0, cents(amount) - cents(recorded))),
    };
  });
  const sum = (rows, key = 'amount') => fromCents(rows.reduce((s, p) => s + cents(p[key]), 0));
  const paid = players.filter((p) => p.paid);
  return {
    perPlayer,
    players,
    owed: sum(players),
    collected: sum(paid, 'paid_amount'),
    // Unpaid shares, plus the difference for anyone whose share went up after they paid.
    stillOwed: fromCents(cents(sum(players.filter((p) => !p.paid))) + cents(sum(paid, 'shortBy'))),
    // Everyone marked paid. teamDues() leaves out anyone who paid only part of their share.
    paidCount: paid.length,
    // Above zero: rounding up collects a little more than the fee. Below: custom amounts leave some uncovered.
    extra: fromCents(cents(sum(players)) - cents(total)),
  };
}

/** "the $595 league fee plus $18 refs × 7 games = $721", or "the $721 session fee" without a ref fee. */
export function feeSentence(parts) {
  const total = feeTotal(parts);
  if (!num(parts.ref_fee) || !num(parts.game_count)) return `the ${dollars(total)} session fee`;
  return `the ${dollars(parts.league_fee)} league fee plus ${dollars(parts.ref_fee)} refs × ${num(parts.game_count)} games = ${dollars(total)}`;
}

/** The note payments carry, so whoever collects can tell who and what they're for. */
export const payNote = (year, session, names = []) =>
  [`Jive Turkeys dues · Session ${session} ${seasonName(year)}`, names.join(' & ')].filter(Boolean).join(' · ');

/** A signed-up player a captain took off the team: off the roster, like a removed roster name. */
export const profileAsPlayer = (p) => (p.removed ? { ...p, status: 'inactive' } : p);

/** A roster player who hasn't joined the app yet, shaped like a player profile (`user_id` is their own id). */
export function guestAsPlayer(g) {
  return {
    id: g.id,
    user_id: g.id,
    display_name: g.display_name,
    gender: g.gender ?? null,
    position: g.position ?? null,
    // Off the roster once removed, or once linked to the account they joined with.
    status: g.removed || g.linked_user_id ? 'inactive' : g.status || 'active',
    pays_with: g.pays_with_user ?? g.pays_with_guest ?? null,
    linked_user_id: g.linked_user_id ?? null,
    removed: !!g.removed,
    guest: true,
  };
}

/**
 * Everyone who splits the dues as one list: app players plus teammates who
 * aren't on the app (guests, flagged `guest`), all keyed by `user_id`.
 * Payments and history rows get the same key, whichever kind of player they
 * belong to. Like everyone else, a guest counts while their roster status is
 * Active.
 */
export function duesMembers({ profiles, guests = [], payments, history, changes = [] }) {
  const members = [
    ...profiles.map((p) => ({ ...p, pays_with: p.pays_with ?? p.pays_with_guest ?? null })),
    ...guests.map(guestAsPlayer),
  ];
  const keyed = (row) => ({ ...row, user_id: row.user_id ?? row.guest_id ?? null });
  return { members, payments: payments.map(keyed), history: history.map(keyed), changes: changes.map(keyed) };
}

const NOT_PLAYING = { on_break: 'unavailable', sub_pool: 'available to sub' };

/** Why someone in `notPlaying` isn't on the session's active roster, in a couple of words. */
export const notPlayingLabel = ({ status, player }) => NOT_PLAYING[status] ?? (player.removed ? 'off the team' : 'not on the roster');

/** "1 owes a top-up": paid players whose share went up after they paid it all. */
export const topUps = (n) => `${n} ${n === 1 ? 'owes' : 'owe'} a top-up`;

/** When a player last marked (some of) their dues paid, from dues_history, or undefined. */
const lastPaidAt = (history, userId) =>
  history.filter((e) => e.user_id === userId && e.paid).map((e) => e.created_date).sort().at(-1);

/**
 * A player's share when they last marked paid, worked out by undoing, newest
 * first, the changes that moved the split since (dues_changes): the session
 * fee, custom amounts, and who was on the active roster. Null when it can't be
 * told: the fee was first set after they paid, or they weren't playing then.
 */
export function shareWhenPaid({ total, activeIds, payments, changes, paidAt, userId }) {
  let fee = total;
  const active = new Set(activeIds);
  const override = new Map(payments.map((p) => [p.user_id, p.override_amount ?? null]));
  const since = changes.filter((c) => c.created_date > paidAt).sort((a, b) => (a.created_date < b.created_date ? 1 : -1));
  for (const change of since) {
    if (change.kind === 'fee') {
      if (!change.old_value) return null;
      fee = num(change.old_value.total_fee);
    } else if (change.kind === 'custom_amount') {
      override.set(change.user_id, change.old_value?.amount ?? null);
    } else if (change.old_value?.status === 'active') {
      active.add(change.user_id);
    } else {
      active.delete(change.user_id);
    }
  }
  if (!active.has(userId)) return null;
  const ids = [...active];
  const split = splitDues(fee, ids, ids.map((id) => ({ user_id: id, override_amount: override.get(id) ?? null })));
  return split.players.find((p) => p.user_id === userId).amount;
}

/**
 * One session's dues for the whole team: the split, active players in list
 * order (by name, couples side by side), who pays with whom, and who still owes.
 * `profiles` is the session's roster, `payments` that session's dues_payments
 * rows. `everyone` is every player and roster name (the session's roster by
 * default), to find who paid and isn't on the active roster (`notPlaying`):
 * they don't owe anything, and what they paid counts in `collected`.
 * `history` and `changes` (that session's dues_history and dues_changes) tell
 * someone who paid part of their share from someone whose share went up after
 * they paid it all (`stateOf()`).
 */
export function teamDues(total, profiles, payments, everyone = profiles, { history = [], changes = [] } = {}) {
  const name = (p) => p.display_name || '';
  const active = profiles.filter((p) => p.status === 'active');
  const byUser = new Map(active.map((p) => [p.user_id, p]));
  // Couples count only while both are on the active roster, each paying with the other.
  const partners = new Map(
    active
      .filter((p) => p.pays_with && p.pays_with !== p.user_id && byUser.get(p.pays_with)?.pays_with === p.user_id)
      .map((p) => [p.user_id, p.pays_with]),
  );
  const groupName = (p) => {
    const partner = byUser.get(partners.get(p.user_id));
    return partner && name(partner).localeCompare(name(p)) < 0 ? name(partner) : name(p);
  };
  const ordered = [...active].sort((a, b) => groupName(a).localeCompare(groupName(b)) || name(a).localeCompare(name(b)));

  const split = splitDues(total, ordered.map((p) => p.user_id), payments);
  const shares = new Map(split.players.map((s) => [s.user_id, s]));
  const shareOf = (userId) => shares.get(userId) || null;
  const partnerOf = (userId) => byUser.get(partners.get(userId)) || null;

  // What a player still owes: their share, or the difference if it went up after they paid.
  const owing = (userId) => !shareOf(userId).paid || shareOf(userId).shortBy > 0;
  const due = (userId) => (shareOf(userId).paid ? shareOf(userId).shortBy : shareOf(userId).amount);
  // The difference for a player and their partner together, since a couple pays as one.
  const balanceOf = (userId) => {
    const partner = partnerOf(userId);
    return fromCents(cents(shareOf(userId).shortBy) + (partner ? cents(shareOf(partner.user_id).shortBy) : 0));
  };
  // What a player and their partner still owe, each: [{ user_id, due }].
  const owingTogether = (userId) =>
    [userId, partnerOf(userId)?.user_id].filter(Boolean).map((id) => ({ user_id: id, due: shareOf(id) ? due(id) : 0 }));

  // 'paid', 'unpaid', or for someone paid who still owes: 'topUp' (they paid their
  // whole share and it went up since) or 'part' (they paid less than it was then).
  // When their share then can't be told, it counts as a top-up.
  const activeIds = ordered.map((p) => p.user_id);
  const states = new Map(
    split.players.map((s) => {
      if (!s.paid) return [s.user_id, 'unpaid'];
      if (s.shortBy === 0) return [s.user_id, 'paid'];
      const paidAt = lastPaidAt(history, s.user_id);
      const then = paidAt ? shareWhenPaid({ total, activeIds, payments, changes, paidAt, userId: s.user_id }) : null;
      return [s.user_id, then == null || cents(s.paid_amount) >= cents(then) ? 'topUp' : 'part'];
    }),
  );
  const stateOf = (userId) => states.get(userId) ?? null;
  const count = (state) => [...states.values()].filter((s) => s === state).length;

  // Who still owes, with a couple who both still owe as one line and one amount.
  const stillToPay = [];
  // The players on each stillToPay line, for naming them in Team Chat.
  const owingPeople = [];
  const listed = new Set();
  for (const p of ordered) {
    if (listed.has(p.user_id) || !owing(p.user_id)) continue;
    const partner = partnerOf(p.user_id);
    const together = partner && owing(partner.user_id) ? partner : null;
    listed.add(p.user_id);
    if (together) listed.add(together.user_id);
    owingPeople.push(together ? [p, together] : [p]);
    stillToPay.push({
      name: together ? `${name(p)} & ${name(together)}` : name(p),
      amount: fromCents(cents(due(p.user_id)) + (together ? cents(due(together.user_id)) : 0)),
      // Only the difference after their share went up.
      more: shareOf(p.user_id).paid && (!together || shareOf(together.user_id).paid),
    });
  }

  // Paid for the session, but not on its active roster (unavailable, available to sub, taken off the team).
  const session = new Map(profiles.map((p) => [p.user_id, p]));
  const people = new Map(everyone.map((p) => [p.user_id, p]));
  const notPlaying = payments
    .filter((p) => p.paid && !byUser.has(p.user_id))
    .flatMap((payment) => {
      const player = session.get(payment.user_id) || people.get(payment.user_id);
      // A roster name that has joined: its payments moved to their account, so any left are repeats.
      if (!player || (player.guest && player.linked_user_id)) return [];
      return [{
        user_id: payment.user_id,
        player,
        status: session.get(payment.user_id)?.status ?? 'off',
        paid_amount: recordedAmount(payment),
        paid_date: payment.paid_date ?? null,
      }];
    })
    .sort((a, b) => name(a.player).localeCompare(name(b.player)));
  const notPlayingPaid = fromCents(notPlaying.reduce((sum, p) => sum + cents(p.paid_amount), 0));
  const notPlayingOf = (userId) => notPlaying.find((p) => p.user_id === userId) || null;

  return {
    ...split,
    collected: fromCents(cents(split.collected) + cents(notPlayingPaid)),
    // Paid, counting anyone who owes only a top-up; not anyone who paid part of it.
    paidCount: count('paid') + count('topUp'),
    topUpCount: count('topUp'),
    active: ordered,
    shareOf,
    stateOf,
    partnerOf,
    balanceOf,
    owingTogether,
    stillToPay,
    owingPeople,
    notPlaying,
    notPlayingPaid,
    notPlayingOf,
  };
}

const ROSTER_LABEL = { active: 'playing', on_break: 'unavailable', sub_pool: 'available to sub' };

/**
 * One line for a change that moves the split (dues_changes): the session fee,
 * a custom amount, or someone coming onto or off the session's active roster.
 * "Casey C. changed the session fee: $721 → $735 (refs $18 → $20)".
 */
export function changeLine(change, nameOf, meId) {
  const name = (id) => (id === meId ? 'you' : shortName(nameOf(id)));
  const actor = !change.changed_by ? 'Someone' : change.changed_by === meId ? 'You' : shortName(nameOf(change.changed_by));
  const before = change.old_value;
  const after = change.new_value;

  if (change.kind === 'fee') {
    const now = feeParts(after);
    if (!before) return `${actor} set the session fee: ${dollars(feeTotal(now))}`;
    const was = feeParts(before);
    const what = [
      num(was.league_fee) !== num(now.league_fee) && `league ${dollars(was.league_fee)} → ${dollars(now.league_fee)}`,
      num(was.ref_fee) !== num(now.ref_fee) && `refs ${dollars(was.ref_fee)} → ${dollars(now.ref_fee)}`,
      num(was.game_count) !== num(now.game_count) && `${num(was.game_count)} → ${num(now.game_count)} games`,
    ].filter(Boolean);
    return `${actor} changed the session fee: ${dollars(feeTotal(was))} → ${dollars(feeTotal(now))}${what.length ? ` (${what.join(', ')})` : ''}`;
  }

  const self = change.user_id === change.changed_by;
  if (change.kind === 'custom_amount') {
    const who = self ? (actor === 'You' ? 'yourself' : 'themselves') : name(change.user_id);
    const whose = self ? (actor === 'You' ? 'your' : 'their') : change.user_id === meId ? 'your' : `${who}'s`;
    if (!before) return `${actor} gave ${who} a custom amount of ${dollars(after.amount)}`;
    if (!after) return `${actor} put ${who} back on the even split`;
    return `${actor} changed ${whose} custom amount: ${dollars(before.amount)} → ${dollars(after.amount)}`;
  }

  // Someone coming onto or off the session's active roster.
  const status = after?.status;
  if (status === 'off' || !ROSTER_LABEL[status]) return `${actor} took ${name(change.user_id)} off the roster`;
  if (self || !change.changed_by) {
    return change.user_id === meId ? `You're ${ROSTER_LABEL[status]}` : `${shortName(nameOf(change.user_id))} is ${ROSTER_LABEL[status]}`;
  }
  const who = name(change.user_id);
  return `${actor} marked ${who} as ${ROSTER_LABEL[status]}`;
}

/** Paid / not paid history and the changes that move the split, as one list, newest first. */
export const duesEvents = (history, changes = []) =>
  [...history, ...changes].sort((a, b) => (a.created_date < b.created_date ? 1 : a.created_date > b.created_date ? -1 : 0));

/**
 * The changes behind "share is now $62": the ones made after a player last
 * marked paid that can move their share. A custom amount only moves with its
 * own changes; an even share moves with the fee, the roster and anyone's
 * custom amount.
 */
export function shareChanges(changes, history, userId, custom) {
  const paidAt = lastPaidAt(history, userId);
  if (!paidAt) return [];
  return changes
    .filter((c) => c.created_date > paidAt)
    .filter((c) => (custom ? c.kind === 'custom_amount' && c.user_id === userId : true))
    .sort((a, b) => (a.created_date < b.created_date ? 1 : -1));
}

/**
 * Splits money that came in between people by what each still owes, in cents:
 * a couple's $80 toward $61 + $61 is $40 each. `owing` is [{ user_id, due }];
 * nobody gets more than they owe, and anyone who owes nothing is left out.
 */
export function splitPayment(amount, owing) {
  const parts = owing.filter((p) => cents(p.due) > 0);
  const total = parts.reduce((sum, p) => sum + cents(p.due), 0);
  let left = Math.min(cents(amount), total);
  const whole = left;
  return parts.map((p, i) => {
    const part = Math.min(cents(p.due), left, i === parts.length - 1 ? left : Math.round((whole * cents(p.due)) / total));
    left -= part;
    return { user_id: p.user_id, amount: fromCents(part) };
  });
}

/**
 * Part of what a player (and their partner) owe came in: what to mark paid.
 * Each one's new total is what they'd paid so far plus their part of `amount`.
 * Returns { userIds, amounts } for api.dues.markPaid().
 */
export function partPayment(team, userId, amount) {
  const parts = splitPayment(amount, team.owingTogether(userId));
  return {
    userIds: parts.map((p) => p.user_id),
    amounts: parts.map((p) => {
      const share = team.shareOf(p.user_id);
      return fromCents(cents(share.paid ? share.paid_amount : 0) + cents(p.amount));
    }),
  };
}

/**
 * Tidies what a captain types or pastes for each way to pay: a name, an
 * @handle or $cashtag, or a profile link. Venmo and Cash App keep the name;
 * PayPal keeps a PayPal.Me name, or any other PayPal link as it is (like the
 * one a PayPal QR code opens).
 */
export function cleanPayHandle(kind, value) {
  const text = (value || '').trim();
  if (!text) return '';
  const fromLink = (pattern) => text.match(pattern)?.[1];
  if (kind === 'venmo') return (fromLink(/venmo\.com\/(?:u\/)?([^/?#\s]+)/i) || text).replace(/^@/, '');
  if (kind === 'cashapp') return (fromLink(/cash\.app\/\$?([^/?#\s]+)/i) || text).replace(/^\$/, '');
  if (kind === 'paypal') {
    const name = fromLink(/paypal\.me\/([^/?#\s]+)/i) || fromLink(/paypal\.com\/paypalme\/([^/?#\s]+)/i);
    if (name) return name;
    if (/^https?:\/\//i.test(text) || /paypal\.com\//i.test(text)) return /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return text.replace(/^@/, '');
  }
  return text;
}

/**
 * The ways to pay the captains have set up. Venmo, PayPal.Me and Cash App
 * links open with the amount filled in (`prefilled`); a plain PayPal link
 * opens the payee's PayPal and the player types the amount.
 */
export function payOptions(settings, amount, note) {
  const options = [];
  const amountText = dollars(amount).slice(1);
  const venmo = cleanPayHandle('venmo', settings?.pay_venmo);
  if (venmo) {
    const query = `txn=pay&audience=private&amount=${amountText}&note=${encodeURIComponent(note)}`;
    options.push({
      key: 'venmo',
      label: 'Venmo',
      handle: `@${venmo}`,
      href: `https://venmo.com/${encodeURIComponent(venmo)}?${query}`,
      prefilled: true,
    });
  }
  const paypal = cleanPayHandle('paypal', settings?.pay_paypal);
  if (paypal) {
    const link = /^https?:\/\//i.test(paypal);
    options.push({
      key: 'paypal',
      label: 'PayPal',
      handle: link ? 'PayPal' : `paypal.me/${paypal}`,
      href: link ? paypal : `https://paypal.me/${encodeURIComponent(paypal)}/${amountText}`,
      prefilled: !link,
    });
  }
  const cashtag = cleanPayHandle('cashapp', settings?.pay_cashapp);
  if (cashtag) {
    options.push({
      key: 'cashapp',
      label: 'Cash App',
      handle: `$${cashtag}`,
      href: `https://cash.app/$${encodeURIComponent(cashtag)}/${amountText}`,
      prefilled: true,
    });
  }
  const zelle = (settings?.pay_zelle || '').trim();
  if (zelle) options.push({ key: 'zelle', label: 'Zelle', handle: zelle, href: null, prefilled: false });
  return options;
}

/**
 * A nudge for Team Chat naming who still owes. `unpaid` is [{ name, people,
 * amount, more }], `more` for the difference after a share went up. `nameOf`
 * names each of `people` (a chat @mention, so their phones buzz); without
 * `people`, `name` is used.
 */
export function reminderText({ session, parts, perPlayer, activeCount, unpaid, link, nameOf = null }) {
  const names = unpaid.map((p) => {
    const who = nameOf && p.people ? p.people.map(nameOf).join(' & ') : p.name;
    if (p.more) return `${who} (${dollars(p.amount)} more)`;
    return p.amount === perPlayer ? who : `${who} (${dollars(p.amount)})`;
  });
  return [
    `🦃 Jive Turkeys — Session ${session} dues: ${dollars(perPlayer)} each`,
    `That's ${feeSentence(parts)}, split across ${activeCount} players.`,
    `Still to pay: ${names.join(', ')}`,
    `See your amount and pay: ${link}`,
  ].join('\n');
}

/**
 * The current session: the next game's; between sessions, the earliest later
 * session captains asked about ("Playing session N?" before its schedule is
 * out, `asks` are session_asks rows); else the latest game's; else, with no
 * games at all, the session today is in (sessionOf()). Same as the database's
 * roster_current_session().
 */
export function currentSession(games, today, asks = []) {
  const upcoming = games.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (upcoming) return { year: upcoming.season_year, session: upcoming.session };
  const latest = [...games].sort((a, b) => b.date.localeCompare(a.date))[0];
  const later = (a) =>
    !latest || a.season_year > latest.season_year || (a.season_year === latest.season_year && a.session > latest.session);
  const asked = asks
    .filter((a) => a.starts_on && later(a))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.season_year - b.season_year || a.session - b.session)[0];
  if (asked) return { year: asked.season_year, session: asked.session };
  return latest ? { year: latest.season_year, session: latest.session } : sessionOf(today);
}

/**
 * The session status changes count for: the current session, unless it's over
 * (its games have all been played, nothing else is on the schedule and captains
 * haven't asked about the next one), then null. A session that's over keeps its
 * list; the next one starts from everyone's status. Same as the database's
 * roster_open_session().
 */
export function openSession(games, today, asks = []) {
  const cur = currentSession(games, today, asks);
  const over =
    games.some((g) => Number(g.season_year) === Number(cur.year) && Number(g.session) === Number(cur.session)) &&
    !games.some((g) => g.date >= today);
  return over ? null : cur;
}

/** The session before (-1) or after (+1) this one. */
export function stepSession({ year, session }, delta) {
  const perYear = SESSIONS.length;
  const index = Number(year) * perYear + (Number(session) - 1) + delta;
  return { year: Math.floor(index / perYear), session: (index % perYear) + 1 };
}
