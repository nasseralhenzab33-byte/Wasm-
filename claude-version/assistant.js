// ===================== WASM AI (منقول من assistant.js) =====================
const SEX_AR = { female: 'ناقة', male: 'فحل' };
const CALF_SEX_AR = { female: 'بكرة', male: 'قعود' };
const OUTCOME_AR = { pending: 'بانتظار التأكيد', confirmed_pregnant: 'خلفة (مؤكد)', not_pregnant: 'ما لقحت', born: 'ولدت', aborted: 'إجهاض' };
const fmtA = iso => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-QA-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
const ESTIMATE_NOTE = 'الموعد تقديري ولا يغني عن المتابعة البيطرية.';
const EXAMPLES = ['لقحت وضحى اليوم من شاهين', 'كم عندي حيران؟', 'متى لقحت وضحى؟', 'أي النوق عندي بتولد الشهر القادم؟', 'وش جابت وضحى آخر مرة؟', 'ولدت الشعلة اليوم بكرة وسميناها غلا', 'أبي أبيع الشعلة', 'وش التنبيهات؟'];
let SAMPLE = null; // يُضبط من الواجهة إذا توفرت قدرة "اسأل Claude"

function chatSave(role, content, meta) { S.chat.messages.push({ id: newId(), role, content, meta: meta || null, created_at: nowISO() }); if (S.chat.messages.length > 60) S.chat.messages = S.chat.messages.slice(-60); Store.saveChat(); }
function lastMeta() {
  const m = [...S.chat.messages].reverse().find(x => x.role === 'assistant');
  if (!m || !m.meta || Date.now() - new Date(m.created_at).getTime() > 30 * 60000) return null;
  return m.meta;
}
function actionStatus(a) { const p = S.chat.pending[a.id]; const st = p ? (p.status === 'pending' && p.expires_at < nowISO() ? 'expired' : p.status) : 'expired'; return { ...a, status: st }; }
function aiHistory() { return S.chat.messages.map(m => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at, cards: m.meta?.cards, action: m.meta?.action ? actionStatus(m.meta.action) : undefined, options: m.meta?.options, source: m.meta?.source })); }

function resolveCamel(name, sex) {
  if (!name) return { status: 'missing' };
  if (name.startsWith('@id:')) { const c = S.camels.get(name.slice(4)); return c && (!sex || c.sex === sex) ? { status: 'ok', camel: c } : { status: 'none', name }; }
  const list = findByName(name, sex);
  if (list.length === 1) return { status: 'ok', camel: list[0] };
  if (list.length > 1) return { status: 'ambiguous', list, name };
  return { status: 'none', name };
}
const ask = (text, awaiting, draft, options) => ({ text, meta: { awaiting, draft, options } });
const optionsFrom = list => list.map(c => ({ label: `${c.name}${c.tag_number ? ' (' + c.tag_number + ')' : ''}`, value: '@id:' + c.id }));
function propose(action, payload, summary, fields) {
  const aid = newId();
  for (const [k, p] of Object.entries(S.chat.pending)) if (p.status !== 'pending' || p.expires_at < nowISO()) delete S.chat.pending[k];
  S.chat.pending[aid] = { action, payload, status: 'pending', expires_at: new Date(Date.now() + 30 * 60000).toISOString() };
  return { id: aid, action, summary, fields, status: 'pending' };
}

