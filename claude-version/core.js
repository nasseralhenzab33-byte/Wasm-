/* وسم | WASM — نسخة Claude: "خادم" داخل الصفحة.
   نفس منطق الخادم (الحلال، التلقيح، الولادة، النسب، المساعد) لكن البيانات محفوظة
   في قاعدة بيانات الصفحة الخاصة بكل مستخدم: data/users/<id>/ — لا يراها غيره ولا حتى صاحب الصفحة. */
'use strict';

// ===================== وحدات مشتركة =====================
const DAY = 86400000;
const util = {
  id: () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2)),
  todayISO: (off = 180, now = Date.now()) => new Date(now + off * 60000).toISOString().slice(0, 10),
  addDays: (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10),
  diffDays: (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY),
  isISODate: s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; },
  normalizeAr: (s = '') => String(s)
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[؟?!،,.:؛]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
};
const __mods = { '../../lib/util': util };
function require(n) { return __mods[n]; }
