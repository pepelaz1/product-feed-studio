import { parseCsv } from './lib.mjs';

function safeCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function rowsToCsv(headers, rows) {
  if (!headers.length || headers.length > 100) throw new Error('Лимит выгрузки — 100 колонок.');
  return '\uFEFF' + [headers, ...rows].map(row => row.map(safeCell).join(',')).join('\r\n') + '\r\n';
}

export function csvToTable(csv, headerLine = 'auto') {
  const parsed = parseCsv(csv, headerLine);
  return { headers: parsed.headers, rows: parsed.rows.map(row => row.cells), headerLine: parsed.headerLine };
}

export function objectsToTable(objects, preferred = []) {
  const headers = [...new Set([...preferred, ...objects.flatMap(row => Object.keys(row))])];
  return { headers, rows: objects.map(row => headers.map(key => row[key] ?? '')) };
}
