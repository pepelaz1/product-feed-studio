import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readXlsx, cleanXlsx } from '../xlsx.mjs';
import { parseCsv, suggestMapping, convertCsv, toCleanCsv } from '../lib.mjs';

test('Excel: выбор листа, вводные строки, проверка товаров и обратная выгрузка', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Пустой').addRow(['Не тот лист']);
  const sheet = workbook.addWorksheet('Прайс');
  sheet.addRow(['Прайс поставщика']);
  sheet.addRow([]);
  sheet.addRow(['Раздел', 'Артикул', 'Наименование', 'Цена с НДС']);
  sheet.addRow(['Свет', 'A-1', 'Настольная лампа', 338]);
  sheet.addRow(['Свет', 'A-2', 'Лампа', 455]);
  const original = await workbook.xlsx.writeBuffer();
  const input = await readXlsx(Buffer.from(original), 'Прайс');
  assert.deepEqual(input.sheets, ['Пустой', 'Прайс']);
  const parsed = parseCsv(input.csv);
  assert.equal(parsed.headerLine, 3);
  assert.equal(parsed.rows.length, 2);
  const result = convertCsv(input.csv, suggestMapping(parsed.headers), null, { mode: 'clean' });
  assert.equal(result.products.length, 2);
  const output = await cleanXlsx(toCleanCsv(result));
  const cleaned = new ExcelJS.Workbook();
  await cleaned.xlsx.load(output);
  assert.equal(cleaned.worksheets[0].getRow(2).getCell(1).value, 'A-1');
  assert.equal(cleaned.worksheets[0].getRow(2).getCell(4).value, 338);
});

test('Excel: неверный файл отклоняется', async () => {
  await assert.rejects(readXlsx(Buffer.from('not excel')), /не похож на XLSX/);
});
