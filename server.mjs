import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseCsv, suggestMapping, convertCsv, toYml, toCleanCsv } from './lib.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'feed-studio.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, filename TEXT NOT NULL,
  total INTEGER NOT NULL, accepted INTEGER NOT NULL, rejected INTEGER NOT NULL,
  issues_json TEXT NOT NULL, preview_json TEXT NOT NULL, feed TEXT NOT NULL, clean_csv TEXT NOT NULL
)`);

const json = (res, code, body) => send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
function send(res, code, body, type, name) {
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (name) headers['Content-Disposition'] = `attachment; filename="${name}"`;
  res.writeHead(code, headers); res.end(body);
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_000_000) throw new Error('Файл слишком большой. Лимит — 2 МБ CSV.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Некорректный JSON-запрос.'); }
}
function checkCsv(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 2_000_000) throw new Error('Выберите CSV-файл до 2 МБ.');
}

const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/sample/catalog.csv', ['sample/catalog.csv', 'text/csv; charset=utf-8']]
]);
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      return send(res, 200, readFileSync(join(root, file)), type);
    }
    if (req.method === 'POST' && path === '/api/inspect') {
      const { csv } = await readJson(req); checkCsv(csv);
      const parsed = parseCsv(csv);
      return json(res, 200, { headers: parsed.headers, delimiter: parsed.delimiter,
        rows: parsed.rows.length, sample: parsed.rows.slice(0, 4).map(row => row.cells),
        mapping: suggestMapping(parsed.headers) });
    }
    if (req.method === 'POST' && path === '/api/convert') {
      const body = await readJson(req); checkCsv(body.csv);
      const parsed = parseCsv(body.csv);
      if (parsed.rows.length > 10_000) throw new Error('Лимит — 10 000 товаров за одну загрузку.');
      const result = convertCsv(body.csv, body.mapping, body.shop);
      const id = randomUUID();
      const record = { id, createdAt: new Date().toISOString(), filename: String(body.filename || 'catalog.csv').slice(0, 120),
        total: result.total, accepted: result.products.length, rejected: result.issues.length,
        issues: result.issues, preview: result.products.slice(0, 8) };
      db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, record.createdAt, record.filename, record.total, record.accepted, record.rejected,
        JSON.stringify(record.issues), JSON.stringify(record.preview), toYml(result), toCleanCsv(result));
      return json(res, 200, record);
    }
    if (req.method === 'GET' && path === '/api/runs') return json(res, 200,
      db.prepare('SELECT id, created_at AS createdAt, filename, total, accepted, rejected FROM runs ORDER BY created_at DESC LIMIT 10').all());
    const match = path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(feed\.yml|clean\.csv))?$/);
    if (req.method === 'GET' && match) {
      const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(match[1]);
      if (!row) return json(res, 404, { error: 'Конвертация не найдена.' });
      if (match[2] === 'feed.yml') return send(res, 200, row.feed, 'application/xml; charset=utf-8', 'catalog-feed.yml');
      if (match[2] === 'clean.csv') return send(res, 200, row.clean_csv, 'text/csv; charset=utf-8', 'catalog-clean.csv');
      return json(res, 200, { id: row.id, createdAt: row.created_at, filename: row.filename,
        total: row.total, accepted: row.accepted, rejected: row.rejected,
        issues: JSON.parse(row.issues_json), preview: JSON.parse(row.preview_json) });
    }
    json(res, 404, { error: 'Страница не найдена.' });
  } catch (error) { json(res, 400, { error: error.message || 'Ошибка обработки.' }); }
});

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
server.listen(port, host, () => console.log(`Product Feed Studio: http://${host}:${port}`));
