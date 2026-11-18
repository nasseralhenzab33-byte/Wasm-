// ===================== واجهة برمجية محلية بنفس مسارات الخادم =====================
const ROUTES = [];
const R = (method, pattern, fn) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/?]+)'; }) + '$'); ROUTES.push({ method, re, keys, fn }); };
const ME = { id: 'me', email: '', display_name: '', role: 'owner' };
const meOut = () => ({ ...ME, ...S.settings, display_name: S.settings.display_name || ME.display_name || 'صاحب الحلال' });

R('GET', '/api/me', () => ({ user: meOut() }));
R('PATCH', '/api/me', b => {
  const u = {};
  if (b.display_name !== undefined) { const n = String(b.display_name).trim().slice(0, 60); if (n.length < 2) throw bad('invalid_name', 'الاسم قصير'); u.display_name = n; }
  if (b.phone !== undefined) u.phone = b.phone ? String(b.phone).slice(0, 20) : null;
  if (b.country_code !== undefined) u.country_code = b.country_code;
  if (b.gestation_days !== undefined) { const g = parseInt(b.gestation_days, 10); if (!(g >= 330 && g <= 420)) throw bad('invalid_gestation', 'المدة من اللقاح إلى الولادة بين 330 و 420 يوماً'); u.gestation_days = g; }
  if (b.birth_alert_days !== undefined) { const g = parseInt(b.birth_alert_days, 10); if (!(g >= 1 && g <= 60)) throw bad('invalid_alert', 'التنبيه بين 1 و 60 يوماً'); u.birth_alert_days = g; }
  if (b.ai_image_training_consent !== undefined) u.ai_image_training_consent = !!b.ai_image_training_consent;
  if (b.partner_data_sharing_consent !== undefined) u.partner_data_sharing_consent = !!b.partner_data_sharing_consent;
  S.settings = { ...S.settings, ...u }; Store.saveSettings();
  return { user: meOut() };
});
R('GET', '/api/countries', () => ({ countries: [['SA', 'السعودية'], ['QA', 'قطر'], ['AE', 'الإمارات'], ['KW', 'الكويت'], ['BH', 'البحرين'], ['OM', 'عُمان']].map(([code, name_ar]) => ({ code, name_ar })) }));
R('GET', '/api/age-names', () => ({ age_names: AGE_NAMES }));
R('GET', '/api/dashboard', () => dashboard());
R('GET', '/api/alerts', () => ({ alerts: alerts() }));
R('GET', '/api/farms', () => ({ farms: [...S.farms.values()].map(f => ({ ...f, camels: camels().filter(c => c.farm_id === f.id).length })) }));
R('POST', '/api/farms', b => { const name = str(b.name, 80); if (!name) throw bad('name_required', 'اسم العزبة مطلوب'); const f = { id: newId(), name, country_code: b.country_code || S.settings.country_code, area_text: str(b.area_text, 120), created_at: nowISO() }; Store.put('farm', f); audit('create', 'farm', f.id); return { farm: f }; });
R('GET', '/api/camels', (b, q) => ({ camels: listCamels(Object.fromEntries(q)) }));
R('POST', '/api/camels', b => ({ camel: createCamel(b) }));
R('GET', '/api/camels/:id', (b, q, p) => ({ camel: getCamel(p.id) }));
R('PATCH', '/api/camels/:id', (b, q, p) => ({ camel: updateCamel(p.id, b) }));
R('DELETE', '/api/camels/:id', (b, q, p) => deleteCamel(p.id));
R('GET', '/api/camels/:id/pedigree', (b, q, p) => pedigree(p.id, q.get('depth')));
R('GET', '/api/camels/:id/history', (b, q, p) => ({ history: history(p.id) }));
R('POST', '/api/camels/:id/events', (b, q, p) => ({ event: addEvent(p.id, b) }));
R('DELETE', '/api/events/:id', (b, q, p) => deleteEvent(p.id));
R('POST', '/api/matings', b => ({ mating: recordMating(b) }));
R('PATCH', '/api/matings/:id', (b, q, p) => ({ mating: updateMating(p.id, b) }));
R('DELETE', '/api/matings/:id', (b, q, p) => deleteMating(p.id));
R('POST', '/api/births', b => recordBirth(b));
R('GET', '/api/calendar', (b, q) => { const from = q.get('from') || todayISO().slice(0, 8) + '01'; return calendar(from, q.get('to') || addDays(from, 41)); });
R('POST', '/api/camels/:id/media', (b, q, p) => uploadPhoto(p.id, b));
R('DELETE', '/api/media/:id', (b, q, p) => removePhoto(p.id));
R('POST', '/api/media/:id/analyze', (b, q, p) => analyzePhoto(p.id));
R('GET', '/api/ai/messages', () => ({ messages: aiHistory() }));
R('POST', '/api/ai/messages', b => aiHandle(b.text));
R('POST', '/api/ai/actions/:id/confirm', (b, q, p) => aiConfirm(p.id));
R('POST', '/api/ai/actions/:id/cancel', (b, q, p) => aiCancel(p.id));
R('DELETE', '/api/ai/messages', () => { S.chat = { messages: [], pending: {} }; Store.write('chat', S.chat); return { ok: true }; });
R('POST', '/api/demo', () => seedDemo());
R('DELETE', '/api/demo', () => removeDemo());

