import ExcelJS from 'exceljs';

const COLUMNS = [
  'KIT ID', 'Артикул продавца (из KIT или предложение)', 'Название', 'Категория KIT',
  'Предмет WB (заполнить)', 'Бренд', 'Описание', 'Штрихкод',
  'Цена до скидки, ₽', 'Цена со скидкой, ₽', 'НДС KIT',
  'Длина упаковки, см', 'Ширина упаковки, см', 'Высота упаковки, см',
  'Вес с упаковкой, г', 'Фото (ссылки через ;)', 'Остаток KIT',
  'Внешний ID WB', 'Проверка существующей карточки', 'Готовность'
];

const text = value => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('result' in value) return text(value.result);
    if ('text' in value) return text(value.text);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
  }
  return String(value).trim();
};

function headersAt(sheet) {
  for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
    const cells = sheet.getRow(row).values.map(text);
    if (cells.includes('KIT ID*') && cells.includes('Название товара*')) return row;
  }
  throw new Error('Не найдена строка заголовков выгрузки Яндекс Kit.');
}

const validNumber = value => /^\d+(?:[.,]\d{1,2})?$/.test(value) && Number(value.replace(',', '.')) > 0;

function photos(value) {
  const urls = value.match(/https?:\/\/[^\s,;]+/g) || [];
  return urls.join(';');
}

export async function prepareKitForWb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 2_000_000 || buffer.subarray(0, 2).toString() !== 'PK')
    throw new Error('Выберите XLSX-выгрузку Яндекс Kit до 2 МБ.');
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(buffer); }
  catch { throw new Error('Не удалось прочитать XLSX-файл Яндекс Kit.'); }
  const sheet = book.worksheets.find(item => {
    try { headersAt(item); return true; } catch { return false; }
  });
  if (!sheet) throw new Error('В книге нет листа с товарами Яндекс Kit.');
  if (sheet.rowCount > 10_002 || sheet.columnCount > 100)
    throw new Error('Лимит — 10 000 товаров и 100 колонок.');
  const headerRow = headersAt(sheet);
  const sourceHeaders = sheet.getRow(headerRow).values.map(text);
  const index = label => sourceHeaders.indexOf(label);
  const get = (row, label) => {
    const column = index(label);
    return column > 0 ? text(row.getCell(column).value) : '';
  };
  const extraColumns = sourceHeaders.map((label, index) => ({ label, index }))
    .filter(({ label, index }) => label && index >= 39);
  const issues = [];
  const rows = [];
  const seenIds = new Set();
  for (let number = headerRow + 1; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    if (!row.hasValues) continue;
    const id = get(row, 'KIT ID*');
    const name = get(row, 'Название товара*');
    if (!id && !name) continue;
    const issueStart = issues.length;
    const problem = reason => issues.push({ file: sheet.name, row: number, sku: id, reason });
    if (!id) problem('Нет KIT ID: нельзя предложить устойчивый артикул продавца.');
    else if (seenIds.has(id)) problem('Повтор KIT ID в исходном файле.');
    seenIds.add(id);
    if (!name) problem('Нет названия товара.');
    const sellerSku = get(row, 'Артикул') || (id ? `KIT-${id}` : '');
    if (!get(row, 'Артикул')) problem(`Артикул продавца отсутствует; ${sellerSku || 'новый артикул'} — только предложение, требуется согласование.`);
    const category = ['Категория 1-го уровня*', 'Категория 2-го уровня', 'Категория 3-го уровня']
      .map(label => get(row, label)).filter(Boolean).join(' / ');
    problem('Предмет и обязательные характеристики WB нужно выбрать по категории в кабинете продавца.');
    const brand = get(row, 'Бренд');
    if (!brand) problem('Бренд отсутствует: уточните бренд или допустимое для предмета значение.');
    const barcode = get(row, 'Штрихкод');
    if (!barcode) problem('Штрихкод отсутствует: согласуйте генерацию или заполнение.');
    const price = get(row, 'Цена до скидки, руб.');
    const discountPrice = get(row, 'Цена со скидкой, руб.');
    if (!validNumber(price)) problem('Некорректная цена до скидки.');
    if (!validNumber(discountPrice)) problem('Цена со скидкой отсутствует или некорректна; значение не подставлено автоматически.');
    const dimensions = ['Длина упаковки, см', 'Ширина упаковки, см', 'Высота упаковки, см', 'Вес с упаковкой, г'];
    for (const label of dimensions) if (!get(row, label)) problem(`Не заполнено поле «${label}».`);
    const image = photos(get(row, 'Изображения и видео'));
    if (!image) problem('Нет ссылок на фото.');
    const stock = get(row, 'Склад: Склад №1');
    if (stock && !/^\d+$/.test(stock)) problem('Остаток не является целым неотрицательным числом.');
    const wbId = get(row, 'Внешний ID: Wildberries');
    if (!wbId) problem('Нет ID WB и выгрузки существующих карточек: создать или обновить — не определено.');
    if (get(row, 'Объединять по (Group ID)')) problem('Товар входит в группу вариантов KIT; группировку WB проверьте вручную.');
    const rowIssues = issues.length - issueStart;
    rows.push([id, sellerSku, name, category, '', brand, get(row, 'Описание товара'), barcode,
      price, discountPrice, get(row, 'Ставка НДС'), ...dimensions.map(label => get(row, label)),
      image, stock, wbId, wbId ? 'Проверить существующую карточку' : 'Не определено',
      rowIssues ? 'Требует уточнений' : 'Проверить в WB', ...extraColumns.map(({ index }) => text(row.getCell(index).value))]);
  }
  if (!rows.length) throw new Error('В выгрузке не найдены товары.');
  return { mode: 'kit-wb', total: rows.length, table: { headers: [...COLUMNS, ...extraColumns.map(({ label }) => `Поле KIT: ${label}`)], rows }, issues,
    summary: { needsReview: rows.filter(row => row[19] === 'Требует уточнений').length,
      sourceSheet: sheet.name, headerRow } };
}
