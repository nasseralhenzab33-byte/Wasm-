/* وسم — المرحلة 2: السوق، الإعلانات، المقارنة، الرسائل والعروض، الصفقات، الإشعارات */
(() => {
  'use strict';
  const W = window.W; const I = window.ICONS;
  const { esc } = W;
  const $ = s => document.querySelector(s);
  const COUNTRY = { SA: 'السعودية', QA: 'قطر', AE: 'الإمارات', KW: 'الكويت', BH: 'البحرين', OM: 'عُمان' };
  const CUR = { QAR: 'ر.ق', SAR: 'ر.س', AED: 'د.إ', KWD: 'د.ك', BHD: 'د.ب', OMR: 'ر.ع' };
  const money = (n, c) => (n == null ? 'على السوم' : `${Number(n).toLocaleString('en')} ${CUR[c] || c || ''}`);
  const LSTATUS = { pending_review: ['بانتظار المراجعة', 'warn'], active: ['منشور', 'green'], reserved: ['محجوز', 'gold'], sold: ['مباع', ''], rejected: ['مرفوض', 'red'], removed: ['محذوف', ''], expired: ['منتهي', ''], draft: ['مسودة', ''] };
  const photo = id => `/api/listing-photos/${id}`;
  const fallback = `<div class="ph-fallback">${I.camel}</div>`;
  W.money = money; W.COUNTRY = COUNTRY;
  const user = () => W.state.user;
  const needLogin = () => { if (!user()) { W.toast('سجّل الدخول أولاً', true); W.go('/login'); return true; } return false; };

  async function sponsor(section) {
    try {
      const { sponsor: s } = await W.api('GET', '/api/sponsor?section=' + section);
      if (!s) return '';
      return `<div class="sponsor"><span class="lbl">برعاية</span><b>${esc(s.company)}</b><span class="grow">${esc(s.headline)}${s.body ? ' — ' + esc(s.body) : ''}</span>${s.has_link ? `<button class="btn sm gold" data-sponsor="${esc(s.id)}">التفاصيل</button>` : ''}</div>`;
    } catch { return ''; }
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-sponsor]'); if (!b) return;
    try { const { link } = await W.api('POST', `/api/campaigns/${b.dataset.sponsor}/click`); if (link) window.open(link, '_blank', 'noopener'); } catch (err) { W.fail(err); }
  });
  W.sponsor = sponsor;

  function listingCard(l, opts = {}) {
    const st = LSTATUS[l.status] || ['', ''];
    return `<div class="camel-card l-card" style="position:relative"><a href="#/listing/${l.id}" style="color:inherit;display:block">
      <div class="ph">${l.photo_id ? `<img src="${photo(l.photo_id)}" alt="${esc(l.title)}" loading="lazy">` : fallback}
        ${l.age_name ? `<span class="badge ${l.sex === 'female' ? 'gold' : 'green'} sex">${esc(l.age_name.name)}</span>` : ''}
        ${l.promoted ? '<span class="badge gold tagtop">مميز</span>' : l.status !== 'active' ? `<span class="badge ${st[1]} tagtop">${st[0]}</span>` : ''}</div>
      <div class="body"><div class="name">${esc(l.title)}</div>
        <div class="meta">${esc([l.breed, l.color, COUNTRY[l.country_code], l.city].filter(Boolean).join(' • '))}</div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="price">${money(l.price, l.currency)}</span>${l.negotiable && l.price ? '<span class="badge outline">قابل للتفاوض</span>' : ''}</div>
        ${l.is_demo ? '<span class="badge" style="margin-top:6px">تجريبي</span>' : ''}</div></a>
      ${opts.compare ? `<label class="cmp"><input type="checkbox" data-cmp="${l.id}" ${W.cmp.has(l.id) ? 'checked' : ''}> قارن</label>` : ''}</div>`;
  }
  W.listingCard = listingCard;
  W.cmp = new Set();
  function cmpBar() {
    let bar = $('.cmp-bar');
    if (!W.cmp.size) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'cmp-bar'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>اخترت ${W.cmp.size} للمقارنة</span><a class="btn gold sm" href="#/compare?ids=${[...W.cmp].join(',')}">قارن</a><button class="btn ghost sm" style="color:#fff" data-cmp-clear>مسح</button>`;
  }
  document.addEventListener('change', e => {
    const c = e.target.closest('[data-cmp]'); if (!c) return;
    if (c.checked) { if (W.cmp.size >= 4) { c.checked = false; return W.toast('حد المقارنة 4 إعلانات', true); } W.cmp.add(c.dataset.cmp); } else W.cmp.delete(c.dataset.cmp);
    cmpBar();
  });
  document.addEventListener('click', e => { if (e.target.closest('[data-cmp-clear]')) { W.cmp.clear(); cmpBar(); document.querySelectorAll('[data-cmp]').forEach(x => { x.checked = false; }); } });
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/market') && !location.hash.startsWith('#/compare')) { const b = $('.cmp-bar'); if (b) b.remove(); } else setTimeout(cmpBar, 50); });

  // ===================== السوق =====================
  W.views.market = async () => {
    const q = W.state.query;
    W.shell(q.get('sex') === 'male' ? 'sires' : 'market', 'سوق الإبل', W.loading());
    const ages = await W.loadAges();
    const [data, sp] = await Promise.all([W.api('GET', '/api/listings?' + q.toString()), sponsor('market')]);
    const sel = (name, opts, cur) => `<select class="input" name="${name}"><option value="">${opts[0]}</option>${opts.slice(1).map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    $('#page').innerHTML = `${sp}
      <div class="card-h"><div><h1 style="margin:0">${q.get('sex') === 'male' ? 'الأفحل' : 'سوق الإبل'}</h1><p class="muted" style="margin:0">${data.total} إعلان في دول الخليج الست</p></div>
        <a class="btn gold" href="#/listing-new">${I.plus} أضف إعلان</a></div>
      <form class="card" id="mf" style="margin-bottom:16px"><div class="filters">
        <div class="search" style="grid-column:span 2;position:relative"><input class="input" name="q" placeholder="ابحث: مغاتير، شعل، اسم…" value="${esc(q.get('q') || '')}"></div>
        ${sel('country', ['كل الدول', ...Object.entries(COUNTRY)], q.get('country'))}
        ${sel('breed', ['كل الفئات', ...[...new Set([...data.breeds, ...W.BREEDS])].map(b => [b, b])], q.get('breed'))}
        ${sel('sex', ['الجنس', ['female', 'ناقة'], ['male', 'فحل']], q.get('sex'))}
        ${sel('age', ['العمر', ...ages.map(a => [a.key, a.m === a.f ? a.m : a.m + ' / ' + a.f])], q.get('age'))}
        <input class="input" name="min_price" type="number" min="0" placeholder="أقل سعر" value="${esc(q.get('min_price') || '')}">
        <input class="input" name="max_price" type="number" min="0" placeholder="أعلى سعر" value="${esc(q.get('max_price') || '')}">
        ${sel('sort', ['الأحدث', ['price_asc', 'الأقل سعراً'], ['price_desc', 'الأعلى سعراً']], q.get('sort'))}
        <button class="btn" type="submit">${I.search} بحث</button></div>
        ${user() ? `<div class="row small" style="margin-top:10px"><a href="#/market?favorites=1">${I.heart} المفضلة</a><a href="#/my-listings">إعلاناتي</a></div>` : ''}</form>
      ${data.listings.length ? `<div class="camel-grid">${data.listings.map(l => listingCard(l, { compare: true })).join('')}</div>` : W.emptyState('لا توجد إعلانات مطابقة.', '<a class="btn" href="#/market">عرض الكل</a>')}
      ${user() ? '<section id="recs" style="margin-top:22px"></section>' : ''}`;
    $('#mf').addEventListener('submit', e => { e.preventDefault(); const d = new URLSearchParams(Object.entries(W.formData(e.target)).filter(([, v]) => v)); W.go('/market?' + d.toString()); });
    cmpBar();
    if (user() && !q.toString()) {
      const { listings } = await W.api('GET', '/api/listings/recommended');
      if (listings.length && $('#recs')) $('#recs').innerHTML = `<h2>مقترحة لك</h2><p class="muted small">حسب ما تبحث عنه وما أضفته للمفضلة.</p><div class="camel-grid">${listings.map(l => listingCard(l)).join('')}</div>`;
    }
  };

  W.views['my-listings'] = async () => {
    W.shell('mylistings', 'إعلاناتي', W.loading());
    const { listings } = await W.api('GET', '/api/listings?seller=me&limit=100');
    $('#page').innerHTML = `<div class="card-h"><h1 style="margin:0">إعلاناتي</h1><a class="btn gold" href="#/listing-new">${I.plus} إعلان جديد</a></div>
      ${listings.length ? `<div class="camel-grid">${listings.map(l => listingCard(l)).join('')}</div>` : W.emptyState('ما عندك إعلانات بعد. تقدر تنشر إعلاناً من ملف أي مطية في حلالك.', '<a class="btn" href="#/listing-new">أضف إعلان</a>')}`;
  };

  // ===================== تفاصيل الإعلان =====================
  W.views.listing = async id => {
    W.shell('market', 'إعلان', W.loading());
    const { listing: l } = await W.api('GET', '/api/listings/' + id);
    const st = LSTATUS[l.status] || ['', ''];
    const { listings: similar } = await W.api('GET', `/api/listings/${id}/similar`);
    const facts = [['الفئة', l.breed], ['اللون', l.color], ['الجنس', l.sex === 'female' ? 'ناقة' : l.sex === 'male' ? 'فحل' : null], ['العمر', l.age_years != null ? `${l.age_name.name} — ${l.age_years} سنة تقريباً` : null], ['الأم', l.dam_name], ['الأب', l.sire_name], ['الدولة', COUNTRY[l.country_code] + (l.city ? ' — ' + l.city : '')], ['المشاهدات', l.views]].filter(x => x[1] != null && x[1] !== '');
    $('#page').innerHTML = `<a href="#/market" class="small">${I.chevron} السوق</a>
      <div class="grid g-main" style="margin-top:10px">
        <section>
          <div class="gallery"><div class="main">${l.photos[0] ? `<img id="gmain" src="${photo(l.photos[0].id)}" alt="">` : fallback}</div>
            ${l.photos.length > 1 ? `<div class="thumbs">${l.photos.map((p, i) => `<img src="${photo(p.id)}" data-g="${p.id}" class="${i ? '' : 'on'}" alt="">`).join('')}</div>` : ''}</div>
          <div class="card" style="margin-top:14px"><h3>الوصف</h3><p style="white-space:pre-wrap">${esc(l.description)}</p>${l.description_ai ? '<span class="badge outline">الوصف بمساعدة WASM AI من سجلات البائع</span>' : ''}
            <div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
            <div class="notice gold small" style="margin-top:12px">${esc(l.notice)}</div></div>
        </section>
        <aside>
          <div class="card">
            <div class="row"><h1 style="margin:0;font-size:1.4rem">${esc(l.title)}</h1></div>
            <div class="row" style="margin:6px 0"><span class="badge ${st[1]}">${st[0]}</span>${l.pedigree_documented ? '<span class="badge green">نسب موثق</span>' : '<span class="badge outline">نسب غير موثق</span>'}${l.is_demo ? '<span class="badge">تجريبي</span>' : ''}</div>
            <div class="price big">${money(l.price, l.currency)}</div>${l.negotiable ? '<div class="small muted">قابل للتفاوض</div>' : ''}
            <div class="stack" style="margin-top:14px">
              ${l.is_owner ? `
                ${l.status === 'rejected' ? `<div class="notice err small">سبب الرفض: ${esc(l.reject_reason || '')}</div>` : ''}
                ${l.flags ? '<div class="notice gold small">تحت المراجعة: صورة مطابقة لإعلان آخر.</div>' : ''}
                <div class="row">${l.status === 'active' ? '<button class="btn ghost" data-ls="reserved">تعليم كمحجوز</button>' : ''}${l.status === 'reserved' ? '<button class="btn ghost" data-ls="active">إعادة للنشر</button>' : ''}
                ${['active', 'reserved', 'pending_review', 'rejected'].includes(l.status) ? '<button class="btn danger" data-ls="removed">حذف الإعلان</button>' : ''}${['rejected', 'expired'].includes(l.status) ? '<button class="btn" data-ls="pending_review">إعادة الإرسال للمراجعة</button>' : ''}</div>
                <label class="btn ghost" style="cursor:pointer">${I.image} إضافة صور<input type="file" accept="image/*" multiple hidden id="lphotos"></label>
                <a class="btn ghost" href="#/auction-new?listing=${l.id}">${I.gavel} اعرضه في مزاد</a>`
              : `
                ${l.status === 'active' ? `<button class="btn gold" data-act2="offer">${I.handshake} قدّم عرض سعر</button>` : ''}
                <button class="btn" data-act2="message">${I.chat} راسل البائع</button>
                ${l.contact_phone ? `<div class="notice info">رقم البائع: <b dir="ltr">${esc(l.contact_phone)}</b>${l.contact_mode === 'whatsapp' ? ` — <a href="https://wa.me/${esc(l.contact_phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">واتساب</a>` : ''}</div>` : (!user() && l.contact_mode !== 'in_app' ? '<div class="small muted">سجّل الدخول لعرض رقم التواصل.</div>' : '')}
                <div class="row"><button class="btn ghost sm" data-act2="fav">${I.heart} ${l.favorite ? 'في المفضلة' : 'أضف للمفضلة'}</button><button class="btn ghost sm" data-act2="share">${I.share} مشاركة</button><button class="btn ghost sm" data-act2="report">${I.flag} إبلاغ</button></div>`}
              ${user() && ['super_admin', 'country_admin'].includes(user().role) && !l.is_owner ? '<button class="btn danger sm" data-act2="admin-remove">إزالة (إدارة)</button>' : ''}
            </div></div>
          <div class="card"><h3>البائع</h3><div class="row"><span class="avatar">${esc(l.seller.name.charAt(0))}</span><div><b>${esc(l.seller.name)}</b><div class="small muted">عضو منذ ${W.fmtDate(l.seller.member_since)}</div></div></div>
            ${l.broker ? `<div class="notice info small" style="margin-top:10px">${I.handshake} عبر الوسيط ${esc(l.broker.display_name)} ${l.broker.verified ? '(موثّق)' : ''} — عمولة ${l.broker.commission_percent}%</div>` : ''}
            <div class="notice gold small" style="margin-top:10px">نصيحة: افحص المطية بنفسك، ولا تحوّل مبالغ قبل المعاينة. وسم لا يستلم أموال الصفقات.</div></div>
          ${l.breed ? `<a class="btn ghost" style="width:100%" href="#/valuation?breed=${encodeURIComponent(l.breed)}&sex=${l.sex || ''}&age_years=${l.age_years ?? ''}">${I.chart} تثمين استرشادي لمطايا مشابهة</a>` : ''}
        </aside></div>
      ${similar.length ? `<h2 style="margin-top:22px">إعلانات مشابهة</h2><div class="camel-grid">${similar.map(x => listingCard(x)).join('')}</div>` : ''}`;
    document.querySelectorAll('[data-g]').forEach(t => t.onclick = () => { $('#gmain').src = photo(t.dataset.g); document.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === t)); });
    document.querySelectorAll('[data-ls]').forEach(b => b.onclick = async () => {
      if (b.dataset.ls === 'removed' && !(await W.confirmBox('حذف الإعلان؟'))) return;
      try { await W.api('PATCH', '/api/listings/' + l.id, { status: b.dataset.ls }); W.toast('تم التحديث'); W.render(); } catch (e) { W.fail(e); }
    });
    const lp = $('#lphotos'); if (lp) lp.onchange = async () => {
      try { for (const f of lp.files) { const data = await W.readFile(f, true); const r = await W.api('POST', `/api/listings/${l.id}/photos`, { data_base64: data }); if (r.flagged) W.toast('تنبيه: صورة مطابقة لإعلان آخر — سيُراجع الإعلان', true); } W.toast('تم رفع الصور'); W.render(); } catch (e) { W.fail(e); }
    };
    document.querySelectorAll('[data-act2]').forEach(b => b.onclick = async () => {
      const a = b.dataset.act2;
      try {
        if (a === 'share') { const url = `${location.origin}/#/listing/${l.id}`; try { await navigator.clipboard.writeText(url); W.toast('تم نسخ رابط الإعلان'); } catch { W.modal('رابط الإعلان', `<input class="input" dir="ltr" readonly value="${esc(url)}">`); } return; }
        if (needLogin()) return;
        if (a === 'fav') { const r = await W.api('POST', `/api/listings/${l.id}/favorite`); W.toast(r.favorite ? 'أُضيف للمفضلة' : 'أُزيل من المفضلة'); W.render(); }
        if (a === 'offer') W.modal('عرض سعر', `<div class="stack"><p class="muted small">السعر المعلن: ${money(l.price, l.currency)}. العرض يصل للبائع فوراً ويقدر يقبله أو يرد بعرض مضاد.</p>
            <div class="field"><label>المبلغ (${CUR[l.currency]})</label><input class="input" name="amount" type="number" min="1" required></div><div class="field"><label>ملاحظة (اختياري)</label><input class="input" name="note"></div></div>`,
          async d => { const r = await W.api('POST', `/api/listings/${l.id}/offers`, d); W.toast('تم إرسال العرض'); W.go('/messages/' + r.conversation_id); });
        if (a === 'message') W.modal('رسالة للبائع', `<div class="field"><label>رسالتك</label><textarea class="input" name="body" required>السلام عليكم، بخصوص إعلان «${esc(l.title)}»</textarea></div>`,
          async d => { const r = await W.api('POST', `/api/listings/${l.id}/messages`, d); W.go('/messages/' + r.conversation_id); });
        if (a === 'report') reportModal('listing', l.id);
        if (a === 'admin-remove') W.modal('إزالة الإعلان', '<div class="field"><label>السبب (يصل للبائع)</label><input class="input" name="reason" required></div>', async d => { await W.api('POST', `/api/admin/listings/${l.id}/remove`, d); W.toast('أُزيل'); W.go('/market'); });
      } catch (e) { W.fail(e); }
    });
  };

  function reportModal(type, id) {
    W.modal('إبلاغ', `<div class="stack"><div class="field"><label>السبب</label><select class="input" name="reason">${['احتيال أو نصب', 'معلومات مضللة', 'صور ليست للمطية', 'محتوى مسيء', 'مكرر', 'أخرى'].map(r => `<option>${r}</option>`).join('')}</select></div>
      <div class="field"><label>تفاصيل</label><textarea class="input" name="details"></textarea></div><p class="small muted">البلاغ يصل لإدارة وسم في دولتك ويُراجع يدوياً.</p></div>`,
    async d => { await W.api('POST', '/api/reports', { target_type: type, target_id: id, ...d }); W.toast('شكراً، وصل بلاغك'); });
  }
  W.reportModal = reportModal;

  // ===================== إنشاء إعلان =====================
  W.views['listing-new'] = async () => {
    W.shell('market', 'إعلان جديد', W.loading());
    const [{ camels }, { brokers }] = await Promise.all([W.api('GET', '/api/camels'), W.api('GET', '/api/brokers')]);
    const active = camels.filter(c => !['sold', 'dead', 'transferred'].includes(c.status));
    const pre = W.state.query.get('camel') || '';
    const u = user();
    $('#page').innerHTML = `<a href="#/market" class="small">${I.chevron} السوق</a><h1 style="margin-top:8px">إعلان جديد</h1>
      <form class="card" id="lf" novalidate><div class="form-grid">
        <div class="field full"><label>من حلالي (يملأ البيانات والصور تلقائياً)</label><select class="input" name="camel_id" id="lcamel"><option value="">— إعلان بدون ربط بملف مطية —</option>${active.map(c => `<option value="${c.id}" ${c.id === pre ? 'selected' : ''}>${esc(c.name)}${c.tag_number ? ' (' + esc(c.tag_number) + ')' : ''}</option>`).join('')}</select></div>
        <div class="field full"><label>عنوان الإعلان *</label><input class="input" name="title" id="ltitle" required maxlength="120"></div>
        <div class="field full"><label>الوصف *</label><textarea class="input" name="description" id="ldesc" required style="min-height:130px"></textarea>
          <button type="button" class="btn ghost sm" id="aidesc" style="align-self:flex-start">${I.ai} اكتب الوصف من سجلات المطية</button></div>
        <div class="field"><label>السعر</label><input class="input" name="price" type="number" min="1" placeholder="اتركه فارغاً = على السوم"></div>
        <div class="field"><label>الدولة *</label><select class="input" name="country_code">${Object.entries(COUNTRY).map(([k, v]) => `<option value="${k}" ${k === u.country_code ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>المدينة / المنطقة</label><input class="input" name="city"></div>
        <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="negotiable" checked> قابل للتفاوض</label></div>
        <div class="field"><label>الفئة</label><input class="input" name="breed" list="lbreeds"><datalist id="lbreeds">${W.BREEDS.map(b => `<option value="${b}">`).join('')}</datalist></div>
        <div class="field"><label>الجنس</label><select class="input" name="sex"><option value="">—</option><option value="female">ناقة</option><option value="male">فحل</option></select></div>
        <div class="field"><label>العمر (سنوات)</label><input class="input" name="age_years" type="number" step="0.5" min="0" max="40"></div>
        <div class="field"><label>اللون</label><input class="input" name="color"></div>
        <div class="field"><label>طريقة التواصل</label><select class="input" name="contact_mode"><option value="in_app">رسائل وسم فقط (أكثر خصوصية)</option><option value="phone">اتصال</option><option value="whatsapp">واتساب</option></select></div>
        <div class="field"><label>رقم التواصل</label><input class="input" name="contact_phone" dir="ltr" value="${esc(u.phone || '')}"><span class="hint">يظهر للمسجلين فقط</span></div>
        <div class="field full"><label>الوسيط (اختياري)</label><select class="input" name="broker_id"><option value="">بدون وسيط</option>${brokers.map(b => `<option value="${b.id}">${esc(b.display_name)} — ${b.commission_percent}%${b.verified ? ' ✓' : ''}</option>`).join('')}</select></div>
      </div>
      <div class="notice gold small" style="margin-top:12px">بنشر الإعلان تؤكد أن المعلومات صحيحة وأن المطية ملكك أو مفوض ببيعها. الإعلانات تُراجع قبل النشر. لا تذكر نسباً «موثقاً» بدون مستند.</div>
      <div class="notice err" id="lferr" hidden style="margin-top:10px"></div>
      <div class="row" style="margin-top:14px"><button class="btn gold" type="submit">${I.check} نشر الإعلان</button><a class="btn ghost" href="#/market">إلغاء</a></div></form>`;
    const fill = async () => {
      const cid = $('#lcamel').value; if (!cid) return;
      try { const d = await W.api('POST', '/api/listings/draft', { camel_id: cid }); if (!$('#ltitle').value) $('#ltitle').value = d.title; $('#ldesc').value = d.description; $('#lf').dataset.ai = '1'; W.toast(d.notice); } catch (e) { W.fail(e); }
    };
    $('#aidesc').onclick = () => { if (!$('#lcamel').value) return W.toast('اختر مطية من حلالك أولاً', true); fill(); };
    $('#lcamel').onchange = fill; if (pre) fill();
    $('#lf').addEventListener('submit', async e => {
      e.preventDefault(); const box = $('#lferr'); box.hidden = true;
      const d = W.formData(e.target); for (const k of Object.keys(d)) if (d[k] === '') delete d[k];
      d.negotiable = e.target.negotiable.checked; d.description_ai = e.target.dataset.ai === '1';
      try { const r = await W.api('POST', '/api/listings', d); W.toast(r.listing.status === 'active' ? 'تم نشر الإعلان' : 'تم الإرسال — سيظهر بعد المراجعة'); W.go('/listing/' + r.listing.id); }
      catch (err) { box.textContent = err.message; box.hidden = false; }
    });
  };

  // ===================== المقارنة =====================
  W.views.compare = async () => {
    W.shell('market', 'مقارنة', W.loading());
    const d = await W.api('GET', '/api/listings/compare?ids=' + encodeURIComponent(W.state.query.get('ids') || ''));
    $('#page').innerHTML = `<a href="#/market" class="small">${I.chevron} السوق</a><h1 style="margin-top:8px">مقارنة الإعلانات</h1>
      <div class="card table-wrap"><table class="table"><thead><tr><th></th>${d.listings.map(l => `<th><a href="#/listing/${l.id}">${l.photo_id ? `<img src="${photo(l.photo_id)}" style="width:120px;height:90px;object-fit:cover;border-radius:10px;margin-bottom:6px">` : ''}<div>${esc(l.title)}</div></a></th>`).join('')}</tr></thead>
      <tbody>${d.rows.map(r => `<tr><th>${esc(r.label)}</th>${r.values.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${d.note ? `<p class="small" style="margin-top:10px">${esc(d.note)}</p>` : ''}<div class="notice gold small">${esc(d.disclaimer)}</div></div>`;
  };

  // ===================== الرسائل والعروض =====================
  W.views.messages = async cid => {
    W.shell('messages', 'الرسائل', W.loading());
    const { conversations } = await W.api('GET', '/api/conversations');
    const side = conversations.length ? `<ul class="list">${conversations.map(c => `<li style="${c.id === cid ? 'background:var(--ivory-2);border-radius:10px' : ''}"><a class="grow" href="#/messages/${c.id}" style="color:inherit"><div class="t">${esc(c.other.name)} ${c.unread ? `<span class="badge red">${c.unread}</span>` : ''}</div><div class="small muted">${esc(c.listing_title || '')}</div><div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last_body || '')}</div></a></li>`).join('')}</ul>` : '<p class="muted">لا توجد محادثات. راسل بائعاً من أي إعلان.</p>';
    $('#page').innerHTML = `<h1>الرسائل والعروض</h1><div class="convo"><div class="card side">${side}</div><div class="card" id="conv">${cid ? W.loading() : '<p class="muted">اختر محادثة.</p>'}</div></div>`;
    if (!cid) return;
    const draw = async () => {
      const c = await W.api('GET', '/api/conversations/' + cid);
      const openOffer = c.offers.find(o => o.status === 'open');
      const canRespond = openOffer && openOffer.from_user_id !== user().id;
      const mineOpen = openOffer && openOffer.from_user_id === user().id;
      $('#conv').innerHTML = `<div class="card-h"><div><h3 style="margin:0">${esc(c.other.name)}</h3>${c.listing ? `<a class="small" href="#/listing/${c.listing.id}">${esc(c.listing.title)} — ${money(c.listing.price, c.listing.currency)}</a>` : ''}</div>
          <button class="btn ghost sm" id="csum">${I.ai} لخّص التفاوض</button></div>
        <div class="thread" id="thread">${c.messages.map(m => `<div class="bubble ${m.kind === 'system' ? 'sys' : m.mine ? 'mine' : ''} ${m.kind === 'offer' ? 'offer' : ''}">${esc(m.body)}<div class="small" style="opacity:.6;margin-top:2px">${W.fmtDT(m.created_at)}</div></div>`).join('')}</div>
        ${canRespond ? `<div class="notice gold" style="margin:8px 0;justify-content:space-between;align-items:center;flex-wrap:wrap"><span>عرض مفتوح: <b>${money(openOffer.amount, openOffer.currency)}</b></span>
          <span class="row"><button class="btn sm" data-of="accept">قبول</button><button class="btn ghost sm" data-of="counter">عرض مضاد</button><button class="btn danger sm" data-of="reject">رفض</button></span></div>` : ''}
        ${mineOpen ? `<div class="notice info small" style="margin:8px 0">بانتظار رد ${esc(c.other.name)} على عرضك ${money(openOffer.amount, openOffer.currency)} <button class="btn ghost sm" data-of="withdraw">سحب العرض</button></div>` : ''}
        ${!openOffer && !c.is_seller && c.listing && c.listing.status === 'active' ? `<button class="btn ghost sm" id="newoffer" style="margin:6px 0">${I.handshake} عرض سعر جديد</button>` : ''}
        <form class="composer" id="mform" style="padding:8px 0 0;border:0"><input class="input" name="body" placeholder="اكتب رسالة…" autocomplete="off" maxlength="2000"><button class="btn gold" type="submit">${I.send}</button></form>
        <p class="small muted">لا تشارك بيانات بنكية. وسم لا يطلب منك تحويل أموال عبر الرسائل.</p>`;
      const th = $('#thread'); th.scrollTop = th.scrollHeight;
      $('#mform').onsubmit = async e => { e.preventDefault(); const b = e.target.body.value.trim(); if (!b) return; try { await W.api('POST', `/api/conversations/${cid}/messages`, { body: b }); draw(); } catch (err) { W.fail(err); } };
      $('#csum').onclick = async () => { const s = await W.api('GET', `/api/conversations/${cid}/summary`); W.modal('ملخص التفاوض', `<p style="white-space:pre-wrap">${esc(s.summary)}</p><div class="notice info small">ملخص آلي من الرسائل والعروض المسجلة فقط.</div>`); };
      document.querySelectorAll('[data-of]').forEach(b => b.onclick = async () => {
        const action = b.dataset.of;
        try {
          if (action === 'counter') return W.modal('عرض مضاد', '<div class="field"><label>المبلغ</label><input class="input" name="amount" type="number" min="1" required></div>', async d => { await W.api('POST', `/api/offers/${openOffer.id}/respond`, { action, amount: d.amount }); draw(); });
          if (action === 'accept' && !(await W.confirmBox(`قبول ${money(openOffer.amount, openOffer.currency)}؟ سيصبح الإعلان محجوزاً وتُسجل صفقة.`))) return;
          await W.api('POST', `/api/offers/${openOffer.id}/respond`, { action }); W.toast('تم'); draw();
        } catch (err) { W.fail(err); }
      });
      const no = $('#newoffer'); if (no) no.onclick = () => W.modal('عرض سعر', '<div class="field"><label>المبلغ</label><input class="input" name="amount" type="number" min="1" required></div>', async d => { await W.api('POST', `/api/listings/${c.listing.id}/offers`, d); draw(); });
    };
    await draw();
    W.on('message', m => { if (m.conversation_id === cid) draw(); });
  };

  // ===================== الصفقات =====================
  W.views.deals = async () => {
    W.shell('deals', 'صفقاتي', W.loading());
    const { deals } = await W.api('GET', '/api/deals');
    const ST = { agreed: ['متفق عليها — بانتظار التسليم', 'gold'], completed: ['مكتملة', 'green'], cancelled: ['ملغاة', ''], disputed: ['نزاع', 'red'] };
    const ROLE = { seller: 'بائع', buyer: 'مشتري', broker: 'وسيط' };
    $('#page').innerHTML = `<h1>صفقاتي</h1><p class="muted">الصفقات الناتجة عن قبول عرض أو الفوز بمزاد. وسم لا يستلم أموال الصفقات — الدفع والتسليم بين الطرفين.</p>
      ${deals.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>الصفقة</th><th>دورك</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${deals.map(d => `<tr><td><b>${esc(d.summary || '')}</b><div class="small muted">${esc(d.seller_name)} ← ${esc(d.buyer_name)}${d.broker_name ? ' • وسيط: ' + esc(d.broker_name) : ''} • ${W.fmtDate(d.created_at)}</div></td><td>${ROLE[d.role]}</td><td class="nowrap">${money(d.amount, d.currency)}</td>
        <td><span class="badge ${ST[d.status][1]}">${ST[d.status][0]}</span></td>
        <td class="nowrap">${d.status === 'agreed' ? `${d.role === 'seller' ? `<button class="btn sm" data-deal="${d.id}" data-st="completed">تم التسليم</button>` : ''} ${d.role !== 'broker' ? `<button class="btn ghost sm" data-deal="${d.id}" data-st="cancelled">إلغاء</button>` : ''}` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : W.emptyState('لا توجد صفقات بعد.', '<a class="btn" href="#/market">تصفح السوق</a>')}`;
    document.querySelectorAll('[data-deal]').forEach(b => b.onclick = async () => {
      if (!(await W.confirmBox(b.dataset.st === 'completed' ? 'تأكيد إتمام الصفقة؟ سيُسجل البيع في حلالك إن كانت المطية مربوطة.' : 'إلغاء الصفقة؟'))) return;
      try { await W.api('PATCH', '/api/deals/' + b.dataset.deal, { status: b.dataset.st }); W.toast('تم'); W.render(); } catch (e) { W.fail(e); }
    });
  };

  // ===================== الإشعارات =====================
  W.views.notifications = async () => {
    W.shell('notifications', 'الإشعارات', W.loading());
    const { notifications } = await W.api('GET', '/api/notifications');
    $('#page').innerHTML = `<div class="card-h"><h1 style="margin:0">الإشعارات</h1><button class="btn ghost sm" id="readall">تعليم الكل كمقروء</button></div>
      <div class="card">${notifications.length ? `<ul class="list">${notifications.map(n => `<li><span class="dot ${n.read_at ? '' : 'urgent'}" style="${n.read_at ? 'background:var(--line)' : ''}"></span><div class="grow">${n.link ? `<a href="${esc(n.link)}" class="t">${esc(n.title)}</a>` : `<span class="t">${esc(n.title)}</span>`}${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}</div><span class="small muted nowrap">${W.fmtDT(n.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">لا توجد إشعارات.</p>'}</div>`;
    $('#readall').onclick = async () => { await W.api('POST', '/api/notifications/read'); await W.refreshUnread(); W.render(); };
  };
})();
