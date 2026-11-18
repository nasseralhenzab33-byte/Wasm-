'use strict';
// أسماء الإبل حسب العمر — حسب الجدول الذي أرسله صاحب المشروع.
// الجدول قابل للتعديل من مكان واحد. "حتى" = العمر بالأشهر المكتملة (غير شامل).
const AGE_NAMES = [
  { key: 'hwar',   m: 'حوار',  f: 'حوار',    fromMonths: 0,  label: 'من الولادة حتى يكمل سنة' },
  { key: 'mafrud', m: 'مفرود', f: 'مفرودة',  fromMonths: 12, label: 'يكمل سنة ويُفصل عن أمه' },
  { key: 'hig',    m: 'حق',    f: 'حقة',     fromMonths: 24, label: 'يكمل سنتين' },
  { key: 'lgi',    m: 'لقي',   f: 'لقية',    fromMonths: 36, label: 'يكمل ثلاث سنوات' },
  { key: 'jitha',  m: 'جذع',   f: 'جذعة',    fromMonths: 48, label: 'يكمل أربع سنوات' },
  { key: 'thani',  m: 'ثني',   f: 'ثنية',    fromMonths: 60, label: 'يكمل خمس سنوات' },
  { key: 'rubaa',  m: 'رباع',  f: 'رباعية',  fromMonths: 72, label: 'يكمل ست سنوات' },
  { key: 'sadees', m: 'سديس',  f: 'سديسة',   fromMonths: 84, label: 'يكمل سبع سنوات' },
  { key: 'fater',  m: 'بعير',  f: 'فاطر',    fromMonths: 96, label: 'ثماني سنوات فأكثر' },
];

function monthsBetween(fromISO, toISO) {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m -= 1;
  return Math.max(0, m);
}

function ageName(birthDate, sex, todayISO) {
  if (!birthDate) return null;
  const months = monthsBetween(birthDate, todayISO);
  let row = AGE_NAMES[0];
  for (const r of AGE_NAMES) if (months >= r.fromMonths) row = r;
  return { key: row.key, name: sex === 'female' ? row.f : row.m, months };
}

// كلمات البحث (مفرد + مؤنث + جموع شائعة) بعد التطبيع
const AGE_WORDS = {
  hwar: ['حوار', 'حيران', 'حواير'],
  mafrud: ['مفرود', 'مفروده', 'مفاريد', 'مفرودات'],
  hig: ['حق', 'حقه', 'حقاق', 'حقق'],
  lgi: ['لقي', 'لقيه', 'لقايا'],
  jitha: ['جذع', 'جذعه', 'جذعان', 'جذاع'],
  thani: ['ثني', 'ثنيه', 'ثنايا', 'ثنيان'],
  rubaa: ['رباع', 'رباعيه', 'ربعان'],
  sadees: ['سديس', 'سديسه', 'سدسان'],
  fater: ['فاطر', 'فواطر', 'بعير', 'بعران'],
};

module.exports = { AGE_NAMES, AGE_WORDS, ageName, monthsBetween };
