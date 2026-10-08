// Entity name (as the pages use it) -> database table.
export const TABLES = {
  Game: 'games',
  Rsvp: 'rsvps',
  GameStat: 'game_stats',
  PotmVote: 'potm_votes',
  PlayerProfile: 'player_profiles',
  TeamSettings: 'team_settings',
  SessionDues: 'session_dues',
  DuesPayment: 'dues_payments',
  Message: 'messages',
  Announcement: 'announcements',
};

/** '-date' -> { column: 'date', ascending: false } */
export function parseSort(sort) {
  if (!sort) return { column: 'created_date', ascending: true };
  return sort.startsWith('-')
    ? { column: sort.slice(1), ascending: false }
    : { column: sort, ascending: true };
}
