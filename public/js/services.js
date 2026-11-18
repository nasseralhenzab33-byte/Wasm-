/* وسم — الخدمات (البيطرية، الأعلاف، النقل) + شركاء وسم + المجتمع + المزاين */
(() => {
  'use strict';
  const W = window.W; const I = window.ICONS;
  const { esc } = W;
  const $ = s => document.querySelector(s);
  const user = () => W.state.user;
  const DIR = { vet: { title: 'الخدمات البيطرية', cats: ['vet_services', 'vet_pharma'], icon: I.vet, section: 'vet' }, feed: { title: 'الأعلاف والمستلزمات', cats: ['feed', 'supplies'], icon: I.feed, section: 'feed' }, transport: { title: 'نقل الإبل', cats: ['transport'], icon: I.truck, section: 'transport' } };
  const CATS = { feed: 'الأعلاف', vet_pharma: 'الأدوية البيطرية', supplies: 'المستلزمات', transport: 'نقل الإبل', vet_services: 'الخدمات البيطرية', other: 'خدمات أخرى' };

  // ===================== الأدلة =====================
  W.views.directory = async key => {
    const d = DIR[key] || DIR.vet;
    W.shell(key, d.title, W.loading());
    const country = W.state.query.get('country') || '';
    const [lists, sp] = await Promise.all([Promise.all(d.cats.map(c => W.api('GET', `/api/directory?category=${c}${country ? '&country=' + country : ''}`))), W.sponsor(d.section)]);
    const companies = lists.flatMap(l => l.companies).sort((a, b) => b.promoted - a.promoted);
    $('#page').innerHTML = `${sp}<div class="card-h"><div><h1 style="margin:0">${d.title}</h1><p class="muted" style="margin:0">من شركاء وسم المعتمدين في دول الخليج</p></div><a class="btn ghost" href="#/partner">${I.handshake} سجّل شركتك</a></div>
      <div class="row" style="margin:10px 0">${['', ...Object.keys(W.COUNTRY)].map(c => `<a class="chip" href="#/directory/${key}${c ? '?country=' + c : ''}" style="${c === country ? 'background:var(--gold-100);border-color:var(--gold-500)' : ''}">${c ? W.COUNTRY[c] : 'الكل'}</a>`).join('')}</div>
      ${companies.length ? `<div class="grid g2">${companies.map(c => `<div class="card"><div class="row"><div style="width:44px;height:44px;border-radius:12px;background:var(--gold-100);display:grid;place-items:center;color:var(--gold-600)">${d.icon}</div>
          <div class="grow"><b>${esc(c.name_ar)}</b> ${c.verified ? '<span class="badge green">✓ معتمد</span>' : ''} ${c.promoted ? '<span class="badge gold">مميز</span>' : ''} ${c.is_demo ? '<span class="badge">تجريبي</span>' : ''}<div class="small muted">${esc(c.category_ar)} • ${esc(W.COUNTRY[c.country_code])}${c.city ? ' — ' + esc(c.city) : ''}</div></div></div>
        ${c.description ? `<p class="small" style="margin-top:8px">${esc(c.description)}</p>` : ''}
        ${c.offerings.length ? `<ul class="list">${c.offerings.map(o => `<li><span class="grow"><b class="small">${esc(o.title)}</b>${o.description ? `<div class="small muted">${esc(o.description)}</div>` : ''}</span>${o.price != null ? `<span class="small nowrap">${W.money(o.price, o.currency)}${o.unit ? ' / ' + esc(o.unit) : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${c.codes.length ? `<div class="notice gold small">${c.codes.map(k => `كود خصم <b dir="ltr">${esc(k.code)}</b>${k.percent ? ` (${k.percent}%)` : ''}${k.description ? ' — ' + esc(k.description) : ''}`).join('<br>')}</div>` : ''}
        <div class="row small" style="margin-top:8px">${c.phone ? `<span>📞 <b dir="ltr">${esc(c.phone)}</b></span>` : ''}${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">الموقع</a>` : ''}${user() ? `<button class="btn ghost sm" data-rep="${c.id}">${I.flag}</button>` : ''}</div></div>`).join('')}</div>`
      : W.emptyState('لا توجد شركات معتمدة في هذا القسم بعد.', '<a class="btn" href="#/partner">كن أول شريك</a>')}
      <div class="notice info small" style="margin-top:14px">وسم يعرض الشركاء فقط ولا يقدم تشخيصاً بيطرياً. التعامل والدفع مباشرة مع الشركة.</div>`;
    document.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => W.reportModal('company', b.dataset.rep));
  };

  // ===================== لوحة الشريك =====================
  W.views.partner = async () => {
    W.shell('partner', 'شركاء وسم', W.loading());
    const d = await W.api('GET', '/api/partner');
    if (!d.company || d.company.status === 'rejected') {
      $('#page').innerHTML = `<section class="hero-band"><h1>شركاء وسم</h1><p>اعرض أعلافك وأدويتك ومستلزماتك وخدمات النقل والخدمات البيطرية لملاك الإبل في دول الخليج الست.</p>${I.dunes}</section>
        <div class="grid g2"><div class="card"><h3>ماذا تحصل؟</h3><ul class="list">${['ظهور في دليل القسم المناسب', 'إعلانات مدفوعة ورعاية أقسام', 'أكواد خصم لعملائك', 'تقارير ظهور ونقرات', 'روابط إحالة'].map(x => `<li>${I.check}<span>${x}</span></li>`).join('')}</ul></div>
        <form class="card stack" id="cf"><h3>طلب انضمام</h3>
          <div class="field"><label>اسم الشركة *</label><input class="input" name="name_ar" required></div>
          <div class="field"><label>النشاط *</label><select class="input" name="category">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field"><label>الدولة</label><select class="input" name="country_code">${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}" ${k === user().country_code ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>المدينة</label><input class="input" name="city"></div><div class="field"><label>الهاتف</label><input class="input" name="phone" dir="ltr"></div>
          <div class="field"><label>رقم السجل التجاري</label><input class="input" name="cr_number" dir="ltr"></div><div class="field"><label>نبذة</label><textarea class="input" name="description"></textarea></div>
          ${d.company && d.company.status === 'rejected' ? '<div class="notice err small">رُفض طلبك السابق. تقدر تعدّل وتقدم من جديد.</div>' : ''}
          <button class="btn gold" type="submit">إرسال الطلب</button></form></div>`;
      $('#cf').onsubmit = async e => { e.preventDefault(); try { await W.api('POST', '/api/partner', W.formData(e.target)); W.toast('وصل طلبك — سنراجعه قريباً'); W.render(); } catch (err) { W.fail(err); } };
      return;
    }
    const c = d.company;
    const ST = { pending: ['قيد المراجعة', 'warn'], active: ['معتمد', 'green'], suspended: ['موقوف', 'red'] };
    const CST = { pending: 'بانتظار الدفع والتفعيل', active: 'مفعّلة', paused: 'موقوفة', ended: 'منتهية', rejected: 'مرفوضة' };
    $('#page').innerHTML = `<div class="card-h"><div><h1 style="margin:0">${esc(c.name_ar)}</h1><span class="badge ${ST[c.status][1]}">${ST[c.status][0]}</span> <span class="small muted">${esc(d.category_ar)} • ${esc(W.COUNTRY[c.country_code])}</span></div></div>
      ${c.status !== 'active' ? '<div class="notice gold">طلبك قيد المراجعة. بعد الاعتماد تقدر تضيف خدماتك وحملاتك.</div>' : ''}
      <div class="kpi-grid" style="margin:14px 0">${[['الخدمات', d.offerings.length], ['الحملات', d.campaigns.length], ['الظهور', d.campaigns.reduce((s, x) => s + x.impressions, 0)], ['النقرات', d.campaigns.reduce((s, x) => s + x.clicks, 0)], ['استخدام الأكواد', d.codes.reduce((s, x) => s + x.uses, 0)], ['الإحالات', d.referrals.n]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="grid g2">
        <section class="card"><div class="card-h"><h3>الخدمات والمنتجات</h3>${c.status === 'active' ? `<button class="btn sm" id="addOff">${I.plus} إضافة</button>` : ''}</div>
          ${d.offerings.length ? `<ul class="list">${d.offerings.map(o => `<li><span class="grow"><b>${esc(o.title)}</b><div class="small muted">${esc(o.description || '')}</div></span><span class="small">${o.price != null ? W.money(o.price, o.currency) : ''}</span><button class="icon-btn" data-deloff="${o.id}">${I.trash}</button></li>`).join('')}</ul>` : '<p class="muted">لا توجد خدمات.</p>'}</section>
        <section class="card"><div class="card-h"><h3>أكواد الخصم</h3>${c.status === 'active' ? `<button class="btn sm" id="addCode">${I.plus} كود</button>` : ''}</div>
          ${d.codes.length ? `<ul class="list">${d.codes.map(k => `<li><b dir="ltr">${esc(k.code)}</b><span class="grow small">${k.percent ? k.percent + '% — ' : ''}${esc(k.description || '')}</span><span class="small muted">${k.uses}${k.max_uses ? '/' + k.max_uses : ''} استخدام</span></li>`).join('')}</ul>` : '<p class="muted">لا توجد أكواد.</p>'}</section>
      </div>
      <section class="card"><div class="card-h"><h3>الحملات الإعلانية ورعاية الأقسام</h3>${c.status === 'active' ? `<button class="btn gold sm" id="addCamp">${I.plus} حملة جديدة</button>` : ''}</div>
        ${d.campaigns.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الحملة</th><th>الباقة</th><th>الحالة</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>المدة</th></tr></thead><tbody>${d.campaigns.map(x => `<tr><td>${esc(x.headline)}${x.section ? `<div class="small muted">قسم: ${esc(x.section)}</div>` : ''}</td><td class="small">${esc(x.package_name)}<div class="muted">${W.money(x.amount, x.currency)}</div></td><td><span class="badge">${CST[x.status]}</span></td><td>${x.impressions}</td><td>${x.clicks}</td><td>${x.ctr}%</td><td class="small">${x.starts_at ? W.fmtDate(x.starts_at.slice(0, 10)) + ' ← ' + W.fmtDate(x.ends_at.slice(0, 10)) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد حملات.</p>'}
        <div class="notice info small" style="margin-top:10px">التفعيل بعد تأكيد الدفع مع إدارة وسم. بوابة الدفع الإلكتروني تُربط لاحقاً.</div></section>
      ${d.contracts.length ? `<section class="card"><h3>عقود الرعاية</h3><ul class="list">${d.contracts.map(k => `<li><span class="grow">رعاية قسم «${esc(k.section)}» — ${W.money(k.value, k.currency)}</span><span class="small">${W.fmtDate(k.starts_on)} ← <b>${W.fmtDate(k.ends_on)}</b></span></li>`).join('')}</ul></section>` : ''}`;
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    on('addOff', () => W.modal('خدمة / منتج', `<div class="stack"><div class="field"><label>العنوان *</label><input class="input" name="title" required></div><div class="field"><label>الوصف</label><textarea class="input" name="description"></textarea></div><div class="row"><input class="input" name="price" type="number" min="0" placeholder="السعر (اختياري)" style="flex:1"><input class="input" name="unit" placeholder="الوحدة: كيس، رحلة…" style="flex:1"></div></div>`, async f => { await W.api('POST', '/api/partner/offerings', f); W.render(); }));
    on('addCode', () => W.modal('كود خصم', `<div class="stack"><div class="field"><label>الكود (إنجليزي/أرقام)</label><input class="input" name="code" dir="ltr" required></div><div class="field"><label>نسبة الخصم %</label><input class="input" name="percent" type="number" min="1" max="90"></div><div class="field"><label>الوصف</label><input class="input" name="description"></div><div class="row"><input class="input" name="valid_to" type="date" style="flex:1"><input class="input" name="max_uses" type="number" min="1" placeholder="أقصى استخدام" style="flex:1"></div></div>`, async f => { await W.api('POST', '/api/partner/codes', f); W.render(); }));
    on('addCamp', () => W.modal('حملة جديدة', `<div class="stack"><div class="field"><label>الباقة</label><select class="input" name="package_id">${d.packages.map(p => `<option value="${p.id}">${esc(p.name_ar)} — ${W.money(p.price, p.currency)} / ${p.duration_days} يوم</option>`).join('')}</select></div>
      <div class="field"><label>القسم (لرعاية الأقسام)</label><select class="input" name="section">${[['herd', 'إدارة الحلال'], ['market', 'السوق'], ['auctions', 'المزادات'], ['vet', 'البيطرية'], ['feed', 'الأعلاف'], ['transport', 'النقل'], ['community', 'المجتمع'], ['mazayin', 'المزاين']].map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>نص الإعلان *</label><input class="input" name="headline" maxlength="90" required></div><div class="field"><label>سطر إضافي</label><input class="input" name="body" maxlength="200"></div><div class="field"><label>الرابط (https://)</label><input class="input" name="link" dir="ltr"></div></div>`,
      async f => { const r = await W.api('POST', '/api/partner/campaigns', f); W.toast(r.notice); W.render(); }));
    document.querySelectorAll('[data-deloff]').forEach(b => b.onclick = async () => { await W.api('DELETE', '/api/partner/offerings/' + b.dataset.deloff); W.render(); });
  };

  // ===================== المجتمع =====================
  const PCAT = { general: 'عام', question: 'سؤال', experience: 'تجربة', news: 'خبر' };
  const postCard = (p, full) => `<div class="card post"><div class="row"><span class="avatar">${esc(p.author.name.charAt(0))}</span><div class="grow"><b>${esc(p.author.name)}</b><div class="meta">${W.fmtDT(p.created_at)} • <span class="badge">${PCAT[p.category]}</span>${p.is_demo ? ' <span class="badge">تجريبي</span>' : ''}</div></div></div>
    <div class="body">${esc(p.body)}</div>
    <div class="row small"><button class="btn ghost sm" data-like="${p.id}">${I.heart} ${p.like_count}${p.liked ? ' • أعجبك' : ''}</button>${full ? '' : `<a class="btn ghost sm" href="#/community/${p.id}">${I.chat} ${p.comment_count} تعليق</a>`}
    ${p.mine ? `<button class="btn ghost sm" data-delp="${p.id}">${I.trash}</button>` : user() ? `<button class="btn ghost sm" data-repp="${p.id}">${I.flag}</button>` : ''}</div></div>`;
  function bindPosts() {
    document.querySelectorAll('[data-like]').forEach(b => b.onclick = async () => { if (!user()) return W.go('/login'); await W.api('POST', `/api/posts/${b.dataset.like}/like`); W.render(); });
    document.querySelectorAll('[data-delp]').forEach(b => b.onclick = async () => { if (await W.confirmBox('حذف المنشور؟')) { await W.api('DELETE', '/api/posts/' + b.dataset.delp); W.go('/community'); } });
    document.querySelectorAll('[data-repp]').forEach(b => b.onclick = () => W.reportModal('post', b.dataset.repp));
  }
  W.views.community = async id => {
    W.shell('community', 'مجتمع أهل الإبل', W.loading());
    if (id) {
      const { post } = await W.api('GET', '/api/posts/' + id);
      $('#page').innerHTML = `<a href="#/community" class="small">${I.chevron} المجتمع</a><div style="margin-top:10px">${postCard(post, true)}</div>
        <div class="card"><h3>التعليقات (${post.comments.length})</h3>${post.comments.length ? `<ul class="list">${post.comments.map(c => `<li><span class="avatar" style="width:28px;height:28px;font-size:.75rem">${esc(c.author.name.charAt(0))}</span><div class="grow"><b class="small">${esc(c.author.name)}</b><div style="white-space:pre-wrap">${esc(c.body)}</div></div><span class="small muted">${W.fmtDT(c.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">كن أول من يعلق.</p>'}
        ${user() ? '<form id="cmf" class="composer" style="border:0;padding:8px 0 0"><input class="input" name="body" placeholder="اكتب تعليقاً…" maxlength="1500"><button class="btn gold" type="submit">إرسال</button></form>' : '<a href="#/login">سجّل الدخول للتعليق</a>'}</div>`;
      const f = $('#cmf'); if (f) f.onsubmit = async e => { e.preventDefault(); if (!f.body.value.trim()) return; try { await W.api('POST', `/api/posts/${id}/comments`, { body: f.body.value }); W.render(); } catch (err) { W.fail(err); } };
      return bindPosts();
    }
    const cat = W.state.query.get('category') || '';
    const [{ posts }, sp] = await Promise.all([W.api('GET', '/api/posts' + (cat ? '?category=' + cat : '')), W.sponsor('community')]);
    $('#page').innerHTML = `${sp}<h1>مجتمع أهل الإبل</h1><p class="muted">اسأل، شارك خبرتك، وتابع أخبار أهل الإبل. المحتوى يُراقب، والمشورة البيطرية من أهل الاختصاص فقط.</p>
      <div class="row" style="margin:10px 0">${['', ...Object.keys(PCAT)].map(c => `<a class="chip" href="#/community${c ? '?category=' + c : ''}" style="${c === cat ? 'background:var(--gold-100);border-color:var(--gold-500)' : ''}">${c ? PCAT[c] : 'الكل'}</a>`).join('')}</div>
      ${user() ? `<form class="card stack" id="pf"><textarea class="input" name="body" placeholder="وش في بالك يا بو فلان؟" maxlength="3000"></textarea><div class="row"><select class="input" name="category" style="width:auto">${Object.entries(PCAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn gold" type="submit">نشر</button></div></form>` : '<div class="notice info"><a href="#/login">سجّل الدخول</a> للمشاركة.</div>'}
      ${posts.length ? posts.map(p => postCard(p)).join('') : W.emptyState('لا توجد منشورات بعد.')}`;
    const f = $('#pf'); if (f) f.onsubmit = async e => { e.preventDefault(); try { await W.api('POST', '/api/posts', W.formData(f)); W.render(); } catch (err) { W.fail(err); } };
    bindPosts();
  };

  // ===================== المزاين والنتائج =====================
  W.views.mazayin = async id => {
    W.shell('mazayin', 'المزاين والنتائج', W.loading());
    const isAdmin = user() && ['super_admin', 'country_admin'].includes(user().role);
    if (id) {
      const { festival: f, results } = await W.api('GET', '/api/festivals/' + id);
      const byCat = results.reduce((m, r) => { (m[r.category] = m[r.category] || []).push(r); return m; }, {});
      $('#page').innerHTML = `<a href="#/mazayin" class="small">${I.chevron} المزاين</a><h1 style="margin-top:8px">${esc(f.name_ar)}</h1><p class="muted">${esc(W.COUNTRY[f.country_code])}${f.location ? ' — ' + esc(f.location) : ''} • ${W.fmtDate(f.starts_on)} ← ${W.fmtDate(f.ends_on)}</p>${f.description ? `<p>${esc(f.description)}</p>` : ''}
        ${isAdmin ? `<button class="btn sm" id="addRes">${I.plus} إضافة نتيجة</button>` : ''}
        ${Object.keys(byCat).length ? Object.entries(byCat).map(([cat, rs]) => `<div class="card"><h3>${esc(cat)}</h3><ul class="list">${rs.map(r => `<li><span class="badge ${r.rank === 1 ? 'gold' : ''}">المركز ${r.rank}</span><span class="grow"><b>${esc(r.camel_name)}</b>${r.owner_display ? ` <span class="small muted">— ${esc(r.owner_display)}</span>` : ''}</span>${r.linked ? '<span class="badge green">مربوط بملف</span>' : user() ? `<button class="btn ghost sm" data-link="${r.id}">هذه مطيتي</button>` : ''}</li>`).join('')}</ul></div>`).join('') : W.emptyState('لم تُنشر النتائج بعد.')}
        <div class="notice info small">«هذه مطيتي» يضيف الإنجاز لملف المطية في حلالك. الربط مسؤولية المالك ويمكن مراجعته.</div>`;
      const ar = $('#addRes'); if (ar) ar.onclick = () => W.modal('نتيجة', `<div class="stack"><div class="field"><label>الفئة/الشوط *</label><input class="input" name="category" required></div><div class="field"><label>المركز *</label><input class="input" name="rank" type="number" min="1" required></div><div class="field"><label>اسم المطية *</label><input class="input" name="camel_name" required></div><div class="field"><label>المالك (كما يُعلن)</label><input class="input" name="owner_display"></div></div>`, async d => { await W.api('POST', `/api/festivals/${id}/results`, d); W.render(); });
      document.querySelectorAll('[data-link]').forEach(b => b.onclick = async () => {
        const { camels } = await W.api('GET', '/api/camels');
        W.modal('اربط بمطية من حلالي', `<div class="field"><label>المطية</label><select class="input" name="camel_id">${camels.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>`, async d => { await W.api('POST', `/api/festival-results/${b.dataset.link}/link`, d); W.toast('أُضيف الإنجاز لملف المطية'); W.render(); });
      });
      return;
    }
    const [{ festivals }, sp] = await Promise.all([W.api('GET', '/api/festivals'), W.sponsor('mazayin')]);
    $('#page').innerHTML = `${sp}<div class="card-h"><div><h1 style="margin:0">المزاين والنتائج</h1><p class="muted" style="margin:0">مهرجانات مزاين الإبل في دول الخليج ونتائجها</p></div>${isAdmin ? `<button class="btn gold" id="addFest">${I.plus} مهرجان</button>` : ''}</div>
      ${festivals.length ? `<div class="grid g3" style="margin-top:12px">${festivals.map(f => `<a class="card" href="#/mazayin/${f.id}" style="color:inherit;display:block"><div class="row">${I.trophy}<b>${esc(f.name_ar)}</b></div><p class="small muted">${esc(W.COUNTRY[f.country_code])}${f.location ? ' — ' + esc(f.location) : ''}<br>${W.fmtDate(f.starts_on)} ← ${W.fmtDate(f.ends_on)}</p><span class="badge">${f.results} نتيجة</span>${f.is_demo ? ' <span class="badge">تجريبي</span>' : ''}</a>`).join('')}</div>` : W.emptyState('لا توجد مهرجانات مسجلة بعد.')}`;
    const af = $('#addFest'); if (af) af.onclick = () => W.modal('مهرجان جديد', `<div class="stack"><div class="field"><label>الاسم *</label><input class="input" name="name_ar" required></div><div class="field"><label>الدولة</label><select class="input" name="country_code">${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}" ${k === (user().admin_country_code || user().country_code) ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>المكان</label><input class="input" name="location"></div><div class="row"><input class="input" type="date" name="starts_on" required style="flex:1"><input class="input" type="date" name="ends_on" required style="flex:1"></div><div class="field"><label>الوصف</label><textarea class="input" name="description"></textarea></div></div>`, async d => { const r = await W.api('POST', '/api/festivals', d); W.go('/mazayin/' + r.id); });
  };
})();
