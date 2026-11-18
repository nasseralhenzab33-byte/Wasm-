// ===================== منطق الحلال (منقول من herd.service.js) =====================
const SEX = ['female', 'male'];
const STATUS = ['active', 'pregnant', 'nursing', 'sold', 'dead', 'transferred'];
const INACTIVE = ['sold', 'dead', 'transferred'];
const EVENT_TYPES = ['weaning', 'vaccination', 'treatment', 'vet_visit', 'sale', 'purchase', 'transfer', 'checkup', 'achievement', 'note'];
const CAMEL_FIELDS = ['name', 'tag_number', 'microchip', 'sex', 'breed', 'color', 'birth_date', 'birth_date_estimated', 'dam_id', 'sire_id', 'dam_name_text', 'sire_name_text', 'status', 'notes', 'farm_id'];
const camels = () => [...S.camels.values()];
const matings = () => [...S.matings.values()];
const byDate = (k, dir = -1) => (a, b) => dir * String(a[k] || '').localeCompare(String(b[k] || '')) || dir * String(a.created_at || '').localeCompare(String(b.created_at || ''));

function ownedCamel(id) {
  const c = S.camels.get(String(id || ''));
  if (!c) throw new HttpError(404, 'not_found', 'المطية غير موجودة');
  return c;
}
function isDescendant(ancestorId, candidateId) {
  const seen = new Set(); const stack = [ancestorId];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of camels()) if ((c.dam_id === cur || c.sire_id === cur) && !seen.has(c.id)) { if (c.id === candidateId) return true; seen.add(c.id); stack.push(c.id); }
  }
  return false;
}
function validateCamel(input, existing = null) {
  const out = {};
  for (const f of CAMEL_FIELDS) if (input[f] !== undefined) out[f] = input[f];
  if (!existing || out.name !== undefined) { out.name = str(out.name, 80); if (!out.name) throw bad('name_required', 'اسم المطية مطلوب'); }
  if (!existing || out.sex !== undefined) if (!SEX.includes(out.sex)) throw bad('invalid_sex', 'الجنس غير صحيح');
  if (out.status !== undefined && !STATUS.includes(out.status)) throw bad('invalid_status', 'الحالة غير صحيحة');
  for (const f of ['tag_number', 'microchip', 'breed', 'color', 'dam_name_text', 'sire_name_text']) if (out[f] !== undefined) out[f] = str(out[f], 80);
  if (out.notes !== undefined) out.notes = str(out.notes, 2000);
  if (out.birth_date !== undefined) {
    out.birth_date = str(out.birth_date, 10);
    if (out.birth_date && !isISODate(out.birth_date)) throw bad('invalid_date', 'تاريخ الميلاد غير صحيح');
    if (out.birth_date && out.birth_date > todayISO()) throw bad('future_date', 'تاريخ الميلاد لا يمكن أن يكون في المستقبل');
  }
  if (out.birth_date_estimated !== undefined) out.birth_date_estimated = out.birth_date_estimated ? 1 : 0;
  const selfId = existing ? existing.id : null;
  for (const [f, sex] of [['dam_id', 'female'], ['sire_id', 'male']]) {
    if (out[f] === undefined) continue;
    out[f] = str(out[f], 64);
    if (!out[f]) continue;
    if (out[f] === selfId) throw bad('self_parent', 'لا يمكن أن تكون المطية أماً أو أباً لنفسها');
    const p = ownedCamel(out[f]);
    if (p.sex !== sex) throw bad('parent_sex', f === 'dam_id' ? 'الأم يجب أن تكون ناقة' : 'الأب يجب أن يكون فحلاً');
    if (selfId && isDescendant(selfId, p.id)) throw bad('pedigree_cycle', 'هذا الربط يُنشئ حلقة في شجرة النسب');
  }
  if (out.farm_id !== undefined) { out.farm_id = str(out.farm_id, 64); if (out.farm_id && !S.farms.has(out.farm_id)) throw bad('invalid_farm', 'العزبة غير موجودة'); }
  if (out.tag_number && camels().some(c => c.tag_number === out.tag_number && c.id !== selfId)) throw new HttpError(409, 'duplicate_tag', 'رقم الوسم مستخدم لمطية أخرى في حلالك');
  if (out.name) out.name_norm = normalizeAr(out.name);
  return out;
}
function openMating(damId) { return matings().filter(m => m.dam_id === damId && ['pending', 'confirmed_pregnant'].includes(m.outcome)).sort(byDate('mating_date'))[0] || null; }
function sireName(m) { return m.sire_id ? (S.camels.get(m.sire_id) || {}).name || m.sire_name_text : m.sire_name_text; }
function photoOf(id) { return [...S.photos.values()].filter(p => p.camel_id === id && p.kind === 'photo').sort((a, b) => (b.is_primary - a.is_primary) || a.created_at.localeCompare(b.created_at))[0]; }

