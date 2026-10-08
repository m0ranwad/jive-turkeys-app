import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

// Reads a league schedule (.xlsx / .xls / .csv) and pulls out date, time,
// field and opponent for each game. Columns are matched by name, so
// "Date", "Game Date", "Start", "Court", "Opponent", "Home"/"Away" all work.
// If the sheet lists both teams (Home/Away), rows that don't involve our team
// are dropped and the other side becomes the opponent.

const OUR_TEAM = /jive|turkey/i;

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

function fullYear(y, fallback) {
  if (y == null || y === '') return Number(fallback);
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

function isoDate(y, m, d) {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return dayjs(iso, 'YYYY-MM-DD', true).isValid() ? iso : '';
}

/** Any common date format -> YYYY-MM-DD (or '' if it isn't a date). */
export function normalizeDate(value, year) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (value.getFullYear() < 1901) return '';
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    if (value < 1) return '';
    // Excel serial day number (days since 1899-12-30).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value).trim().replace(WEEKDAY_PREFIX, '');
  let m;
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return isoDate(m[1], m[2], m[3]);
  if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?(?!\d)/)))
    return isoDate(fullYear(m[3], year), m[1], m[2]);
  if ((m = text.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return isoDate(fullYear(m[3], year), month + 1, m[2]);
  }
  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?/i))) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return isoDate(fullYear(m[3], year), month + 1, m[1]);
  }
  return '';
}

/** Any common time format -> HH:mm (24h), or '' if none found. */
export function normalizeTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  if (typeof value === 'number') {
    const fraction = value % 1;
    if (fraction === 0 && value >= 1) return '';
    const minutes = Math.round(fraction * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const text = String(value);
  let m = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?(?![a-z])/i);
  if (m) {
    let hours = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') hours += 12;
    return `${pad(hours)}:${m[2] || '00'}`;
  }
  m = text.match(/(?:^|\s|T)(\d{1,2}):(\d{2})/);
  if (m && Number(m[1]) < 24) return `${pad(Number(m[1]))}:${m[2]}`;
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

function rowsWithHeader(rows, { index, cols }, year) {
  const games = [];
  let anyMatchedOurTeam = false;
  const pending = [];

  for (const row of rows.slice(index + 1)) {
    const dateCell = row[cols.date];
    const date = normalizeDate(dateCell, year);
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
function rowsByShape(rows, year) {
  const games = [];
  for (const row of rows) {
    const cells = row.map((c) => ({ raw: c, text: cellText(c) })).filter((c) => c.text);
    const dateCell = cells.find((c) => normalizeDate(c.raw, year));
    if (!dateCell) continue;
    const timeCell = cells.find((c) => c !== dateCell && normalizeTime(c.raw));
    const rest = cells.filter((c) => c !== dateCell && c !== timeCell);
    const field = rest.find((c) => /^[a-z]?\d{1,2}[a-z]?$/i.test(c.text));
    const names = rest.filter((c) => c !== field && /[a-z]/i.test(c.text) && !WEEKDAY_PREFIX.test(`${c.text} `));
    const notUs = names.filter((c) => !OUR_TEAM.test(c.text));
    const opponent = (notUs.length ? notUs : names).sort((a, b) => b.text.length - a.text.length)[0];
    games.push({
      date: normalizeDate(dateCell.raw, year),
      time: timeCell ? normalizeTime(timeCell.raw) : normalizeTime(dateCell.raw),
      field_number: field ? field.text : '',
      opponent: opponent ? opponent.text.replace(/^(vs\.?|@)\s*/i, '') : '',
    });
  }
  return games;
}

export async function parseScheduleFile(file, year) {
  // The spreadsheet reader is large, so it's only loaded when someone imports.
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    const header = findHeader(rows);
    const games = header ? rowsWithHeader(rows, header, year) : rowsByShape(rows, year);
    if (games.length) return games;
  }
  return [];
}
