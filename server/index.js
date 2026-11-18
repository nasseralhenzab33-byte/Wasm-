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

// منصات الاستضافة (Railway / Render): إعدادات إنتاج افتراضية + استخدام القرص الدائم تلقائياً
const onPlatform = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER);
if (onPlatform) {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
}
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR;
if (volume) {
  process.env.DB_FILE = process.env.DB_FILE || path.join(volume, 'wasm.db');
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(volume, 'uploads');
} else if (onPlatform) {
  console.warn('⚠️ لا يوجد قرص دائم (Volume): البيانات ستضيع عند إعادة التشغيل. أضف Volume مركّباً على /data');
}

const db = require('./lib/db');
const { createApp } = require('./app');

db.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wasm.db'));

// ADMIN_EMAIL: البريد الذي يصبح مديراً عاماً (يكفي التسجيل به من الموقع)
const admins = String(process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
for (const e of admins) db.run("UPDATE users SET role='super_admin', admin_country_code=NULL WHERE lower(email)=? AND role<>'super_admin'", e);

// SEED_DEMO=1: بيانات تجريبية وهمية (مرة وحدة، ما تمس حسابات الناس الحقيقية)
if (process.env.SEED_DEMO === '1' && !db.one("SELECT 1 FROM users WHERE email='demo@wasm.demo'")) {
  require('../scripts/seed').seed({ silent: false }).catch(e => console.error('[seed]', e));
}
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const server = createApp();
server.listen(port, host, () => console.log(`🐪 وسم | WASM يعمل على http://localhost:${port}`));
require('./scheduler').start();

const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
