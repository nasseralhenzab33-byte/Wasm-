'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, client, PNG_1x1, db } = require('./helpers');
const { todayISO, addDays } = require('../server/lib/util');

let srv, A, B;
test.before(async () => {
  srv = await start();
  A = client(srv.base); B = client(srv.base);
  assert.equal((await A.register('a@test.qa')).status, 201);
  assert.equal((await B.register('b@test.qa')).status, 201);
});
test.after(() => srv.stop());

test('الحسابات: التسجيل والدخول والقفل وسياسة كلمة المرور', async () => {
  const c = client(srv.base);
  assert.equal((await c.register('weak@test.qa', { password: 'short1' })).status, 400);
  assert.equal((await c.register('a@test.qa')).status, 409);
  const role = await c.register('admin@test.qa', { role: 'super_admin' });
  assert.equal(role.data.user.role, 'owner', 'لا يمكن اختيار دور إداري ذاتياً');
  const x = client(srv.base);
  for (let i = 0; i < 5; i++) assert.equal((await x.post('/api/auth/login', { email: 'admin@test.qa', password: 'wrong-pass-1' })).status, 401);
  assert.equal((await x.post('/api/auth/login', { email: 'admin@test.qa', password: 'Strong-pass-123' })).status, 423, 'قفل بعد 5 محاولات');
  assert.equal((await client(srv.base).get('/api/me')).status, 401);
});

