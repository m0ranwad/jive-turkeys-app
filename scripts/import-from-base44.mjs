#!/usr/bin/env node
// One-time copy of the team's data from the Base44 app into Supabase.
//
// Put SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (see .env.example), then:
//   npm run import:base44 -- --dry-run      # look first
//   npm run import:base44                   # then copy
//
// Optional: BASE44_TOKEN=... if the Base44 data stops being readable without
// a login (sign in to the old site, then in the browser console run
// localStorage.getItem('base44_access_token')).
//
// Each player gets a Supabase login with the same email and no password; they
// sign in with Google or use "Forgot password?" the first time. Tables that
// already have data in Supabase are skipped, so it's safe to re-run.
import { createClient } from '@supabase/supabase-js';

const BASE44_APP_URL = process.env.BASE44_APP_URL || 'https://jive-turkey-tactics.base44.app';
const BASE44_APP_ID = process.env.BASE44_APP_ID || '6ac511a0bebc9dfbfd6eef25';
const DRY_RUN = process.argv.includes('--dry-run');

const { SUPABASE_URL, BASE44_TOKEN } = process.env;
// sb_secret_... key, or the legacy service_role key.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SECRET_KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (Supabase: Project Settings -> API Keys), or pass --dry-run.');
  process.exit(1);
}

const supabase = DRY_RUN
  ? null
  : createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchEntity(name) {
  const rows = [];
  const pageSize = 500;
  for (let skip = 0; ; skip += pageSize) {
    const url = `${BASE44_APP_URL}/api/apps/${BASE44_APP_ID}/entities/${name}?limit=${pageSize}&skip=${skip}`;
    const res = await fetch(url, { headers: BASE44_TOKEN ? { Authorization: `Bearer ${BASE44_TOKEN}` } : {} });
    if (!res.ok) throw new Error(`Base44 ${name}: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    // Base44 seeds sample rows into new apps; they aren't team data.
    rows.push(...page.filter((r) => !r.is_sample));
    if (page.length < pageSize) return rows;
  }
}

async function tableIsEmpty(table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count === 0;
}

async function insert(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function existingUsersByEmail() {
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users: ${error.message}`);
    data.users.forEach((u) => u.email && byEmail.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) return byEmail;
  }
}

const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
const numberOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

