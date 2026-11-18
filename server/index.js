'use strict';
const path = require('node:path');
const fs = require('node:fs');

// تحميل متغيرات .env إن وُجد (بدون مكتبات)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const db = require('./lib/db');
const { createApp } = require('./app');

db.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wasm.db'));
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const server = createApp();
server.listen(port, host, () => console.log(`🐪 وسم | WASM يعمل على http://localhost:${port}`));
require('./scheduler').start();

const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
