/* وسم — المرحلة 3: المزادات المباشرة + الوسطاء + (م4) التثمين الاسترشادي */
(() => {
  'use strict';
  const W = window.W; const I = window.ICONS;
  const { esc } = W;
  const $ = s => document.querySelector(s);
  const AST = { live: ['مباشر الآن', 'red'], scheduled: ['قادم', 'gold'], ended: ['منتهي', ''], cancelled: ['ملغى', ''], pending_review: ['بانتظار الموافقة', 'warn'], rejected: ['مرفوض', 'red'] };
  const user = () => W.state.user;
  let skew = 0; // فرق توقيت الجهاز عن الخادم
  const left = iso => Math.max(0, new Date(iso) - (Date.now() + skew));
  const fmtLeft = ms => { const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return d ? `${d}ي ${h}س ${m}د` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };

  function auctionCard(a) {
    const st = AST[a.status] || ['', ''];
    return `<a class="camel-card" href="#/auction/${a.id}"><div class="ph">${a.photo_id ? `<img src="/api/listing-photos/${a.photo_id}" alt="" loading="lazy">` : `<div class="ph-fallback">${I.gavel}</div>`}
      <span class="badge ${st[1]} sex">${a.status === 'live' ? '<span class="live-dot"></span>' : ''}${st[0]}</span></div>
      <div class="body"><div class="name">${esc(a.title)}</div><div class="meta">${esc([a.breed, W.COUNTRY[a.country_code]].filter(Boolean).join(' • '))} • ${a.bid_count} مزايدة</div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="price">${W.money(a.current_price || a.start_price, a.currency)}</span>
        <span class="small muted" data-cd="${a.status === 'live' ? a.ends_at : a.status === 'scheduled' ? a.starts_at : ''}"></span></div>${a.is_demo ? '<span class="badge">تجريبي</span>' : ''}</div></a>`;
  }
  function tickCountdowns() {
    document.querySelectorAll('[data-cd]').forEach(el => { if (!el.dataset.cd) return; const ms = left(el.dataset.cd); el.textContent = ms ? (el.classList.contains('countdown') ? fmtLeft(ms) : 'باقي ' + fmtLeft(ms)) : 'انتهى الوقت'; el.classList.toggle('urgent', ms < 120000); });
  }
  setInterval(tickCountdowns, 1000);

  W.views.auctions = async () => {
    const tab = W.state.query.get('status') || 'live';
    W.shell('auctions', 'المزادات', W.loading());
    const [{ auctions }, sp] = await Promise.all([W.api('GET', '/api/auctions?' + (tab === 'all' ? '' : 'status=' + tab)), W.sponsor('auctions')]);
    const tabs = [['live', 'المباشرة'], ['scheduled', 'القادمة'], ['ended', 'المنتهية']].concat(user() ? [['mine', 'مزاداتي ومتابعاتي']] : []);
    $('#page').innerHTML = `${sp}<div class="card-h"><div><h1 style="margin:0">المزادات الإلكترونية</h1><p class="muted" style="margin:0">كل مزايدة تُعالج على الخادم بتوقيته، والسجل غير قابل للتعديل</p></div><a class="btn gold" href="#/auction-new">${I.plus} أنشئ مزاداً</a></div>
      <div class="tabs" style="margin-top:6px">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      ${auctions.length ? `<div class="camel-grid">${auctions.map(auctionCard).join('')}</div>` : W.emptyState('لا توجد مزادات في هذا القسم.')}`;
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => W.go('/auctions?status=' + b.dataset.t));
    tickCountdowns();
  };

  W.views.auction = async id => {
    W.shell('auctions', 'مزاد', W.loading());
    let { auction: a } = await W.api('GET', '/api/auctions/' + id);
    skew = new Date(a.server_time) - Date.now();
    const verify = await W.api('GET', `/api/auctions/${id}/verify`);
    const draw = () => {
      const st = AST[a.status] || ['', ''];
      const canBid = a.status === 'live' && user() && !a.is_seller && !a.leading;
      $('#page').innerHTML = `<a href="#/auctions" class="small">${I.chevron} المزادات</a>
      <div class="grid g-main" style="margin-top:10px">
        <section>
          <div class="card"><div class="row"><h1 style="margin:0">${esc(a.title)}</h1><span class="badge ${st[1]}">${a.status === 'live' ? '<span class="live-dot"></span>' : ''}${st[0]}</span>${a.is_demo ? '<span class="badge">تجريبي</span>' : ''}</div>
            <div class="muted">${esc([a.breed, a.sex === 'female' ? 'ناقة' : a.sex === 'male' ? 'فحل' : '', a.age_years ? a.age_years + ' سنة' : '', W.COUNTRY[a.country_code]].filter(Boolean).join(' • '))} • البائع: ${esc(a.seller.name)}</div>
            ${a.description ? `<p style="white-space:pre-wrap;margin-top:10px">${esc(a.description)}</p>` : ''}
            ${a.listing_id ? `<a class="btn ghost sm" href="#/listing/${a.listing_id}">عرض الإعلان والصور</a>` : ''}
            <div class="notice gold small" style="margin-top:12px">${esc(a.rules)}</div></div>
          <div class="card"><div class="card-h"><h3>سجل المزايدات (${a.bid_count})</h3><span class="badge ${verify.valid ? 'green' : 'red'}">${verify.valid ? '✓ السجل سليم (سلسلة التجزئة متطابقة)' : '⚠ خلل في السجل'}</span></div>
            ${a.bids.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>المزايد</th><th>المبلغ</th><th>التوقيت (الخادم)</th></tr></thead><tbody>${a.bids.map((b, i) => `<tr class="bid-row ${i === 0 ? 'flash' : ''}"><td>${b.mine ? '<b>أنت</b>' : esc(b.bidder)}</td><td class="nowrap"><b>${W.money(b.amount, a.currency)}</b></td><td class="small muted">${new Date(b.time).toLocaleTimeString('ar-QA-u-nu-latn')}${b.extended ? ' • مدّد الوقت' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">لا توجد مزايدات بعد.</p>'}</div>
        </section>
        <aside><div class="card">
          <div class="small muted">${a.status === 'scheduled' ? 'يبدأ بعد' : a.status === 'live' ? 'ينتهي بعد' : 'الحالة'}</div>
          ${['live', 'scheduled'].includes(a.status) ? `<div class="countdown" data-cd="${a.status === 'live' ? a.ends_at : a.starts_at}"></div>${a.extended ? '<div class="small" style="color:var(--warn)">مُدّد بسبب مزايدة في اللحظات الأخيرة</div>' : ''}` : `<div><b>${a.winner ? esc(a.winner) : esc(st[0])}</b>${a.final_price ? ` — ${W.money(a.final_price, a.currency)}` : ''}</div>${a.cancel_reason ? `<div class="small muted">${esc(a.cancel_reason)}</div>` : ''}`}
          <div style="margin-top:12px" class="small muted">${a.current_price ? 'أعلى مزايدة' : 'سعر البداية'}</div><div class="price big" id="curp">${W.money(a.current_price || a.start_price, a.currency)}</div>
          ${a.leading ? '<span class="badge green">أنت صاحب أعلى مزايدة</span>' : ''}
          ${a.reserve_set ? `<div class="small" style="margin-top:4px">${a.reserve_met ? '✓ تم بلوغ السعر الأدنى للبيع' : 'لم يُبلغ السعر الأدنى للبيع بعد'}</div>` : ''}
          ${canBid ? `<form id="bidf" class="stack" style="margin-top:12px"><div class="field"><label>مزايدتك (أقل مبلغ ${W.money(a.min_next_bid, a.currency)})</label><input class="input" name="amount" type="number" min="${a.min_next_bid}" step="${a.min_increment}" value="${a.min_next_bid}" required></div>
            <div class="row">${[1, 2, 5].map(k => `<button type="button" class="btn ghost sm" data-quick="${a.min_next_bid + (k - 1) * a.min_increment}">${W.money(a.min_next_bid + (k - 1) * a.min_increment, a.currency)}</button>`).join('')}</div>
            <button class="btn gold" type="submit">${I.gavel} زايد الآن</button><p class="small muted">بالضغط تؤكد مزايدة ملزمة. لا يمكن سحب المزايدة.</p></form>`
            : a.status === 'live' && !user() ? '<a class="btn gold" href="#/login" style="margin-top:12px;width:100%">سجّل الدخول للمزايدة</a>' : ''}
          ${user() && !a.is_seller ? `<button class="btn ghost sm" id="watch" style="margin-top:10px">${I.eye} ${a.watching ? 'إلغاء المتابعة' : 'تابع المزاد'}</button>` : ''}
          ${a.is_seller && ['pending_review', 'scheduled', 'live'].includes(a.status) && !a.bid_count ? '<button class="btn danger sm" id="cancelA" style="margin-top:10px">إلغاء المزاد</button>' : ''}
          ${user() && !a.is_seller ? `<button class="btn ghost sm" id="repA" style="margin-top:10px">${I.flag} إبلاغ</button>` : ''}
        </div><div class="notice info small">التنبيهات: يصلك إشعار فوري إذا تجاوزك أحد، وقبل انتهاء المزاد بـ 15 دقيقة.</div></aside></div>`;
      tickCountdowns();
      const f = $('#bidf');
      if (f) {
        document.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { f.amount.value = b.dataset.quick; });
        f.onsubmit = async e => {
          e.preventDefault(); const amount = Number(f.amount.value);
          if (!(await W.confirmBox(`تأكيد مزايدة ملزمة بمبلغ ${W.money(amount, a.currency)}؟`))) return;
          try { const r = await W.api('POST', `/api/auctions/${id}/bids`, { amount }); a = r.auction; W.toast(r.extended ? 'تمت المزايدة — ومُدّد وقت المزاد' : 'تمت المزايدة ✓'); draw(); }
          catch (err) { W.fail(err); }
        };
      }
      const w = $('#watch'); if (w) w.onclick = async () => { const r = await W.api('POST', `/api/auctions/${id}/watch`); a.watching = r.watching; draw(); };
      const c = $('#cancelA'); if (c) c.onclick = async () => { if (await W.confirmBox('إلغاء المزاد؟')) { await W.api('POST', `/api/auctions/${id}/cancel`, {}); W.render(); } };
      const rp = $('#repA'); if (rp) rp.onclick = () => W.reportModal('auction', id);
    };
    draw();
    // بث مباشر للمزاد
    try {
      const es = new EventSource('/api/stream?auction=' + id); W.state.topicES = es;
      const refresh = async () => { const r = await W.api('GET', '/api/auctions/' + id); a = r.auction; skew = new Date(a.server_time) - Date.now(); draw(); };
      es.addEventListener('bid', ev => { const d = JSON.parse(ev.data); if (d.current_price !== a.current_price) { refresh(); } });
      es.addEventListener('status', () => refresh());
    } catch { /* */ }
  };

  W.views['auction-new'] = async () => {
    W.shell('auctions', 'مزاد جديد', W.loading());
    const [{ camels }, { listings }] = await Promise.all([W.api('GET', '/api/camels'), W.api('GET', '/api/listings?seller=me&limit=100')]);
    const pre = W.state.query.get('listing') || '';
    const now = new Date(Date.now() + 3 * 3600000); const local = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#page').innerHTML = `<a href="#/auctions" class="small">${I.chevron} المزادات</a><h1 style="margin-top:8px">إنشاء مزاد</h1>
      <form class="card" id="af"><div class="form-grid">
        <div class="field full"><label>العنوان *</label><input class="input" name="title" required></div>
        <div class="field"><label>ربط بإعلان (للصور والتفاصيل)</label><select class="input" name="listing_id"><option value="">—</option>${listings.filter(l => ['active', 'pending_review'].includes(l.status)).map(l => `<option value="${l.id}" ${l.id === pre ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></div>
        <div class="field"><label>أو مطية من حلالي</label><select class="input" name="camel_id"><option value="">—</option>${camels.filter(c => !['sold', 'dead', 'transferred'].includes(c.status)).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>سعر البداية *</label><input class="input" name="start_price" type="number" min="1" required></div>
        <div class="field"><label>أقل زيادة</label><input class="input" name="min_increment" type="number" min="1" placeholder="تلقائي 2%"></div>
        <div class="field"><label>السعر الأدنى للبيع (سري، اختياري)</label><input class="input" name="reserve_price" type="number" min="1"><span class="hint">إذا لم يُبلغ، ينتهي المزاد بدون بيع</span></div>
        <div class="field"><label>الدولة</label><select class="input" name="country_code">${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}" ${k === user().country_code ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>يبدأ *</label><input class="input" name="starts_at" type="datetime-local" value="${local(new Date())}" required></div>
        <div class="field"><label>ينتهي *</label><input class="input" name="ends_at" type="datetime-local" value="${local(now)}" required></div>
        <div class="field full"><label>الوصف</label><textarea class="input" name="description"></textarea></div></div>
        <div class="notice gold small" style="margin-top:12px">المزاد يُراجع من الإدارة قبل البدء. المزايدة ملزمة، وأي مزايدة في آخر دقيقتين تمدد الوقت تلقائياً لمنع القنص.</div>
        <div class="notice err" id="aferr" hidden style="margin-top:10px"></div>
        <button class="btn gold" type="submit" style="margin-top:14px">${I.check} إرسال المزاد</button></form>`;
    $('#af').onsubmit = async e => {
      e.preventDefault(); const d = W.formData(e.target); for (const k of Object.keys(d)) if (d[k] === '') delete d[k];
      d.starts_at = new Date(d.starts_at).toISOString(); d.ends_at = new Date(d.ends_at).toISOString();
      try { const r = await W.api('POST', '/api/auctions', d); W.toast(r.auction.status === 'pending_review' ? 'أُرسل المزاد للمراجعة' : 'تم إنشاء المزاد'); W.go('/auction/' + r.auction.id); }
      catch (err) { const b = $('#aferr'); b.textContent = err.message; b.hidden = false; }
    };
  };

  // ===================== الوسطاء =====================
  W.views.brokers = async () => {
    W.shell('brokers', 'الوسطاء', W.loading());
    const country = W.state.query.get('country') || '';
    const [{ brokers }, mine] = await Promise.all([W.api('GET', '/api/brokers' + (country ? '?country=' + country : '')), user() ? W.api('GET', '/api/brokers/me') : Promise.resolve({ broker: null })]);
    $('#page').innerHTML = `<div class="card-h"><div><h1 style="margin:0">الوسطاء</h1><p class="muted" style="margin:0">وسطاء بعمولة معلنة. الموثّقون عليهم علامة ✓</p></div>${user() ? `<button class="btn gold" id="bme">${mine.broker ? 'تعديل ملفي كوسيط' : 'سجّل كوسيط'}</button>` : ''}</div>
      <div class="row" style="margin:10px 0">${['', ...Object.keys(W.COUNTRY)].map(c => `<a class="chip" href="#/brokers${c ? '?country=' + c : ''}" style="${c === country ? 'background:var(--gold-100);border-color:var(--gold-500)' : ''}">${c ? W.COUNTRY[c] : 'الكل'}</a>`).join('')}</div>
      ${brokers.length ? `<div class="grid g3">${brokers.map(b => `<div class="card"><div class="row"><span class="avatar">${esc(b.display_name.charAt(0))}</span><div><b>${esc(b.display_name)}</b> ${b.verified ? '<span class="badge green">✓ موثّق</span>' : ''}<div class="small muted">${esc(W.COUNTRY[b.country_code])}${b.city ? ' — ' + esc(b.city) : ''}</div></div></div>
        ${b.bio ? `<p class="small" style="margin-top:8px">${esc(b.bio)}</p>` : ''}<div class="row small" style="margin-top:8px"><span class="badge gold">عمولة ${b.commission_percent}%</span><span class="badge">${b.deals_done} صفقة مكتملة</span><span class="badge">${b.active_listings} إعلان</span></div>
        ${b.phone ? `<div class="small" style="margin-top:8px">التواصل: <b dir="ltr">${esc(b.phone)}</b></div>` : user() ? '' : '<div class="small muted" style="margin-top:8px">سجّل الدخول لعرض رقم التواصل</div>'}</div>`).join('')}</div>` : W.emptyState('لا يوجد وسطاء مسجلون في هذه الدولة بعد.')}`;
    const bm = $('#bme'); if (bm) bm.onclick = () => {
      const b = mine.broker || {};
      W.modal('ملف الوسيط', `<div class="stack"><div class="field"><label>الاسم التجاري</label><input class="input" name="display_name" value="${esc(b.display_name || user().display_name)}"></div>
        <div class="field"><label>الدولة</label><select class="input" name="country_code">${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}" ${k === (b.country_code || user().country_code) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>المدينة</label><input class="input" name="city" value="${esc(b.city || '')}"></div><div class="field"><label>رقم التواصل</label><input class="input" name="phone" dir="ltr" value="${esc(b.phone || '')}"></div>
        <div class="field"><label>نسبة العمولة %</label><input class="input" name="commission_percent" type="number" step="0.5" min="0" max="20" value="${b.commission_percent ?? 2.5}"></div>
        <div class="field"><label>نبذة</label><textarea class="input" name="bio">${esc(b.bio || '')}</textarea></div><p class="small muted">التوثيق (✓) تمنحه الإدارة بعد التحقق.</p></div>`,
      async d => { await W.api('PUT', '/api/brokers/me', d); W.toast('تم الحفظ'); W.state.user = (await W.api('GET', '/api/me')).user; W.render(); });
    };
  };

  // ===================== التثمين الاسترشادي (م4) =====================
  W.views.valuation = async () => {
    W.shell('valuation', 'التثمين الاسترشادي', W.loading());
    const q = W.state.query;
    const ages = await W.loadAges();
    let res = null;
    if (q.get('breed')) res = await W.api('GET', '/api/valuation?' + q.toString());
    $('#page').innerHTML = `<h1>التثمين الاسترشادي</h1><p class="muted">نطاق أسعار مبني على صفقات <b>مكتملة فعلياً</b> على وسم لمطايا مشابهة. لا نعطي رقماً إذا لم تتوفر بيانات كافية.</p>
      <form class="card" id="vf"><div class="filters">
        <input class="input" name="breed" list="vbreeds" placeholder="الفئة *" value="${esc(q.get('breed') || '')}" required><datalist id="vbreeds">${W.BREEDS.map(b => `<option value="${b}">`).join('')}</datalist>
        <select class="input" name="sex"><option value="">الجنس</option><option value="female" ${q.get('sex') === 'female' ? 'selected' : ''}>ناقة</option><option value="male" ${q.get('sex') === 'male' ? 'selected' : ''}>فحل</option></select>
        <input class="input" name="age_years" type="number" step="0.5" min="0" placeholder="العمر بالسنوات" value="${esc(q.get('age_years') || '')}">
        <select class="input" name="country"><option value="">كل الخليج</option>${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}" ${q.get('country') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn" type="submit">${I.chart} احسب</button></div>
        <p class="small muted" style="margin:8px 0 0">أسماء الأعمار: ${ages.map(a => a.m).join('، ')}</p></form>
      <div id="vres">${res ? (res.available ? `<div class="card"><h2>${Math.round(res.p25).toLocaleString('en')} – ${Math.round(res.p75).toLocaleString('en')} ر.ق</h2>
          <p>الوسيط: <b>${Math.round(res.median).toLocaleString('en')} ر.ق</b> • مبني على <b>${res.samples}</b> صفقة مكتملة (${esc(res.basis)})</p><div class="notice gold">${esc(res.notice)}</div></div>`
        : `<div class="card"><div class="notice info">${esc(res.notice)}</div><a class="btn ghost" style="margin-top:10px" href="#/market?breed=${encodeURIComponent(q.get('breed'))}">شوف الإعلانات الحالية للمقارنة</a></div>`) : ''}</div>`;
    $('#vf').onsubmit = e => { e.preventDefault(); W.go('/valuation?' + new URLSearchParams(Object.entries(W.formData(e.target)).filter(([, v]) => v)).toString()); };
  };
})();
