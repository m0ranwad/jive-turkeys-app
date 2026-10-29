// Demo backend: same interface as the Supabase backend, with sample data kept
// in this browser's localStorage. Used when no Supabase keys are configured,
// so the app can be tried (and developed) before the real backend exists.
import dayjs from 'dayjs';
import { canManageRoom } from '@/lib/chat';
import { currentSession, openSession } from '@/lib/dues';
import { isEarlier } from '@/lib/roster';
import { seasonOf, today } from '@/lib/format';
import { JOIN_ERRORS } from '@/lib/team-code';
import { TABLES, parseSort } from './tables';

const DB_KEY = 'jt_demo_db_v28';
// The team code new accounts enter in the preview.
export const DEMO_TEAM_CODE = 'TURKEY';
const SESSION_KEY = 'jt_demo_session';
// Set when someone signs out of the demo, so it stops signing them back in.
const SIGNED_OUT_KEY = 'jt_demo_signed_out';
export const DEMO_LOGIN = { email: 'captain@demo.test', password: 'demo1234' };
// Jordan Rivera, a regular player in the sample data.
export const DEMO_PLAYER_LOGIN = { email: 'jordan@demo.test', password: 'demo1234' };

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function seed() {
  const captainId = uid();
  const people = [
    ['Casey Captain', 'M', 'Mid-Field', 2015],
    ['Jordan Rivera', 'F', 'Forward', 2016],
    ['Sam Okafor', 'M', 'Defense', 2018],
    ['Priya Shah', 'F', 'Mid-Field', 2019],
    ['Alex Chen', 'M', 'Forward', 2017],
    ['Morgan Lee', 'F', 'Defense', 2021],
    ['Taylor Brooks', 'M', 'Goalie', 2015],
    ['Riley Novak', 'F', null, 2022],
    ['Drew Patel', 'M', 'Defense', 2020],
    ['Jamie Fox', 'F', 'Forward', 2023],
    ['Chris Dunn', 'M', null, 2024],
    ['Kelly Moss', 'F', 'Mid-Field', 2018],
  ];
  const users = people.map(([name], i) => ({
    id: i === 0 ? captainId : uid(),
    email: i === 0 ? DEMO_LOGIN.email : `${name.split(' ')[0].toLowerCase()}@demo.test`,
    password: i === 0 ? DEMO_LOGIN.password : 'demo1234',
    full_name: name,
    // Casey and Priya are the captains.
    role: i === 0 || i === 3 ? 'admin' : 'user',
    joined_team_at: now(),
  }));
  // Signed up but hasn't entered the team code, so the preview can show that step.
  users.push({ id: uid(), email: 'nia@demo.test', password: 'demo1234', full_name: 'Nia Newcomer', role: 'user', joined_team_at: null });
  const statuses = ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'sub_pool', 'on_break', 'active', 'active'];
  const profiles = people.map(([name, gender, position, year], i) => ({
    id: uid(),
    user_id: users[i].id,
    email: users[i].email,
    display_name: name,
    gender,
    phone: i % 3 === 0 ? '(555) 555-01' + String(10 + i) : '',
    position,
    year_joined: year,
    status: statuses[i],
    is_captain: i === 0 || i === 3,
    // On the site before the captains put names on the roster, except Chris, who joined this
    // session without picking a name, and Kelly, who picked "Kelly M" when she joined after him.
    created_date: dayjs().subtract(i === 10 ? 10 : i === 11 ? 5 : 60, 'day').toISOString(),
    updated_date: now(),
  }));

  const opponents = ['Net Ninjas', 'Grass Kickers', 'Ball Busters', 'The Hat Tricks', 'Goal Diggers', 'FC Lightning'];
  // This season (2026 for 2026–27), so January to April samples land in the season that started in November.
  const year = seasonOf(today());
  const games = [];
  for (let i = -4; i <= 3; i += 1) {
    const date = dayjs().add(i * 7 + (i < 0 ? 0 : 2), 'day').format('YYYY-MM-DD');
    const played = i < 0;
    const us = played ? [3, 1, 4, 2][i + 4] : null;
    const them = played ? [2, 1, 1, 5][i + 4] : null;
    games.push({
      id: uid(),
      season_year: year,
      session: played ? 1 : 2,
      date,
      time: ['19:00', '20:10', '21:20', '18:45'][(i + 4) % 4],
      field_number: String(((i + 4) % 3) + 1),
      opponent: opponents[(i + 4) % opponents.length],
      location: 'North Coast Premier Soccer Complex, 8809 Lake Rd, Seville, OH',
      jersey: i % 2 ? 'backup' : 'primary',
      notes: i === 1 ? 'Playoff seeding game — bring both jerseys.' : '',
      has_result: played,
      score_us: us,
      score_them: them,
      created_date: now(),
      updated_date: now(),
    });
  }
  // A game from last season's session 3 (in April) so the stats pages have history.
  games.push({
    id: uid(), season_year: year - 1, session: 3, date: `${year}-04-11`, time: '19:00', field_number: '2',
    opponent: 'Net Ninjas', location: '', jersey: 'primary', notes: '', has_result: true, score_us: 2, score_them: 2,
    created_date: now(), updated_date: now(),
  });

  const stats = [];
  const votes = [];
  games.filter((g) => g.has_result).forEach((g, gi) => {
    let goalsLeft = g.score_us;
    profiles.slice(0, 10).forEach((p, pi) => {
      if ((pi + gi) % 5 === 4) return;
      // Men are capped at 2 goals a game under league rules.
      const goals = goalsLeft > 0 && (pi + gi) % 3 === 0 ? Math.min(goalsLeft, 2) : 0;
      goalsLeft -= goals;
      stats.push({
        id: uid(), game_id: g.id, user_id: p.user_id, played: true, goals,
        assists: (pi + gi) % 4 === 1 ? 1 : 0, blue_cards: pi === 2 && gi === 1 ? 1 : 0, red_cards: 0,
        created_date: now(), updated_date: now(),
      });
    });
    const man = profiles[(gi * 2) % 10].gender === 'M' ? profiles[(gi * 2) % 10] : profiles[0];
    const woman = profiles[1 + ((gi * 2) % 10)].gender === 'F' ? profiles[1 + ((gi * 2) % 10)] : profiles[1];
    [profiles[3], profiles[5], profiles[7]].forEach((voter) => {
      if (voter.user_id !== man.user_id) votes.push({ id: uid(), game_id: g.id, voter_id: voter.user_id, voted_for_id: man.user_id, award: 'man', created_date: now(), updated_date: now() });
    });
    [profiles[0], profiles[2]].forEach((voter) => {
      if (voter.user_id !== woman.user_id) votes.push({ id: uid(), game_id: g.id, voter_id: voter.user_id, voted_for_id: woman.user_id, award: 'woman', created_date: now(), updated_date: now() });
    });
  });

  // Player of the Match voting: last week's result went up 3 hours ago and voting
  // is still open; earlier games' voting has closed. Last year's game is from
  // before voting had a deadline.
  games
    .filter((g) => g.has_result && g.season_year === year)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach((g, i) => {
      const opened = i === 0 ? dayjs().subtract(3, 'hour') : dayjs(g.date).hour(22);
      Object.assign(g, { potm_opened_at: opened.toISOString(), potm_closes_at: opened.add(12, 'hour').toISOString() });
    });

  const next = games.find((g) => !g.has_result);
  const rsvps = profiles.slice(1, 9).map((p, i) => ({
    id: uid(), game_id: next.id, user_id: p.user_id, status: ['in', 'in', 'maybe', 'in', 'out', 'in', 'in', 'maybe'][i],
    playing_gk: p.position === 'Goalie', created_date: now(), updated_date: now(),
  }));

  const minutesAgo = (m) => dayjs().subtract(m, 'minute').toISOString();
  const me = profiles[0];

  // Chat: the main Team Chat (no thread) plus a few side threads, with replies,
  // reactions and read markers so unread badges show up in the preview.
  const threads = [];
  const messages = [];
  const reactions = [];
  const reads = [];
  const members = [];
  const thread = (starter, title, ago, extra = {}) => {
    const row = { id: uid(), title, created_by: starter.user_id, author_name: starter.display_name, archived: false, visibility: 'team', named: true, created_date: minutesAgo(ago), updated_date: minutesAgo(ago), ...extra };
    threads.push(row);
    return row.id;
  };
  const privateChat = (starter, title, ago, people, extra = {}) => {
    const id = thread(starter, title, ago + 1, { visibility: 'private', ...extra });
    people.forEach((p) =>
      members.push({ id: uid(), thread_id: id, user_id: p.user_id, added_by: starter.user_id, created_date: minutesAgo(ago + 1), updated_date: minutesAgo(ago + 1) }),
    );
    return id;
  };
  const say = (threadId, p, body, ago, replyTo = null, extra = {}) => {
    const row = { id: uid(), thread_id: threadId, reply_to_id: replyTo, user_id: p.user_id, author_name: p.display_name, body, created_date: minutesAgo(ago), updated_date: minutesAgo(ago), ...extra };
    messages.push(row);
    return row.id;
  };
  const react = (messageId, emoji, people) =>
    people.forEach((p) => reactions.push({ id: uid(), message_id: messageId, user_id: p.user_id, emoji, created_date: now(), updated_date: now() }));
  const readUpTo = (threadId, ago) =>
    reads.push({ id: uid(), user_id: me.user_id, thread_id: threadId, last_read_at: minutesAgo(ago), created_date: now(), updated_date: now() });

  const win = say(null, profiles[1], 'Great win last night! That second-half comeback 🔥', 1560);
  react(win, '🔥', [profiles[2], profiles[3], me]);
  react(win, '💪', [profiles[4]]);
  say(null, profiles[2], 'Defense was locked in', 1556);
  // What the site posts when Player of the Match voting closes (potm_tick() in the database).
  const potmGame = games.filter((g) => g.has_result && g.season_year === year).sort((a, b) => (a.date < b.date ? 1 : -1))[1];
  const firstOf = (gender) => profiles.slice(2).find((p) => p.gender === gender).display_name;
  messages.push({
    id: uid(), thread_id: null, reply_to_id: null, user_id: null, author_name: 'Scoreboard',
    body: `🏆 Player of the Match, ${potmGame.score_us}–${potmGame.score_them} W vs ${potmGame.opponent}\nMan of the Match: ${firstOf('M')} (3 votes)\nWoman of the Match: ${firstOf('F')} (2 votes)`,
    created_date: minutesAgo(1540), updated_date: minutesAgo(1540),
  });
  const bottle = say(null, profiles[2], 'Also, who grabbed my water bottle? Blue Hydro Flask', 1555);
  say(null, profiles[3], 'I have it! Bringing it Thursday', 1500, bottle);
  const pinnies = say(null, profiles[1], 'Who is bringing the pinnies this week?', 180);
  react(say(null, profiles[4], 'I got them 👍', 170, pinnies), '🙏', [profiles[1]]);
  react(say(null, profiles[6], 'Running 10 min late, start without me in goal', 60), '😂', [profiles[4], profiles[5]]);
  react(say(null, me, 'Reminder: dues for session 2 are due before the first game!', 30), '👍', [profiles[1], profiles[2], profiles[4], profiles[3]]);
  readUpTo(null, 30);
  say(null, profiles[5], 'Paid 💸', 12);
  // Fixed a typo after posting.
  Object.assign(messages.find((m) => m.body === 'Running 10 min late, start without me in goal'), { edited_date: minutesAgo(58) });
  say(null, profiles[11], 'Parking tip for the new folks: the back lot is closer to the indoor fields https://www.google.com/maps/search/?api=1&query=North+Coast+Premier+Soccer+Complex @Casey C. worth adding to the field rules?', 10, null, { mentions: [me.user_id] });
  say(null, profiles[1], '🔥🔥🔥', 8);

  const pickup = thread(profiles[2], '⚽ Sunday pickup?', 300);
  say(pickup, profiles[2], 'Anyone up for pickup Sunday morning? Field 3 is open at 10', 300);
  say(pickup, profiles[1], "I'm in", 290);
  readUpTo(pickup, 285);
  const cousin = say(pickup, profiles[8], 'In, bringing my cousin if that works', 120);
  say(pickup, profiles[2], 'Totally, the more the merrier', 100, cousin);
  say(pickup, profiles[7], "Can't this week, next one for sure", 20);

  const fantasy = thread(profiles[4], '🏈 Fantasy football league', 90);
  say(fantasy, profiles[4], 'Starting a team fantasy league, $20 buy-in. Who wants in?', 90);
  say(fantasy, profiles[10], 'Me!! @Casey C. you in?', 85, null, { mentions: [me.user_id] });
  say(fantasy, profiles[9], 'Count me in 🙋‍♀️', 40);

  const food = thread(profiles[3], '🍕 Post-game food spot', 2900);
  say(food, profiles[3], "Where are we going after Thursday's game?", 2900);
  // @mentions: the captain's @team here, and teammates mentioning the captain in Team Chat
  // (unread) and in the fantasy thread (never opened).
  say(food, me, '@team wings place on Lake Rd?', 2880, null, { mentions_team: true });
  react(say(food, profiles[11], 'Yes please 🍗', 2870), '🙌', [profiles[3], me]);
  readUpTo(food, 2870);

  const jerseys = thread(me, '🎽 Jersey order', 7200, { archived: true });
  say(jerseys, me, 'Last call for jersey sizes. The order goes in Friday.', 7200);
  say(jerseys, profiles[5], 'Medium for me!', 7100);
  say(jerseys, me, 'Order placed, thanks all. Closing this one.', 7000);
  readUpTo(jerseys, 7000);

  // The Captains' Lounge (the database starts it): only Casey and Priya, the captains, see it.
  const priya = profiles[3];
  const lounge = thread(me, "Captains' Lounge", 10000, { visibility: 'captains', created_by: null, author_name: null });
  say(lounge, priya, 'Lineup idea for Thursday: Taylor in goal first half, Sam second half?', 200);
  say(lounge, me, "Works for me. We're light on women if Jamie stays on break, I'll ask the sub pool.", 190);
  say(lounge, priya, 'Also: change the team code before the session 2 invites go out', 35);
  readUpTo(lounge, 35);

  // Private chats: Jordan's with the captain, and Jordan's ride with Sam and Riley,
  // which captains can't see (sign in as Jordan to see it).
  // Nobody named it, so each of them sees the other's name.
  const dm = privateChat(profiles[1], 'Casey C. & Jordan R.', 400, [profiles[1], me], { named: false });
  say(dm, profiles[1], 'Hey, can I pay my dues next week? Paycheck hits Friday', 400);
  say(dm, me, 'No problem, thanks for the heads up 👍', 380);
  readUpTo(dm, 380);
  const ride = privateChat(profiles[2], "🚗 Ride to Thursday's game", 150, [profiles[2], profiles[1], profiles[7]]);
  say(ride, profiles[2], 'Anyone need a ride Thursday? Leaving Lakewood at 6:15', 150);
  say(ride, profiles[7], 'Yes please! 🙏', 140);
  say(ride, profiles[1], "Me too if there's room", 130);

  // Dues: last session all paid; this session half paid, the captain included
  // among those still to pay, so the pay buttons show on "My dues". Alex and
  // Riley paid session 1 on their own and pay together from session 2. Drew was in the sub pool last session
  // and Chris only joined this one, so neither paid for session 1. Everyone
  // paid the $61 share, except Sam, who paid $50 before the ref fees were added
  // (so he has $11 more to pay), and Morgan, who gave the captain $30 cash and
  // owes the other $31. Jamie paid session 2 before deciding to sit it out.
  profiles[4].pays_with = profiles[7].user_id;
  profiles[7].pays_with = profiles[4].user_id;
  const fee = { league_fee: 595, ref_fee: 18, game_count: 7, total_fee: 721 };
  const sessionDues = [1, 2].map((session) => ({ id: uid(), season_year: year, session, ...fee, created_date: now(), updated_date: now() }));
  const activeInSession1 = (i) => i !== 8 && i !== 10;
  const duesPayments = profiles
    .map((p, i) => [p, i])
    .flatMap(([p, i]) => [
      ...(activeInSession1(i) ? [{ session: 1, paid_date: dayjs().subtract(40 + i, 'day').format('YYYY-MM-DD'), paid_by: captainId }] : []),
      ...([1, 2, 3, 5, 6, 9].includes(i)
        ? [{
            session: 2,
            paid_date: dayjs().subtract(1 + i, 'day').format('YYYY-MM-DD'),
            paid_by: i === 3 ? captainId : p.user_id,
            ...(i === 2 && { paid_amount: 50, paid_date: dayjs().subtract(8, 'day').format('YYYY-MM-DD') }),
            ...(i === 5 && { paid_amount: 30, paid_by: captainId }),
          }]
        : []),
    ].map((row) => ({
      id: uid(), season_year: year, user_id: p.user_id, override_amount: null, paid: true, paid_amount: 61, ...row, created_date: now(), updated_date: now(),
    })));
  // Two teammates who aren't on the app: Dana has paid this session, Mike hasn't.
  const rosterStarted = dayjs().subtract(55, 'day').toISOString();
  const guest = (display_name, gender, position) => ({
    id: uid(), display_name, gender, position, status: 'active', removed: false, pays_with_user: null, pays_with_guest: null,
    linked_user_id: null, created_by: captainId, created_date: rosterStarted, updated_date: rosterStarted,
  });
  const teamGuests = [guest('Mike Russo', 'M', 'Defense'), guest('Dana Wells', 'F', 'Forward')];
  const guestPaid = (g, session, daysAgo) => ({
    id: uid(), season_year: year, session, user_id: null, guest_id: g.id, override_amount: null, paid: true, paid_amount: 61,
    paid_date: dayjs().subtract(daysAgo, 'day').format('YYYY-MM-DD'), paid_by: captainId, created_date: now(), updated_date: now(),
  });
  duesPayments.push(guestPaid(teamGuests[0], 1, 45), guestPaid(teamGuests[1], 1, 44), guestPaid(teamGuests[1], 2, 3));

  // A captain put Mike IN and Dana MAYBE for the next game, and Mike set up a goal last week.
  const forGuest = (g, row) => ({ id: uid(), user_id: null, guest_id: g.id, created_date: now(), updated_date: now(), ...row });
  rsvps.push(
    forGuest(teamGuests[0], { game_id: next.id, status: 'in', playing_gk: false }),
    forGuest(teamGuests[1], { game_id: next.id, status: 'maybe', playing_gk: false }),
  );
  const lastWeek = games.filter((g) => g.has_result).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  stats.push(forGuest(teamGuests[0], { game_id: lastWeek.id, played: true, goals: 0, assists: 1, blue_cards: 0, red_cards: 0 }));
  // Someone from outside the team filled in last week; nobody caught his name.
  const fillIns = [
    { id: uid(), game_id: lastWeek.id, display_name: null, gender: 'M', goals: 0, assists: 1, created_date: now(), updated_date: now() },
  ];
  const at = (date, hour) => dayjs(date).hour(hour).toISOString();
  const duesHistory = duesPayments.map((p) => ({
    id: uid(), season_year: p.season_year, session: p.session, user_id: p.user_id, guest_id: p.guest_id ?? null, paid: true,
    paid_date: p.paid_date, paid_amount: p.paid_amount, changed_by: p.paid_by, created_date: at(p.paid_date, 19),
  }));
  // Taylor was marked not paid by mistake yesterday, and the captain put it back.
  const taylor = duesPayments.find((p) => p.session === 2 && p.user_id === profiles[6].user_id);
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  duesHistory.push(
    {
      id: uid(), season_year: year, session: 2, user_id: taylor.user_id, paid: false, paid_date: null, paid_amount: null,
      changed_by: profiles[10].user_id, created_date: at(yesterday, 20),
    },
    {
      id: uid(), season_year: year, session: 2, user_id: taylor.user_id, paid: true, paid_date: yesterday, paid_amount: 61,
      changed_by: captainId, created_date: at(yesterday, 21),
    },
  );
  Object.assign(taylor, { paid_date: yesterday, paid_by: captainId });

  // Who was on each session. Session 1 is over: Jamie played it and is sitting
  // out session 2, and Chris joined in session 2. Session 2 starts with the next
  // game, and only some have answered "Playing session 2?" (not the captain yet).
  // Casey already asked who's playing session 3, before its schedule is out: a
  // few have answered (Jamie's coming back), Jordan and most others haven't.
  const answeredDaysAgo = { 1: 50, 2: 3, 3: 1 };
  const entry = (session, who, status, answered) => ({
    id: uid(), season_year: year, session, user_id: who.user_id ?? null, guest_id: who.guest_id ?? null, status,
    answered_at: answered ? dayjs().subtract(answeredDaysAgo[session], 'day').toISOString() : null,
    changed_by: answered ? (who.user_id ?? captainId) : null, pays_with_user: null, pays_with_guest: null,
    created_date: now(), updated_date: now(),
  });
  const answeredSession2 = [1, 3, 4, 6, 8, 9, 10];
  const sessionRoster = [
    ...profiles.flatMap((p, i) => (i === 10 ? [] : [entry(1, p, i === 8 ? 'sub_pool' : 'active', true)])),
    ...teamGuests.map((g) => entry(1, { guest_id: g.id }, 'active', true)),
    ...profiles.map((p, i) => entry(2, p, p.status, answeredSession2.includes(i))),
    entry(2, { guest_id: teamGuests[0].id }, 'active', false),
    entry(2, { guest_id: teamGuests[1].id }, 'active', true),
    ...profiles.map((p, i) => {
      const answer = { 3: 'active', 4: 'active', 7: 'sub_pool', 9: 'active' }[i];
      return entry(3, p, answer ?? p.status, !!answer);
    }),
    ...teamGuests.map((g) => entry(3, { guest_id: g.id }, 'active', false)),
  ];
  // Alex and Riley pay together from session 2 (each session keeps who paid with whom).
  for (const row of sessionRoster.filter((r) => r.session > 1)) {
    if (row.user_id === profiles[4].user_id) row.pays_with_user = profiles[7].user_id;
    if (row.user_id === profiles[7].user_id) row.pays_with_user = profiles[4].user_id;
  }
  const lastGame = games.filter((g) => g.season_year === year && g.session === 2).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const sessionAsks = [
    {
      id: uid(), season_year: year, session: 3, starts_on: dayjs(lastGame.date).add(14, 'day').format('YYYY-MM-DD'),
      asked_by: captainId, applied_at: null, created_date: dayjs().subtract(2, 'day').toISOString(), updated_date: dayjs().subtract(2, 'day').toISOString(),
    },
  ];

  // What moved the split: session 2's fee was set at $595 before the league sent the
  // ref fees (Sam paid his $50 then), and Jamie said she's sitting out session 2.
  const fees = (league_fee, ref_fee) => ({ league_fee, ref_fee, game_count: 7, total_fee: league_fee + ref_fee * 7 });
  const change = (session, kind, old_value, new_value, changed_by, created_date, who = {}) => ({
    id: uid(), season_year: year, session, kind, user_id: null, guest_id: null, ...who, old_value, new_value, changed_by, created_date,
  });
  // Kelly picked "Kelly M" on the roster when she joined: the session 1 payment
  // and place on session 1's list the name had came with it. Captains see it on
  // her card and can undo the pick.
  const kelly = profiles[11];
  const kellyJoined = dayjs().subtract(5, 'day').toISOString();
  const kellyName = { ...guest('Kelly M', 'F', 'Mid-Field'), linked_user_id: kelly.user_id, updated_date: kellyJoined };
  const kellys = (rows) => rows.filter((r) => r.user_id === kelly.user_id && r.session === 1).map((r) => r.id);
  const guestLinks = [
    {
      id: uid(), guest_id: kellyName.id, user_id: kelly.user_id, moved_payments: kellys(duesPayments),
      moved_history: kellys(duesHistory), moved_roster: kellys(sessionRoster), moved_rsvps: [], moved_stats: [],
      moved_votes: [], moved_changes: [], moved_partners: [], merged_payments: [], merged_roster: [], filled: {}, status_before: 'active',
      status_after: 'active',
      guest_partner: null, user_partner: null, rebuilt: false, linked_by: kelly.user_id, created_date: kellyJoined,
      unlinked_by: null, unlinked_at: null,
    },
  ];

  const jamieOut = sessionRoster.find((r) => r.session === 2 && r.user_id === profiles[9].user_id);
  const duesChanges = [
    change(1, 'fee', null, fees(595, 18), captainId, at(dayjs().subtract(52, 'day'), 18)),
    change(2, 'fee', null, fees(595, 0), captainId, at(dayjs().subtract(9, 'day'), 18)),
    change(2, 'fee', fees(595, 0), fees(595, 18), captainId, at(dayjs().subtract(7, 'day'), 18)),
    change(2, 'roster', { status: 'active' }, { status: 'on_break' }, profiles[9].user_id, jamieOut.answered_at, { user_id: profiles[9].user_id }),
    // Answers for session 3, asked ahead: Jamie's back, Riley subs.
    ...[[9, 'on_break', 'active'], [7, 'active', 'sub_pool']].map(([i, from, to]) =>
      change(3, 'roster', { status: from }, { status: to }, profiles[i].user_id, dayjs().subtract(1, 'day').toISOString(), { user_id: profiles[i].user_id }),
    ),
  ];

  return {
    users,
    player_profiles: profiles,
    games,
    rsvps,
    game_stats: stats,
    game_fill_ins: fillIns,
    potm_votes: votes,
    team_settings: [
      {
        id: uid(),
        primary_jersey: 'Bright green/yellow',
        backup_jersey: 'Black',
        venue_name: 'North Coast Premier Soccer Complex',
        venue_address: '8809 Lake Rd, Seville, OH',
        min_players: 8,
        min_women: 3,
        potm_mode: 'separate',
        potm_window_hours: 12,
        potm_notify: true,
        potm_reminder_hours: 3,
        potm_announce: true,
        game_reminders: true,
        game_reminder_hours: 6,
        email_reminders: false,
        rules_intro: 'SAFE & FAIR PLAY ARE OUR TOP PRIORITY',
        quick_hits: [
          'Waiver must be on file with the complex before you can play',
          'Shin guards required, jewelry off or taped',
          'No offside, no slide tackles (goalie excepted in the box), no boarding',
          "Coed: 3 women field players minimum at all times (a woman in goal doesn't count), 2-goal limit per man, women take all kicks",
          'Blue card = 2 minutes down a player; red card = minimum 1-game suspension',
        ],
        // The real rules, sorted into sections (a line ending with a colon starts one).
        rules_bullets: [
          'Before you play:',
          'Players must have a completed liability waiver form on file before they will be permitted to play.',
          'Shin guards must be worn by all players. Jewelry must be taped or removed.',
          'Blood from any wound must be stopped and fully covered before a player may be on the field of play.',
          'The game:',
          'Games consist of two 25-minute halves with a 5-minute halftime. The clock starts promptly at the appointed time and will not be stopped.',
          'Substitutions are "on the fly." Guaranteed substitutions are allowed when the ball leaves the field of play and must be completed within 20 seconds. Substitutions are not guaranteed during the final two minutes of a half.',
          'Offside rules do not apply.',
          'A team down by five goals may add an additional field player as long as the differential exists.',
          'The ball and restarts:',
          'Three-line violations occur when a ball is played in the air over all three lines without touching anything. The ball is placed in the middle of the first red line it passed over and a restart is given to the opposing team.',
          'A ball hitting the roof is given to the opposing team and reset at the nearest line.',
          'Out-of-bounds balls are brought back into play at the point they went out.',
          'Passing back to the goalie is permitted from anywhere, but the goalie is NOT permitted to pick the ball up if it is played back with the feet.',
          'Kicks are all direct. Minor fouls inside the box are brought outside the penalty area.',
          'Restarts and penalty kicks must be taken within five seconds.',
          'Fouls and cards:',
          'Slide tackling is not permitted and may result in a red card. The only exception is the goalie, who may slide in the penalty area.',
          'Intentional or violent boarding is not permitted.',
          'Foul or abusive language is not permitted.',
          'Sporting behavior is expected from players and fans. Fighting will result in permanent suspension from the facility without a refund.',
          'Cards: An offending player is sent off for two minutes and the team plays a person down. Three blue cards on the same player result in a red card, and the team plays a person down for five minutes. Red cards are serious and result in at least a one-game suspension, reviewed by management for possible further action.',
          'Coed rules:',
          'Two-goal limit per male.',
          'Minimum of three women field players on the field at all times. A woman playing in goal does not count as a field player.',
          'Women take all kicks.',
        ],
        rules_footer: 'Final decisions regarding all rules and interpretations are made by the owners of North Coast Premier Soccer Complex.',
        // The team's real Venmo and PayPal, so the preview's pay buttons can be tried.
        pay_venmo: 'B-Kircher',
        pay_paypal: 'https://www.paypal.com/qrcodes/p2pqrc/WWQM2FMVLDVBQ',
        pay_cashapp: null,
        pay_zelle: null,
        pay_note: 'Cash at the field works too.',
        created_date: now(),
        updated_date: now(),
      },
    ],
    session_dues: sessionDues,
    dues_payments: duesPayments,
    dues_history: duesHistory,
    dues_changes: duesChanges,
    team_guests: [...teamGuests, kellyName],
    team_guest_links: guestLinks,
    // Captains' answers to the Team page's name checks: none yet.
    team_name_checks: [],
    session_roster: sessionRoster,
    session_asks: sessionAsks,
    // Last changed before session 2 started, so captains are reminded to change it.
    team_join_code: [
      { id: uid(), code: DEMO_TEAM_CODE, updated_by: captainId, created_date: dayjs().subtract(60, 'day').toISOString(), updated_date: dayjs().subtract(60, 'day').toISOString() },
    ],
    messages,
    chat_threads: threads,
    chat_thread_members: members,
    message_reactions: reactions,
    chat_reads: reads,
    announcements: [
      { id: uid(), title: 'Welcome to the new team hub', body: 'This is demo mode with sample data. Once Supabase is connected you will see the real team here.', author_name: 'Casey Captain', created_date: minutesAgo(600), updated_date: minutesAgo(600) },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      for (const table of Object.values(TABLES)) db[table] = db[table] || [];
      return db;
    }
  } catch {
    // Fall back to fresh sample data.
  }
  const db = seed();
  save(db);
  return db;
}

