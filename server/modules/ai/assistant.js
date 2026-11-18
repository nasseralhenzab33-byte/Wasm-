'use strict';
// WASM AI — منسق المساعد الذكي.
// المبادئ: (1) لا اختراع بيانات: كل إجابة عن الحلال تأتي من قاعدة البيانات مباشرة.
// (2) لا كتابة دون تأكيد: أي تسجيل يتحول إلى "إجراء معلق" يؤكده المستخدم صراحة.
// (3) الفصل الواضح بين "مسجل" و"تقديري/مقترح من الذكاء الاصطناعي".
// (4) لا عمليات مالية ولا مزايدات من المساعد إطلاقاً.
const db = require('../../lib/db');
const { HttpError } = require('../../lib/http');
const { id, todayISO, addDays, diffDays, isISODate, normalizeAr } = require('../../lib/util');
const herd = require('../herd.service');
const nlu = require('./nlu');
const { getProvider } = require('./providers');
const { AGE_NAMES } = require('../../lib/ageNames');

const SEX_AR = { female: 'ناقة', male: 'فحل' };
const CALF_SEX_AR = { female: 'بكرة', male: 'قعود' };
const OUTCOME_AR = { pending: 'بانتظار التأكيد', confirmed_pregnant: 'خلفة (مؤكد)', not_pregnant: 'ما لقحت', born: 'ولدت', aborted: 'إجهاض' };
const fmt = iso => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-QA-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
const ESTIMATE_NOTE = 'الموعد تقديري ولا يغني عن المتابعة البيطرية.';

const EXAMPLES = ['لقحت وضحى اليوم من شاهين', 'كم عندي حيران؟', 'متى لقحت وضحى؟', 'أي النوق عندي بتولد الشهر القادم؟', 'وش جابت وضحى آخر مرة؟', 'ولدت الشعلة اليوم بنت وسميناها غلا', 'أبي أبيع الشعلة', 'وش التنبيهات؟'];

function lastAssistantMeta(user) {
  const r = db.one("SELECT meta_json, created_at FROM ai_messages WHERE user_id=? AND role='assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1", user.id);
  if (!r || !r.meta_json) return null;
  if (Date.now() - new Date(r.created_at).getTime() > 30 * 60000) return null; // تنتهي المحادثة المعلقة بعد 30 دقيقة
  return JSON.parse(r.meta_json);
}

function save(user, role, content, meta) {
  db.run('INSERT INTO ai_messages(id, user_id, role, content, meta_json) VALUES (?,?,?,?,?)', id(), user.id, role, content, meta ? JSON.stringify(meta) : null);
}

function history(user, limit = 50) {
  return db.all('SELECT id, role, content, meta_json, created_at FROM (SELECT *, rowid r FROM ai_messages WHERE user_id=? ORDER BY created_at DESC, r DESC LIMIT ?) ORDER BY created_at, r', user.id, limit)
    .map(m => { const meta = m.meta_json ? JSON.parse(m.meta_json) : null; return { id: m.id, role: m.role, content: m.content, created_at: m.created_at, cards: meta?.cards, action: meta?.action ? actionStatus(user, meta.action) : undefined, options: meta?.options, source: meta?.source }; });
}

function actionStatus(user, a) {
  const r = db.one('SELECT status, expires_at FROM ai_pending_actions WHERE id=? AND user_id=?', a.id, user.id);
  const status = r ? (r.status === 'pending' && r.expires_at < new Date().toISOString() ? 'expired' : r.status) : 'expired';
  return { ...a, status };
}

// ===== تحديد الناقة/الفحل بالاسم مع معالجة الغموض =====
function resolveCamel(user, name, sex) {
  if (!name) return { status: 'missing' };
  if (name.startsWith('@id:')) {
    const c = db.one('SELECT id, name, sex, tag_number FROM camels WHERE id=? AND owner_id=?', name.slice(4), user.id);
    return c && (!sex || c.sex === sex) ? { status: 'ok', camel: c } : { status: 'none', name };
  }
  const list = herd.findByName(user, name, sex);
  if (list.length === 1) return { status: 'ok', camel: list[0] };
  if (list.length > 1) return { status: 'ambiguous', list, name };
  return { status: 'none', name };
}

function ask(text, awaiting, draft, options) { return { text, meta: { awaiting, draft, options } }; }
function optionsFrom(list) { return list.map(c => ({ label: `${c.name}${c.tag_number ? ' (' + c.tag_number + ')' : ''}`, value: '@id:' + c.id })); }

function propose(user, action, payload, summary, fields) {
  const aid = id();
  db.run('INSERT INTO ai_pending_actions(id, user_id, action, payload_json, expires_at) VALUES (?,?,?,?,?)', aid, user.id, action, JSON.stringify(payload), new Date(Date.now() + 30 * 60000).toISOString());
  return { id: aid, action, summary, fields, status: 'pending' };
}

