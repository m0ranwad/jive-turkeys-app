export const SESSIONS = [1, 2, 3];

// A season runs November to April (session 1 Nov–Dec, 2 Jan–Feb, 3 Mar–Apr) and is
// filed under the year it starts in. From this month (May) on, dates belong to the
// season that starts that November.
export const SEASON_TURNS_MONTH = 5;

export const POSITIONS = ['Forward', 'Mid-Field', 'Defense', 'Goalie'];

export const STATUS_LABEL = { active: 'Playing', on_break: 'Unavailable', sub_pool: 'Available to sub' };

export const STATUS_CLASS = {
  active: 'bg-lime-400 text-black',
  on_break: 'bg-zinc-200 text-zinc-600',
  sub_pool: 'bg-amber-300 text-black',
};

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Playing' },
  { value: 'sub_pool', label: 'Available to sub' },
  { value: 'on_break', label: 'Unavailable' },
];

export const DEFAULT_SETTINGS = {
  primary_jersey: 'Bright green/yellow',
  backup_jersey: 'Black',
  venue_name: 'North Coast Premier Soccer Complex',
  venue_address: '8809 Lake Rd, Seville, OH',
  min_players: 8,
  min_women: 3,
  potm_mode: 'separate',
  // Player of the Match voting: open this many hours after a result is posted,
  // a notification when it opens, a reminder this many hours before it closes
  // (0 is off), and the winners posted in Team Chat when it closes.
  potm_window_hours: 12,
  potm_notify: true,
  potm_reminder_hours: 3,
  potm_announce: true,
  // Game reminders on phones this many hours before kickoff: "Are you in?" and,
  // when we're short, a call for subs.
  game_reminders: true,
  game_reminder_hours: 6,
  email_reminders: false,
  rules_intro: 'SAFE & FAIR PLAY ARE OUR TOP PRIORITY',
  quick_hits: [],
  rules_bullets: [],
  rules_footer: '',
};

export const AWARD_LABEL = {
  overall: 'Player of the Match',
  man: 'Man of the Match',
  woman: 'Woman of the Match',
};

export const CARD = 'rounded-3xl border border-black/5 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

// Popups: an inset card with big rounded corners and a left-aligned display heading.
export const DIALOG = 'max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-md';
export const DIALOG_TITLE = 'font-display text-lg font-extrabold uppercase tracking-tight';
