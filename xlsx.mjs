import ExcelJS from 'exceljs';
import { parseCsv } from './lib.mjs';

const MAX_ROWS = 10_001;
const MAX_COLUMNS = 100;

function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if ('result' in value) return value.result == null ? '' : String(value.result);
    if ('text' in value) return String(value.text ?? '');
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    return '';
  }
  return String(value);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function readXlsx(buffer, sheetName) {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString() !== 'PK')
    throw new Error('Файл не похож на XLSX. Выберите книгу Excel в формате .xlsx.');
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(buffer); }
  catch { throw new Error('Не удалось прочитать XLSX. Проверьте файл и снимите пароль, если он установлен.'); }
  const sheets = book.worksheets.map(sheet => sheet.name);
  if (!sheets.length) throw new Error('В книге Excel нет листов.');
  const sheet = sheetName ? book.getWorksheet(sheetName) : book.worksheets[0];
  if (!sheet) throw new Error('Выбранный лист не найден в книге Excel.');
  if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS)
    throw new Error('Лимит Excel: до 10 000 строк и 100 колонок.');
  const lines = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const width = Math.min(row.cellCount, MAX_COLUMNS);
    const values = [];
    for (let column = 1; column <= width; column++) values.push(csvCell(cellText(row.getCell(column))));
    lines.push(values.join(','));
  }
  return { csv: lines.join('\n'), sheets, sheet: sheet.name };
}

export async function cleanXlsx(cleanCsv) {
  const parsed = parseCsv(cleanCsv);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Товары');
  sheet.addRow(parsed.headers);
  for (const row of parsed.rows) {
    const values = row.cells.map((value, index) => {
      if (['price', 'Цена'].includes(parsed.headers[index])) return Number(value);
      // Keep spreadsheet programs from interpreting user-supplied text as formulas.
      return /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
    });
    sheet.addRow(values);
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145743' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const lastColumn = sheet.getRow(1).cellCount;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: lastColumn } };
  sheet.columns.forEach(column => { column.width = 22; });
  const data = await book.xlsx.writeBuffer();
  return Buffer.from(data);
}
