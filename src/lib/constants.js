export const SESSIONS = [1, 2, 3];

export const POSITIONS = ['Forward', 'Mid-Field', 'Defense', 'Goalie'];

export const STATUS_LABEL = { active: 'Active', on_break: 'On Break', sub_pool: 'Sub Pool' };

export const STATUS_CLASS = {
  active: 'bg-lime-400 text-black',
  on_break: 'bg-zinc-200 text-zinc-600',
  sub_pool: 'bg-amber-300 text-black',
};

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_break', label: 'On Break' },
  { value: 'sub_pool', label: 'Sub Pool' },
];

export const DEFAULT_SETTINGS = {
  primary_jersey: 'Bright green/yellow',
  backup_jersey: 'Black',
  venue_name: 'North Coast Premier Soccer Complex',
  venue_address: '8809 Lake Rd, Seville, OH',
  min_players: 8,
  min_women: 3,
  potm_mode: 'separate',
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