// ===== مسار التلقيح =====
function continueMating(user, d) {
  if (!d.dam_id) {
    const r = resolveCamel(user, d.dam, 'female');
    if (r.status === 'missing') return ask('أي ناقة تم تلقيحها؟ اكتب اسمها أو رقم الوسم.', 'dam', d);
    if (r.status === 'none') return ask(`ما لقيت ناقة باسم «${d.dam}» في حلالك. تأكد من الاسم، أو أضفها أولاً من صفحة «حلالي».`, 'dam', { ...d, dam: null });
    if (r.status === 'ambiguous') return ask(`عندك أكثر من ناقة تطابق «${d.dam}». أيها تقصد؟`, 'dam', { ...d, dam: null }, optionsFrom(r.list));
    d.dam_id = r.camel.id; d.dam_name = r.camel.name;
  }
  if (!d.sire_id && !d.sire_text) {
    if (!d.sire) return ask(`من هو الفحل الذي لقّح ${d.dam_name}؟`, 'sire', d);
    const r = resolveCamel(user, d.sire, 'male');
    if (r.status === 'ambiguous') return ask(`عندك أكثر من فحل يطابق «${d.sire}». أيهم؟`, 'sire', { ...d, sire: null }, optionsFrom(r.list));
    if (r.status === 'ok') { d.sire_id = r.camel.id; d.sire_name = r.camel.name; }
    else { d.sire_text = d.sire; d.sire_name = d.sire; d.sire_external = true; }
  }
  if (!d.date) return ask(`متى كان تلقيح ${d.dam_name}؟ (مثال: اليوم، أمس، قبل 3 أيام، أو 2026-11-01)`, 'date', d);
  if (d.date > todayISO()) return ask('تاريخ التلقيح لا يمكن أن يكون في المستقبل. متى كان التلقيح؟', 'date', { ...d, date: null });
  const expected = addDays(d.date, Number(user.gestation_days) || 390);
  const prev = herd.openMating(user, d.dam_id);
  const fields = [
    ['الناقة', d.dam_name], ['الفحل', d.sire_name + (d.sire_external ? ' (من خارج حلالك)' : '')],
    ['تاريخ التلقيح', fmt(d.date)], ['الولادة المتوقعة', fmt(expected) + ' (تقديري)'],
  ];
  let text = `سأسجل تلقيح ${d.dam_name} من ${d.sire_name} بتاريخ ${fmt(d.date)}. أكّد لحفظ السجل.`;
  if (prev && prev.outcome === 'confirmed_pregnant') text += `\n⚠️ تنبيه: ${d.dam_name} مسجلة خلفة (مؤكد) من تلقيح ${fmt(prev.mating_date)}. تأكد قبل الحفظ.`;
  else if (prev) text += `\nملاحظة: يوجد تلقيح سابق غير مؤكد بتاريخ ${fmt(prev.mating_date)} وسيُعتبر "ما لقحت" عند الحفظ.`;
  const action = propose(user, 'record_mating', { dam_id: d.dam_id, sire_id: d.sire_id || null, sire_name_text: d.sire_text || null, mating_date: d.date }, 'تسجيل تلقيح', fields);
  return { text: text + `\n${ESTIMATE_NOTE}`, meta: { action } };
}

// ===== مسار الولادة =====
function continueBirth(user, d) {
  if (!d.dam_id) {
    const r = resolveCamel(user, d.dam, 'female');
    if (r.status === 'missing') return ask('أي ناقة ولدت؟', 'dam', d);
    if (r.status === 'none') return ask(`ما لقيت ناقة باسم «${d.dam}» في حلالك. اكتب الاسم الصحيح أو رقم الوسم.`, 'dam', { ...d, dam: null });
    if (r.status === 'ambiguous') return ask(`أي ناقة تقصد؟`, 'dam', { ...d, dam: null }, optionsFrom(r.list));
    d.dam_id = r.camel.id; d.dam_name = r.camel.name;
  }
  if (!d.date) d.date = todayISO();
  if (!d.calf_sex) return ask(`مبروك! وش جنس مولود ${d.dam_name}؟`, 'calf_sex', d, [{ label: 'قعود', value: 'قعود' }, { label: 'بكرة', value: 'بكرة' }]);
  const m = herd.openMating(user, d.dam_id);
  const fields = [['الأم', d.dam_name], ['تاريخ الولادة', fmt(d.date)], ['جنس المولود', CALF_SEX_AR[d.calf_sex]],
    ['اسم المولود', d.calf_name || '(يُحدد لاحقاً)'], ['الأب', m ? (m.sire_id ? db.one('SELECT name FROM camels WHERE id=?', m.sire_id).name : m.sire_name_text) + ' — من سجل التلقيح' : 'غير معروف (لا يوجد تلقيح مسجل)']];
  const action = propose(user, 'record_birth', { dam_id: d.dam_id, birth_date: d.date, calf_sex: d.calf_sex, calf_name: d.calf_name || null }, 'تسجيل ولادة', fields);
  return { text: `سأسجل ولادة ${d.dam_name} وأنشئ ملفاً للمولود مربوطاً بأمه${m ? ' وأبيه' : ''}. أكّد للحفظ.`, meta: { action } };
}

