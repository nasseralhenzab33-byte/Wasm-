'use strict';
const db = require('./db');

function audit(ctx, action, entity, entityId, { camelId = null, before = null, after = null } = {}) {
  let diff = null;
  if (before || after) {
    diff = {};
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const k of keys) {
      if (['updated_at', 'created_at', 'name_norm'].includes(k)) continue;
      const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
      if (a !== b) diff[k] = [a ?? null, b ?? null];
    }
  }
  db.run('INSERT INTO audit_log(actor_id,action,entity,entity_id,camel_id,diff_json,ip) VALUES (?,?,?,?,?,?,?)',
    ctx.user ? ctx.user.id : null, action, entity, entityId, camelId, diff ? JSON.stringify(diff) : null, ctx.ip || null);
}

module.exports = { audit };