async function main() {
  console.log(`Reading from ${BASE44_APP_URL}${DRY_RUN ? ' (dry run — nothing will be written)' : ''}\n`);
  const names = ['PlayerProfile', 'TeamSettings', 'Game', 'Rsvp', 'GameStat', 'PotmVote', 'SessionDues', 'DuesPayment', 'Message', 'Announcement'];
  const src = {};
  for (const name of names) {
    src[name] = await fetchEntity(name);
    console.log(`  ${name.padEnd(14)} ${src[name].length} rows`);
  }

  // --- Players -> Supabase logins -----------------------------------------
  const userIdMap = new Map(); // Base44 user id -> Supabase user id
  const existing = DRY_RUN ? new Map() : await existingUsersByEmail();
  const newlyCreated = new Set();
  console.log('\nPlayers');
  for (const p of src.PlayerProfile) {
    const email = (p.email || '').trim().toLowerCase();
    if (!email) {
      console.log(`  skip ${p.display_name}: no email on profile`);
      continue;
    }
    let id = existing.get(email);
    if (!id && !DRY_RUN) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: p.display_name },
      });
      if (error) throw new Error(`creating ${email}: ${error.message}`);
      id = data.user.id;
      newlyCreated.add(id);
    }
    userIdMap.set(p.user_id, id || `(new login for ${email})`);
    console.log(`  ${p.display_name} <${email}>${existing.has(email) ? ' — already has a login' : ' — login created'}`);
  }

  if (!DRY_RUN) {
    // Roles: imported players take their captain flag; never demote anyone
    // who already had a login (e.g. whoever set up Supabase).
    for (const p of src.PlayerProfile) {
      const id = userIdMap.get(p.user_id);
      if (!id) continue;
      if (p.is_captain) await supabase.from('users').update({ role: 'admin' }).eq('id', id);
      else if (newlyCreated.has(id)) await supabase.from('users').update({ role: 'user' }).eq('id', id);
    }

    const profiles = src.PlayerProfile.filter((p) => userIdMap.get(p.user_id)).map((p) => ({
      user_id: userIdMap.get(p.user_id),
      email: p.email,
      display_name: p.display_name || 'Player',
      gender: p.gender === 'F' || p.gender === 'M' ? p.gender : null,
      phone: p.phone || '',
      position: p.position || null,
      year_joined: numberOrNull(p.year_joined),
      status: ['active', 'on_break', 'sub_pool'].includes(p.status) ? p.status : 'active',
      created_date: p.created_date,
    }));
    const { error } = await supabase.from('player_profiles').upsert(profiles, { onConflict: 'user_id' });
    if (error) throw new Error(`player_profiles: ${error.message}`);
  }

  // --- Team settings ---------------------------------------------------------
  const settings = src.TeamSettings[0];
  if (settings && !DRY_RUN) {
    const row = pick(settings, [
      'primary_jersey', 'backup_jersey', 'venue_name', 'venue_address', 'min_players', 'min_women',
      'potm_mode', 'email_reminders', 'rules_intro', 'quick_hits', 'rules_bullets', 'rules_footer',
    ]);
    row.email_reminders = !!row.email_reminders;
    row.quick_hits = row.quick_hits || [];
    row.rules_bullets = row.rules_bullets || [];
    const { data: current } = await supabase.from('team_settings').select('id').limit(1);
    const { error } = current?.[0]
      ? await supabase.from('team_settings').update(row).eq('id', current[0].id)
      : await supabase.from('team_settings').insert(row);
    if (error) throw new Error(`team_settings: ${error.message}`);
  }

  // --- Everything else ---------------------------------------------------------
  const user = (oldId) => {
    const id = userIdMap.get(oldId);
    return id && !id.startsWith('(') ? id : null;
  };
  const gameIdMap = new Map(src.Game.map((g) => [g.id, crypto.randomUUID()]));
  const dropped = {};
  const keep = (table, rows) => {
    const valid = rows.filter(Boolean);
    if (valid.length < rows.length) dropped[table] = rows.length - valid.length;
    return valid;
  };

  const plan = {
    games: src.Game.map((g) => ({
      id: gameIdMap.get(g.id),
      season_year: numberOrNull(g.season_year) ?? new Date().getFullYear(),
      session: numberOrNull(g.session) ?? 1,
      date: g.date,
      time: g.time || '',
      field_number: g.field_number == null ? '' : String(g.field_number),
      opponent: g.opponent || 'Unknown',
      location: g.location || '',
      jersey: g.jersey === 'backup' ? 'backup' : 'primary',
      notes: g.notes || '',
      has_result: !!g.has_result,
      score_us: numberOrNull(g.score_us),
      score_them: numberOrNull(g.score_them),
      created_date: g.created_date,
    })),
    rsvps: keep('rsvps', src.Rsvp.map((r) =>
      gameIdMap.has(r.game_id) && user(r.user_id) && ['in', 'out', 'maybe'].includes(r.status)
        ? { game_id: gameIdMap.get(r.game_id), user_id: user(r.user_id), status: r.status, playing_gk: !!r.playing_gk, created_date: r.created_date }
        : null,
    )),
    game_stats: keep('game_stats', src.GameStat.map((s) =>
      gameIdMap.has(s.game_id) && user(s.user_id)
        ? {
            game_id: gameIdMap.get(s.game_id), user_id: user(s.user_id), played: !!s.played,
            goals: s.goals || 0, assists: s.assists || 0, blue_cards: s.blue_cards || 0, red_cards: s.red_cards || 0,
            created_date: s.created_date,
          }
        : null,
    )),
    potm_votes: keep('potm_votes', src.PotmVote.map((v) =>
      gameIdMap.has(v.game_id) && user(v.voter_id) && user(v.voted_for_id)
        ? { game_id: gameIdMap.get(v.game_id), voter_id: user(v.voter_id), voted_for_id: user(v.voted_for_id), award: v.award, created_date: v.created_date }
        : null,
    )),
    session_dues: src.SessionDues.map((d) => ({
      season_year: numberOrNull(d.season_year), session: numberOrNull(d.session), total_fee: numberOrNull(d.total_fee) ?? 0, created_date: d.created_date,
    })),
    dues_payments: keep('dues_payments', src.DuesPayment.map((p) =>
      user(p.user_id)
        ? {
            season_year: numberOrNull(p.season_year), session: numberOrNull(p.session), user_id: user(p.user_id),
            override_amount: numberOrNull(p.override_amount), paid: !!p.paid, paid_date: p.paid_date || null, created_date: p.created_date,
          }
        : null,
    )),
    messages: src.Message.filter((m) => m.body).map((m) => ({
      user_id: user(m.user_id), author_name: m.author_name || 'Player', body: String(m.body).slice(0, 2000), created_date: m.created_date,
    })),
    announcements: src.Announcement.map((a) => ({
      title: a.title || 'Announcement', body: a.body || '', author_name: a.author_name || 'Captain', created_date: a.created_date,
    })),
  };

  console.log('\nTables');
  const skipped = new Set();
  for (const [table, rows] of Object.entries(plan)) {
    const note = dropped[table] ? ` (${dropped[table]} skipped: game or player not found)` : '';
    if (DRY_RUN) {
      console.log(`  ${table.padEnd(14)} would copy ${rows.length}${note}`);
      continue;
    }
    // RSVPs, stats and votes point at the games copied in this run.
    if (['rsvps', 'game_stats', 'potm_votes'].includes(table) && skipped.has('games')) {
      console.log(`  ${table.padEnd(14)} skipped because games were skipped`);
      continue;
    }
    if (!(await tableIsEmpty(table))) {
      skipped.add(table);
      console.log(`  ${table.padEnd(14)} already has data — skipped`);
      continue;
    }
    await insert(table, rows);
    console.log(`  ${table.padEnd(14)} copied ${rows.length}${note}`);
  }

  console.log(DRY_RUN ? '\nDry run finished. Run again without --dry-run to copy.' : '\nDone.');
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message}`);
  process.exit(1);
});
