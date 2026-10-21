const FIELDS = ['sku', 'name', 'category', 'price', 'url', 'description', 'details', 'image', 'stock'];
export const REQUIRED = ['sku', 'name', 'price'];
export const LABELS = {
  sku: 'Артикул', name: 'Название', category: 'Категория', price: 'Цена',
  url: 'Ссылка на товар', description: 'Описание', details: 'Краткие характеристики', image: 'Ссылка на фото', stock: 'Остаток (шт.)'
};
export const ALIASES = {
  sku: ['sku', 'article', 'артикул', 'код', 'id'],
  name: ['name', 'title', 'название', 'наименование'],
  category: ['category', 'category_name', 'категория', 'раздел'],
  price: ['price', 'цена', 'цена с ндс', 'стоимость'],
  url: ['url', 'link', 'ссылка', 'ссылка на товар'],
  description: ['description', 'описание'],
  details: ['details', 'features', 'attributes', 'характеристики', 'краткие характеристики', 'свойства'],
  image: ['image', 'picture', 'photo', 'изображение', 'фото'],
  stock: ['stock', 'quantity', 'count', 'остаток', 'количество']
};

export function detectDelimiter(text) {
  let quote = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quote && text[i + 1] === '"') i++;
      else quote = !quote;
    } else if (!quote && (ch === '\n' || ch === '\r')) break;
    else if (!quote && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ?
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

function headerLineFor(text, requested) {
  const lines = text.split(/\r\n|\n|\r/);
  if (requested !== 'auto' && requested != null) {
    const line = Number(requested);
    if (!Number.isInteger(line) || line < 1 || line > lines.length || !lines[line - 1].trim())
      throw new Error('Укажите существующую непустую строку заголовков.');
    return line;
  }
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const candidate = lines[i].trim();
    if (!candidate) continue;
    const delimiter = detectDelimiter(candidate);
    const columns = candidate.split(delimiter).map(x => x.trim().replace(/^"|"$/g, '').toLocaleLowerCase('ru'));
    const recognized = Object.entries(ALIASES).filter(([, aliases]) => columns.some(x => aliases.includes(x)));
    if (columns.length >= 3 && recognized.length >= 2 &&
        recognized.some(([field]) => field === 'sku' || field === 'name')) return i + 1;
  }
  const first = lines.findIndex(line => line.trim());
  if (first < 0) throw new Error('CSV-файл пуст.');
  return first + 1;
}

export function parseCsv(input, requestedHeaderLine = 'auto') {
  const original = input.replace(/^\uFEFF/, '');
  const headerLine = headerLineFor(original, requestedHeaderLine);
  const text = original.split(/\r\n|\n|\r/).slice(headerLine - 1).join('\n');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cells = [], value = '', quoted = false, closed = false, line = headerLine, startLine = headerLine;
  function finish() {
    cells.push(value);
    if (cells.some(x => x.trim() !== '')) rows.push({ line: startLine, cells });
    cells = []; value = ''; closed = false; startLine = line + 1;
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        if (ch === '\n') line++;
        value += ch;
      }
    } else if (ch === '"' && value.length === 0 && !closed) quoted = true;
    else if (ch === delimiter) { cells.push(value); value = ''; closed = false; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      finish(); line++;
    } else if (closed && !/\s/.test(ch)) throw new Error(`Лишний символ после кавычек в строке ${line}.`);
    else if (!closed) value += ch;
  }
  if (quoted) throw new Error(`Не закрыты кавычки в строке ${startLine}.`);
  if (value !== '' || cells.length || closed) finish();
  if (!rows.length) throw new Error('CSV-файл пуст.');
  const headers = rows.shift().cells.map(x => x.trim());
  if (headers.some(x => !x) || new Set(headers.map(x => x.toLocaleLowerCase('ru'))).size !== headers.length)
    throw new Error('Заголовки CSV должны быть заполнены и не повторяться.');
  return { delimiter, headers, rows, headerLine };
}

export function suggestMapping(headers) {
  return Object.fromEntries(FIELDS.map(field => [field,
    headers.find(header => ALIASES[field].includes(header.trim().toLocaleLowerCase('ru'))) || ''
  ]));
}

function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); }
  catch { return false; }
}

