import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DEFAULT_SETTINGS, SEASON_TURNS_MONTH } from './constants';

dayjs.extend(customParseFormat);

export const venueText = (settings) =>
  [settings?.venue_name, settings?.venue_address].filter(Boolean).join(', ');

export const mapsUrl = (query) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || '')}`;

export const fmtDateShort = (date) => (date ? dayjs(date, 'YYYY-MM-DD').format('ddd, MMM D') : '');

export const fmtDateLong = (date) => (date ? dayjs(date, 'YYYY-MM-DD').format('dddd, MMMM D') : '');

export const fmtTime = (time) => {
  if (!time) return '';
  const parsed = dayjs(time, ['HH:mm', 'H:mm', 'h:mm A', 'hh:mm A'], true);
  return parsed.isValid() ? parsed.format('h:mm A') : time;
};

export const today = () => dayjs().format('YYYY-MM-DD');

/** A season is filed under the year it starts in, and runs into the next: 2026 is "2026–27". */
export const seasonName = (year) => `${year}–${String((Number(year) + 1) % 100).padStart(2, '0')}`;

export const seasonLabel = (year, session) => `${seasonName(year)} · Session ${session}`;

/** The season a date (YYYY-MM-DD) belongs to: January to April count for the one that started the November before. */
export const seasonOf = (date) => {
  const [year, month] = date.split('-').map(Number);
  return month >= SEASON_TURNS_MONTH ? year : year - 1;
};

/**
 * The session a date (YYYY-MM-DD) is in: November and December are its season's first, January and February the
 * second, March and April the third. May to October count for the first of the season coming up.
 */
export const sessionOf = (date) => {
  const month = Number(date.split('-')[1]);
  return { year: seasonOf(date), session: month >= SEASON_TURNS_MONTH ? 1 : month <= 2 ? 2 : 3 };
};

/** The calendar year a month (1-12) falls in during a season: November and December are its first year, January to April the next. */
export const yearInSeason = (season, month) => (month >= SEASON_TURNS_MONTH ? Number(season) : Number(season) + 1);

export const jerseyText = (jersey, settings) =>
  jersey === 'backup'
    ? settings?.backup_jersey || DEFAULT_SETTINGS.backup_jersey
    : settings?.primary_jersey || DEFAULT_SETTINGS.primary_jersey;

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/** "Jane Q Public" -> "Jane P." */
export const shortName = (name = '') => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return 'Player';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

export const plural = (n, word, pluralWord = `${word}s`) => (n === 1 ? word : pluralWord);
