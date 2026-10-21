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
const jsonCatalog = JSON.stringify({ products: [
  { sku: 'A-1', name: 'Лампа', price: 349.5, details: 'Белая' },
  { sku: 'A-1', name: 'Повтор', price: 99, details: 'Дубль' }
] });
const jsonInspect = await post('/api/inspect', { format: 'json', json: jsonCatalog });
assert.equal(jsonInspect.mapping.details, 'details');
const jsonRun = await post('/api/convert', { format: 'json', json: jsonCatalog,
  filename: 'catalog.json', mapping: jsonInspect.mapping, mode: 'clean' });
assert.equal(jsonRun.accepted, 1);
assert.equal(jsonRun.rejected, 1);
const supplier = await fetch(`${base}/api/runs/${jsonRun.id}/supplier.xlsx`);
assert.equal(supplier.status, 200);
const supplierBook = new ExcelJS.Workbook();
await supplierBook.xlsx.load(Buffer.from(await supplier.arrayBuffer()));
assert.equal(supplierBook.worksheets[0].getCell('C2').value, 349.5);
assert.equal(supplierBook.worksheets[0].getCell('D2').value, 'Белая');
const issues = await fetch(`${base}/api/runs/${jsonRun.id}/issues.csv`);
assert.equal(issues.status, 200);
assert.match(await issues.text(), /Повтор артикула/);
const exportedJson = await fetch(`${base}/api/runs/${jsonRun.id}/clean.json`);
assert.equal(exportedJson.status, 200);
assert.equal((await exportedJson.json()).products[0].details, 'Белая');
console.log('XLSX + JSON + supplier API smoke passed');
