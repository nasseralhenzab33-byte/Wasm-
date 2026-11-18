'use strict';
// المرحلة 4: مجتمع أهل الإبل + المزاين والنتائج
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, isISODate } = require('../lib/util');
const { notify } = require('../lib/realtime');
const access = require('../lib/access');
const herd = require('./herd.service');

const bad = (c, m) => new HttpError(400, c, m);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const COUNTRIES = ['SA', 'QA', 'AE', 'KW', 'BH', 'OM'];
const CATS = { general: 'عام', question: 'سؤال', experience: 'تجربة', news: 'خبر' };
const userName = uid => (db.one('SELECT display_name FROM users WHERE id=?', uid) || {}).display_name || 'مستخدم';

function listPosts(ctx, q) {
  const cat = q.get('category');
  const rows = db.all(`SELECT * FROM posts WHERE status='visible' ${CATS[cat] ? 'AND category=?' : ''} ORDER BY created_at DESC LIMIT 50`, ...(CATS[cat] ? [cat] : []));
  return { posts: rows.map(p => postOut(p, ctx.user)), categories: CATS };
}
function postOut(p, viewer, full = false) {
  const out = { id: p.id, category: p.category, category_ar: CATS[p.category], body: p.body, author: { id: p.author_id, name: userName(p.author_id) }, like_count: p.like_count, comment_count: p.comment_count,
    liked: viewer ? !!db.one('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?', p.id, viewer.id) : false, mine: !!viewer && viewer.id === p.author_id, created_at: p.created_at, is_demo: !!p.is_demo };
  if (full) out.comments = db.all("SELECT * FROM post_comments WHERE post_id=? AND status='visible' ORDER BY created_at", p.id).map(c => ({ id: c.id, body: c.body, author: { id: c.author_id, name: userName(c.author_id) }, mine: !!viewer && viewer.id === c.author_id, created_at: c.created_at }));
  return out;
}
function getPost(ctx, pid) {
  const p = db.one("SELECT * FROM posts WHERE id=? AND status='visible'", pid);
  if (!p) throw new HttpError(404, 'not_found', 'المنشور غير موجود');
  return postOut(p, ctx.user, true);
}
function createPost(ctx, input) {
  access.requireActive(ctx);
  const body = str(input.body, 3000); if (!body || body.length < 3) throw bad('body_required', 'اكتب المنشور');
  const recent = db.one("SELECT COUNT(*) n FROM posts WHERE author_id=? AND created_at > ?", ctx.user.id, new Date(Date.now() - 3600000).toISOString()).n;
  if (recent >= 10) throw new HttpError(429, 'rate_limited', 'وصلت للحد الأقصى من المنشورات في الساعة');
  const pid = id();
  db.run('INSERT INTO posts(id, author_id, category, body) VALUES (?,?,?,?)', pid, ctx.user.id, CATS[input.category] ? input.category : 'general', body);
  audit(ctx, 'create', 'post', pid);
  return getPost(ctx, pid);
}
function deletePost(ctx, pid) {
  const p = db.one('SELECT * FROM posts WHERE id=?', pid);
  if (!p || (p.author_id !== ctx.user.id && !access.isAdmin(ctx.user))) throw new HttpError(404, 'not_found', 'المنشور غير موجود');
  db.run("UPDATE posts SET status='removed' WHERE id=?", pid);
  audit(ctx, 'delete', 'post', pid);
  return { ok: true };
}
function toggleLike(ctx, pid) {
  getPost(ctx, pid);
  const r = db.run('DELETE FROM post_likes WHERE post_id=? AND user_id=?', pid, ctx.user.id);
  if (!r.changes) db.run('INSERT INTO post_likes(post_id, user_id) VALUES (?,?)', pid, ctx.user.id);
  db.run('UPDATE posts SET like_count=(SELECT COUNT(*) FROM post_likes WHERE post_id=?) WHERE id=?', pid, pid);
  return { liked: !r.changes };
}
function addComment(ctx, pid, body) {
  access.requireActive(ctx);
  const p = db.one("SELECT * FROM posts WHERE id=? AND status='visible'", pid); if (!p) throw new HttpError(404, 'not_found', 'المنشور غير موجود');
  const text = str(body, 1500); if (!text) throw bad('body_required', 'اكتب التعليق');
  db.run('INSERT INTO post_comments(id, post_id, author_id, body) VALUES (?,?,?,?)', id(), pid, ctx.user.id, text);
  db.run("UPDATE posts SET comment_count=(SELECT COUNT(*) FROM post_comments WHERE post_id=? AND status='visible') WHERE id=?", pid, pid);
  if (p.author_id !== ctx.user.id) notify(p.author_id, { kind: 'comment', title: `${userName(ctx.user.id)} علّق على منشورك`, body: text.slice(0, 80), link: `#/community/${pid}`, dedupeKey: `cm:${pid}:${Math.floor(Date.now() / 600000)}` });
  return getPost(ctx, pid);
}