async function localApi(method, path, body) {
  const [p, qs] = path.split('?'); const q = new URLSearchParams(qs || '');
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(p); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try { return await r.fn(body || {}, q, params); }
    catch (e) { if (e instanceof HttpError) { const err = new Error(e.message); err.status = e.status; err.code = e.code; throw err; } console.error(e); const err = new Error('حدث خطأ غير متوقع'); err.status = 500; throw err; }
  }
  const err = new Error('المسار غير موجود'); err.status = 404; throw err;
}

// ===================== بيانات تجريبية (يضغطها المستخدم بنفسه، ويحذفها متى شاء) =====================
function demoPhoto(bg, body, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 800 600"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs><rect width="800" height="600" fill="url(#s)"/><circle cx="620" cy="150" r="70" fill="#F4E6C3" opacity=".55"/><path d="M0 470 Q200 420 400 460 T800 450 V600 H0Z" fill="#C9A86A" opacity=".55"/><path d="M0 520 Q250 480 500 515 T800 505 V600 H0Z" fill="#B08D57" opacity=".7"/><g fill="${body}" transform="translate(170 150)"><path d="M60 250 C40 200 70 150 120 140 C150 70 230 60 260 130 C280 90 330 80 360 140 C380 170 400 175 420 160 L430 100 C432 70 470 55 495 70 L520 85 C530 92 528 105 515 108 L495 110 L480 190 C470 240 440 260 420 262 L410 360 L392 360 L388 270 L300 275 L296 360 L278 360 L270 272 C230 270 200 268 180 262 L170 360 L152 360 L150 262 C120 262 100 262 92 258 L84 360 L66 360 Z"/></g><text x="400" y="575" font-family="sans-serif" font-size="24" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
function seedDemo() {
  if (camels().some(c => c.is_demo)) throw bad('demo_exists', 'البيانات التجريبية موجودة مسبقاً');
  const T = todayISO(); const d = n => addDays(T, -n); const mk = o => createCamel({ ...o, is_demo: 1 });
  const sh = mk({ name: 'شاهين', sex: 'male', breed: 'مغاتير', color: 'أبيض', tag_number: 'DEMO-M01', birth_date: d(9 * 365), sire_name_text: 'الهداج (خارجي)' });
  const su = mk({ name: 'سلطان', sex: 'male', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-M02', birth_date: d(11 * 365), birth_date_estimated: 1 });
  const um = mk({ name: 'الحمرا', sex: 'female', breed: 'مغاتير', color: 'أشعل', tag_number: 'DEMO-F00', birth_date: d(16 * 365), birth_date_estimated: 1 });
  const wa = mk({ name: 'وضحى', sex: 'female', breed: 'مغاتير', color: 'أبيض', tag_number: 'DEMO-F01', birth_date: d(8 * 365), dam_id: um.id, sire_name_text: 'ريمان (خارجي)', notes: 'بيانات تجريبية' });
  const shu = mk({ name: 'الشعلة', sex: 'female', breed: 'مغاتير', color: 'أشعل', tag_number: 'DEMO-F02', birth_date: d(7 * 365), dam_id: um.id, sire_id: sh.id });
  const mu = mk({ name: 'مزنة', sex: 'female', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-F03', birth_date: d(6 * 365) });
  const gh = mk({ name: 'غالية', sex: 'female', breed: 'أصايل', color: 'صفراء', tag_number: 'DEMO-F04', birth_date: d(4 * 365 + 40) });
  const re = mk({ name: 'ريم', sex: 'female', breed: 'مجاهيم', color: 'أسود', tag_number: 'DEMO-F05', birth_date: d(5 * 365) });
  recordMating({ dam_id: wa.id, sire_id: sh.id, mating_date: d(1200) });
  recordBirth({ dam_id: wa.id, birth_date: d(812), calf_sex: 'female', calf_name: 'هدباء', calf_tag: 'DEMO-C01', is_demo: 1 });
  recordMating({ dam_id: wa.id, sire_id: sh.id, mating_date: d(800) });
  const thib = recordBirth({ dam_id: wa.id, birth_date: d(412), calf_sex: 'male', calf_name: 'ذيب', calf_tag: 'DEMO-C02', is_demo: 1 });
  addEvent(thib.calf.id, { type: 'weaning', event_date: d(60), title: 'فطام' });
  updateMating(recordMating({ dam_id: wa.id, sire_id: sh.id, mating_date: d(380) }).id, { outcome: 'confirmed_pregnant' });
  updateMating(recordMating({ dam_id: shu.id, sire_id: su.id, mating_date: d(365) }).id, { outcome: 'confirmed_pregnant' });
  recordMating({ dam_id: mu.id, sire_name_text: 'صقر (فحل خارجي)', mating_date: d(20) });
  recordMating({ dam_id: gh.id, sire_id: su.id, mating_date: d(120) });
  updateMating(recordMating({ dam_id: re.id, sire_id: su.id, mating_date: d(395) }).id, { outcome: 'confirmed_pregnant' });
  recordMating({ dam_id: um.id, sire_id: sh.id, mating_date: d(700) });
  recordBirth({ dam_id: um.id, birth_date: d(310), calf_sex: 'female', calf_name: 'جوهرة', calf_tag: 'DEMO-C03', is_demo: 1 });
  for (const c of [wa, shu, mu, gh, re, sh, su]) addEvent(c.id, { type: 'vaccination', event_date: d(170), title: 'تحصين دوري (تجريبي)', next_due_date: addDays(T, c === shu ? 3 : 15) });
  addEvent(mu.id, { type: 'treatment', event_date: d(12), title: 'علاج طفيليات (تجريبي)', next_due_date: addDays(T, 2) });
  addEvent(sh.id, { type: 'achievement', event_date: d(200), title: 'مشاركة في مزاين (تجريبي)' });
  const pal = [[['#7FA9C9', '#E9D6A8'], '#6B4A2B'], [['#E7B98A', '#F3E3C3'], '#8A5A35'], [['#9DB7A5', '#EFE2C4'], '#3E2C1C'], [['#D9A77A', '#F6E8CC'], '#C9B79C']];
  [[wa, 0], [shu, 1], [sh, 3], [su, 2], [mu, 2], [gh, 1], [re, 0], [um, 1]].forEach(([c, i]) => uploadPhoto(c.id, { data_base64: demoPhoto(pal[i][0], pal[i][1], `رسم توضيحي — ${c.name} (تجريبي)`), caption: 'رسم توضيحي — ليست صورة حقيقية', is_demo: 1 }));
  return { ok: true };
}
function removeDemo() {
  for (const c of camels().filter(x => x.is_demo)) deleteCamel(c.id);
  return { ok: true };
}
