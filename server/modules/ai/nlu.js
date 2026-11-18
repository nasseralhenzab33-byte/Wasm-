'use strict';
// فهم اللغة الطبيعية الخليجية لأوامر إدارة الحلال — محلي وحتمي (بدون نموذج خارجي)
// الهدف: أن تعمل عمليات البيانات الحساسة (تسجيل/استعلام) بدقة ودون "هلوسة"، وأن يُستدعى النموذج اللغوي فقط للأسئلة المفتوحة.
const { normalizeAr, todayISO, addDays, isISODate } = require('../../lib/util');
const { AGE_WORDS } = require('../../lib/ageNames');
function ageKeyIn(n) { const toks = n.split(' ').map(t => t.replace(/^ال/, '')); for (const [k, ws] of Object.entries(AGE_WORDS)) if (toks.some(t => ws.includes(t))) return k; return null; }

const QUESTION = /^(متي|وش|ايش|شو|كم|هل|اي|ايه|ماذا|ماهي|ما هي|مين|من هي|من هو|وين|عطني|اعطني|ابي اعرف|ابغي اعرف|ابغى اعرف)(?:^|(?<=\s)|(?=\s)|$)/;

// ===== استخراج التاريخ =====
const NUM_WORDS = { 'يومين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5, 'اسبوع': 7, 'اسبوعين': 14 };
function extractDate(n, today = todayISO()) {
  let m;
  const rules = [
    [/(?:^|(?<=\s)|(?=\s)|$)(اول امس|اول البارحه|قبل امس)(?:^|(?<=\s)|(?=\s)|$)/, () => addDays(today, -2)],
    [/(?:^|(?<=\s)|(?=\s)|$)(امس|البارحه|امبارح)(?:^|(?<=\s)|(?=\s)|$)/, () => addDays(today, -1)],
    [/(?:^|(?<=\s)|(?=\s)|$)(اليوم|الحين|توه|توها|هالحين)(?:^|(?<=\s)|(?=\s)|$)/, () => today],
    [/(?:^|(?<=\s)|(?=\s)|$)قبل (\d{1,3}) (يوم|ايام)(?:^|(?<=\s)|(?=\s)|$)/, x => addDays(today, -Number(x[1]))],
    [/(?:^|(?<=\s)|(?=\s)|$)قبل (يومين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه)( ايام)?(?:^|(?<=\s)|(?=\s)|$)/, x => addDays(today, -NUM_WORDS[x[1]])],
    [/(?:^|(?<=\s)|(?=\s)|$)قبل (اسبوعين|اسبوع)(?:^|(?<=\s)|(?=\s)|$)/, x => addDays(today, -NUM_WORDS[x[1]])],
    [/(?:^|(?<=\s)|(?=\s)|$)(\d{4})-(\d{1,2})-(\d{1,2})(?:^|(?<=\s)|(?=\s)|$)/, x => `${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`],
    [/(?:^|(?<=\s)|(?=\s)|$)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:^|(?<=\s)|(?=\s)|$)/, x => `${x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`],
    [/(?:^|(?<=\s)|(?=\s)|$)(\d{1,2})[/-](\d{1,2})(?:^|(?<=\s)|(?=\s)|$)/, x => { const y = today.slice(0, 4); const d = `${y}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}`; return d > today ? `${Number(y) - 1}${d.slice(4)}` : d; }],
  ];
  for (const [re, fn] of rules) {
    if ((m = re.exec(n))) {
      const date = fn(m);
      if (!isISODate(date)) return { date: null, invalid: true, rest: n.replace(m[0], ' ').replace(/\s+/g, ' ').trim() };
      return { date, rest: n.replace(m[0], ' ').replace(/\s+/g, ' ').replace(/(?:^|(?<=\s)|(?=\s)|$)(بتاريخ|تاريخ|في|يوم)\s*$/, '').trim() };
    }
  }
  return { date: null, rest: n };
}

const FILLER_PRE = /^(الناقه|ناقتي|ناقتنا|الفحل|فحلي|فحلنا|المطيه|مطيتي|حقتي|يا|عن|على|علي)\s+/;
const FILLER_POST = /\s+(اخر مره|آخر مره|المره الماضيه|المره اللي فاتت|عندي|حقي|حقتي|بتاريخ|تاريخ|في|يوم|الحين|الحمدلله|ان شاء الله|انشالله)$/;
function cleanName(s) {
  let x = String(s || '').trim(), prev;
  do { prev = x; x = x.replace(FILLER_PRE, '').replace(FILLER_POST, '').trim(); } while (x !== prev);
  return x.replace(/^(ب|بـ)\s*/, '').trim();
}

