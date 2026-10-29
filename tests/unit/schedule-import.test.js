import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseScheduleFile, parseScheduleRows } from '@/lib/schedule-import';
import { pdfTextRows } from '@/lib/schedule-pdf';
// Node uses PDF.js's in-process worker. The browser uses the bundled worker URL.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

const expected = [
  { date: '2026-01-03', time: '13:30', field_number: '2', opponent: 'TEST TEAM A' },
  { date: '2026-01-10', time: '17:00', field_number: '1', opponent: 'TEST TEAM B' },
  { date: '2026-01-17', time: '16:00', field_number: '1', opponent: 'TEST TEAM C' },
  { date: '2026-01-24', time: '15:00', field_number: '1', opponent: 'TEST TEAM D' },
  { date: '2026-01-31', time: '14:30', field_number: '2', opponent: 'TEST TEAM E' },
  { date: '2026-02-14', time: '10:30', field_number: '2', opponent: 'TEST TEAM F' },
  { date: '2026-02-21', time: '17:00', field_number: '1', opponent: 'TEST TEAM D' },
];

describe('the printed league grid', () => {
  it('reads all seven games, retaining sparse columns and both fields', async () => {
    const buffer = await fs.readFile(new URL('../fixtures/league-grid.pdf', import.meta.url));
    const file = { name: 'schedule.pdf', arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    expect(await parseScheduleFile(file, 2027)).toEqual(expected);
  });

  it('also reads a spreadsheet grid, using the key and the season for dates without years', async () => {
    const rows = [
      ['Sat', 'FIELD', 'Nov 7', 'Nov 14'],
      ['1:30PM', 2, '', '958 V 956'],
      ['4:00PM', 1, '952 V 958', '950 V 951'],
      ['5:00PM', 1, '958 V 969', ''],
      ['SUN', 'FIELD', 'Nov 8', 'Nov 15'],
      ['7:30PM', '', 'SUPER BOWL SUNDAY', '958 V 969'],
      ['958- JIVE TURKEYS', '956- S AND R'],
      ['952- L F C', '969- ALLSCAPE'],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Schedule');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    expect(await parseScheduleFile({ arrayBuffer: async () => bytes }, 2026)).toEqual([
      { date: '2026-11-07', time: '16:00', field_number: '1', opponent: 'L F C' },
      { date: '2026-11-07', time: '17:00', field_number: '1', opponent: 'ALLSCAPE' },
      { date: '2026-11-14', time: '13:30', field_number: '2', opponent: 'S AND R' },
      { date: '2026-11-15', time: '19:30', field_number: '', opponent: 'ALLSCAPE' },
    ]);
  });

  it('uses season ranges and honors explicit years in columns', () => {
    expect(parseScheduleRows([
      ['SESSION II 2026–27'],
      ['Sat', 'FIELD', 'Jan-03', 'Jan 10, 2028'],
      ['1:00PM', '1', '958 V 956', '956 VS 958'],
      ['958- JIVE TURKEYS', '956- S AND R'],
    ], 2030).map((game) => game.date)).toEqual(['2027-01-03', '2028-01-10']);
  });

  it('explains a missing team key instead of importing the whole league', () => {
    expect(() => parseScheduleRows([
      ['Sat', 'FIELD', 'Jan 3', 'Jan 10'],
      ['1:30PM', '2', '', '958 V 956'],
    ], 2026)).toThrow('team key');
  });

  it('joins PDF text fragments without shifting empty dates or field columns', () => {
    const item = (str, x, y, width) => ({ str, width, transform: [1, 0, 0, 1, x, y] });
    expect(pdfTextRows([
      item('Sat', 10, 100, 20), item('FIELD', 45, 100, 20),
      item('Jan 03', 100, 100, 30), item('Jan 10', 170, 100, 30),
      item('1:30PM', 5, 80, 30), item('2', 50, 81, 5),
      item('958', 168, 80, 15), item('V', 186, 80, 5), item('956', 194, 80, 15),
    ])).toEqual([
      ['Sat', 'FIELD', 'Jan 03', 'Jan 10'],
      ['1:30PM', '2', '', '958 V 956'],
    ]);
  });
});
