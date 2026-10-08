import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DEFAULT_SETTINGS } from './constants';

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

export const seasonLabel = (year, session) => `${year} · Session ${session}`;

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
