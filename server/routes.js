'use strict';
const db = require('./lib/db');
const { HttpError, createRouter, rateLimiter } = require('./lib/http');
const auth = require('./lib/auth');
const { audit } = require('./lib/audit');
const { id, todayISO, addDays, isISODate } = require('./lib/util');
const herd = require('./modules/herd.service');
const media = require('./modules/media.service');
const ai = require('./modules/ai/assistant');

const r = createRouter();
const loginLimit = rateLimiter({ windowMs: 15 * 60000, max: 20 });
const registerLimit = rateLimiter({ windowMs: 60 * 60000, max: 10 });
const aiLimit = rateLimiter({ windowMs: 60000, max: 30 });
const COUNTRIES = ['SA', 'QA', 'AE', 'KW', 'BH', 'OM'];
const SELF_ROLES = ['user', 'owner', 'trader', 'broker', 'company', 'provider']; // الأدوار الإدارية لا تُختار ذاتياً

const publicUser = u => ({ id: u.id, email: u.email, display_name: u.display_name, phone: u.phone, country_code: u.country_code, role: u.role,
  gestation_days: u.gestation_days, birth_alert_days: u.birth_alert_days, admin_country_code: u.admin_country_code || null, ai_image_training_consent: !!u.ai_image_training_consent, partner_data_sharing_consent: !!u.partner_data_sharing_consent });