function continueMating(d) {
  if (!d.dam_id) {
    const r = resolveCamel(d.dam, 'female');
    if (r.status === 'missing') return ask('أي ناقة تم تلقيحها؟ اكتب اسمها أو رقم الوسم.', 'dam', d);
    if (r.status === 'none') return ask(`ما لقيت ناقة باسم «${d.dam}» في حلالك. تأكد من الاسم، أو أضفها أولاً من صفحة «حلالي».`, 'dam', { ...d, dam: null });
    if (r.status === 'ambiguous') return ask(`عندك أكثر من ناقة تطابق «${d.dam}». أيها تقصد؟`, 'dam', { ...d, dam: null }, optionsFrom(r.list));
    d.dam_id = r.camel.id; d.dam_name = r.camel.name;
  }
  if (!d.sire_id && !d.sire_text) {
    if (!d.sire) return ask(`من هو الفحل الذي لقّح ${d.dam_name}؟`, 'sire', d);
    const r = resolveCamel(d.sire, 'male');
    if (r.status === 'ambiguous') return ask(`عندك أكثر من فحل يطابق «${d.sire}». أيهم؟`, 'sire', { ...d, sire: null }, optionsFrom(r.list));
    if (r.status === 'ok') { d.sire_id = r.camel.id; d.sire_name = r.camel.name; } else { d.sire_text = d.sire; d.sire_name = d.sire; d.sire_external = true; }
  }
  if (!d.date) return ask(`متى كان تلقيح ${d.dam_name}؟ (مثال: اليوم، أمس، قبل 3 أيام، أو 2026-11-01)`, 'date', d);
  if (d.date > todayISO()) return ask('تاريخ التلقيح لا يمكن أن يكون في المستقبل. متى كان التلقيح؟', 'date', { ...d, date: null });
  const expected = addDays(d.date, Number(S.settings.gestation_days) || 390);
  const prev = openMating(d.dam_id);
  const fields = [['الناقة', d.dam_name], ['الفحل', d.sire_name + (d.sire_external ? ' (من خارج حلالك)' : '')], ['تاريخ التلقيح', fmtA(d.date)], ['الولادة المتوقعة', fmtA(expected) + ' (تقديري)']];
  let text = `سأسجل تلقيح ${d.dam_name} من ${d.sire_name} بتاريخ ${fmtA(d.date)}. أكّد لحفظ السجل.`;
  if (prev && prev.outcome === 'confirmed_pregnant') text += `\n⚠️ تنبيه: ${d.dam_name} مسجلة خلفة (مؤكد) من تلقيح ${fmtA(prev.mating_date)}. تأكد قبل الحفظ.`;
  else if (prev) text += `\nملاحظة: يوجد تلقيح سابق غير مؤكد بتاريخ ${fmtA(prev.mating_date)} وسيُعتبر "ما لقحت" عند الحفظ.`;
  const action = propose('record_mating', { dam_id: d.dam_id, sire_id: d.sire_id || null, sire_name_text: d.sire_text || null, mating_date: d.date }, 'تسجيل تلقيح', fields);
  return { text: text + `\n${ESTIMATE_NOTE}`, meta: { action } };
}
function continueBirth(d) {
  if (!d.dam_id) {
    const r = resolveCamel(d.dam, 'female');
    if (r.status === 'missing') return ask('أي ناقة ولدت؟', 'dam', d);
    if (r.status === 'none') return ask(`ما لقيت ناقة باسم «${d.dam}» في حلالك. اكتب الاسم الصحيح أو رقم الوسم.`, 'dam', { ...d, dam: null });
    if (r.status === 'ambiguous') return ask('أي ناقة تقصد؟', 'dam', { ...d, dam: null }, optionsFrom(r.list));
    d.dam_id = r.camel.id; d.dam_name = r.camel.name;
  }
  if (!d.date) d.date = todayISO();
  if (!d.calf_sex) return ask(`مبروك! المولود قعود أو بكرة؟`, 'calf_sex', d, [{ label: 'قعود', value: 'قعود' }, { label: 'بكرة', value: 'بكرة' }]);
  const m = openMating(d.dam_id);
  const fields = [['الأم', d.dam_name], ['تاريخ الولادة', fmtA(d.date)], ['المولود', CALF_SEX_AR[d.calf_sex]], ['اسم المولود', d.calf_name || '(يُحدد لاحقاً)'], ['الأب', m ? sireName(m) + ' — من سجل التلقيح' : 'غير معروف (لا يوجد تلقيح مسجل)']];
  const action = propose('record_birth', { dam_id: d.dam_id, birth_date: d.date, calf_sex: d.calf_sex, calf_name: d.calf_name || null }, 'تسجيل ولادة', fields);
  return { text: `سأسجل ولادة ${d.dam_name} وأنشئ ملفاً للمولود مربوطاً بأمه${m ? ' وأبيه' : ''}. أكّد للحفظ.`, meta: { action } };
}
function fillSlot(meta, text) {
  const d = { ...meta.draft }; const n = normalizeAr(text);
  const value = text.startsWith('@id:') ? text.trim() : NLU.cleanName(n);
  if (/^(الغاء|إلغاء|كنسل|لا|خلاص|بلاش)$/.test(n)) return { text: 'تم الإلغاء. ما سجلت شيئاً.', meta: null };
  switch (meta.awaiting) {
    case 'dam': d.dam = value; d.dam_id = null; break;
    case 'sire': d.sire = text.startsWith('@id:') ? value : text.trim(); break;
    case 'date': { const r = NLU.extractDate(n); if (!r.date) return ask('ما فهمت التاريخ. اكتب مثلاً: اليوم، أمس، قبل 5 أيام، أو 2026-11-01', 'date', d); d.date = r.date; break; }
    case 'calf_sex': { const s = NLU.sexWord(n); if (!s) return ask('اختر: قعود أو بكرة', 'calf_sex', d, [{ label: 'قعود', value: 'قعود' }, { label: 'بكرة', value: 'بكرة' }]); d.calf_sex = s; break; }
    case 'listing_camel': return draftListing(value);
    default: return null;
  }
  return d.kind === 'birth' ? continueBirth(d) : continueMating(d);
}
function camelOr(name, sex, onOk) {
  const r = resolveCamel(name, sex);
  if (r.status === 'missing') return { text: 'اكتب اسم المطية أو رقم وسمها.' };
  if (r.status === 'none') return { text: `ما لقيت ${sex === 'male' ? 'فحلاً' : sex === 'female' ? 'ناقة' : 'مطية'} باسم «${name}» في حلالك.` };
  if (r.status === 'ambiguous') return { text: `فيه أكثر من مطية تطابق «${name}»:`, meta: { cards: [{ type: 'camels', items: r.list.map(c => ({ id: c.id, name: c.name, tag_number: c.tag_number })) }] } };
  return onOk(r.camel);
}
function answerLastMating(p) {
  return camelOr(p.dam, 'female', c => {
    const m = matings().filter(x => x.dam_id === c.id).sort(byDate('mating_date'))[0];
    if (!m) return { text: `ما فيه تلقيح مسجل لـ ${c.name} في السجلات.`, meta: { source: 'records' } };
    let t = `📋 حسب سجلاتك: آخر تلقيح لـ ${c.name} كان بتاريخ ${fmtA(m.mating_date)} من ${sireName(m) || 'غير مسجل'}.\nالحالة: ${OUTCOME_AR[m.outcome]}.`;
    if (['pending', 'confirmed_pregnant'].includes(m.outcome)) t += `\n🔮 الولادة المتوقعة: ${fmtA(m.expected_birth_date)} (بعد ${diffDays(todayISO(), m.expected_birth_date)} يوم تقريباً). ${ESTIMATE_NOTE}`;
    return { text: t, meta: { source: 'records', cards: [{ type: 'camel_link', id: c.id, name: c.name }] } };
  });
}
function answerDueOne(p) {
  return camelOr(p.dam, 'female', c => {
    const m = openMating(c.id);
    if (!m) return { text: `ما فيه تلقيح مفتوح مسجل لـ ${c.name}، فما أقدر أحسب موعد ولادة.`, meta: { source: 'records' } };
    const d = diffDays(todayISO(), m.expected_birth_date);
    return { text: `🔮 الموعد التقديري لولادة ${c.name}: ${fmtA(m.expected_birth_date)} ${d >= 0 ? `(بعد ${d} يوم)` : `(متجاوزة الموعد بـ ${-d} يوم)`}.\n📋 محسوب من تلقيح مسجل بتاريخ ${fmtA(m.mating_date)}. ${ESTIMATE_NOTE}`, meta: { source: 'records' } };
  });
}
function answerDueList(p) {
  const list = expectedBirths(p.period.from, p.period.to);
  if (!list.length) return { text: `ما فيه نوق متوقع ولادتها ${p.period.label} (${fmtA(p.period.from)} – ${fmtA(p.period.to)}) حسب سجلات التلقيح.`, meta: { source: 'records' } };
  return { text: `🔮 النوق المتوقع ولادتها ${p.period.label}: ${list.length}\n${list.map((b, i) => `${i + 1}. ${b.dam_name}${b.tag_number ? ' (' + b.tag_number + ')' : ''} — ${fmtA(b.expected_birth_date)}${b.sire_name ? ' — من ' + b.sire_name : ''}`).join('\n')}\n\n📋 محسوبة من تواريخ التلقيح المسجلة. ${ESTIMATE_NOTE}`, meta: { source: 'records', cards: [{ type: 'due' }] } };
}
function answerLastBirth(p) {
  return camelOr(p.dam, 'female', c => {
    const all = [...S.births.values()].filter(b => b.dam_id === c.id).sort(byDate('birth_date'));
    const b = all[0];
    if (!b) return { text: `ما فيه ولادة مسجلة لـ ${c.name}.`, meta: { source: 'records' } };
    const calf = b.calf_id && S.camels.get(b.calf_id); const m = b.mating_id && S.matings.get(b.mating_id); const sire = m ? sireName(m) : null;
    let t = `📋 حسب سجلاتك: آخر ولادة لـ ${c.name} كانت بتاريخ ${fmtA(b.birth_date)}`;
    t += b.outcome === 'stillborn' ? ' (نفوق المولود).' : `، ${b.calf_sex ? 'المولود ' + CALF_SEX_AR[b.calf_sex] : 'جنس المولود غير مسجل'}${calf ? ' واسمه «' + calf.name + '»' : ''}${sire ? '، والأب ' + sire : ''}.`;
    t += `\nإجمالي ولاداتها المسجلة: ${all.length}.`;
    const cards = [{ type: 'camel_link', id: c.id, name: c.name }]; if (calf) cards.push({ type: 'camel_link', id: calf.id, name: calf.name });
    return { text: t, meta: { source: 'records', cards } };
  });
}
function answerOffspring(p) {
  return camelOr(p.parent, null, c => {
    const kids = camels().filter(k => k.dam_id === c.id || k.sire_id === c.id);
    if (!kids.length) return { text: `ما فيه مواليد مسجلة لـ ${c.name} في حلالك.`, meta: { source: 'records' } };
    return { text: `📋 مواليد ${c.name} المسجلة في حلالك: ${kids.length} (${kids.filter(k => k.sex === 'female').length} بكرة و ${kids.filter(k => k.sex === 'male').length} قعود).`, meta: { source: 'records', cards: [{ type: 'camels', items: kids.map(k => ({ id: k.id, name: k.name, tag_number: k.tag_number })) }] } };
  });
}
function answerAge(p) {
  const def = AGE_NAMES.find(a => a.key === p.key);
  const list = listCamels({ age: p.key }).filter(c => !INACTIVE.includes(c.status));
  const title = `${def.m}${def.f !== def.m ? ' / ' + def.f : ''} (${def.label})`;
  if (!list.length) return { text: `📋 ما عندك في حلالك النشط أي ${title}.\nملاحظة: الإبل التي ليس لها تاريخ ميلاد مسجل لا تدخل في الحساب.`, meta: { source: 'records' } };
  const f = list.filter(c => c.sex === 'female').length, m = list.length - f;
  return { text: `📋 عندك ${list.length} من ${title}: ${f ? f + ' ' + def.f : ''}${f && m ? ' و ' : ''}${m ? m + ' ' + def.m : ''}.\n${list.map((c, i) => `${i + 1}. ${c.name}${c.tag_number ? ' (' + c.tag_number + ')' : ''}`).join('\n')}\n\nمحسوبة من تواريخ الميلاد المسجلة.`, meta: { source: 'records', cards: [{ type: 'camels', items: list.map(c => ({ id: c.id, name: c.name, tag_number: c.tag_number })) }] } };
}
function answerCounts() {
  const s = dashboard();
  return { text: `📋 حلالك النشط: ${s.total} رأس — ${s.females} ناقة و ${s.males} فحل.\nالنوق الملقحة: ${s.pregnant}، والمتوقع ولادتها خلال 30 يوماً: ${s.due_30}.\nالولادات المسجلة هذا العام: ${s.births_this_year}.${s.ages.groups.length ? '\nحسب العمر: ' + s.ages.groups.map(g => `${g.m === g.f ? g.m : g.m + '/' + g.f} ${g.males + g.females}`).join('، ') : ''}${s.ages.unknown ? `، وبدون تاريخ ميلاد ${s.ages.unknown}` : ''}.`, meta: { source: 'records' } };
}
function answerAlerts() {
  const a = alerts();
  if (!a.length) return { text: 'ما عندك تنبيهات قريبة. 👌', meta: { source: 'records' } };
  return { text: `عندك ${a.length} تنبيه:\n${a.slice(0, 10).map(x => '• ' + x.text).join('\n')}\n\n${ESTIMATE_NOTE}`, meta: { source: 'records' } };
}
function answerCamel(p) {
  return camelOr(p.name, null, c => {
    const f = getCamel(c.id);
    const age = f.age_days != null ? `${f.age_name.name} — ${Math.floor(f.age_days / 365)} سنة تقريباً${f.birth_date_estimated ? ' (تاريخ ميلاد تقديري)' : ''}` : 'غير مسجل';
    return { text: `📋 ${f.name}${f.tag_number ? ' — وسم ' + f.tag_number : ''}\n${SEX_AR[f.sex]} • ${f.breed || 'فئة غير محددة'} • ${f.color || 'لون غير محدد'}\nالعمر: ${age}\nالأم: ${f.dam?.name || f.dam_name_text || 'غير مسجلة'} • الأب: ${f.sire?.name || f.sire_name_text || 'غير مسجل'}\nالمواليد المسجلة: ${f.offspring.length}`, meta: { source: 'records', cards: [{ type: 'camel_link', id: c.id, name: c.name }] } };
  });
}
function draftListing(name) {
  if (!name) return ask('أي مطية تبي تبيعها؟ اكتب اسمها أو رقم الوسم.', 'listing_camel', {});
  return camelOr(name, null, c => {
    const f = getCamel(c.id); const age = f.age_days != null ? Math.floor(f.age_days / 365) : null; const parts = [];
    parts.push(`للبيع ${f.age_name ? f.age_name.name + ' ' : ''}${f.sex === 'female' ? '(ناقة)' : '(فحل)'} «${f.name}»${f.breed ? ' من ' + f.breed : ''}${f.color ? '، اللون ' + f.color : ''}.`);
    if (age != null) parts.push(`العمر: ${f.age_name.name}، ${age} ${age >= 3 && age <= 10 ? 'سنوات' : 'سنة'} تقريباً${f.birth_date_estimated ? ' (تقديري)' : ''}.`);
    const dam = f.dam?.name || f.dam_name_text, sire = f.sire?.name || f.sire_name_text;
    if (dam || sire) parts.push(`${dam ? 'الأم: ' + dam : ''}${dam && sire ? ' — ' : ''}${sire ? 'الأب: ' + sire : ''} ${f.pedigree_verified ? '(موثق)' : '(حسب سجلات المالك، غير موثق رسمياً)'}.`);
    if (f.sex === 'female' && f.births.length) parts.push(`ولدت ${f.births.length} ${f.births.length > 2 ? 'مرات' : 'مرة'} حسب السجلات.`);
    const vac = f.events.filter(e => e.type === 'vaccination'); if (vac.length) parts.push(`آخر تحصين مسجل: ${vac[0].title} بتاريخ ${fmtA(vac[0].event_date)}.`);
    const om = f.sex === 'female' ? openMating(f.id) : null; if (om) parts.push(`ملقحة بتاريخ ${fmtA(om.mating_date)}${om.outcome === 'confirmed_pregnant' ? ' (خلفة — مؤكد)' : ' (لم يُؤكد اللقاح بعد)'}.`);
    parts.push('السعر: [حدده أنت]  •  الموقع: [المدينة/الدولة]  •  للتواصل: [رقمك]');
    const missing = [!f.photos.length && 'صور واضحة', !f.breed && 'الفئة', !f.color && 'اللون', !f.birth_date && 'العمر'].filter(Boolean);
    return { text: `✍️ مسودة وصف إعلان (مقترحة من المساعد بناءً على سجلاتك فقط — راجعها وعدّلها قبل النشر):\n\n${parts.join('\n')}${missing.length ? `\n\n💡 لإعلان أقوى أضف: ${missing.join('، ')}.` : ''}\n\nملاحظة: سوق وسم للإعلانات يأتي في المرحلة الثانية؛ يمكنك نسخ الوصف الآن.`, meta: { source: 'ai_draft', cards: [{ type: 'camel_link', id: f.id, name: f.name }] } };
  });
}
const helpText = () => ({ text: `هلا والله! أنا مساعد وسم 🐪 أساعدك في إدارة حلالك.\nجرّب تكتب مثلاً:\n${EXAMPLES.map(e => '• ' + e).join('\n')}\n\nأي تسجيل أطلب تأكيدك قبل حفظه، والمواعيد دائماً تقديرية.`, meta: { options: EXAMPLES.slice(0, 4).map(e => ({ label: e, value: e })) } });

