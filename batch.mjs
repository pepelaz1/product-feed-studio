import { objectsToTable } from './tabular.mjs';

const aliases = {
  sku: ['артикул', 'sku', 'vendorcode', 'код товара', 'код', 'ид', 'id'],
  name: ['название', 'наименование', 'name', 'товар'],
  brand: ['бренд', 'производитель', 'brand', 'vendor'],
  model: ['модель', 'model'],
  price: ['цена', 'price', 'стоимость', 'закупочная цена'],
  stock: ['остаток', 'количество', 'stock', 'quantity', 'наличие'],
  currency: ['валюта', 'currency', 'currencyid'],
  image: ['фото', 'картинка', 'изображение', 'image', 'picture', 'ссылка на фото'],
  category: ['категория', 'category', 'группа'],
  rrp: ['ррц', 'rrp', 'рекомендованная цена']
};
const key = value => String(value ?? '').toLowerCase().replace(/[\s_\-./]+/g, '').trim();
const field = (table, kind) => table.headers.find(header => aliases[kind].some(alias => key(header) === key(alias)));
const cell = (table, row, kind) => {
  const header = field(table, kind);
  return header ? String(row[table.headers.indexOf(header)] ?? '').trim() : '';
};
const number = value => {
  const normalized = String(value ?? '').replace(/[\s₽]/g, '').replace(',', '.');
  return normalized && /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
};
const stock = value => {
  const lower = String(value ?? '').trim().toLowerCase();
  if (['да', 'есть', 'в наличии', 'true'].includes(lower)) return 1;
  return number(value);
};
const sourceName = filename => String(filename || 'source').replace(/\.[^.]+$/, '');
const safeName = filename => String(filename || 'source').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100);

export function mergeTables(files) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 5) throw new Error('Для объединения выберите 2–5 файлов.');
  const records = [];
  const issues = [];
  for (const file of files) {
    const { table } = file;
    const name = safeName(file.filename);
    table.rows.forEach((row, index) => {
      if (!row.some(value => String(value ?? '').trim())) return;
      const record = { 'Источник': sourceName(name) };
      table.headers.forEach((header, column) => { record[header] = row[column] ?? ''; });
      const pictures = cell(table, row, 'image').split(/[|;]/).map(value => value.trim()).filter(Boolean);
      if (!record['Фото 1']) record['Фото 1'] = pictures[0] || '';
      if (!record['Фото 2']) record['Фото 2'] = pictures[1] || '';
      records.push(record);
      if (row.length > table.headers.length) issues.push({ file: name, row: index + 2, reason: 'Лишние колонки' });
    });
  }
  if (records.length > 10_000) throw new Error('Лимит — 10 000 строк суммарно.');
  return { mode: 'merge', total: records.length, table: objectsToTable(records, ['Источник']), issues };
}

function mappingIndex(table) {
  if (!table) return new Map();
  const norm = name => table.headers.find(header => key(header) === key(name));
  const own = norm('Артикул магазина');
  const theirs = norm('Артикул поставщика');
  const supplier = norm('Поставщик');
  if (!own || !theirs) throw new Error('В файле соответствий нужны колонки «Артикул магазина» и «Артикул поставщика».');
  const index = new Map();
  for (const row of table.rows) {
    const item = String(row[table.headers.indexOf(own)] ?? '').trim();
    const external = String(row[table.headers.indexOf(theirs)] ?? '').trim();
    const name = supplier ? String(row[table.headers.indexOf(supplier)] ?? '').trim() : '';
    if (item && external) index.set((name ? key(name) + '|' : '') + key(external), item);
  }
  return index;
}

function ruleValue(rules, row, keyName, fallback) {
  const sku = row.sku;
  const brand = row.brand;
  const category = row.category;
  return Number(rules?.bySku?.[sku]?.[keyName] ??
    rules?.byBrand?.[brand]?.[keyName] ??
    rules?.byCategory?.[category]?.[keyName] ??
    rules?.[keyName] ?? fallback);
}

