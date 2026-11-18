'use strict';
// منطق إدارة الحلال — مستقل عن HTTP حتى يستدعيه الـ API والمساعد الذكي بنفس قواعد الصلاحيات.
// قاعدة ذهبية: كل استعلام مقيد بـ owner_id للمستخدم الحالي. لا يوجد أي مسار يقرأ حلال مستخدم آخر.
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, todayISO, addDays, diffDays, isISODate, normalizeAr } = require('../lib/util');
const { ageName, AGE_NAMES } = require('../lib/ageNames');

const SEX = ['female', 'male'];
const STATUS = ['active', 'pregnant', 'nursing', 'sold', 'dead', 'transferred'];
const EVENT_TYPES = ['weaning', 'vaccination', 'treatment', 'vet_visit', 'sale', 'purchase', 'transfer', 'checkup', 'achievement', 'note'];
const CAMEL_FIELDS = ['name', 'tag_number', 'microchip', 'sex', 'breed', 'color', 'birth_date', 'birth_date_estimated', 'dam_id', 'sire_id',
  'dam_name_text', 'sire_name_text', 'status', 'notes', 'farm_id'];

const bad = (code, msg) => new HttpError(400, code, msg);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));

function ownedCamel(user, camelId) {
  const c = db.one('SELECT * FROM camels WHERE id = ? AND owner_id = ?', String(camelId || ''), user.id);
  if (!c) throw new HttpError(404, 'not_found', 'المطية غير موجودة');
  return c;
}

function validateCamel(user, input, existing = null) {
  const out = {};
  for (const f of CAMEL_FIELDS) if (input[f] !== undefined) out[f] = input[f];
  if (!existing || out.name !== undefined) {
    out.name = str(out.name, 80);
    if (!out.name) throw bad('name_required', 'اسم المطية مطلوب');
  }
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
    const p = ownedCamel(user, out[f]);
    if (p.sex !== sex) throw bad('parent_sex', f === 'dam_id' ? 'الأم يجب أن تكون ناقة' : 'الأب يجب أن يكون فحلاً');
    if (selfId && isDescendant(user, selfId, p.id)) throw bad('pedigree_cycle', 'هذا الربط يُنشئ حلقة في شجرة النسب');
  }
  if (out.farm_id !== undefined) {
    out.farm_id = str(out.farm_id, 64);
    if (out.farm_id && !db.one('SELECT 1 FROM farms WHERE id=? AND owner_id=?', out.farm_id, user.id)) throw bad('invalid_farm', 'العزبة غير موجودة');
  }
  if (out.tag_number) {
    const dup = db.one('SELECT id FROM camels WHERE owner_id=? AND tag_number=? AND id<>?', user.id, out.tag_number, selfId || '');
    if (dup) throw new HttpError(409, 'duplicate_tag', 'رقم الوسم مستخدم لمطية أخرى في حلالك');
  }
  if (out.name) out.name_norm = normalizeAr(out.name);
  return out;
}

// هل candidate من نسل ancestorId؟ (يمنع الحلقات في الشجرة)
function isDescendant(user, ancestorId, candidateId) {
  const r = db.one(`WITH RECURSIVE d(id) AS (
      SELECT id FROM camels WHERE (dam_id = ? OR sire_id = ?) AND owner_id = ?
      UNION SELECT c.id FROM camels c JOIN d ON (c.dam_id = d.id OR c.sire_id = d.id) WHERE c.owner_id = ?)
    SELECT 1 AS x FROM d WHERE id = ? LIMIT 1`, ancestorId, ancestorId, user.id, user.id, candidateId);
  return !!r;
}