// أسئلة مفتوحة → Claude (أدوات قراءة فقط من حلال المستخدم)
const AI_SYSTEM = `أنت "مساعد وسم"، مساعد عربي خليجي لملاك الإبل، تتحدث بلهجة خليجية مهذبة وواضحة وباختصار.
قواعد صارمة: لا تخترع أي بيانات عن حلال المستخدم؛ استخدم الأدوات فقط وإن لم تجد المعلومة قل ذلك. ميّز بين "حسب سجلاتك" و"تقديري/اقتراح". لا تدّعِ إثبات النسب أو الأصالة أو العمر. لا تقدم تشخيصاً بيطرياً بل معلومات عامة مع النصح بمراجعة طبيب بيطري. لا تعطِ سعراً مؤكداً. لا تنفذ عمليات مالية أو مزايدات أو تسجيلات؛ لتسجيل تلقيح أو ولادة اطلب من المستخدم كتابة جملة مثل "لقحت وضحى اليوم من شاهين". مصطلحات: المولود الذكر قعود والأنثى بكرة، الناقة اللاقح خلفة، الأعمار: حوار، مفرود، حق، لقي، جذع، ثني، رباع، سديس، ثم بعير للفحل وفاطر للناقة.`;
const AI_TOOLS = [
  { name: 'search_camels', description: 'بحث في حلال المستخدم بالاسم أو الوسم أو الجنس', inputSchema: { type: 'object', properties: { q: { type: 'string' }, sex: { type: 'string', enum: ['female', 'male'] } } },
    execute: i => listCamels({ q: i.q, sex: i.sex }).slice(0, 30).map(c => ({ id: c.id, name: c.name, tag: c.tag_number, sex: c.sex, breed: c.breed, status: c.status, age: c.age_name?.name, expected_birth_date: c.expected_birth_date })) },
  { name: 'get_camel', description: 'ملف مطية بالمعرف', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: i => { const c = getCamel(i.id); return { ...c, photos: c.photos.length, events: c.events.slice(0, 15) }; } },
  { name: 'expected_births', description: 'النوق المتوقع ولادتها بين تاريخين YYYY-MM-DD', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }, execute: i => expectedBirths(i.from, i.to) },
  { name: 'alerts', description: 'تنبيهات المستخدم', inputSchema: { type: 'object', properties: {} }, execute: () => alerts() },
  { name: 'herd_stats', description: 'إحصاءات الحلال', inputSchema: { type: 'object', properties: {} }, execute: () => { const s = dashboard(); delete s.recent; return s; } },
];
async function llmAnswer(text) {
  if (!SAMPLE) return null;
  const recent = S.chat.messages.slice(-8).filter(m => m.content && !m.content.startsWith('(اختيار'));
  const msgs = recent.map(m => ({ role: m.role, content: m.content }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: text });
  msgs[0] = { role: 'user', content: `${AI_SYSTEM}\nتاريخ اليوم: ${todayISO()}. المدة من اللقاح إلى الولادة لدى المستخدم: ${S.settings.gestation_days} يوماً.\n\n${msgs[0].content}` };
  const r = await SAMPLE(msgs, { tools: AI_TOOLS, cache: false });
  return { text: r.text, meta: { source: 'ai' } };
}

