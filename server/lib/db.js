'use strict';
// طبقة قاعدة البيانات. في المرحلة الأولى نستخدم SQLite المدمج في Node (بدون اعتماديات خارجية)
// وكل الاستعلامات مكتوبة بـ SQL قياسي متوافق مع PostgreSQL قدر الإمكان، ومعزولة في الوحدات
// حتى يمكن استبدال المحرك بـ PostgreSQL (db/postgres/001_schema.sql) دون إعادة بناء النظام.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let db = null;

function open(file) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate();
  return db;
}

function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  seedCountries();
}

function seedCountries() {
  const rows = [
    ['SA', 'السعودية', 'Saudi Arabia', 'SAR', '+966'],
    ['QA', 'قطر', 'Qatar', 'QAR', '+974'],
    ['AE', 'الإمارات', 'United Arab Emirates', 'AED', '+971'],
    ['KW', 'الكويت', 'Kuwait', 'KWD', '+965'],
    ['BH', 'البحرين', 'Bahrain', 'BHD', '+973'],
    ['OM', 'عُمان', 'Oman', 'OMR', '+968'],
  ];
  const st = db.prepare('INSERT OR IGNORE INTO countries(code,name_ar,name_en,currency,phone_prefix) VALUES (?,?,?,?,?)');
  for (const r of rows) st.run(...r);
}

function get() { if (!db) throw new Error('DB not open'); return db; }

function tx(fn) {
  const d = get();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

function close() { if (db) { db.close(); db = null; } }

// نحول كائنات null-prototype إلى كائنات عادية لتسهيل JSON
const plain = r => (r ? { ...r } : r);
const all = (sql, ...p) => get().prepare(sql).all(...p).map(plain);
const one = (sql, ...p) => plain(get().prepare(sql).get(...p));
const run = (sql, ...p) => get().prepare(sql).run(...p);

module.exports = { open, get, tx, close, all, one, run };
