// Demo backend: same interface as the Supabase backend, with sample data kept
// in this browser's localStorage. Used when no Supabase keys are configured,
// so the app can be tried (and developed) before the real backend exists.
import dayjs from 'dayjs';
import { TABLES, parseSort } from './tables';

const DB_KEY = 'jt_demo_db_v3';
const SESSION_KEY = 'jt_demo_session';
export const DEMO_LOGIN = { email: 'captain@demo.test', password: 'demo1234' };

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
    role: i === 0 ? 'admin' : 'user',
  }));
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
    is_captain: i === 0,
    created_date: now(),
    updated_date: now(),
  }));

  const opponents = ['Net Ninjas', 'Grass Kickers', 'Ball Busters', 'The Hat Tricks', 'Goal Diggers', 'FC Lightning'];
  const year = dayjs().year();
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
  // A game from last year so the stats pages have history.
  games.push({
    id: uid(), season_year: year - 1, session: 3, date: `${year - 1}-11-14`, time: '19:00', field_number: '2',
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
  const thread = (starter, title, ago, extra = {}) => {
    const row = { id: uid(), title, created_by: starter.user_id, author_name: starter.display_name, archived: false, created_date: minutesAgo(ago), updated_date: minutesAgo(ago), ...extra };
    threads.push(row);
    return row.id;
  };
  const say = (threadId, p, body, ago, replyTo = null) => {
    const row = { id: uid(), thread_id: threadId, reply_to_id: replyTo, user_id: p.user_id, author_name: p.display_name, body, created_date: minutesAgo(ago), updated_date: minutesAgo(ago) };
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
  const bottle = say(null, profiles[2], 'Also, who grabbed my water bottle? Blue Hydro Flask', 1555);
  say(null, profiles[3], 'I have it! Bringing it Thursday', 1500, bottle);
  const pinnies = say(null, profiles[1], 'Who is bringing the pinnies this week?', 180);
  react(say(null, profiles[4], 'I got them 👍', 170, pinnies), '🙏', [profiles[1]]);
  react(say(null, profiles[6], 'Running 10 min late, start without me in goal', 60), '😂', [profiles[4], profiles[5]]);
  react(say(null, me, 'Reminder: dues for session 2 are due before the first game!', 30), '👍', [profiles[1], profiles[2], profiles[4], profiles[3]]);
  readUpTo(null, 30);
  say(null, profiles[5], 'Paid 💸', 12);
  say(null, profiles[11], 'Parking tip for the new folks: the back lot is closer to the indoor fields https://www.google.com/maps/search/?api=1&query=North+Coast+Premier+Soccer+Complex', 10);
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
  say(fantasy, profiles[10], 'Me!!', 85);
  say(fantasy, profiles[9], 'Count me in 🙋‍♀️', 40);

  const food = thread(profiles[3], '🍕 Post-game food spot', 2900);
  say(food, profiles[3], "Where are we going after Thursday's game?", 2900);
  say(food, me, 'Wings place on Lake Rd?', 2880);
  react(say(food, profiles[11], 'Yes please 🍗', 2870), '🙌', [profiles[3], me]);
  readUpTo(food, 2870);

  const jerseys = thread(me, '🎽 Jersey order', 7200, { archived: true });
  say(jerseys, me, 'Last call for jersey sizes. The order goes in Friday.', 7200);
  say(jerseys, profiles[5], 'Medium for me!', 7100);
  say(jerseys, me, 'Order placed, thanks all. Closing this one.', 7000);
  readUpTo(jerseys, 7000);

  return {
    users,
    player_profiles: profiles,
    games,
    rsvps,
    game_stats: stats,
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
        created_date: now(),
        updated_date: now(),
      },
    ],
    session_dues: [],
    dues_payments: [],
    messages,
    chat_threads: threads,
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

export function createDemoBackend() {
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
  const setSession = (id) => {
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    authListeners.forEach((cb) => setTimeout(() => cb(id ? 'SIGNED_IN' : 'SIGNED_OUT'), 0));
  };
  const currentUser = () => db.users.find((u) => u.id === sessionUserId()) || null;
  const requireUser = () => {
    if (!currentUser()) throw new Error('Not signed in');
  };

  // Same rules as the Supabase filter: null matches empty columns, an array matches any of its values.
  const matches = (row, where) =>
    Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : (row[k] ?? null) === v));
  const notify = (table, event, row) =>
    (listeners[table] || []).forEach((l) => l[event] && setTimeout(() => l[event](structuredClone(row)), 0));
  const sortRows = (rows, sort) => {
    const { column, ascending } = parseSort(sort);
    return [...rows].sort((a, b) => {
      const x = a[column] ?? '';
      const y = b[column] ?? '';
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return ascending ? cmp : -cmp;
    });
  };

  function entity(table) {
    const write = () => save(db);
    return {
      async list(sort, limit) {
        requireUser();
        const rows = sortRows(db[table], sort);
        return delay(limit ? rows.slice(0, limit) : rows);
      },
      async filter(where, sort, limit) {
        requireUser();
        const rows = sortRows(db[table].filter((r) => matches(r, where)), sort);
        return delay(limit ? rows.slice(0, limit) : rows);
      },
      async create(row) {
        requireUser();
        const record = { id: uid(), created_date: now(), updated_date: now(), ...row };
        db[table].push(record);
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
        const record = db[table].find((r) => r.id === id);
        if (!record) throw new Error('Not found');
        Object.assign(record, patch, { updated_date: now() });
        write();
        notify(table, 'onUpdate', record);
        return delay(record);
      },
      bulkUpdate(rows) {
        return Promise.all(rows.map(({ id, ...patch }) => this.update(id, patch)));
      },
      async delete(id) {
        requireUser();
        db[table] = db[table].filter((r) => r.id !== id);
        if (table === 'games') {
          for (const child of ['rsvps', 'game_stats', 'potm_votes']) db[child] = db[child].filter((r) => r.game_id !== id);
        }
        // Mirrors the foreign keys: a thread takes its messages and read markers
        // with it, a message its reactions; replies to it lose the link.
        const goneMessages = new Set(table === 'messages' ? [id] : []);
        if (table === 'chat_threads') {
          db.messages.filter((m) => m.thread_id === id).forEach((m) => goneMessages.add(m.id));
          db.messages = db.messages.filter((m) => m.thread_id !== id);
          db.chat_reads = db.chat_reads.filter((r) => r.thread_id !== id);
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
      subscribe(onInsert, { onUpdate, onDelete } = {}) {
        const listener = { onInsert, onUpdate, onDelete };
        listeners[table] = listeners[table] || [];
        listeners[table].push(listener);
        return () => {
          listeners[table] = listeners[table].filter((l) => l !== listener);
        };
      },
    };
  }

  const entities = Object.fromEntries(Object.entries(TABLES).map(([name, table]) => [name, entity(table)]));

  const auth = {
    async me() {
      const user = currentUser();
      return user ? delay({ id: user.id, email: user.email, full_name: user.full_name, role: user.role }) : null;
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
      const user = { id: uid(), email: email.trim(), password, full_name: '', role: 'user' };
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

  const users = {
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
      const rows = sortRows(
        db.messages.filter((m) => (m.thread_id ?? null) === threadId && (!before || m.created_date < before)),
        '-created_date',
      );
      return delay(rows.slice(0, limit).reverse());
    },
    async overview() {
      requireUser();
      const me = currentUser();
      const rooms = new Map();
      for (const m of sortRows(db.messages, 'created_date')) {
        const threadId = m.thread_id ?? null;
        if (!rooms.has(threadId)) {
          const read = db.chat_reads.find((r) => r.user_id === me.id && (r.thread_id ?? null) === threadId);
          rooms.set(threadId, { thread_id: threadId, last_read_at: read?.last_read_at ?? null, unread: 0 });
        }
        const room = rooms.get(threadId);
        Object.assign(room, {
          last_message_at: m.created_date,
          last_user_id: m.user_id,
          last_author_name: m.author_name,
          last_body: m.body.slice(0, 140),
        });
        if (m.user_id !== me.id && (!room.last_read_at || m.created_date > room.last_read_at)) room.unread += 1;
      }
      return delay([...rooms.values()]);
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
    push,
    resetDemo() {
      db = seed();
      save(db);
    },
  };
}
