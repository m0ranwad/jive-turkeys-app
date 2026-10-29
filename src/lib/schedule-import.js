import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { seasonOf, yearInSeason } from './format';

dayjs.extend(customParseFormat);

// Reads a league schedule (.pdf / .xlsx / .xls / .csv) and pulls out date, time,
// field and opponent for each game. Columns are matched by name, so
// "Date", "Game Date", "Start", "Court", "Opponent", "Home"/"Away" all work.
// If the sheet lists both teams (Home/Away), rows that don't involve our team
// are dropped and the other side becomes the opponent.

const OUR_TEAM = /jive|turkey/i;

/** A problem with the file itself, in words a captain can act on. Other errors stay out of sight. */
export class ImportProblem extends Error {}

const HEADER_PATTERNS = {
  date: /\bdate\b|game\s*day/i,
  time: /\btime\b|\bstart\b|kick\s*off/i,
  field: /\bfield\b|\bcourt\b|\bpitch\b|\brink\b|\bfld\b/i,
  opponent: /oppon|\bopp\b|\bvs\.?\b|versus|against/i,
  home: /\bhome\b|team\s*1|team\s*a\b/i,
  away: /\baway\b|visit|guest|team\s*2|team\s*b\b/i,
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAY_PREFIX = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*/i;

const pad = (n) => String(n).padStart(2, '0');

// A date written without a year takes it from the season being imported:
// November and December are its first year, January to April the next.
function fullYear(y, season, month) {
  if (y == null || y === '') return yearInSeason(season, Number(month));
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

function isoDate(y, m, d) {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return dayjs(iso, 'YYYY-MM-DD', true).isValid() ? iso : '';
}

/** Any common date format -> YYYY-MM-DD (or '' if it isn't a date). `season` is the year the season starts in. */
export function normalizeDate(value, season) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (value.getFullYear() < 1901) return '';
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    // Field numbers and time fractions aren't Excel dates. Match the Date
    // branch's lower bound so headerless sheets cannot import games in 1900.
    if (!Number.isFinite(value) || value < 367) return '';
    // Excel serial day number (days since 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value).trim().replace(WEEKDAY_PREFIX, '');
  let m;
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return isoDate(m[1], m[2], m[3]);
  if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?(?!\d)/)))
    return isoDate(fullYear(m[3], season, m[1]), m[1], m[2]);
  if ((m = text.match(/^([a-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,-]+(\d{4}|\d{2})(?!\d))?/i))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return isoDate(fullYear(m[3], season, month + 1), month + 1, m[2]);
  }
  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?(?:[\s,-]+(\d{4}|\d{2})(?!\d))?/i))) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return isoDate(fullYear(m[3], season, month + 1), month + 1, m[1]);
  }
  return '';
}