function fillSlot(user, meta, text) {
  const d = { ...meta.draft };
  const n = normalizeAr(text);
  const value = text.startsWith('@id:') ? text.trim() : nlu.cleanName(n);
  if (/^(الغاء|إلغاء|كنسل|لا|خلاص|بلاش)$/.test(n)) return { text: 'تم الإلغاء. ما سجلت شيئاً.', meta: null };
  switch (meta.awaiting) {
    case 'dam': d.dam = value; d.dam_id = null; break;
    case 'sire': d.sire = value; break;
    case 'date': {
      const r = nlu.extractDate(n);
      if (!r.date) return ask('ما فهمت التاريخ. اكتب مثلاً: اليوم، أمس، قبل 5 أيام، أو 2026-11-01', 'date', d);
      d.date = r.date; break;
    }
    case 'calf_sex': {
      const s = nlu.sexWord(n) || (/(انثي)/.test(n) ? 'female' : null);
      if (!s) return ask('اختر: قعود أو بكرة', 'calf_sex', d, [{ label: 'قعود', value: 'قعود' }, { label: 'بكرة', value: 'بكرة' }]);
      d.calf_sex = s; break;
    }
    case 'listing_camel': return draftListing(user, value);
    default: return null;
  }
  return d.kind === 'birth' ? continueBirth(user, d) : continueMating(user, d);
}

// ===== الاستعلامات (إجابات من السجلات فقط) =====
function camelOr(user, name, sex, onOk, awaitingKind) {
  const r = resolveCamel(user, name, sex);
  if (r.status === 'missing') return { text: 'اكتب اسم المطية أو رقم وسمها.' };
  if (r.status === 'none') return { text: `ما لقيت ${sex === 'male' ? 'فحلاً' : sex === 'female' ? 'ناقة' : 'مطية'} باسم «${name}» في حلالك.` };
  if (r.status === 'ambiguous') return { text: `فيه أكثر من مطية تطابق «${name}»:`, meta: { cards: [{ type: 'camels', items: r.list }] } };
  return onOk(r.camel);
}

function answerLastMating(user, p) {
  return camelOr(user, p.dam, 'female', c => {
    const m = herd.lastMating(user, c.id);
    if (!m) return { text: `ما فيه تلقيح مسجل لـ ${c.name} في السجلات.`, meta: { source: 'records' } };
    const sire = m.sire_name || m.sire_name_text || 'غير مسجل';
    let t = `📋 حسب سجلاتك: آخر تلقيح لـ ${c.name} كان بتاريخ ${fmt(m.mating_date)} من ${sire}.\nالحالة: ${OUTCOME_AR[m.outcome]}.`;
    if (['pending', 'confirmed_pregnant'].includes(m.outcome)) t += `\n🔮 الولادة المتوقعة: ${fmt(m.expected_birth_date)} (بعد ${diffDays(todayISO(), m.expected_birth_date)} يوم تقريباً). ${ESTIMATE_NOTE}`;
    return { text: t, meta: { source: 'records', cards: [{ type: 'camel_link', id: c.id, name: c.name }] } };
  });
}

function answerDueOne(user, p) {
  return camelOr(user, p.dam, 'female', c => {
    const m = herd.openMating(user, c.id);
    if (!m) return { text: `ما فيه تلقيح مفتوح مسجل لـ ${c.name}، فما أقدر أحسب موعد ولادة.`, meta: { source: 'records' } };
    const d = diffDays(todayISO(), m.expected_birth_date);
    return { text: `🔮 الموعد التقديري لولادة ${c.name}: ${fmt(m.expected_birth_date)} ${d >= 0 ? `(بعد ${d} يوم)` : `(متجاوزة الموعد بـ ${-d} يوم)`}.\n📋 محسوب من تلقيح مسجل بتاريخ ${fmt(m.mating_date)}. ${ESTIMATE_NOTE}`, meta: { source: 'records' } };
  });
}

