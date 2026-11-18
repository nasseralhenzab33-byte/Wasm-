'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, client, PNG_1x1, db } = require('./helpers');
const { addDays, todayISO } = require('../server/lib/util');
const auctionsSvc = require('../server/modules/auction.service');

let srv, seller, buyer, buyer2, adminC, qaAdmin;
const mk = async (email, extra) => { const c = client(srv.base); const r = await c.register(email, extra); assert.equal(r.status, 201, JSON.stringify(r.data)); return c; };
const uid = email => db.one('SELECT id FROM users WHERE email=?', email).id;

test.before(async () => {
  srv = await start();
  seller = await mk('seller@t.qa'); buyer = await mk('buyer@t.qa'); buyer2 = await mk('buyer2@t.sa', { country_code: 'SA' });
  adminC = await mk('admin@t.qa'); db.run("UPDATE users SET role='super_admin' WHERE email='admin@t.qa'");
  qaAdmin = await mk('qa-admin@t.qa'); db.run("UPDATE users SET role='country_admin', admin_country_code='QA' WHERE email='qa-admin@t.qa'");
});
test.after(() => srv.stop());

let listing, camel;
test('السوق: إنشاء إعلان من ملف المطية ← مراجعة ← نشر', async () => {
  camel = (await seller.post('/api/camels', { name: 'وضحى', sex: 'female', breed: 'مغاتير', color: 'أبيض', birth_date: addDays(todayISO(), -6 * 365) })).data.camel;
  await seller.post(`/api/camels/${camel.id}/media`, { data_base64: PNG_1x1 });
  const r = await seller.post('/api/listings', { camel_id: camel.id, title: 'ناقة مغاتير للبيع', description: 'ناقة هادئة', price: 50000, country_code: 'QA' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  listing = r.data.listing;
  assert.equal(listing.status, 'pending_review');
  assert.equal(listing.breed, 'مغاتير');
  assert.equal(listing.photos.length, 1, 'تُنسخ صور المطية');
  assert.equal(listing.age_name.name, 'رباعية');
  assert.equal((await client(srv.base).get('/api/listings/' + listing.id)).status, 404, 'غير منشور = غير مرئي للعامة');
  assert.equal((await buyer.post(`/api/admin/listings/${listing.id}/review`, { approve: true })).status, 403);
  assert.equal((await qaAdmin.post(`/api/admin/listings/${listing.id}/review`, { approve: true })).status, 200);
  const pub = await client(srv.base).get('/api/listings/' + listing.id);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.listing.contact_phone, null);
  assert.equal(pub.data.listing.camel_id, undefined, 'لا يكشف ملف الحلال الخاص');
  assert.equal((await client(srv.base).get('/api/listing-photos/' + pub.data.listing.photos[0].id)).status, 200);
});

test('السوق: البحث والفلاتر والمفضلة والمقارنة', async () => {
  const l2 = (await seller.post('/api/listings', { title: 'فحل مجاهيم', description: 'فحل', price: 90000, country_code: 'QA', breed: 'مجاهيم', sex: 'male', age_years: 9 })).data.listing;
  await adminC.post(`/api/admin/listings/${l2.id}/review`, { approve: true });
  const pub = client(srv.base);
  assert.equal((await pub.get('/api/listings?breed=مغاتير')).data.listings.length, 1);
  assert.equal((await pub.get('/api/listings?max_price=60000')).data.listings.length, 1);
  assert.equal((await pub.get('/api/listings?sex=male&country=QA')).data.listings.length, 1);
  assert.equal((await pub.get('/api/listings?age=fater')).data.listings[0].id, l2.id);
  assert.equal((await pub.get('/api/listings?q=' + encodeURIComponent('مجاهيم'))).data.total, 1);
  assert.equal((await pub.get('/api/listings?sort=price_desc')).data.listings[0].id, l2.id);
  assert.equal((await buyer.post(`/api/listings/${listing.id}/favorite`)).data.favorite, true);
  assert.equal((await buyer.get('/api/listings?favorites=1')).data.listings.length, 1);
  const cmp = await pub.get(`/api/listings/compare?ids=${listing.id},${l2.id}`);
  assert.equal(cmp.data.rows[0].values.length, 2);
  assert.ok((await buyer.get('/api/listings/recommended')).data.listings.length >= 1);
});

let convId, dealId;
test('العروض والتفاوض والرسائل ← اتفاق ← صفقة ← تسجيل البيع في الحلال', async () => {
  assert.equal((await seller.post(`/api/listings/${listing.id}/offers`, { amount: 40000 })).status, 400, 'لا عرض على إعلانك');
  const o = await buyer.post(`/api/listings/${listing.id}/offers`, { amount: 40000, note: 'سعري الأخير؟' });
  assert.equal(o.status, 201); convId = o.data.conversation_id;
  assert.equal((await buyer.post(`/api/listings/${listing.id}/offers`, { amount: 41000 })).status, 409, 'عرض مفتوح واحد');
  assert.equal((await buyer.post(`/api/offers/${o.data.offer.id}/respond`, { action: 'accept' })).status, 400, 'لا تقبل عرضك بنفسك');
  const counter = await seller.post(`/api/offers/${o.data.offer.id}/respond`, { action: 'counter', amount: 46000 });
  assert.equal(counter.status, 200);
  assert.equal((await buyer2.get(`/api/conversations/${convId}`)).status, 404, 'المحادثة خاصة بالطرفين');
  await seller.post(`/api/conversations/${convId}/messages`, { body: 'هذا آخر سعر' });
  const n = await buyer.get('/api/unread'); assert.ok(n.data.messages >= 1 && n.data.notifications >= 1);
  const acc = await buyer.post(`/api/offers/${counter.data.offer.id}/respond`, { action: 'accept' });
  assert.equal(acc.status, 200); dealId = acc.data.deal.id;
  assert.equal(acc.data.deal.amount, 46000);
  assert.equal(acc.data.deal.commission_amount, 460, 'عمولة المنصة 1% افتراضياً');
  assert.equal((await client(srv.base).get('/api/listings/' + listing.id)).data.listing.status, 'reserved');
  const sum = await buyer.get(`/api/conversations/${convId}/summary`);
  assert.match(sum.data.summary, /اتفاق على 46,000/);
  assert.equal((await buyer.patch(`/api/deals/${dealId}`, { status: 'completed' })).status, 400, 'البائع فقط يؤكد');
  assert.equal((await seller.patch(`/api/deals/${dealId}`, { status: 'completed' })).status, 200);
  assert.equal((await seller.get('/api/camels/' + camel.id)).data.camel.status, 'sold', 'سُجل البيع في الحلال تلقائياً');
});

test('البلاغات ومراجعتها ونطاق مدير الدولة', async () => {
  const l = (await buyer2.post('/api/listings', { title: 'إعلان سعودي', description: 'وصف', price: 1000, country_code: 'SA' })).data.listing;
  assert.equal((await qaAdmin.post(`/api/admin/listings/${l.id}/review`, { approve: true })).status, 403, 'مدير قطر لا يدير السعودية');
  assert.equal((await adminC.post(`/api/admin/listings/${l.id}/review`, { approve: true })).status, 200);
  const rep = await buyer.post('/api/reports', { target_type: 'listing', target_id: l.id, reason: 'احتيال' });
  assert.equal(rep.status, 201);
  assert.equal((await buyer.post('/api/reports', { target_type: 'listing', target_id: l.id, reason: 'احتيال' })).status, 409);
  assert.equal((await qaAdmin.get('/api/admin/reports')).data.reports.length, 0, 'بلاغات السعودية لا تظهر لمدير قطر');
  const all = (await adminC.get('/api/admin/reports')).data.reports;
  assert.equal(all.length, 1);
  await adminC.post(`/api/admin/reports/${all[0].id}`, { action: 'remove' });
  assert.equal((await client(srv.base).get('/api/listings/' + l.id)).status, 404);
});

test('اكتشاف الصور المكررة بين البائعين → تنبيه مراجعة', async () => {
  const l = (await buyer.post('/api/listings', { title: 'مكرر', description: 'x', price: 5, country_code: 'QA' })).data.listing;
  const up = await buyer.post(`/api/listings/${l.id}/photos`, { data_base64: PNG_1x1 });
  assert.equal(up.data.flagged, true);
  assert.ok((await adminC.get('/api/admin/alerts')).data.alerts.some(a => a.kind === 'duplicate_photo'));
});

let auction;
test('المزادات: إنشاء ← موافقة ← مزايدة على الخادم ← تمديد ← إغلاق وصفقة', async () => {
  const r = await seller.post('/api/auctions', { title: 'مزاد فحل', start_price: 10000, min_increment: 500, reserve_price: 11000, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), country_code: 'QA' });
  assert.equal(r.status, 201, JSON.stringify(r.data)); auction = r.data.auction;
  assert.equal(auction.status, 'pending_review');
  assert.equal((await buyer.post(`/api/auctions/${auction.id}/bids`, { amount: 10000 })).status, 409, 'لا مزايدة قبل الموافقة');
  await adminC.post(`/api/admin/auctions/${auction.id}/review`, { approve: true });
  assert.equal((await seller.post(`/api/auctions/${auction.id}/bids`, { amount: 10000 })).status, 403, 'البائع لا يزايد');
  assert.equal((await buyer.post(`/api/auctions/${auction.id}/bids`, { amount: 9000 })).status, 409);
  assert.equal((await buyer.post(`/api/auctions/${auction.id}/bids`, { amount: 10000 })).status, 200);
  assert.equal((await buyer.post(`/api/auctions/${auction.id}/bids`, { amount: 10500 })).status, 409, 'صاحب أعلى مزايدة');
  const low = await buyer2.post(`/api/auctions/${auction.id}/bids`, { amount: 10200 });
  assert.equal(low.status, 409); assert.equal(low.data.min_next_bid, 10500);
  // تمديد ضد القنص
  db.run('UPDATE auctions SET starts_at=?, ends_at=? WHERE id=?', new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() + 30000).toISOString(), auction.id);
  const b2 = await buyer2.post(`/api/auctions/${auction.id}/bids`, { amount: 11000 });
  assert.equal(b2.data.extended, true);
  assert.ok(new Date(b2.data.auction.ends_at) - Date.now() > 100000);
  const nots = (await buyer.get('/api/notifications')).data.notifications;
  assert.ok(nots.some(n => n.kind === 'outbid'), 'إشعار تجاوز المزايدة');
  const view = (await buyer.get('/api/auctions/' + auction.id)).data.auction;
  assert.ok(view.bids.every(b => b.bidder === 'أنت' || /^مزايد \d$/.test(b.bidder)), 'هويات المزايدين مخفية');
  // سجل غير قابل للتعديل + سلسلة التجزئة
  assert.throws(() => db.run('UPDATE bids SET amount=1 WHERE auction_id=?', auction.id), /append-only/);
  assert.equal((await client(srv.base).get(`/api/auctions/${auction.id}/verify`)).data.valid, true);
  // إغلاق
  db.run('UPDATE auctions SET ends_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), auction.id);
  auctionsSvc.tick();
  const ended = (await buyer2.get('/api/auctions/' + auction.id)).data.auction;
  assert.equal(ended.status, 'ended'); assert.equal(ended.winner, 'أنت'); assert.equal(ended.final_price, 11000);
  assert.ok((await buyer2.get('/api/deals')).data.deals.some(d => d.source === 'auction' && d.amount === 11000));
  assert.equal((await buyer.post(`/api/auctions/${auction.id}/bids`, { amount: 20000 })).status, 409);
});

