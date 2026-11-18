'use strict';
// المرحلة 2: السوق — الإعلانات، البحث، المفضلة، البلاغات، العروض والتفاوض، الرسائل، التوصيات، والتثمين الاسترشادي (م4)
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, sha256, todayISO, addDays, normalizeAr } = require('../lib/util');
const { notify, toUser } = require('../lib/realtime');
const access = require('../lib/access');
const { ageName, AGE_NAMES } = require('../lib/ageNames');
const herd = require('./herd.service');
const media = require('./media.service');

const COUNTRIES = ['SA', 'QA', 'AE', 'KW', 'BH', 'OM'];
const CURRENCIES = ['QAR', 'SAR', 'AED', 'KWD', 'BHD', 'OMR'];
const PUBLIC_STATUSES = ['active', 'reserved', 'sold'];
const bad = (c, m) => new HttpError(400, c, m);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const num = v => (v == null || v === '' ? null : Number(v));
const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');
const userName = uid => (db.one('SELECT display_name FROM users WHERE id=?', uid) || {}).display_name || 'مستخدم';

function searchNorm(l) { return normalizeAr([l.title, l.camel_name, l.breed, l.color, l.city, l.description].filter(Boolean).join(' ')); }

function validateListing(input, existing = null) {
  const o = {};
  const set = (k, v) => { if (input[k] !== undefined) o[k] = v(input[k]); };
  set('title', v => str(v, 120)); set('camel_name', v => str(v, 80)); set('breed', v => str(v, 60)); set('color', v => str(v, 40));
  set('city', v => str(v, 60)); set('dam_name', v => str(v, 80)); set('sire_name', v => str(v, 80));
  set('description', v => str(v, 4000)); set('contact_phone', v => str(v, 20));
  set('sex', v => (v ? (['female', 'male'].includes(v) ? v : (() => { throw bad('invalid_sex', 'الجنس غير صحيح'); })()) : null));
  set('age_years', v => { const n = num(v); if (n != null && !(n >= 0 && n <= 40)) throw bad('invalid_age', 'العمر غير صحيح'); return n; });
  set('price', v => { const n = num(v); if (n != null && !(n > 0 && n < 1e9)) throw bad('invalid_price', 'السعر غير صحيح'); return n; });
  set('currency', v => (CURRENCIES.includes(v) ? v : (() => { throw bad('invalid_currency', 'العملة غير صحيحة'); })()));
  set('country_code', v => (COUNTRIES.includes(v) ? v : (() => { throw bad('invalid_country', 'الدولة غير صحيحة'); })()));
  set('negotiable', v => (v ? 1 : 0));
  set('contact_mode', v => (['in_app', 'phone', 'whatsapp'].includes(v) ? v : 'in_app'));
  set('description_ai', v => (v ? 1 : 0));
  if (!existing) {
    if (!o.title) throw bad('title_required', 'عنوان الإعلان مطلوب');
    if (!o.description) throw bad('description_required', 'وصف الإعلان مطلوب');
    if (!o.country_code) throw bad('country_required', 'الدولة مطلوبة');
    if (!o.currency) o.currency = access.CURRENCY_OF[o.country_code];
  } else {
    if (o.title === null) throw bad('title_required', 'عنوان الإعلان مطلوب');
    if (o.description === null) throw bad('description_required', 'وصف الإعلان مطلوب');
  }
  if ((o.contact_mode === 'phone' || o.contact_mode === 'whatsapp') && !(o.contact_phone || (existing && existing.contact_phone))) throw bad('phone_required', 'أضف رقم التواصل');
  return o;
}

