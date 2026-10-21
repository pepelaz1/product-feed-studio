const $ = id => document.getElementById(id);
const fields = [
  ['sku', 'Артикул', true], ['name', 'Название', true], ['category', 'Категория', false],
  ['price', 'Цена', true], ['url', 'Ссылка на товар', false], ['description', 'Описание', false],
  ['details', 'Краткие характеристики', false],
  ['image', 'Ссылки на фото (;)', false], ['stock', 'Остаток (шт.)', false]
];
let csv = '', xlsx = '', jsonText = '', filename = '', fileBytes = 0, sheet = '';
let mode = 'yml', modeManuallySelected = false, headerLineChoice = 'auto';
const message = (value, ok = false) => { $('message').textContent = value; $('message').classList.toggle('ok', ok); };
const api = async (path, body) => {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера.');
  return data;
};
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
let openDropdown = null;
let openDropdownWrap = null;
document.addEventListener('pointerdown', event => {
  if (openDropdownWrap && !openDropdownWrap.contains(event.target)) openDropdown?.();
});
function enhanceSelect(select) {
  const wrap = select.parentElement;
  wrap.classList.add('dropdown');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const label = document.querySelector(`label[for="${select.id}"]`);
  const button = el('button', 'dropdown-trigger');
  button.type = 'button';
  button.id = `${select.id}-trigger`;
  button.setAttribute('aria-label', label?.innerText.trim() || select.id);
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const value = el('span', 'dropdown-value');
  const chevron = el('span', 'dropdown-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  button.append(value, chevron);
  const menu = el('div', 'dropdown-menu');
  menu.id = `${select.id}-options`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', label?.innerText.trim() || select.id);
  menu.hidden = true;
  button.setAttribute('aria-controls', menu.id);
  const options = [...select.options].map(option => {
    const item = el('button', 'dropdown-option');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.append(el('span', '', option.textContent), el('span', 'dropdown-check', '✓'));
    item.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      update();
      close();
      button.focus();
    });
    menu.append(item);
    return item;
  });
  function update() {
    value.textContent = select.selectedOptions[0]?.textContent || '— Не выбрано —';
    options.forEach(item => item.setAttribute('aria-selected', String(item.dataset.value === select.value)));
  }
  function close() {
    menu.hidden = true;
    wrap.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    if (openDropdown === close) {
      openDropdown = null;
      openDropdownWrap = null;
    }
  }
  function open() {
    openDropdown?.();
    menu.hidden = false;
    wrap.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    openDropdown = close;
    openDropdownWrap = wrap;
  }
  button.addEventListener('click', () => menu.hidden ? open() : close());
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
      options[Math.max(0, options.findIndex(item => item.dataset.value === select.value))]?.focus();
    } else if (event.key === 'Escape') close();
  });
  menu.addEventListener('keydown', event => {
    const index = options.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(options.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'Escape') { close(); button.focus(); event.preventDefault(); return; }
    else if (event.key === 'Tab') { close(); return; }
    else return;
    event.preventDefault();
    options[next]?.focus();
  });
  if (label) label.htmlFor = button.id;
  wrap.append(button, menu);
  update();
}
function renderPreview(data) {
  const table = $('preview-table'); table.replaceChildren();
  const head = el('tr');
  data.headers.forEach(header => head.append(el('th', '', header)));
  const thead = el('thead'); thead.append(head); table.append(thead);
  const tbody = el('tbody');
  data.sample.forEach(row => { const tr = el('tr'); row.forEach(value => tr.append(el('td', '', value.slice(0, 80)))); tbody.append(tr); });
  table.append(tbody); $('preview-wrap').hidden = false;
}
function renderMapping(data) {
  $('mapping-empty').hidden = true;
  const container = $('mapping-fields'); container.replaceChildren(); container.hidden = false;
  fields.forEach(([key, label, required]) => {
    const row = el('div', 'mapping-row');
    const caption = el('label'); caption.htmlFor = `map-${key}`; caption.textContent = label;
    if (required || key === 'url' || key === 'category') {
      const mark = el('span', '', ' *');
      if (key === 'url' || key === 'category') {
        mark.id = `map-${key}-required`; mark.hidden = mode !== 'yml';
      }
      caption.append(mark);
    }
    const wrap = el('span', 'select-wrap');
    const select = el('select'); select.id = `map-${key}`;
    select.append(new Option('— Не выбрано —', ''));
    data.headers.forEach(header => select.append(new Option(header, header)));
    select.value = data.mapping[key] || '';
    wrap.append(select); row.append(caption, wrap); container.append(row);
    enhanceSelect(select);
  });
  renderPreview(data);
  $('convert-btn').disabled = false;
}
function renderSheets(data) {
  const control = $('sheet-control');
  control.hidden = !data.sheets?.length;
  if (control.hidden) return;
  const wrap = $('sheet-wrap'); wrap.replaceChildren(); wrap.className = 'select-wrap';
  document.querySelector('#sheet-control label').htmlFor = 'sheet';
  const select = el('select'); select.id = 'sheet';
  data.sheets.forEach(name => select.append(new Option(name, name)));
  sheet = data.sheet;
  select.value = sheet;
  select.addEventListener('change', () => { sheet = select.value; headerLineChoice = 'auto'; inspect(); });
  wrap.append(select); enhanceSelect(select);
}
const source = () => xlsx ? { format: 'xlsx', xlsx, sheet } : jsonText ? { format: 'json', json: jsonText } : { format: 'csv', csv };
function setMode(nextMode, manual = false) {
  mode = nextMode;
  if (manual) modeManuallySelected = true;
  document.querySelectorAll('[data-mode]').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  $('shop-settings').hidden = mode !== 'yml';
  $('convert-btn').firstChild.textContent = mode === 'yml' ? 'Проверить и создать фид ' : 'Проверить и подготовить таблицу ';
  $('mode-hint').textContent = mode === 'yml'
    ? 'YML требует ссылку на каждый товар. Дополнительные поля зависят от категории; перед рабочей загрузкой проверьте файл в кабинете продавца.'
    : 'Для обычной товарной таблицы нужны артикул, название и цена. Категория и ссылка необязательны.';
  for (const key of ['url', 'category']) {
    const mark = $(`map-${key}-required`);
    if (mark) mark.hidden = mode !== 'yml';
  }
  $('map-url-trigger')?.setAttribute('aria-label', mode === 'yml' ? 'Ссылка на товар *' : 'Ссылка на товар');
  $('result-panel').hidden = true;
}
async function inspect() {
  try {
    const data = await api('/api/inspect', { ...source(), headerLine: headerLineChoice });
    if (!modeManuallySelected) setMode(data.mapping.url ? 'yml' : 'clean');
    renderMapping(data);
    renderSheets(data);
    $('header-line').value = data.headerLine;
    $('header-line').disabled = Boolean(jsonText);
    $('header-auto').disabled = Boolean(jsonText);
    $('header-note').textContent = data.headerLine === 1
      ? 'Заголовки найдены в первой строке — ничего не пропущено.'
      : `Заголовки найдены в строке ${data.headerLine}; строки 1–${data.headerLine - 1} пропущены.`;
    $('file-title').textContent = filename;
    $('file-note').textContent = `${data.rows} строк · ${fileBytes.toLocaleString('ru')} байт`;
    const count = data.headers.length;
    message(`Файл загружен. Найдено ${count} ${count % 10 === 1 && count % 100 !== 11 ? 'колонка' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'колонки' : 'колонок'}; проверьте сопоставление.`, true);
  } catch (error) { $('convert-btn').disabled = true; message(error.message); }
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) return message('Файл больше 2 МБ.');
  const isExcel = /\.xlsx$/i.test(file.name);
  const isJson = /\.json$/i.test(file.name);
  if (!isExcel && !isJson && !/\.csv$/i.test(file.name)) return message('Выберите файл .csv, .xlsx или .json.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isExcel) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x4000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
    xlsx = btoa(binary); csv = ''; jsonText = '';
  } else if (isJson) { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); csv = ''; xlsx = ''; }
  else { csv = new TextDecoder($('encoding').value).decode(bytes); xlsx = ''; jsonText = ''; }
  $('encoding-control').hidden = isExcel || isJson;
  fileBytes = file.size; sheet = '';
  filename = file.name;
  headerLineChoice = 'auto'; modeManuallySelected = false;
  inspect();
}
function showResult(data) {
  $('result-panel').hidden = false;
  $('result-file').textContent = data.filename;
  $('total').textContent = data.total;
  $('accepted').textContent = data.accepted;
  $('rejected').textContent = data.rejected;
  $('feed-link').href = `/api/runs/${data.id}/feed.yml`;
  $('feed-link').hidden = data.mode !== 'yml';
  $('csv-link').href = `/api/runs/${data.id}/clean.csv`;
  $('xlsx-link').href = `/api/runs/${data.id}/clean.xlsx`;
  $('json-link').href = `/api/runs/${data.id}/clean.json`;
  $('json-link').hidden = !data.jsonAvailable;
  $('supplier-csv-link').href = `/api/runs/${data.id}/supplier.csv`;
  $('supplier-xlsx-link').href = `/api/runs/${data.id}/supplier.xlsx`;
  $('supplier-csv-link').hidden = !data.supplierAvailable;
  $('supplier-xlsx-link').hidden = !data.supplierAvailable;
  $('issues-link').href = `/api/runs/${data.id}/issues.csv`;
  $('issues-link').hidden = !data.issues.length;
  const issues = $('issues-list'); issues.replaceChildren();
  data.issues.forEach(issue => {
    const item = el('li'); item.append(el('b', '', `Строка ${issue.line}${issue.sku ? ` · ${issue.sku}` : ''}: `), document.createTextNode(issue.message)); issues.append(item);
  });
  $('issues-wrap').hidden = !data.issues.length;
  const n = data.accepted;
  const noun = n % 100 >= 11 && n % 100 <= 14 ? 'товаров' :
    n % 10 === 1 ? 'товар' : n % 10 >= 2 && n % 10 <= 4 ? 'товара' : 'товаров';
  message(`Готово: ${n} ${noun}. Доступны полная и краткая товарные таблицы${data.mode === 'yml' ? ', а также YML' : ''}.`, true);
  $('result-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function history() {
  try {
    const runs = await api('/api/runs');
    if (!runs.length) return;
    const container = $('history'); container.replaceChildren();
    runs.forEach(run => {
      const row = el('a', 'history-item'); row.href = `#${run.id}`;
      const left = el('span'); left.append(el('strong', '', run.filename), el('small', '', new Date(run.createdAt).toLocaleString('ru-RU')));
      row.append(left, el('b', '', `${run.accepted} / ${run.total} ✓`));
      row.addEventListener('click', async event => {
        event.preventDefault();
        try { showResult(await api(`/api/runs/${run.id}`)); }
        catch (error) { message(error.message); }
      });
      container.append(row);
    });
  } catch { $('history').textContent = 'История пока недоступна.'; }
}
const zone = $('dropzone');
zone.addEventListener('click', () => $('file').click());
zone.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); $('file').click(); } });
zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); loadFile(event.dataTransfer.files[0]); });
$('file').addEventListener('change', event => loadFile(event.target.files[0]));
$('encoding').addEventListener('change', () => { if ($('file').files[0]) loadFile($('file').files[0]); });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode, true)));
$('header-line').addEventListener('change', () => {
  headerLineChoice = Number($('header-line').value);
  if (csv || xlsx || jsonText) inspect();
});
$('header-auto').addEventListener('click', () => { headerLineChoice = 'auto'; if (csv || xlsx || jsonText) inspect(); });
enhanceSelect($('encoding'));
$('sample-btn').addEventListener('click', async () => {
  try { csv = await (await fetch('/sample/ready-catalog.csv')).text(); xlsx = ''; jsonText = ''; sheet = ''; $('file').value = ''; fileBytes = new Blob([csv]).size; $('encoding-control').hidden = false; filename = 'ready-catalog.csv'; headerLineChoice = 'auto'; modeManuallySelected = false; inspect(); }
  catch (error) { message(error.message); }
});
$('convert-btn').addEventListener('click', async () => {
  const button = $('convert-btn'); button.disabled = true; message('Проверяем товары…', true);
  try {
    const mapping = Object.fromEntries(fields.map(([key]) => [key, $(`map-${key}`).value]));
    const shop = { name: $('shop-name').value, company: $('company').value, url: $('shop-url').value };
    showResult(await api('/api/convert', { ...source(), filename, mapping, shop, mode, headerLine: headerLineChoice }));
    history();
  } catch (error) { message(error.message); }
  finally { button.disabled = false; }
});
history();
