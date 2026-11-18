'use strict';
// ترقية حساب موجود إلى مدير عام أو مدير دولة:  node scripts/make-admin.js email@example.com [--country QA]
const path = require('node:path');
const db = require('../server/lib/db');
db.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wasm.db'));
const [email, flag, country] = process.argv.slice(2);
if (!email) { console.log('الاستخدام: node scripts/make-admin.js email [--country QA]'); process.exit(1); }
const u = db.one('SELECT id FROM users WHERE lower(email)=lower(?)', email);
if (!u) { console.log('❌ لا يوجد حساب بهذا البريد — سجّل من الموقع أولاً'); process.exit(1); }
if (flag === '--country') {
  if (!['SA', 'QA', 'AE', 'KW', 'BH', 'OM'].includes(country)) { console.log('❌ الدولة: SA QA AE KW BH OM'); process.exit(1); }
  db.run("UPDATE users SET role='country_admin', admin_country_code=? WHERE id=?", country, u.id);
  console.log(`✅ ${email} صار مدير دولة (${country})`);
} else {
  db.run("UPDATE users SET role='super_admin', admin_country_code=NULL WHERE id=?", u.id);
  console.log(`✅ ${email} صار مديراً عاماً`);
}
