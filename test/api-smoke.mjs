import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

const base = process.env.FEED_STUDIO_URL || 'http://127.0.0.1:4175';
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet('Прайс');
sheet.addRow(['Описание прайса']);
sheet.addRow(['Раздел', 'Артикул', 'Наименование', 'Цена с НДС']);
sheet.addRow(['Свет', 'A-1', 'Лампа', 338]);
const xlsx = Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
async function post(path, data) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
const inspected = await post('/api/inspect', { format: 'xlsx', xlsx });
assert.equal(inspected.sheet, 'Прайс');
assert.equal(inspected.headerLine, 2);
assert.equal(inspected.rows, 1);
const converted = await post('/api/convert', { format: 'xlsx', xlsx, filename: 'price.xlsx',
  mapping: inspected.mapping, mode: 'clean' });
assert.equal(converted.accepted, 1);
const response = await fetch(`${base}/api/runs/${converted.id}/clean.xlsx`);
assert.equal(response.status, 200);
const downloaded = new ExcelJS.Workbook();
await downloaded.xlsx.load(Buffer.from(await response.arrayBuffer()));
assert.equal(downloaded.worksheets[0].getCell('B2').value, 'Лампа');
console.log('XLSX API smoke passed');