function save(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // Storage full or blocked: keep working in memory.
  }
}

const delay = (value) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), 120));

/**
 * With autoSignIn, a visitor who isn't signed in starts as the sample captain, so
 * previews open straight into the site; after signing out they stay signed out.
 */
export function createDemoBackend({ autoSignIn = false } = {}) {
  let db = load();
  const listeners = {};
  const authListeners = new Set();

  const sessionUserId = () => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  };
  const storeSession = (id) => {
    try {
      if (id) {
        localStorage.setItem(SESSION_KEY, id);
        localStorage.removeItem(SIGNED_OUT_KEY);
      } else {
        localStorage.removeItem(SESSION_KEY);
        localStorage.setItem(SIGNED_OUT_KEY, '1');
      }
    } catch {
      // ignore
    }
  };
  const setSession = (id) => {
    storeSession(id);
    authListeners.forEach((cb) => setTimeout(() => cb(id ? 'SIGNED_IN' : 'SIGNED_OUT'), 0));
  };
  const currentUser = () => db.users.find((u) => u.id === sessionUserId()) || null;
  const signedOutOnPurpose = () => {
    try {
      return localStorage.getItem(SIGNED_OUT_KEY) === '1';
    } catch {
      return false;
    }
  };
  if (autoSignIn && !currentUser() && !signedOutOnPurpose()) {
    const captain = db.users.find((u) => u.email === DEMO_LOGIN.email) || db.users.find((u) => u.role === 'admin');
    if (captain) storeSession(captain.id);
  }
  const requireUser = () => {
    if (!currentUser()) throw new Error('Not signed in');
  };
  // Tests turn this on to act out a dropped connection: every save fails the way
  // a real one does with no signal.
  const failIfOffline = () => {
    let offline = false;
    try {
      offline = localStorage.getItem('jt_demo_offline') === '1';
    } catch {
      // Private mode.
    }
    if (offline) throw new TypeError('Failed to fetch');
  };
  // And this (table names, comma-separated) to act out one kind of data not
  // loading: reading those tables fails the way a dropped connection does.
  const failIfUnreadable = (table) => {
    let tables = '';
    try {
      tables = localStorage.getItem('jt_demo_fail_reads') || '';
    } catch {
      // Private mode.
    }
    if (tables.split(',').includes(table)) throw new TypeError('Failed to fetch');
  };
  // And this to act out live updates that broke off (a phone asleep): changes still
  // save, but none arrive live. The browser's online event acts out the reconnect.
  const liveOff = () => {
    try {
      return localStorage.getItem('jt_demo_live_off') === '1';
    } catch {
      return false;
    }
  };

  // Same rules as the Supabase filter: null matches empty columns, an array matches any of its values.
  const matches = (row, where) =>
    Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : (row[k] ?? null) === v));
  const notify = (table, event, row) => {
    if (liveOff()) return;
    (listeners[table] || []).forEach((l) => l[event] && setTimeout(() => l[event](structuredClone(row)), 0));
  };
  const sortRows = (rows, sort) => {
    const { column, ascending } = parseSort(sort);
    return [...rows].sort((a, b) => {
      const x = a[column] ?? '';
      const y = b[column] ?? '';
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return ascending ? cmp : -cmp;
    });
  };

  // Same as the database's roster_start_session(): a session's list starts as a
  // copy of everyone's status, unless it already has one.
  const sessionOf = (row) => `${row.season_year}-${row.session}`;
  const startSession = ({ year, session }) => {
    if (db.session_roster.some((r) => sessionOf(r) === `${year}-${session}`)) return;
    const entry = (who, status) =>
      withCouple({
        id: uid(), season_year: Number(year), session: Number(session), user_id: null, guest_id: null, ...who, status,
        answered_at: null, changed_by: null, created_date: now(), updated_date: now(),
      });
    db.session_roster.push(
      ...db.player_profiles.filter((p) => !p.removed).map((p) => entry({ user_id: p.user_id }, p.status)),
      ...db.team_guests.filter((g) => !g.removed && !g.linked_user_id).map((g) => entry({ guest_id: g.id }, g.status)),
    );
  };
  const current = () => currentSession(db.games, today(), db.session_asks);
  // Same as the database's roster_open_session(): the current session, unless it's over.
  const open = () => openSession(db.games, today(), db.session_asks);
  const samePeriod = (a, b) => Number(a.year) === Number(b.year) && Number(a.session) === Number(b.session);
  const started = (period) => db.games.some((g) => samePeriod({ year: g.season_year, session: g.session }, period) && g.date < today());

  // Same as the database's roster_follows_couples(): the session status changes count for
  // and any later one follow who pays together now. Not a session that's over, or before.
  const followsCouples = (period) => isEarlier(current(), period) || (!!open() && samePeriod(open(), period));
  // Who someone pays with now, as a session list entry's columns.
  const coupleNow = (who) => {
    const p = who.user_id && db.player_profiles.find((x) => x.user_id === who.user_id);
    const g = who.guest_id && db.team_guests.find((x) => x.id === who.guest_id && !x.linked_user_id);
    if (p) return { pays_with_user: p.pays_with ?? null, pays_with_guest: p.pays_with_guest ?? null };
    if (g) return { pays_with_user: g.pays_with_user ?? null, pays_with_guest: g.pays_with_guest ?? null };
    return { pays_with_user: null, pays_with_guest: null };
  };
  // Same as the database's session_roster_couple(): an entry added to a session that follows
  // who pays together now starts with the player's partner. A captain adding someone to a past
  // session doesn't.
  const withCouple = (row) => {
    if (row.pays_with_user || row.pays_with_guest) return row;
    const follow = followsCouples({ year: row.season_year, session: row.session });
    return Object.assign(row, follow ? coupleNow(row) : { pays_with_user: null, pays_with_guest: null });
  };
  // Same as the database's roster_follow_couple(): linking or unlinking a couple changes who
  // they pay with in the sessions that follow who pays together now.
  const followCouple = (who) => {
    if (who.guest_id && db.team_guests.some((g) => g.id === who.guest_id && g.linked_user_id)) return;
    const couple = coupleNow(who);
    db.session_roster
      .filter((r) => (who.user_id ? r.user_id === who.user_id : r.guest_id === who.guest_id))
      .filter((r) => followsCouples({ year: r.season_year, session: r.session }))
      .forEach((r) => Object.assign(r, couple, { updated_date: now() }));
  };
  const couples = (table, fields) =>
    (table === 'player_profiles' && ('pays_with' in fields || 'pays_with_guest' in fields)) ||
    (table === 'team_guests' && ('pays_with_user' in fields || 'pays_with_guest' in fields));

  // Same as the database's roster_follow_profile() and roster_follow_guest(): a
  // status set while a session is current counts for that session, as an answer.
  // Once it's over (nothing else on the schedule), it goes on no session's list.
  const followStatus = (table, record) => {
    if (table === 'team_guests' && record.linked_user_id) return;
    const period = open();
    const who = table === 'player_profiles' ? { user_id: record.user_id } : { guest_id: record.id };
    if (period) {
      startSession(period);
      setEntry(period, who, record.removed ? 'off' : record.status);
    }
    followAhead(who, record.removed ? 'off' : record.status);
  };
  // Same as the database's roster_follow_ahead(): until they start, sessions asked about
  // ahead keep up with today's status for anyone who hasn't answered them, anyone taken
  // off the team (no longer their answer, so added back they're asked again), and anyone
  // new, even after captains stop asking. Not recorded as a dues change.
  const followAhead = (who, status) => {
    const cur = current();
    for (const ask of db.session_asks.filter((a) => isEarlier(cur, { year: a.season_year, session: a.session }))) {
      const list = db.session_roster.filter((r) => r.season_year === ask.season_year && r.session === ask.session);
      if (!list.length) continue;
      const row = list.find((r) => (who.user_id ? r.user_id === who.user_id : r.guest_id === who.guest_id));
      if (row) {
        if ((!row.answered_at || status === 'off') && (row.status !== status || row.answered_at)) {
          Object.assign(row, { status, answered_at: status === 'off' ? null : row.answered_at, updated_date: now() });
        }
      } else if (status !== 'off') {
        db.session_roster.push(
          withCouple({
            id: uid(), season_year: ask.season_year, session: ask.session, user_id: null, guest_id: null, ...who, status,
            answered_at: null, changed_by: null, created_date: now(), updated_date: now(),
          }),
        );
      }
    }
  };
  // One player's (or roster name's) entry in a session's list, set as their answer.
  const setEntry = (period, who, status) => {
    const mine = (r) =>
      sessionOf(r) === `${period.year}-${period.session}` && (who.user_id ? r.user_id === who.user_id : r.guest_id === who.guest_id);
    const patch = { status, answered_at: now(), changed_by: currentUser()?.id ?? null, updated_date: now() };
    const row = db.session_roster.find(mine);
    if (row) {
      const before = { ...row };
      Object.assign(row, patch);
      trackChange('session_roster', before, row);
    } else {
      const added = withCouple({
        id: uid(), season_year: Number(period.year), session: Number(period.session), user_id: null, guest_id: null, ...who,
        created_date: now(), ...patch,
      });
      db.session_roster.push(added);
      trackChange('session_roster', null, added);
    }
  };
  const follows = (table, fields) =>
    (table === 'player_profiles' || table === 'team_guests') && ('status' in fields || 'removed' in fields);

  // Same as the database's dues_changes triggers: the session fee, custom amounts, and someone
  // coming onto or off a session's active roster are kept, with who changed them. A session's
  // list starting (rows nobody has answered) isn't a change.
  // Same as the database's checks: a session fee or a custom amount can't be below $0.
  const checkAmounts = (table, row) => {
    const below = (value) => value != null && Number(value) < 0;
    if (table === 'session_dues' && ['total_fee', 'league_fee', 'ref_fee'].some((k) => below(row[k]))) throw new Error("A fee can't be below $0.");
    if (table === 'dues_payments' && below(row.override_amount)) throw new Error("A custom amount can't be below $0.");
  };
  const feeOf = (r) => r && { league_fee: r.league_fee ?? null, ref_fee: r.ref_fee ?? null, game_count: r.game_count ?? null, total_fee: r.total_fee ?? null };
  const amountOf = (value) => (value == null ? null : Number(value));
  const trackChange = (table, before, after) => {
    const record = (kind, oldValue, newValue, changedBy = currentUser()?.id ?? null) =>
      db.dues_changes.push({
        id: uid(), season_year: after.season_year, session: after.session, kind,
        user_id: kind === 'fee' ? null : (after.user_id ?? null), guest_id: kind === 'fee' ? null : (after.guest_id ?? null),
        old_value: oldValue, new_value: newValue, changed_by: changedBy, created_date: now(),
      });
    if (table === 'session_dues' && JSON.stringify(feeOf(before)) !== JSON.stringify(feeOf(after))) {
      record('fee', feeOf(before) ?? null, feeOf(after));
    }
    if (table === 'dues_payments') {
      const was = amountOf(before?.override_amount);
      const is = amountOf(after.override_amount);
      if (was !== is) record('custom_amount', was == null ? null : { amount: was }, is == null ? null : { amount: is });
    }
    if (table === 'session_roster' && (before || after.answered_at)) {
      if ((before?.status === 'active') !== (after.status === 'active')) {
        record('roster', before ? { status: before.status } : null, { status: after.status }, currentUser()?.id ?? after.changed_by ?? null);
      }
    }
  };

  // Same as the database's potm_open_voting() and potm_voting_open(): posting a
  // result opens Player of the Match voting for the team's window; votes lock at
  // the deadline (games from before deadlines have none and stay open).
  const openVoting = (game) => {
    const hours = db.team_settings[0]?.potm_window_hours ?? 12;
    Object.assign(game, { potm_opened_at: now(), potm_closes_at: dayjs().add(hours, 'hour').toISOString() });
  };
  const checkVotingOpen = (gameId) => {
    const game = db.games.find((g) => g.id === gameId);
    if (game?.potm_closes_at && !dayjs(game.potm_closes_at).isAfter(dayjs())) throw new Error('Voting has closed for this game.');
  };

  // Same as the database's chat_can_read() and the chat policies: Team Chat and threads are
  // for the team, the Captains' Lounge for captains, a private chat for the people in it.
  const onTeam = (user) => !!user && (!!user.joined_team_at || user.role === 'admin');
  const inChat = (threadId, userId) => db.chat_thread_members.some((m) => m.thread_id === threadId && m.user_id === userId);
  const threadOf = (threadId) => db.chat_threads.find((t) => t.id === threadId);
  const canRead = (threadId, user = currentUser()) => {
    if (!onTeam(user)) return false;
    if (!threadId) return true;
    const thread = threadOf(threadId);
    if (!thread) return false;
    if (thread.visibility === 'captains') return user.role === 'admin';
    if (thread.visibility === 'private') return inChat(threadId, user.id);
    return true;
  };
  const visibleRows = (table, rows) => {
    const me = currentUser();
    if (table === 'chat_threads') return rows.filter((t) => canRead(t.id, me));
    if (table === 'messages') return rows.filter((m) => canRead(m.thread_id ?? null, me));
    if (table === 'message_reactions') {
      return rows.filter((r) => {
        const m = db.messages.find((x) => x.id === r.message_id);
        return !!m && canRead(m.thread_id ?? null, me);
      });
    }
    if (table === 'chat_thread_members') return rows.filter((m) => inChat(m.thread_id, me?.id));
    return rows;
  };
  const refuse = () => {
    throw new Error("You don't have permission to do that.");
  };
  // What the policies allow in the chat, beyond reading.
  const checkChatWrite = (table, action, record, patch = {}) => {
    const me = currentUser();
    const isCaptain = me.role === 'admin';
    if (table === 'chat_threads') {
      if (action === 'create' && (record.visibility ?? 'team') !== 'team') refuse();
      if (action === 'update' && 'visibility' in patch && patch.visibility !== record.visibility) refuse();
      if (action === 'update' && 'named' in patch) refuse();
      if (action !== 'create' && !(canRead(record.id, me) && canManageRoom(record, me.id, isCaptain))) refuse();
    }
    if (table === 'messages' && action === 'create') {
      const thread = record.thread_id ? threadOf(record.thread_id) : null;
      if (!canRead(record.thread_id ?? null, me) || thread?.archived) refuse();
    }
    if (table === 'messages' && action === 'delete') {
      const own = record.user_id === me.id;
      const thread = record.thread_id ? threadOf(record.thread_id) : null;
      if (!canRead(record.thread_id ?? null, me) || (!own && thread?.visibility === 'private')) refuse();
    }
    if (table === 'message_reactions' && action === 'create') {
      const m = db.messages.find((x) => x.id === record.message_id);
      if (!m || !canRead(m.thread_id ?? null, me)) refuse();
    }
    if (table === 'chat_thread_members') {
      // People are added with chat.startPrivate() and chat.addMembers(); anyone leaves, the starter takes people out.
      if (action !== 'delete' || !onTeam(me)) refuse();
      const starter = threadOf(record.thread_id)?.created_by === me.id && inChat(record.thread_id, me.id);
      if (record.user_id !== me.id && !starter) refuse();
    }
  };

  // Same as the database's message_mentions(): only teammates who can read the message's room,
  // each once and never the author, and only a captain's message in Team Chat or a thread mentions @team.
  const cleanMentions = (message) => {
    if ('mentions' in message) {
      const ids = [...new Set(message.mentions || [])].filter((id) => {
        const user = db.users.find((u) => u.id === id);
        return id !== message.user_id && onTeam(user) && canRead(message.thread_id ?? null, user);
      });
      message.mentions = ids.length ? ids : null;
    }
    if ('mentions_team' in message) {
      const thread = message.thread_id ? threadOf(message.thread_id) : null;
      message.mentions_team =
        !!message.mentions_team &&
        db.users.some((u) => u.id === message.user_id && u.role === 'admin') &&
        (!thread || thread.visibility === 'team');
    }
  };

  function entity(table) {
    const write = () => save(db);
    return {
      async list(sort, limit) {
        requireUser();
        failIfUnreadable(table);
        const rows = sortRows(visibleRows(table, db[table]), sort);
        return delay(limit ? rows.slice(0, limit) : rows);
      },
      async filter(where, sort, limit) {
        requireUser();
        failIfUnreadable(table);
        const rows = sortRows(visibleRows(table, db[table].filter((r) => matches(r, where))), sort);
        return delay(limit ? rows.slice(0, limit) : rows);
      },
      async create(row) {
        requireUser();
        failIfOffline();
        if (table === 'potm_votes') checkVotingOpen(row.game_id);
        checkChatWrite(table, 'create', row);
        // PostgreSQL's primary key makes a retry with the same message ID safe.
        if (table === 'messages' && row.id && db.messages.some((m) => m.id === row.id)) throw new Error('Message already sent');
        // Same as the policies: only captains answer name checks, and only the database functions record picks.
        if ((table === 'team_name_checks' && currentUser().role !== 'admin') || table === 'team_guest_links' || table === 'session_asks') refuse();
        checkAmounts(table, row);
        const record = { id: uid(), created_date: now(), updated_date: now(), ...(table === 'chat_threads' && { visibility: 'team' }), ...row };
        if (table === 'messages') cleanMentions(record);
        if (table === 'session_roster') withCouple(record);
        db[table].push(record);
        trackChange(table, null, record);
        if (table === 'player_profiles' || table === 'team_guests') followStatus(table, record);
        write();
        notify(table, 'onInsert', record);
        return delay(record);
      },
      async bulkCreate(rows) {
        const created = [];
        for (const row of rows) created.push(await this.create(row));
        return created;
      },
      async update(id, patch) {
        requireUser();
        failIfOffline();
        const record = db[table].find((r) => r.id === id);
        if (!record) throw new Error('Not found');
        if (table === 'potm_votes') checkVotingOpen(record.game_id);
        // Same as the policies: only roster_ask() changes what captains asked.
        if (table === 'session_asks') refuse();
        checkChatWrite(table, 'update', record, patch);
        checkAmounts(table, { ...record, ...patch });
        const opensVoting = table === 'games' && patch.has_result && !record.has_result && !record.potm_opened_at;
        // Same as the database's message_edited(): changing the text marks it edited.
        const edited = table === 'messages' && 'body' in patch && patch.body !== record.body;
        // Same as chat_thread_named(): renaming a room gives it that name.
        const renamed = table === 'chat_threads' && 'title' in patch && patch.title !== record.title;
        const before = { ...record };
        Object.assign(record, patch, { updated_date: now() }, edited && { edited_date: now() }, renamed && { named: true });
        trackChange(table, before, record);
        if (table === 'messages') cleanMentions(record);
        if (opensVoting) openVoting(record);
        if (follows(table, patch)) followStatus(table, record);
        if (couples(table, patch)) followCouple(table === 'team_guests' ? { guest_id: record.id } : { user_id: record.user_id });
        write();
        notify(table, 'onUpdate', record);
        return delay(record);
      },
      bulkUpdate(rows) {
        return Promise.all(rows.map(({ id, ...patch }) => this.update(id, patch)));
      },
      async delete(id) {
        requireUser();
        failIfOffline();
        const vote = table === 'potm_votes' && db.potm_votes.find((r) => r.id === id);
        if (vote && currentUser().role !== 'admin') checkVotingOpen(vote.game_id);
        const existing = db[table].find((r) => r.id === id);
        if (table === 'session_asks') refuse();
        if (existing) checkChatWrite(table, 'delete', existing);
        db[table] = db[table].filter((r) => r.id !== id);
        if (table === 'games') {
          for (const child of ['rsvps', 'game_stats', 'game_fill_ins', 'potm_votes']) db[child] = db[child].filter((r) => r.game_id !== id);
        }
        // Mirrors the foreign keys: a thread takes its messages and read markers
        // with it, a message its reactions; replies to it lose the link.
        const goneMessages = new Set(table === 'messages' ? [id] : []);
        if (table === 'chat_threads') {
          db.messages.filter((m) => m.thread_id === id).forEach((m) => goneMessages.add(m.id));
          db.messages = db.messages.filter((m) => m.thread_id !== id);
          db.chat_reads = db.chat_reads.filter((r) => r.thread_id !== id);
          db.chat_thread_members = db.chat_thread_members.filter((m) => m.thread_id !== id);
        }
        if (goneMessages.size) {
          db.message_reactions = db.message_reactions.filter((r) => !goneMessages.has(r.message_id));
          db.messages.forEach((m) => {
            if (goneMessages.has(m.reply_to_id)) m.reply_to_id = null;
          });
        }
        write();
        notify(table, 'onDelete', { id });
        return delay(null);
      },
      subscribe(onInsert, { onUpdate, onDelete, onReconnect } = {}) {
        const listener = { onInsert, onUpdate, onDelete };
        listeners[table] = listeners[table] || [];
        listeners[table].push(listener);
        const reconnect = () => onReconnect?.();
        globalThis.addEventListener?.('online', reconnect);
        return () => {
          listeners[table] = listeners[table].filter((l) => l !== listener);
          globalThis.removeEventListener?.('online', reconnect);
        };
      },
    };
  }

  const entities = Object.fromEntries(Object.entries(TABLES).map(([name, table]) => [name, entity(table)]));

  const auth = {
    async me() {
      const user = currentUser();
      if (!user) return null;
      const joined = !!user.joined_team_at || user.role === 'admin';
      return delay({ id: user.id, email: user.email, full_name: user.full_name, role: user.role, joined });
    },
    onChange(callback) {
      authListeners.add(callback);
      return () => authListeners.delete(callback);
    },
    async hasSession() {
      return !!currentUser();
    },
    async signIn(email, password) {
      const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || user.password !== password) throw new Error('Invalid email or password');
      setSession(user.id);
    },
    async signUp(email, password) {
      if (db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
        throw new Error('An account with this email already exists. Try logging in.');
      }
      const user = { id: uid(), email: email.trim(), password, full_name: '', role: 'user', joined_team_at: null };
      db.users.push(user);
      save(db);
      setSession(user.id);
      return { needsVerification: false };
    },
    async verifySignup() {},
    async resendSignup() {},
    async signInWithGoogle() {
      throw new Error('Google sign-in works once Supabase is connected. In demo mode, use email and password.');
    },
    async requestPasswordReset() {},
    async updatePassword(password) {
      const user = currentUser();
      if (!user) throw new Error('This reset link is no longer valid.');
      user.password = password;
      save(db);
    },
    async signOut() {
      setSession(null);
    },
  };

  const paymentFields = (p) => ({
    paid: !!p.paid, paid_date: p.paid_date ?? null, paid_by: p.paid_by ?? null, paid_amount: p.paid_amount ?? null,
    override_amount: p.override_amount ?? null,
  });
  const rosterFields = (r) => ({ status: r.status, answered_at: r.answered_at ?? null, changed_by: r.changed_by ?? null });
  const partnerOf = (id) => {
    const p = db.player_profiles.find((x) => x.user_id === id);
    const g = db.team_guests.find((x) => x.id === id);
    return p ? (p.pays_with ?? p.pays_with_guest ?? null) : g ? (g.pays_with_user ?? g.pays_with_guest ?? null) : null;
  };

  // Same as the database's move_team_guest(): everything that moves is recorded
  // (team_guest_links), so a captain can undo the pick.
  const moveGuest = async (guestId, userId) => {
    const guest = db.team_guests.find((g) => g.id === guestId && !g.linked_user_id);
    if (!guest) throw new Error('That name has already been picked');
    if (db.team_guests.some((g) => g.linked_user_id === userId)) throw new Error('That player already has a name on the roster');
    const profile = db.player_profiles.find((p) => p.user_id === userId);
    const link = {
      id: uid(), guest_id: guestId, user_id: userId, moved_payments: [], moved_history: [], moved_roster: [], moved_rsvps: [],
      moved_stats: [], moved_votes: [], moved_changes: [], moved_partners: [], merged_payments: [], merged_roster: [], filled: {},
      status_before: profile?.status ?? null,
      status_after: null, guest_partner: null, user_partner: null, rebuilt: false, linked_by: currentUser()?.id ?? null,
      created_date: now(), unlinked_by: null, unlinked_at: null,
    };
    const move = (key, row) => {
      Object.assign(row, { user_id: userId, guest_id: null });
      link[key].push(row.id);
    };
    for (const row of db.dues_payments.filter((p) => p.guest_id === guestId)) {
      const mine = db.dues_payments.find((p) => p.user_id === userId && p.season_year === row.season_year && p.session === row.session);
      if (!mine) move('moved_payments', row);
      else {
        // Where both have one, a payment made under the roster name counts, and so does its custom amount.
        const was = paymentFields(mine);
        if (row.paid && !mine.paid) {
          Object.assign(mine, { paid: true, paid_date: row.paid_date, paid_by: row.paid_by, paid_amount: row.paid_amount ?? null });
        }
        const before = { ...mine };
        mine.override_amount = mine.override_amount ?? row.override_amount ?? null;
        trackChange('dues_payments', before, mine);
        const after = paymentFields(mine);
        if (JSON.stringify(was) !== JSON.stringify(after)) link.merged_payments.push({ id: mine.id, before: was, after });
      }
    }
    db.dues_history.filter((h) => h.guest_id === guestId).forEach((h) => move('moved_history', h));
    db.dues_changes.filter((c) => c.guest_id === guestId).forEach((c) => move('moved_changes', c));
    // Game sign-ups and stat lines: where both have one for a game, the account's own counts.
    for (const [table, key] of [['rsvps', 'moved_rsvps'], ['game_stats', 'moved_stats']]) {
      for (const row of db[table].filter((r) => r.guest_id === guestId)) {
        if (!db[table].some((r) => r.user_id === userId && r.game_id === row.game_id)) move(key, row);
      }
    }
    // Votes for the roster name, except any the player cast for it themselves.
    db.potm_votes
      .filter((v) => v.voted_for_guest_id === guestId && v.voter_id !== userId)
      .forEach((v) => {
        Object.assign(v, { voted_for_id: userId, voted_for_guest_id: null });
        link.moved_votes.push(v.id);
      });
    // Sessions asked about ahead: an answer given for the name counts over an account entry
    // that's only been following its status (a new player is put on those lists when they
    // make their profile). That entry takes the name's answer, recorded so an undo can put
    // it back; the dues change the answer made moved with the name's (above).
    const cur = current();
    for (const row of db.session_roster.filter((r) => r.user_id === userId && !r.answered_at)) {
      const named = db.session_roster.find((n) => n.guest_id === guestId && n.answered_at && sessionOf(n) === sessionOf(row));
      if (!named || !isEarlier(cur, { year: row.season_year, session: row.session })) continue;
      const before = rosterFields(row);
      Object.assign(row, { status: named.status, answered_at: named.answered_at, changed_by: named.changed_by, updated_date: now() });
      link.merged_roster.push({ id: row.id, before, after: rosterFields(row) });
    }
    // Sessions the roster name was on and the account wasn't move over; where both were, the account's entry counts.
    for (const row of db.session_roster.filter((r) => r.guest_id === guestId)) {
      if (!db.session_roster.some((r) => r.user_id === userId && sessionOf(r) === sessionOf(row))) move('moved_roster', row);
    }
    // Whoever paid with the name pays with the account: in the sessions whose entry for the
    // name just moved, and in the ones that follow who pays together now.
    const movedTo = new Set(db.session_roster.filter((r) => link.moved_roster.includes(r.id)).map(sessionOf));
    db.session_roster
      .filter((r) => r.pays_with_guest === guestId && (movedTo.has(sessionOf(r)) || followsCouples({ year: r.season_year, session: r.session })))
      .forEach((r) => {
        Object.assign(r, { pays_with_user: userId, pays_with_guest: null });
        link.moved_partners.push(r.id);
      });
    if (profile) {
      if (!profile.gender && guest.gender) link.filled.gender = guest.gender;
      if (!profile.position && guest.position) link.filled.position = guest.position;
      Object.assign(profile, { gender: profile.gender || guest.gender, position: profile.position || guest.position });
    }
    const partner = guest.pays_with_user ?? guest.pays_with_guest;
    if (partner) Object.assign(link, { guest_partner: partner, user_partner: profile ? partnerOf(userId) : null });
    Object.assign(guest, { linked_user_id: userId, pays_with_user: null, pays_with_guest: null, updated_date: now() });
    db.team_guest_links.push(link);
    save(db);
    if (partner) await dues.setPartner(userId, partner);
  };

  const users = {
    // Same as the database's join_team(): ten wrong codes in a row block tries for an hour.
    async joinTeam(code) {
      requireUser();
      const user = currentUser();
      if (user.removed_at) throw new Error(JOIN_ERRORS.removed);
      if (user.joined_team_at) return delay(null);
      if (user.join_blocked_until && user.join_blocked_until > now()) throw new Error(JOIN_ERRORS.blocked);
      const right = (db.team_join_code[0]?.code || '').trim().toLowerCase();
      if (right && String(code).trim().toLowerCase() === right) {
        Object.assign(user, { joined_team_at: now(), join_tries: 0, join_blocked_until: null });
        save(db);
        return delay(null);
      }
      const tries = (user.join_blocked_until ? 0 : user.join_tries || 0) + 1;
      const blocked = tries >= 10;
      Object.assign(user, { join_tries: blocked ? 0 : tries, join_blocked_until: blocked ? dayjs().add(1, 'hour').toISOString() : null });
      save(db);
      throw new Error(blocked ? JOIN_ERRORS.blocked : JOIN_ERRORS.wrong);
    },
    // Same as the database's move_team_guest(), claim_team_guest() and link_team_guest().
    async claimGuest(guestId) {
      requireUser();
      const guest = db.team_guests.find((g) => g.id === guestId && !g.removed);
      if (!guest) throw new Error('That name is no longer on the roster');
      await moveGuest(guestId, currentUser().id);
      db.player_profiles
        .filter((p) => p.user_id === currentUser().id)
        .forEach((p) => {
          p.status = guest.status;
          followStatus('player_profiles', p);
        });
      db.team_guest_links
        .filter((l) => l.guest_id === guestId && l.user_id === currentUser().id && !l.unlinked_at)
        .forEach((l) => Object.assign(l, { status_after: guest.status }));
      save(db);
      return delay(null);
    },
    async linkGuest(guestId, userId) {
      requireUser();
      if (currentUser().role !== 'admin') throw new Error('Only captains can link a player');
      await moveGuest(guestId, userId);
      return delay(null);
    },
    // Same as the database's unlink_team_guest(): what came with the name goes back to it as
    // it is now, and what the pick changed on the account is put back unless changed since.
    async unlinkGuest(guestId) {
      requireUser();
      failIfOffline();
      if (currentUser().role !== 'admin') throw new Error('Only captains can unlink a player');
      const guest = db.team_guests.find((g) => g.id === guestId);
      if (!guest?.linked_user_id) throw new Error("That name isn't linked to anyone");
      const userId = guest.linked_user_id;
      const link = sortRows(db.team_guest_links.filter((l) => l.guest_id === guestId && l.user_id === userId && !l.unlinked_at), '-created_date')[0];
      if (!link) throw new Error("That name was picked before undo was added, so it can't be undone here");

      const back = (row) => Object.assign(row, { user_id: null, guest_id: guestId });
      const ours = (table, key) => db[table].filter((r) => link[key].includes(r.id) && r.user_id === userId);
      const nameHas = (table, same) => db[table].some((r) => r.guest_id === guestId && same(r));
      ours('dues_payments', 'moved_payments')
        .filter((row) => !nameHas('dues_payments', (r) => sessionOf(r) === sessionOf(row)))
        .forEach(back);
      for (const { id, before, after } of link.merged_payments) {
        const row = db.dues_payments.find((p) => p.id === id && p.user_id === userId);
        if (row && JSON.stringify(paymentFields(row)) === JSON.stringify(after)) {
          const was = { ...row };
          Object.assign(row, before, { updated_date: now() });
          trackChange('dues_payments', was, row);
        }
      }
      ours('dues_history', 'moved_history').forEach(back);
      ours('dues_changes', 'moved_changes').forEach(back);
      ours('session_roster', 'moved_roster')
        .filter((row) => !nameHas('session_roster', (r) => sessionOf(r) === sessionOf(row)))
        .forEach(back);
      for (const [table, key] of [['rsvps', 'moved_rsvps'], ['game_stats', 'moved_stats']]) {
        ours(table, key)
          .filter((row) => !nameHas(table, (r) => r.game_id === row.game_id))
          .forEach(back);
      }
      db.potm_votes
        .filter((v) => link.moved_votes.includes(v.id) && v.voted_for_id === userId)
        .forEach((v) => Object.assign(v, { voted_for_id: null, voted_for_guest_id: guestId }));
      // Whoever paid with the name in those sessions, unless they've been paired up since.
      db.session_roster
        .filter((r) => (link.moved_partners || []).includes(r.id) && r.pays_with_user === userId)
        .forEach((r) => Object.assign(r, { pays_with_user: null, pays_with_guest: guestId }));
      // The account's entries that took the name's answer, unless changed since.
      for (const { id, before, after } of link.merged_roster) {
        const row = db.session_roster.find((r) => r.id === id && r.user_id === userId);
        if (row && JSON.stringify(rosterFields(row)) === JSON.stringify(after)) Object.assign(row, before, { updated_date: now() });
      }

      const profile = db.player_profiles.find((p) => p.user_id === userId);
      if (profile) {
        for (const field of ['gender', 'position']) {
          if (field in link.filled && profile[field] === link.filled[field]) profile[field] = null;
        }
        if (link.status_after && link.status_before && link.status_before !== link.status_after && profile.status === link.status_after) {
          profile.status = link.status_before;
          followStatus('player_profiles', profile);
        }
      }
      Object.assign(guest, { linked_user_id: null, updated_date: now() });

      // Who paid with whom, if nobody has paired them up since.
      const free = (id) => !partnerOf(id) && !db.team_guests.some((g) => g.id === id && g.linked_user_id);
      if (link.guest_partner) {
        if (link.guest_partner !== userId && partnerOf(userId) === link.guest_partner) await dues.setPartner(userId, null);
        if (free(guestId) && free(link.guest_partner)) await dues.setPartner(guestId, link.guest_partner);
      }
      if (link.user_partner && free(userId) && free(link.user_partner)) await dues.setPartner(userId, link.user_partner);

      // Back on the current session's list, if it started while the name was linked. A session that's over keeps its list.
      const period = open();
      const started = !!period && db.session_roster.some((r) => sessionOf(r) === `${period.year}-${period.session}`);
      if (started && !nameHas('session_roster', (r) => sessionOf(r) === `${period.year}-${period.session}`)) followStatus('team_guests', guest);
      // Both keep up with their status in sessions asked about ahead, where they haven't answered.
      followAhead({ guest_id: guestId }, guest.removed ? 'off' : guest.status);
      if (profile) followAhead({ user_id: userId }, profile.removed ? 'off' : profile.status);

      Object.assign(link, { unlinked_at: now(), unlinked_by: currentUser().id });
      save(db);
      return delay(null);
    },
    // Same as the database's set_team_member_removed().
    async setRemoved(userId, removed) {
      requireUser();
      if (currentUser().role !== 'admin') throw new Error('Only captains can remove a player');
      if (userId === currentUser().id) throw new Error("You can't remove yourself");
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error("That player isn't on the site");
      if (removed) {
        Object.assign(user, { removed_at: now(), joined_team_at: null, role: 'user' });
        // Like chat_member_active(): out of every private chat, and adding them back doesn't undo it.
        db.chat_thread_members = db.chat_thread_members.filter((m) => m.user_id !== userId);
      } else Object.assign(user, { removed_at: null, joined_team_at: now() });
      db.player_profiles
        .filter((p) => p.user_id === userId)
        .forEach((p) => {
          Object.assign(p, removed ? { removed: true, is_captain: false } : { removed: false, status: 'active' });
          followStatus('player_profiles', p);
        });
      save(db);
      return delay(null);
    },
    async setRole(userId, role) {
      if (currentUser()?.role !== 'admin') throw new Error("You don't have permission to do that.");
      const user = db.users.find((u) => u.id === userId);
      if (user) user.role = role;
      db.player_profiles.filter((p) => p.user_id === userId).forEach((p) => (p.is_captain = role === 'admin'));
      save(db);
    },
    async invite() {
      requireUser();
    },
  };

  const chat = {
    async history(threadId, { before, limit = 60 } = {}) {
      requireUser();
      failIfUnreadable('messages');
      if (!canRead(threadId)) return delay([]);
      const rows = sortRows(
        db.messages.filter((m) => (m.thread_id ?? null) === threadId && (!before || m.created_date < before)),
        '-created_date',
      );
      return delay(rows.slice(0, limit).reverse());
    },
    // Same idea as the database's chat_search(): text anywhere in the message, newest first.
    async search(q) {
      requireUser();
      failIfUnreadable('messages');
      const text = String(q || '').trim().toLowerCase();
      if (text.length < 2) return delay([]);
      const rows = sortRows(
        visibleRows('messages', db.messages).filter((m) => m.body.toLowerCase().includes(text)),
        '-created_date',
      )
        .slice(0, 50)
        .map((m) => ({
          id: m.id,
          thread_id: m.thread_id ?? null,
          thread_title: m.thread_id ? db.chat_threads.find((t) => t.id === m.thread_id)?.title ?? null : null,
          user_id: m.user_id,
          author_name: m.author_name,
          body: m.body,
          created_date: m.created_date,
        }));
      return delay(rows);
    },
    // Same as the database's chat_overview(): rooms you can see, with their kind. In a private
    // chat, what was said before you were added isn't unread.
    async overview() {
      requireUser();
      const me = currentUser();
      const rooms = new Map();
      for (const m of sortRows(visibleRows('messages', db.messages), 'created_date')) {
        const threadId = m.thread_id ?? null;
        if (!rooms.has(threadId)) {
          const read = db.chat_reads.find((r) => r.user_id === me.id && (r.thread_id ?? null) === threadId);
          const added = db.chat_thread_members.find((x) => x.thread_id === threadId && x.user_id === me.id);
          const read_ = read?.last_read_at ?? null;
          const added_ = added?.created_date ?? null;
          rooms.set(threadId, {
            thread_id: threadId,
            last_read_at: read_,
            // Unread from your read marker, but never from before you were (last) added.
            since: read_ && added_ ? (read_ > added_ ? read_ : added_) : (read_ ?? added_),
            visibility: threadId ? (threadOf(threadId)?.visibility ?? 'team') : null,
            unread: 0,
            mentions: 0,
          });
        }
        const room = rooms.get(threadId);
        Object.assign(room, {
          last_message_at: m.created_date,
          last_user_id: m.user_id,
          last_author_name: m.author_name,
          last_body: m.body.slice(0, 140),
        });
        if (m.user_id !== me.id && (!room.since || m.created_date > room.since)) {
          room.unread += 1;
          if (m.mentions_team || m.mentions?.includes(me.id)) room.mentions += 1;
        }
      }
      return delay([...rooms.values()].map(({ since, ...room }) => room));
    },
    // Same as the database's chat_start_private().
    async startPrivate(title, userIds, { named = true } = {}) {
      requireUser();
      failIfOffline();
      const me = currentUser();
      const name = String(title || '').trim();
      if (!name || name.length > 80) throw new Error('Give the chat a name (up to 80 characters)');
      const people = [...new Set(userIds)].filter((id) => id !== me.id && onTeam(db.users.find((u) => u.id === id)));
      if (!people.length) throw new Error('Pick at least one teammate');
      const profile = db.player_profiles.find((p) => p.user_id === me.id);
      const thread = {
        id: uid(), title: name, created_by: me.id, author_name: profile?.display_name || me.full_name || null,
        archived: false, visibility: 'private', named, created_date: now(), updated_date: now(),
      };
      db.chat_threads.push(thread);
      for (const id of [me.id, ...people]) {
        db.chat_thread_members.push({ id: uid(), thread_id: thread.id, user_id: id, added_by: me.id, created_date: now(), updated_date: now() });
      }
      save(db);
      notify('chat_threads', 'onInsert', thread);
      return delay(thread);
    },
    // Leaving, and the starter taking someone out (the chat_thread_members delete policy).
    async leave(threadId) {
      requireUser();
      return chat.removeMember(threadId, currentUser().id);
    },
    async removeMember(threadId, userId) {
      requireUser();
      failIfOffline();
      const row = db.chat_thread_members.find((m) => m.thread_id === threadId && m.user_id === userId);
      if (!row) refuse();
      checkChatWrite('chat_thread_members', 'delete', row);
      db.chat_thread_members = db.chat_thread_members.filter((m) => m.id !== row.id);
      save(db);
      notify('chat_thread_members', 'onDelete', { id: row.id });
      return delay(null);
    },
    // Same as the database's chat_add_members().
    async addMembers(threadId, userIds) {
      requireUser();
      failIfOffline();
      const me = currentUser();
      const thread = threadOf(threadId);
      if (thread?.visibility !== 'private' || !inChat(threadId, me.id)) throw new Error("You're not in that chat");
      if (thread.archived) throw new Error('That chat is closed');
      for (const id of new Set(userIds)) {
        if (inChat(threadId, id) || !onTeam(db.users.find((u) => u.id === id))) continue;
        const row = { id: uid(), thread_id: threadId, user_id: id, added_by: me.id, created_date: now(), updated_date: now() };
        db.chat_thread_members.push(row);
        notify('chat_thread_members', 'onInsert', row);
      }
      save(db);
      return delay(null);
    },
    async markRead(threadId, readAt) {
      requireUser();
      const me = currentUser();
      const read = db.chat_reads.find((r) => r.user_id === me.id && (r.thread_id ?? null) === threadId);
      if (!read) db.chat_reads.push({ id: uid(), user_id: me.id, thread_id: threadId, last_read_at: readAt, created_date: now(), updated_date: now() });
      else if (readAt > read.last_read_at) Object.assign(read, { last_read_at: readAt, updated_date: now() });
      save(db);
    },
    async viewing() {
      requireUser();
    },
  };

  // Same as the database functions mark_dues_paid(), set_dues_partner() and
  // link_team_guest(). Ids can be app players' or guests' (roster players who haven't joined yet).
  const isGuest = (id) => db.team_guests.some((g) => g.id === id);
  const playerKey = (id) => (isGuest(id) ? { user_id: null, guest_id: id } : { user_id: id, guest_id: null });

  const dues = {
    async markPaid({ year, session, userIds, paid, paidDate, amounts }) {
      requireUser();
      const me = currentUser().id;
      if (amounts && amounts.length !== userIds.length) throw new Error('Each player needs an amount');
      if (amounts?.some((a) => a != null && a < 0)) throw new Error("An amount can't be less than $0");
      const where = { season_year: Number(year), session: Number(session) };
      userIds.forEach((id, i) => {
        const key = playerKey(id);
        const amount = paid ? amounts?.[i] ?? null : null;
        const patch = { paid, paid_date: paid ? paidDate : null, paid_by: paid ? me : null, paid_amount: amount, updated_date: now() };
        const row = db.dues_payments.find((p) => matches(p, where) && (p.user_id ?? p.guest_id) === id);
        // Only a real change: marking a paid player paid again keeps their original date, unless their
        // share has gone up since and this pays the difference.
        const toppingUp = paid && row?.paid && row.paid_amount != null && amount != null && Number(row.paid_amount) < amount;
        if (!!row?.paid === paid && !toppingUp) return;
        if (row) Object.assign(row, patch);
        else db.dues_payments.push({ id: uid(), ...where, ...key, override_amount: null, created_date: now(), ...patch });
        db.dues_history.push({
          id: uid(), ...where, ...key, paid, paid_date: patch.paid_date, paid_amount: amount, changed_by: me, created_date: now(),
        });
      });
      save(db);
      return delay(null);
    },
    async setPartner(userId, partnerId) {
      requireUser();
      failIfOffline();
      const ids = [userId, partnerId].filter(Boolean);
      // Everyone whose partner changes, for the session lists that follow it.
      const changed = [];
      db.player_profiles.forEach((p) => {
        if ([p.user_id, p.pays_with, p.pays_with_guest].some((id) => ids.includes(id))) {
          Object.assign(p, { pays_with: null, pays_with_guest: null });
          changed.push({ user_id: p.user_id });
        }
      });
      db.team_guests.forEach((g) => {
        if ([g.id, g.pays_with_user, g.pays_with_guest].some((id) => ids.includes(id))) {
          Object.assign(g, { pays_with_user: null, pays_with_guest: null });
          changed.push({ guest_id: g.id });
        }
      });
      if (partnerId && partnerId !== userId) {
        const point = (self, other) => {
          const user = isGuest(other) ? null : other;
          const guest = isGuest(other) ? other : null;
          db.player_profiles.filter((p) => p.user_id === self).forEach((p) => Object.assign(p, { pays_with: user, pays_with_guest: guest }));
          db.team_guests.filter((g) => g.id === self).forEach((g) => Object.assign(g, { pays_with_user: user, pays_with_guest: guest }));
        };
        point(userId, partnerId);
        point(partnerId, userId);
      }
      changed.forEach(followCouple);
      save(db);
      return delay(null);
    },
    // Same as the database's set_session_partner(): captains fix who paid together in a
    // session that's over (or before), that session only.
    async setSessionPartner({ year, session }, userId, partnerId) {
      requireUser();
      failIfOffline();
      if (currentUser().role !== 'admin') throw new Error('Only captains can change who paid together in a past session');
      const period = { year: Number(year), session: Number(session) };
      if (followsCouples(period)) throw new Error("That session isn't over: who pays together there follows who pays together now");
      const list = db.session_roster.filter((r) => sessionOf(r) === `${period.year}-${period.session}`);
      const entryOf = (id) => list.find((r) => (r.user_id ?? r.guest_id) === id);
      if (!entryOf(userId) || (partnerId && !entryOf(partnerId))) throw new Error(`They weren't on session ${period.session}`);
      const ids = [userId, partnerId].filter(Boolean);
      list
        .filter((r) => [r.user_id, r.guest_id, r.pays_with_user, r.pays_with_guest].some((id) => id && ids.includes(id)))
        .forEach((r) => Object.assign(r, { pays_with_user: null, pays_with_guest: null, updated_date: now() }));
      if (partnerId && partnerId !== userId) {
        const point = (self, other) =>
          Object.assign(entryOf(self), {
            pays_with_user: isGuest(other) ? null : other,
            pays_with_guest: isGuest(other) ? other : null,
            updated_date: now(),
          });
        point(userId, partnerId);
        point(partnerId, userId);
      }
      save(db);
      return delay(null);
    },
  };

  // Same as the database's save_game_result(): everything is checked first, so
  // a save goes through whole or not at all.
  const games = {
    async saveResult(gameId, { scoreUs, scoreThem, lines, fillIns }) {
      requireUser();
      failIfOffline();
      if (currentUser().role !== 'admin') throw new Error('Only captains can enter results');
      const game = db.games.find((g) => g.id === gameId);
      if (!game) throw new Error('That game is gone');
      const counts = (row) => ['goals', 'assists', 'blue_cards', 'red_cards'].map((k) => Number(row[k]) || 0);
      if ([...lines, ...(fillIns || [])].some((row) => counts(row).some((n) => n < 0))) throw new Error("Numbers can't go below zero");

      const opensVoting = !game.has_result && !game.potm_opened_at;
      Object.assign(game, { score_us: scoreUs, score_them: scoreThem, has_result: true, updated_date: now() });
      if (opensVoting) openVoting(game);
      for (const line of lines) {
        const who = { user_id: line.user_id ?? null, guest_id: line.guest_id ?? null };
        const mine = (s) => s.game_id === gameId && (s.user_id ?? null) === who.user_id && (s.guest_id ?? null) === who.guest_id;
        const [goals, assists, blue_cards, red_cards] = counts(line);
        const keep = !!line.played || goals + assists + blue_cards + red_cards > 0;
        const row = db.game_stats.find(mine);
        if (!keep) db.game_stats = db.game_stats.filter((s) => !mine(s));
        else if (row) Object.assign(row, { played: !!line.played, goals, assists, blue_cards, red_cards, updated_date: now() });
        else {
          db.game_stats.push({
            id: uid(), game_id: gameId, ...who, played: !!line.played, goals, assists, blue_cards, red_cards, created_date: now(), updated_date: now(),
          });
        }
      }
      if (fillIns) {
        const keepIds = fillIns.filter((f) => f.id).map((f) => f.id);
        db.game_fill_ins = db.game_fill_ins.filter((f) => f.game_id !== gameId || keepIds.includes(f.id));
        for (const f of fillIns) {
          const fields = { display_name: f.display_name?.trim() || null, gender: f.gender, goals: Number(f.goals) || 0, assists: Number(f.assists) || 0 };
          const row = f.id && db.game_fill_ins.find((r) => r.id === f.id);
          if (row) Object.assign(row, fields, { updated_date: now() });
          else db.game_fill_ins.push({ id: uid(), game_id: gameId, ...fields, created_date: now(), updated_date: now() });
        }
      }
      save(db);
      return delay(null);
    },
  };

  // Same as the database's roster_refresh_asked(): an asked session's list brought up
  // to date the way it would start today (players who joined since added, anyone not
  // answered on their status right now, anyone taken off the team off and no longer
  // answered). Not recorded as a dues change.
  const refreshAsked = (period) => {
    const rows = db.session_roster.filter((r) => sessionOf(r) === `${period.year}-${period.session}`);
    const bringUp = (who, row, record) => {
      const nowStatus = record.removed ? 'off' : record.status;
      if (!row) {
        if (!record.removed) {
          db.session_roster.push(
            withCouple({
              id: uid(), season_year: Number(period.year), session: Number(period.session), user_id: null, guest_id: null, ...who,
              status: record.status, answered_at: null, changed_by: null, created_date: now(), updated_date: now(),
            }),
          );
        }
      } else if ((!row.answered_at || record.removed) && (row.status !== nowStatus || row.answered_at)) {
        Object.assign(row, { status: nowStatus, answered_at: record.removed ? null : row.answered_at, updated_date: now() });
      }
    };
    db.player_profiles.forEach((p) => bringUp({ user_id: p.user_id }, rows.find((r) => r.user_id === p.user_id), p));
    db.team_guests
      .filter((g) => !g.linked_user_id)
      .forEach((g) => bringUp({ guest_id: g.id }, rows.find((r) => r.guest_id === g.id), g));
  };

  // Same as the database's roster_apply_asked(): an asked session that has just become
  // the current one is checked once more (above), and the answers given ahead become
  // everyone's status, also when captains stopped asking. None of it is recorded as a dues change.
  const applyAsked = (period) => {
    const ask = db.session_asks.find((a) => samePeriod({ year: a.season_year, session: a.session }, period) && !a.applied_at);
    if (!ask) return;
    Object.assign(ask, { applied_at: now(), updated_date: now() });
    refreshAsked(period);
    const rows = db.session_roster.filter((r) => sessionOf(r) === `${period.year}-${period.session}` && r.answered_at && r.status !== 'off');
    for (const row of rows) {
      const record = row.user_id
        ? db.player_profiles.find((p) => p.user_id === row.user_id)
        : db.team_guests.find((g) => g.id === row.guest_id && !g.linked_user_id);
      if (record && !record.removed && record.status !== row.status) Object.assign(record, { status: row.status, updated_date: now() });
    }
  };

  // Same as the database's roster_start_current(), roster_ask() and roster_answer().
  const roster = {
    async start() {
      requireUser();
      const period = current();
      startSession(period);
      applyAsked(period);
      // Repair lists saved before stopped questions kept following today's roster.
      // This doesn't apply answers to profiles or reopen the question.
      for (const ask of db.session_asks.filter((a) => !a.starts_on && isEarlier(period, { year: a.season_year, session: a.session }))) {
        const ahead = { year: ask.season_year, session: ask.session };
        if (db.session_roster.some((r) => sessionOf(r) === `${ahead.year}-${ahead.session}`)) refreshAsked(ahead);
      }
      save(db);
      return delay({ season_year: Number(period.year), session: Number(period.session), over: !open() });
    },
    // Captains ask "Playing session N?" about a session that hasn't started, with its
    // first game's date (again: a new date; none: stop asking). Its list starts now;
    // after stopping, unanswered players still follow today's statuses.
    async ask({ year, session, startsOn }) {
      requireUser();
      failIfOffline();
      if (currentUser().role !== 'admin') throw new Error("Only captains can ask who's playing");
      const period = { year: Number(year), session: Number(session) };
      if (isEarlier(period, current())) throw new Error('That session is over');
      if (started(period)) throw new Error('That session has already started');
      const ask = db.session_asks.find((a) => samePeriod({ year: a.season_year, session: a.session }, period));
      if (ask) {
        Object.assign(ask, { starts_on: startsOn || null, asked_by: currentUser().id, applied_at: startsOn ? ask.applied_at : null, updated_date: now() });
      } else {
        db.session_asks.push({
          id: uid(), season_year: period.year, session: period.session, starts_on: startsOn || null, asked_by: currentUser().id,
          applied_at: null, created_date: now(), updated_date: now(),
        });
      }
      if (startsOn) {
        startSession(period);
        refreshAsked(period);
      }
      save(db);
      return delay(null);
    },
    // Your answer to "Playing session N?": for the current session it's your status (the
    // list follows it); for one asked about ahead it goes in that session's list only.
    async answer({ year, session, status }) {
      requireUser();
      failIfOffline();
      if (!['active', 'sub_pool', 'on_break'].includes(status)) throw new Error("Pick Playing, Available to sub or Unavailable");
      const me = currentUser();
      const profile = db.player_profiles.find((p) => p.user_id === me.id && !p.removed);
      if (!profile) throw new Error('Make your profile first');
      const period = { year: Number(year), session: Number(session) };
      if (started(period)) throw new Error('That session has already started');
      const cur = current();
      if (samePeriod(period, cur)) {
        Object.assign(profile, { status, updated_date: now() });
        followStatus('player_profiles', profile);
      } else {
        const asked = db.session_asks.some((a) => samePeriod({ year: a.season_year, session: a.session }, period) && a.starts_on);
        if (!asked || isEarlier(period, cur)) throw new Error('Nobody has asked about that session yet');
        startSession(period);
        setEntry(period, { user_id: me.id }, status);
      }
      save(db);
      return delay(null);
    },
  };

  // Previews can't receive real notifications (there's no sender); lib/push.js
  // shows a local sample instead, so the flow can still be tried.
  const push = {
    async publicKey() {
      return null;
    },
    async save() {},
    async remove() {},
    async test() {
      return { sent: 0, failed: 0 };
    },
  };

  return {
    mode: 'demo',
    auth,
    entities,
    users,
    chat,
    dues,
    games,
    roster,
    push,
    resetDemo() {
      db = seed();
      save(db);
    },
  };
}
