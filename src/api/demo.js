// Demo backend: same interface as the Supabase backend, with sample data kept
// in this browser's localStorage. Used when no Supabase keys are configured,
// so the app can be tried (and developed) before the real backend exists.
import dayjs from 'dayjs';
import { TABLES, parseSort } from './tables';

const DB_KEY = 'jt_demo_db_v1';
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
  const messages = [
    [profiles[1], 'Who is bringing the pinnies this week?', 180],
    [profiles[4], 'I got them 👍', 170],
    [profiles[6], 'Running 10 min late, start without me in goal', 60],
    [profiles[0], 'Reminder: dues for session 2 are due before the first game!', 30],
  ].map(([p, body, ago]) => ({ id: uid(), user_id: p.user_id, author_name: p.display_name, body, created_date: minutesAgo(ago), updated_date: minutesAgo(ago) }));

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
        quick_hits: ['No slide tackles', 'Men max 2 goals per game', '3 women on the field at all times', 'Blue card = 2 minutes off'],
        rules_bullets: ['Sample rule text — captains can replace these on the Rules page.', 'Kick-ins instead of throw-ins.', 'Goalies may not punt the ball over half.'],
        rules_footer: 'Sample data — this is demo mode.',
        created_date: now(),
        updated_date: now(),
      },
    ],
    session_dues: [],
    dues_payments: [],
    messages,
    announcements: [
      { id: uid(), title: 'Welcome to the new team hub', body: 'This is demo mode with sample data. Once Supabase is connected you will see the real team here.', author_name: 'Casey Captain', created_date: minutesAgo(600), updated_date: minutesAgo(600) },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
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

  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
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
      async filter(where, sort) {
        requireUser();
        return delay(sortRows(db[table].filter((r) => matches(r, where)), sort));
      },
      async create(row) {
        requireUser();
        const record = { id: uid(), created_date: now(), updated_date: now(), ...row };
        db[table].push(record);
        write();
        (listeners[table] || []).forEach((cb) => setTimeout(() => cb(structuredClone(record)), 0));
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
        write();
        return delay(null);
      },
      subscribe(onInsert) {
        listeners[table] = listeners[table] || [];
        listeners[table].push(onInsert);
        return () => {
          listeners[table] = listeners[table].filter((cb) => cb !== onInsert);
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

  return {
    mode: 'demo',
    auth,
    entities,
    users,
    resetDemo() {
      db = seed();
      save(db);
    },
  };
}