function listCamels(user, { q, sex, status, breed, age, limit = 200 } = {}) {
  const where = ['c.owner_id = ?']; const p = [user.id];
  if (q) { where.push('(c.name_norm LIKE ? OR c.tag_number LIKE ?)'); p.push(`%${normalizeAr(q)}%`, `%${String(q).trim()}%`); }
  if (sex && SEX.includes(sex)) { where.push('c.sex = ?'); p.push(sex); }
  if (status && STATUS.includes(status)) { where.push('c.status = ?'); p.push(status); }
  if (breed) { where.push('c.breed = ?'); p.push(String(breed)); }
  p.push(Math.min(Number(limit) || 200, 500));
  return db.all(`SELECT c.id, c.name, c.tag_number, c.sex, c.breed, c.color, c.birth_date, c.status, c.is_demo,
      (SELECT m.id FROM media m WHERE m.camel_id = c.id AND m.kind='photo' ORDER BY m.is_primary DESC, m.created_at LIMIT 1) AS photo_id,
      (SELECT mt.expected_birth_date FROM matings mt WHERE mt.dam_id = c.id AND mt.outcome IN ('pending','confirmed_pregnant') ORDER BY mt.mating_date DESC LIMIT 1) AS expected_birth_date
    FROM camels c WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT ?`, ...p)
    .map(c => ({ ...c, age_name: ageName(c.birth_date, c.sex, todayISO()) }))
    .filter(c => !age || (age === 'unknown' ? !c.age_name : c.age_name && c.age_name.key === age));
}

// توزيع الحلال النشط حسب أسماء الأعمار
function ageBreakdown(user) {
  const rows = db.all("SELECT sex, birth_date FROM camels WHERE owner_id=? AND status NOT IN ('sold','dead','transferred')", user.id);
  const out = AGE_NAMES.map(a => ({ key: a.key, m: a.m, f: a.f, males: 0, females: 0 }));
  let unknown = 0;
  for (const r of rows) {
    const a = ageName(r.birth_date, r.sex, todayISO());
    if (!a) { unknown++; continue; }
    const o = out.find(x => x.key === a.key);
    if (r.sex === 'female') o.females++; else o.males++;
  }
  return { groups: out.filter(o => o.males + o.females), unknown };
}

function findByName(user, name, sex) {
  const n = normalizeAr(name);
  if (!n) return [];
  const p = [user.id, n]; let sx = '';
  if (sex) { sx = ' AND sex = ?'; p.push(sex); }
  const exact = db.all(`SELECT id, name, sex, tag_number, status FROM camels WHERE owner_id=? AND (name_norm = ? )${sx} AND status NOT IN ('sold','dead','transferred')`, ...p);
  if (exact.length) return exact;
  const q = [user.id, n, `%${n}%`]; if (sex) q.push(sex);
  return db.all(`SELECT id, name, sex, tag_number, status FROM camels WHERE owner_id=? AND (tag_number = ? OR name_norm LIKE ?)${sx} AND status NOT IN ('sold','dead','transferred') LIMIT 5`, ...q);
}

