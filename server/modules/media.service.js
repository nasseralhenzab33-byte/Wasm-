'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, token, sha256, addDays, todayISO } = require('../lib/util');
const herd = require('./herd.service');

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;

// التحقق من نوع الملف عبر البايتات الأولى وليس عبر الامتداد أو ما يرسله المتصفح
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

function upload(ctx, camelId, { data_base64, caption, kind = 'photo', is_primary }) {
  const camel = herd.ownedCamel(ctx.user, camelId);
  if (typeof data_base64 !== 'string' || !data_base64) throw new HttpError(400, 'file_required', 'الملف مطلوب');
  const buf = Buffer.from(data_base64.replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length || buf.length > MAX_BYTES) throw new HttpError(413, 'file_too_large', 'الحد الأقصى للملف 5 ميغابايت');
  const mime = sniff(buf);
  if (!mime) throw new HttpError(415, 'unsupported_file', 'الأنواع المسموحة: JPG, PNG, WEBP, PDF');
  if (kind === 'photo' && mime === 'application/pdf') throw new HttpError(415, 'unsupported_file', 'الصورة يجب أن تكون JPG أو PNG أو WEBP');
  const k = kind === 'document' ? 'document' : 'photo';
  const hash = sha256(buf);
  // اكتشاف الصور المكررة: داخل حلال المستخدم (تفاصيل) وعلى مستوى المنصة (عدد فقط، دون كشف هوية المالك)
  const dupOwn = db.all('SELECT m.id, m.camel_id, c.name FROM media m JOIN camels c ON c.id=m.camel_id WHERE m.sha256=? AND m.owner_id=?', hash, ctx.user.id);
  const dupOthers = db.one('SELECT COUNT(*) n FROM media WHERE sha256=? AND owner_id<>?', hash, ctx.user.id).n;
  const key = `${ctx.user.id}/${id()}`;
  const file = path.join(UPLOAD_DIR(), key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  const mid = id();
  db.tx(() => {
    if (is_primary) db.run('UPDATE media SET is_primary=0 WHERE camel_id=?', camel.id);
    const first = !db.one("SELECT 1 FROM media WHERE camel_id=? AND kind='photo'", camel.id);
    db.run('INSERT INTO media(id, owner_id, camel_id, kind, storage_key, mime, bytes, sha256, caption, is_primary) VALUES (?,?,?,?,?,?,?,?,?,?)',
      mid, ctx.user.id, camel.id, k, key, mime, buf.length, hash, caption ? String(caption).slice(0, 200) : null, (is_primary || (first && k === 'photo')) ? 1 : 0);
  });
  audit(ctx, 'upload', 'media', mid, { camelId: camel.id, after: { kind: k, mime, bytes: buf.length } });
  return { id: mid, kind: k, mime, duplicate_in_my_herd: dupOwn, duplicate_elsewhere: dupOthers > 0 };
}

function readOwned(user, mediaId) {
  const m = db.one('SELECT * FROM media WHERE id=? AND owner_id=?', mediaId, user.id);
  if (!m) throw new HttpError(404, 'not_found', 'الملف غير موجود');
  return { meta: m, buf: fs.readFileSync(path.join(UPLOAD_DIR(), m.storage_key)) };
}

function remove(ctx, mediaId) {
  const m = db.one('SELECT * FROM media WHERE id=? AND owner_id=?', mediaId, ctx.user.id);
  if (!m) throw new HttpError(404, 'not_found', 'الملف غير موجود');
  db.run('DELETE FROM media WHERE id=?', m.id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR(), m.storage_key)); } catch { /* already gone */ }
  audit(ctx, 'delete', 'media', m.id, { camelId: m.camel_id });
  return { ok: true };
}