test('حماية CSRF وترويسات الأمان', async () => {
  const r = await fetch(srv.base + '/api/camels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const h = await fetch(srv.base + '/');
  assert.match(h.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(h.headers.get('x-frame-options'), 'DENY');
});

let wadha, shaheen;
test('إنشاء الإبل والتحقق من البيانات', async () => {
  shaheen = (await A.post('/api/camels', { name: 'شاهين', sex: 'male', tag_number: 'M1' })).data.camel;
  wadha = (await A.post('/api/camels', { name: 'وضحى', sex: 'female', tag_number: 'F1', breed: 'مغاتير' })).data.camel;
  assert.ok(wadha.id);
  assert.equal((await A.post('/api/camels', { name: 'مكرر', sex: 'female', tag_number: 'F1' })).status, 409);
  assert.equal((await A.post('/api/camels', { name: '', sex: 'female' })).status, 400);
  assert.equal((await A.post('/api/camels', { name: 'x', sex: 'other' })).status, 400);
  assert.equal((await A.post('/api/camels', { name: 'x', sex: 'female', birth_date: addDays(todayISO(), 5) })).status, 400);
  assert.equal((await A.post('/api/camels', { name: 'x', sex: 'female', dam_id: shaheen.id })).status, 400, 'الأم يجب أن تكون أنثى');
});

test('عزل البيانات: لا يرى مستخدم حلال غيره', async () => {
  assert.equal((await B.get('/api/camels/' + wadha.id)).status, 404);
  assert.equal((await B.patch('/api/camels/' + wadha.id, { name: 'سرقة' })).status, 404);
  assert.equal((await B.del('/api/camels/' + wadha.id)).status, 404);
  assert.equal((await B.post('/api/matings', { dam_id: wadha.id, sire_name_text: 'x' })).status, 404);
  assert.equal((await B.get('/api/camels')).data.camels.length, 0);
  // لا يمكن ربط مطية بأم من حلال مستخدم آخر
  assert.equal((await B.post('/api/camels', { name: 'ب', sex: 'female', dam_id: wadha.id })).status, 404);
  const ai = await B.post('/api/ai/messages', { text: 'متى لقحت وضحى؟' });
  assert.match(ai.data.reply, /ما لقيت/);
});

test('التلقيح ← الموعد التقديري ← الولادة ← ملف المولود والنسب', async () => {
  const md = addDays(todayISO(), -380);
  const m = (await A.post('/api/matings', { dam_id: wadha.id, sire_id: shaheen.id, mating_date: md })).data.mating;
  assert.equal(m.expected_birth_date, addDays(md, 390));
  assert.equal((await A.post('/api/matings', { dam_id: shaheen.id, sire_id: shaheen.id })).status, 400);
  assert.equal((await A.post('/api/matings', { dam_id: wadha.id, sire_id: shaheen.id, mating_date: addDays(todayISO(), 10) })).status, 400);
  const al = (await A.get('/api/alerts')).data.alerts;
  assert.ok(al.some(x => x.kind === 'upcoming_birth' && x.camel_id === wadha.id));
  assert.equal((await A.post('/api/births', { dam_id: wadha.id, birth_date: addDays(md, -1) })).status, 400, 'الولادة قبل التلقيح');
  const b = (await A.post('/api/births', { dam_id: wadha.id, calf_sex: 'female', calf_name: 'غلا' })).data;
  assert.equal(b.calf.dam_id, wadha.id);
  assert.equal(b.calf.sire_id, shaheen.id);
  const w = (await A.get('/api/camels/' + wadha.id)).data.camel;
  assert.equal(w.status, 'nursing');
  assert.equal(w.matings[0].outcome, 'born');
  const ped = (await A.get(`/api/camels/${b.calf.id}/pedigree`)).data;
  assert.equal(ped.tree.dam.name, 'وضحى');
  assert.equal(ped.tree.sire.name, 'شاهين');
  assert.match(ped.notice, /لا تُعد موثقة/);
  // منع الحلقات في شجرة النسب
  assert.equal((await A.patch('/api/camels/' + wadha.id, { dam_id: b.calf.id })).status, 400);
  // سجل التعديلات
  const h = (await A.get(`/api/camels/${wadha.id}/history`)).data.history;
  assert.ok(h.some(x => x.entity === 'birth'));
});

test('السجلات الصحية والبيع والتقويم', async () => {
  const e = await A.post(`/api/camels/${shaheen.id}/events`, { type: 'vaccination', title: 'تحصين', next_due_date: addDays(todayISO(), 3) });
  assert.equal(e.status, 201);
  assert.equal((await A.post(`/api/camels/${shaheen.id}/events`, { type: 'bad', title: 'x' })).status, 400);
  const cal = (await A.get(`/api/calendar?from=${todayISO()}&to=${addDays(todayISO(), 30)}`)).data;
  assert.ok(cal.items.some(i => i.kind === 'follow_up'));
  assert.match(cal.notice, /تقديرية/);
  const tmp = (await A.post('/api/camels', { name: 'للبيع', sex: 'male' })).data.camel;
  await A.post(`/api/camels/${tmp.id}/events`, { type: 'sale', title: 'بيع', amount: 50000, currency: 'QAR' });
  assert.equal((await A.get('/api/camels/' + tmp.id)).data.camel.status, 'sold');
});

test('الصور: فحص النوع الحقيقي، الصلاحيات، واكتشاف التكرار', async () => {
  assert.equal((await A.post(`/api/camels/${wadha.id}/media`, { data_base64: Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 415);
  const up = await A.post(`/api/camels/${wadha.id}/media`, { data_base64: PNG_1x1 });
  assert.equal(up.status, 201);
  const up2 = await A.post(`/api/camels/${shaheen.id}/media`, { data_base64: PNG_1x1 });
  assert.equal(up2.data.duplicate_in_my_herd.length, 1);
  const bCamel = (await B.post('/api/camels', { name: 'ناقة ب', sex: 'female' })).data.camel;
  const up3 = await B.post(`/api/camels/${bCamel.id}/media`, { data_base64: PNG_1x1 });
  assert.equal(up3.data.duplicate_elsewhere, true);
  assert.equal(up3.data.duplicate_in_my_herd.length, 0, 'لا يكشف تفاصيل حلال الآخرين');
  assert.equal((await A.get('/api/media/' + up.data.id)).status, 200);
  assert.equal((await B.get('/api/media/' + up.data.id)).status, 404);
});

test('روابط المشاركة: النطاق والإخفاء والإلغاء والانتهاء', async () => {
  await A.patch('/api/camels/' + wadha.id, { notes: 'ملاحظة سرية' });
  const s = (await A.post(`/api/camels/${wadha.id}/shares`, { scope: 'basic', days: 7 })).data;
  const pub = client(srv.base);
  const v = (await pub.get('/api/public/share/' + s.token)).data;
  assert.equal(v.camel.name, 'وضحى');
  assert.equal(v.pedigree, undefined);
  const txt = JSON.stringify(v);
  assert.ok(!txt.includes('ملاحظة سرية') && !txt.includes('owner') && !txt.includes('farm'));
  const full = (await A.post(`/api/camels/${wadha.id}/shares`, { scope: 'pedigree' })).data;
  assert.ok((await pub.get('/api/public/share/' + full.token)).data.pedigree);
  await A.del('/api/shares/' + s.id);
  assert.equal((await pub.get('/api/public/share/' + s.token)).status, 404);
  db.run("UPDATE share_links SET expires_at='2000-01-01T00:00:00Z' WHERE id=?", full.id);
  assert.equal((await pub.get('/api/public/share/' + full.token)).status, 404);
  assert.equal((await B.post(`/api/camels/${wadha.id}/shares`, {})).status, 404);
});

test('المساعد: تسجيل بالمحادثة مع استكمال الناقص والتأكيد', async () => {
  const C = client(srv.base); await C.register('c@test.qa');
  const dam = (await C.post('/api/camels', { name: 'مزنة', sex: 'female' })).data.camel;
  await C.post('/api/camels', { name: 'صقر', sex: 'male' });
  let r = await C.post('/api/ai/messages', { text: 'لقحت مزنة' });
  assert.match(r.data.reply, /الفحل/);
  r = await C.post('/api/ai/messages', { text: 'صقر' });
  assert.match(r.data.reply, /متى/);
  r = await C.post('/api/ai/messages', { text: 'امس' });
  assert.ok(r.data.action, 'يجب أن يقترح إجراءً للتأكيد');
  // لا شيء يُحفظ قبل التأكيد
  assert.equal((await C.get('/api/camels/' + dam.id)).data.camel.matings.length, 0);
  const ok = await C.post(`/api/ai/actions/${r.data.action.id}/confirm`);
  assert.equal(ok.status, 200);
  assert.equal((await C.post(`/api/ai/actions/${r.data.action.id}/confirm`)).status, 409, 'لا تنفيذ مزدوج');
  const m = (await C.get('/api/camels/' + dam.id)).data.camel.matings;
  assert.equal(m.length, 1);
  assert.equal(m[0].mating_date, addDays(todayISO(), -1));
  assert.equal(m[0].source, 'assistant');
  // مستخدم آخر لا يستطيع تأكيد إجراء غيره
  const r2 = await C.post('/api/ai/messages', { text: 'لقحت مزنة اليوم من صقر' });
  assert.equal((await A.post(`/api/ai/actions/${r2.data.action.id}/confirm`)).status, 404);
  await C.post(`/api/ai/actions/${r2.data.action.id}/cancel`);
  // استعلامات من السجلات
  r = await C.post('/api/ai/messages', { text: 'متى لقحت مزنة؟' });
  assert.match(r.data.reply, /حسب سجلاتك/);
  assert.match(r.data.reply, /صقر/);
  r = await C.post('/api/ai/messages', { text: 'وش جابت مزنة آخر مرة' });
  assert.match(r.data.reply, /ما فيه ولادة مسجلة/, 'لا يخترع بيانات');
  r = await C.post('/api/ai/messages', { text: 'لقحت نورة اليوم من صقر' });
  assert.match(r.data.reply, /ما لقيت ناقة/);
  await C.patch('/api/camels/' + dam.id, { birth_date: addDays(todayISO(), -(4 * 365 + 20)) });
  r = await C.post('/api/ai/messages', { text: 'كم عندي جذعان؟' });
  assert.match(r.data.reply, /جذعة/);
  assert.match(r.data.reply, /مزنة/);
  assert.equal((await C.get('/api/camels?age=jitha')).data.camels.length, 1);
  r = await C.post('/api/ai/messages', { text: 'أبي أبيع مزنة' });
  assert.equal(r.data.source, 'ai_draft');
  assert.match(r.data.reply, /راجعها/);
});

test('المساعد: ولادة بالمحادثة تنشئ المولود', async () => {
  const D = client(srv.base); await D.register('d@test.qa');
  const dam = (await D.post('/api/camels', { name: 'ريم', sex: 'female' })).data.camel;
  await D.post('/api/matings', { dam_id: dam.id, sire_name_text: 'فحل خارجي', mating_date: addDays(todayISO(), -390) });
  let r = await D.post('/api/ai/messages', { text: 'ولدت ريم اليوم وسميناها جوهرة' });
  assert.match(r.data.reply, /جنس/);
  r = await D.post('/api/ai/messages', { text: 'بكرة' });
  assert.ok(r.data.action);
  const ok = await D.post(`/api/ai/actions/${r.data.action.id}/confirm`);
  assert.equal(ok.data.result.calf.name, 'جوهرة');
  assert.equal(ok.data.result.calf.sire_name_text, 'فحل خارجي');
});

test('المساعد: مزود نموذج لغوي وهمي يستخدم أدوات القراءة فقط', async () => {
  const providers = require('../server/modules/ai/providers');
  let calls = 0;
  providers.setProvider({
    name: 'mock', available: true,
    async chat({ tools }) {
      calls++;
      assert.ok(tools.every(t => !/record|delete|bid|pay/.test(t.name)), 'لا أدوات كتابة أو مالية');
      if (calls === 1) return { raw: 'r', text: '', toolCalls: [{ id: 't1', name: 'herd_stats', input: {} }] };
      return { text: 'حسب سجلاتك عندك حلال.', toolCalls: [] };
    },
    toolResultMessage: () => [],
  });
  const r = await A.post('/api/ai/messages', { text: 'وش رأيك في تغذية النوق في الصيف' });
  assert.equal(r.data.source, 'ai');
  assert.equal(calls, 2);
  providers.setProvider(null);
});

test('الإعدادات والتصدير', async () => {
  assert.equal((await A.patch('/api/me', { gestation_days: 100 })).status, 400);
  assert.equal((await A.patch('/api/me', { gestation_days: 380 })).data.user.gestation_days, 380);
  const ex = await A.get('/api/me/export');
  assert.ok(ex.data.camels.length >= 2);
  assert.ok(!JSON.stringify(ex.data).includes('password_hash'));
});
