'use strict';
// بيانات تجريبية — جميع الأسماء والأرقام والسجلات وهمية وغير حقيقية، لأغراض العرض والاختبار فقط.
const path = require('node:path');
const db = require('../server/lib/db');
const auth = require('../server/lib/auth');
const herd = require('../server/modules/herd.service');
const media = require('../server/modules/media.service');
const { id, todayISO, addDays } = require('../server/lib/util');

const DEMO_EMAIL = 'demo@wasm.demo';
const DEMO_PASSWORD = 'Wasm-demo-2026';

function camelSvg(bg, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
  <rect width="800" height="600" fill="url(#s)"/>
  <circle cx="620" cy="150" r="70" fill="#F4E6C3" opacity=".55"/>
  <path d="M0 470 Q200 420 400 460 T800 450 V600 H0Z" fill="#C9A86A" opacity=".55"/>
  <path d="M0 520 Q250 480 500 515 T800 505 V600 H0Z" fill="#B08D57" opacity=".7"/>
  <g fill="${body}" transform="translate(170 150)">
    <path d="M60 250 C40 200 70 150 120 140 C150 70 230 60 260 130 C280 90 330 80 360 140 C380 170 400 175 420 160 L430 100 C432 70 470 55 495 70 L520 85 C530 92 528 105 515 108 L495 110 L480 190 C470 240 440 260 420 262 L410 360 L392 360 L388 270 L300 275 L296 360 L278 360 L270 272 C230 270 200 268 180 262 L170 360 L152 360 L150 262 C120 262 100 262 92 258 L84 360 L66 360 Z"/>
  </g>
  <text x="400" y="575" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle" opacity=".85">${label}</text>
</svg>`;
}

async function svgToPng(svg) {
  let sharp;
  try { sharp = require('sharp'); } catch { try { sharp = require('/opt/npm-tools/node_modules/sharp'); } catch { return null; } }
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

const ADMIN_EMAIL = 'admin@wasm.demo';

// بيانات المراحل 2–4 (كلها وهمية ومعلّمة بـ is_demo)
async function seedPhases(ownerCtx, herdC, withPhotos) {
  const market = require('../server/modules/market.service');
  const auctions = require('../server/modules/auction.service');
  const community = require('../server/modules/community.service');
  const T = todayISO();
  const demoEmails = [ADMIN_EMAIL, 'trader@wasm.demo', 'buyer@wasm.demo', 'feed@wasm.demo', 'vet@wasm.demo', 'trans@wasm.demo', 'broker@wasm.demo', 'sa-owner@wasm.demo'];
  for (const e of demoEmails) { const x = db.one('SELECT id FROM users WHERE email=?', e); if (x) db.run('DELETE FROM users WHERE id=?', x.id); }
  db.run("DELETE FROM festivals WHERE is_demo=1");
  const mkUser = (email, name, country, role) => { const id2 = id(); db.run('INSERT INTO users(id, email, display_name, password_hash, country_code, role) VALUES (?,?,?,?,?,?)', id2, email, name, auth.hashPassword(DEMO_PASSWORD), country, role); return db.one('SELECT * FROM users WHERE id=?', id2); };
  const admin = mkUser(ADMIN_EMAIL, 'إدارة وسم (تجريبي)', 'QA', 'super_admin');
  const trader = mkUser('trader@wasm.demo', 'تاجر تجريبي — أبو راشد', 'SA', 'trader');
  const buyer = mkUser('buyer@wasm.demo', 'مشترٍ تجريبي — بو سعود', 'QA', 'owner');
  const saOwner = mkUser('sa-owner@wasm.demo', 'مالك تجريبي — أبو نايف', 'SA', 'owner');
  const brokerU = mkUser('broker@wasm.demo', 'وسيط تجريبي', 'QA', 'broker');
  const C = u => ({ user: u, ip: 'seed' });
  db.run("INSERT INTO broker_profiles(user_id, display_name, country_code, city, phone, commission_percent, bio, verified) VALUES (?,?,?,?,?,?,?,1)", brokerU.id, 'مكتب الوسم للوساطة (تجريبي)', 'QA', 'الشحانية', '+97400000001', 2, 'وساطة في المغاتير والمجاهيم — بيانات وهمية');

  const png = async (bg, body, label) => withPhotos ? svgToPng(camelSvg(bg, body, label)) : null;
  const addPhoto = async (ctx, lid, bg, body, label) => { const b = await png(bg, body, label); if (b) market.uploadListingPhoto(ctx, lid, { data_base64: b.toString('base64') }); };
  const approve = lid => db.run("UPDATE listings SET status='active', published_at=?, expires_at=?, is_demo=1 WHERE id=?", new Date().toISOString(), addDays(T, 60), lid);

  // إعلانات
  const l1 = market.createListing(ownerCtx, { camel_id: herdC.nouf.id, title: 'ناقة أصايل شقحاء للبيع (تجريبي)', description: 'ناقة هادئة ولود — إعلان وهمي لعرض المنصة', price: 65000, country_code: 'QA', city: 'الشحانية', negotiable: true });
  approve(l1.id);
  const specs = [
    [trader, { title: 'فحل مجاهيم أسود (تجريبي)', breed: 'مجاهيم', sex: 'male', age_years: 9, color: 'أسود', price: 180000, country_code: 'SA', city: 'الأحساء', description: 'فحل منتج، مواليده في السوق — إعلان وهمي' }, ['#9DB7A5', '#EFE2C4'], '#3E2C1C'],
    [trader, { title: 'مغاتير وضحاء حقة (تجريبي)', breed: 'مغاتير', sex: 'female', age_years: 2.5, color: 'أبيض', price: 42000, country_code: 'SA', city: 'حفر الباطن', description: 'حقة مغاتير مزيونة — إعلان وهمي', broker_id: null }, ['#7FA9C9', '#E9D6A8'], '#E9E2D2'],
    [saOwner, { title: 'جذعة صفراء من الأصايل (تجريبي)', breed: 'أصايل', sex: 'female', age_years: 4, color: 'صفراء', price: 55000, country_code: 'SA', city: 'القصيم', description: 'جذعة أصايل — إعلان وهمي' }, ['#E7B98A', '#F3E3C3'], '#C69A55'],
    [brokerU, { title: 'قعود مجاهيم مفرود (تجريبي)', breed: 'مجاهيم', sex: 'male', age_years: 1.2, color: 'أسود', price: 15000, country_code: 'QA', city: 'الخور', description: 'قعود مفرود — عبر وسيط — إعلان وهمي', broker_id: brokerU.id }, ['#D9A77A', '#F6E8CC'], '#3E2C1C'],
    [buyer, { title: 'ثنية مغاتير (تجريبي)', breed: 'مغاتير', sex: 'female', age_years: 5, color: 'أبيض', price: null, country_code: 'QA', city: 'الدوحة', description: 'على السوم — إعلان وهمي' }, ['#7FA9C9', '#E9D6A8'], '#EFE9DC'],
  ];
  const ls = [];
  for (const [u, sp, bg, body] of specs) { const l = market.createListing(C(u), sp); approve(l.id); await addPhoto(C(u), l.id, bg, body, sp.title); ls.push(l); }
  db.run("UPDATE listings SET promoted_until=? WHERE id=?", new Date(Date.now() + 7 * 86400000).toISOString(), ls[0].id);
  // تفاوض نموذجي
  const of = market.makeOffer(C(buyer), ls[1].id, { amount: 38000, note: 'سعرك الأخير؟' });
  market.respondOffer(C(trader), of.offer.id, { action: 'counter', amount: 40500 });

  // صفقات مكتملة سابقة (لتفعيل التثمين الاسترشادي) — وهمية
  const prices = [[150000, 9], [165000, 8], [172000, 10], [190000, 9], [210000, 11], [158000, 8]];
  prices.forEach(([p, a], i) => db.run("INSERT INTO deals(id, source, seller_id, buyer_id, country_code, breed, sex, age_years, amount, currency, amount_qar, status, completed_at, summary, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
    id(), 'listing', trader.id, buyer.id, i % 2 ? 'SA' : 'QA', 'مجاهيم', 'male', a, p, 'QAR', p, 'completed', addDays(T, -30 - i * 7), 'صفقة تجريبية سابقة'));

  // مزادات
  const now = Date.now();
  const a1 = auctions.createAuction(C(admin), { title: 'مزاد مغاتير مباشر (تجريبي)', start_price: 20000, min_increment: 1000, reserve_price: 26000, starts_at: new Date(now).toISOString(), ends_at: new Date(now + 2 * 3600000).toISOString(), country_code: 'QA', description: 'مزاد وهمي لعرض المزايدة المباشرة', breed: 'مغاتير', sex: 'female', age_years: 4 });
  db.run('UPDATE auctions SET seller_id=?, is_demo=1, listing_id=?, starts_at=? WHERE id=?', trader.id, ls[1].id, new Date(now - 3600000).toISOString(), a1.id);
  auctions.placeBid(C(buyer), a1.id, 20000); auctions.placeBid(C(saOwner), a1.id, 22000); auctions.placeBid(C(buyer), a1.id, 23000);
  const a2 = auctions.createAuction(C(admin), { title: 'مزاد فحول مجاهيم — قادم (تجريبي)', start_price: 50000, min_increment: 2500, starts_at: new Date(now + 86400000).toISOString(), ends_at: new Date(now + 2 * 86400000).toISOString(), country_code: 'SA', breed: 'مجاهيم', sex: 'male' });
  db.run('UPDATE auctions SET seller_id=?, is_demo=1, listing_id=? WHERE id=?', trader.id, ls[0].id, a2.id);

  // شركاء وسم
  const mkCo = (email, name, cat, country, city, desc, offers) => {
    const u = mkUser(email, name + ' (حساب تجريبي)', country, 'company'); const cid = id();
    db.run("INSERT INTO companies(id, owner_user_id, name_ar, category, country_code, city, phone, description, status, verified_at, is_demo) VALUES (?,?,?,?,?,?,?,?,'active',?,1)", cid, u.id, name, cat, country, city, '+97400000099', desc, new Date().toISOString());
    for (const [t, d, p, un] of offers) db.run('INSERT INTO company_offerings(id, company_id, title, description, price, currency, unit) VALUES (?,?,?,?,?,?,?)', id(), cid, t, d, p, p != null ? (country === 'SA' ? 'SAR' : 'QAR') : null, un);
    return cid;
  };
  const feedCo = mkCo('feed@wasm.demo', 'أعلاف البادية (تجريبي)', 'feed', 'QA', 'أم صلال', 'أعلاف وشعير وبرسيم — شركة وهمية', [['شعير مستورد', 'كيس 40 كغ', 75, 'كيس'], ['برسيم مجفف', 'بالة', 45, 'بالة']]);
  mkCo('vet@wasm.demo', 'عيادة الصحراء البيطرية (تجريبي)', 'vet_services', 'QA', 'الشحانية', 'فحوص وتحصينات وزيارات للعزب — عيادة وهمية', [['زيارة ميدانية للعزبة', 'داخل قطر', 300, 'زيارة'], ['فحص حمل بالسونار', null, 150, 'فحص']]);
  mkCo('trans@wasm.demo', 'نقل الإبل الخليجي (تجريبي)', 'transport', 'SA', 'الرياض', 'نقل بين دول الخليج بشاحنات مجهزة — شركة وهمية', [['نقل داخل المملكة', 'حتى 6 رؤوس', 1500, 'رحلة'], ['نقل الرياض ← الدوحة', 'يشمل أوراق المنفذ', null, null]]);
  db.run("INSERT INTO discount_codes(id, company_id, code, description, percent) VALUES (?,?,?,?,?)", id(), feedCo, 'WASMDEMO', 'خصم تجريبي على الشعير', 10);
  db.run("INSERT INTO campaigns(id, company_id, package_id, section, headline, body, link, amount, currency, payment_status, status, starts_at, ends_at) VALUES (?,?,?,?,?,?,?,?,?,'paid','active',?,?)",
    id(), feedCo, 'pkg-sponsor-30', 'herd', 'شعير بسعر خاص لأهل الإبل (إعلان تجريبي)', 'استخدم الكود WASMDEMO', 'https://example.com', 3000, 'QAR', new Date().toISOString(), new Date(now + 30 * 86400000).toISOString());
  db.run("INSERT INTO campaigns(id, company_id, package_id, section, headline, body, link, amount, currency, payment_status, status, starts_at, ends_at) VALUES (?,?,?,?,?,?,?,?,?,'paid','active',?,?)",
    id(), feedCo, 'pkg-sponsor-30', 'market', 'أعلاف البادية — توصيل للعزب (إعلان تجريبي)', null, 'https://example.com', 3000, 'QAR', new Date().toISOString(), new Date(now + 30 * 86400000).toISOString());
  db.run("INSERT INTO sponsorship_contracts(id, company_id, section, value, starts_on, ends_on, notes) VALUES (?,?,?,?,?,?,?)", id(), feedCo, 'herd', 9000, addDays(T, -60), addDays(T, 20), 'عقد تجريبي');

  // المجتمع
  const posts = [[buyer, 'question', 'وش أفضل وقت لفطام الحيران؟ عندي مفرود عمره سنة تقريباً. (منشور تجريبي)'], [trader, 'experience', 'نصيحة: سجلوا تاريخ التلقيح أول بأول في وسم، التنبيه قبل الولادة فادني كثير. (منشور تجريبي)'], [admin, 'news', 'مرحباً بكم في مجتمع أهل الإبل على وسم. احترموا بعض، والمشورة البيطرية من أهلها. (منشور تجريبي)']];
  for (const [u, cat, body] of posts) { const p = community.createPost(C(u), { category: cat, body }); db.run('UPDATE posts SET is_demo=1 WHERE id=?', p.id); }
  const firstPost = db.one("SELECT id FROM posts WHERE category='question' AND is_demo=1");
  community.addComment(C(saOwner), firstPost.id, 'عندنا نفطم بعد السنة إذا صار ياكل زين. (تعليق تجريبي)');

  // المزاين
  const f = community.createFestival(C(admin), { name_ar: 'مهرجان مزاين تجريبي', country_code: 'QA', location: 'الشحانية', starts_on: addDays(T, -20), ends_on: addDays(T, -14), description: 'مهرجان وهمي لعرض الميزة' });
  db.run('UPDATE festivals SET is_demo=1 WHERE id=?', f.id);
  for (const [cat, rank, nm, ow] of [['مغاتير — حقايق', 1, 'غلا', 'عزبة تجريبية'], ['مغاتير — حقايق', 2, 'شيخة', 'مالك تجريبي'], ['مجاهيم — جذاع', 1, 'الشاهينية', 'مالك تجريبي'], ['أصايل — ثنايا', 1, 'نوف', 'حساب تجريبي — أبو فهد']]) community.addResult(C(admin), f.id, { category: cat, rank, camel_name: nm, owner_display: ow });
  db.run("UPDATE listings SET is_demo=1 WHERE seller_id IN (SELECT id FROM users WHERE email LIKE '%@wasm.demo')");
  db.run("UPDATE auctions SET is_demo=1 WHERE seller_id IN (SELECT id FROM users WHERE email LIKE '%@wasm.demo')");
}

async function seed({ silent = false, withPhotos = true } = {}) {
  const existing = db.one('SELECT id FROM users WHERE email=?', DEMO_EMAIL);
  if (existing) db.run('DELETE FROM users WHERE id=?', existing.id);
  const uid = id();
  db.run('INSERT INTO users(id, email, phone, display_name, password_hash, country_code, role) VALUES (?,?,?,?,?,?,?)',
    uid, DEMO_EMAIL, '+97400000000', 'حساب تجريبي — أبو فهد', auth.hashPassword(DEMO_PASSWORD), 'QA', 'owner');
  const user = db.one('SELECT * FROM users WHERE id=?', uid);
  const ctx = { user, ip: 'seed' };
  const T = todayISO();
  const farmId = id();
  db.run('INSERT INTO farms(id, owner_id, name, country_code, area_text) VALUES (?,?,?,?,?)', farmId, uid, 'عزبة الوسم (تجريبية)', 'QA', 'منطقة افتراضية');

  const mk = (o) => { const c = herd.createCamel(ctx, { farm_id: farmId, ...o }); db.run('UPDATE camels SET is_demo=1 WHERE id=?', c.id); return c; };
  // الفحول
  const shaheen = mk({ name: 'شاهين', sex: 'male', breed: 'مغاتير', color: 'أبيض', tag_number: 'DEMO-M01', birth_date: addDays(T, -9 * 365), sire_name_text: 'الهداج (خارجي)', dam_name_text: 'السمحة (خارجية)' });
  const sultan = mk({ name: 'سلطان', sex: 'male', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-M02', birth_date: addDays(T, -11 * 365), birth_date_estimated: 1 });
  // الأمهات الكبار
  const umm = mk({ name: 'الحمرا', sex: 'female', breed: 'مغاتير', color: 'أشعل', tag_number: 'DEMO-F00', birth_date: addDays(T, -16 * 365), birth_date_estimated: 1 });
  const wadha = mk({ name: 'وضحى', sex: 'female', breed: 'مغاتير', color: 'أبيض', tag_number: 'DEMO-F01', birth_date: addDays(T, -8 * 365), dam_id: umm.id, sire_name_text: 'ريمان (خارجي)', notes: 'ناقة هادئة — بيانات تجريبية' });
  const shuala = mk({ name: 'الشعلة', sex: 'female', breed: 'مغاتير', color: 'أشعل', tag_number: 'DEMO-F02', birth_date: addDays(T, -7 * 365), dam_id: umm.id, sire_id: shaheen.id });
  const muzna = mk({ name: 'مزنة', sex: 'female', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-F03', birth_date: addDays(T, -6 * 365) });
  const ghala = mk({ name: 'غالية', sex: 'female', breed: 'أصايل', color: 'صفراء', tag_number: 'DEMO-F04', birth_date: addDays(T, -10 * 365), birth_date_estimated: 1 });
  const reem = mk({ name: 'ريم', sex: 'female', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-F05', birth_date: addDays(T, -5 * 365) });
  const nouf = mk({ name: 'نوف', sex: 'female', breed: 'أصايل', color: 'شقحاء', tag_number: 'DEMO-F06', birth_date: addDays(T, -9 * 365) });

  // ولادات سابقة لوضحى (تُنشئ ملفات المواليد مع ربط النسب)
  const m1 = herd.recordMating(ctx, { dam_id: wadha.id, sire_id: shaheen.id, mating_date: addDays(T, -1200) });
  db.run('UPDATE matings SET expected_birth_date=? WHERE id=?', addDays(T, -810), m1.id);
  herd.recordBirth(ctx, { dam_id: wadha.id, birth_date: addDays(T, -812), calf_sex: 'female', calf_name: 'هدباء', calf_tag: 'DEMO-C01' });
  const m2 = herd.recordMating(ctx, { dam_id: wadha.id, sire_id: shaheen.id, mating_date: addDays(T, -800) });
  herd.recordBirth(ctx, { dam_id: wadha.id, birth_date: addDays(T, -412), calf_sex: 'male', calf_name: 'ذيب', calf_tag: 'DEMO-C02' });
  herd.addEvent(ctx, herd.findByName(user, 'ذيب')[0].id, { type: 'weaning', event_date: addDays(T, -60), title: 'فطام' });
  // تلقيح حالي لوضحى — ولادة متوقعة خلال ~10 أيام
  const m3 = herd.recordMating(ctx, { dam_id: wadha.id, sire_id: shaheen.id, mating_date: addDays(T, -380) });
  herd.updateMating(ctx, m3.id, { outcome: 'confirmed_pregnant' });
  // الشعلة: ولادة متوقعة الشهر القادم تقريباً
  const m4 = herd.recordMating(ctx, { dam_id: shuala.id, sire_id: sultan.id, mating_date: addDays(T, -365) });
  herd.updateMating(ctx, m4.id, { outcome: 'confirmed_pregnant' });
  // مزنة: تلقيح حديث من فحل خارجي
  herd.recordMating(ctx, { dam_id: muzna.id, sire_name_text: 'صقر (فحل خارجي)', mating_date: addDays(T, -20) });
  // غالية: تلقيح قديم غير مؤكد (يولد تنبيه تأكيد لقاح)
  herd.recordMating(ctx, { dam_id: ghala.id, sire_id: sultan.id, mating_date: addDays(T, -120) });
  // ريم: متجاوزة للموعد التقديري
  const m5 = herd.recordMating(ctx, { dam_id: reem.id, sire_id: sultan.id, mating_date: addDays(T, -395) });
  herd.updateMating(ctx, m5.id, { outcome: 'confirmed_pregnant' });
  // نوف: ولادة سابقة
  herd.recordMating(ctx, { dam_id: nouf.id, sire_id: shaheen.id, mating_date: addDays(T, -700) });
  herd.recordBirth(ctx, { dam_id: nouf.id, birth_date: addDays(T, -310), calf_sex: 'female', calf_name: 'جوهرة', calf_tag: 'DEMO-C03' });

  // صحة ومتابعات
  for (const c of [wadha, shuala, muzna, ghala, reem, nouf, shaheen, sultan])
    herd.addEvent(ctx, c.id, { type: 'vaccination', event_date: addDays(T, -170), title: 'تحصين دوري (تجريبي)', next_due_date: addDays(T, c === shuala ? 3 : 15) });
  herd.addEvent(ctx, shuala.id, { type: 'vet_visit', event_date: addDays(T, -30), title: 'زيارة بيطرية لمتابعة الخلفة', details: 'سجل تجريبي — بدون تشخيص', counterparty: 'عيادة افتراضية' });
  herd.addEvent(ctx, shaheen.id, { type: 'achievement', event_date: addDays(T, -200), title: 'مشاركة في مزاين (تجريبي)', details: 'سجل وهمي لعرض الميزة' });
  herd.addEvent(ctx, muzna.id, { type: 'treatment', event_date: addDays(T, -12), title: 'علاج طفيليات', next_due_date: addDays(T, 2) });

  if (withPhotos) {
    const palette = [[['#7FA9C9', '#E9D6A8'], '#6B4A2B'], [['#E7B98A', '#F3E3C3'], '#8A5A35'], [['#9DB7A5', '#EFE2C4'], '#3E2C1C'], [['#D9A77A', '#F6E8CC'], '#C9B79C']];
    const list = [[wadha, 0], [shuala, 1], [shaheen, 3], [sultan, 2], [muzna, 2], [ghala, 1], [reem, 0], [nouf, 3], [umm, 1]];
    for (const [c, i] of list) {
      const png = await svgToPng(camelSvg(palette[i][0], palette[i][1], `صورة توضيحية — ${c.name} (تجريبي)`));
      if (png) media.upload(ctx, c.id, { data_base64: png.toString('base64'), caption: 'رسم توضيحي — ليست صورة حقيقية', kind: 'photo' });
    }
  }
  db.run("UPDATE camels SET is_demo=1 WHERE owner_id=?", uid);
  await seedPhases(ctx, { wadha, shuala, shaheen, sultan, muzna, ghala, reem, nouf }, withPhotos);
  if (!silent) console.log(`✅ تم إنشاء البيانات التجريبية (كلها وهمية).\n   مالك حلال: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n   مدير عام:  ${ADMIN_EMAIL} / ${DEMO_PASSWORD}\n   تاجر/بائع: trader@wasm.demo / ${DEMO_PASSWORD}`);
  return { user, DEMO_EMAIL, DEMO_PASSWORD };
}

module.exports = { seed, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL };

if (require.main === module) {
  db.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wasm.db'));
  seed().then(() => db.close()).catch(e => { console.error(e); process.exit(1); });
}
