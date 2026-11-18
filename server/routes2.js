'use strict';
// مسارات المراحل 2–4
const db = require('./lib/db');
const auth = require('./lib/auth');
const { HttpError, rateLimiter } = require('./lib/http');
const realtime = require('./lib/realtime');
const market = require('./modules/market.service');
const auctions = require('./modules/auction.service');
const partner = require('./modules/partner.service');
const community = require('./modules/community.service');
const admin = require('./modules/admin.service');

const bidLimit = rateLimiter({ windowMs: 60000, max: 30 });
const writeLimit = rateLimiter({ windowMs: 60000, max: 60 });
const A = ctx => auth.requireAuth(ctx);
const W = ctx => { auth.requireAuth(ctx); writeLimit(ctx.user.id); };
const BIG = { bodyLimit: 7 * 1024 * 1024 };

module.exports = function register(r) {
  // ===== السوق =====
  r.get('/api/listings', ctx => market.browse(ctx, ctx.query));
  r.post('/api/listings', ctx => { W(ctx); return { status: 201, body: { listing: market.createListing(ctx, ctx.body) } }; });
  r.post('/api/listings/draft', ctx => { A(ctx); return require('./modules/ai/assistant').listingDescription(ctx.user, ctx.body.camel_id); });
  r.get('/api/listings/recommended', ctx => ({ listings: market.recommended(ctx) }));
  r.get('/api/listings/compare', ctx => market.compare(ctx, ctx.query.get('ids')));
  r.get('/api/listings/:id', ctx => ({ listing: market.getListing(ctx, ctx.params.id, { countView: true }) }));
  r.get('/api/listings/:id/similar', ctx => ({ listings: market.recommended(ctx, { listingId: ctx.params.id, limit: 4 }) }));
  r.patch('/api/listings/:id', ctx => { W(ctx); return { listing: market.updateListing(ctx, ctx.params.id, ctx.body) }; });
  r.post('/api/listings/:id/favorite', ctx => { A(ctx); return market.toggleFavorite(ctx, ctx.params.id); });
  r.post('/api/listings/:id/photos', ctx => { W(ctx); return { status: 201, body: market.uploadListingPhoto(ctx, ctx.params.id, ctx.body) }; }, BIG);
  r.post('/api/listings/:id/offers', ctx => { W(ctx); return { status: 201, body: market.makeOffer(ctx, ctx.params.id, ctx.body) }; });
  r.post('/api/listings/:id/messages', ctx => { W(ctx); return { status: 201, body: market.startConversation(ctx, ctx.params.id, ctx.body.body) }; });
  r.get('/api/listing-photos/:id', ctx => { const { buf, mime } = market.listingPhoto(ctx, ctx.params.id); return { raw: buf, type: mime }; });
  r.post('/api/offers/:id/respond', ctx => { W(ctx); return market.respondOffer(ctx, ctx.params.id, ctx.body); });
  r.post('/api/reports', ctx => { W(ctx); return { status: 201, body: market.report(ctx, ctx.body) }; });
  r.get('/api/conversations', ctx => { A(ctx); return { conversations: market.listConversations(ctx) }; });
  r.get('/api/conversations/:id', ctx => { A(ctx); return market.getConversation(ctx, ctx.params.id); });
  r.post('/api/conversations/:id/messages', ctx => { W(ctx); return { status: 201, body: market.sendMessage(ctx, ctx.params.id, ctx.body.body) }; });
  r.get('/api/conversations/:id/summary', ctx => { A(ctx); return market.summarizeConversation(ctx, ctx.params.id); });
  r.get('/api/deals', ctx => { A(ctx); return { deals: market.myDeals(ctx) }; });
  r.patch('/api/deals/:id', ctx => { W(ctx); return { deal: market.updateDeal(ctx, ctx.params.id, ctx.body) }; });
  r.get('/api/valuation', ctx => market.valuation({ breed: ctx.query.get('breed'), sex: ctx.query.get('sex'), age_years: ctx.query.get('age_years'), country: ctx.query.get('country') }));

  // ===== الإشعارات والبث المباشر =====
  r.get('/api/notifications', ctx => { A(ctx); return { notifications: db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100', ctx.user.id) }; });
  r.post('/api/notifications/read', ctx => { A(ctx); db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', new Date().toISOString(), ctx.user.id); return { ok: true }; });
  r.get('/api/unread', ctx => {
    if (!ctx.user) return { notifications: 0, messages: 0 };
    const msgs = market.listConversations(ctx).reduce((s, c) => s + c.unread, 0);
    return { notifications: db.one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL', ctx.user.id).n, messages: msgs };
  });
  r.get('/api/stream', ctx => {
    const topics = []; const a = ctx.query.get('auction');
    if (a && /^[0-9a-f-]{36}$/.test(a)) topics.push('auction:' + a);
    realtime.open(ctx.req, ctx.res, { userId: ctx.user ? ctx.user.id : null, topics });
    return { stream: true };
  });

  // ===== المزادات =====
  r.get('/api/auctions', ctx => auctions.listAuctions(ctx, ctx.query));
  r.post('/api/auctions', ctx => { W(ctx); return { status: 201, body: { auction: auctions.createAuction(ctx, ctx.body) } }; });
  r.get('/api/auctions/:id', ctx => ({ auction: auctions.getAuction(ctx, ctx.params.id) }));
  r.get('/api/auctions/:id/verify', ctx => auctions.verifyChain(ctx.params.id));
  r.post('/api/auctions/:id/bids', ctx => { A(ctx); bidLimit(ctx.user.id); return auctions.placeBid(ctx, ctx.params.id, ctx.body.amount); });
  r.post('/api/auctions/:id/watch', ctx => { A(ctx); return auctions.toggleWatch(ctx, ctx.params.id); });
  r.post('/api/auctions/:id/cancel', ctx => { A(ctx); return auctions.cancelAuction(ctx, ctx.params.id, ctx.body.reason); });

  // ===== الوسطاء =====
  r.get('/api/brokers', ctx => partner.listBrokers(ctx, ctx.query));
  r.get('/api/brokers/me', ctx => { A(ctx); return { broker: db.one('SELECT * FROM broker_profiles WHERE user_id=?', ctx.user.id) || null }; });
  r.put('/api/brokers/me', ctx => { W(ctx); return partner.upsertBroker(ctx, ctx.body); });

  // ===== شركاء وسم =====
  r.get('/api/directory', ctx => partner.directory(ctx, ctx.query));
  r.get('/api/partner', ctx => { A(ctx); return partner.myCompany(ctx); });
  r.post('/api/partner', ctx => { W(ctx); return { status: 201, body: partner.applyCompany(ctx, ctx.body) }; });
  r.patch('/api/partner', ctx => { W(ctx); return partner.updateCompany(ctx, ctx.body); });
  r.post('/api/partner/offerings', ctx => { W(ctx); return { status: 201, body: partner.addOffering(ctx, ctx.body) }; });
  r.delete('/api/partner/offerings/:id', ctx => { A(ctx); return partner.deleteOffering(ctx, ctx.params.id); });
  r.post('/api/partner/campaigns', ctx => { W(ctx); return { status: 201, body: partner.createCampaign(ctx, ctx.body) }; });
  r.post('/api/partner/codes', ctx => { W(ctx); return { status: 201, body: partner.createCode(ctx, ctx.body) }; });
  r.get('/api/sponsor', ctx => partner.sponsorFor(String(ctx.query.get('section') || 'home')));
  r.post('/api/campaigns/:id/click', ctx => partner.clickCampaign(ctx.params.id));
  r.post('/api/codes/redeem', ctx => { A(ctx); return partner.redeemCode(ctx, ctx.body.code); });
  r.get('/api/referral', ctx => { A(ctx); return partner.myReferral(ctx); });

  // ===== المجتمع والمزاين =====
  r.get('/api/posts', ctx => community.listPosts(ctx, ctx.query));
  r.post('/api/posts', ctx => { W(ctx); return { status: 201, body: { post: community.createPost(ctx, ctx.body) } }; });
  r.get('/api/posts/:id', ctx => ({ post: community.getPost(ctx, ctx.params.id) }));
  r.delete('/api/posts/:id', ctx => { A(ctx); return community.deletePost(ctx, ctx.params.id); });
  r.post('/api/posts/:id/like', ctx => { A(ctx); return community.toggleLike(ctx, ctx.params.id); });
  r.post('/api/posts/:id/comments', ctx => { W(ctx); return { post: community.addComment(ctx, ctx.params.id, ctx.body.body) }; });
  r.get('/api/festivals', () => community.listFestivals());
  r.get('/api/festivals/:id', ctx => community.getFestival(ctx, ctx.params.id));
  r.post('/api/festivals', ctx => ({ status: 201, body: community.createFestival(ctx, ctx.body) }));
  r.post('/api/festivals/:id/results', ctx => community.addResult(ctx, ctx.params.id, ctx.body));
  r.post('/api/festival-results/:id/link', ctx => { A(ctx); return community.linkResult(ctx, ctx.params.id, ctx.body.camel_id); });

  // ===== الإدارة =====
  r.get('/api/admin/stats', ctx => admin.stats(ctx));
  r.get('/api/admin/listings', ctx => admin.pendingListings(ctx));
  r.post('/api/admin/listings/:id/review', ctx => admin.reviewListing(ctx, ctx.params.id, !!ctx.body.approve, ctx.body.reason));
  r.post('/api/admin/listings/:id/remove', ctx => admin.removeListing(ctx, ctx.params.id, ctx.body.reason));
  r.get('/api/admin/reports', ctx => admin.listReports(ctx, ctx.query));
  r.post('/api/admin/reports/:id', ctx => admin.handleReport(ctx, ctx.params.id, ctx.body));
  r.get('/api/admin/alerts', ctx => admin.listAlerts(ctx, ctx.query));
  r.post('/api/admin/alerts/:id', ctx => admin.reviewAlert(ctx, ctx.params.id, ctx.body));
  r.get('/api/admin/users', ctx => admin.listUsers(ctx, ctx.query));
  r.post('/api/admin/users/:id/suspend', ctx => admin.setSuspended(ctx, ctx.params.id, !!ctx.body.suspended));
  r.post('/api/admin/users/:id/role', ctx => admin.setRole(ctx, ctx.params.id, ctx.body));
  r.post('/api/admin/countries/:code', ctx => admin.setCountryActive(ctx, ctx.params.code, !!ctx.body.active));
  r.get('/api/admin/settings', ctx => admin.getSettings(ctx));
  r.patch('/api/admin/settings', ctx => admin.updateSettings(ctx, ctx.body));
  r.get('/api/admin/partners', ctx => admin.partnersAdmin(ctx));
  r.post('/api/admin/companies/:id', ctx => admin.reviewCompany(ctx, ctx.params.id, ctx.body));
  r.post('/api/admin/campaigns/:id', ctx => admin.reviewCampaign(ctx, ctx.params.id, ctx.body));
  r.post('/api/admin/packages', ctx => admin.savePackage(ctx, ctx.body));
  r.post('/api/admin/contracts', ctx => admin.addContract(ctx, ctx.body));
  r.get('/api/admin/auctions', ctx => admin.pendingAuctions(ctx));
  r.post('/api/admin/auctions/:id/review', ctx => auctions.reviewAuction(ctx, ctx.params.id, !!ctx.body.approve, ctx.body.reason));
};