// ===== الحسابات =====
r.post('/api/auth/register', ctx => {
  registerLimit(ctx.ip);
  const b = ctx.body;
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) throw new HttpError(400, 'invalid_email', 'البريد الإلكتروني غير صحيح');
  const name = String(b.display_name || '').trim().slice(0, 60);
  if (name.length < 2) throw new HttpError(400, 'invalid_name', 'الاسم مطلوب');
  if (!COUNTRIES.includes(b.country_code)) throw new HttpError(400, 'invalid_country', 'اختر الدولة');
  const admins = String(process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const role = admins.includes(email) ? 'super_admin' : SELF_ROLES.includes(b.role) ? b.role : 'owner';
  auth.passwordPolicy(b.password);
  if (db.one('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'email_taken', 'البريد مسجل مسبقاً');
  const uid = id();
  db.run('INSERT INTO users(id, email, phone, display_name, password_hash, country_code, role) VALUES (?,?,?,?,?,?,?)',
    uid, email, b.phone ? String(b.phone).slice(0, 20) : null, name, auth.hashPassword(b.password), b.country_code, role);
  const s = auth.createSession(uid, ctx.req);
  ctx.user = { id: uid };
  audit(ctx, 'register', 'user', uid);
  if (b.ref) require('./modules/partner.service').attachReferral(uid, b.ref);
  ctx.setHeader('Set-Cookie', auth.cookieHeader(s.token, s.expires));
  return { status: 201, body: { user: publicUser(db.one('SELECT * FROM users WHERE id=?', uid)) } };
});

r.post('/api/auth/login', ctx => {
  loginLimit(ctx.ip);
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const u = db.one('SELECT * FROM users WHERE email=?', email);
  const generic = new HttpError(401, 'invalid_credentials', 'البريد أو كلمة المرور غير صحيحة');
  if (!u) { auth.hashPassword('dummy-timing-pad-1'); throw generic; }
  if (u.locked_until && u.locked_until > new Date().toISOString()) throw new HttpError(423, 'locked', 'تم قفل الحساب مؤقتاً بسبب محاولات خاطئة، حاول بعد 15 دقيقة');
  if (!auth.verifyPassword(String(ctx.body.password || ''), u.password_hash)) {
    const n = u.failed_logins + 1;
    db.run('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', n >= auth.MAX_FAILED ? 0 : n, n >= auth.MAX_FAILED ? new Date(Date.now() + auth.LOCK_MIN * 60000).toISOString() : null, u.id);
    ctx.user = { id: u.id }; audit(ctx, 'login_failed', 'user', u.id);
    throw generic;
  }
  db.run('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', u.id);
  const s = auth.createSession(u.id, ctx.req);
  ctx.user = u; audit(ctx, 'login', 'user', u.id);
  ctx.setHeader('Set-Cookie', auth.cookieHeader(s.token, s.expires));
  return { user: publicUser(u) };
});

r.post('/api/auth/logout', ctx => {
  if (ctx.user) db.run('DELETE FROM sessions WHERE token_hash=?', ctx.user.session_hash);
  ctx.setHeader('Set-Cookie', auth.cookieHeader('', 0));
  return { ok: true };
});

r.get('/api/me', ctx => { auth.requireAuth(ctx); return { user: publicUser(ctx.user) }; });

r.patch('/api/me', ctx => {
  auth.requireAuth(ctx);
  const b = ctx.body, u = ctx.user, upd = {};
  if (b.display_name !== undefined) { const n = String(b.display_name).trim().slice(0, 60); if (n.length < 2) throw new HttpError(400, 'invalid_name', 'الاسم قصير'); upd.display_name = n; }
  if (b.phone !== undefined) upd.phone = b.phone ? String(b.phone).slice(0, 20) : null;
  if (b.country_code !== undefined) { if (!COUNTRIES.includes(b.country_code)) throw new HttpError(400, 'invalid_country', 'دولة غير صحيحة'); upd.country_code = b.country_code; }
  if (b.gestation_days !== undefined) { const g = parseInt(b.gestation_days, 10); if (!(g >= 330 && g <= 420)) throw new HttpError(400, 'invalid_gestation', 'المدة من اللقاح إلى الولادة بين 330 و 420 يوماً'); upd.gestation_days = g; }
  if (b.birth_alert_days !== undefined) { const g = parseInt(b.birth_alert_days, 10); if (!(g >= 1 && g <= 60)) throw new HttpError(400, 'invalid_alert', 'التنبيه بين 1 و 60 يوماً'); upd.birth_alert_days = g; }
  if (b.ai_image_training_consent !== undefined) upd.ai_image_training_consent = b.ai_image_training_consent ? 1 : 0;
  if (b.partner_data_sharing_consent !== undefined) upd.partner_data_sharing_consent = b.partner_data_sharing_consent ? 1 : 0;
  const cols = Object.keys(upd);
  if (cols.length) {
    db.run(`UPDATE users SET ${cols.map(c => c + '=?').join(',')}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, ...cols.map(c => upd[c]), u.id);
    audit(ctx, 'update', 'user', u.id, { before: Object.fromEntries(cols.map(c => [c, u[c]])), after: upd });
  }
  return { user: publicUser(db.one('SELECT * FROM users WHERE id=?', u.id)) };
});

r.post('/api/me/password', ctx => {
  auth.requireAuth(ctx);
  const u = db.one('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!auth.verifyPassword(String(ctx.body.current_password || ''), u.password_hash)) throw new HttpError(400, 'wrong_password', 'كلمة المرور الحالية غير صحيحة');
  auth.passwordPolicy(ctx.body.new_password);
  db.run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(ctx.body.new_password), u.id);
  db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.session_hash); // إنهاء الجلسات الأخرى
  audit(ctx, 'password_change', 'user', u.id);
  return { ok: true };
});

// تصدير بيانات المستخدم (حق الوصول للبيانات)
r.get('/api/me/export', ctx => {
  auth.requireAuth(ctx);
  const uid = ctx.user.id;
  const t = q => db.all(q, uid);
  ctx.setHeader('Content-Disposition', `attachment; filename="wasm-export-${todayISO()}.json"`);
  return { exported_at: new Date().toISOString(), user: publicUser(ctx.user), farms: t('SELECT * FROM farms WHERE owner_id=?'), camels: t('SELECT * FROM camels WHERE owner_id=?'),
    matings: t('SELECT * FROM matings WHERE owner_id=?'), births: t('SELECT * FROM births WHERE owner_id=?'), events: t('SELECT * FROM camel_events WHERE owner_id=?'),
    media: t('SELECT id, camel_id, kind, mime, bytes, caption, created_at FROM media WHERE owner_id=?') };
});

r.get('/api/age-names', () => ({ age_names: require('./lib/ageNames').AGE_NAMES }));
r.get('/api/countries', () => ({ countries: db.all('SELECT code, name_ar, name_en, currency FROM countries WHERE is_active=1') }));

// ===== العزب =====
r.get('/api/farms', ctx => { auth.requireAuth(ctx); return { farms: db.all('SELECT f.*, (SELECT COUNT(*) FROM camels c WHERE c.farm_id=f.id) AS camels FROM farms f WHERE owner_id=? ORDER BY name', ctx.user.id) }; });
r.post('/api/farms', ctx => {
  auth.requireAuth(ctx);
  const name = String(ctx.body.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'name_required', 'اسم العزبة مطلوب');
  const cc = COUNTRIES.includes(ctx.body.country_code) ? ctx.body.country_code : ctx.user.country_code;
  const fid = id();
  db.run('INSERT INTO farms(id, owner_id, name, country_code, area_text) VALUES (?,?,?,?,?)', fid, ctx.user.id, name, cc, ctx.body.area_text ? String(ctx.body.area_text).slice(0, 120) : null);
  audit(ctx, 'create', 'farm', fid);
  return { status: 201, body: { farm: db.one('SELECT * FROM farms WHERE id=?', fid) } };
});

// ===== الحلال =====
r.get('/api/dashboard', ctx => { auth.requireAuth(ctx); return herd.dashboard(ctx.user); });
r.get('/api/alerts', ctx => { auth.requireAuth(ctx); return { alerts: herd.alerts(ctx.user) }; });
r.get('/api/camels', ctx => { auth.requireAuth(ctx); return { camels: herd.listCamels(ctx.user, Object.fromEntries(ctx.query)) }; });
r.post('/api/camels', ctx => { auth.requireAuth(ctx); return { status: 201, body: { camel: herd.createCamel(ctx, ctx.body) } }; });
r.get('/api/camels/:id', ctx => { auth.requireAuth(ctx); return { camel: herd.getCamel(ctx.user, ctx.params.id) }; });
r.patch('/api/camels/:id', ctx => { auth.requireAuth(ctx); return { camel: herd.updateCamel(ctx, ctx.params.id, ctx.body) }; });
r.delete('/api/camels/:id', ctx => { auth.requireAuth(ctx); return herd.deleteCamel(ctx, ctx.params.id); });
r.get('/api/camels/:id/pedigree', ctx => { auth.requireAuth(ctx); return herd.pedigree(ctx.user, ctx.params.id, ctx.query.get('depth')); });
r.get('/api/camels/:id/history', ctx => { auth.requireAuth(ctx); return { history: herd.history(ctx.user, ctx.params.id) }; });
r.post('/api/camels/:id/events', ctx => { auth.requireAuth(ctx); return { status: 201, body: { event: herd.addEvent(ctx, ctx.params.id, ctx.body) } }; });
r.delete('/api/events/:id', ctx => { auth.requireAuth(ctx); return herd.deleteEvent(ctx, ctx.params.id); });
r.post('/api/matings', ctx => { auth.requireAuth(ctx); return { status: 201, body: { mating: herd.recordMating(ctx, ctx.body) } }; });
r.patch('/api/matings/:id', ctx => { auth.requireAuth(ctx); return { mating: herd.updateMating(ctx, ctx.params.id, ctx.body) }; });
r.delete('/api/matings/:id', ctx => { auth.requireAuth(ctx); return herd.deleteMating(ctx, ctx.params.id); });
r.post('/api/births', ctx => { auth.requireAuth(ctx); return { status: 201, body: herd.recordBirth(ctx, ctx.body) }; });
r.get('/api/calendar', ctx => {
  auth.requireAuth(ctx);
  const from = ctx.query.get('from') || todayISO().slice(0, 8) + '01';
  const to = ctx.query.get('to') || addDays(from, 41);
  return herd.calendar(ctx.user, from, to);
});

// ===== الوسائط والمشاركة =====
r.post('/api/camels/:id/media', ctx => { auth.requireAuth(ctx); return { status: 201, body: media.upload(ctx, ctx.params.id, ctx.body) }; }, { bodyLimit: 7 * 1024 * 1024 });
r.get('/api/media/:id', ctx => { auth.requireAuth(ctx); const { meta, buf } = media.readOwned(ctx.user, ctx.params.id); return { raw: buf, type: meta.mime }; });
r.delete('/api/media/:id', ctx => { auth.requireAuth(ctx); return media.remove(ctx, ctx.params.id); });
r.get('/api/camels/:id/shares', ctx => { auth.requireAuth(ctx); return { shares: media.listShares(ctx.user, ctx.params.id) }; });
r.post('/api/camels/:id/shares', ctx => { auth.requireAuth(ctx); return { status: 201, body: media.createShare(ctx, ctx.params.id, ctx.body) }; });
r.delete('/api/shares/:id', ctx => { auth.requireAuth(ctx); return media.revokeShare(ctx, ctx.params.id); });
r.get('/api/public/share/:token', ctx => media.publicView(ctx.params.token));
r.get('/api/public/share/:token/photo/:mid', ctx => { const { meta, buf } = media.sharedPhoto(ctx.params.token, ctx.params.mid); return { raw: buf, type: meta.mime }; });

// ===== المساعد الذكي =====
r.get('/api/ai/messages', ctx => { auth.requireAuth(ctx); return { messages: ai.history(ctx.user) }; });
r.post('/api/ai/messages', async ctx => { auth.requireAuth(ctx); aiLimit(ctx.user.id); return ai.handle(ctx, ctx.body.text); });
r.post('/api/ai/actions/:id/confirm', ctx => { auth.requireAuth(ctx); return ai.confirm(ctx, ctx.params.id); });
r.post('/api/ai/actions/:id/cancel', ctx => { auth.requireAuth(ctx); return ai.cancel(ctx, ctx.params.id); });
r.delete('/api/ai/messages', ctx => { auth.requireAuth(ctx); db.run('DELETE FROM ai_messages WHERE user_id=?', ctx.user.id); return { ok: true }; });
r.post('/api/ai/analyze-photo', async ctx => {
  auth.requireAuth(ctx); aiLimit(ctx.user.id);
  const buf = Buffer.from(String(ctx.body.data_base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  const mime = media.sniff(buf);
  if (!mime || mime === 'application/pdf') throw new HttpError(415, 'unsupported_file', 'أرسل صورة JPG/PNG/WEBP');
  return ai.analyzePhoto(ctx, buf.toString('base64'), mime);
}, { bodyLimit: 7 * 1024 * 1024 });

// ===== حالة النظام =====
r.get('/api/health', () => ({ ok: true, time: new Date().toISOString(), phases: [1, 2, 3, 4] }));

require('./routes2')(r);

module.exports = r;
