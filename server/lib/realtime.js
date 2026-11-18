'use strict';
// البث المباشر عبر Server-Sent Events (SSE) — بديل بلا اعتماديات عن WebSockets.
// المزايدة نفسها تُرسل بطلب POST يُتحقق منه على الخادم؛ البث للاتجاه الواحد (من الخادم للمتصفح) يكفي
// لتحديث السعر وسجل المزايدات والإشعارات فوراً، ويعمل عبر البروكسيات بسهولة.
// للتوسع على أكثر من خادم: استبدل الـ Map بقناة Redis Pub/Sub.
const db = require('./db');
const { id } = require('./util');

const userStreams = new Map();    // userId -> Set(res)
const topicStreams = new Map();   // topic (auction:<id>) -> Set(res)

function add(map, key, res) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(res); }
function remove(map, key, res) { const s = map.get(key); if (s) { s.delete(res); if (!s.size) map.delete(key); } }
function write(res, event, data) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } }

function open(req, res, { userId, topics = [] }) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (userId) add(userStreams, userId, res);
  for (const t of topics) add(topicStreams, t, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* */ } }, 25000);
  req.on('close', () => { clearInterval(ping); if (userId) remove(userStreams, userId, res); for (const t of topics) remove(topicStreams, t, res); });
}

function toUser(userId, event, data) { for (const r of userStreams.get(userId) || []) write(r, event, data); }
function toTopic(topic, event, data) { for (const r of topicStreams.get(topic) || []) write(r, event, data); }

// إشعار داخل التطبيق (+ بث فوري). dedupeKey يمنع تكرار نفس الإشعار.
function notify(userId, { kind, title, body = null, link = null, dedupeKey = null }) {
  const nid = id();
  const r = db.run('INSERT OR IGNORE INTO notifications(id, user_id, kind, title, body, link, dedupe_key) VALUES (?,?,?,?,?,?,?)', nid, userId, kind, title, body, link, dedupeKey);
  if (r.changes) toUser(userId, 'notification', { id: nid, kind, title, body, link });
  return r.changes > 0;
}

module.exports = { open, toUser, toTopic, notify, _stats: () => ({ users: userStreams.size, topics: topicStreams.size }) };
