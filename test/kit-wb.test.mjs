import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prepareKitForWb } from '../kit-wb.mjs';

test('подготовка Kit сохраняет данные и отмечает блокеры для WB', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('products');
  sheet.addRow(['Выгрузка товаров']);
  const headers = ['KIT ID*', 'Название товара*', 'Артикул', 'Описание товара', 'Штрихкод',
    'Цена до скидки, руб.', 'Цена со скидкой, руб.', 'Ставка НДС', 'Бренд',
    'Категория 1-го уровня*', 'Склад: Склад №1', 'Изображения и видео',
    'Внешний ID: Wildberries'];
  while (headers.length < 38) headers.push('');
  headers.push('Цвет');
  sheet.addRow(headers);
  const item = ['102', 'Демо лампа', '', 'Исходное описание', '', '2500', '2000', '0', '',
    'Освещение', '5', 'https://example.com/photo.jpg', ''];
  while (item.length < 38) item.push('');
  item.push('Белый');
  sheet.addRow(item);
  const result = await prepareKitForWb(Buffer.from(await book.xlsx.writeBuffer()));
  const record = Object.fromEntries(result.table.headers.map((header, index) => [header, result.table.rows[0][index]]));
  assert.equal(result.total, 1);
  assert.equal(record['Артикул продавца (из KIT или предложение)'], 'KIT-102');
  assert.equal(record['Цена до скидки, ₽'], '2500');
  assert.equal(record['Цена со скидкой, ₽'], '2000');
  assert.equal(record['Фото (ссылки через ;)'], 'https://example.com/photo.jpg');
  assert.equal(record['Поле KIT: Цвет'], 'Белый');
  assert.equal(record['Готовность'], 'Требует уточнений');
  assert.equal(result.summary.needsReview, 1);
  assert.ok(result.issues.some(issue => issue.reason.includes('Предмет и обязательные характеристики WB')));
});
