const $ = id => document.getElementById(id);
const maxBytes = 2_000_000;

async function fileText(file) {
  if (!file || file.size > maxBytes) throw new Error('Выберите файл до 2 МБ.');
  const bytes = await file.arrayBuffer();
  const start = new TextDecoder('ascii').decode(bytes.slice(0, 180)).toLowerCase();
  const encoding = /encoding=["'](?:windows-1251|cp1251)["']/.test(start) ? 'windows-1251' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
async function filePayload(file) {
  if (!file || file.size > maxBytes) throw new Error('Каждый файл должен быть не больше 2 МБ.');
  const ext = file.name.split('.').at(-1).toLowerCase();
  const payload = { filename: file.name, format: ext };
  if (ext === 'xlsx') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    payload.xlsx = btoa(binary);
  } else if (ext === 'json') payload.json = await file.text();
  else if (ext === 'csv') {
    const bytes = await file.arrayBuffer();
    let csv = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (csv.includes('�')) csv = new TextDecoder('windows-1251').decode(bytes);
    payload.csv = csv;
  } else throw new Error('Поддерживаются CSV, XLSX и JSON.');
  return payload;
}
async function post(body) {
  const response = await fetch('/api/workflows', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Ошибка обработки.');
  return result;
}
function show(result) {
  const root = '/api/workflows/' + result.id + '/';
  $('workflow-output').hidden = false;
  $('workflow-summary').textContent = result.total + ' строк · ' + result.columns + ' колонок · ' + result.warnings + ' замечаний';
  $('workflow-csv').href = root + 'output.csv';
  $('workflow-xlsx').href = root + 'output.xlsx';
  $('workflow-issues').href = root + 'issues.csv';
  $('workflow-issues').hidden = !result.warnings;
  const table = $('workflow-preview');
  table.replaceChildren();
  const head = document.createElement('tr');
  for (const label of result.headers) {
    const th = document.createElement('th'); th.textContent = label; head.append(th);
  }
  table.append(head);
  for (const row of result.preview) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td'); td.textContent = String(cell ?? ''); tr.append(td);
    }
    table.append(tr);
  }
  $('workflow-warnings').replaceChildren(...result.issues.map(issue => {
    const li = document.createElement('li');
    li.textContent = [issue.file, issue.row ? 'строка ' + issue.row : '', issue.reason].filter(Boolean).join(' · ');
    return li;
  }));
  $('workflow-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function status(id, text, good = false) {
  $(id).textContent = text;
  $(id).classList.toggle('ok', good);
}
function changeModes() {
  $('offers-wrap').hidden = $('xml-mode').value !== 'commerce-import';
  $('reconcile-options').hidden = $('batch-mode').value !== 'reconcile';
}
$('xml-mode').addEventListener('change', changeModes);
$('batch-mode').addEventListener('change', changeModes);
$('xml-run').addEventListener('click', async () => {
  const button = $('xml-run');
  button.disabled = true;
  status('xml-status', 'Читаю и проверяю XML…');
  try {
    const result = await post({ mode: $('xml-mode').value, xml: await fileText($('xml-file').files[0]),
      offersXml: $('offers-file').files[0] ? await fileText($('offers-file').files[0]) : '' });
    show(result); status('xml-status', 'Готово: ' + result.total + ' строк.', true);
  } catch (error) { status('xml-status', error.message); }
  finally { button.disabled = false; }
});
$('batch-run').addEventListener('click', async () => {
  const button = $('batch-run');
  button.disabled = true;
  status('batch-status', 'Читаю и проверяю файлы…');
  try {
    const inputs = [...$('batch-files').files];
    if (inputs.length < 2 || inputs.length > 5) throw new Error('Выберите от 2 до 5 файлов.');
    const files = await Promise.all(inputs.map(filePayload));
    const mapFile = $('map-file').files[0] ? await filePayload($('map-file').files[0]) : undefined;
    let rules;
    try { rules = $('rules-json').value.trim() ? JSON.parse($('rules-json').value) : undefined; }
    catch { throw new Error('Проверьте JSON особых правил.'); }
    const result = await post({ mode: $('batch-mode').value, files, mapFile,
      options: { markup: Number($('markup').value), discount: Number($('discount').value),
        rates: { USD: Number($('usd-rate').value), EUR: Number($('eur-rate').value) }, rules } });
    show(result); status('batch-status', 'Готово: ' + result.total + ' строк.', true);
  } catch (error) { status('batch-status', error.message); }
  finally { button.disabled = false; }
});
changeModes();
