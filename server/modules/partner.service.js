'use strict';
// المرحلة 3: شركاء وسم (الشركات، الخدمات، الباقات، الحملات، رعاية الأقسام، أكواد الخصم، الإحالات، العقود) + الوسطاء
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, token, todayISO, addDays } = require('../lib/util');
const { notify } = require('../lib/realtime');
const access = require('../lib/access');

const bad = (c, m) => new HttpError(400, c, m);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const COUNTRIES = ['SA', 'QA', 'AE', 'KW', 'BH', 'OM'];
const CATEGORIES = { feed: 'الأعلاف', vet_pharma: 'الأدوية البيطرية', supplies: 'المستلزمات', transport: 'نقل الإبل', vet_services: 'الخدمات البيطرية', other: 'خدمات أخرى' };
const SECTIONS = ['home', 'market', 'auctions', 'herd', 'vet', 'feed', 'transport', 'community', 'mazayin'];
const PLACEMENTS = ['home_banner', 'section_sponsor', 'directory_top', 'listing_boost'];

// ===================== الشركات =====================
function applyCompany(ctx, input) {
  access.requireActive(ctx);
  const name = str(input.name_ar, 100); if (!name) throw bad('name_required', 'اسم الشركة مطلوب');
  if (!CATEGORIES[input.category]) throw bad('invalid_category', 'اختر نشاط الشركة');
  const country = COUNTRIES.includes(input.country_code) ? input.country_code : ctx.user.country_code;
  if (db.one("SELECT 1 FROM companies WHERE owner_user_id=? AND status IN ('pending','active')", ctx.user.id) && !access.isAdmin(ctx.user)) throw new HttpError(409, 'company_exists', 'لديك شركة مسجلة أو طلب قيد المراجعة');
  const cid = id();
  db.run('INSERT INTO companies(id, owner_user_id, name_ar, name_en, category, country_code, city, phone, website, cr_number, description) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    cid, ctx.user.id, name, str(input.name_en, 100), input.category, country, str(input.city, 60), str(input.phone, 20), str(input.website, 200), str(input.cr_number, 40), str(input.description, 2000));
  audit(ctx, 'create', 'company', cid);
  require('./market.service').notifyAdmins(country, { kind: 'company', title: 'طلب شراكة جديد', body: name, link: '#/admin/partners' });
  return myCompany(ctx);
}
function ownCompany(ctx) {
  const c = db.one("SELECT * FROM companies WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 1", ctx.user.id);
  if (!c) throw new HttpError(404, 'no_company', 'لا توجد شركة مسجلة لحسابك');
  return c;
}
function myCompany(ctx) {
  const c = db.one("SELECT * FROM companies WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 1", ctx.user.id);
  if (!c) return { company: null };
  return { company: c, category_ar: CATEGORIES[c.category],
    offerings: db.all('SELECT * FROM company_offerings WHERE company_id=? ORDER BY created_at DESC', c.id),
    campaigns: db.all('SELECT c.*, p.name_ar AS package_name, p.placement FROM campaigns c JOIN ad_packages p ON p.id=c.package_id WHERE c.company_id=? ORDER BY c.created_at DESC', c.id)
      .map(x => ({ ...x, ctr: x.impressions ? Math.round(x.clicks / x.impressions * 1000) / 10 : 0 })),
    codes: db.all('SELECT * FROM discount_codes WHERE company_id=? ORDER BY created_at DESC', c.id),
    contracts: db.all('SELECT * FROM sponsorship_contracts WHERE company_id=? ORDER BY ends_on', c.id),
    referrals: db.one("SELECT COUNT(*) n, COALESCE(SUM(commission_amount),0) total FROM referrals WHERE company_id=?", c.id),
    packages: db.all('SELECT * FROM ad_packages WHERE is_active=1 AND (country_code IS NULL OR country_code=?) ORDER BY price', c.country_code) };
}
function updateCompany(ctx, input) {
  const c = ownCompany(ctx);
  const f = {}; for (const k of ['city', 'phone', 'website', 'description', 'name_en']) if (input[k] !== undefined) f[k] = str(input[k], k === 'description' ? 2000 : 200);
  const cols = Object.keys(f); if (cols.length) db.run(`UPDATE companies SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`, ...cols.map(k => f[k]), c.id);
  return myCompany(ctx);
}
function addOffering(ctx, input) {
  const c = ownCompany(ctx);
  if (c.status !== 'active') throw bad('company_inactive', 'الشركة بانتظار الموافقة');
  const title = str(input.title, 120); if (!title) throw bad('title_required', 'العنوان مطلوب');
  const price = input.price ? Number(input.price) : null; if (price != null && !(price >= 0)) throw bad('invalid_price', 'السعر غير صحيح');
  const oid = id();
  db.run('INSERT INTO company_offerings(id, company_id, title, description, price, currency, unit) VALUES (?,?,?,?,?,?,?)', oid, c.id, title, str(input.description, 1000), price, price != null ? access.CURRENCY_OF[c.country_code] : null, str(input.unit, 30));
  return { id: oid };
}
function deleteOffering(ctx, oid) { const c = ownCompany(ctx); db.run('DELETE FROM company_offerings WHERE id=? AND company_id=?', oid, c.id); return { ok: true }; }

function directory(ctx, q) {
  const cat = q.get('category'); const country = q.get('country');
  const where = ["c.status='active'"], p = [];
  if (CATEGORIES[cat]) { where.push('c.category=?'); p.push(cat); }
  if (COUNTRIES.includes(country)) { where.push('c.country_code=?'); p.push(country); }
  const promoted = new Set(db.all("SELECT ca.company_id FROM campaigns ca JOIN ad_packages p ON p.id=ca.package_id WHERE ca.status='active' AND p.placement='directory_top' AND ca.ends_at > ?", new Date().toISOString()).map(r => r.company_id));
  const list = db.all(`SELECT c.* FROM companies c WHERE ${where.join(' AND ')} ORDER BY c.verified_at IS NULL, c.name_ar`, ...p).map(c => ({
    id: c.id, name_ar: c.name_ar, category: c.category, category_ar: CATEGORIES[c.category], country_code: c.country_code, city: c.city, phone: c.phone, website: c.website,
    description: c.description, verified: !!c.verified_at, promoted: promoted.has(c.id), is_demo: !!c.is_demo,
    offerings: db.all('SELECT id, title, description, price, currency, unit FROM company_offerings WHERE company_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 6', c.id),
    codes: db.all("SELECT code, description, percent, valid_to FROM discount_codes WHERE company_id=? AND is_active=1 AND (valid_to IS NULL OR valid_to >= ?) AND (max_uses IS NULL OR uses < max_uses)", c.id, todayISO()) }));
  list.sort((a, b) => (b.promoted - a.promoted));
  return { companies: list, categories: CATEGORIES };
}

// ===================== الحملات ورعاية الأقسام =====================
function createCampaign(ctx, input) {
  const c = ownCompany(ctx);
  if (c.status !== 'active') throw bad('company_inactive', 'الشركة بانتظار الموافقة');
  const pkg = db.one('SELECT * FROM ad_packages WHERE id=? AND is_active=1', input.package_id);
  if (!pkg) throw bad('invalid_package', 'اختر باقة');
  const headline = str(input.headline, 90); if (!headline) throw bad('headline_required', 'نص الإعلان مطلوب');
  const section = pkg.placement === 'section_sponsor' ? (SECTIONS.includes(input.section) ? input.section : (() => { throw bad('section_required', 'اختر القسم'); })()) : pkg.placement === 'home_banner' ? 'home' : null;
  let link = str(input.link, 300); if (link && !/^https:\/\//.test(link)) throw bad('invalid_link', 'الرابط يجب أن يبدأ بـ https://');
  const cid = id();
  db.run('INSERT INTO campaigns(id, company_id, package_id, section, headline, body, link, amount, currency) VALUES (?,?,?,?,?,?,?,?,?)', cid, c.id, pkg.id, section, headline, str(input.body, 200), link, pkg.price, pkg.currency);
  require('./market.service').notifyAdmins(c.country_code, { kind: 'campaign', title: 'حملة إعلانية جديدة بانتظار التفعيل', body: `${c.name_ar}: ${headline}`, link: '#/admin/partners' });
  return { id: cid, notice: 'تم إرسال الحملة. تُفعّل بعد تأكيد الدفع ومراجعة الإدارة. (بوابة الدفع الإلكتروني تُربط لاحقاً — حالياً الدفع يُنسق مع إدارة وسم.)' };
}
// إعلان راعٍ لقسم (يُعرض لكل الزوار) — يزيد عدد الظهور
function sponsorFor(section) {
  const now = new Date().toISOString();
  const list = db.all(`SELECT ca.*, co.name_ar AS company_name FROM campaigns ca JOIN companies co ON co.id=ca.company_id JOIN ad_packages p ON p.id=ca.package_id
    WHERE ca.status='active' AND ca.starts_at <= ? AND ca.ends_at > ? AND (ca.section=? OR (p.placement='home_banner' AND ?='home'))`, now, now, section, section);
  if (!list.length) return { sponsor: null };
  const s = list[Math.floor(Math.random() * list.length)];
  db.run('UPDATE campaigns SET impressions=impressions+1 WHERE id=?', s.id);
  return { sponsor: { id: s.id, company: s.company_name, headline: s.headline, body: s.body, has_link: !!s.link } };
}
function clickCampaign(cid) {
  const c = db.one("SELECT * FROM campaigns WHERE id=? AND status='active'", cid); if (!c) throw new HttpError(404, 'not_found', 'غير موجود');
  db.run('UPDATE campaigns SET clicks=clicks+1 WHERE id=?', cid);
  return { link: c.link };
}

// ===================== أكواد الخصم =====================
function createCode(ctx, input) {
  const c = ownCompany(ctx); if (c.status !== 'active') throw bad('company_inactive', 'الشركة بانتظار الموافقة');
  const code = String(input.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) throw bad('invalid_code', 'الكود من 4 إلى 20 حرفاً إنجليزياً أو رقماً');
  if (db.one('SELECT 1 FROM discount_codes WHERE code=?', code)) throw new HttpError(409, 'code_taken', 'الكود مستخدم');
  const percent = input.percent ? Number(input.percent) : null; if (percent != null && !(percent > 0 && percent <= 90)) throw bad('invalid_percent', 'النسبة بين 1 و 90');
  db.run('INSERT INTO discount_codes(id, company_id, code, description, percent, valid_to, max_uses) VALUES (?,?,?,?,?,?,?)', id(), c.id, code, str(input.description, 200), percent, str(input.valid_to, 10), input.max_uses ? parseInt(input.max_uses, 10) : null);
  return { ok: true };
}
function redeemCode(ctx, code) {
  const d = db.one('SELECT dc.*, c.name_ar FROM discount_codes dc JOIN companies c ON c.id=dc.company_id WHERE dc.code=? AND dc.is_active=1 AND c.status=\'active\'', String(code || '').trim().toUpperCase());
  if (!d || (d.valid_to && d.valid_to < todayISO()) || (d.max_uses != null && d.uses >= d.max_uses)) throw new HttpError(404, 'invalid_code', 'الكود غير صالح أو منتهي');
  const r = db.run('INSERT OR IGNORE INTO code_redemptions(code_id, user_id) VALUES (?,?)', d.id, ctx.user.id);
  if (r.changes) db.run('UPDATE discount_codes SET uses=uses+1 WHERE id=?', d.id);
  return { ok: true, company: d.name_ar, percent: d.percent, description: d.description, already: !r.changes, notice: 'اعرض هذا الكود على الشركة عند الشراء. الخصم تقدمه الشركة مباشرة.' };
}

// ===================== الإحالات =====================
function myReferral(ctx) {
  let u = db.one('SELECT referral_code FROM users WHERE id=?', ctx.user.id);
  if (!u.referral_code) { let code; do { code = 'W' + token(5).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(); } while (db.one('SELECT 1 FROM users WHERE referral_code=?', code)); db.run('UPDATE users SET referral_code=? WHERE id=?', code, ctx.user.id); u = { referral_code: code }; }
  return { code: u.referral_code, count: db.one('SELECT COUNT(*) n FROM referrals WHERE referrer_user_id=?', ctx.user.id).n };
}
function attachReferral(newUserId, code) {
  if (!code) return;
  const ref = db.one('SELECT id FROM users WHERE referral_code=?', String(code).toUpperCase()); if (!ref || ref.id === newUserId) return;
  const company = db.one("SELECT id FROM companies WHERE owner_user_id=? AND status='active'", ref.id);
  db.run('INSERT OR IGNORE INTO referrals(id, referrer_user_id, referred_user_id, company_id) VALUES (?,?,?,?)', id(), ref.id, newUserId, company ? company.id : null);
  db.run('UPDATE users SET referred_by=? WHERE id=?', ref.id, newUserId);
  notify(ref.id, { kind: 'referral', title: 'انضم مستخدم جديد عن طريق رابطك 🎉' });
}

// ===================== الوسطاء =====================
function upsertBroker(ctx, input) {
  access.requireActive(ctx);
  const name = str(input.display_name, 60) || ctx.user.display_name;
  const pct = input.commission_percent != null ? Number(input.commission_percent) : 2.5;
  if (!(pct >= 0 && pct <= 20)) throw bad('invalid_commission', 'العمولة بين 0 و 20%');
  const country = COUNTRIES.includes(input.country_code) ? input.country_code : ctx.user.country_code;
  db.run(`INSERT INTO broker_profiles(user_id, display_name, country_code, city, phone, commission_percent, bio) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, country_code=excluded.country_code, city=excluded.city, phone=excluded.phone, commission_percent=excluded.commission_percent, bio=excluded.bio`,
    ctx.user.id, name, country, str(input.city, 60), str(input.phone, 20), pct, str(input.bio, 1000));
  if (['user', 'owner', 'trader'].includes(ctx.user.role)) db.run("UPDATE users SET role='broker' WHERE id=?", ctx.user.id);
  return { broker: db.one('SELECT * FROM broker_profiles WHERE user_id=?', ctx.user.id) };
}
function listBrokers(ctx, q) {
  const country = q.get('country');
  return { brokers: db.all(`SELECT b.*, (SELECT COUNT(*) FROM deals d WHERE d.broker_id=b.user_id AND d.status='completed') AS deals_done,
      (SELECT COUNT(*) FROM listings l WHERE l.broker_id=b.user_id AND l.status='active') AS active_listings
    FROM broker_profiles b JOIN users u ON u.id=b.user_id WHERE u.is_suspended=0 ${COUNTRIES.includes(country) ? 'AND b.country_code=?' : ''} ORDER BY b.verified DESC, deals_done DESC`, ...(COUNTRIES.includes(country) ? [country] : []))
    .map(b => ({ id: b.user_id, display_name: b.display_name, country_code: b.country_code, city: b.city, phone: ctx.user ? b.phone : null, commission_percent: b.commission_percent, bio: b.bio, verified: !!b.verified, deals_done: b.deals_done, active_listings: b.active_listings })) };
}

// ===================== المجدول: انتهاء الحملات وتذكير العقود =====================
function tick() {
  const now = new Date().toISOString();
  db.run("UPDATE campaigns SET status='ended' WHERE status='active' AND ends_at <= ?", now);
  for (const k of db.all('SELECT k.*, c.owner_user_id, c.name_ar, c.country_code FROM sponsorship_contracts k JOIN companies c ON c.id=k.company_id WHERE k.reminder_sent=0 AND k.ends_on <= ? AND k.ends_on >= ?', addDays(todayISO(), 30), todayISO())) {
    db.run('UPDATE sponsorship_contracts SET reminder_sent=1 WHERE id=?', k.id);
    notify(k.owner_user_id, { kind: 'contract', title: `عقد رعاية قسم «${k.section}» ينتهي في ${k.ends_on}`, link: '#/partner', dedupeKey: `contract:${k.id}` });
    require('./market.service').notifyAdmins(k.country_code, { kind: 'contract', title: `عقد رعاية ${k.name_ar} ينتهي في ${k.ends_on}`, link: '#/admin/partners' });
  }
}

module.exports = { applyCompany, myCompany, updateCompany, addOffering, deleteOffering, directory, createCampaign, sponsorFor, clickCampaign, createCode, redeemCode, myReferral, attachReferral,
  upsertBroker, listBrokers, tick, CATEGORIES, SECTIONS, PLACEMENTS };