// ===== روابط المشاركة محدودة الصلاحية =====
function createShare(ctx, camelId, { scope = 'basic', days = 7 }) {
  const camel = herd.ownedCamel(ctx.user, camelId);
  if (!['basic', 'pedigree', 'full'].includes(scope)) throw new HttpError(400, 'invalid_scope', 'نطاق المشاركة غير صحيح');
  const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
  const t = token(24);
  const sid = id();
  const expires = new Date(Date.now() + d * 86400000).toISOString();
  db.run('INSERT INTO share_links(id, owner_id, camel_id, token_hash, scope, expires_at) VALUES (?,?,?,?,?,?)', sid, ctx.user.id, camel.id, sha256(t), scope, expires);
  audit(ctx, 'share', 'camel', camel.id, { camelId: camel.id, after: { scope, expires } });
  return { id: sid, token: t, url: `/s/${t}`, scope, expires_at: expires };
}

function listShares(user, camelId) {
  herd.ownedCamel(user, camelId);
  return db.all('SELECT id, scope, expires_at, revoked_at, view_count, created_at FROM share_links WHERE camel_id=? AND owner_id=? ORDER BY created_at DESC', camelId, user.id);
}

function revokeShare(ctx, shareId) {
  const s = db.one('SELECT * FROM share_links WHERE id=? AND owner_id=?', shareId, ctx.user.id);
  if (!s) throw new HttpError(404, 'not_found', 'الرابط غير موجود');
  db.run("UPDATE share_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", s.id);
  audit(ctx, 'revoke_share', 'camel', s.camel_id, { camelId: s.camel_id });
  return { ok: true };
}

function resolveShare(t) {
  const s = db.one('SELECT * FROM share_links WHERE token_hash=?', sha256(String(t || '')));
  if (!s || s.revoked_at || s.expires_at < new Date().toISOString()) throw new HttpError(404, 'share_invalid', 'الرابط غير صالح أو منتهي');
  return s;
}

function publicView(t) {
  const s = resolveShare(t);
  db.run('UPDATE share_links SET view_count = view_count + 1 WHERE id=?', s.id);
  const owner = { id: s.owner_id };
  const c = herd.getCamel(owner, s.camel_id);
  const out = { scope: s.scope, expires_at: s.expires_at,
    camel: { name: c.name, tag_number: c.tag_number, sex: c.sex, breed: c.breed, color: c.color, birth_date: c.birth_date, birth_date_estimated: c.birth_date_estimated, status: ['sold','dead','transferred'].includes(c.status) ? c.status : 'active', pedigree_verified: !!c.pedigree_verified },
    photos: c.photos.map(p => ({ id: p.id, caption: p.caption })),
    notice: 'بيانات مقدمة من المالك. النسب والملكية غير موثقة ما لم يُذكر خلاف ذلك.' };
  if (s.scope !== 'basic') {
    out.pedigree = herd.pedigree(owner, s.camel_id, 3).tree;
    out.offspring = c.offspring.map(o => ({ name: o.name, sex: o.sex, birth_date: o.birth_date }));
  }
  if (s.scope === 'full') {
    out.births = c.births.map(b => ({ birth_date: b.birth_date, calf_name: b.calf_name, calf_sex: b.calf_sex, outcome: b.outcome }));
    out.events = c.events.filter(e => ['vaccination', 'checkup', 'achievement', 'vet_visit'].includes(e.type)).map(e => ({ type: e.type, event_date: e.event_date, title: e.title }));
  }
  // لا نكشف أبداً: المالك، العزبة/الموقع، الأسعار، الملاحظات الخاصة، المستندات
  return out;
}

function sharedPhoto(t, mediaId) {
  const s = resolveShare(t);
  const m = db.one("SELECT * FROM media WHERE id=? AND camel_id=? AND kind='photo'", mediaId, s.camel_id);
  if (!m) throw new HttpError(404, 'not_found', 'غير موجود');
  return { meta: m, buf: fs.readFileSync(path.join(UPLOAD_DIR(), m.storage_key)) };
}

module.exports = { upload, readOwned, remove, createShare, listShares, revokeShare, publicView, sharedPhoto, sniff };