function answerDueList(user, p) {
  const list = herd.expectedBirths(user, p.period.from, p.period.to);
  if (!list.length) return { text: `ما فيه نوق متوقع ولادتها ${p.period.label} (${fmt(p.period.from)} – ${fmt(p.period.to)}) حسب سجلات التلقيح.`, meta: { source: 'records' } };
  const lines = list.map((b, i) => `${i + 1}. ${b.dam_name}${b.tag_number ? ' (' + b.tag_number + ')' : ''} — ${fmt(b.expected_birth_date)}${b.sire_name ? ' — من ' + b.sire_name : ''}`);
  return { text: `🔮 النوق المتوقع ولادتها ${p.period.label}: ${list.length}\n${lines.join('\n')}\n\n📋 محسوبة من تواريخ التلقيح المسجلة. ${ESTIMATE_NOTE}`,
    meta: { source: 'records', cards: [{ type: 'due', items: list }] } };
}

function answerLastBirth(user, p) {
  return camelOr(user, p.dam, 'female', c => {
    const b = herd.lastBirth(user, c.id);
    if (!b) return { text: `ما فيه ولادة مسجلة لـ ${c.name}.`, meta: { source: 'records' } };
    const sire = b.sire_name || b.sire_name_text;
    const total = db.one('SELECT COUNT(*) n FROM births WHERE dam_id=? AND owner_id=?', c.id, user.id).n;
    let t = `📋 حسب سجلاتك: آخر ولادة لـ ${c.name} كانت بتاريخ ${fmt(b.birth_date)}`;
    t += b.outcome === 'stillborn' ? ' (نفوق المولود).' : `، ${b.calf_sex ? 'المولود ' + CALF_SEX_AR[b.calf_sex] : 'جنس المولود غير مسجل'}${b.calf_name ? ' واسمه «' + b.calf_name + '»' : ''}${sire ? '، والأب ' + sire : ''}.`;
    t += `\nإجمالي ولاداتها المسجلة: ${total}.`;
    const cards = [{ type: 'camel_link', id: c.id, name: c.name }];
    if (b.calf_id) cards.push({ type: 'camel_link', id: b.calf_id, name: b.calf_name });
    return { text: t, meta: { source: 'records', cards } };
  });
}

function answerOffspring(user, p) {
  return camelOr(user, p.parent, null, c => {
    const kids = db.all('SELECT id, name, tag_number, sex, birth_date, status FROM camels WHERE owner_id=? AND (dam_id=? OR sire_id=?) ORDER BY birth_date DESC', user.id, c.id, c.id);
    if (!kids.length) return { text: `ما فيه مواليد مسجلة لـ ${c.name} في حلالك.`, meta: { source: 'records' } };
    return { text: `📋 مواليد ${c.name} المسجلة في حلالك: ${kids.length} (${kids.filter(k => k.sex === 'female').length} بكرة و ${kids.filter(k => k.sex === 'male').length} قعود).`, meta: { source: 'records', cards: [{ type: 'camels', items: kids }] } };
  });
}

function answerAge(user, p) {
  const def = AGE_NAMES.find(a => a.key === p.key);
  const list = herd.listCamels(user, { age: p.key }).filter(c => !['sold', 'dead', 'transferred'].includes(c.status));
  const title = `${def.m}${def.f !== def.m ? ' / ' + def.f : ''} (${def.label})`;
  if (!list.length) return { text: `📋 ما عندك في حلالك النشط أي ${title}.
ملاحظة: الإبل التي ليس لها تاريخ ميلاد مسجل لا تدخل في الحساب.`, meta: { source: 'records' } };
  const f = list.filter(c => c.sex === 'female').length, m = list.length - f;
  return { text: `📋 عندك ${list.length} من ${title}: ${f ? f + ' ' + def.f : ''}${f && m ? ' و ' : ''}${m ? m + ' ' + def.m : ''}.
${list.map((c, i) => `${i + 1}. ${c.name}${c.tag_number ? ' (' + c.tag_number + ')' : ''}`).join('\n')}

محسوبة من تواريخ الميلاد المسجلة.`, meta: { source: 'records', cards: [{ type: 'camels', items: list }] } };
}

function answerValuation(user, p) {
  return camelOr(user, p.name, null, c => {
    const f = herd.getCamel(user, c.id);
    const ageY = f.age_days != null ? f.age_days / 365.25 : null;
    const v = require('../market.service').valuation({ breed: f.breed, sex: f.sex, age_years: ageY, country: user.country_code });
    if (!v.available) return { text: `🔮 ما أقدر أعطيك تثميناً لـ ${f.name} الحين.\n${v.notice}\nللمقارنة شوف إعلانات مشابهة في السوق.`, meta: { source: 'records', cards: [{ type: 'link', href: '#/market' + (f.breed ? '?breed=' + encodeURIComponent(f.breed) : ''), label: 'إعلانات مشابهة' }] } };
    const fm = n => Math.round(n).toLocaleString('en');
    return { text: `🔮 تثمين استرشادي لـ ${f.name} (${f.breed || 'فئة غير محددة'}${f.age_name ? '، ' + f.age_name.name : ''}):\nالنطاق الشائع: ${fm(v.p25)} – ${fm(v.p75)} ر.ق، والوسيط ${fm(v.median)} ر.ق.\n📋 مبني على ${v.samples} صفقة مكتملة على وسم (${v.basis}).\n⚠️ ${v.notice}`, meta: { source: 'ai_estimate' } };
  });
}