test('المزادات: تزامن المزايدات (لا يُقبل مبلغان متساويان) ورصد الأنماط غير المعتادة', async () => {
  const a = (await adminC.post('/api/auctions', { title: 'مزاد تزامن', start_price: 1000, min_increment: 100, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), country_code: 'QA' })).data.auction;
  assert.equal(a.status, 'live');
  const rs = await Promise.all([buyer.post(`/api/auctions/${a.id}/bids`, { amount: 1000 }), buyer2.post(`/api/auctions/${a.id}/bids`, { amount: 1000 })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  await (rs[0].status === 200 ? buyer2 : buyer).post(`/api/auctions/${a.id}/bids`, { amount: 5000 });
  const alerts = (await adminC.get('/api/admin/alerts')).data.alerts;
  assert.ok(alerts.some(x => x.target_id === a.id && x.kind === 'price_jump'));
});

test('الوسطاء وشركاء وسم: طلب ← اعتماد ← خدمة ← حملة ← رعاية ← كود خصم', async () => {
  assert.equal((await buyer.put('/api/brokers/me', { display_name: 'أبو سالم للوساطة', commission_percent: 2 })).status, 200);
  assert.equal((await client(srv.base).get('/api/brokers')).data.brokers[0].phone, null, 'رقم الوسيط للمسجلين فقط');
  const co = client(srv.base); await co.register('feed@t.qa');
  const ap = await co.post('/api/partner', { name_ar: 'أعلاف الخليج (تجريبي)', category: 'feed', country_code: 'QA' });
  assert.equal(ap.status, 201);
  assert.equal((await co.post('/api/partner/offerings', { title: 'شعير' })).status, 400, 'قبل الاعتماد');
  const cid = ap.data.company.id;
  await qaAdmin.post(`/api/admin/companies/${cid}`, { action: 'approve' });
  assert.equal((await co.post('/api/partner/offerings', { title: 'شعير مستورد', price: 75, unit: 'كيس' })).status, 201);
  const dir = (await client(srv.base).get('/api/directory?category=feed')).data.companies;
  assert.equal(dir.length, 1); assert.equal(dir[0].offerings.length, 1);
  const pkg = db.one("SELECT id FROM ad_packages WHERE placement='section_sponsor' LIMIT 1") || (() => { db.run("INSERT INTO ad_packages(id,name_ar,placement,duration_days,price) VALUES ('p1','رعاية قسم','section_sponsor',30,3000)"); return { id: 'p1' }; })();
  const camp = await co.post('/api/partner/campaigns', { package_id: pkg.id, section: 'herd', headline: 'شعير بسعر خاص', link: 'https://example.com' });
  assert.equal(camp.status, 201);
  assert.equal((await client(srv.base).get('/api/sponsor?section=herd')).data.sponsor, null, 'لا تظهر قبل التفعيل');
  await adminC.post(`/api/admin/campaigns/${camp.data.id}`, { action: 'activate' });
  const sp = (await client(srv.base).get('/api/sponsor?section=herd')).data.sponsor;
  assert.equal(sp.headline, 'شعير بسعر خاص');
  assert.equal((await client(srv.base).post(`/api/campaigns/${sp.id}/click`)).data.link, 'https://example.com');
  const mine = (await co.get('/api/partner')).data;
  assert.equal(mine.campaigns[0].impressions, 1); assert.equal(mine.campaigns[0].clicks, 1);
  assert.equal((await co.post('/api/partner/codes', { code: 'WASM10', percent: 10, max_uses: 1 })).status, 201);
  assert.equal((await buyer.post('/api/codes/redeem', { code: 'wasm10' })).data.percent, 10);
  assert.equal((await buyer2.post('/api/codes/redeem', { code: 'WASM10' })).status, 404, 'انتهت الاستخدامات');
  const stats = (await adminC.get('/api/admin/stats')).data;
  assert.equal(stats.campaign_revenue_qar, 3000);
});

test('الإحالات', async () => {
  const code = (await seller.get('/api/referral')).data.code;
  const c = client(srv.base); await c.register('ref@t.qa', { ref: code });
  assert.equal((await seller.get('/api/referral')).data.count, 1);
});

test('التثمين الاسترشادي: لا يظهر إلا مع صفقات مكتملة كافية', async () => {
  let v = (await client(srv.base).get('/api/valuation?breed=مجاهيم&sex=male&age_years=9')).data;
  assert.equal(v.available, false);
  for (let i = 0; i < 5; i++) db.run("INSERT INTO deals(id, source, seller_id, buyer_id, country_code, breed, sex, age_years, amount, currency, amount_qar, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    'd' + i, 'listing', uid('seller@t.qa'), uid('buyer@t.qa'), 'QA', 'مجاهيم', 'male', 9, 80000 + i * 5000, 'QAR', 80000 + i * 5000, 'completed');
  v = (await client(srv.base).get('/api/valuation?breed=مجاهيم&sex=male&age_years=9&country=QA')).data;
  assert.equal(v.available, true); assert.equal(v.median, 90000); assert.equal(v.samples, 5);
  assert.match(v.notice, /ليس سعراً مؤكداً/);
});

test('المجتمع والمزاين: منشور ← تعليق ← إعجاب ← بلاغ؛ مهرجان ← نتيجة ← ربط بمطية', async () => {
  const p = (await buyer.post('/api/posts', { body: 'وش أفضل علف للحيران؟', category: 'question' })).data.post;
  await seller.post(`/api/posts/${p.id}/comments`, { body: 'الشعير مع البرسيم' });
  assert.equal((await seller.post(`/api/posts/${p.id}/like`)).data.liked, true);
  const full = (await client(srv.base).get('/api/posts/' + p.id)).data.post;
  assert.equal(full.comments.length, 1); assert.equal(full.like_count, 1);
  assert.equal((await seller.del('/api/posts/' + p.id)).status, 404, 'لا يحذف منشور غيره');
  assert.equal((await buyer.post('/api/festivals', { name_ar: 'x', country_code: 'QA', starts_on: todayISO(), ends_on: todayISO() })).status, 403);
  const f = (await qaAdmin.post('/api/festivals', { name_ar: 'مهرجان تجريبي', country_code: 'QA', starts_on: addDays(todayISO(), -3), ends_on: addDays(todayISO(), -1) })).data;
  const res = (await qaAdmin.post(`/api/festivals/${f.id}/results`, { category: 'مغاتير — حقايق', rank: 1, camel_name: 'غلا' })).data.results;
  const c2 = (await buyer.post('/api/camels', { name: 'غلا', sex: 'female' })).data.camel;
  assert.equal((await buyer.post(`/api/festival-results/${res[0].id}/link`, { camel_id: c2.id })).status, 200);
  assert.ok((await buyer.get('/api/camels/' + c2.id)).data.camel.events.some(e => e.type === 'achievement'));
  assert.equal((await seller.post(`/api/festival-results/${res[0].id}/link`, { camel_id: c2.id })).status, 409);
});

test('لوحة الإدارة: الصلاحيات والإيقاف والأدوار والإعدادات', async () => {
  assert.equal((await buyer.get('/api/admin/stats')).status, 403);
  const s = (await qaAdmin.get('/api/admin/stats')).data; assert.equal(s.scope, 'QA'); assert.equal(s.by_country, null);
  assert.ok((await adminC.get('/api/admin/stats')).data.by_country.length === 6);
  assert.equal((await qaAdmin.post(`/api/admin/users/${uid('buyer@t.qa')}/role`, { role: 'super_admin' })).status, 403, 'مدير الدولة لا يمنح أدواراً');
  assert.equal((await qaAdmin.post(`/api/admin/users/${uid('buyer2@t.sa')}/suspend`, { suspended: true })).status, 403, 'خارج نطاقه');
  assert.equal((await qaAdmin.post(`/api/admin/users/${uid('buyer@t.qa')}/suspend`, { suspended: true })).status, 200);
  assert.equal((await buyer.get('/api/me')).status, 401, 'الإيقاف ينهي الجلسات');
  await qaAdmin.post(`/api/admin/users/${uid('buyer@t.qa')}/suspend`, { suspended: false });
  assert.equal((await adminC.patch('/api/admin/settings', { deal_commission_percent: 2 })).data.settings.deal_commission_percent, '2');
  assert.equal((await qaAdmin.patch('/api/admin/settings', { deal_commission_percent: 3 })).status, 403);
});

test('المساعد: تثمين استرشادي بدون اختراع', async () => {
  const c = client(srv.base); await c.register('ai@t.qa');
  await c.post('/api/camels', { name: 'سلطان', sex: 'male', breed: 'نادرة', birth_date: addDays(todayISO(), -3000) });
  const r = await c.post('/api/ai/messages', { text: 'كم تسوى سلطان؟' });
  assert.match(r.data.reply, /ما أقدر أعطيك تثميناً/);
});

test('البث المباشر SSE يستقبل تحديث المزاد', async () => {
  const a = (await adminC.post('/api/auctions', { title: 'مزاد مباشر', start_price: 100, min_increment: 10, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), country_code: 'QA' })).data.auction;
  const ctrl = new AbortController();
  const res = await fetch(`${srv.base}/api/stream?auction=${a.id}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  await new Promise(r => setTimeout(r, 50));
  await seller.post(`/api/auctions/${a.id}/bids`, { amount: 100 });
  let txt = ''; const dec = new TextDecoder();
  for (let i = 0; i < 5 && !txt.includes('event: bid'); i++) { const { value } = await reader.read(); txt += dec.decode(value); }
  ctrl.abort();
  assert.match(txt, /event: bid/);
  assert.match(txt, /"current_price":100/);
});
