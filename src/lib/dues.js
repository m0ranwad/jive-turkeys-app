// Dues: the session fee as the league bills it (a league fee plus a ref fee
// for every game), how it splits across the active roster, couples who pay
// together, and the links players pay with.

import { SESSIONS } from './constants';

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

/** The note payments carry, so whoever collects can tell who and what they're for. */
export const payNote = (year, session, names = []) =>
  [`Jive Turkeys dues · Session ${session} ${year}`, names.join(' & ')].filter(Boolean).join(' · ');

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
export function duesMembers({ profiles, guests = [], payments, history }) {
  const members = [
    ...profiles.map((p) => ({ ...p, pays_with: p.pays_with ?? p.pays_with_guest ?? null })),
    ...guests.map(guestAsPlayer),
  ];
  const keyed = (row) => ({ ...row, user_id: row.user_id ?? row.guest_id });
  return { members, payments: payments.map(keyed), history: history.map(keyed) };
}

/**
 * One session's dues for the whole team: the split, active players in list
 * order (by name, couples side by side), who pays with whom, and who still owes.
 * `profiles` is the whole roster, `payments` that session's dues_payments rows.
 */
export function teamDues(total, profiles, payments) {
  const name = (p) => p.display_name || '';
  const active = profiles.filter((p) => p.status === 'active');
  const byUser = new Map(active.map((p) => [p.user_id, p]));
  // Couples count only while both are on the active roster.
  const partners = new Map(
    active.filter((p) => p.pays_with && p.pays_with !== p.user_id && byUser.has(p.pays_with)).map((p) => [p.user_id, p.pays_with]),
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

  // Who still owes, with a couple who both still owe as one line and one amount.
  const stillToPay = [];
  const listed = new Set();
  for (const p of ordered) {
    if (listed.has(p.user_id) || shareOf(p.user_id).paid) continue;
    const partner = partnerOf(p.user_id);
    const together = partner && !shareOf(partner.user_id).paid ? partner : null;
    listed.add(p.user_id);
    if (together) listed.add(together.user_id);
    stillToPay.push({
      name: together ? `${name(p)} & ${name(together)}` : name(p),
      amount: fromCents(cents(shareOf(p.user_id).amount) + (together ? cents(shareOf(together.user_id).amount) : 0)),
    });
  }

  return { ...split, active: ordered, shareOf, partnerOf, stillToPay };
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

/** The session before (-1) or after (+1) this one. */
export function stepSession({ year, session }, delta) {
  const perYear = SESSIONS.length;
  const index = Number(year) * perYear + (Number(session) - 1) + delta;
  return { year: Math.floor(index / perYear), session: (index % perYear) + 1 };
}
