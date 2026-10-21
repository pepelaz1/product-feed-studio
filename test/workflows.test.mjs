import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importYml, importCommerceMl, readXml } from '../xml-import.mjs';
import { csvToTable, rowsToCsv } from '../tabular.mjs';
import { mergeTables, reconcileTables } from '../batch.mjs';
import { cleanXlsx } from '../xlsx.mjs';

const sample = file => readFileSync(new URL('../sample/' + file, import.meta.url), 'utf8');
const supplier = filename => ({ filename, table: csvToTable(sample(filename)) });

test('YML импортирует вложенные категории, два фото и NOPIC, но не исполняет DTD', () => {
  const result = importYml(sample('example.yml'));
  assert.equal(result.total, 2);
  assert.equal(result.table.rows[0][result.table.headers.indexOf('Категория')], 'Освещение / Настольные лампы');
  assert.equal(result.table.rows[1][result.table.headers.indexOf('Фото 1')], 'NOPIC');
  assert.throws(() => readXml('<!DOCTYPE x [<!ENTITY a "bad">]><x>&a;</x>'), /DTD/);
});

test('CommerceML соединяет каталог с предложениями, ценами, остатком и свойством', () => {
  const result = importCommerceMl(sample('example-commerce.xml'), sample('example-offers.xml'));
  const record = Object.fromEntries(result.table.headers.map((header, index) => [header, result.table.rows[0][index]]));
  assert.equal(record['Категория 2'], 'Лампы');
  assert.equal(record['Цена: Опт'], '3000');
  assert.equal(record['Остаток'], '8');
  assert.equal(record['Свойство: Цвет'], 'Белый');
});

test('объединение файлов сохраняет источник и фото', () => {
  const result = mergeTables([supplier('example-supplier-a.csv'), supplier('example-supplier-b.csv')]);
  assert.equal(result.total, 4);
  const record = Object.fromEntries(result.table.headers.map((header, index) => [header, result.table.rows[2][index]]));
  assert.equal(record['Источник'], 'example-supplier-b');
  assert.equal(record['Фото 1'], 'https://example.com/lamp-b.jpg');
});

test('сверка SKU, выбор доступного минимума, правила цены и нулевой остаток', () => {
  const files = [supplier('example-supplier-a.csv'), supplier('example-supplier-b.csv')];
  const map = csvToTable(sample('example-sku-map.csv'));
  const result = reconcileTables(files, { markup: 20, discount: 0,
    rules: { bySku: { 'LAMP-001': { discount: 5 } } } }, map);
  const first = Object.fromEntries(result.table.headers.map((header, index) => [header, result.table.rows[0][index]]));
  const second = Object.fromEntries(result.table.headers.map((header, index) => [header, result.table.rows[1][index]]));
  assert.equal(first['Поставщик'], 'example-supplier-b');
  assert.equal(first['Расчётная цена, ₽'], '3078.00');
  assert.equal(second['Остаток поставщика'], 0);
  assert.equal(result.issues.length, 1);
});

test('выгрузка защищена от формул и открывается как Excel', async () => {
  const csv = rowsToCsv(['Название', 'Цена'], [['=HYPERLINK("bad")', '100']]);
  assert.match(csv, /'=HYPERLINK/);
  const xlsx = await cleanXlsx(csv);
  assert.ok(xlsx.length > 1000);
});
