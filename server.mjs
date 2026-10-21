import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseCsv, suggestMapping, convertCsv, toYml, toCleanCsv, toSupplierCsv, toIssuesCsv, toCleanJson, jsonToCsv } from './lib.mjs';
import { readXlsx, cleanXlsx } from './xlsx.mjs';
import { csvToTable, rowsToCsv } from './tabular.mjs';
import { importYml, importCommerceMl } from './xml-import.mjs';
import { mergeTables, reconcileTables } from './batch.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'feed-studio.sqlite'));
db.exec("CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, mode TEXT NOT NULL, summary_json TEXT NOT NULL, preview_json TEXT NOT NULL, output_csv TEXT NOT NULL, issues_csv TEXT NOT NULL)");
db.exec(`CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, filename TEXT NOT NULL,
  total INTEGER NOT NULL, accepted INTEGER NOT NULL, rejected INTEGER NOT NULL,
  issues_json TEXT NOT NULL, preview_json TEXT NOT NULL, feed TEXT NOT NULL, clean_csv TEXT NOT NULL
)`);
if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'supplier_csv'))
  db.exec("ALTER TABLE runs ADD COLUMN supplier_csv TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'clean_json'))
  db.exec("ALTER TABLE runs ADD COLUMN clean_json TEXT NOT NULL DEFAULT ''");

const json = (res, code, body) => send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
function send(res, code, body, type, name) {
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (name) headers['Content-Disposition'] = `attachment; filename="${name}"`;
  res.writeHead(code, headers); res.end(body);
}
async function readJson(req, limit = 4_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Запрос слишком большой.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Некорректный JSON-запрос.'); }
}
function checkCsv(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 2_000_000) throw new Error('Выберите CSV-файл до 2 МБ.');
}
async function source(body) {
  if (body.format === 'json') {
    if (typeof body.json !== 'string' || Buffer.byteLength(body.json) > 2_000_000)
      throw new Error('Выберите JSON-файл до 2 МБ.');
    return { csv: jsonToCsv(body.json), sheets: [], sheet: '' };
  }
  if (body.format === 'xlsx') {
    if (typeof body.xlsx !== 'string' || body.xlsx.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.xlsx))
      throw new Error('Выберите XLSX-файл до 2 МБ.');
    const buffer = Buffer.from(body.xlsx, 'base64');
    if (buffer.length > 2_000_000) throw new Error('Выберите XLSX-файл до 2 МБ.');
    return readXlsx(buffer, body.sheet);
  }
  checkCsv(body.csv);
  return { csv: body.csv, sheets: [], sheet: '' };
}

