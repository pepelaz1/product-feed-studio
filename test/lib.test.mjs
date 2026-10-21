import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, suggestMapping, convertCsv, toYml, toCleanCsv, toSupplierCsv, toIssuesCsv, toCleanJson, jsonToCsv } from '../lib.mjs';
import './xlsx.test.mjs';

const csv = '\uFEFFАртикул;Название;Категория;Цена;Ссылка;Описание;Остаток\r\n' +
  'A1;"Чай, зелёный";Напитки;120,50;https://example.com/a1;"Строка 1\nСтрока 2";1\r\n' +
  'A1;Повтор;Напитки;120;https://example.com/a2;;0\r\n' +
  'B2;Плохая цена;Напитки;-3;https://example.com/b2;;1\r\n';
const shop = { name: 'Магазин & Ко', company: 'Компания', url: 'https://example.com' };

test('CSV с BOM, точкой с запятой, кавычками и переводом строки', () => {
  const parsed = parseCsv(csv);
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.headerLine, 1);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].cells[1], 'Чай, зелёный');
  assert.equal(parsed.rows[1].line, 4);
});
test('проверка строк и безопасные выгрузки', () => {
  const mapping = suggestMapping(parseCsv(csv).headers);
  const result = convertCsv(csv, mapping, shop);
  assert.equal(result.products.length, 1);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.issues.map(x => x.line), [4, 5]);
  const feed = toYml(result, new Date('2026-10-20T10:15:30Z'));
  assert.match(feed, /Магазин &amp; Ко/);
  assert.match(feed, /<yml_catalog date="2026-10-20T10:15:30\+00:00">/);
  assert.match(feed, /<price>120\.50<\/price>/);
  assert.match(feed, /<count>1<\/count>/);
  assert.doesNotMatch(feed, /available=|<currencyId>/);
  assert.match(toCleanCsv(result), /"Чай, зелёный"/);
});
test('несколько фотографий и нулевой остаток', () => {
  const source = 'sku,name,category,price,url,image,stock\n' +
    'A1,Лампа,Свет,99,https://example.com/a1,"https://example.com/1.jpg;https://example.com/2.jpg",0\n';
  const result = convertCsv(source, suggestMapping(parseCsv(source).headers), shop);
  const feed = toYml(result);
  assert.equal(result.issues.length, 0);
  assert.equal((feed.match(/<picture>/g) || []).length, 2);
  assert.match(feed, /<count>0<\/count>/);
});
test('неверный остаток и недопустимый XML-символ отклоняются', () => {
  const source = 'sku,name,category,price,url,stock\n' +
    'A1,Лампа,Свет,99,https://example.com/a1,-1\n' +
    'A2,Лампа\u0001,Свет,99,https://example.com/a2,1\n';
  const result = convertCsv(source, suggestMapping(parseCsv(source).headers), shop);
  assert.equal(result.products.length, 0);
  assert.match(result.issues[0].message, /Остаток/);
  assert.match(result.issues[1].message, /XML/);
});
test('ошибочные заголовки и разметка CSV отклоняются', () => {
  assert.throws(() => parseCsv('sku,sku\na,b'), /не повторяться/);
  assert.throws(() => parseCsv('sku,name\n"a,b'), /Не закрыты кавычки/);
});

test('прайс с вводными строками очищается без ссылки на товар', () => {
  const source = 'ПРАЙС-ЛИСТ SVih\nООО PIRS;контакты;телефон\nУсловия оплаты\n\n' +
    'Раздел;Артикул;Наименование;Цена с НДС\nСвет;HK-203W;Лампа настольная;338\n';
  const parsed = parseCsv(source);
  assert.equal(parsed.headerLine, 5);
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.rows[0].line, 6);
  const mapping = suggestMapping(parsed.headers);
  assert.equal(mapping.price, 'Цена с НДС');
  const result = convertCsv(source, mapping, null, { mode: 'clean' });
  assert.equal(result.products.length, 1);
  assert.equal(result.issues.length, 0);
  assert.match(toCleanCsv(result), /HK-203W,Лампа настольная,Свет,338\.00,/);
  assert.throws(() => convertCsv(source, mapping, shop), /Ссылка на товар/);
});

test('ручной выбор строки заголовков и файл без вводных строк', () => {
  const source = 'Код товара;Заголовок товара;Раздел;Цена с НДС\nA1;Лампа;Свет;99\n';
  assert.equal(parseCsv(source).headerLine, 1);
  assert.equal(parseCsv(source, 1).rows.length, 1);
  assert.throws(() => parseCsv(source, 3), /строку заголовков/);
});

test('проект товарной таблицы: категория не обязательна, характеристики сохраняются', () => {
  const source = 'Артикул;Наименование;Цена;Краткие характеристики\nA-1;Лампа;349,50;Белая, 30 см\n';
  const result = convertCsv(source, suggestMapping(parseCsv(source).headers), null, { mode: 'clean' });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].details, 'Белая, 30 см');
  const supplier = parseCsv(toSupplierCsv(result));
  assert.deepEqual(supplier.headers, ['Артикул', 'Наименование', 'Цена', 'Краткие характеристики']);
  assert.deepEqual(supplier.rows[0].cells, ['A-1', 'Лампа', '349.50', 'Белая, 30 см']);
  assert.match(toCleanCsv(result), /details/);
  assert.throws(() => convertCsv(source, suggestMapping(parseCsv(source).headers), shop), /Категория/);
});

test('JSON-каталог преобразуется в таблицу; вложенные поля не скрываются', () => {
  const input = JSON.stringify({ products: [
    { sku: 'A-1', name: 'Лампа', price: 349.5, details: 'Белая, 30 см' },
    { sku: 'A-2', name: 'Стол', price: 1290, details: 'Массив дерева' }
  ] });
  const csv = jsonToCsv(input);
  const parsed = parseCsv(csv);
  const result = convertCsv(csv, suggestMapping(parsed.headers), null, { mode: 'clean' });
  assert.equal(result.products.length, 2);
  assert.equal(result.products[1].price, '1290.00');
  assert.equal(JSON.parse(toCleanJson(result)).products[0].sku, 'A-1');
  assert.throws(() => jsonToCsv('[{"sku":"A","meta":{"a":1}}]'), /Вложенные объекты/);
});

test('отчёт ошибок сохраняет строки и защищает CSV-ячейки', () => {
  const report = parseCsv(toIssuesCsv([{ line: 4, sku: '=SUM(A1)', message: 'Повтор, проверьте строку' }]));
  assert.deepEqual(report.rows[0].cells, ['4', "'=SUM(A1)", 'Повтор, проверьте строку']);
});