function listCamels({ q, sex, status, breed, age } = {}) {
  const nq = q ? normalizeAr(q) : null;
  return camels().filter(c => (!nq || c.name_norm.includes(nq) || (c.tag_number || '').includes(String(q).trim())) && (!sex || c.sex === sex) && (!status || c.status === status) && (!breed || c.breed === breed))
    .map(c => { const om = c.sex === 'female' ? openMating(c.id) : null; const ph = photoOf(c.id);
      return { id: c.id, name: c.name, tag_number: c.tag_number, sex: c.sex, breed: c.breed, color: c.color, birth_date: c.birth_date, status: c.status, is_demo: c.is_demo,
        photo_id: ph ? ph.id : null, expected_birth_date: om ? om.expected_birth_date : null, age_name: ageName(c.birth_date, c.sex, todayISO()) }; })
    .filter(c => !age || (age === 'unknown' ? !c.age_name : c.age_name && c.age_name.key === age))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
function findByName(name, sex) {
  const n = normalizeAr(name); if (!n) return [];
  const act = camels().filter(c => !INACTIVE.includes(c.status) && (!sex || c.sex === sex));
  const exact = act.filter(c => c.name_norm === n);
  if (exact.length) return exact;
  return act.filter(c => c.tag_number === name.trim() || c.name_norm.includes(n)).slice(0, 5);
}
function createCamel(input) {
  const v = validateCamel(input);
  const row = { id: newId(), status: 'active', birth_date_estimated: 0, created_at: nowISO(), updated_at: nowISO(), ...v };
  if (input.is_demo) row.is_demo = 1;
  Store.put('camel', row);
  audit('create', 'camel', row.id, { camelId: row.id, after: v });
  return getCamel(row.id);
}
function updateCamel(id, input) {
  const before = ownedCamel(id);
  const v = validateCamel(input, before);
  const after = { ...before, ...v, updated_at: nowISO() };
  for (const k of Object.keys(after)) if (after[k] === null) delete after[k];
  Store.put('camel', after);
  audit('update', 'camel', id, { camelId: id, before, after });
  return getCamel(id);
}
function deleteCamel(id) {
  const c = ownedCamel(id);
  Store.del('camel', id);
  for (const m of matings()) if (m.dam_id === id) Store.del('mating', m.id); else if (m.sire_id === id) Store.put('mating', { ...m, sire_id: null, sire_name_text: m.sire_name_text || c.name });
  for (const b of [...S.births.values()]) if (b.dam_id === id) Store.del('birth', b.id); else if (b.calf_id === id) Store.put('birth', { ...b, calf_id: null });
  for (const e of [...S.events.values()]) if (e.camel_id === id) Store.del('event', e.id);
  for (const p of [...S.photos.values()]) if (p.camel_id === id) Store.del('photo', p.id);
  for (const k of camels()) if (k.dam_id === id || k.sire_id === id) Store.put('camel', { ...k, dam_id: k.dam_id === id ? null : k.dam_id, sire_id: k.sire_id === id ? null : k.sire_id, [k.dam_id === id ? 'dam_name_text' : 'sire_name_text']: c.name });
  audit('delete', 'camel', id, { camelId: id, before: c });
  return { ok: true };
}
function getCamel(id) {
  const c = ownedCamel(id);
  const nm = i => { const x = i && S.camels.get(i); return x ? { id: x.id, name: x.name, tag_number: x.tag_number } : null; };
  return { ...c, dam: nm(c.dam_id), sire: nm(c.sire_id), farm: c.farm_id && S.farms.get(c.farm_id) ? { id: c.farm_id, name: S.farms.get(c.farm_id).name } : null,
    age_days: c.birth_date ? diffDays(c.birth_date, todayISO()) : null, age_name: ageName(c.birth_date, c.sex, todayISO()),
    matings: c.sex === 'female' ? matings().filter(m => m.dam_id === c.id).sort(byDate('mating_date')).map(m => ({ ...m, sire_name: m.sire_id ? (S.camels.get(m.sire_id) || {}).name : null })) : [],
    sired_matings: c.sex === 'male' ? matings().filter(m => m.sire_id === c.id).sort(byDate('mating_date')).map(m => ({ ...m, dam_name: (S.camels.get(m.dam_id) || {}).name })) : [],
    births: [...S.births.values()].filter(b => b.dam_id === c.id).sort(byDate('birth_date')).map(b => { const k = b.calf_id && S.camels.get(b.calf_id); return { ...b, calf_name: k ? k.name : null, calf_tag: k ? k.tag_number : null }; }),
    offspring: camels().filter(k => k.dam_id === c.id || k.sire_id === c.id).sort(byDate('birth_date')).map(k => ({ id: k.id, name: k.name, tag_number: k.tag_number, sex: k.sex, birth_date: k.birth_date, status: k.status })),
    events: [...S.events.values()].filter(e => e.camel_id === c.id).sort(byDate('event_date')),
    photos: [...S.photos.values()].filter(p => p.camel_id === c.id && p.kind === 'photo').sort((a, b) => (b.is_primary - a.is_primary) || a.created_at.localeCompare(b.created_at)).map(p => ({ id: p.id, caption: p.caption, is_primary: p.is_primary, created_at: p.created_at })),
    documents: [] };
}
function recordMating(input) {
  const dam = ownedCamel(input.dam_id);
  if (dam.sex !== 'female') throw bad('dam_not_female', 'التلقيح يُسجل على ناقة');
  if (INACTIVE.includes(dam.status)) throw bad('dam_inactive', 'الناقة ليست ضمن الحلال النشط');
  const date = str(input.mating_date, 10) || todayISO();
  if (!isISODate(date)) throw bad('invalid_date', 'تاريخ التلقيح غير صحيح');
  if (date > addDays(todayISO(), 1)) throw bad('future_date', 'تاريخ التلقيح لا يمكن أن يكون في المستقبل');
  let sireId = str(input.sire_id, 64), sireText = str(input.sire_name_text, 80);
  if (sireId) { const s = ownedCamel(sireId); if (s.sex !== 'male') throw bad('sire_not_male', 'الفحل يجب أن يكون من الفحول'); sireText = null; }
  if (!sireId && !sireText) throw bad('sire_required', 'حدد الفحل (من حلالك أو اكتب اسمه)');
  for (const m of matings()) if (m.dam_id === dam.id && m.outcome === 'pending' && m.mating_date < date) Store.put('mating', { ...m, outcome: 'not_pregnant' });
  const row = { id: newId(), dam_id: dam.id, sire_id: sireId, sire_name_text: sireText, mating_date: date, expected_birth_date: addDays(date, Number(S.settings.gestation_days) || 390),
    outcome: 'pending', notes: str(input.notes, 1000), source: input.source === 'assistant' ? 'assistant' : 'manual', created_at: nowISO() };
  Store.put('mating', row);
  audit('create', 'mating', row.id, { camelId: dam.id, after: row });
  return { ...row, sire_name: sireId ? S.camels.get(sireId).name : null };
}
function updateMating(id, input) {
  const m = S.matings.get(id); if (!m) throw new HttpError(404, 'not_found', 'سجل التلقيح غير موجود');
  if (input.outcome !== undefined && !['pending', 'confirmed_pregnant', 'not_pregnant', 'aborted'].includes(input.outcome)) throw bad('invalid_outcome', 'نتيجة غير صحيحة');
  const after = { ...m, outcome: input.outcome ?? m.outcome, notes: input.notes !== undefined ? str(input.notes, 1000) : m.notes };
  Store.put('mating', after);
  const dam = S.camels.get(m.dam_id);
  if (dam) {
    if (after.outcome === 'confirmed_pregnant' && ['active', 'nursing'].includes(dam.status)) Store.put('camel', { ...dam, status: 'pregnant' });
    if (['not_pregnant', 'aborted'].includes(after.outcome) && dam.status === 'pregnant') Store.put('camel', { ...dam, status: 'active' });
  }
  audit('update', 'mating', id, { camelId: m.dam_id, before: m, after });
  return after;
}
function deleteMating(id) {
  const m = S.matings.get(id); if (!m) throw new HttpError(404, 'not_found', 'سجل التلقيح غير موجود');
  if (m.outcome === 'born') throw bad('mating_has_birth', 'لا يمكن حذف تلقيح مرتبط بولادة مسجلة');
  Store.del('mating', id); audit('delete', 'mating', id, { camelId: m.dam_id, before: m });
  return { ok: true };
}
function recordBirth(input) {
  const dam = ownedCamel(input.dam_id);
  if (dam.sex !== 'female') throw bad('dam_not_female', 'الولادة تُسجل على ناقة');
  const date = str(input.birth_date, 10) || todayISO();
  if (!isISODate(date) || date > todayISO()) throw bad('invalid_date', 'تاريخ الولادة غير صحيح');
  const outcome = input.outcome === 'stillborn' ? 'stillborn' : 'live';
  const calfSex = input.calf_sex ? (SEX.includes(input.calf_sex) ? input.calf_sex : (() => { throw bad('invalid_sex', 'جنس المولود غير صحيح'); })()) : null;
  const mating = input.mating_id ? S.matings.get(input.mating_id) : openMating(dam.id);
  if (mating && date < mating.mating_date) throw bad('birth_before_mating', 'تاريخ الولادة يسبق تاريخ التلقيح');
  const tag = str(input.calf_tag, 80);
  if (tag && camels().some(c => c.tag_number === tag)) throw new HttpError(409, 'duplicate_tag', 'رقم الوسم مستخدم');
  const birthId = newId(); let calf = null;
  if (outcome === 'live') {
    const calfName = str(input.calf_name, 80) || `مولود ${dam.name} ${date}`;
    calf = { id: newId(), farm_id: dam.farm_id || null, name: calfName, name_norm: normalizeAr(calfName), tag_number: tag, sex: calfSex || 'female', breed: dam.breed || null, birth_date: date,
      birth_date_estimated: 0, dam_id: dam.id, sire_id: mating ? mating.sire_id : null, sire_name_text: mating ? mating.sire_name_text : null, status: 'active', created_at: nowISO(), updated_at: nowISO() };
    if (dam.is_demo || input.is_demo) calf.is_demo = 1;
    Store.put('camel', calf);
  }
  Store.put('birth', { id: birthId, dam_id: dam.id, mating_id: mating ? mating.id : null, calf_id: calf ? calf.id : null, birth_date: date, calf_sex: calfSex, outcome, notes: str(input.notes, 1000), source: input.source === 'assistant' ? 'assistant' : 'manual', created_at: nowISO() });
  if (mating) Store.put('mating', { ...mating, outcome: 'born', birth_id: birthId });
  Store.put('camel', { ...dam, status: outcome === 'live' ? 'nursing' : 'active' });
  audit('create', 'birth', birthId, { camelId: dam.id, after: { date, outcome } });
  if (calf) audit('create', 'camel', calf.id, { camelId: calf.id });
  return { birth: S.births.get(birthId), calf: calf ? getCamel(calf.id) : null };
}
function addEvent(camelId, input) {
  const c = ownedCamel(camelId);
  if (!EVENT_TYPES.includes(input.type)) throw bad('invalid_type', 'نوع السجل غير صحيح');
  const date = str(input.event_date, 10) || todayISO();
  if (!isISODate(date)) throw bad('invalid_date', 'التاريخ غير صحيح');
  const next = str(input.next_due_date, 10);
  if (next && (!isISODate(next) || next < date)) throw bad('invalid_next_date', 'موعد المتابعة غير صحيح');
  const title = str(input.title, 120); if (!title) throw bad('title_required', 'العنوان مطلوب');
  const amount = input.amount != null && input.amount !== '' ? Number(input.amount) : null;
  if (amount != null && (!isFinite(amount) || amount < 0)) throw bad('invalid_amount', 'المبلغ غير صحيح');
  const row = { id: newId(), camel_id: c.id, type: input.type, event_date: date, title, details: str(input.details, 2000), next_due_date: next, counterparty: str(input.counterparty, 120), amount, currency: amount != null ? (str(input.currency, 3) || 'QAR') : null, created_at: nowISO() };
  Store.put('event', row);
  const statusMap = { sale: 'sold', transfer: 'transferred' };
  if (statusMap[row.type]) Store.put('camel', { ...c, status: statusMap[row.type] });
  if (row.type === 'weaning' && c.dam_id) { const d = S.camels.get(c.dam_id); if (d && d.status === 'nursing') Store.put('camel', { ...d, status: 'active' }); }
  audit('create', 'event', row.id, { camelId: c.id, after: row });
  return row;
}
function deleteEvent(id) { const e = S.events.get(id); if (!e) throw new HttpError(404, 'not_found', 'السجل غير موجود'); Store.del('event', id); audit('delete', 'event', id, { camelId: e.camel_id, before: e }); return { ok: true }; }

function pedigree(id, depth = 3) {
  ownedCamel(id);
  const node = (cid, d) => {
    const c = S.camels.get(cid); if (!c) return null;
    const out = { id: c.id, name: c.name, tag_number: c.tag_number, sex: c.sex, breed: c.breed, color: c.color, birth_date: c.birth_date, verified: !!c.pedigree_verified };
    if (d > 0) {
      out.dam = c.dam_id ? node(c.dam_id, d - 1) : (c.dam_name_text ? { name: c.dam_name_text, external: true, sex: 'female' } : null);
      out.sire = c.sire_id ? node(c.sire_id, d - 1) : (c.sire_name_text ? { name: c.sire_name_text, external: true, sex: 'male' } : null);
    }
    return out;
  };
  const offspring = []; const seen = new Set(); let frontier = [id];
  for (let gen = 1; gen <= 3 && frontier.length; gen++) {
    const nextF = [];
    for (const c of camels()) if ((frontier.includes(c.dam_id) || frontier.includes(c.sire_id)) && !seen.has(c.id)) { seen.add(c.id); offspring.push({ id: c.id, name: c.name, tag_number: c.tag_number, sex: c.sex, birth_date: c.birth_date, generation: gen }); nextF.push(c.id); }
    frontier = nextF;
  }
  return { tree: node(id, Math.min(Math.max(Number(depth) || 3, 1), 5)), offspring, notice: 'شجرة النسب مبنية على ما سجله المالك، ولا تُعد موثقة إلا بمستندات أو جهة تحقق معتمدة.' };
}
function expectedBirths(from, to) {
  const out = [];
  for (const c of camels()) {
    if (c.sex !== 'female' || INACTIVE.includes(c.status)) continue;
    const m = openMating(c.id);
    if (m && m.expected_birth_date >= from && m.expected_birth_date <= to)
      out.push({ mating_id: m.id, dam_id: c.id, dam_name: c.name, tag_number: c.tag_number, mating_date: m.mating_date, expected_birth_date: m.expected_birth_date, outcome: m.outcome, sire_name: sireName(m) });
  }
  return out.sort((a, b) => a.expected_birth_date.localeCompare(b.expected_birth_date));
}
function calendar(from, to) {
  if (!isISODate(from) || !isISODate(to) || diffDays(from, to) > 400 || to < from) throw bad('invalid_range', 'نطاق التاريخ غير صحيح');
  const items = [];
  for (const b of expectedBirths(from, to)) items.push({ date: b.expected_birth_date, kind: 'expected_birth', camel_id: b.dam_id, title: `ولادة متوقعة: ${b.dam_name}`, sub: `تلقيح ${b.mating_date}${b.sire_name ? ' من ' + b.sire_name : ''}`, estimated: true });
  for (const e of S.events.values()) if (e.next_due_date && e.next_due_date >= from && e.next_due_date <= to && S.camels.get(e.camel_id)) items.push({ date: e.next_due_date, kind: 'follow_up', camel_id: e.camel_id, title: `متابعة: ${e.title}`, sub: S.camels.get(e.camel_id).name });
  for (const b of S.births.values()) if (b.birth_date >= from && b.birth_date <= to && S.camels.get(b.dam_id)) items.push({ date: b.birth_date, kind: 'birth', camel_id: b.dam_id, title: `ولادة: ${S.camels.get(b.dam_id).name}`, sub: b.outcome === 'live' ? 'مولود حي' : 'نفوق' });
  for (const m of S.matings.values()) if (m.mating_date >= from && m.mating_date <= to && S.camels.get(m.dam_id)) items.push({ date: m.mating_date, kind: 'mating', camel_id: m.dam_id, title: `تلقيح: ${S.camels.get(m.dam_id).name}`, sub: '' });
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, items, notice: 'مواعيد الولادة تقديرية بناءً على مدة تقديرية من اللقاح إلى الولادة، ولا تغني عن المتابعة البيطرية.' };
}
function alerts() {
  const today = todayISO(); const win = Number(S.settings.birth_alert_days) || 14; const out = [];
  for (const b of expectedBirths(addDays(today, -60), addDays(today, win))) {
    const d = diffDays(today, b.expected_birth_date);
    out.push({ level: d < 0 ? 'warning' : d <= 3 ? 'urgent' : 'info', kind: d < 0 ? 'overdue_birth' : 'upcoming_birth', camel_id: b.dam_id, date: b.expected_birth_date, days: d,
      text: d < 0 ? `تجاوزت ${b.dam_name} موعد الولادة التقديري بـ ${-d} يوم — يُنصح بالمتابعة البيطرية وتحديث السجل` : d === 0 ? `موعد ولادة ${b.dam_name} التقديري اليوم` : `${b.dam_name} يُتوقع أن تلد خلال ${d} يوم (${b.expected_birth_date})` });
  }
  for (const e of S.events.values()) {
    const c = S.camels.get(e.camel_id);
    if (!e.next_due_date || !c || INACTIVE.includes(c.status) || e.next_due_date < addDays(today, -7) || e.next_due_date > addDays(today, 7)) continue;
    const d = diffDays(today, e.next_due_date);
    out.push({ level: d < 0 ? 'warning' : 'info', kind: 'follow_up', camel_id: e.camel_id, date: e.next_due_date, days: d, text: `${e.title} — ${c.name} (${d < 0 ? 'متأخر ' + -d + ' يوم' : d === 0 ? 'اليوم' : 'بعد ' + d + ' يوم'})` });
  }
  for (const m of S.matings.values()) { const c = S.camels.get(m.dam_id); if (m.outcome === 'pending' && m.mating_date <= addDays(today, -90) && c && !INACTIVE.includes(c.status)) out.push({ level: 'info', kind: 'confirm_pregnancy', camel_id: m.dam_id, date: m.mating_date, text: `لم يُسجل هل لقحت ${c.name} أو لا منذ تلقيح ${m.mating_date}` }); }
  const rank = { urgent: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.date || '').localeCompare(b.date || ''));
}
function ageBreakdown() {
  const out = AGE_NAMES.map(a => ({ key: a.key, m: a.m, f: a.f, males: 0, females: 0 })); let unknown = 0;
  for (const c of camels()) { if (INACTIVE.includes(c.status)) continue; const a = ageName(c.birth_date, c.sex, todayISO()); if (!a) { unknown++; continue; } const o = out.find(x => x.key === a.key); if (c.sex === 'female') o.females++; else o.males++; }
  return { groups: out.filter(o => o.males + o.females), unknown };
}
function dashboard() {
  const today = todayISO(); const act = camels().filter(c => !INACTIVE.includes(c.status));
  return { total: act.length, females: act.filter(c => c.sex === 'female').length, males: act.filter(c => c.sex === 'male').length,
    pregnant: expectedBirths('0000-01-01', '9999-12-31').length, births_this_year: [...S.births.values()].filter(b => b.birth_date >= today.slice(0, 4) + '-01-01').length,
    due_30: expectedBirths(today, addDays(today, 30)).length, upcoming: expectedBirths(addDays(today, -30), addDays(today, 120)).slice(0, 8), alerts: alerts().slice(0, 8), ages: ageBreakdown(),
    recent: S.log.slice(-8).reverse().map(a => ({ action: a.action, entity: a.entity, created_at: a.created_at, camel_id: a.camel_id, camel_name: a.camel_id && S.camels.get(a.camel_id) ? S.camels.get(a.camel_id).name : null })),
    has_demo: camels().some(c => c.is_demo) };
}
function history(id) { ownedCamel(id); return S.log.filter(a => a.camel_id === id).slice().reverse(); }