function monthRange(today, offset) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const from = d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function extractPeriod(n, today = todayISO()) {
  let m;
  if (/(الشهر (القادم|الجاي|اللي جاي|الياي|المقبل)|الشهر الجاي)/.test(n)) return { ...monthRange(today, 1), label: 'الشهر القادم' };
  if (/(هالشهر|هذا الشهر|الشهر الحالي|ذا الشهر)/.test(n)) return { ...monthRange(today, 0), label: 'هذا الشهر' };
  if (/(الاسبوع (القادم|الجاي)|هالاسبوع|هذا الاسبوع|خلال اسبوع)/.test(n)) return { from: today, to: addDays(today, 7), label: 'الأسبوع القادم' };
  if ((m = /خلال (\d{1,3}) (يوم|ايام)/.exec(n))) return { from: today, to: addDays(today, Number(m[1])), label: `خلال ${m[1]} يوم` };
  if ((m = /خلال (\d{1,2}) (شهر|اشهر|شهور)/.exec(n))) return { from: today, to: addDays(today, Number(m[1]) * 30), label: `خلال ${m[1]} أشهر` };
  if (/(خلال شهرين|الشهرين الجايه|الشهرين القادمه)/.test(n)) return { from: today, to: addDays(today, 60), label: 'خلال شهرين' };
  return { from: today, to: addDays(today, 30), label: 'خلال 30 يوماً', defaulted: true };
}

function sexWord(n) {
  if (/(?:^|(?<=\s)|(?=\s)|$)(ذكر|ولد|قعود|حوار ذكر|فحل)(?:^|(?<=\s)|(?=\s)|$)/.test(n)) return 'male';
  if (/(?:^|(?<=\s)|(?=\s)|$)(انثي|بنت|بكره|حاشي|حاشيه|ناقه|مفروده)(?:^|(?<=\s)|(?=\s)|$)/.test(n)) return 'female';
  return null;
}

// إرجاع الصيغة الأصلية (بالتاء المربوطة والهمزات) لجزء من النص بعد التطبيع
function original(raw, frag) {
  if (!frag) return frag;
  const toks = String(raw).split(/\s+/).filter(Boolean);
  const normToks = toks.map(t => normalizeAr(t));
  const want = frag.split(' ');
  for (let i = 0; i + want.length <= normToks.length; i++) {
    if (want.every((w, j) => normToks[i + j] === w)) return toks.slice(i, i + want.length).join(' ').replace(/[؟?!،,.:؛]/g, '');
  }
  return frag;
}

function parse(text, today = todayISO()) {
  const out = parseNorm(text, today);
  for (const k of ['dam', 'sire', 'calf_name', 'name', 'parent']) if (typeof out[k] === 'string') out[k] = original(text, out[k]);
  return out;
}

