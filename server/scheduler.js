'use strict';
// مهام دورية: المزادات (بدء/تنبيه/إغلاق)، الحملات والعقود، وتحويل تنبيهات الحلال إلى إشعارات
const db = require('./lib/db');
const { notify } = require('./lib/realtime');
const herd = require('./modules/herd.service');
const auctions = require('./modules/auction.service');
const partner = require('./modules/partner.service');

let lastHerd = 0;
function herdAlerts() {
  for (const u of db.all("SELECT DISTINCT u.* FROM users u JOIN camels c ON c.owner_id=u.id WHERE u.is_suspended=0")) {
    for (const a of herd.alerts(u)) {
      if (a.kind === 'confirm_pregnancy') continue;
      notify(u.id, { kind: 'herd_' + a.kind, title: a.kind === 'follow_up' ? 'متابعة صحية' : 'موعد ولادة', body: a.text, link: `#/camel/${a.camel_id}`, dedupeKey: `herd:${a.kind}:${a.camel_id}:${a.date}:${a.days < 0 ? 'late' : a.days <= 3 ? 'soon' : 'win'}` });
    }
  }
}
function tick() {
  try { auctions.tick(); } catch (e) { console.error('[scheduler] auctions', e); }
  try { partner.tick(); } catch (e) { console.error('[scheduler] partners', e); }
  if (Date.now() - lastHerd > 3600000) { lastHerd = Date.now(); try { herdAlerts(); } catch (e) { console.error('[scheduler] herd', e); } }
}
function start(ms = 15000) { tick(); return setInterval(tick, ms).unref(); }
module.exports = { start, tick, herdAlerts };
