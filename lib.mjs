const FIELDS = ['sku', 'name', 'category', 'price', 'url', 'description', 'image', 'stock'];
export const REQUIRED = ['sku', 'name', 'category', 'price', 'url'];
export const LABELS = {
  sku: 'Артикул', name: 'Название', category: 'Категория', price: 'Цена',
  url: 'Ссылка на товар', description: 'Описание', image: 'Ссылка на фото', stock: 'Остаток (шт.)'
};
export const ALIASES = {
  sku: ['sku', 'article', 'артикул', 'код', 'id'],
  name: ['name', 'title', 'название', 'наименование'],
  category: ['category', 'category_name', 'категория', 'раздел'],
  price: ['price', 'цена', 'стоимость'],
  url: ['url', 'link', 'ссылка', 'ссылка на товар'],
  description: ['description', 'описание'],
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

export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cells = [], value = '', quoted = false, closed = false, line = 1, startLine = 1;
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
  return { delimiter, headers, rows };
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

export function convertCsv(csv, mapping, shop) {
  const parsed = parseCsv(csv);
  if (!mapping || typeof mapping !== 'object') throw new Error('Сопоставьте колонки CSV.');
  for (const field of REQUIRED) if (!parsed.headers.includes(mapping[field]))
    throw new Error(`Не выбрана колонка «${LABELS[field]}».`);
  for (const field of FIELDS) if (mapping[field] && !parsed.headers.includes(mapping[field]))
    throw new Error(`Колонка «${mapping[field]}» отсутствует в CSV.`);
  const selected = FIELDS.map(field => mapping[field]).filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error('Одна колонка сопоставлена нескольким полям.');
  if (!shop?.name?.trim() || !shop?.company?.trim() || !webUrl(shop?.url || '') ||
      [shop.name, shop.company, shop.url].some(hasInvalidXmlChars))
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
    if (!p.sku || !p.name || !p.category) message = 'Артикул, название и категория обязательны.';
    else if (seen.has(p.sku.toLocaleLowerCase('ru'))) message = 'Повтор артикула.';
    else if (!/^\d+(?:[.,]\d{1,2})?$/.test(p.price) || Number(p.price.replace(',', '.')) <= 0) message = 'Цена должна быть положительным числом, до двух знаков после запятой.';
    else if (!webUrl(p.url)) message = 'Некорректная ссылка на товар.';
    else if (p.image && p.image.split(';').some(url => !webUrl(url.trim()))) message = 'Некорректная ссылка на фото.';
    else if (p.stock && !/^(0|[1-9]\d*)$/.test(p.stock)) message = 'Остаток должен быть целым неотрицательным числом.';
    else if (Object.values(p).some(hasInvalidXmlChars)) message = 'Недопустимый символ для XML.';
    if (message) { issues.push({ line: row.line, sku: p.sku, message }); continue; }
    seen.add(p.sku.toLocaleLowerCase('ru'));
    p.price = Number(p.price.replace(',', '.')).toFixed(2);
    products.push(p);
  }
  return { products, issues, total: parsed.rows.length, shop: { name: shop.name.trim(), company: shop.company.trim(), url: shop.url.trim() } };
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

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function toCleanCsv(result) {
  const fields = ['sku', 'name', 'category', 'price', 'url', 'description', 'image', 'stock'];
  return '\uFEFF' + [fields.join(','), ...result.products.map(p => fields.map(field => csvCell(p[field])).join(','))].join('\r\n') + '\r\n';
}