function answerCounts(user) {
  const s = herd.dashboard(user);
  return { text: `📋 حلالك النشط: ${s.total} رأس — ${s.females} ناقة و ${s.males} فحل.\nالنوق الملقحة: ${s.pregnant}، والمتوقع ولادتها خلال 30 يوماً: ${s.due_30}.\nالولادات المسجلة هذا العام: ${s.births_this_year}.${s.ages.groups.length ? '\nحسب العمر: ' + s.ages.groups.map(g => `${g.m === g.f ? g.m : g.m + '/' + g.f} ${g.males + g.females}`).join('، ') : ''}${s.ages.unknown ? `، وبدون تاريخ ميلاد ${s.ages.unknown}` : ''}.`, meta: { source: 'records' } };
}

function answerAlerts(user) {
  const a = herd.alerts(user);
  if (!a.length) return { text: 'ما عندك تنبيهات قريبة. 👌', meta: { source: 'records' } };
  return { text: `عندك ${a.length} تنبيه:\n${a.slice(0, 10).map(x => '• ' + x.text).join('\n')}\n\n${ESTIMATE_NOTE}`, meta: { source: 'records' } };
}

function answerCamel(user, p) {
  return camelOr(user, p.name, null, c => {
    const full = herd.getCamel(user, c.id);
    const age = full.age_days != null ? `${full.age_name.name} — ${Math.floor(full.age_days / 365)} سنة تقريباً${full.birth_date_estimated ? ' (تاريخ ميلاد تقديري)' : ''}` : 'غير مسجل';
    const t = `📋 ${full.name}${full.tag_number ? ' — وسم ' + full.tag_number : ''}\n${SEX_AR[full.sex]} • ${full.breed || 'فئة غير محددة'} • ${full.color || 'لون غير محدد'}\nالعمر: ${age}\nالأم: ${full.dam?.name || full.dam_name_text || 'غير مسجلة'} • الأب: ${full.sire?.name || full.sire_name_text || 'غير مسجل'}\nالمواليد المسجلة: ${full.offspring.length}`;
    return { text: t, meta: { source: 'records', cards: [{ type: 'camel_link', id: c.id, name: c.name }] } };
  });
}

function draftListing(user, name) {
  if (!name) return ask('أي مطية تبي تبيعها؟ اكتب اسمها أو رقم الوسم.', 'listing_camel', {});
  return camelOr(user, name, null, c => {
    const f = herd.getCamel(user, c.id);
    const age = f.age_days != null ? Math.floor(f.age_days / 365) : null;
    const parts = [];
    parts.push(`للبيع ${f.age_name ? f.age_name.name + ' ' : ''}${f.sex === 'female' ? '(ناقة)' : '(فحل)'} «${f.name}»${f.breed ? ' من ' + f.breed : ''}${f.color ? '، اللون ' + f.color : ''}.`);
    if (age != null) parts.push(`العمر: ${f.age_name.name}، ${age} ${age >= 3 && age <= 10 ? 'سنوات' : 'سنة'} تقريباً${f.birth_date_estimated ? ' (تقديري)' : ''}.`);
    const dam = f.dam?.name || f.dam_name_text, sire = f.sire?.name || f.sire_name_text;
    if (dam || sire) parts.push(`${dam ? 'الأم: ' + dam : ''}${dam && sire ? ' — ' : ''}${sire ? 'الأب: ' + sire : ''} ${f.pedigree_verified ? '(موثق)' : '(حسب سجلات المالك، غير موثق رسمياً)'}.`);
    if (f.sex === 'female' && f.births.length) parts.push(`ولدت ${f.births.length} ${f.births.length > 2 ? 'مرات' : 'مرة'} حسب السجلات.`);
    const vac = f.events.filter(e => e.type === 'vaccination');
    if (vac.length) parts.push(`آخر تحصين مسجل: ${vac[0].title} بتاريخ ${fmt(vac[0].event_date)}.`);
    const om = f.sex === 'female' ? herd.openMating(user, f.id) : null;
    if (om) parts.push(`ملقحة بتاريخ ${fmt(om.mating_date)}${om.outcome === 'confirmed_pregnant' ? ' (خلفة — مؤكد)' : ' (لم يُؤكد اللقاح بعد)'}.`);
    parts.push('السعر: [حدده أنت]  •  الموقع: [المدينة/الدولة]  •  للتواصل عبر وسم.');
    const missing = [!f.photos.length && 'صور واضحة', !f.breed && 'الفئة', !f.color && 'اللون', !f.birth_date && 'العمر'].filter(Boolean);
    return {
      text: `✍️ مسودة وصف إعلان (مقترحة من المساعد بناءً على سجلاتك فقط — راجعها وعدّلها قبل النشر):\n\n${parts.join('\n')}${missing.length ? `\n\n💡 لإعلان أقوى أضف: ${missing.join('، ')}.` : ''}\n\nملاحظة: تقدر تنشره مباشرة في سوق وسم من الزر أدناه، وسيُراجع قبل النشر.`,
      meta: { source: 'ai_draft', cards: [{ type: 'link', href: '#/listing-new?camel=' + f.id, label: 'انشر الإعلان في السوق' }, { type: 'camel_link', id: f.id, name: f.name }] },
    };
  });
}

