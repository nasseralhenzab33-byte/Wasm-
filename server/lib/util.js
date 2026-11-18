'use strict';
const crypto = require('node:crypto');

const id = () => crypto.randomUUID();
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// ===== التواريخ (نعتمد YYYY-MM-DD بتوقيت الخليج UTC+3 أو UTC+4) =====
const DAY = 86400000;
function todayISO(tzOffsetMin = 180, now = Date.now()) {
  return new Date(now + tzOffsetMin * 60000).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}
function diffDays(a, b) { // b - a
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY);
}
function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// ===== تطبيع النص العربي للبحث والفهم =====
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
function normalizeAr(s = '') {
  return String(s)
    .replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d])
    .replace(/[ً-ٰٟـ]/g, '')   // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[؟?!،,.:؛]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { id, token, sha256, todayISO, addDays, diffDays, isISODate, normalizeAr, DAY };