function parseNorm(text, today) {
  const raw = String(text || '').trim();
  const n = normalizeAr(raw);
  if (!n) return { intent: 'empty' };
  const isQ = QUESTION.test(n) || /\?|؟/.test(raw);
  let m;

  if (/^(السلام|سلام|مرحبا|هلا|هلا والله|صباح|مساء|اهلا|يا هلا)/.test(n) && n.split(' ').length <= 4) return { intent: 'greeting' };
  if (/^(مساعده|ساعدني|وش تقدر|ايش تقدر|كيف استخدم|الاوامر|help)/.test(n)) return { intent: 'help' };

  // --- استعلامات ---
  if ((m = /^(?:كم تسوي|كم سعر|وش تسوي|ايش تسوي|كم قيمه|كم ثمن|كم تجيب|بكم تنباع|بكم اقدر ابيع)\s+(.+)$/.exec(n))) return { intent: 'query_valuation', name: cleanName(m[1]) };
  if (isQ && /لقح/.test(n) && (m = /(?:لقحت|لقح|تلقيح|انلقحت|تلقحت)\s+(.+)$/.exec(n)) && /^(متي|كم|وش|ايش)/.test(n)) {
    return { intent: 'query_last_mating', dam: cleanName(m[1].replace(/\s+(من|علي)\s+.*$/, '')) };
  }
  if (isQ && (m = /(?:وش|ايش|شو|ماذا|ما|مين|من)\s+(?:جابت|ولدت|نتجت|عطت)\s+(.+)$/.exec(n))) {
    return { intent: 'query_last_birth', dam: cleanName(m[1]) };
  }
  if (isQ && (m = /متي\s+(?:بتولد|تولد|راح تولد|موعد ولاده|ولاده)\s+(.+)$/.exec(n))) {
    return { intent: 'query_due_one', dam: cleanName(m[1]) };
  }
  if (/(بتولد|تولد|يولدن|تولدن|بيولدن|الولادات|ولادات|موعد الولاده|الولاده)/.test(n) && (isQ || /(النوق|ولادات|الولادات)/.test(n))) {
    return { intent: 'query_due_list', period: extractPeriod(n, today) };
  }
  if ((m = /(?:عيال|مواليد|بنات|اولاد|ذريه|نسل)\s+(.+)$/.exec(n)) && !/^(سجل|ضيف|اضف)/.test(n)) {
    return { intent: 'query_offspring', parent: cleanName(m[1]) };
  }
  if (isQ || /^(اعرض|عطني|اعطني|طلع|ابي)/.test(n)) { const ak = ageKeyIn(n); if (ak && !/(لقح|ولدت|جابت)/.test(n)) return { intent: 'query_age', key: ak }; }
  if (/^كم(?:^|(?<=\s)|(?=\s)|$)/.test(n) && /(عندي|ناقه|نوق|فحل|فحول|حلال|راس|مطيه|مطايا|الابل|ابل)/.test(n)) return { intent: 'query_counts' };
  if (/(التنبيهات|تنبيهاتي|المواعيد|مواعيدي|وش عندي|ذكرني|المتابعات|وش المطلوب)/.test(n)) return { intent: 'query_alerts' };
  if ((m = /^(?:ابحث عن|دور|دورلي|وين|معلومات|ملف|بيانات|اعرض|افتح)\s+(.+)$/.exec(n))) return { intent: 'query_camel', name: cleanName(m[1]) };

  // --- البيع: إنشاء وصف إعلان ---
  if ((m = /(?:ابي|ابغي|ابغى|اريد|ودي|بغيت)\s+(?:ابيع|بيع|اعرض|اعلن عن)\s*(.*)$/.exec(n))) {
    const nm = cleanName(m[1].replace(/^(هذي|هذه|هالناقه|الناقه هذي|ها)\s*/, ''));
    return { intent: 'draft_listing', name: nm && !/^(هذي|هذه|ناقه|ناقتي|الناقه|هالناقه|المطيه)$/.test(nm) ? nm : null };
  }

  // --- تسجيل التلقيح ---
  if (!isQ && (m = /^(?:لقحت|لقحنا|لقح|تلقيح|سجل تلقيح|سجل لقاح|انلقحت|تلقحت|ضربها|طرقها|طرق)\s+(.+)$/.exec(n))) {
    const { date, invalid, rest } = extractDate(m[1], today);
    let dam = rest, sire = null;
    const sp = /\s+(?:من|علي|ب)\s+(?:الفحل\s+)?(.+)$/.exec(rest);
    if (sp) { dam = rest.slice(0, sp.index); sire = sp[1]; }
    return { intent: 'record_mating', dam: cleanName(dam) || null, sire: sire ? cleanName(sire) || null : null, date, invalid_date: !!invalid };
  }

  // --- تسجيل الولادة ---
  if (!isQ && (m = /^(?:ولدت|جابت|سجل ولاده|نتجت|ولاده)\s+(.+)$/.exec(n))) {
    const { date, invalid, rest } = extractDate(m[1], today);
    let body = rest, calfName = null;
    const nm = /\s+(?:وسميناه|وسميناها|سميناه|سميناها|اسمه|اسمها|سميته|سميتها|وسميته|وسميتها)\s+(.+)$/.exec(body);
    if (nm) { calfName = cleanName(nm[1]); body = body.slice(0, nm.index); }
    const sex = sexWord(body);
    body = body.replace(/\s+(ولد|بنت|ذكر|انثي|قعود|حوار|حاشي|حاشيه|بكره|مولود|مولوده)(\s+(ذكر|انثي))?\s*$/, '').trim();
    body = body.replace(/\s+(ولد|بنت|ذكر|انثي|قعود|حوار|حاشي|حاشيه|بكره|مولود|مولوده)(?:^|(?<=\s)|(?=\s)|$).*$/, '').trim();
    return { intent: 'record_birth', dam: cleanName(body) || null, calf_sex: sex, calf_name: calfName, date, invalid_date: !!invalid };
  }

  return { intent: 'unknown', isQuestion: isQ };
}

module.exports = { parse, extractDate, extractPeriod, cleanName, sexWord };
