import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Serve the worker with the app, so imports work without sending the schedule
// to an outside service or loading scripts from a CDN.
GlobalWorkerOptions.workerSrc = workerUrl;

function textLines(items) {
  const lines = [];
  for (const item of items.filter((item) => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = item.transform[5];
    let line = lines.find((line) => Math.abs(line.y - y) < 3);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines.map((line) => {
    const cells = [];
    for (const item of line.items.sort((a, b) => a.transform[4] - b.transform[4])) {
      const previous = cells.at(-1);
      const x = item.transform[4];
      if (previous && x - previous.end <= 3) {
        previous.text += ` ${item.str.trim()}`;
        previous.end = x + item.width;
      } else {
        cells.push({ text: item.str.trim(), x, end: x + item.width });
      }
    }
    return cells;
  });
}

// Keep empty cells using the printed header's positions. Flattening the text
// would shift sparse matchups into the wrong week's column.
export function pdfTextRows(items) {
  let centers;
  return textLines(items).map((cells) => {
    const dates = cells.filter((cell) => /^(?:[a-z]{3,9}[\s-]+\d{1,2}|\d{1,2}[-/.]\d{1,2})(?:\b|$)/i.test(cell.text));
    const tableHeader = cells.some((cell) => /^date$|^game date$/i.test(cell.text));
    if (dates.length >= 2 || tableHeader) {
      centers = cells.map((cell) => (cell.x + cell.end) / 2);
      return cells.map((cell) => cell.text);
    }
    // Titles and the team key aren't part of the table's column layout.
    if (!centers || cells.some((cell) => /^\d+\s*[-–—:]\s*[a-z]/i.test(cell.text)) || !cells.some((cell) => /\d{1,2}[:.]\d{2}/.test(cell.text))) {
      return cells.map((cell) => cell.text);
    }
    const row = Array(centers.length).fill('');
    for (const cell of cells) {
      const center = (cell.x + cell.end) / 2;
      const index = centers.reduce((best, x, i) => Math.abs(x - center) < Math.abs(centers[best] - center) ? i : best, 0);
      row[index] = [row[index], cell.text].filter(Boolean).join(' ');
    }
    return row;
  });
}

export async function readPdfRows(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const rows = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      rows.push(...pdfTextRows(content.items));
      page.cleanup();
    }
    return rows;
  } finally {
    await task.destroy();
  }
}