// وصف إعلان نظيف من سجلات المطية (يُستخدم في نموذج إنشاء الإعلان)
function listingDescription(user, camelId) {
  const f = herd.getCamel(user, camelId);
  const age = f.age_days != null ? Math.floor(f.age_days / 365) : null;
  const p = [];
  p.push(`${f.sex === 'female' ? 'ناقة' : 'فحل'} ${f.breed || ''}${f.color ? '، اللون ' + f.color : ''}${f.age_name ? '، ' + f.age_name.name : ''}${age != null ? ` (${age} ${age >= 3 && age <= 10 ? 'سنوات' : 'سنة'} تقريباً${f.birth_date_estimated ? '، تقديري' : ''})` : ''}.`.replace(/\s+/g, ' '));
  const dam = f.dam?.name || f.dam_name_text, sire = f.sire?.name || f.sire_name_text;
  if (dam || sire) p.push(`${dam ? 'الأم: ' + dam : ''}${dam && sire ? ' — ' : ''}${sire ? 'الأب: ' + sire : ''} ${f.pedigree_verified ? '(موثق)' : '(حسب سجلات المالك، غير موثق رسمياً)'}.`);
  if (f.sex === 'female' && f.births.length) p.push(`ولدت ${f.births.length} ${f.births.length > 2 ? 'مرات' : 'مرة'} حسب السجلات.`);
  const vac = f.events.filter(e => e.type === 'vaccination'); if (vac.length) p.push(`آخر تحصين مسجل: ${vac[0].title} (${vac[0].event_date}).`);
  const ach = f.events.filter(e => e.type === 'achievement'); if (ach.length) p.push(`إنجازات: ${ach.slice(0, 3).map(a => a.title).join('، ')}.`);
  const om = f.sex === 'female' ? herd.openMating(user, f.id) : null; if (om) p.push(`ملقحة بتاريخ ${om.mating_date}${om.outcome === 'confirmed_pregnant' ? ' (خلفة — مؤكد)' : ' (لم يُؤكد اللقاح بعد)'}.`);
  return { title: `${f.sex === 'female' ? 'ناقة' : 'فحل'} ${f.breed || ''} للبيع — ${f.name}`.replace(/\s+/g, ' '), description: p.join('\n'), source: 'ai_draft', notice: 'مسودة من سجلاتك فقط — راجعها وعدّلها.' };
}

function helpText() {
  return { text: `هلا والله! أنا مساعد وسم 🐪 أساعدك في إدارة حلالك.\nجرّب تكتب مثلاً:\n${EXAMPLES.map(e => '• ' + e).join('\n')}\n\nأي تسجيل أطلب تأكيدك قبل حفظه، والمواعيد دائماً تقديرية.`, meta: { options: EXAMPLES.slice(0, 4).map(e => ({ label: e, value: e })) } };
}

// ===== النموذج اللغوي (اختياري) للأسئلة المفتوحة — بأدوات قراءة فقط =====
const SYSTEM_PROMPT = `أنت "مساعد وسم"، مساعد عربي خليجي لملاك الإبل. تتحدث بلهجة خليجية مهذبة وواضحة.
قواعد صارمة:
- لا تخترع أي بيانات عن حلال المستخدم. استخدم الأدوات فقط، وإن لم تجد المعلومة قل ذلك.
- ميّز دائماً بين "حسب سجلاتك" (بيانات مسجلة) و"تقديري/اقتراح" (من استنتاجك).
- لا تدّعِ إثبات النسب أو الأصالة أو العمر من الصور أو الأوصاف.
- لا تقدم تشخيصاً بيطرياً؛ قدّم معلومات عامة وانصح بمراجعة طبيب بيطري.
- لا تعطِ سعراً مؤكداً؛ أي تقدير سعري استرشادي فقط ويتطلب بيانات صفقات حقيقية.
- لا تنفذ عمليات مالية أو مزايدات أو بيع. التسجيل في الحلال يتم فقط عبر أداة propose_* ويحتاج تأكيد المستخدم.
- مواعيد الولادة تقديرية ولا تغني عن المتابعة البيطرية.`;