// ===================== الصور =====================
function uploadPhoto(camelId, { data_base64, caption, is_primary, is_demo }) {
  const c = ownedCamel(camelId);
  if (typeof data_base64 !== 'string' || !data_base64.startsWith('data:image/')) throw new HttpError(415, 'unsupported_file', 'أرسل صورة JPG أو PNG');
  if (data_base64.length > 240 * 1024) throw new HttpError(413, 'file_too_large', 'الصورة كبيرة جداً بعد الضغط');
  const dupOwn = [...S.photos.values()].filter(p => p.data === data_base64).map(p => ({ id: p.id, camel_id: p.camel_id, name: (S.camels.get(p.camel_id) || {}).name }));
  const first = !photoOf(c.id);
  if (is_primary) for (const p of S.photos.values()) if (p.camel_id === c.id && p.is_primary) Store.put('photo', { ...p, is_primary: 0 });
  const row = { id: newId(), camel_id: c.id, kind: 'photo', data: data_base64, caption: caption ? String(caption).slice(0, 120) : null, is_primary: (is_primary || first) ? 1 : 0, created_at: nowISO() };
  if (is_demo) row.is_demo = 1;
  Store.put('photo', row);
  audit('upload', 'media', row.id, { camelId: c.id });
  return { id: row.id, kind: 'photo', duplicate_in_my_herd: dupOwn, duplicate_elsewhere: false };
}
function removePhoto(id) { const p = S.photos.get(id); if (!p) throw new HttpError(404, 'not_found', 'الملف غير موجود'); Store.del('photo', id); audit('delete', 'media', id, { camelId: p.camel_id }); return { ok: true }; }
function mediaSrc(id) { const p = S.photos.get(id); return p ? p.data : ''; }
