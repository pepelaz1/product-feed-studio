import { SaxesParser } from 'saxes';
import { objectsToTable } from './tabular.mjs';

const local = name => String(name).split(':').at(-1);
const kids = (node, name) => (node?.children || []).filter(child => child.name === name);
const one = (node, name) => kids(node, name)[0];
const val = (node, name) => String(one(node, name)?.text ?? '').trim();
const descendants = (node, name) => {
  const result = [];
  const visit = current => {
    for (const child of current?.children || []) {
      if (child.name === name) result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
};

export function readXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2_000_000) throw new Error('XML-файл должен быть не больше 2 МБ.');
  const parser = new SaxesParser({ xmlns: false });
  let root;
  const stack = [];
  let count = 0;
  parser.on('doctype', () => { throw new Error('XML с DTD не поддерживается.'); });
  parser.on('opentag', tag => {
    if (++count > 100_000 || stack.length > 40) throw new Error('XML превышает лимит элементов или вложенности.');
    const node = { name: local(tag.name), attrs: tag.attributes, text: '', children: [] };
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('text', text => { if (stack.length) stack.at(-1).text += text; });
  parser.on('cdata', text => { if (stack.length) stack.at(-1).text += text; });
  parser.on('closetag', () => stack.pop());
  parser.write(xml).close();
  if (!root) throw new Error('Пустой XML-файл.');
  return root;
}

function categoryPaths(categories) {
  const byId = new Map(categories.map(category => [String(category.attrs.id), category]));
  const path = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return '';
    seen.add(id);
    const category = byId.get(String(id));
    if (!category) return '';
    const parent = path(category.attrs.parentId, seen);
    return [parent, category.text.trim()].filter(Boolean).join(' / ');
  };
  return path;
}

export function importYml(xml) {
  const root = readXml(xml);
  if (root.name !== 'yml_catalog') throw new Error('Ожидается файл YML с корневым элементом yml_catalog.');
  const path = categoryPaths(descendants(root, 'category'));
  const offers = descendants(root, 'offer');
  if (!offers.length) throw new Error('В YML не найдены товары offer.');
  if (offers.length > 10_000) throw new Error('Лимит — 10 000 товаров.');
  const issues = [];
  const seen = new Set();
  const records = offers.map((offer, index) => {
    const sku = String(offer.attrs.id || val(offer, 'vendorCode') || val(offer, 'shop-sku')).trim();
    if (!sku) issues.push({ row: index + 1, reason: 'Отсутствует offer id / артикул' });
    if (seen.has(sku)) issues.push({ row: index + 1, reason: 'Повтор артикула: ' + sku });
    seen.add(sku);
    const pictures = kids(offer, 'picture').map(node => node.text.trim()).filter(Boolean);
    return {
      'Артикул': sku, 'Название': val(offer, 'name') || [val(offer, 'vendor'), val(offer, 'model')].filter(Boolean).join(' '),
      'Категория': path(val(offer, 'categoryId')), 'Цена': val(offer, 'price'),
      'Валюта': val(offer, 'currencyId'), 'Наличие': String(offer.attrs.available ?? ''),
      'Остаток': val(offer, 'count'), 'Фото 1': pictures[0] || 'NOPIC',
      'Фото 2': pictures[1] || 'NOPIC', 'Другие фото': pictures.slice(2).join(' | '),
      'Описание': val(offer, 'description'), 'URL': val(offer, 'url')
    };
  });
  return { table: objectsToTable(records), issues, total: offers.length, mode: 'yml-import' };
}

function groups(root) {
  const lookup = new Map();
  const visit = (group, ancestors) => {
    const name = val(group, 'Наименование');
    const names = [...ancestors, name].filter(Boolean);
    lookup.set(val(group, 'Ид'), names);
    for (const sub of kids(one(group, 'Группы'), 'Группа')) visit(sub, names);
  };
  for (const classifier of descendants(root, 'Классификатор'))
    for (const group of kids(one(classifier, 'Группы'), 'Группа')) visit(group, []);
  return lookup;
}

export function importCommerceMl(catalogXml, offersXml = '') {
  const roots = [readXml(catalogXml), ...(offersXml ? [readXml(offersXml)] : [])];
  if (roots.some(root => root.name !== 'КоммерческаяИнформация')) throw new Error('Ожидается CommerceML с корневым элементом КоммерческаяИнформация.');
  const categories = new Map(roots.flatMap(root => [...groups(root)]));
  const properties = new Map();
  const priceTypes = new Map();
  for (const root of roots) {
    for (const node of descendants(root, 'Свойство')) properties.set(val(node, 'Ид'), val(node, 'Наименование'));
    for (const node of descendants(root, 'ТипЦены')) priceTypes.set(val(node, 'Ид'), val(node, 'Наименование'));
  }
  const offerById = new Map();
  for (const root of roots) for (const offer of descendants(root, 'Предложение')) {
    const id = val(offer, 'Ид');
    offerById.set(id, offer);
    if (id.includes('#') && !offerById.has(id.split('#')[0])) offerById.set(id.split('#')[0], offer);
  }
  const products = roots.flatMap(root => descendants(root, 'Товар'));
  if (!products.length) throw new Error('В CommerceML не найдены элементы Товар.');
  if (products.length > 10_000) throw new Error('Лимит — 10 000 товаров.');
  const issues = [];
  const vat = node => {
    const taxes = one(node, 'СтавкиНалогов');
    return val(taxes, 'Ставка') || kids(taxes, 'СтавкаНалога')
      .map(tax => val(tax, 'Ставка')).find(Boolean) ||
      kids(taxes, 'Налог').map(tax => val(tax, 'Ставка')).find(Boolean) || '';
  };
  const records = products.map((product, index) => {
    const id = val(product, 'Ид');
    const groupId = val(one(product, 'Группы'), 'Ид');
    const category = categories.get(groupId) || [];
    const offer = offerById.get(id);
    const record = {
      'Ид': id, 'Артикул': val(product, 'Артикул') || val(offer, 'Артикул'),
      'Название': val(product, 'Наименование'), 'Категория': category.join(' / '),
      'Остаток': val(offer, 'Количество') || val(product, 'Количество'),
      'Ставка НДС': vat(product) || vat(offer),
      'Описание': val(product, 'Описание'), 'Фото 1': val(product, 'Картинка')
    };
    const pictures = kids(product, 'Картинка').map(node => node.text.trim()).filter(Boolean);
    record['Фото 2'] = pictures[1] || '';
    record['Другие фото'] = pictures.slice(2).join(' | ');
    category.forEach((name, level) => { record['Категория ' + (level + 1)] = name; });
    for (const price of kids(one(offer, 'Цены'), 'Цена')) {
      const typeId = val(price, 'ИдТипаЦены');
      const name = priceTypes.get(typeId) || typeId || 'Основная';
      record['Цена: ' + name] = val(price, 'ЦенаЗаЕдиницу');
      record['Валюта: ' + name] = val(price, 'Валюта');
    }
    for (const prop of kids(one(product, 'ЗначенияСвойств'), 'ЗначенияСвойства'))
      record['Свойство: ' + (properties.get(val(prop, 'Ид')) || val(prop, 'Ид'))] = val(prop, 'Значение');
    if (!record['Артикул']) issues.push({ row: index + 1, reason: 'Нет артикула' });
    if (!offer) issues.push({ row: index + 1, reason: 'Нет связанного предложения или остатка для ' + id });
    return record;
  });
  return { table: objectsToTable(records), issues, total: products.length, mode: 'commerce-import' };
}