const TOOLS = [
  { name: 'search_camels', description: 'بحث في حلال المستخدم بالاسم أو رقم الوسم أو الجنس', schema: { type: 'object', properties: { q: { type: 'string' }, sex: { type: 'string', enum: ['female', 'male'] } } },
    run: (u, i) => herd.listCamels(u, { q: i.q, sex: i.sex, limit: 30 }).map(c => ({ id: c.id, name: c.name, tag: c.tag_number, sex: c.sex, breed: c.breed, status: c.status, expected_birth_date: c.expected_birth_date })) },
  { name: 'get_camel', description: 'ملف مطية كامل بالمعرف', schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (u, i) => { const c = herd.getCamel(u, i.id); return { ...c, photos: c.photos.length, documents: c.documents.length }; } },
  { name: 'expected_births', description: 'النوق المتوقع ولادتها بين تاريخين YYYY-MM-DD', schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    run: (u, i) => herd.expectedBirths(u, i.from, i.to) },
  { name: 'alerts', description: 'تنبيهات المستخدم القادمة', schema: { type: 'object', properties: {} }, run: u => herd.alerts(u) },
  { name: 'herd_stats', description: 'إحصاءات الحلال', schema: { type: 'object', properties: {} }, run: u => { const s = herd.dashboard(u); delete s.recent; return s; } },
];

async function llmAnswer(user, text) {
  const provider = getProvider();
  if (!provider.available) return null;
  const recent = db.all("SELECT role, content FROM (SELECT role, content, created_at, rowid r FROM ai_messages WHERE user_id=? ORDER BY created_at DESC, r DESC LIMIT 8) ORDER BY created_at, r", user.id);
  let messages = [...recent.map(m => ({ role: m.role, content: m.content }))];
  if (!messages.length || messages[messages.length - 1].content !== text) messages.push({ role: 'user', content: text });
  const system = `${SYSTEM_PROMPT}\nتاريخ اليوم: ${todayISO()}. مدة الحمل المعتمدة لدى المستخدم: ${user.gestation_days} يوماً.`;
  for (let i = 0; i < 4; i++) {
    const r = await provider.chat({ system, messages, tools: TOOLS });
    if (!r) return null;
    if (!r.toolCalls.length) return { text: r.text, meta: { source: 'ai' } };
    const results = r.toolCalls.map(c => {
      const t = TOOLS.find(x => x.name === c.name);
      try { return { id: c.id, output: t ? t.run(user, c.input || {}) : { error: 'unknown_tool' } }; }
      catch (e) { return { id: c.id, output: { error: e.code || 'error', message: e.message } }; }
    });
    messages = [...messages, ...provider.toolResultMessage(r, results)];
  }
  return { text: 'ما قدرت أكمل الإجابة، جرّب تعيد صياغة السؤال.', meta: { source: 'ai' } };
}

async function handle(ctx, rawText) {
  const user = ctx.user;
  const text = String(rawText || '').trim().slice(0, 1000);
  if (!text) throw new HttpError(400, 'empty', 'اكتب رسالتك');
  save(user, 'user', text.startsWith('@id:') ? '(اختيار من القائمة)' : text);
  const p = nlu.parse(text);
  const meta = lastAssistantMeta(user);
  let out;
  try {
    if (meta && meta.awaiting && (p.intent === 'unknown' || text.startsWith('@id:') || /^(الغاء|إلغاء|لا|كنسل)$/.test(text.trim()) || (meta.awaiting === 'date' && nlu.extractDate(normalizeAr(text)).date) || (meta.awaiting === 'calf_sex' && nlu.sexWord(normalizeAr(text))))) {
      out = fillSlot(user, meta, text);
    }
    if (!out) {
      switch (p.intent) {
        case 'greeting': case 'help': case 'empty': out = helpText(); break;
        case 'record_mating':
          if (p.invalid_date) { out = { text: 'التاريخ المكتوب غير صحيح. اكتب مثلاً 2026-11-01 أو 1/11/2026.' }; break; }
          out = continueMating(user, { kind: 'mating', dam: p.dam, sire: p.sire, date: p.date }); break;
        case 'record_birth': out = continueBirth(user, { kind: 'birth', dam: p.dam, calf_sex: p.calf_sex, calf_name: p.calf_name, date: p.date }); break;
        case 'query_last_mating': out = answerLastMating(user, p); break;
        case 'query_due_one': out = answerDueOne(user, p); break;
        case 'query_due_list': out = answerDueList(user, p); break;
        case 'query_last_birth': out = answerLastBirth(user, p); break;
        case 'query_offspring': out = answerOffspring(user, p); break;
        case 'query_counts': out = answerCounts(user); break;
        case 'query_age': out = answerAge(user, p); break;
        case 'query_valuation': out = answerValuation(user, p); break;
        case 'query_alerts': out = answerAlerts(user); break;
        case 'query_camel': out = answerCamel(user, p); break;
        case 'draft_listing': out = draftListing(user, p.name); break;
        default: {
          try { out = await llmAnswer(user, text); } catch (e) { out = { text: 'المساعد المتقدم غير متاح حالياً. جرّب أحد الأوامر المعروفة.', meta: null }; }
          if (!out) out = { text: `ما فهمت طلبك بالضبط 🙏\nأقدر حالياً أسجل التلقيح والولادة وأجاوب عن مواعيد الولادة وسجلات نوقك. أمثلة:\n${EXAMPLES.slice(0, 5).map(e => '• ' + e).join('\n')}`, meta: { options: EXAMPLES.slice(0, 3).map(e => ({ label: e, value: e })) } };
        }
      }
    }
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) out = { text: e.message };
    else throw e;
  }
  save(user, 'assistant', out.text, out.meta || null);
  return { reply: out.text, intent: p.intent, ...(out.meta || {}) };
}

