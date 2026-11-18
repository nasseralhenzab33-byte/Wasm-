'use strict';
const crypto = require('node:crypto');
const db = require('./db');
const { HttpError } = require('./http');
const { token, sha256 } = require('./util');

const SESSION_DAYS = 30;
const COOKIE = 'wasm_sid';
const MAX_FAILED = 5, LOCK_MIN = 15;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, n, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: Number(n), r: 8, p: 1 });
  const ref = Buffer.from(key, 'base64');
  return ref.length === k.length && crypto.timingSafeEqual(ref, k);
}

function passwordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'weak_password', 'كلمة المرور يجب ألا تقل عن 10 أحرف');
  if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) throw new HttpError(400, 'weak_password', 'كلمة المرور يجب أن تحتوي على أرقام وحروف');
}

function createSession(userId, req) {
  const t = token(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.run('INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent) VALUES (?,?,?,?,?)',
    sha256(t), userId, expires, req.socket.remoteAddress || '', String(req.headers['user-agent'] || '').slice(0, 200));
  return { token: t, expires };
}

function cookieHeader(value, expires) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}; Expires=${new Date(expires).toUTCString()}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const row = db.one(`SELECT u.id, u.email, u.display_name, u.country_code, u.role, u.admin_country_code, u.gestation_days,
      u.birth_alert_days, u.ai_image_training_consent, u.is_suspended, u.partner_data_sharing_consent, u.phone, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(t));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) { db.run('DELETE FROM sessions WHERE token_hash=?', sha256(t)); return null; }
  row.session_hash = sha256(t);
  return row;
}

function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'unauthorized', 'يجب تسجيل الدخول');
}

// حماية CSRF: الكوكي SameSite=Strict + اشتراط ترويسة مخصصة لا يمكن للنماذج العابرة إرسالها
function csrfCheck(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-wasm-client'] !== '1') throw new HttpError(403, 'csrf', 'طلب غير موثوق');
}

const ROLES = ['user', 'owner', 'trader', 'broker', 'company', 'provider', 'country_admin', 'super_admin'];
function requireRole(ctx, ...roles) {
  requireAuth(ctx);
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'forbidden', 'لا تملك صلاحية لهذا الإجراء');
}

module.exports = { hashPassword, verifyPassword, passwordPolicy, createSession, cookieHeader, currentUser, requireAuth, requireRole, csrfCheck, COOKIE, MAX_FAILED, LOCK_MIN, ROLES };
