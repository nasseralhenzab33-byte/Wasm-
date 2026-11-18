// ===================== التخزين: ذاكرة + قاعدة بيانات الصفحة =====================
const { ageName, AGE_NAMES } = __mods['../../lib/ageNames'];
const NLU = __mods['./nlu'];
const { id: newId, todayISO, addDays, diffDays, isISODate, normalizeAr } = util;

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (code, msg) => new HttpError(400, code, msg);
const str = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const nowISO = () => new Date().toISOString();

const KINDS = { camel: 'c_', mating: 'm_', birth: 'b_', event: 'e_', photo: 'p_', farm: 'f_' };
const S = { camels: new Map(), matings: new Map(), births: new Map(), events: new Map(), photos: new Map(), farms: new Map(),
  settings: { gestation_days: 390, birth_alert_days: 14, ai_image_training_consent: false, country_code: 'QA', display_name: '' },
  log: [], chat: { messages: [], pending: {} } };
const MAPS = { camel: 'camels', mating: 'matings', birth: 'births', event: 'events', photo: 'photos', farm: 'farms' };

const Store = {
  db: null, uid: null, ready: false, coll: null, chains: new Map(), timers: {}, overlay: new Map(),
  async init(db, uid, onChange) {
    this.db = db; this.uid = uid;
    this.coll = db.collection('data/users/' + uid);
    return new Promise((resolve, reject) => {
      let first = true;
      const timer = setTimeout(() => { if (first) reject(new HttpError(503, 'timeout', 'تعذر الوصول إلى البيانات الآن، تأكد من الاتصال')); }, 12000);
      this.coll.onSnapshot(snap => {
        this.load(snap.docs);
        if (first && !snap.metadata.fromCache) { first = false; clearTimeout(timer); this.ready = true; resolve(); }
        else if (!first) onChange && onChange();
        else if (first && snap.metadata.fromCache && snap.size) { /* نعرض النسخة المحفوظة ونكمل الانتظار */ }
      }, e => { clearTimeout(timer); if (first) reject(new HttpError(503, e.code, 'تعذر تحميل البيانات (' + e.code + ')')); });
    });
  },
  load(docs) {
    for (const k of Object.values(MAPS)) S[k] = new Map();
    for (const d of docs) {
      const data = d.data(); if (!data) continue;
      if (d.id === 'settings') { if (this.overlay.has('settings')) continue; S.settings = { ...S.settings, ...data }; continue; }
      if (d.id === 'log') { if (!this.timers.log && !this.overlay.has('log')) S.log = data.items || []; continue; }
      if (d.id === 'chat') { if (this.timers.chat || this.overlay.has('chat')) continue; S.chat = { messages: data.messages || [], pending: data.pending || {} }; continue; }
      const kind = Object.keys(KINDS).find(k => d.id.startsWith(KINDS[k]));
      if (kind) S[MAPS[kind]].set(data.id, { ...data });
    }
    // الكتابات المحلية التي لم تُؤكَّد بعد تبقى هي الأحدث
    for (const [docId, data] of this.overlay) {
      if (docId === 'settings' || docId === 'log' || docId === 'chat') continue;
      const kind = Object.keys(KINDS).find(k => docId.startsWith(KINDS[k]));
      if (!kind) continue;
      if (data === null) S[MAPS[kind]].delete(docId.slice(KINDS[kind].length)); else S[MAPS[kind]].set(data.id, data);
    }
  },
  write(docId, data) { // كتابة واحدة في كل مرة لكل وثيقة
    const ref = this.coll.doc(docId);
    const token = {}; this.overlay.set(docId, data); this.overlay[docId + ':t'] = token;
    const prev = this.chains.get(docId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => (data === null ? ref.delete() : ref.set(JSON.parse(JSON.stringify(data)))))
      .catch(e => { window.dispatchEvent(new CustomEvent('wasm-save-error', { detail: e })); throw e; });
    this.chains.set(docId, next);
    next.then(() => { if (this.overlay[docId + ':t'] === token) this.overlay.delete(docId); }, () => {});
    return next;
  },
  debounced(docId, getData, ms = 800) {
    clearTimeout(this.timers[docId]);
    this.timers[docId] = setTimeout(() => { delete this.timers[docId]; this.write(docId, getData()); }, ms);
  },
  put(kind, obj) { S[MAPS[kind]].set(obj.id, obj); return this.write(KINDS[kind] + obj.id, obj); },
  del(kind, id) { S[MAPS[kind]].delete(id); return this.write(KINDS[kind] + id, null); },
  saveSettings() { return this.write('settings', S.settings); },
  saveChat() { this.debounced('chat', () => ({ messages: S.chat.messages.slice(-60), pending: S.chat.pending }), 300); },
  logAppend(entry) { S.log.push(entry); if (S.log.length > 700) S.log = S.log.slice(-700); this.debounced('log', () => ({ items: S.log })); },
};

function audit(action, entity, entityId, { camelId = null, before = null, after = null } = {}) {
  let diff = null;
  if (before || after) {
    diff = {};
    for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
      if (['updated_at', 'created_at', 'name_norm', 'id', 'owner_id'].includes(k)) continue;
      const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
      if (a !== b && (typeof a !== 'object' || a === null) && (typeof b !== 'object' || b === null)) diff[k] = [a ?? null, b ?? null];
    }
  }
  Store.logAppend({ action, entity, entity_id: entityId, camel_id: camelId, diff, created_at: nowISO() });
}