/** Any common time format -> HH:mm (24h), or '' if none found. */
export function normalizeTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    // A date cell with no time reads as midnight; nobody kicks off at 12:00 AM.
    if (value.getHours() === 0 && value.getMinutes() === 0) return '';
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return '';
    const fraction = value % 1;
    if (fraction === 0 && value >= 1) return '';
    const minutes = Math.round(fraction * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const text = String(value);
  // Consume a boundary rather than using lookbehind (older iPhones load this
  // module too). Never start inside "7.30" or "127:30" and call 30 an hour.
  let m = text.match(/(?:^|[\sT])(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*([ap])\.?\s*m?\.?(?![a-z0-9])/i);
  if (m) {
    if (Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2] || 0) > 59) return '';
    let hours = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') hours += 12;
    return `${pad(hours)}:${m[2] || '00'}`;
  }
  m = text.match(/(?:^|\s|T)(\d{1,2})[:.](\d{2})(?!\d)/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${pad(Number(m[1]))}:${m[2]}`;
  return '';
}

const cellText = (value) => {
  if (value == null) return '';
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD HH:mm');
  return String(value).trim();
};

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const cols = {};
    rows[i].forEach((cell, index) => {
      const text = cellText(cell);
      if (!text || text.length > 40) return;
      for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (cols[key] == null && pattern.test(text)) {
          cols[key] = index;
          break;
        }
      }
    });
    // A bare "Day" column is only the date when there's no "Date" column.
    if (cols.date == null) {
      const dayIndex = rows[i].findIndex((cell) => /^day$/i.test(cellText(cell)));
      if (dayIndex >= 0) cols.date = dayIndex;
    }
    const hasTeams = cols.opponent != null || cols.home != null || cols.away != null;
    if (cols.date != null && (hasTeams || cols.time != null)) return { index: i, cols };
  }
  return null;
}

function opponentFromTeams(home, away) {
  const homeIsUs = OUR_TEAM.test(home);
  const awayIsUs = OUR_TEAM.test(away);
  if (homeIsUs && !awayIsUs) return away;
  if (awayIsUs && !homeIsUs) return home;
  return null;
}

function rowsWithHeader(rows, { index, cols }, season) {
  const games = [];
  let anyMatchedOurTeam = false;
  const pending = [];

  for (const row of rows.slice(index + 1)) {
    const dateCell = row[cols.date];
    const date = normalizeDate(dateCell, season);
    if (!date) continue;
    const time = normalizeTime(cols.time != null ? row[cols.time] : '') || normalizeTime(dateCell);
    const field = cols.field != null ? cellText(row[cols.field]) : '';

    if (cols.opponent != null) {
      games.push({ date, time, field_number: field, opponent: cellText(row[cols.opponent]).replace(/^(vs\.?|@)\s*/i, '') });
      continue;
    }
    const home = cellText(row[cols.home]);
    const away = cellText(row[cols.away]);
    const opponent = opponentFromTeams(home, away);
    if (opponent != null) anyMatchedOurTeam = true;
    pending.push({ date, time, field_number: field, opponent, home, away });
  }

  for (const game of pending) {
    if (game.opponent != null) {
      games.push({ date: game.date, time: game.time, field_number: game.field_number, opponent: game.opponent });
    } else if (!anyMatchedOurTeam) {
      // Team name never appears: the sheet is probably just our games.
      games.push({
        date: game.date,
        time: game.time,
        field_number: game.field_number,
        opponent: [game.home, game.away].filter(Boolean).join(' vs '),
      });
    }
  }
  return games;
}

/** No recognizable header: guess each cell's role from what it looks like. */
function rowsByShape(rows, season) {
  const games = [];
  for (const row of rows) {
    const cells = row.map((c) => ({ raw: c, text: cellText(c) })).filter((c) => c.text);
    const dateCell = cells.find((c) => normalizeDate(c.raw, season));
    if (!dateCell) continue;
    const timeCell = cells.find((c) => c !== dateCell && normalizeTime(c.raw));
    const rest = cells.filter((c) => c !== dateCell && c !== timeCell);
    const field = rest.find((c) => /^[a-z]?\d{1,2}[a-z]?$/i.test(c.text));
    const names = rest.filter((c) => c !== field && /[a-z]/i.test(c.text) && !WEEKDAY_PREFIX.test(`${c.text} `));
    const notUs = names.filter((c) => !OUR_TEAM.test(c.text));
    const opponent = (notUs.length ? notUs : names).sort((a, b) => b.text.length - a.text.length)[0];
    games.push({
      date: normalizeDate(dateCell.raw, season),
      time: timeCell ? normalizeTime(timeCell.raw) : normalizeTime(dateCell.raw),
      field_number: field ? field.text : '',
      opponent: opponent ? opponent.text.replace(/^(vs\.?|@)\s*/i, '') : '',
    });
  }
  return games;
}

function gridHeader(row, season) {
  const dates = row.flatMap((value, index) => {
    // A dotted kickoff ("7.30 PM") can also look like July 30 to the date
    // normalizer. It cannot be one of the grid's date headings.
    if (typeof value === 'string' && /\d[:.]\d{2}\s*[ap]/i.test(value)) return [];
    const date = normalizeDate(value, season);
    return date && date >= '1970-01-01' && date < '2200-01-01' ? [{ index, date, raw: value }] : [];
  });
  return dates.length >= 2 ? dates : null;
}

// The league's printed schedule is a matrix: dates across the top, kickoff
// times down the left, and team IDs in each matchup. The key can be below the
// games or on a later PDF page, so read it before filtering any games.
function rowsByGrid(rows, season) {
  if (!rows.some((row) => gridHeader(row, season))) return null;
  const teams = new Map();
  for (const row of rows) {
    for (const cell of row) {
      const match = cellText(cell).match(/^(\d{1,6})\s*[-–—:]\s*(.+)$/);
      if (match) teams.set(match[1], match[2].trim());
    }
  }
  const ourIds = [...teams].filter(([, name]) => OUR_TEAM.test(name)).map(([id]) => id);
  if (ourIds.length !== 1) {
    throw new ImportProblem("Couldn't identify Jive Turkeys in the schedule's team key. Include the team key with the schedule, or add the games manually.");
  }

  const games = [];
  let dates = [];
  let fieldIndex = -1;
  let calendarYear;
  let gridSeason = season;
  for (const row of rows) {
    const text = row.map(cellText).join(' ');
    const range = text.match(/\b(20\d{2})\s*[-–/]\s*(\d{4}|\d{2})\b/);
    const rangeEnd = range && (range[2].length === 2 ? 2000 + Number(range[2]) : Number(range[2]));
    const title = text.match(/\bsession\s+(?:[ivx]+|[1-3])\s+(20\d{2})\b/i);
    if (range && rangeEnd === Number(range[1]) + 1) {
      gridSeason = Number(range[1]);
      calendarYear = undefined;
    } else if (title) {
      calendarYear = Number(title[1]);
    }
    const header = gridHeader(row, gridSeason);
    if (header) {
      dates = header.map((column) => ({
        ...column,
        // SESSION II 2026 names a calendar year, unlike the app's 2025–26.
        date: calendarYear
          ? normalizeDate(column.raw, seasonOf(`${calendarYear}-${column.date.slice(5)}`))
          : column.date,
      }));
      fieldIndex = row.findIndex((cell) => HEADER_PATTERNS.field.test(cellText(cell)));
      continue;
    }
    if (!dates.length) continue;
    const time = row.slice(0, dates[0].index).map(normalizeTime).find(Boolean);
    if (!time) continue;
    const field = fieldIndex >= 0 ? cellText(row[fieldIndex]) : '';
    for (const { index, date } of dates) {
      const matchup = cellText(row[index]).match(/^(\d{1,6})\s*(?:v(?:s\.?)?|[-–])\s*(\d{1,6})$/i);
      if (!matchup || !matchup.slice(1).includes(ourIds[0])) continue;
      const opponentId = matchup[1] === ourIds[0] ? matchup[2] : matchup[1];
      games.push({ date, time, field_number: field, opponent: teams.get(opponentId) || `Team ${opponentId}` });
    }
  }
  return games.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function parseScheduleRows(rows, season) {
  const header = findHeader(rows);
  if (header) return rowsWithHeader(rows, header, season);
  const grid = rowsByGrid(rows, season);
  if (grid) return grid;
  return rowsByShape(rows, season);
}

/** `season` is the year the season starts in (dates without a year go by it). */
export async function parseScheduleFile(file, season) {
  const bytes = await file.arrayBuffer();
  const signature = new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5));
  if (signature === '%PDF-' || /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf') {
    const { readPdfRows } = await import('./schedule-pdf');
    // PDF.js says "Invalid PDF structure." for damaged and password-protected files.
    const rows = await readPdfRows(bytes).catch(() => {
      throw new ImportProblem("That PDF couldn't be opened. It may be damaged or password-protected. Try the league's original PDF or a spreadsheet, or add the games manually.");
    });
    if (!rows.some((row) => row.some((cell) => cell.trim()))) {
      throw new ImportProblem('This PDF is a scanned image with no readable text. Use the original league PDF or a spreadsheet, or add the games manually.');
    }
    return parseScheduleRows(rows, season);
  }
  // The spreadsheet reader is large, so it's only loaded when someone imports.
  const XLSX = await import('xlsx');
  // raw: a .csv's cells come through as written. Otherwise the reader turns "10/15" into October 15, 2001
  // before the season can give it a year. Date cells in a spreadsheet are still dates.
  const workbook = XLSX.read(bytes, { cellDates: true, raw: true });
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    const games = parseScheduleRows(rows, season);
    if (games.length) return games;
  }
  return [];
}
