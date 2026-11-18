'use strict';
// المرحلة 3: المزادات — كل مزايدة تُعالج على الخادم داخل معاملة متسلسلة، بسجل إلحاقي مربوط بتجزئة متسلسلة.
// المساعد الذكي لا يملك أي مسار للمزايدة.
const db = require('../lib/db');
const { HttpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const { id, sha256 } = require('../lib/util');
const { notify, toTopic } = require('../lib/realtime');
const access = require('../lib/access');
const market = require('./market.service');
const herd = require('./herd.service');

const bad = (c, m) => new HttpError(400, c, m);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const COUNTRIES = ['SA', 'QA', 'AE', 'KW', 'BH', 'OM'];
const nowISO = () => new Date().toISOString();
const userName = uid => (db.one('SELECT display_name FROM users WHERE id=?', uid) || {}).display_name || 'مستخدم';

function createAuction(ctx, input) {
  access.requireActive(ctx);
  const title = str(input.title, 120); if (!title) throw bad('title_required', 'عنوان المزاد مطلوب');
  const country = COUNTRIES.includes(input.country_code) ? input.country_code : ctx.user.country_code;
  const start = Number(input.start_price), inc = Number(input.min_increment) || Math.max(100, Math.round(start * 0.02));
  if (!(start > 0 && start < 1e9)) throw bad('invalid_price', 'سعر البداية غير صحيح');
  if (!(inc > 0 && inc <= start)) throw bad('invalid_increment', 'الحد الأدنى للزيادة غير صحيح');
  const reserve = input.reserve_price ? Number(input.reserve_price) : null;
  if (reserve != null && !(reserve >= start)) throw bad('invalid_reserve', 'السعر الأدنى للبيع يجب أن يكون أكبر من سعر البداية أو يساويه');
  const startsAt = new Date(input.starts_at || Date.now()), endsAt = new Date(input.ends_at);
  if (isNaN(startsAt) || isNaN(endsAt)) throw bad('invalid_dates', 'حدد تاريخ البداية والنهاية');
  if (startsAt < Date.now() - 5 * 60000) throw bad('start_past', 'تاريخ البداية في الماضي');
  if (endsAt - startsAt < 10 * 60000) throw bad('too_short', 'مدة المزاد لا تقل عن 10 دقائق');
  if (endsAt - startsAt > 30 * 86400000) throw bad('too_long', 'مدة المزاد لا تزيد عن 30 يوماً');
  let camel = null, listing = null;
  if (input.camel_id) camel = herd.ownedCamel(ctx.user, input.camel_id);
  if (input.listing_id) { listing = db.one('SELECT * FROM listings WHERE id=? AND seller_id=?', input.listing_id, ctx.user.id); if (!listing) throw bad('invalid_listing', 'الإعلان غير موجود'); }
  const auto = access.isAdmin(ctx.user) || access.setting('listing_auto_approve', '0') === '1';
  const aid = id();
  const status = auto ? (startsAt <= Date.now() ? 'live' : 'scheduled') : 'pending_review';
  db.run(`INSERT INTO auctions(id, seller_id, listing_id, camel_id, country_code, title, description, breed, sex, age_years, currency, start_price, min_increment, reserve_price,
    starts_at, ends_at, original_ends_at, anti_snipe_seconds, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    aid, ctx.user.id, listing ? listing.id : null, camel ? camel.id : null, country, title, str(input.description, 3000),
    str(input.breed, 60) || (camel && camel.breed) || (listing && listing.breed), ['female', 'male'].includes(input.sex) ? input.sex : (camel ? camel.sex : listing ? listing.sex : null),
    input.age_years ? Number(input.age_years) : (listing ? listing.age_years : null), access.CURRENCY_OF[country], start, inc, reserve,
    startsAt.toISOString(), endsAt.toISOString(), endsAt.toISOString(), Number(access.setting('auction_anti_snipe_seconds', '120')), status);
  audit(ctx, 'create', 'auction', aid, { after: { title, start, status } });
  if (!auto) market.notifyAdmins(country, { kind: 'review_auction', title: 'مزاد جديد بانتظار الموافقة', body: title, link: '#/admin/auctions' });
  return getAuction(ctx, aid);
}

function maskBidders(a, viewer) {
  const map = new Map(); let n = 0;
  return db.all('SELECT seq, id, bidder_id, amount, server_time, extended_to FROM bids WHERE auction_id=? ORDER BY seq DESC LIMIT 200', a.id).reverse().map(b => {
    if (!map.has(b.bidder_id)) map.set(b.bidder_id, ++n);
    return { seq: b.seq, amount: b.amount, time: b.server_time, extended: !!b.extended_to, bidder: viewer && viewer.id === b.bidder_id ? 'أنت' : `مزايد ${map.get(b.bidder_id)}`, mine: !!viewer && viewer.id === b.bidder_id };
  }).reverse();
}

function auctionOut(a, viewer, full = false) {
  const photo = a.listing_id ? db.one("SELECT id FROM media WHERE listing_id=? AND kind='photo' ORDER BY is_primary DESC LIMIT 1", a.listing_id) : null;
  const out = { id: a.id, title: a.title, country_code: a.country_code, breed: a.breed, sex: a.sex, age_years: a.age_years, currency: a.currency,
    start_price: a.start_price, min_increment: a.min_increment, current_price: a.current_price, bid_count: a.bid_count, starts_at: a.starts_at, ends_at: a.ends_at,
    status: a.status, photo_id: photo ? photo.id : null, listing_id: a.listing_id, is_demo: !!a.is_demo, server_time: nowISO(),
    min_next_bid: a.current_price ? a.current_price + a.min_increment : a.start_price, reserve_set: a.reserve_price != null,
    reserve_met: a.reserve_price == null ? null : (a.current_price || 0) >= a.reserve_price, leading: !!viewer && viewer.id === a.current_winner_id };
  if (full) Object.assign(out, { description: a.description, seller: { id: a.seller_id, name: userName(a.seller_id) }, is_seller: !!viewer && viewer.id === a.seller_id,
    bids: maskBidders(a, viewer), anti_snipe_seconds: a.anti_snipe_seconds, extended: a.ends_at !== a.original_ends_at,
    winner: a.status === 'ended' ? (a.winner_id ? (viewer && viewer.id === a.winner_id ? 'أنت' : 'تم البيع') : (a.bid_count ? 'لم يبلغ السعر الأدنى' : 'بدون مزايدات')) : null,
    final_price: a.final_price, watching: viewer ? !!db.one('SELECT 1 FROM auction_watchers WHERE auction_id=? AND user_id=?', a.id, viewer.id) : false, cancel_reason: a.cancel_reason,
    rules: 'المزايدة ملزمة. تُعالج كل مزايدة على الخادم بتوقيت الخادم. أي مزايدة في آخر ' + Math.round(a.anti_snipe_seconds / 60) + ' دقيقة تمدد المزاد تلقائياً. السجل غير قابل للتعديل.' });
  return out;
}

function getAuction(ctx, aid) {
  const a = db.one('SELECT * FROM auctions WHERE id=?', aid);
  const viewer = ctx.user;
  if (!a || (['pending_review', 'rejected'].includes(a.status) && !(viewer && (viewer.id === a.seller_id || access.isAdmin(viewer))))) throw new HttpError(404, 'not_found', 'المزاد غير موجود');
  return auctionOut(a, viewer, true);
}

function listAuctions(ctx, q) {
  const g = k => q.get(k);
  const where = []; const p = [];
  const st = g('status');
  if (st === 'mine' && ctx.user) { where.push('(seller_id=? OR id IN (SELECT auction_id FROM bids WHERE bidder_id=?) OR id IN (SELECT auction_id FROM auction_watchers WHERE user_id=?))'); p.push(ctx.user.id, ctx.user.id, ctx.user.id); }
  else if (['live', 'scheduled', 'ended'].includes(st)) { where.push('status=?'); p.push(st); }
  else where.push("status IN ('live','scheduled')");
  if (COUNTRIES.includes(g('country'))) { where.push('country_code=?'); p.push(g('country')); }
  return { auctions: db.all(`SELECT * FROM auctions WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, ends_at ASC LIMIT 100`, ...p).map(a => auctionOut(a, ctx.user)) };
}

function placeBid(ctx, aid, rawAmount) {
  access.requireActive(ctx);
  const amount = Math.round(Number(rawAmount) * 100) / 100;
  if (!(amount > 0 && amount < 1e9)) throw bad('invalid_amount', 'المبلغ غير صحيح');
  let prevLeader = null, a2, extendedTo = null;
  db.tx(() => {
    const a = db.one('SELECT * FROM auctions WHERE id=?', aid);
    if (!a) throw new HttpError(404, 'not_found', 'المزاد غير موجود');
    const now = new Date();
    if (a.status === 'scheduled' && new Date(a.starts_at) <= now) { db.run("UPDATE auctions SET status='live' WHERE id=?", a.id); a.status = 'live'; }
    if (a.status !== 'live') throw new HttpError(409, 'not_live', a.status === 'scheduled' ? 'المزاد لم يبدأ بعد' : 'المزاد غير متاح للمزايدة');
    if (new Date(a.ends_at) <= now) throw new HttpError(409, 'ended', 'انتهى وقت المزاد');
    if (a.seller_id === ctx.user.id) throw new HttpError(403, 'own_auction', 'لا يمكنك المزايدة على مزادك');
    if (a.current_winner_id === ctx.user.id) throw new HttpError(409, 'already_leading', 'أنت صاحب أعلى مزايدة حالياً');
    const min = a.current_price ? a.current_price + a.min_increment : a.start_price;
    if (amount < min) throw new HttpError(409, 'too_low', `أقل مزايدة مقبولة الآن ${min.toLocaleString('en')} ${a.currency}`, { min_next_bid: min });
    if (amount > Math.max(min * 20, min + 1e6)) throw bad('too_high', 'المبلغ أكبر من المعقول — تأكد من عدد الأصفار');
    const last = db.one('SELECT hash FROM bids WHERE auction_id=? ORDER BY seq DESC LIMIT 1', a.id);
    const bidId = id(); const t = now.toISOString();
    let endsAt = a.ends_at;
    if (new Date(a.ends_at) - now < a.anti_snipe_seconds * 1000) { endsAt = new Date(now.getTime() + a.anti_snipe_seconds * 1000).toISOString(); extendedTo = endsAt; }
    const prevHash = last ? last.hash : null;
    const hash = sha256([prevHash || 'genesis', bidId, a.id, ctx.user.id, amount.toFixed(2), t].join('|'));
    db.run('INSERT INTO bids(id, auction_id, bidder_id, amount, server_time, ip, prev_hash, hash, extended_to) VALUES (?,?,?,?,?,?,?,?,?)', bidId, a.id, ctx.user.id, amount, t, ctx.ip || null, prevHash, hash, extendedTo);
    db.run('UPDATE auctions SET current_price=?, current_winner_id=?, bid_count=bid_count+1, ends_at=? WHERE id=?', amount, ctx.user.id, endsAt, a.id);
    prevLeader = a.current_winner_id;
    a2 = db.one('SELECT * FROM auctions WHERE id=?', a.id);
  });
  db.run('INSERT OR IGNORE INTO auction_watchers(auction_id, user_id) VALUES (?,?)', aid, ctx.user.id);
  if (prevLeader && prevLeader !== ctx.user.id) notify(prevLeader, { kind: 'outbid', title: `تم تجاوز مزايدتك في «${a2.title}»`, body: `أعلى مزايدة الآن ${a2.current_price.toLocaleString('en')} ${a2.currency}`, link: `#/auction/${aid}` });
  notify(a2.seller_id, { kind: 'bid', title: `مزايدة جديدة على «${a2.title}»`, body: `${a2.current_price.toLocaleString('en')} ${a2.currency}`, link: `#/auction/${aid}`, dedupeKey: `bid:${aid}:${Math.floor(Date.now() / 300000)}` });
  toTopic('auction:' + aid, 'bid', { auction_id: aid, current_price: a2.current_price, bid_count: a2.bid_count, ends_at: a2.ends_at, extended: !!extendedTo, min_next_bid: a2.current_price + a2.min_increment, server_time: nowISO() });
  detectAnomalies(a2, ctx);
  audit(ctx, 'bid', 'auction', aid, { after: { amount } });
  return { ok: true, auction: getAuction(ctx, aid), extended: !!extendedTo };
}

// رصد أنماط المزايدة غير المعتادة → تنبيهات للمراجعة البشرية (لا قرارات آلية)
function detectAnomalies(a, ctx) {
  const alerts = [];
  const bids = db.all('SELECT * FROM bids WHERE auction_id=? ORDER BY seq', a.id);
  const lastBid = bids[bids.length - 1];
  const sellerIps = new Set(db.all('SELECT ip FROM sessions WHERE user_id=? AND ip IS NOT NULL', a.seller_id).map(r => r.ip).filter(ip => ip && !['127.0.0.1', '::1', '::ffff:127.0.0.1', 'seed'].includes(ip)));
  if (lastBid.ip && sellerIps.has(lastBid.ip)) alerts.push(['high', 'same_ip_as_seller', 'مزايد يستخدم نفس عنوان الشبكة الذي يستخدمه البائع', { bidder: lastBid.bidder_id, ip: lastBid.ip }]);
  const byIp = {};
  for (const b of bids) if (b.ip && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(b.ip)) (byIp[b.ip] = byIp[b.ip] || new Set()).add(b.bidder_id);
  for (const [ip, set] of Object.entries(byIp)) if (set.size > 1) alerts.push(['medium', 'shared_ip_bidders', 'أكثر من مزايد من نفس عنوان الشبكة', { ip, bidders: [...set] }]);
  const u = db.one('SELECT created_at FROM users WHERE id=?', lastBid.bidder_id);
  if (u && Date.now() - new Date(u.created_at) < 86400000 && lastBid.amount > a.start_price * 3) alerts.push(['medium', 'new_account_high_bid', 'حساب جديد (أقل من يوم) بمزايدة تتجاوز 3 أضعاف سعر البداية', { bidder: lastBid.bidder_id, amount: lastBid.amount }]);
  if (bids.length >= 2) { const prev = bids[bids.length - 2]; if (lastBid.amount > prev.amount * 2) alerts.push(['low', 'price_jump', 'قفزة مفاجئة تتجاوز ضعف المزايدة السابقة', { from: prev.amount, to: lastBid.amount }]); }
  const recent = bids.filter(b => Date.now() - new Date(b.server_time) < 120000);
  if (recent.length >= 8 && new Set(recent.map(b => b.bidder_id)).size === 2) alerts.push(['low', 'rapid_pair', 'تناوب سريع بين مزايدَين اثنين فقط خلال دقيقتين', { count: recent.length }]);
  for (const [sev, kind, reason, ev] of alerts) {
    if (db.one("SELECT 1 FROM ai_alerts WHERE target_type='auction' AND target_id=? AND kind=? AND status='open'", a.id, kind)) continue;
    db.run('INSERT INTO ai_alerts(id, kind, target_type, target_id, country_code, severity, reason, evidence_json) VALUES (?,?,?,?,?,?,?,?)', id(), kind, 'auction', a.id, a.country_code, sev, reason, JSON.stringify(ev));
    if (sev === 'high') market.notifyAdmins(a.country_code, { kind: 'ai_alert', title: 'تنبيه مزايدة غير معتادة', body: `${a.title}: ${reason}`, link: '#/admin/alerts' });
  }
}

function verifyChain(aid) {
  let prev = null;
  for (const b of db.all('SELECT * FROM bids WHERE auction_id=? ORDER BY seq', aid)) {
    const h = sha256([prev || 'genesis', b.id, b.auction_id, b.bidder_id, Number(b.amount).toFixed(2), b.server_time].join('|'));
    if (b.prev_hash !== prev || b.hash !== h) return { valid: false, broken_at: b.seq };
    prev = b.hash;
  }
  return { valid: true };
}

function toggleWatch(ctx, aid) {
  getAuction(ctx, aid);
  const r = db.run('DELETE FROM auction_watchers WHERE auction_id=? AND user_id=?', aid, ctx.user.id);
  if (!r.changes) db.run('INSERT INTO auction_watchers(auction_id, user_id) VALUES (?,?)', aid, ctx.user.id);
  return { watching: !r.changes };
}

function cancelAuction(ctx, aid, reason) {
  const a = db.one('SELECT * FROM auctions WHERE id=?', aid);
  if (!a) throw new HttpError(404, 'not_found', 'المزاد غير موجود');
  const admin = access.isAdmin(ctx.user);
  if (admin) access.inScope(access.adminScope(ctx.user), a.country_code);
  else if (a.seller_id !== ctx.user.id) throw new HttpError(404, 'not_found', 'المزاد غير موجود');
  if (!admin && a.bid_count > 0) throw bad('has_bids', 'لا يمكن إلغاء مزاد عليه مزايدات — تواصل مع الإدارة');
  if (['ended', 'cancelled'].includes(a.status)) throw bad('closed', 'المزاد مغلق');
  db.run("UPDATE auctions SET status='cancelled', cancel_reason=? WHERE id=?", str(reason, 300) || (admin ? 'أُلغي من الإدارة' : 'أُلغي من البائع'), aid);
  for (const w of db.all('SELECT user_id FROM auction_watchers WHERE auction_id=?', aid)) notify(w.user_id, { kind: 'auction', title: `أُلغي المزاد «${a.title}»`, link: `#/auction/${aid}` });
  toTopic('auction:' + aid, 'status', { status: 'cancelled' });
  audit(ctx, 'cancel', 'auction', aid, { after: { reason } });
  return { ok: true };
}

function reviewAuction(ctx, aid, approve, reason) {
  const scope = access.requireAdmin(ctx);
  const a = db.one('SELECT * FROM auctions WHERE id=?', aid);
  if (!a || a.status !== 'pending_review') throw new HttpError(404, 'not_found', 'لا يوجد مزاد بانتظار المراجعة');
  access.inScope(scope, a.country_code);
  const status = approve ? (new Date(a.starts_at) <= Date.now() ? 'live' : 'scheduled') : 'rejected';
  db.run('UPDATE auctions SET status=?, cancel_reason=? WHERE id=?', status, approve ? null : str(reason, 300), aid);
  notify(a.seller_id, { kind: 'auction', title: approve ? `تمت الموافقة على مزادك «${a.title}»` : `رُفض مزادك «${a.title}»`, body: approve ? null : reason, link: `#/auction/${aid}` });
  audit(ctx, approve ? 'approve' : 'reject', 'auction', aid);
  return { ok: true, status };
}

// المجدول: بدء المزادات، تنبيه قرب الانتهاء، الإغلاق وتسجيل الفائز
function tick(now = new Date()) {
  const t = now.toISOString();
  for (const a of db.all("SELECT * FROM auctions WHERE status='scheduled' AND starts_at <= ?", t)) {
    db.run("UPDATE auctions SET status='live' WHERE id=?", a.id);
    for (const w of db.all('SELECT user_id FROM auction_watchers WHERE auction_id=?', a.id)) notify(w.user_id, { kind: 'auction', title: `بدأ المزاد «${a.title}»`, link: `#/auction/${a.id}`, dedupeKey: `start:${a.id}` });
    toTopic('auction:' + a.id, 'status', { status: 'live' });
  }
  for (const a of db.all("SELECT * FROM auctions WHERE status='live' AND ending_notified=0 AND ends_at <= ? AND ends_at > ?", new Date(now.getTime() + 15 * 60000).toISOString(), t)) {
    db.run('UPDATE auctions SET ending_notified=1 WHERE id=?', a.id);
    const users = new Set([...db.all('SELECT user_id FROM auction_watchers WHERE auction_id=?', a.id).map(r => r.user_id), ...db.all('SELECT DISTINCT bidder_id AS user_id FROM bids WHERE auction_id=?', a.id).map(r => r.user_id)]);
    for (const u of users) notify(u, { kind: 'auction_ending', title: `المزاد «${a.title}» ينتهي خلال 15 دقيقة`, link: `#/auction/${a.id}`, dedupeKey: `ending:${a.id}` });
  }
  for (const a of db.all("SELECT * FROM auctions WHERE status='live' AND ends_at <= ?", t)) {
    const reserveMet = a.current_winner_id && (a.reserve_price == null || a.current_price >= a.reserve_price);
    db.tx(() => {
      const cur = db.one("SELECT * FROM auctions WHERE id=? AND status='live'", a.id); if (!cur) return;
      db.run("UPDATE auctions SET status='ended', winner_id=?, final_price=?, reserve_met=? WHERE id=?", reserveMet ? a.current_winner_id : null, reserveMet ? a.current_price : null, a.reserve_price == null ? null : (reserveMet ? 1 : 0), a.id);
      if (reserveMet) {
        market.createDeal({ source: 'auction', source_id: a.id, seller_id: a.seller_id, buyer_id: a.current_winner_id, broker_id: null, camel_id: a.camel_id, country_code: a.country_code,
          breed: a.breed, sex: a.sex, age_years: a.age_years, color: null, amount: a.current_price, currency: a.currency, summary: `فوز بالمزاد «${a.title}» بعد ${a.bid_count} مزايدة` });
        if (a.listing_id) db.run("UPDATE listings SET status='reserved' WHERE id=? AND status='active'", a.listing_id);
      }
    });
    if (reserveMet) {
      notify(a.current_winner_id, { kind: 'auction_won', title: `مبروك! فزت بالمزاد «${a.title}»`, body: `${a.current_price.toLocaleString('en')} ${a.currency}`, link: '#/deals', dedupeKey: `won:${a.id}` });
      notify(a.seller_id, { kind: 'auction_sold', title: `انتهى مزادك «${a.title}» بالبيع`, body: `${a.current_price.toLocaleString('en')} ${a.currency}`, link: '#/deals', dedupeKey: `sold:${a.id}` });
    } else notify(a.seller_id, { kind: 'auction_ended', title: `انتهى مزادك «${a.title}» ${a.bid_count ? 'دون بلوغ السعر الأدنى' : 'بدون مزايدات'}`, link: `#/auction/${a.id}`, dedupeKey: `end:${a.id}` });
    for (const w of db.all('SELECT user_id FROM auction_watchers WHERE auction_id=? AND user_id<>?', a.id, a.current_winner_id || '')) notify(w.user_id, { kind: 'auction_ended', title: `انتهى المزاد «${a.title}»`, link: `#/auction/${a.id}`, dedupeKey: `end:${a.id}` });
    toTopic('auction:' + a.id, 'status', { status: 'ended' });
  }
}

module.exports = { createAuction, getAuction, listAuctions, placeBid, verifyChain, toggleWatch, cancelAuction, reviewAuction, tick, detectAnomalies };
