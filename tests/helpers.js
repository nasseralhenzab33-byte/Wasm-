'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-up-'));
const db = require('../server/lib/db');
const { createApp } = require('../server/app');

async function start() {
  db.close();
  db.open(':memory:');
  const server = createApp();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, stop: () => new Promise(r => server.close(r)) };
}

// عميل HTTP بسيط يحتفظ بالكوكي
function client(base) {
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const h = { 'X-WASM-Client': '1', ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  return {
    get: p => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b), put: (p, b) => req('PUT', p, b), del: p => req('DELETE', p), raw: req,
    async register(email, extra = {}) {
      return req('POST', '/api/auth/register', { email, password: 'Strong-pass-123', display_name: 'مستخدم اختبار', country_code: 'QA', ...extra });
    },
  };
}

// صورة PNG صغيرة صالحة (1x1)
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

module.exports = { start, client, PNG_1x1, db };
