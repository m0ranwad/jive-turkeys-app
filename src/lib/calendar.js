// "Add to calendar" for one game: an .ics file (iPhone, Outlook, most
// calendars) or a Google Calendar link. Games are in Ohio, so times are read as
// Eastern and written in UTC, which every calendar understands.
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { jerseyText, venueText } from './format';
import { normalizeTime } from './schedule-import';

dayjs.extend(utc);
dayjs.extend(timezone);

const TEAM_ZONE = 'America/New_York';
// Two 25-minute halves and halftime.
export const GAME_MINUTES = 55;

/** Start and end in UTC, or null for a game with no time yet (an all-day event instead). */
function gameTimes(game) {
  const time = normalizeTime(game.time);
  if (!time) return null;
  const start = dayjs.tz(`${game.date} ${time}`, 'YYYY-MM-DD HH:mm', TEAM_ZONE);
  return { start: start.utc(), end: start.add(GAME_MINUTES, 'minute').utc() };
}

/** Schedule shortages become urgent within 48 hours of kickoff, in the team's time zone. */
export function shortageIsUrgent(game, now = new Date()) {
  if (game.has_result) return false;
  const start = gameTimes(game)?.start ?? dayjs.tz(`${game.date} 00:00`, 'America/New_York');
  const hours = start.diff(dayjs(now), 'hour', true);
  return hours >= 0 && hours <= 48;
}

function details(game, settings, link) {
  return {
    title: `Jive Turkeys vs ${game.opponent}`,
    location: game.location || venueText(settings) || '',
    description: [`Field ${game.field_number || 'TBD'} · ${jerseyText(game.jersey, settings)} jersey`, game.notes, `RSVP: ${link}`]
      .filter(Boolean)
      .join('\n'),
  };
}

// iCalendar text: commas, semicolons and backslashes escaped, new lines as \n.
const icsText = (text) => String(text).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
const stamp = (d) => d.format('YYYYMMDD[T]HHmmss[Z]');

/** The game as an .ics file. Its UID is the game's id. */
export function gameIcs(game, settings, link) {
  const { title, location, description } = details(game, settings, link);
  const times = gameTimes(game);
  const day = dayjs(game.date).format('YYYYMMDD');
  const nextDay = dayjs(game.date).add(1, 'day').format('YYYYMMDD');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jive Turkeys//Team Hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${game.id}@jiveturkeys.app`,
    `DTSTAMP:${stamp(dayjs.utc())}`,
    ...(times ? [`DTSTART:${stamp(times.start)}`, `DTEND:${stamp(times.end)}`] : [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDay}`]),
    `SUMMARY:${icsText(title)}`,
    `LOCATION:${icsText(location)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${link}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** A link that opens Google Calendar with the game filled in. */
export function googleCalendarUrl(game, settings, link) {
  const { title, location, description } = details(game, settings, link);
  const times = gameTimes(game);
  const dates = times
    ? `${stamp(times.start)}/${stamp(times.end)}`
    : `${dayjs(game.date).format('YYYYMMDD')}/${dayjs(game.date).add(1, 'day').format('YYYYMMDD')}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, location, details: description });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Hands the .ics to the phone or computer, which offers to add it to the calendar. */
export function downloadIcs(game, settings, link) {
  const blob = new Blob([gameIcs(game, settings, link)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jive-turkeys-vs-${game.opponent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