function createCamel(ctx, input) {
  const v = validateCamel(ctx.user, input);
  const row = { id: id(), owner_id: ctx.user.id, status: 'active', birth_date_estimated: 0, ...v };
  const cols = Object.keys(row);
  db.run(`INSERT INTO camels(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c] ?? null));
  audit(ctx, 'create', 'camel', row.id, { camelId: row.id, after: v });
  return getCamel(ctx.user, row.id);
}

function updateCamel(ctx, camelId, input) {
  const before = ownedCamel(ctx.user, camelId);
  const v = validateCamel(ctx.user, input, before);
  const cols = Object.keys(v);
  if (!cols.length) return getCamel(ctx.user, camelId);
  db.run(`UPDATE camels SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND owner_id = ?`,
    ...cols.map(c => v[c] ?? null), camelId, ctx.user.id);
  const after = ownedCamel(ctx.user, camelId);
  audit(ctx, 'update', 'camel', camelId, { camelId, before, after });
  return getCamel(ctx.user, camelId);
}

function deleteCamel(ctx, camelId) {
  const c = ownedCamel(ctx.user, camelId);
  db.run('DELETE FROM camels WHERE id = ? AND owner_id = ?', camelId, ctx.user.id);
  audit(ctx, 'delete', 'camel', camelId, { camelId, before: c });
  return { ok: true };
}

function getCamel(user, camelId) {
  const c = ownedCamel(user, camelId);
  const name = i => (i ? db.one('SELECT id, name, tag_number FROM camels WHERE id=? AND owner_id=?', i, user.id) : null);
  return {
    ...c,
    dam: name(c.dam_id), sire: name(c.sire_id),
    farm: c.farm_id ? db.one('SELECT id, name FROM farms WHERE id=?', c.farm_id) : null,
    age_days: c.birth_date ? diffDays(c.birth_date, todayISO()) : null,
    age_name: ageName(c.birth_date, c.sex, todayISO()),
    matings: c.sex === 'female' ? db.all(`SELECT m.*, s.name AS sire_name FROM matings m LEFT JOIN camels s ON s.id = m.sire_id
        WHERE m.dam_id = ? AND m.owner_id = ? ORDER BY m.mating_date DESC`, c.id, user.id) : [],
    sired_matings: c.sex === 'male' ? db.all(`SELECT m.*, d.name AS dam_name FROM matings m JOIN camels d ON d.id = m.dam_id
        WHERE m.sire_id = ? AND m.owner_id = ? ORDER BY m.mating_date DESC LIMIT 50`, c.id, user.id) : [],
    births: db.all(`SELECT b.*, k.name AS calf_name, k.tag_number AS calf_tag FROM births b LEFT JOIN camels k ON k.id = b.calf_id
        WHERE b.dam_id = ? AND b.owner_id = ? ORDER BY b.birth_date DESC`, c.id, user.id),
    offspring: db.all(`SELECT id, name, tag_number, sex, birth_date, status FROM camels WHERE owner_id = ? AND (dam_id = ? OR sire_id = ?) ORDER BY birth_date DESC`, user.id, c.id, c.id),
    events: db.all('SELECT * FROM camel_events WHERE camel_id = ? AND owner_id = ? ORDER BY event_date DESC, created_at DESC', c.id, user.id),
    photos: db.all("SELECT id, caption, is_primary, created_at FROM media WHERE camel_id = ? AND owner_id = ? AND kind='photo' ORDER BY is_primary DESC, created_at", c.id, user.id),
    documents: db.all("SELECT id, caption, mime, created_at FROM media WHERE camel_id = ? AND owner_id = ? AND kind='document' ORDER BY created_at DESC", c.id, user.id),
  };
}

function openMating(user, damId) {
  return db.one(`SELECT * FROM matings WHERE dam_id = ? AND owner_id = ? AND outcome IN ('pending','confirmed_pregnant') ORDER BY mating_date DESC LIMIT 1`, damId, user.id);
}
function lastMating(user, damId) {
  return db.one(`SELECT m.*, s.name AS sire_name FROM matings m LEFT JOIN camels s ON s.id=m.sire_id WHERE m.dam_id=? AND m.owner_id=? ORDER BY m.mating_date DESC LIMIT 1`, damId, user.id);
}
function lastBirth(user, damId) {
  return db.one(`SELECT b.*, k.name AS calf_name, k.tag_number AS calf_tag, k.sex AS calf_sex2, s.name AS sire_name, m.sire_name_text
    FROM births b LEFT JOIN camels k ON k.id=b.calf_id LEFT JOIN matings m ON m.id=b.mating_id LEFT JOIN camels s ON s.id=m.sire_id
    WHERE b.dam_id=? AND b.owner_id=? ORDER BY b.birth_date DESC LIMIT 1`, damId, user.id);
}

function recordMating(ctx, input) {
  const user = ctx.user;
  const dam = ownedCamel(user, input.dam_id);
  if (dam.sex !== 'female') throw bad('dam_not_female', 'التلقيح يُسجل على ناقة');
  if (['sold', 'dead', 'transferred'].includes(dam.status)) throw bad('dam_inactive', 'الناقة ليست ضمن الحلال النشط');
  const date = str(input.mating_date, 10) || todayISO();
  if (!isISODate(date)) throw bad('invalid_date', 'تاريخ التلقيح غير صحيح');
  if (date > addDays(todayISO(), 1)) throw bad('future_date', 'تاريخ التلقيح لا يمكن أن يكون في المستقبل');
  let sireId = str(input.sire_id, 64), sireText = str(input.sire_name_text, 80);
  if (sireId) {
    const s = ownedCamel(user, sireId);
    if (s.sex !== 'male') throw bad('sire_not_male', 'الفحل يجب أن يكون من الفحول');
    sireText = null;
  }
  if (!sireId && !sireText) throw bad('sire_required', 'حدد الفحل (من حلالك أو اكتب اسمه)');
  const gestation = Number(user.gestation_days) || 390;
  const row = { id: id(), owner_id: user.id, dam_id: dam.id, sire_id: sireId, sire_name_text: sireText, mating_date: date,
    expected_birth_date: addDays(date, gestation), notes: str(input.notes, 1000), source: input.source === 'assistant' ? 'assistant' : 'manual' };
  db.tx(() => {
    // تلقيح جديد يُغلق أي تلقيح سابق مفتوح لنفس الناقة (لم يثبت الحمل) — لا يُغلق الحمل المؤكد
    db.run(`UPDATE matings SET outcome='not_pregnant' WHERE dam_id=? AND owner_id=? AND outcome='pending' AND mating_date < ?`, dam.id, user.id, date);
    const cols = Object.keys(row);
    db.run(`INSERT INTO matings(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c] ?? null));
  });
  audit(ctx, 'create', 'mating', row.id, { camelId: dam.id, after: row });
  return db.one('SELECT m.*, s.name AS sire_name FROM matings m LEFT JOIN camels s ON s.id=m.sire_id WHERE m.id=?', row.id);
}

