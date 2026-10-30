// Entity name (as the pages use it) -> database table.
export const TABLES = {
  Game: 'games',
  Rsvp: 'rsvps',
  GameStat: 'game_stats',
  GameFillIn: 'game_fill_ins',
  PotmVote: 'potm_votes',
  PlayerProfile: 'player_profiles',
  TeamSettings: 'team_settings',
  SessionDues: 'session_dues',
  DuesPayment: 'dues_payments',
  DuesHistory: 'dues_history',
  DuesChange: 'dues_changes',
  TeamGuest: 'team_guests',
  TeamGuestLink: 'team_guest_links',
  TeamNameCheck: 'team_name_checks',
  SessionRoster: 'session_roster',
  SessionAsk: 'session_asks',
  TeamJoinCode: 'team_join_code',
  Message: 'messages',
  ChatThread: 'chat_threads',
  ChatThreadMember: 'chat_thread_members',
  MessageReaction: 'message_reactions',
  ChatRead: 'chat_reads',
  Announcement: 'announcements',
  AnnouncementRead: 'announcement_reads',
};

/** '-date' -> { column: 'date', ascending: false } */
export function parseSort(sort) {
  if (!sort) return { column: 'created_date', ascending: true };
  return sort.startsWith('-')
    ? { column: sort.slice(1), ascending: false }
    : { column: sort, ascending: true };
}