const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/ozon-theme.css', ['public/ozon-theme.css', 'text/css; charset=utf-8']],
  ['/sample/catalog.csv', ['sample/catalog.csv', 'text/csv; charset=utf-8']],
  ['/sample/supplier-catalog.csv', ['sample/supplier-catalog.csv', 'text/csv; charset=utf-8']],
  ['/sample/supplier-catalog.json', ['sample/supplier-catalog.json', 'application/json; charset=utf-8']],
  ['/sample/ready-catalog.csv', ['sample/ready-catalog.csv', 'text/csv; charset=utf-8']],
  ['/sample/ready-catalog.xlsx', ['sample/ready-catalog.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['/workflows.js', ['public/workflows.js', 'text/javascript; charset=utf-8']],
  ['/sample/example.yml', ['sample/example.yml', 'application/xml; charset=utf-8']],
  ['/sample/example-commerce.xml', ['sample/example-commerce.xml', 'application/xml; charset=utf-8']],
  ['/sample/example-offers.xml', ['sample/example-offers.xml', 'application/xml; charset=utf-8']],
  ['/sample/example-supplier-a.csv', ['sample/example-supplier-a.csv', 'text/csv; charset=utf-8']],
  ['/sample/example-supplier-b.csv', ['sample/example-supplier-b.csv', 'text/csv; charset=utf-8']],
  ['/sample/example-sku-map.csv', ['sample/example-sku-map.csv', 'text/csv; charset=utf-8']]
]);
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      return send(res, 200, readFileSync(join(root, file)), type,
        path === '/sample/supplier-catalog.json' ? 'supplier-catalog.json' :
          path === '/sample/supplier-catalog.csv' ? 'supplier-catalog.csv' :
          path === '/sample/ready-catalog.csv' ? 'ready-catalog.csv' :
          path === '/sample/ready-catalog.xlsx' ? 'ready-catalog.xlsx' : undefined);
    }
    if (req.method === 'POST' && path === '/api/inspect') {
      const body = await readJson(req);
      const input = await source(body);
      const parsed = parseCsv(input.csv, body.headerLine);
      return json(res, 200, { headers: parsed.headers, delimiter: parsed.delimiter,
        rows: parsed.rows.length, headerLine: parsed.headerLine, sheets: input.sheets, sheet: input.sheet,
        sample: parsed.rows.slice(0, 4).map(row => row.cells),
        mapping: suggestMapping(parsed.headers) });
    }
    if (req.method === 'POST' && path === '/api/convert') {
      const body = await readJson(req);
      const input = await source(body);
      const mode = body.mode || 'yml';
      const parsed = parseCsv(input.csv, body.headerLine);
      if (parsed.rows.length > 10_000) throw new Error('Лимит — 10 000 товаров за одну загрузку.');
      const result = convertCsv(input.csv, body.mapping, body.shop, { mode, headerLine: body.headerLine });
      const id = randomUUID();
      const record = { id, createdAt: new Date().toISOString(), filename: String(body.filename || 'catalog.csv').slice(0, 120),
        mode,
        total: result.total, accepted: result.products.length, rejected: result.issues.length,
        issues: result.issues, preview: result.products.slice(0, 8), supplierAvailable: true, jsonAvailable: true };
      db.prepare(`INSERT INTO runs
        (id, created_at, filename, total, accepted, rejected, issues_json, preview_json, feed, clean_csv, supplier_csv, clean_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, record.createdAt, record.filename,
        record.total, record.accepted, record.rejected, JSON.stringify(record.issues), JSON.stringify(record.preview),
        mode === 'yml' ? toYml(result) : '', toCleanCsv(result), toSupplierCsv(result), toCleanJson(result));
      return json(res, 200, record);
    }
    if (req.method === 'POST' && path === '/api/workflows') {
      const body = await readJson(req, 18_000_000);
      let result;
      if (body.mode === 'yml-import') result = importYml(body.xml);
      else if (body.mode === 'commerce-import') result = importCommerceMl(body.xml, body.offersXml || '');
      else if (body.mode === 'merge' || body.mode === 'reconcile') {
        if (!Array.isArray(body.files) || body.files.length > 5) throw new Error('Выберите до пяти файлов.');
        const files = [];
        for (const file of body.files) {
          const input = await source(file);
          files.push({ filename: String(file.filename || 'source.csv'), table: csvToTable(input.csv, file.headerLine || 'auto') });
        }
        let skuMap;
        if (body.mapFile) {
          const input = await source(body.mapFile);
          skuMap = csvToTable(input.csv, body.mapFile.headerLine || 'auto');
        }
        result = body.mode === 'merge' ? mergeTables(files) : reconcileTables(files, body.options || {}, skuMap);
      } else throw new Error('Неизвестный режим обработки.');
      if (result.table.headers.length > 100) throw new Error('Результат превысил 100 колонок. Уменьшите число свойств.');
      const id = randomUUID();
      const output = rowsToCsv(result.table.headers, result.table.rows);
      const issueCsv = rowsToCsv(['Файл', 'Строка', 'Артикул', 'Причина'],
        result.issues.map(issue => [issue.file || '', issue.row, issue.sku || '', issue.reason]));
      const summary = { id, mode: result.mode, total: result.total, columns: result.table.headers.length,
        warnings: result.issues.length, ...(result.summary || {}) };
      db.prepare('INSERT INTO workflow_runs VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, new Date().toISOString(), result.mode, JSON.stringify(summary),
        JSON.stringify(result.table.rows.slice(0, 8)), output, issueCsv);
      return json(res, 200, { ...summary, headers: result.table.headers, preview: result.table.rows.slice(0, 8),
        issues: result.issues.slice(0, 10) });
    }
    const workflowMatch = path.match(/^\/api\/workflows\/([0-9a-f-]{36})\/(output\.csv|output\.xlsx|issues\.csv)$/);
    if (req.method === 'GET' && workflowMatch) {
      const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(workflowMatch[1]);
      if (!row) return json(res, 404, { error: 'Выгрузка не найдена.' });
      if (workflowMatch[2] === 'issues.csv') return send(res, 200, row.issues_csv, 'text/csv; charset=utf-8', 'feed-studio-issues.csv');
      if (workflowMatch[2] === 'output.csv') return send(res, 200, row.output_csv, 'text/csv; charset=utf-8', 'feed-studio-output.csv');
      return send(res, 200, await cleanXlsx(row.output_csv),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'feed-studio-output.xlsx');
    }
    if (req.method === 'GET' && path === '/api/runs') return json(res, 200,
      db.prepare("SELECT id, created_at AS createdAt, filename, total, accepted, rejected, CASE WHEN feed = '' THEN 'clean' ELSE 'yml' END AS mode FROM runs ORDER BY created_at DESC LIMIT 10").all());
    const match = path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(feed\.yml|clean\.csv|clean\.xlsx|clean\.json|supplier\.csv|supplier\.xlsx|issues\.csv))?$/);
    if (req.method === 'GET' && match) {
      const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(match[1]);
      if (!row) return json(res, 404, { error: 'Конвертация не найдена.' });
      if (match[2] === 'feed.yml') return row.feed ? send(res, 200, row.feed, 'application/xml; charset=utf-8', 'catalog-feed.yml') : json(res, 404, { error: 'Для этой выгрузки YML не создавался.' });
      if (match[2] === 'clean.csv') return send(res, 200, row.clean_csv, 'text/csv; charset=utf-8', 'catalog-clean.csv');
      if (match[2] === 'clean.json') return row.clean_json
        ? send(res, 200, row.clean_json, 'application/json; charset=utf-8', 'catalog-clean.json')
        : json(res, 404, { error: 'JSON недоступен для старой выгрузки.' });
      if (match[2] === 'clean.xlsx') return send(res, 200, await cleanXlsx(row.clean_csv),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'catalog-clean.xlsx');
      if (match[2] === 'supplier.csv' || match[2] === 'supplier.xlsx') {
        if (!row.supplier_csv) return json(res, 404, { error: 'Товарная таблица недоступна для старой выгрузки.' });
        return match[2] === 'supplier.csv'
          ? send(res, 200, row.supplier_csv, 'text/csv; charset=utf-8', 'supplier-catalog.csv')
          : send(res, 200, await cleanXlsx(row.supplier_csv),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'supplier-catalog.xlsx');
      }
      if (match[2] === 'issues.csv') return send(res, 200, toIssuesCsv(JSON.parse(row.issues_json)),
        'text/csv; charset=utf-8', 'catalog-issues.csv');
      return json(res, 200, { id: row.id, createdAt: row.created_at, filename: row.filename,
        mode: row.feed ? 'yml' : 'clean',
        total: row.total, accepted: row.accepted, rejected: row.rejected,
        issues: JSON.parse(row.issues_json), preview: JSON.parse(row.preview_json),
        supplierAvailable: Boolean(row.supplier_csv), jsonAvailable: Boolean(row.clean_json) });
    }
    json(res, 404, { error: 'Страница не найдена.' });
  } catch (error) { json(res, 400, { error: error.message || 'Ошибка обработки.' }); }
});

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
server.listen(port, host, () => console.log(`Product Feed Studio: http://${host}:${port}`));