export function reconcileTables(files, options = {}, skuMap) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 5) throw new Error('Для сверки выберите каталог и 1–4 прайса поставщиков.');
  const [base, ...suppliers] = files;
  for (const file of files) {
    if (!field(file.table, 'sku') && !(field(file.table, 'brand') && field(file.table, 'model')))
      throw new Error('Нет артикула либо пары бренд + модель в файле ' + safeName(file.filename));
  }
  const mapping = mappingIndex(skuMap);
  const issues = [];
  const baseRows = base.table.rows.map((row, index) => {
    const sku = cell(base.table, row, 'sku');
    const brand = cell(base.table, row, 'brand');
    const model = cell(base.table, row, 'model');
    return { index, row, sku, brand, model, category: cell(base.table, row, 'category') };
  });
  if (baseRows.length > 10_000) throw new Error('Лимит — 10 000 товаров.');
  const bySku = new Map();
  const byModel = new Map();
  for (const item of baseRows) {
    if (item.sku) {
      const id = key(item.sku);
      bySku.set(id, [...(bySku.get(id) || []), item]);
    }
    if (item.brand && item.model) {
      const id = key(item.brand) + '|' + key(item.model);
      byModel.set(id, [...(byModel.get(id) || []), item]);
    }
  }
  const candidates = new Map();
  const rates = { RUB: 1, RUR: 1, USD: number(options.rates?.USD), EUR: number(options.rates?.EUR) };
  const supplierStats = [];
  for (const supplier of suppliers) {
    const name = sourceName(safeName(supplier.filename));
    let matched = 0;
    supplier.table.rows.forEach((row, index) => {
      const sku = cell(supplier.table, row, 'sku');
      const brand = cell(supplier.table, row, 'brand');
      const model = cell(supplier.table, row, 'model');
      const mapped = mapping.get(key(name) + '|' + key(sku)) || mapping.get(key(sku));
      const matches = mapped ? bySku.get(key(mapped)) :
        (sku && bySku.get(key(sku))) || (brand && model && byModel.get(key(brand) + '|' + key(model))) || [];
      if (matches.length !== 1) {
        issues.push({ file: name, row: index + 2, reason: matches.length ? 'Неоднозначное сопоставление' : 'Товар не найден в каталоге', sku });
        return;
      }
      matched++;
      const rawStock = cell(supplier.table, row, 'stock');
      const quantity = stock(rawStock);
      const price = number(cell(supplier.table, row, 'price'));
      const currency = (cell(supplier.table, row, 'currency') || 'RUB').toUpperCase();
      const rate = rates[currency];
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(rate) || rate <= 0) {
        issues.push({ file: name, row: index + 2, reason: 'Неверная цена, остаток или курс ' + currency, sku });
        return;
      }
      const item = matches[0];
      candidates.set(item.index, [...(candidates.get(item.index) || []), { supplier: name, sku, priceRub: price * rate, quantity, currency, rrp: cell(supplier.table, row, 'rrp') }]);
    });
    supplierStats.push({ supplier: name, matched, total: supplier.table.rows.length });
  }
  const records = baseRows.map(item => {
    const variants = (candidates.get(item.index) || []).filter(candidate => candidate.quantity > 0)
      .sort((a, b) => a.priceRub - b.priceRub);
    const selected = variants[0];
    const markup = ruleValue(options.rules, item, 'markup', options.markup ?? 0);
    const discount = ruleValue(options.rules, item, 'discount', options.discount ?? 0);
    if (![markup, discount].every(Number.isFinite) || markup < 0 || discount < 0 || discount > 100)
      throw new Error('Наценка и скидка должны быть числами от 0 до 100 (наценка может быть больше 100).');
    const result = {};
    base.table.headers.forEach((header, column) => { result[header] = item.row[column] ?? ''; });
    result['Поставщик'] = selected?.supplier || '';
    result['Артикул поставщика'] = selected?.sku || '';
    result['Закупочная цена, ₽'] = selected ? selected.priceRub.toFixed(2) : '';
    result['Остаток поставщика'] = selected?.quantity ?? 0;
    result['Наценка, %'] = selected ? markup : '';
    result['Скидка, %'] = selected ? discount : '';
    result['Расчётная цена, ₽'] = selected ? (selected.priceRub * (1 + markup / 100) * (1 - discount / 100)).toFixed(2) : '';
    result['РРЦ поставщика'] = selected?.rrp || '';
    result['Статус'] = selected ? 'В наличии' : 'Нет доступного остатка';
    if (!selected) issues.push({ file: safeName(base.filename), row: item.index + 2, reason: 'Нет доступного остатка; выставлен 0', sku: item.sku });
    return result;
  });
  return { mode: 'reconcile', total: records.length, table: objectsToTable(records), issues,
    summary: { suppliers: supplierStats, available: records.filter(row => row['Статус'] === 'В наличии').length } };
}