function updateMating(ctx, matingId, input) {
  const m = db.one('SELECT * FROM matings WHERE id=? AND owner_id=?', matingId, ctx.user.id);
  if (!m) throw new HttpError(404, 'not_found', 'سجل التلقيح غير موجود');
  const allowed = ['pending', 'confirmed_pregnant', 'not_pregnant', 'aborted'];
  if (input.outcome !== undefined && !allowed.includes(input.outcome)) throw bad('invalid_outcome', 'نتيجة غير صحيحة');
  const outcome = input.outcome ?? m.outcome;
  const notes = input.notes !== undefined ? str(input.notes, 1000) : m.notes;
  db.run('UPDATE matings SET outcome=?, notes=? WHERE id=?', outcome, notes, m.id);
  if (outcome === 'confirmed_pregnant') db.run("UPDATE camels SET status='pregnant' WHERE id=? AND status IN ('active','nursing')", m.dam_id);
  if (['not_pregnant', 'aborted'].includes(outcome)) db.run("UPDATE camels SET status='active' WHERE id=? AND status='pregnant'", m.dam_id);
  const after = db.one('SELECT * FROM matings WHERE id=?', m.id);
  audit(ctx, 'update', 'mating', m.id, { camelId: m.dam_id, before: m, after });
  return after;
}

function deleteMating(ctx, matingId) {
  const m = db.one('SELECT * FROM matings WHERE id=? AND owner_id=?', matingId, ctx.user.id);
  if (!m) throw new HttpError(404, 'not_found', 'سجل التلقيح غير موجود');
  if (m.outcome === 'born') throw bad('mating_has_birth', 'لا يمكن حذف تلقيح مرتبط بولادة مسجلة');
  db.run('DELETE FROM matings WHERE id=?', m.id);
  audit(ctx, 'delete', 'mating', m.id, { camelId: m.dam_id, before: m });
  return { ok: true };
}

function recordBirth(ctx, input) {
  const user = ctx.user;
  const dam = ownedCamel(user, input.dam_id);
  if (dam.sex !== 'female') throw bad('dam_not_female', 'الولادة تُسجل على ناقة');
  const date = str(input.birth_date, 10) || todayISO();
  if (!isISODate(date) || date > todayISO()) throw bad('invalid_date', 'تاريخ الولادة غير صحيح');
  const outcome = input.outcome === 'stillborn' ? 'stillborn' : 'live';
  const calfSex = input.calf_sex ? (SEX.includes(input.calf_sex) ? input.calf_sex : (() => { throw bad('invalid_sex', 'جنس المولود غير صحيح'); })()) : null;
  let mating = input.mating_id ? db.one('SELECT * FROM matings WHERE id=? AND owner_id=? AND dam_id=?', input.mating_id, user.id, dam.id) : openMating(user, dam.id);
  if (input.mating_id && !mating) throw bad('invalid_mating', 'سجل التلقيح غير مطابق');
  if (mating && date < mating.mating_date) throw bad('birth_before_mating', 'تاريخ الولادة يسبق تاريخ التلقيح');

  const birthId = id();
  let calf = null;
  db.tx(() => {
    if (outcome === 'live') {
      const calfName = str(input.calf_name, 80) || `مولود ${dam.name} ${date}`;
      const tag = str(input.calf_tag, 80);
      if (tag && db.one('SELECT 1 FROM camels WHERE owner_id=? AND tag_number=?', user.id, tag)) throw new HttpError(409, 'duplicate_tag', 'رقم الوسم مستخدم');
      const calfId = id();
      db.run(`INSERT INTO camels(id, owner_id, farm_id, name, name_norm, tag_number, sex, breed, birth_date, dam_id, sire_id, sire_name_text, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')`, calfId, user.id, dam.farm_id, calfName, normalizeAr(calfName), tag, calfSex || 'female',
        dam.breed, date, dam.id, mating ? mating.sire_id : null, mating ? mating.sire_name_text : null);
      calf = calfId;
    }
    db.run('INSERT INTO births(id, owner_id, dam_id, mating_id, calf_id, birth_date, calf_sex, outcome, notes, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
      birthId, user.id, dam.id, mating ? mating.id : null, calf, date, calfSex, outcome, str(input.notes, 1000), input.source === 'assistant' ? 'assistant' : 'manual');
    if (mating) db.run("UPDATE matings SET outcome='born', birth_id=? WHERE id=?", birthId, mating.id);
    db.run("UPDATE camels SET status=? WHERE id=?", outcome === 'live' ? 'nursing' : 'active', dam.id);
  });
  audit(ctx, 'create', 'birth', birthId, { camelId: dam.id, after: { date, outcome, calf_id: calf } });
  if (calf) audit(ctx, 'create', 'camel', calf, { camelId: calf, after: { from_birth: birthId } });
  return { birth: db.one('SELECT * FROM births WHERE id=?', birthId), calf: calf ? getCamel(user, calf) : null };
}