function createListing(ctx, input) {
  access.requireActive(ctx);
  const v = validateListing(input);
  let camel = null;
  if (input.camel_id) {
    camel = herd.ownedCamel(ctx.user, input.camel_id);
    if (['sold', 'dead', 'transferred'].includes(camel.status)) throw bad('camel_inactive', 'هذه المطية ليست ضمن حلالك النشط');
    const ag = camel.birth_date ? Math.round((Date.now() - new Date(camel.birth_date)) / (365.25 * 86400000) * 10) / 10 : null;
    v.camel_name = v.camel_name ?? camel.name; v.breed = v.breed ?? camel.breed; v.color = v.color ?? camel.color; v.sex = v.sex ?? camel.sex;
    v.age_years = v.age_years ?? ag;
    const dam = camel.dam_id ? db.one('SELECT name FROM camels WHERE id=?', camel.dam_id) : null, sire = camel.sire_id ? db.one('SELECT name FROM camels WHERE id=?', camel.sire_id) : null;
    v.dam_name = v.dam_name ?? (dam ? dam.name : camel.dam_name_text); v.sire_name = v.sire_name ?? (sire ? sire.name : camel.sire_name_text);
    v.pedigree_documented = camel.pedigree_verified ? 1 : 0;
  }
  let broker = null;
  if (input.broker_id) {
    broker = db.one('SELECT * FROM broker_profiles WHERE user_id=?', input.broker_id);
    if (!broker) throw bad('invalid_broker', 'الوسيط غير موجود');
  }
  const auto = access.setting('listing_auto_approve', '0') === '1' || access.isAdmin(ctx.user);
  const row = { id: id(), seller_id: ctx.user.id, camel_id: camel ? camel.id : null, broker_id: broker ? broker.user_id : null, ...v,
    status: auto ? 'active' : 'pending_review', published_at: auto ? new Date().toISOString() : null, expires_at: auto ? addDays(todayISO(), 60) : null };
  row.search_norm = searchNorm(row);
  const cols = Object.keys(row);
  db.run(`INSERT INTO listings(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c] ?? null));
  // نسخ صور المطية المختارة إلى الإعلان (نسخة مستقلة؛ صور الحلال تبقى خاصة)
  if (camel && input.include_photos !== false) {
    for (const m of db.all("SELECT * FROM media WHERE camel_id=? AND owner_id=? AND kind='photo' ORDER BY is_primary DESC, created_at LIMIT 8", camel.id, ctx.user.id)) {
      const key = `${ctx.user.id}/${id()}`;
      try { fs.mkdirSync(path.dirname(path.join(UPLOAD_DIR(), key)), { recursive: true }); fs.copyFileSync(path.join(UPLOAD_DIR(), m.storage_key), path.join(UPLOAD_DIR(), key)); }
      catch { continue; }
      db.run('INSERT INTO media(id, owner_id, listing_id, kind, storage_key, mime, bytes, sha256, caption, is_primary) VALUES (?,?,?,?,?,?,?,?,?,?)', id(), ctx.user.id, row.id, 'photo', key, m.mime, m.bytes, m.sha256, m.caption, m.is_primary);
    }
    flagDuplicatePhotos(row.id);
  }
  audit(ctx, 'create', 'listing', row.id, { after: { title: row.title, status: row.status } });
  if (!auto) notifyAdmins(row.country_code, { kind: 'review_listing', title: 'إعلان جديد بانتظار المراجعة', body: row.title, link: '#/admin/listings' });
  return getListing(ctx, row.id);
}

function notifyAdmins(country, n) {
  for (const a of db.all("SELECT id FROM users WHERE role='super_admin' OR (role='country_admin' AND admin_country_code=?)", country)) notify(a.id, n);
}

// اكتشاف الصور المكررة على مستوى المنصة → تنبيه للمراجعة البشرية (لا حذف تلقائي)
function flagDuplicatePhotos(listingId) {
  const l = db.one('SELECT * FROM listings WHERE id=?', listingId); if (!l) return;
  const dups = db.all(`SELECT DISTINCT m2.listing_id FROM media m1 JOIN media m2 ON m2.sha256 = m1.sha256 AND m2.listing_id IS NOT NULL AND m2.listing_id <> m1.listing_id
    JOIN listings l2 ON l2.id = m2.listing_id AND l2.seller_id <> ? WHERE m1.listing_id = ?`, l.seller_id, listingId);
  if (dups.length) {
    db.run("UPDATE listings SET flags='duplicate_photo' WHERE id=?", listingId);
    db.run('INSERT INTO ai_alerts(id, kind, target_type, target_id, country_code, severity, reason, evidence_json) VALUES (?,?,?,?,?,?,?,?)',
      id(), 'duplicate_photo', 'listing', listingId, l.country_code, 'medium', 'صورة في الإعلان مطابقة لصورة في إعلان لبائع آخر', JSON.stringify({ other_listings: dups.map(d => d.listing_id) }));
  }
}

function listingOut(l, viewer, opts = {}) {
  const photos = db.all("SELECT id, caption, is_primary FROM media WHERE listing_id=? AND kind='photo' ORDER BY is_primary DESC, created_at", l.id);
  const isOwner = viewer && viewer.id === l.seller_id;
  const out = { id: l.id, title: l.title, camel_name: l.camel_name, breed: l.breed, color: l.color, sex: l.sex, age_years: l.age_years,
    age_name: l.age_years != null ? ageNameFromYears(l.age_years, l.sex) : null, country_code: l.country_code, city: l.city,
    price: l.price, currency: l.currency, negotiable: !!l.negotiable, status: l.status, views: l.views, created_at: l.created_at, published_at: l.published_at,
    photo_id: photos[0] ? photos[0].id : null, is_demo: !!l.is_demo, promoted: l.promoted_until && l.promoted_until > new Date().toISOString(), description_ai: !!l.description_ai };
  if (opts.full) {
    Object.assign(out, { description: l.description, dam_name: l.dam_name, sire_name: l.sire_name, pedigree_documented: !!l.pedigree_documented, photos,
      seller: { id: l.seller_id, name: userName(l.seller_id), member_since: (db.one('SELECT created_at FROM users WHERE id=?', l.seller_id) || {}).created_at },
      broker: l.broker_id ? db.one('SELECT user_id AS id, display_name, commission_percent, verified FROM broker_profiles WHERE user_id=?', l.broker_id) : null,
      contact_mode: l.contact_mode, expires_at: l.expires_at, camel_id: isOwner ? l.camel_id : undefined,
      contact_phone: viewer && l.contact_mode !== 'in_app' ? l.contact_phone : null,
      favorite: viewer ? !!db.one('SELECT 1 FROM listing_favorites WHERE user_id=? AND listing_id=?', viewer.id, l.id) : false,
      is_owner: !!isOwner, reject_reason: isOwner ? l.reject_reason : undefined, flags: isOwner || access.isAdmin(viewer) ? l.flags : undefined,
      notice: 'المعلومات مقدمة من البائع. النسب والعمر غير موثقة ما لم يُذكر "موثق". افحص المطية بنفسك قبل الشراء.' });
  }
  return out;
}
function ageNameFromYears(y, sex) {
  const months = Math.floor(Number(y) * 12); let row = AGE_NAMES[0];
  for (const r of AGE_NAMES) if (months >= r.fromMonths) row = r;
  return { key: row.key, name: sex === 'female' ? row.f : row.m };
}

function getListing(ctx, lid, { countView = false } = {}) {
  const l = db.one('SELECT * FROM listings WHERE id=?', lid);
  const viewer = ctx.user;
  const canSee = l && (PUBLIC_STATUSES.includes(l.status) || (viewer && (viewer.id === l.seller_id || access.isAdmin(viewer))));
  if (!canSee) throw new HttpError(404, 'not_found', 'الإعلان غير موجود');
  if (countView && (!viewer || viewer.id !== l.seller_id)) db.run('UPDATE listings SET views = views + 1 WHERE id=?', lid);
  return listingOut(l, viewer, { full: true });
}

function updateListing(ctx, lid, input) {
  const l = db.one('SELECT * FROM listings WHERE id=? AND seller_id=?', lid, ctx.user.id);
  if (!l) throw new HttpError(404, 'not_found', 'الإعلان غير موجود');
  if (['removed', 'sold'].includes(l.status)) throw bad('listing_closed', 'لا يمكن تعديل إعلان مغلق');
  const v = validateListing(input, l);
  if (input.status !== undefined) {
    const allowed = { active: ['reserved', 'removed'], reserved: ['active', 'removed'], pending_review: ['removed'], rejected: ['pending_review', 'removed'], expired: ['pending_review', 'removed'], draft: ['pending_review', 'removed'] };
    if (!(allowed[l.status] || []).includes(input.status)) throw bad('invalid_status', 'لا يمكن تغيير الحالة بهذا الشكل');
    v.status = input.status;
  }
  const after = { ...l, ...v }; v.search_norm = searchNorm(after);
  const cols = Object.keys(v);
  db.run(`UPDATE listings SET ${cols.map(c => c + '=?').join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, ...cols.map(c => v[c] ?? null), lid);
  audit(ctx, 'update', 'listing', lid, { before: { status: l.status, price: l.price }, after: { status: after.status, price: after.price } });
  return getListing(ctx, lid);
}

function browse(ctx, q) {
  const where = ["l.status IN ('active','reserved')"], p = [];
  const g = k => (q.get ? q.get(k) : q[k]);
  if (g('country') && COUNTRIES.includes(g('country'))) { where.push('l.country_code=?'); p.push(g('country')); }
  if (g('breed')) { where.push('l.breed=?'); p.push(g('breed')); }
  if (['female', 'male'].includes(g('sex'))) { where.push('l.sex=?'); p.push(g('sex')); }
  if (g('min_price')) { where.push('l.price >= ?'); p.push(Number(g('min_price'))); }
  if (g('max_price')) { where.push('l.price <= ?'); p.push(Number(g('max_price'))); }
  if (g('min_age')) { where.push('l.age_years >= ?'); p.push(Number(g('min_age'))); }
  if (g('max_age')) { where.push('l.age_years <= ?'); p.push(Number(g('max_age'))); }
  if (g('age')) { const a = AGE_NAMES.findIndex(x => x.key === g('age')); if (a >= 0) { where.push('l.age_years >= ? AND l.age_years < ?'); p.push(AGE_NAMES[a].fromMonths / 12, a + 1 < AGE_NAMES.length ? AGE_NAMES[a + 1].fromMonths / 12 : 99); } }
  if (g('q')) { where.push('l.search_norm LIKE ?'); p.push('%' + normalizeAr(g('q')) + '%'); }
  if (g('seller') === 'me' && ctx.user) { where.length = 0; where.push('l.seller_id=?'); p.length = 0; p.push(ctx.user.id); }
  if (g('favorites') === '1' && ctx.user) { where.push('l.id IN (SELECT listing_id FROM listing_favorites WHERE user_id=?)'); p.push(ctx.user.id); }
  const sort = { price_asc: 'l.price IS NULL, l.price ASC', price_desc: 'l.price DESC', newest: 'l.created_at DESC' }[g('sort')] || 'l.created_at DESC';
  const limit = Math.min(Number(g('limit')) || 48, 100), offset = Math.max(Number(g('offset')) || 0, 0);
  const rows = db.all(`SELECT l.* FROM listings l WHERE ${where.join(' AND ')} ORDER BY (l.promoted_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')) DESC, ${sort} LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = db.one(`SELECT COUNT(*) n FROM listings l WHERE ${where.join(' AND ')}`, ...p).n;
  if (ctx.user && (g('breed') || g('sex') || g('country')) && g('seller') !== 'me') db.run('INSERT INTO search_log(user_id, breed, sex, country_code) VALUES (?,?,?,?)', ctx.user.id, g('breed') || null, g('sex') || null, g('country') || null);
  return { listings: rows.map(l => listingOut(l, ctx.user)), total, breeds: db.all("SELECT breed, COUNT(*) n FROM listings WHERE status='active' AND breed IS NOT NULL GROUP BY breed ORDER BY n DESC").map(r => r.breed) };
}

function toggleFavorite(ctx, lid) {
  getListing(ctx, lid);
  const r = db.run('DELETE FROM listing_favorites WHERE user_id=? AND listing_id=?', ctx.user.id, lid);
  if (!r.changes) db.run('INSERT INTO listing_favorites(user_id, listing_id) VALUES (?,?)', ctx.user.id, lid);
  return { favorite: !r.changes };
}

function compare(ctx, ids) {
  const list = String(ids || '').split(',').filter(Boolean).slice(0, 4).map(x => getListing(ctx, x));
  if (list.length < 2) throw bad('need_two', 'اختر إعلانين على الأقل للمقارنة');
  const rows = [['السعر', l => (l.price ? `${l.price.toLocaleString('en')} ${l.currency}` : 'على السوم')], ['الفئة', l => l.breed || '—'], ['الجنس', l => (l.sex === 'female' ? 'ناقة' : l.sex === 'male' ? 'فحل' : '—')],
    ['العمر', l => (l.age_years != null ? `${l.age_name.name} (${l.age_years} سنة)` : '—')], ['اللون', l => l.color || '—'], ['الدولة', l => l.country_code + (l.city ? ' — ' + l.city : '')],
    ['الأم / الأب', l => [l.dam_name, l.sire_name].filter(Boolean).join(' / ') || '—'], ['النسب موثق', l => (l.pedigree_documented ? 'نعم' : 'لا')], ['الصور', l => String(l.photos.length)], ['قابل للتفاوض', l => (l.negotiable ? 'نعم' : 'لا')]];
  const priced = list.filter(l => l.price).map(l => access.toQAR(l.price, l.currency));
  return { listings: list.map(l => ({ id: l.id, title: l.title, photo_id: l.photo_id })), rows: rows.map(([k, f]) => ({ label: k, values: list.map(f) })),
    note: priced.length >= 2 ? `أقل سعر بعد التحويل التقريبي للريال القطري: ${Math.min(...priced).toLocaleString('en')} ر.ق، والأعلى: ${Math.max(...priced).toLocaleString('en')} ر.ق.` : null,
    disclaimer: 'المقارنة مبنية على ما كتبه البائعون فقط، وليست تقييماً للجودة أو النسب.' };
}

function report(ctx, input) {
  const types = ['listing', 'user', 'auction', 'message', 'post', 'company'];
  if (!types.includes(input.target_type)) throw bad('invalid_type', 'نوع البلاغ غير صحيح');
  const reason = str(input.reason, 80); if (!reason) throw bad('reason_required', 'اختر سبب البلاغ');
  const tables = { listing: 'listings', auction: 'auctions', company: 'companies', post: 'posts', user: 'users', message: 'messages' };
  const t = db.one(`SELECT * FROM ${tables[input.target_type]} WHERE id=?`, String(input.target_id || ''));
  if (!t) throw new HttpError(404, 'not_found', 'العنصر غير موجود');
  if (db.one("SELECT 1 FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'", ctx.user.id, input.target_type, t.id)) throw new HttpError(409, 'already_reported', 'سبق أن أبلغت عن هذا العنصر وهو قيد المراجعة');
  const rid = id();
  db.run('INSERT INTO reports(id, reporter_id, target_type, target_id, reason, details, country_code) VALUES (?,?,?,?,?,?,?)', rid, ctx.user.id, input.target_type, t.id, reason, str(input.details, 1000), t.country_code || null);
  notifyAdmins(t.country_code || 'QA', { kind: 'report', title: 'بلاغ جديد', body: reason, link: '#/admin/reports' });
  return { ok: true, id: rid };
}

// ===================== المحادثات والرسائل =====================
function ensureConversation(listingId, buyerId, sellerId) {
  const [a, b] = [buyerId, sellerId].sort();
  let c = db.one('SELECT * FROM conversations WHERE listing_id IS ? AND user_a=? AND user_b=?', listingId, a, b);
  if (!c) { const cid = id(); db.run('INSERT INTO conversations(id, listing_id, user_a, user_b) VALUES (?,?,?,?)', cid, listingId, a, b); c = db.one('SELECT * FROM conversations WHERE id=?', cid); }
  return c;
}
function postMessage(conv, senderId, body, kind = 'text', refId = null) {
  const mid = id(); const now = new Date().toISOString();
  db.run('INSERT INTO messages(id, conversation_id, sender_id, body, kind, ref_id, created_at) VALUES (?,?,?,?,?,?,?)', mid, conv.id, senderId, body, kind, refId, now);
  db.run(`UPDATE conversations SET last_message_at=?, ${conv.user_a === senderId ? 'a_read_at' : 'b_read_at'}=? WHERE id=?`, now, now, conv.id);
  const other = conv.user_a === senderId ? conv.user_b : conv.user_a;
  toUser(other, 'message', { conversation_id: conv.id, body: body.slice(0, 120) });
  return mid;
}
function startConversation(ctx, listingId, body) {
  access.requireActive(ctx);
  const l = db.one('SELECT * FROM listings WHERE id=?', listingId);
  if (!l || !PUBLIC_STATUSES.includes(l.status)) throw new HttpError(404, 'not_found', 'الإعلان غير موجود');
  if (l.seller_id === ctx.user.id) throw bad('own_listing', 'هذا إعلانك');
  const text = str(body, 2000); if (!text) throw bad('empty', 'اكتب رسالتك');
  const c = ensureConversation(l.id, ctx.user.id, l.seller_id);
  postMessage(c, ctx.user.id, text);
  notify(l.seller_id, { kind: 'message', title: `رسالة جديدة بخصوص: ${l.title}`, body: text.slice(0, 100), link: `#/messages/${c.id}`, dedupeKey: `msg:${c.id}:${Math.floor(Date.now() / 600000)}` });
  return { conversation_id: c.id };
}
function listConversations(ctx) {
  return db.all(`SELECT c.*, l.title AS listing_title, (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.created_at > COALESCE(CASE WHEN c.user_a=? THEN c.a_read_at ELSE c.b_read_at END, '')) AS unread
    FROM conversations c LEFT JOIN listings l ON l.id=c.listing_id WHERE c.user_a=? OR c.user_b=? ORDER BY c.last_message_at DESC`, ctx.user.id, ctx.user.id, ctx.user.id, ctx.user.id)
    .map(c => ({ id: c.id, listing_id: c.listing_id, listing_title: c.listing_title, other: { id: c.user_a === ctx.user.id ? c.user_b : c.user_a, name: userName(c.user_a === ctx.user.id ? c.user_b : c.user_a) }, last_body: c.last_body, last_message_at: c.last_message_at, unread: c.unread }));
}
function ownedConv(ctx, cid) {
  const c = db.one('SELECT * FROM conversations WHERE id=? AND (user_a=? OR user_b=?)', cid, ctx.user.id, ctx.user.id);
  if (!c) throw new HttpError(404, 'not_found', 'المحادثة غير موجودة');
  return c;
}
function getConversation(ctx, cid) {
  const c = ownedConv(ctx, cid);
  db.run(`UPDATE conversations SET ${c.user_a === ctx.user.id ? 'a_read_at' : 'b_read_at'}=? WHERE id=?`, new Date().toISOString(), cid);
  const l = c.listing_id ? db.one('SELECT * FROM listings WHERE id=?', c.listing_id) : null;
  return { id: c.id, listing: l ? listingOut(l, ctx.user) : null, is_seller: l ? l.seller_id === ctx.user.id : false,
    other: { id: c.user_a === ctx.user.id ? c.user_b : c.user_a, name: userName(c.user_a === ctx.user.id ? c.user_b : c.user_a) },
    messages: db.all('SELECT id, sender_id, body, kind, ref_id, created_at FROM messages WHERE conversation_id=? ORDER BY created_at', cid).map(m => ({ ...m, mine: m.sender_id === ctx.user.id })),
    offers: l ? db.all('SELECT * FROM offers WHERE listing_id=? AND buyer_id IN (?,?) ORDER BY created_at', l.id, c.user_a, c.user_b) : [] };
}
function sendMessage(ctx, cid, body) {
  access.requireActive(ctx);
  const c = ownedConv(ctx, cid);
  const text = str(body, 2000); if (!text) throw bad('empty', 'اكتب رسالتك');
  const mid = postMessage(c, ctx.user.id, text);
  const other = c.user_a === ctx.user.id ? c.user_b : c.user_a;
  notify(other, { kind: 'message', title: `رسالة من ${userName(ctx.user.id)}`, body: text.slice(0, 100), link: `#/messages/${c.id}`, dedupeKey: `msg:${c.id}:${Math.floor(Date.now() / 600000)}` });
  return { id: mid };
}
// تلخيص المفاوضة (حتمي من السجلات؛ لا يخترع شيئاً)
function summarizeConversation(ctx, cid) {
  const c = getConversation(ctx, cid);
  if (!c.listing) return { summary: 'محادثة بدون إعلان مرتبط.' };
  const fmt = o => `${Number(o.amount).toLocaleString('en')} ${o.currency}`;
  const lines = [`📋 ملخص التفاوض على «${c.listing.title}» مع ${c.other.name}:`];
  if (c.listing.price) lines.push(`• السعر المعلن: ${Number(c.listing.price).toLocaleString('en')} ${c.listing.currency}.`);
  if (!c.offers.length) lines.push('• لا توجد عروض سعر مسجلة بعد.');
  for (const o of c.offers) lines.push(`• ${new Date(o.created_at).toLocaleDateString('ar-QA-u-nu-latn')}: ${o.from_user_id === ctx.user.id ? 'أنت' : c.other.name} عرض ${fmt(o)} — ${({ open: 'مفتوح', countered: 'رُدّ عليه بعرض مضاد', accepted: 'مقبول ✅', rejected: 'مرفوض', withdrawn: 'مسحوب', expired: 'منتهي' })[o.status]}.`);
  const acc = c.offers.find(o => o.status === 'accepted');
  if (acc) lines.push(`النتيجة: اتفاق على ${fmt(acc)}.`);
  else if (c.offers.length) { const last = c.offers[c.offers.length - 1]; lines.push(`آخر عرض: ${fmt(last)}${c.listing.price ? ` (الفرق عن المعلن ${Math.round((1 - last.amount / c.listing.price) * 100)}%)` : ''}.`); }
  lines.push(`عدد الرسائل: ${c.messages.length}.`);
  return { summary: lines.join('\n'), source: 'records' };
}

// ===================== العروض =====================
function makeOffer(ctx, listingId, input) {
  access.requireActive(ctx);
  const l = db.one('SELECT * FROM listings WHERE id=?', listingId);
  if (!l || l.status !== 'active') throw bad('not_available', 'الإعلان غير متاح لاستقبال العروض');
  if (l.seller_id === ctx.user.id) throw bad('own_listing', 'لا يمكنك تقديم عرض على إعلانك');
  if (!l.negotiable && l.price && Number(input.amount) < l.price) throw bad('not_negotiable', 'السعر غير قابل للتفاوض');
  const amount = Number(input.amount); if (!(amount > 0 && amount < 1e9)) throw bad('invalid_amount', 'المبلغ غير صحيح');
  if (db.one("SELECT 1 FROM offers WHERE listing_id=? AND buyer_id=? AND status='open'", l.id, ctx.user.id)) throw new HttpError(409, 'offer_open', 'لديك عرض مفتوح على هذا الإعلان، انتظر الرد أو اسحبه');
  const oid = id();
  db.run('INSERT INTO offers(id, listing_id, buyer_id, from_user_id, amount, currency, note) VALUES (?,?,?,?,?,?,?)', oid, l.id, ctx.user.id, ctx.user.id, amount, l.currency, str(input.note, 500));
  const c = ensureConversation(l.id, ctx.user.id, l.seller_id);
  postMessage(c, ctx.user.id, `عرض سعر: ${amount.toLocaleString('en')} ${l.currency}${input.note ? ' — ' + str(input.note, 500) : ''}`, 'offer', oid);
  notify(l.seller_id, { kind: 'offer', title: `عرض جديد على «${l.title}»`, body: `${amount.toLocaleString('en')} ${l.currency}`, link: `#/messages/${c.id}` });
  audit(ctx, 'create', 'offer', oid, { after: { listing: l.id, amount } });
  return { offer: db.one('SELECT * FROM offers WHERE id=?', oid), conversation_id: c.id };
}
function respondOffer(ctx, offerId, input) {
  access.requireActive(ctx);
  const o = db.one('SELECT * FROM offers WHERE id=?', offerId);
  if (!o) throw new HttpError(404, 'not_found', 'العرض غير موجود');
  const l = db.one('SELECT * FROM listings WHERE id=?', o.listing_id);
  const parties = [o.buyer_id, l.seller_id];
  if (!parties.includes(ctx.user.id)) throw new HttpError(404, 'not_found', 'العرض غير موجود');
  if (o.status !== 'open') throw new HttpError(409, 'offer_closed', 'هذا العرض لم يعد مفتوحاً');
  const action = input.action;
  const c = ensureConversation(l.id, o.buyer_id, l.seller_id);
  const other = ctx.user.id === l.seller_id ? o.buyer_id : l.seller_id;
  if (action === 'withdraw') {
    if (o.from_user_id !== ctx.user.id) throw bad('not_yours', 'لا يمكنك سحب عرض الطرف الآخر');
    db.run("UPDATE offers SET status='withdrawn' WHERE id=?", o.id); postMessage(c, ctx.user.id, 'تم سحب العرض.', 'system', o.id);
    return { ok: true };
  }
  if (o.from_user_id === ctx.user.id) throw bad('wait_reply', 'بانتظار رد الطرف الآخر على عرضك');
  if (action === 'reject') {
    db.run("UPDATE offers SET status='rejected' WHERE id=?", o.id); postMessage(c, ctx.user.id, 'تم رفض العرض.', 'system', o.id);
    notify(other, { kind: 'offer', title: `رُفض عرضك على «${l.title}»`, link: `#/messages/${c.id}` });
    return { ok: true };
  }
  if (action === 'counter') {
    const amount = Number(input.amount); if (!(amount > 0 && amount < 1e9)) throw bad('invalid_amount', 'المبلغ غير صحيح');
    const nid = id();
    db.tx(() => {
      db.run("UPDATE offers SET status='countered' WHERE id=?", o.id);
      db.run('INSERT INTO offers(id, listing_id, buyer_id, from_user_id, amount, currency, note, parent_offer_id) VALUES (?,?,?,?,?,?,?,?)', nid, l.id, o.buyer_id, ctx.user.id, amount, l.currency, str(input.note, 500), o.id);
    });
    postMessage(c, ctx.user.id, `عرض مضاد: ${amount.toLocaleString('en')} ${l.currency}`, 'offer', nid);
    notify(other, { kind: 'offer', title: `عرض مضاد على «${l.title}»`, body: `${amount.toLocaleString('en')} ${l.currency}`, link: `#/messages/${c.id}` });
    return { offer: db.one('SELECT * FROM offers WHERE id=?', nid) };
  }
  if (action === 'accept') {
    if (l.status !== 'active') throw bad('not_available', 'الإعلان لم يعد متاحاً');
    let deal;
    db.tx(() => {
      db.run("UPDATE offers SET status='accepted' WHERE id=?", o.id);
      db.run("UPDATE offers SET status='expired' WHERE listing_id=? AND status='open' AND id<>?", l.id, o.id);
      db.run("UPDATE listings SET status='reserved' WHERE id=?", l.id);
      deal = createDeal({ source: l.broker_id ? 'broker' : 'listing', source_id: l.id, seller_id: l.seller_id, buyer_id: o.buyer_id, broker_id: l.broker_id, camel_id: l.camel_id, country_code: l.country_code,
        breed: l.breed, sex: l.sex, age_years: l.age_years, color: l.color, amount: o.amount, currency: o.currency, summary: `اتفاق عبر عرض سعر على الإعلان «${l.title}»` });
    });
    postMessage(c, ctx.user.id, `✅ تم قبول العرض: ${Number(o.amount).toLocaleString('en')} ${o.currency}. الإعلان صار محجوزاً. أكملوا التسليم والدفع بينكم، ثم يؤكد البائع إتمام الصفقة.`, 'system', o.id);
    for (const u of parties) notify(u, { kind: 'deal', title: `اتفاق على «${l.title}»`, body: `${Number(o.amount).toLocaleString('en')} ${o.currency}`, link: `#/deals` });
    audit(ctx, 'accept', 'offer', o.id, { after: { deal: deal.id } });
    return { ok: true, deal };
  }
  throw bad('invalid_action', 'إجراء غير صحيح');
}

// ===================== الصفقات =====================
function createDeal(d) {
  const pct = Number(access.setting('deal_commission_percent', '1')) || 0;
  const broker = d.broker_id ? db.one('SELECT commission_percent FROM broker_profiles WHERE user_id=?', d.broker_id) : null;
  const row = { id: id(), ...d, amount_qar: access.toQAR(d.amount, d.currency), commission_amount: Math.round(d.amount * pct) / 100, broker_commission: broker ? Math.round(d.amount * broker.commission_percent) / 100 : 0, status: 'agreed' };
  const cols = Object.keys(row);
  db.run(`INSERT INTO deals(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c] ?? null));
  return db.one('SELECT * FROM deals WHERE id=?', row.id);
}
function myDeals(ctx) {
  return db.all('SELECT * FROM deals WHERE seller_id=? OR buyer_id=? OR broker_id=? ORDER BY created_at DESC', ctx.user.id, ctx.user.id, ctx.user.id)
    .map(d => ({ ...d, role: d.seller_id === ctx.user.id ? 'seller' : d.buyer_id === ctx.user.id ? 'buyer' : 'broker', seller_name: userName(d.seller_id), buyer_name: userName(d.buyer_id), broker_name: d.broker_id ? userName(d.broker_id) : null }));
}
function updateDeal(ctx, dealId, input) {
  const d = db.one('SELECT * FROM deals WHERE id=?', dealId);
  if (!d || ![d.seller_id, d.buyer_id].includes(ctx.user.id)) throw new HttpError(404, 'not_found', 'الصفقة غير موجودة');
  if (d.status !== 'agreed') throw new HttpError(409, 'deal_closed', 'الصفقة مغلقة');
  if (input.status === 'completed') {
    if (ctx.user.id !== d.seller_id) throw bad('seller_only', 'البائع هو من يؤكد إتمام الصفقة');
    db.run("UPDATE deals SET status='completed', completed_at=? WHERE id=?", new Date().toISOString(), d.id);
    if (d.source !== 'auction' && d.source_id) db.run("UPDATE listings SET status='sold' WHERE id=?", d.source_id);
    if (d.source === 'auction' && d.source_id) { const a = db.one('SELECT listing_id FROM auctions WHERE id=?', d.source_id); if (a && a.listing_id) db.run("UPDATE listings SET status='sold' WHERE id=?", a.listing_id); }
    // تسجيل البيع في حلال البائع تلقائياً
    if (d.camel_id && db.one("SELECT 1 FROM camels WHERE id=? AND owner_id=? AND status NOT IN ('sold','dead','transferred')", d.camel_id, d.seller_id))
      herd.addEvent({ user: db.one('SELECT * FROM users WHERE id=?', d.seller_id), ip: ctx.ip }, d.camel_id, { type: 'sale', title: 'بيع عبر وسم', amount: d.amount, currency: d.currency, counterparty: userName(d.buyer_id), event_date: todayISO() });
    notify(d.buyer_id, { kind: 'deal', title: 'أكد البائع إتمام الصفقة', link: '#/deals' });
  } else if (input.status === 'cancelled') {
    db.run("UPDATE deals SET status='cancelled' WHERE id=?", d.id);
    if (d.source !== 'auction' && d.source_id) db.run("UPDATE listings SET status='active' WHERE id=? AND status='reserved'", d.source_id);
    notify(ctx.user.id === d.seller_id ? d.buyer_id : d.seller_id, { kind: 'deal', title: 'أُلغيت الصفقة', link: '#/deals' });
  } else throw bad('invalid_status', 'حالة غير صحيحة');
  audit(ctx, 'update', 'deal', d.id, { after: { status: input.status } });
  return db.one('SELECT * FROM deals WHERE id=?', d.id);
}

// ===================== صور الإعلانات =====================
function uploadListingPhoto(ctx, lid, body) {
  const l = db.one('SELECT * FROM listings WHERE id=? AND seller_id=?', lid, ctx.user.id);
  if (!l) throw new HttpError(404, 'not_found', 'الإعلان غير موجود');
  if (db.one("SELECT COUNT(*) n FROM media WHERE listing_id=?", lid).n >= 10) throw bad('too_many', 'الحد الأقصى 10 صور للإعلان');
  const buf = Buffer.from(String(body.data_base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'file_too_large', 'الحد الأقصى 5 ميغابايت');
  const mime = media.sniff(buf);
  if (!mime || mime === 'application/pdf') throw new HttpError(415, 'unsupported_file', 'الصورة يجب أن تكون JPG أو PNG أو WEBP');
  const key = `${ctx.user.id}/${id()}`; const file = path.join(UPLOAD_DIR(), key);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf, { mode: 0o600 });
  const mid = id(); const first = !db.one('SELECT 1 FROM media WHERE listing_id=?', lid);
  db.run('INSERT INTO media(id, owner_id, listing_id, kind, storage_key, mime, bytes, sha256, is_primary) VALUES (?,?,?,?,?,?,?,?,?)', mid, ctx.user.id, lid, 'photo', key, mime, buf.length, sha256(buf), first ? 1 : 0);
  flagDuplicatePhotos(lid);
  return { id: mid, flagged: !!(db.one('SELECT flags FROM listings WHERE id=?', lid) || {}).flags };
}
function listingPhoto(ctx, mid) {
  const m = db.one('SELECT m.*, l.status, l.seller_id FROM media m JOIN listings l ON l.id=m.listing_id WHERE m.id=?', mid);
  if (!m || !(PUBLIC_STATUSES.includes(m.status) || (ctx.user && (ctx.user.id === m.seller_id || access.isAdmin(ctx.user))))) throw new HttpError(404, 'not_found', 'غير موجود');
  return { buf: fs.readFileSync(path.join(UPLOAD_DIR(), m.storage_key)), mime: m.mime };
}

// ===================== التوصيات (م4) =====================
function recommended(ctx, { listingId = null, limit = 8 } = {}) {
  if (listingId) {
    const l = db.one('SELECT * FROM listings WHERE id=?', listingId); if (!l) return [];
    return db.all(`SELECT * FROM listings WHERE status='active' AND id<>? AND seller_id<>? ORDER BY (breed IS ?) DESC, (sex IS ?) DESC, (country_code=?) DESC, ABS(COALESCE(age_years,0)-?) ASC, created_at DESC LIMIT ?`,
      l.id, l.seller_id, l.breed, l.sex, l.country_code, l.age_years || 0, limit).map(x => listingOut(x, ctx.user));
  }
  if (!ctx.user) return db.all("SELECT * FROM listings WHERE status='active' ORDER BY created_at DESC LIMIT ?", limit).map(x => listingOut(x, ctx.user));
  const pref = db.one(`SELECT (SELECT breed FROM (SELECT breed FROM search_log WHERE user_id=?1 AND breed IS NOT NULL UNION ALL SELECT l.breed FROM listing_favorites f JOIN listings l ON l.id=f.listing_id WHERE f.user_id=?1) GROUP BY breed ORDER BY COUNT(*) DESC LIMIT 1) AS breed,
     (SELECT country_code FROM search_log WHERE user_id=?1 AND country_code IS NOT NULL GROUP BY country_code ORDER BY COUNT(*) DESC LIMIT 1) AS country`, ctx.user.id) || {};
  return db.all(`SELECT * FROM listings WHERE status='active' AND seller_id<>? AND id NOT IN (SELECT listing_id FROM listing_favorites WHERE user_id=?)
    ORDER BY (breed IS ?) DESC, (country_code IS ?) DESC, created_at DESC LIMIT ?`, ctx.user.id, ctx.user.id, pref.breed || null, pref.country || ctx.user.country_code, limit).map(x => listingOut(x, ctx.user));
}

// ===================== التثمين الاسترشادي (م4) — من صفقات مكتملة فقط =====================
function valuation({ breed, sex, age_years, country }) {
  const minN = Number(access.setting('valuation_min_samples', '5')) || 5;
  const age = age_years != null && age_years !== '' ? ageNameFromYears(age_years, sex) : null;
  const tries = [
    { label: 'نفس الفئة والجنس والعمر والدولة', w: { breed, sex, age: age && age.key, country } },
    { label: 'نفس الفئة والجنس والعمر (كل دول الخليج)', w: { breed, sex, age: age && age.key } },
    { label: 'نفس الفئة والجنس', w: { breed, sex } },
  ];
  const all = db.all("SELECT * FROM deals WHERE status='completed'");
  for (const t of tries) {
    const rows = all.filter(d => (!t.w.breed || d.breed === t.w.breed) && (!t.w.sex || d.sex === t.w.sex) && (!t.w.country || d.country_code === t.w.country)
      && (!t.w.age || (d.age_years != null && ageNameFromYears(d.age_years, d.sex).key === t.w.age))).map(d => d.amount_qar).sort((a, b) => a - b);
    if (rows.length >= minN) {
      const q = p => rows[Math.min(rows.length - 1, Math.max(0, Math.round(p * (rows.length - 1))))];
      return { available: true, basis: t.label, samples: rows.length, currency: 'QAR', p25: q(0.25), median: q(0.5), p75: q(0.75),
        notice: 'تثمين استرشادي فقط من صفقات مكتملة على وسم، وليس سعراً مؤكداً. السعر الفعلي يعتمد على المطية نفسها والنسب والسوق.' };
    }
  }
  return { available: false, samples: 0, needed: minN, notice: `لا توجد صفقات مكتملة كافية (نحتاج ${minN} على الأقل لمطايا مشابهة) لإعطاء تثمين استرشادي موثوق.` };
}

module.exports = { createListing, getListing, updateListing, browse, toggleFavorite, compare, report, startConversation, listConversations, getConversation, sendMessage,
  summarizeConversation, makeOffer, respondOffer, createDeal, myDeals, updateDeal, uploadListingPhoto, listingPhoto, recommended, valuation, listingOut, notifyAdmins, ageNameFromYears, flagDuplicatePhotos };
