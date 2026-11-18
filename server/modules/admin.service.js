'use strict';
// لوحة الإدارة: مدير عام (كل الدول) ومدير دولة (دولته فقط)
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { todayISO, addDays } = require('../lib/util');
const { notify } = require('../lib/realtime');
const access = require('../lib/access');

const bad = (c, m) => new HttpError(400, c, m);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const sc = (scope, col = 'country_code') => (scope ? { sql: ` AND ${col}=?`, p: [scope] } : { sql: '', p: [] });

function stats(ctx) {
  const scope = access.requireAdmin(ctx);
  const s = sc(scope); const n = (sql, ...p) => db.one(sql, ...p).n;
  const revenue = db.one(`SELECT COALESCE(SUM(c.amount),0) campaigns FROM campaigns c JOIN companies co ON co.id=c.company_id WHERE c.payment_status='paid'${sc(scope, 'co.country_code').sql}`, ...s.p).campaigns;
  const comm = db.one(`SELECT COALESCE(SUM(commission_amount * amount_qar / amount),0) v, COUNT(*) n, COALESCE(SUM(amount_qar),0) gmv FROM deals WHERE status='completed'${s.sql}`, ...s.p);
  const days = []; for (let i = 29; i >= 0; i--) days.push(addDays(todayISO(), -i));
  const series = (sql) => { const rows = db.all(sql, ...s.p); const m = Object.fromEntries(rows.map(r => [r.d, r.n])); return days.map(d => m[d] || 0); };
  return {
    scope: scope || 'all',
    users: n(`SELECT COUNT(*) n FROM users WHERE 1=1${s.sql}`, ...s.p),
    listings_active: n(`SELECT COUNT(*) n FROM listings WHERE status='active'${s.sql}`, ...s.p),
    listings_pending: n(`SELECT COUNT(*) n FROM listings WHERE status='pending_review'${s.sql}`, ...s.p),
    camels: n(`SELECT COUNT(*) n FROM camels c JOIN users u ON u.id=c.owner_id WHERE c.status NOT IN ('sold','dead','transferred')${sc(scope, 'u.country_code').sql}`, ...s.p),
    auctions_live: n(`SELECT COUNT(*) n FROM auctions WHERE status='live'${s.sql}`, ...s.p),
    auctions_pending: n(`SELECT COUNT(*) n FROM auctions WHERE status='pending_review'${s.sql}`, ...s.p),
    deals_completed: comm.n, gmv_qar: Math.round(comm.gmv), commissions_qar: Math.round(comm.v), campaign_revenue_qar: Math.round(revenue),
    partners_active: n(`SELECT COUNT(*) n FROM companies WHERE status='active'${s.sql}`, ...s.p),
    partners_pending: n(`SELECT COUNT(*) n FROM companies WHERE status='pending'${s.sql}`, ...s.p),
    reports_open: n(`SELECT COUNT(*) n FROM reports WHERE status='open'${scope ? ' AND (country_code=? OR country_code IS NULL)' : ''}`, ...s.p),
    alerts_open: n(`SELECT COUNT(*) n FROM ai_alerts WHERE status='open'${s.sql}`, ...s.p),
    days, series: {
      users: series(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM users WHERE created_at >= '${days[0]}'${s.sql} GROUP BY d`),
      listings: series(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM listings WHERE created_at >= '${days[0]}'${s.sql} GROUP BY d`),
      deals: series(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM deals WHERE created_at >= '${days[0]}'${s.sql} GROUP BY d`),
    },
    by_country: scope ? null : db.all(`SELECT c.code, c.name_ar, c.is_active, (SELECT COUNT(*) FROM users u WHERE u.country_code=c.code) users, (SELECT COUNT(*) FROM listings l WHERE l.country_code=c.code AND l.status='active') listings,
      (SELECT COUNT(*) FROM companies co WHERE co.country_code=c.code AND co.status='active') partners FROM countries c ORDER BY c.code`),
  };
}

function pendingListings(ctx) {
  const scope = access.requireAdmin(ctx); const s = sc(scope);
  const market = require('./market.service');
  return { listings: db.all(`SELECT * FROM listings WHERE status IN ('pending_review') ${s.sql} ORDER BY created_at LIMIT 100`, ...s.p).map(l => ({ ...market.listingOut(l, ctx.user), flags: l.flags, seller: (db.one('SELECT display_name FROM users WHERE id=?', l.seller_id) || {}).display_name })) };
}
function reviewListing(ctx, lid, approve, reason) {
  const scope = access.requireAdmin(ctx);
  const l = db.one('SELECT * FROM listings WHERE id=?', lid); if (!l) throw new HttpError(404, 'not_found', 'غير موجود');
  access.inScope(scope, l.country_code);
  if (approve) db.run("UPDATE listings SET status='active', reject_reason=NULL, published_at=?, expires_at=? WHERE id=?", new Date().toISOString(), addDays(todayISO(), 60), lid);
  else { if (!str(reason)) throw bad('reason_required', 'اكتب سبب الرفض'); db.run("UPDATE listings SET status='rejected', reject_reason=? WHERE id=?", str(reason, 300), lid); }
  notify(l.seller_id, { kind: 'listing', title: approve ? `تم نشر إعلانك «${l.title}»` : `رُفض إعلانك «${l.title}»`, body: approve ? null : reason, link: `#/listing/${lid}` });
  audit(ctx, approve ? 'approve' : 'reject', 'listing', lid);
  return { ok: true };
}
function removeListing(ctx, lid, reason) {
  const scope = access.requireAdmin(ctx);
  const l = db.one('SELECT * FROM listings WHERE id=?', lid); if (!l) throw new HttpError(404, 'not_found', 'غير موجود');
  access.inScope(scope, l.country_code);
  db.run("UPDATE listings SET status='removed', reject_reason=? WHERE id=?", str(reason, 300), lid);
  notify(l.seller_id, { kind: 'listing', title: `أُزيل إعلانك «${l.title}»`, body: reason });
  audit(ctx, 'remove', 'listing', lid);
  return { ok: true };
}

function listReports(ctx, q) {
  const scope = access.requireAdmin(ctx);
  const status = ['open', 'actioned', 'dismissed'].includes(q.get('status')) ? q.get('status') : 'open';
  return { reports: db.all(`SELECT r.*, u.display_name AS reporter FROM reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=?${scope ? ' AND (r.country_code=? OR r.country_code IS NULL)' : ''} ORDER BY r.created_at DESC LIMIT 200`, status, ...(scope ? [scope] : []))
    .map(r => ({ ...r, target_title: targetTitle(r.target_type, r.target_id) })) };
}
function targetTitle(type, tid) {
  const q = { listing: 'SELECT title t FROM listings WHERE id=?', auction: 'SELECT title t FROM auctions WHERE id=?', company: 'SELECT name_ar t FROM companies WHERE id=?', post: 'SELECT substr(body,1,80) t FROM posts WHERE id=?', user: 'SELECT display_name t FROM users WHERE id=?', message: 'SELECT substr(body,1,80) t FROM messages WHERE id=?' }[type];
  return (q && db.one(q, tid) || {}).t || '—';
}
function handleReport(ctx, rid, input) {
  const scope = access.requireAdmin(ctx);
  const r = db.one('SELECT * FROM reports WHERE id=?', rid); if (!r || r.status !== 'open') throw new HttpError(404, 'not_found', 'البلاغ غير موجود');
  if (r.country_code) access.inScope(scope, r.country_code);
  const action = input.action;
  if (action === 'remove') {
    if (r.target_type === 'listing') db.run("UPDATE listings SET status='removed', reject_reason='أُزيل بعد بلاغ' WHERE id=?", r.target_id);
    else if (r.target_type === 'post') db.run("UPDATE posts SET status='removed' WHERE id=?", r.target_id);
    else if (r.target_type === 'auction') require('./auction.service').cancelAuction(ctx, r.target_id, 'أُلغي بعد بلاغ');
    else if (r.target_type === 'company') db.run("UPDATE companies SET status='suspended' WHERE id=?", r.target_id);
  } else if (action === 'suspend_user') {
    const owner = { listing: 'SELECT seller_id u FROM listings WHERE id=?', post: 'SELECT author_id u FROM posts WHERE id=?', auction: 'SELECT seller_id u FROM auctions WHERE id=?', user: 'SELECT id u FROM users WHERE id=?', message: 'SELECT sender_id u FROM messages WHERE id=?', company: 'SELECT owner_user_id u FROM companies WHERE id=?' }[r.target_type];
    const u = db.one(owner, r.target_id); if (u) setSuspended(ctx, u.u, true);
  } else if (action !== 'dismiss') throw bad('invalid_action', 'إجراء غير صحيح');
  db.run('UPDATE reports SET status=?, handled_by=?, handled_note=?, handled_at=? WHERE id=?', action === 'dismiss' ? 'dismissed' : 'actioned', ctx.user.id, str(input.note, 500), new Date().toISOString(), rid);
  if (r.reporter_id) notify(r.reporter_id, { kind: 'report', title: 'تمت مراجعة بلاغك. شكراً لمساعدتك.' });
  audit(ctx, 'handle_report', 'report', rid, { after: { action } });
  return { ok: true };
}

function listAlerts(ctx, q) {
  const scope = access.requireAdmin(ctx); const s = sc(scope);
  const status = ['open', 'cleared', 'actioned'].includes(q.get('status')) ? q.get('status') : 'open';
  return { alerts: db.all(`SELECT * FROM ai_alerts WHERE status=?${s.sql} ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`, status, ...s.p)
    .map(a => ({ ...a, evidence: a.evidence_json ? JSON.parse(a.evidence_json) : null, target_title: targetTitle(a.target_type, a.target_id) })) };
}
function reviewAlert(ctx, aid, input) {
  const scope = access.requireAdmin(ctx);
  const a = db.one('SELECT * FROM ai_alerts WHERE id=?', aid); if (!a || a.status !== 'open') throw new HttpError(404, 'not_found', 'غير موجود');
  access.inScope(scope, a.country_code);
  const st = input.action === 'actioned' ? 'actioned' : 'cleared';
  db.run('UPDATE ai_alerts SET status=?, reviewed_by=?, review_note=?, reviewed_at=? WHERE id=?', st, ctx.user.id, str(input.note, 500), new Date().toISOString(), aid);
  if (st === 'cleared' && a.target_type === 'listing') db.run('UPDATE listings SET flags=NULL WHERE id=?', a.target_id);
  audit(ctx, 'review_alert', 'ai_alert', aid, { after: { status: st } });
  return { ok: true };
}

function listUsers(ctx, q) {
  const scope = access.requireAdmin(ctx); const s = sc(scope);
  const search = q.get('q') ? `%${q.get('q').trim().toLowerCase()}%` : null;
  return { users: db.all(`SELECT id, email, display_name, country_code, role, admin_country_code, is_suspended, created_at,
      (SELECT COUNT(*) FROM camels c WHERE c.owner_id=users.id) camels, (SELECT COUNT(*) FROM listings l WHERE l.seller_id=users.id) listings
    FROM users WHERE 1=1${s.sql}${search ? ' AND (lower(email) LIKE ? OR lower(display_name) LIKE ?)' : ''} ORDER BY created_at DESC LIMIT 200`, ...s.p, ...(search ? [search, search] : [])) };
}
function setSuspended(ctx, uid, on) {
  const scope = access.requireAdmin(ctx);
  const u = db.one('SELECT * FROM users WHERE id=?', uid); if (!u) throw new HttpError(404, 'not_found', 'المستخدم غير موجود');
  access.inScope(scope, u.country_code);
  if (['super_admin'].includes(u.role) || (u.role === 'country_admin' && scope)) throw new HttpError(403, 'forbidden', 'لا يمكن إيقاف هذا الحساب');
  db.run('UPDATE users SET is_suspended=? WHERE id=?', on ? 1 : 0, uid);
  if (on) db.run('DELETE FROM sessions WHERE user_id=?', uid);
  audit(ctx, on ? 'suspend' : 'unsuspend', 'user', uid);
  return { ok: true };
}
function setRole(ctx, uid, input) {
  if (!access.isSuper(ctx.user)) throw new HttpError(403, 'forbidden', 'للمدير العام فقط');
  const u = db.one('SELECT * FROM users WHERE id=?', uid); if (!u) throw new HttpError(404, 'not_found', 'المستخدم غير موجود');
  const roles = ['user', 'owner', 'trader', 'broker', 'company', 'provider', 'country_admin', 'super_admin'];
  if (!roles.includes(input.role)) throw bad('invalid_role', 'دور غير صحيح');
  if (input.role === 'country_admin' && !['SA', 'QA', 'AE', 'KW', 'BH', 'OM'].includes(input.admin_country_code)) throw bad('country_required', 'حدد دولة المدير');
  if (uid === ctx.user.id && input.role !== 'super_admin') throw bad('self_demote', 'لا يمكنك تخفيض صلاحيتك بنفسك');
  db.run('UPDATE users SET role=?, admin_country_code=? WHERE id=?', input.role, input.role === 'country_admin' ? input.admin_country_code : null, uid);
  audit(ctx, 'set_role', 'user', uid, { before: { role: u.role }, after: { role: input.role, admin_country_code: input.admin_country_code || null } });
  return { ok: true };
}
function setCountryActive(ctx, code, active) {
  if (!access.isSuper(ctx.user)) throw new HttpError(403, 'forbidden', 'للمدير العام فقط');
  db.run('UPDATE countries SET is_active=? WHERE code=?', active ? 1 : 0, code);
  audit(ctx, 'country', 'country', code, { after: { active } });
  return { ok: true };
}
function getSettings(ctx) { access.requireAdmin(ctx); return { settings: Object.fromEntries(db.all('SELECT key, value FROM settings').map(r => [r.key, r.value])) }; }
function updateSettings(ctx, input) {
  if (!access.isSuper(ctx.user)) throw new HttpError(403, 'forbidden', 'للمدير العام فقط');
  const allowed = { listing_auto_approve: v => (v ? '1' : '0'), deal_commission_percent: v => { const n = Number(v); if (!(n >= 0 && n <= 10)) throw bad('invalid', 'العمولة بين 0 و 10%'); return String(n); },
    auction_anti_snipe_seconds: v => { const n = parseInt(v, 10); if (!(n >= 30 && n <= 900)) throw bad('invalid', 'التمديد بين 30 و 900 ثانية'); return String(n); },
    valuation_min_samples: v => { const n = parseInt(v, 10); if (!(n >= 3 && n <= 100)) throw bad('invalid', 'العدد بين 3 و 100'); return String(n); } };
  for (const [k, f] of Object.entries(allowed)) if (input[k] !== undefined) access.setSetting(k, f(input[k]));
  audit(ctx, 'settings', 'settings', null, { after: input });
  return getSettings(ctx);
}

// ===================== الشركاء =====================
function partnersAdmin(ctx) {
  const scope = access.requireAdmin(ctx); const s = sc(scope); const s2 = sc(scope, 'co.country_code');
  return {
    companies: db.all(`SELECT c.*, u.email AS owner_email FROM companies c JOIN users u ON u.id=c.owner_user_id WHERE 1=1${sc(scope, 'c.country_code').sql} ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC`, ...s.p),
    campaigns: db.all(`SELECT ca.*, co.name_ar AS company, p.name_ar AS package_name, p.placement FROM campaigns ca JOIN companies co ON co.id=ca.company_id JOIN ad_packages p ON p.id=ca.package_id WHERE 1=1${s2.sql} ORDER BY CASE ca.status WHEN 'pending' THEN 0 ELSE 1 END, ca.created_at DESC`, ...s2.p),
    packages: db.all('SELECT * FROM ad_packages ORDER BY placement, price'),
    contracts: db.all(`SELECT k.*, co.name_ar AS company FROM sponsorship_contracts k JOIN companies co ON co.id=k.company_id WHERE 1=1${s2.sql} ORDER BY k.ends_on`, ...s2.p),
    referrals: db.all(`SELECT r.*, a.display_name AS referrer, b.display_name AS referred FROM referrals r JOIN users a ON a.id=r.referrer_user_id JOIN users b ON b.id=r.referred_user_id ORDER BY r.created_at DESC LIMIT 100`),
  };
}
function reviewCompany(ctx, cid, input) {
  const scope = access.requireAdmin(ctx);
  const c = db.one('SELECT * FROM companies WHERE id=?', cid); if (!c) throw new HttpError(404, 'not_found', 'غير موجود');
  access.inScope(scope, c.country_code);
  const status = { approve: 'active', reject: 'rejected', suspend: 'suspended' }[input.action]; if (!status) throw bad('invalid_action', 'إجراء غير صحيح');
  db.run('UPDATE companies SET status=?, verified_at=? WHERE id=?', status, status === 'active' ? new Date().toISOString() : c.verified_at, cid);
  if (status === 'active') db.run("UPDATE users SET role='company' WHERE id=? AND role IN ('user','owner','trader')", c.owner_user_id);
  notify(c.owner_user_id, { kind: 'company', title: status === 'active' ? `تم اعتماد ${c.name_ar} في شركاء وسم` : `تحديث على طلب ${c.name_ar}: ${status === 'rejected' ? 'مرفوض' : 'موقوف'}`, link: '#/partner' });
  audit(ctx, input.action, 'company', cid);
  return { ok: true };
}
function reviewCampaign(ctx, cid, input) {
  const scope = access.requireAdmin(ctx);
  const ca = db.one('SELECT ca.*, co.country_code, co.owner_user_id, p.duration_days FROM campaigns ca JOIN companies co ON co.id=ca.company_id JOIN ad_packages p ON p.id=ca.package_id WHERE ca.id=?', cid);
  if (!ca) throw new HttpError(404, 'not_found', 'غير موجود');
  access.inScope(scope, ca.country_code);
  if (input.action === 'activate') {
    const start = new Date(); const end = new Date(start.getTime() + ca.duration_days * 86400000);
    db.run("UPDATE campaigns SET status='active', payment_status='paid', starts_at=?, ends_at=? WHERE id=?", start.toISOString(), end.toISOString(), cid);
    if ((db.one('SELECT placement FROM ad_packages WHERE id=?', ca.package_id) || {}).placement === 'listing_boost') { /* يُطبق التمييز على إعلانات الشركة لاحقاً */ }
  } else if (input.action === 'pause') db.run("UPDATE campaigns SET status='paused' WHERE id=?", cid);
  else if (input.action === 'reject') db.run("UPDATE campaigns SET status='rejected' WHERE id=?", cid);
  else throw bad('invalid_action', 'إجراء غير صحيح');
  notify(ca.owner_user_id, { kind: 'campaign', title: `تحديث على حملتك «${ca.headline}»: ${{ activate: 'مفعّلة', pause: 'موقوفة', reject: 'مرفوضة' }[input.action]}`, link: '#/partner' });
  audit(ctx, input.action, 'campaign', cid);
  return { ok: true };
}
function savePackage(ctx, input) {
  if (!access.isSuper(ctx.user)) throw new HttpError(403, 'forbidden', 'للمدير العام فقط');
  const { PLACEMENTS } = require('./partner.service');
  if (!PLACEMENTS.includes(input.placement)) throw bad('invalid_placement', 'نوع الظهور غير صحيح');
  const name = str(input.name_ar, 80), days = parseInt(input.duration_days, 10), price = Number(input.price);
  if (!name || !(days > 0) || !(price >= 0)) throw bad('invalid', 'الاسم والمدة والسعر مطلوبة');
  db.run('INSERT INTO ad_packages(id, name_ar, placement, duration_days, price, currency) VALUES (?,?,?,?,?,?)', require('../lib/util').id(), name, input.placement, days, price, 'QAR');
  return partnersAdmin(ctx);
}
function addContract(ctx, input) {
  const scope = access.requireAdmin(ctx);
  const c = db.one('SELECT * FROM companies WHERE id=?', input.company_id); if (!c) throw bad('invalid_company', 'الشركة غير موجودة');
  access.inScope(scope, c.country_code);
  const { isISODate, id } = require('../lib/util');
  if (!isISODate(input.starts_on) || !isISODate(input.ends_on) || input.ends_on < input.starts_on) throw bad('invalid_dates', 'التواريخ غير صحيحة');
  const value = Number(input.value); if (!(value >= 0)) throw bad('invalid_value', 'قيمة العقد غير صحيحة');
  db.run('INSERT INTO sponsorship_contracts(id, company_id, section, value, starts_on, ends_on, notes) VALUES (?,?,?,?,?,?,?)', id(), c.id, str(input.section, 40) || 'herd', value, input.starts_on, input.ends_on, str(input.notes, 500));
  return partnersAdmin(ctx);
}
function pendingAuctions(ctx) {
  const scope = access.requireAdmin(ctx); const s = sc(scope);
  return { auctions: db.all(`SELECT a.*, u.display_name AS seller FROM auctions a JOIN users u ON u.id=a.seller_id WHERE a.status IN ('pending_review','live','scheduled')${sc(scope, 'a.country_code').sql} ORDER BY CASE a.status WHEN 'pending_review' THEN 0 ELSE 1 END, a.ends_at`, ...s.p)
    .map(a => ({ ...a, chain: require('./auction.service').verifyChain(a.id) })) };
}

module.exports = { stats, pendingListings, reviewListing, removeListing, listReports, handleReport, listAlerts, reviewAlert, listUsers, setSuspended, setRole, setCountryActive,
  getSettings, updateSettings, partnersAdmin, reviewCompany, reviewCampaign, savePackage, addContract, pendingAuctions };
