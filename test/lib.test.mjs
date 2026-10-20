import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, suggestMapping, convertCsv, toYml, toCleanCsv } from '../lib.mjs';

const csv = '\uFEFFАртикул;Название;Категория;Цена;Ссылка;Описание;Наличие\r\n' +
  'A1;"Чай, зелёный";Напитки;120,50;https://example.com/a1;"Строка 1\nСтрока 2";1\r\n' +
  'A1;Повтор;Напитки;120;https://example.com/a2;;0\r\n' +
  'B2;Плохая цена;Напитки;-3;https://example.com/b2;;1\r\n';
const shop = { name: 'Магазин & Ко', company: 'Компания', url: 'https://example.com' };

test('CSV с BOM, точкой с запятой, кавычками и переводом строки', () => {
  const parsed = parseCsv(csv);
  assert.equal(parsed.delimiter, ';');
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
  assert.match(toYml(result), /Магазин &amp; Ко/);
  assert.match(toYml(result), /<price>120\.50<\/price>/);
  assert.match(toCleanCsv(result), /"Чай, зелёный"/);
});
test('ошибочные заголовки и разметка CSV отклоняются', () => {
  assert.throws(() => parseCsv('sku,sku\na,b'), /не повторяться/);
  assert.throws(() => parseCsv('sku,name\n"a,b'), /Не закрыты кавычки/);
});
