#!/bin/bash
# حذف الحساب التجريبي وكل بياناته وصوره قبل الإطلاق العام
set -euo pipefail
APP=/opt/wasm
cd "$APP"
sudo -u wasm bash -c "cd $APP && set -a && . ./.env && set +a && node --disable-warning=ExperimentalWarning -e \"
const fs = require('fs'), path = require('path');
const db = require('./server/lib/db'); db.open(process.env.DB_FILE || './data/wasm.db');
const u = db.one('SELECT id FROM users WHERE email=?', 'demo@wasm.demo');
if (!u) { console.log('لا يوجد حساب تجريبي'); process.exit(0); }
db.run('DELETE FROM users WHERE id=?', u.id);
fs.rmSync(path.join(process.env.UPLOAD_DIR || './data/uploads', u.id), { recursive: true, force: true });
console.log('✅ تم حذف الحساب التجريبي وبياناته');
\""
systemctl restart wasm
