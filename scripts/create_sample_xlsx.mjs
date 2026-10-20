import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseCsv } from '../lib.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const parsed = parseCsv(readFileSync(join(root, 'sample/ready-catalog.csv'), 'utf8'));
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet('Пояснение').addRow(['Демонстрационные данные. Переключитесь на лист «Товары».']);
const sheet = workbook.addWorksheet('Товары');
sheet.addRow(['Учебный прайс']);
sheet.addRow([]);
sheet.addRow(parsed.headers);
for (const row of parsed.rows) sheet.addRow(row.cells);
writeFileSync(join(root, 'sample/ready-catalog.xlsx'), Buffer.from(await workbook.xlsx.writeBuffer()));
