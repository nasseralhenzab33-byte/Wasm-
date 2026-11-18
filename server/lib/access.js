'use strict';
const db = require('./db');
const { HttpError } = require('./http');

const isSuper = u => !!u && u.role === 'super_admin';
const isAdmin = u => !!u && (u.role === 'super_admin' || u.role === 'country_admin');
// null = كل الدول (المدير العام)، أو رمز الدولة لمدير الدولة
function adminScope(u) {
  if (isSuper(u)) return null;
  if (u && u.role === 'country_admin') return u.admin_country_code || '__none__';
  throw new HttpError(403, 'forbidden', 'لوحة الإدارة للمديرين فقط');
}
function requireAdmin(ctx) {
  if (!ctx.user) throw new HttpError(401, 'unauthorized', 'يجب تسجيل الدخول');
  return adminScope(ctx.user);
}
function inScope(scope, country) {
  if (scope && scope !== country) throw new HttpError(403, 'forbidden', 'هذا خارج نطاق دولتك');
}
function requireActive(ctx) {
  if (!ctx.user) throw new HttpError(401, 'unauthorized', 'يجب تسجيل الدخول');
  const u = db.one('SELECT is_suspended FROM users WHERE id=?', ctx.user.id);
  if (u && u.is_suspended) throw new HttpError(403, 'suspended', 'الحساب موقوف مؤقتاً، تواصل مع إدارة وسم');
}

function setting(key, def) { const r = db.one('SELECT value FROM settings WHERE key=?', key); return r ? r.value : def; }
function setSetting(key, value) { db.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }

// تحويل تقريبي إلى الريال القطري للتقارير والتثمين (العملات الخليجية مربوطة بالدولار؛ الدينار الكويتي بسلة — تقريبي)
const QAR_PER = { QAR: 1, SAR: 0.9707, AED: 0.9911, BHD: 9.681, OMR: 9.467, KWD: 11.86 };
const toQAR = (amount, cur) => Math.round(Number(amount) * (QAR_PER[cur] || 1) * 100) / 100;
const CURRENCY_OF = { SA: 'SAR', QA: 'QAR', AE: 'AED', KW: 'KWD', BH: 'BHD', OM: 'OMR' };

module.exports = { isSuper, isAdmin, adminScope, requireAdmin, inScope, requireActive, setting, setSetting, toQAR, QAR_PER, CURRENCY_OF };