export function convertCsv(csv, mapping, shop, { mode = 'yml', headerLine = 'auto' } = {}) {
  if (!['yml', 'clean'].includes(mode)) throw new Error('Неизвестный режим выгрузки.');
  const parsed = parseCsv(csv, headerLine);
  if (!mapping || typeof mapping !== 'object') throw new Error('Сопоставьте колонки CSV.');
  for (const field of [...REQUIRED, ...(mode === 'yml' ? ['category', 'url'] : [])]) if (!parsed.headers.includes(mapping[field]))
    throw new Error(`Не выбрана колонка «${LABELS[field]}».`);
  for (const field of FIELDS) if (mapping[field] && !parsed.headers.includes(mapping[field]))
    throw new Error(`Колонка «${mapping[field]}» отсутствует в CSV.`);
  const selected = FIELDS.map(field => mapping[field]).filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error('Одна колонка сопоставлена нескольким полям.');
  if (mode === 'yml' && (!shop?.name?.trim() || !shop?.company?.trim() || !webUrl(shop?.url || '') ||
      [shop.name, shop.company, shop.url].some(hasInvalidXmlChars)))
    throw new Error('Укажите магазин, компанию и корректный URL магазина.');
  const indexes = Object.fromEntries(FIELDS.map(field => [field, parsed.headers.indexOf(mapping[field])]));
  const products = [], issues = [], seen = new Set();
  for (const row of parsed.rows) {
    if (row.cells.length !== parsed.headers.length) {
      issues.push({ line: row.line, sku: '', message: `Ожидалось ${parsed.headers.length} колонок, получено ${row.cells.length}.` });
      continue;
    }
    const p = Object.fromEntries(FIELDS.map(field => [field, indexes[field] < 0 ? '' : row.cells[indexes[field]].trim()]));
    let message = '';
    if (!p.sku || !p.name || (mode === 'yml' && !p.category)) message = mode === 'yml'
      ? 'Артикул, название и категория обязательны.' : 'Артикул и название обязательны.';
    else if (seen.has(p.sku.toLocaleLowerCase('ru'))) message = 'Повтор артикула.';
    else if (!/^\d+(?:[.,]\d{1,2})?$/.test(p.price) || Number(p.price.replace(',', '.')) <= 0) message = 'Цена должна быть положительным числом, до двух знаков после запятой.';
    else if ((mode === 'yml' || p.url) && !webUrl(p.url)) message = 'Некорректная ссылка на товар.';
    else if (p.image && p.image.split(';').some(url => !webUrl(url.trim()))) message = 'Некорректная ссылка на фото.';
    else if (p.stock && !/^(0|[1-9]\d*)$/.test(p.stock)) message = 'Остаток должен быть целым неотрицательным числом.';
    else if (Object.values(p).some(hasInvalidXmlChars)) message = 'Недопустимый символ для XML.';
    if (message) { issues.push({ line: row.line, sku: p.sku, message }); continue; }
    seen.add(p.sku.toLocaleLowerCase('ru'));
    p.price = Number(p.price.replace(',', '.')).toFixed(2);
    products.push(p);
  }
  return { products, issues, total: parsed.rows.length, mode,
    shop: mode === 'yml' ? { name: shop.name.trim(), company: shop.company.trim(), url: shop.url.trim() } : null };
}

const xml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
function hasInvalidXmlChars(value) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(String(value));
}
export function toYml(result, date = new Date()) {
  const { products, shop } = result;
  const categories = [...new Set(products.map(p => p.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  const ids = new Map(categories.map((name, i) => [name, i + 1]));
  const stamp = date.toISOString().slice(0, 19) + '+00:00';
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<yml_catalog date="${stamp}">`, '  <shop>',
    `    <name>${xml(shop.name)}</name>`, `    <company>${xml(shop.company)}</company>`, `    <url>${xml(shop.url)}</url>`,
    '    <currencies><currency id="RUB" rate="1"/></currencies>', '    <categories>',
    ...categories.map(name => `      <category id="${ids.get(name)}">${xml(name)}</category>`),
    '    </categories>', '    <offers>',
    ...products.flatMap(p => [
      `      <offer id="${xml(p.sku)}">`,
      `        <url>${xml(p.url)}</url>`, `        <price>${p.price}</price>`,
      `        <categoryId>${ids.get(p.category)}</categoryId>`,
      `        <name>${xml(p.name)}</name>`,
      ...(p.description ? [`        <description>${xml(p.description)}</description>`] : []),
      ...(p.image ? p.image.split(';').map(url => `        <picture>${xml(url.trim())}</picture>`) : []),
      ...(p.stock ? [`        <count>${p.stock}</count>`] : []),
      '      </offer>'
    ]), '    </offers>', '  </shop>', '</yml_catalog>'];
  return lines.join('\n') + '\n';
}

function quoteCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return quoteCell(text);
}
export function toCleanCsv(result) {
  const fields = FIELDS;
  return '\uFEFF' + [fields.join(','), ...result.products.map(p => fields.map(field => csvCell(p[field])).join(','))].join('\r\n') + '\r\n';
}

export function toSupplierCsv(result) {
  const fields = ['sku', 'name', 'price', 'details'];
  const labels = ['Артикул', 'Наименование', 'Цена', 'Краткие характеристики'];
  return '\uFEFF' + [labels.join(','), ...result.products.map(p => fields.map(field => csvCell(p[field])).join(','))].join('\r\n') + '\r\n';
}

export function toIssuesCsv(issues) {
  return '\uFEFF' + ['Строка,Артикул,Причина', ...issues.map(issue =>
    [issue.line, issue.sku, issue.message].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export function toCleanJson(result) {
  return JSON.stringify({ products: result.products }, null, 2) + '\n';
}

export function jsonToCsv(input) {
  let data;
  try { data = JSON.parse(input.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Некорректный JSON-файл.'); }
  const products = Array.isArray(data) ? data : data?.products;
  if (!Array.isArray(products) || !products.length || products.length > 10_000 ||
      products.some(item => !item || Array.isArray(item) || typeof item !== 'object'))
    throw new Error('Ожидается непустой массив товаров или объект с массивом products (до 10 000).');
  const headers = [...new Set(products.flatMap(item => Object.keys(item)))];
  if (!headers.length || headers.length > 100) throw new Error('Лимит JSON: до 100 полей товара.');
  const cell = value => {
    if (value == null) return '';
    if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
    throw new Error('Поля JSON должны содержать строки, числа или булевы значения. Вложенные объекты не поддерживаются.');
  };
  return [headers.map(quoteCell).join(','), ...products.map(item => headers.map(key => quoteCell(cell(item[key]))).join(','))].join('\r\n');
}