function confirm(ctx, actionId) {
  const a = db.one('SELECT * FROM ai_pending_actions WHERE id=? AND user_id=?', actionId, ctx.user.id);
  if (!a) throw new HttpError(404, 'not_found', 'الإجراء غير موجود');
  if (a.status !== 'pending') throw new HttpError(409, 'already_handled', 'تمت معالجة هذا الإجراء مسبقاً');
  if (a.expires_at < new Date().toISOString()) { db.run("UPDATE ai_pending_actions SET status='expired' WHERE id=?", a.id); throw new HttpError(410, 'expired', 'انتهت صلاحية الإجراء، أعد الطلب'); }
  // نحجز الإجراء ذرياً لمنع التنفيذ المزدوج
  const claimed = db.run("UPDATE ai_pending_actions SET status='confirmed' WHERE id=? AND status='pending'", a.id);
  if (!claimed.changes) throw new HttpError(409, 'already_handled', 'تمت معالجة هذا الإجراء مسبقاً');
  const payload = { ...JSON.parse(a.payload_json), source: 'assistant' };
  let result, text;
  try {
    if (a.action === 'record_mating') { result = herd.recordMating(ctx, payload); text = `✅ تم تسجيل التلقيح. الولادة المتوقعة ${fmt(result.expected_birth_date)} (تقديري) وسأنبهك قبلها بـ ${ctx.user.birth_alert_days} يوماً.`; }
    else if (a.action === 'record_birth') { result = herd.recordBirth(ctx, payload); text = `✅ تم تسجيل الولادة${result.calf ? ` وإنشاء ملف المولود «${result.calf.name}»` : ''}. مبروك ما جاكم 🎉`; }
    else throw new HttpError(400, 'unknown_action', 'إجراء غير معروف');
  } catch (e) {
    db.run("UPDATE ai_pending_actions SET status='pending' WHERE id=?", a.id);
    throw e;
  }
  save(ctx.user, 'assistant', text, { source: 'records', cards: result.calf ? [{ type: 'camel_link', id: result.calf.id, name: result.calf.name }] : [{ type: 'camel_link', id: payload.dam_id, name: 'ملف الناقة' }] });
  return { ok: true, reply: text, result };
}

function cancel(ctx, actionId) {
  const r = db.run("UPDATE ai_pending_actions SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'", actionId, ctx.user.id);
  if (!r.changes) throw new HttpError(404, 'not_found', 'الإجراء غير موجود أو تمت معالجته');
  save(ctx.user, 'assistant', 'تم الإلغاء، ما سجلت شيئاً.', null);
  return { ok: true };
}

// تحليل الصور (المرحلة الثانية) — جاهز معمارياً ويُفعّل عند ضبط مزود يدعم الرؤية
async function analyzePhoto(ctx, base64, mime) {
  const provider = getProvider();
  if (!provider.available) return { enabled: false, message: 'تحليل الصور يُفعّل في المرحلة الثانية بعد ربط مزود ذكاء اصطناعي.' };
  const r = await provider.describeImage({ base64, mime, prompt: 'صف هذه الإبل وصفاً مرئياً موجزاً بالعربية: اللون الظاهر، الفئة المحتملة (مغاتير/مجاهيم/أصايل/أخرى) مع درجة ثقة، والصفات المرئية. لا تحدد العمر أو النسب أو الأصالة ولا تقدم تشخيصاً. أعد JSON بالمفاتيح: color, category_guess, confidence, visible_traits, caveats.' });
  return { enabled: true, suggestion: r.text, notice: 'اقتراح آلي من الصورة فقط — لا يثبت النسب أو الأصالة أو العمر.' };
}

module.exports = { listingDescription, handle, confirm, cancel, history, analyzePhoto, TOOLS };