function addEvent(ctx, camelId, input) {
  const c = ownedCamel(ctx.user, camelId);
  if (!EVENT_TYPES.includes(input.type)) throw bad('invalid_type', 'نوع السجل غير صحيح');
  const date = str(input.event_date, 10) || todayISO();
  if (!isISODate(date)) throw bad('invalid_date', 'التاريخ غير صحيح');
  const next = str(input.next_due_date, 10);
  if (next && (!isISODate(next) || next < date)) throw bad('invalid_next_date', 'موعد المتابعة غير صحيح');
  const title = str(input.title, 120);
  if (!title) throw bad('title_required', 'العنوان مطلوب');
  const amount = input.amount != null && input.amount !== '' ? Number(input.amount) : null;
  if (amount != null && (!isFinite(amount) || amount < 0)) throw bad('invalid_amount', 'المبلغ غير صحيح');
  const row = { id: id(), owner_id: ctx.user.id, camel_id: c.id, type: input.type, event_date: date, title, details: str(input.details, 2000),
    next_due_date: next, counterparty: str(input.counterparty, 120), amount, currency: amount != null ? (str(input.currency, 3) || 'QAR') : null };
  const cols = Object.keys(row);
  db.tx(() => {
    db.run(`INSERT INTO camel_events(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(k => row[k] ?? null));
    const statusMap = { sale: 'sold', transfer: 'transferred' };
    if (statusMap[row.type]) db.run('UPDATE camels SET status=? WHERE id=?', statusMap[row.type], c.id);
    if (row.type === 'weaning' && c.dam_id) db.run("UPDATE camels SET status='active' WHERE id=? AND owner_id=? AND status='nursing'", c.dam_id, ctx.user.id);
  });
  audit(ctx, 'create', 'event', row.id, { camelId: c.id, after: row });
  return row;
}

function deleteEvent(ctx, eventId) {
  const e = db.one('SELECT * FROM camel_events WHERE id=? AND owner_id=?', eventId, ctx.user.id);
  if (!e) throw new HttpError(404, 'not_found', 'السجل غير موجود');
  db.run('DELETE FROM camel_events WHERE id=?', e.id);
  audit(ctx, 'delete', 'event', e.id, { camelId: e.camel_id, before: e });
  return { ok: true };
}

function pedigree(user, camelId, depth = 3) {
  ownedCamel(user, camelId);
  const node = (cid, d) => {
    const c = db.one('SELECT id, name, tag_number, sex, breed, color, birth_date, dam_id, sire_id, dam_name_text, sire_name_text, pedigree_verified FROM camels WHERE id=? AND owner_id=?', cid, user.id);
    if (!c) return null;
    const out = { id: c.id, name: c.name, tag_number: c.tag_number, sex: c.sex, breed: c.breed, color: c.color, birth_date: c.birth_date, verified: !!c.pedigree_verified };
    if (d > 0) {
      out.dam = c.dam_id ? node(c.dam_id, d - 1) : (c.dam_name_text ? { name: c.dam_name_text, external: true, sex: 'female' } : null);
      out.sire = c.sire_id ? node(c.sire_id, d - 1) : (c.sire_name_text ? { name: c.sire_name_text, external: true, sex: 'male' } : null);
    }
    return out;
  };
  const tree = node(camelId, Math.min(Math.max(Number(depth) || 3, 1), 5));
  const offspring = db.all(`WITH RECURSIVE d(id, gen) AS (
      SELECT id, 1 FROM camels WHERE (dam_id = ? OR sire_id = ?) AND owner_id = ?
      UNION ALL SELECT c.id, d.gen + 1 FROM camels c JOIN d ON (c.dam_id = d.id OR c.sire_id = d.id) WHERE c.owner_id = ? AND d.gen < 3)
    SELECT c.id, c.name, c.tag_number, c.sex, c.birth_date, c.dam_id, c.sire_id, MIN(d.gen) AS generation
    FROM d JOIN camels c ON c.id = d.id GROUP BY c.id ORDER BY generation, c.birth_date`, camelId, camelId, user.id, user.id);
  return { tree, offspring, notice: 'شجرة النسب مبنية على ما سجله المالك، ولا تُعد موثقة إلا بمستندات أو جهة تحقق معتمدة.' };
}

// المواليد المتوقعة: آخر تلقيح مفتوح لكل ناقة
function expectedBirths(user, from, to) {
  return db.all(`SELECT m.id AS mating_id, m.dam_id, d.name AS dam_name, d.tag_number, m.mating_date, m.expected_birth_date, m.outcome,
      COALESCE(s.name, m.sire_name_text) AS sire_name
    FROM matings m JOIN camels d ON d.id = m.dam_id LEFT JOIN camels s ON s.id = m.sire_id
    WHERE m.owner_id = ? AND m.outcome IN ('pending','confirmed_pregnant') AND d.status NOT IN ('sold','dead','transferred')
      AND m.mating_date = (SELECT MAX(m2.mating_date) FROM matings m2 WHERE m2.dam_id = m.dam_id AND m2.outcome IN ('pending','confirmed_pregnant'))
      AND m.expected_birth_date BETWEEN ? AND ?
    ORDER BY m.expected_birth_date`, user.id, from, to);
}

function calendar(user, from, to) {
  if (!isISODate(from) || !isISODate(to) || diffDays(from, to) > 400 || to < from) throw bad('invalid_range', 'نطاق التاريخ غير صحيح');
  const items = [];
  for (const b of expectedBirths(user, from, to))
    items.push({ date: b.expected_birth_date, kind: 'expected_birth', camel_id: b.dam_id, title: `ولادة متوقعة: ${b.dam_name}`, sub: `تلقيح ${b.mating_date}${b.sire_name ? ' من ' + b.sire_name : ''}`, estimated: true });
  for (const e of db.all(`SELECT e.*, c.name FROM camel_events e JOIN camels c ON c.id=e.camel_id WHERE e.owner_id=? AND e.next_due_date BETWEEN ? AND ?`, user.id, from, to))
    items.push({ date: e.next_due_date, kind: 'follow_up', camel_id: e.camel_id, title: `متابعة: ${e.title}`, sub: e.name });
  for (const b of db.all(`SELECT b.*, d.name FROM births b JOIN camels d ON d.id=b.dam_id WHERE b.owner_id=? AND b.birth_date BETWEEN ? AND ?`, user.id, from, to))
    items.push({ date: b.birth_date, kind: 'birth', camel_id: b.dam_id, title: `ولادة: ${b.name}`, sub: b.outcome === 'live' ? 'مولود حي' : 'نفوق' });
  for (const m of db.all(`SELECT m.*, d.name FROM matings m JOIN camels d ON d.id=m.dam_id WHERE m.owner_id=? AND m.mating_date BETWEEN ? AND ?`, user.id, from, to))
    items.push({ date: m.mating_date, kind: 'mating', camel_id: m.dam_id, title: `تلقيح: ${m.name}`, sub: '' });
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, items, notice: 'مواعيد الولادة تقديرية بناءً على مدة تقديرية من اللقاح إلى الولادة، ولا تغني عن المتابعة البيطرية.' };
}

function alerts(user) {
  const today = todayISO();
  const win = Number(user.birth_alert_days) || 14;
  const out = [];
  for (const b of expectedBirths(user, addDays(today, -60), addDays(today, win))) {
    const d = diffDays(today, b.expected_birth_date);
    out.push({ level: d < 0 ? 'warning' : d <= 3 ? 'urgent' : 'info', kind: d < 0 ? 'overdue_birth' : 'upcoming_birth', camel_id: b.dam_id,
      date: b.expected_birth_date, days: d,
      text: d < 0 ? `تجاوزت ${b.dam_name} موعد الولادة التقديري بـ ${-d} يوم — يُنصح بالمتابعة البيطرية وتحديث السجل`
        : d === 0 ? `موعد ولادة ${b.dam_name} التقديري اليوم` : `${b.dam_name} يُتوقع أن تلد خلال ${d} يوم (${b.expected_birth_date})` });
  }
  for (const e of db.all(`SELECT e.*, c.name FROM camel_events e JOIN camels c ON c.id=e.camel_id WHERE e.owner_id=? AND e.next_due_date BETWEEN ? AND ? AND c.status NOT IN ('sold','dead','transferred')`, user.id, addDays(today, -7), addDays(today, 7))) {
    const d = diffDays(today, e.next_due_date);
    out.push({ level: d < 0 ? 'warning' : 'info', kind: 'follow_up', camel_id: e.camel_id, date: e.next_due_date, days: d, text: `${e.title} — ${e.name} (${d < 0 ? 'متأخر ' + -d + ' يوم' : d === 0 ? 'اليوم' : 'بعد ' + d + ' يوم'})` });
  }
  // نوق ملقحة منذ أكثر من 90 يوماً دون تأكيد الحمل
  for (const m of db.all(`SELECT m.*, d.name FROM matings m JOIN camels d ON d.id=m.dam_id WHERE m.owner_id=? AND m.outcome='pending' AND m.mating_date <= ? AND d.status NOT IN ('sold','dead','transferred')`, user.id, addDays(today, -90)))
    out.push({ level: 'info', kind: 'confirm_pregnancy', camel_id: m.dam_id, date: m.mating_date, text: `لم يُسجل هل لقحت ${m.name} أو لا منذ تلقيح ${m.mating_date}` });
  const rank = { urgent: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.date || '').localeCompare(b.date || ''));
}

function dashboard(user) {
  const c = k => db.one(k, user.id).n;
  const today = todayISO();
  return {
    total: c("SELECT COUNT(*) n FROM camels WHERE owner_id=? AND status NOT IN ('sold','dead','transferred')"),
    females: c("SELECT COUNT(*) n FROM camels WHERE owner_id=? AND sex='female' AND status NOT IN ('sold','dead','transferred')"),
    males: c("SELECT COUNT(*) n FROM camels WHERE owner_id=? AND sex='male' AND status NOT IN ('sold','dead','transferred')"),
    pregnant: expectedBirths(user, '0000-01-01', '9999-12-31').length,
    births_this_year: db.one("SELECT COUNT(*) n FROM births WHERE owner_id=? AND birth_date >= ?", user.id, today.slice(0, 4) + '-01-01').n,
    due_30: expectedBirths(user, today, addDays(today, 30)).length,
    upcoming: expectedBirths(user, addDays(today, -30), addDays(today, 120)).slice(0, 8),
    alerts: alerts(user).slice(0, 8),
    ages: ageBreakdown(user),
    recent: db.all(`SELECT a.action, a.entity, a.created_at, c.name AS camel_name, a.camel_id FROM audit_log a LEFT JOIN camels c ON c.id=a.camel_id
      WHERE a.actor_id=? ORDER BY a.id DESC LIMIT 8`, user.id),
  };
}

function history(user, camelId) {
  ownedCamel(user, camelId);
  return db.all('SELECT action, entity, entity_id, diff_json, created_at FROM audit_log WHERE camel_id=? AND actor_id=? ORDER BY id DESC LIMIT 200', camelId, user.id)
    .map(r => ({ ...r, diff: r.diff_json ? JSON.parse(r.diff_json) : null, diff_json: undefined }));
}

module.exports = { listCamels, findByName, createCamel, updateCamel, deleteCamel, getCamel, ownedCamel, recordMating, updateMating, deleteMating,
  recordBirth, addEvent, ageBreakdown, deleteEvent, pedigree, calendar, alerts, dashboard, history, expectedBirths, lastMating, lastBirth, openMating, EVENT_TYPES };
