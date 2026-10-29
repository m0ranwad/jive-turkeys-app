export const SESSIONS = [1, 2, 3];

export const TEAM_FOUNDED = 2015;

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

// Popups: an inset card with big rounded corners and a left-aligned display heading. dvh, not vh: on
// iPhones vh counts the screen under Safari's toolbar, which hid the bottom of tall popups.
export const DIALOG = 'max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-3xl p-5 sm:max-w-md';
export const DIALOG_TITLE = 'font-display text-lg font-extrabold uppercase tracking-tight';
// Inside popups: small bold capitals over a section, a field's label, the full-width main button, and a badge
// ("Captain", "You").
export const EYEBROW = 'text-[11px] font-black uppercase tracking-[0.14em]';
export const FIELD_LABEL = 'text-xs font-semibold text-zinc-500';
export const BIG_BUTTON = 'h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]';
export const PILL = 'rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.1em]';