async function aiHandle(raw) {
  const text = String(raw || '').trim().slice(0, 1000);
  if (!text) throw bad('empty', 'اكتب رسالتك');
  const meta = lastMeta();
  chatSave('user', text.startsWith('@id:') ? '(اختيار من القائمة)' : text);
  const p = NLU.parse(text, todayISO());
  let out;
  try {
    const n = normalizeAr(text);
    if (meta && meta.awaiting && (p.intent === 'unknown' || text.startsWith('@id:') || /^(الغاء|إلغاء|لا|كنسل)$/.test(text.trim()) || (meta.awaiting === 'date' && NLU.extractDate(n).date) || (meta.awaiting === 'calf_sex' && NLU.sexWord(n)))) out = fillSlot(meta, text);
    if (!out) switch (p.intent) {
      case 'greeting': case 'help': case 'empty': out = helpText(); break;
      case 'record_mating': out = p.invalid_date ? { text: 'التاريخ المكتوب غير صحيح. اكتب مثلاً 2026-11-01 أو 1/11/2026.' } : continueMating({ kind: 'mating', dam: p.dam, sire: p.sire, date: p.date }); break;
      case 'record_birth': out = continueBirth({ kind: 'birth', dam: p.dam, calf_sex: p.calf_sex, calf_name: p.calf_name, date: p.date }); break;
      case 'query_last_mating': out = answerLastMating(p); break;
      case 'query_due_one': out = answerDueOne(p); break;
      case 'query_due_list': out = answerDueList(p); break;
      case 'query_last_birth': out = answerLastBirth(p); break;
      case 'query_offspring': out = answerOffspring(p); break;
      case 'query_counts': out = answerCounts(); break;
      case 'query_age': out = answerAge(p); break;
      case 'query_alerts': out = answerAlerts(); break;
      case 'query_camel': out = answerCamel(p); break;
      case 'draft_listing': out = draftListing(p.name); break;
      default: {
        try { out = await llmAnswer(text); } catch (e) { out = { text: e && e.code === 'rate_limited' ? 'المساعد المتقدم مشغول الحين، جرّب بعد شوي.' : 'المساعد المتقدم غير متاح حالياً. جرّب أحد الأوامر المعروفة.' }; }
        if (!out) out = { text: `ما فهمت طلبك بالضبط 🙏\nأقدر حالياً أسجل التلقيح والولادة وأجاوب عن مواعيد الولادة وسجلات نوقك. أمثلة:\n${EXAMPLES.slice(0, 5).map(e => '• ' + e).join('\n')}`, meta: { options: EXAMPLES.slice(0, 3).map(e => ({ label: e, value: e })) } };
      }
    }
  } catch (e) { if (e instanceof HttpError && e.status < 500) out = { text: e.message }; else throw e; }
  chatSave('assistant', out.text, out.meta || null);
  return { reply: out.text, intent: p.intent, ...(out.meta || {}) };
}
function aiConfirm(id) {
  const a = S.chat.pending[id];
  if (!a) throw new HttpError(404, 'not_found', 'الإجراء غير موجود أو انتهت صلاحيته');
  if (a.status !== 'pending') throw new HttpError(409, 'already_handled', 'تمت معالجة هذا الإجراء مسبقاً');
  if (a.expires_at < nowISO()) { a.status = 'expired'; Store.saveChat(); throw new HttpError(410, 'expired', 'انتهت صلاحية الإجراء، أعد الطلب'); }
  a.status = 'confirmed';
  const payload = { ...a.payload, source: 'assistant' }; let result, text;
  try {
    if (a.action === 'record_mating') { result = recordMating(payload); text = `✅ تم تسجيل التلقيح. الولادة المتوقعة ${fmtA(result.expected_birth_date)} (تقديري) وسأنبهك قبلها بـ ${S.settings.birth_alert_days} يوماً.`; }
    else if (a.action === 'record_birth') { result = recordBirth(payload); text = `✅ تم تسجيل الولادة${result.calf ? ` وإنشاء ملف المولود «${result.calf.name}»` : ''}. مبروك ما جاكم 🎉`; }
    else throw bad('unknown_action', 'إجراء غير معروف');
  } catch (e) { a.status = 'pending'; throw e; }
  chatSave('assistant', text, { source: 'records', cards: result.calf ? [{ type: 'camel_link', id: result.calf.id, name: result.calf.name }] : [{ type: 'camel_link', id: payload.dam_id, name: 'ملف الناقة' }] });
  return { ok: true, reply: text, result };
}
function aiCancel(id) { const a = S.chat.pending[id]; if (!a || a.status !== 'pending') throw new HttpError(404, 'not_found', 'الإجراء غير موجود أو تمت معالجته'); a.status = 'cancelled'; chatSave('assistant', 'تم الإلغاء، ما سجلت شيئاً.', null); return { ok: true }; }

async function analyzePhoto(photoId) {
  if (!SAMPLE) return { enabled: false };
  const p = S.photos.get(photoId); if (!p) throw new HttpError(404, 'not_found', 'الصورة غير موجودة');
  const blob = await (await fetch(p.data)).blob();
  const r = await SAMPLE('صف هذه الإبل وصفاً مرئياً موجزاً بالعربية في 4 أسطر: اللون الظاهر، الفئة المحتملة (مغاتير/مجاهيم/أصايل/أخرى) مع درجة ثقة (عالية/متوسطة/منخفضة)، والصفات المرئية. لا تحدد العمر أو النسب أو الأصالة ولا تقدم تشخيصاً. إذا لم تكن الصورة لإبل قل ذلك.', { images: [blob], cache: false });
  return { enabled: true, suggestion: r.text, notice: 'اقتراح آلي من الصورة فقط — لا يثبت النسب أو الأصالة أو العمر.' };
}
