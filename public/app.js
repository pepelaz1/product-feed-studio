const $ = id => document.getElementById(id);
const fields = [
  ['sku', 'Артикул', true], ['name', 'Название', true], ['category', 'Категория', true],
  ['price', 'Цена', true], ['url', 'Ссылка на товар', true], ['description', 'Описание', false],
  ['image', 'Ссылки на фото (;)', false], ['stock', 'Остаток (шт.)', false]
];
let csv = '', filename = '';
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
    if (required) caption.append(el('span', '', ' *'));
    const wrap = el('span', 'select-wrap');
    const select = el('select'); select.id = `map-${key}`;
    select.append(new Option('— Не выбрано —', ''));
    data.headers.forEach(header => select.append(new Option(header, header)));
    select.value = data.mapping[key] || '';
    wrap.append(select); row.append(caption, wrap); container.append(row);
  });
  renderPreview(data);
  $('convert-btn').disabled = false;
}
async function inspect() {
  try {
    const data = await api('/api/inspect', { csv });
    renderMapping(data);
    $('file-title').textContent = filename;
    $('file-note').textContent = `${data.rows} строк · ${new Blob([csv]).size.toLocaleString('ru')} байт`;
    message(`Файл загружен. Найдено ${data.headers.length} колонок; проверьте сопоставление.`, true);
  } catch (error) { $('convert-btn').disabled = true; message(error.message); }
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) return message('Файл больше 2 МБ.');
  csv = new TextDecoder($('encoding').value).decode(await file.arrayBuffer());
  filename = file.name;
  inspect();
}
function showResult(data) {
  $('result-panel').hidden = false;
  $('result-file').textContent = data.filename;
  $('total').textContent = data.total;
  $('accepted').textContent = data.accepted;
  $('rejected').textContent = data.rejected;
  $('feed-link').href = `/api/runs/${data.id}/feed.yml`;
  $('csv-link').href = `/api/runs/${data.id}/clean.csv`;
  const issues = $('issues-list'); issues.replaceChildren();
  data.issues.forEach(issue => {
    const item = el('li'); item.append(el('b', '', `Строка ${issue.line}${issue.sku ? ` · ${issue.sku}` : ''}: `), document.createTextNode(issue.message)); issues.append(item);
  });
  $('issues-wrap').hidden = !data.issues.length;
  message(`Готово: ${data.accepted} товаров в выгрузке.`, true);
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
$('sample-btn').addEventListener('click', async () => {
  try { csv = await (await fetch('/sample/catalog.csv')).text(); filename = 'catalog.csv'; inspect(); }
  catch (error) { message(error.message); }
});
$('convert-btn').addEventListener('click', async () => {
  const button = $('convert-btn'); button.disabled = true; message('Проверяем товары…', true);
  try {
    const mapping = Object.fromEntries(fields.map(([key]) => [key, $(`map-${key}`).value]));
    const shop = { name: $('shop-name').value, company: $('company').value, url: $('shop-url').value };
    showResult(await api('/api/convert', { csv, filename, mapping, shop }));
    history();
  } catch (error) { message(error.message); }
  finally { button.disabled = false; }
});
history();