// ===================== المزاين والنتائج =====================
function listFestivals() {
  return { festivals: db.all('SELECT f.*, (SELECT COUNT(*) FROM festival_results r WHERE r.festival_id=f.id) AS results FROM festivals f ORDER BY starts_on DESC LIMIT 100') };
}
function getFestival(ctx, fid) {
  const f = db.one('SELECT * FROM festivals WHERE id=?', fid); if (!f) throw new HttpError(404, 'not_found', 'المهرجان غير موجود');
  const results = db.all('SELECT * FROM festival_results WHERE festival_id=? ORDER BY category, rank', fid)
    .map(r => ({ id: r.id, category: r.category, rank: r.rank, camel_name: r.camel_name, owner_display: r.owner_display, linked: !!r.camel_id, mine: !!ctx.user && r.linked_by === ctx.user.id }));
  return { festival: f, results };
}
function createFestival(ctx, input) {
  const scope = access.requireAdmin(ctx);
  const country = COUNTRIES.includes(input.country_code) ? input.country_code : null; if (!country) throw bad('invalid_country', 'اختر الدولة');
  access.inScope(scope, country);
  const name = str(input.name_ar, 120); if (!name) throw bad('name_required', 'اسم المهرجان مطلوب');
  if (!isISODate(input.starts_on) || !isISODate(input.ends_on) || input.ends_on < input.starts_on) throw bad('invalid_dates', 'التواريخ غير صحيحة');
  const fid = id();
  db.run('INSERT INTO festivals(id, name_ar, country_code, location, starts_on, ends_on, description) VALUES (?,?,?,?,?,?,?)', fid, name, country, str(input.location, 120), input.starts_on, input.ends_on, str(input.description, 2000));
  audit(ctx, 'create', 'festival', fid);
  return { id: fid };
}
function addResult(ctx, fid, input) {
  const scope = access.requireAdmin(ctx);
  const f = db.one('SELECT * FROM festivals WHERE id=?', fid); if (!f) throw new HttpError(404, 'not_found', 'المهرجان غير موجود');
  access.inScope(scope, f.country_code);
  const cat = str(input.category, 80), name = str(input.camel_name, 80), rank = parseInt(input.rank, 10);
  if (!cat || !name || !(rank > 0)) throw bad('invalid_result', 'الفئة والمركز واسم المطية مطلوبة');
  db.run('INSERT INTO festival_results(id, festival_id, category, rank, camel_name, owner_display) VALUES (?,?,?,?,?,?)', id(), fid, cat, rank, name, str(input.owner_display, 80));
  return getFestival(ctx, fid);
}
// المالك يربط نتيجة بمطية من حلاله → تُضاف كإنجاز في ملفها
function linkResult(ctx, rid, camelId) {
  const r = db.one('SELECT r.*, f.name_ar, f.ends_on FROM festival_results r JOIN festivals f ON f.id=r.festival_id WHERE r.id=?', rid);
  if (!r) throw new HttpError(404, 'not_found', 'النتيجة غير موجودة');
  if (r.camel_id) throw new HttpError(409, 'already_linked', 'هذه النتيجة مربوطة بمطية مسبقاً');
  const camel = herd.ownedCamel(ctx.user, camelId);
  db.run('UPDATE festival_results SET camel_id=?, linked_by=? WHERE id=?', camel.id, ctx.user.id, rid);
  herd.addEvent(ctx, camel.id, { type: 'achievement', title: `المركز ${r.rank} — ${r.category}`, details: `${r.name_ar} (ربطه المالك؛ يُراجع عند الحاجة)`, event_date: r.ends_on });
  return { ok: true };
}

module.exports = { listPosts, getPost, createPost, deletePost, toggleLike, addComment, listFestivals, getFestival, createFestival, addResult, linkResult, CATS };
