/* وسم — لوحة الإدارة (مدير عام / مدير دولة) */
(() => {
  'use strict';
  const W = window.W; const I = window.ICONS;
  const { esc } = W;
  const $ = s => document.querySelector(s);
  const TABS = [['overview', 'نظرة عامة'], ['listings', 'مراجعة الإعلانات'], ['auctions', 'المزادات'], ['reports', 'البلاغات'], ['alerts', 'تنبيهات الذكاء الاصطناعي'], ['users', 'المستخدمون'], ['partners', 'الشركاء'], ['settings', 'الإعدادات']];
  const ROLE = { user: 'مستخدم', owner: 'مالك حلال', trader: 'تاجر', broker: 'وسيط', company: 'شركة', provider: 'مقدم خدمة', country_admin: 'مدير دولة', super_admin: 'مدير عام' };
  const SEV = { high: ['عالية', 'red'], medium: ['متوسطة', 'warn'], low: ['منخفضة', ''] };
  const isSuper = () => W.state.user.role === 'super_admin';
  const post = async (path, body, msg = 'تم') => { try { await W.api('POST', path, body); W.toast(msg); W.render(); } catch (e) { W.fail(e); } };
  const bars = arr => { const m = Math.max(1, ...arr); return `<div class="bars">${arr.map(v => `<span style="height:${Math.round(v / m * 100)}%" title="${v}"></span>`).join('')}</div>`; };

  W.views.admin = async tab => {
    const u = W.state.user;
    if (!['super_admin', 'country_admin'].includes(u.role)) return W.shell('admin', 'الإدارة', W.emptyState('هذه الصفحة للمديرين فقط.'));
    tab = tab || 'overview';
    W.shell('admin', 'لوحة الإدارة', `<div class="card-h"><h1 style="margin:0">لوحة الإدارة</h1><span class="badge gold">${u.role === 'super_admin' ? 'مدير عام — كل الدول' : 'مدير دولة: ' + esc(W.COUNTRY[u.admin_country_code] || '')}</span></div>
      <div class="tabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-at="${k}">${l}</button>`).join('')}</div><div id="ab">${W.loading()}</div>`);
    document.querySelectorAll('[data-at]').forEach(b => b.onclick = () => W.go('/admin/' + b.dataset.at));
    const box = $('#ab');

    if (tab === 'overview') {
      const s = await W.api('GET', '/api/admin/stats');
      const k = [['المستخدمون', s.users], ['الإعلانات النشطة', s.listings_active], ['بانتظار المراجعة', s.listings_pending], ['الإبل المسجلة', s.camels], ['المزادات المباشرة', s.auctions_live], ['الصفقات المكتملة', s.deals_completed],
        ['قيمة الصفقات (ر.ق)', s.gmv_qar.toLocaleString('en')], ['العمولات (ر.ق)', s.commissions_qar.toLocaleString('en')], ['إيراد الحملات (ر.ق)', s.campaign_revenue_qar.toLocaleString('en')], ['الشركاء', s.partners_active], ['بلاغات مفتوحة', s.reports_open], ['تنبيهات AI', s.alerts_open]];
      box.innerHTML = `<div class="kpi-grid">${k.map(([l, v]) => `<div class="stat"><div class="k">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
        <div class="grid g3" style="margin-top:16px">${[['مستخدمون جدد', s.series.users], ['إعلانات جديدة', s.series.listings], ['صفقات', s.series.deals]].map(([l, a]) => `<div class="card"><h3>${l} — آخر 30 يوماً</h3>${bars(a)}<div class="small muted">المجموع: ${a.reduce((x, y) => x + y, 0)}</div></div>`).join('')}</div>
        ${s.by_country ? `<div class="card"><h3>الدول الست</h3><div class="table-wrap"><table class="table"><thead><tr><th>الدولة</th><th>المستخدمون</th><th>الإعلانات</th><th>الشركاء</th><th>الحالة</th></tr></thead><tbody>${s.by_country.map(c => `<tr><td>${esc(c.name_ar)}</td><td>${c.users}</td><td>${c.listings}</td><td>${c.partners}</td><td><button class="btn ${c.is_active ? 'ghost' : 'danger'} sm" data-country="${c.code}" data-on="${c.is_active ? 0 : 1}">${c.is_active ? 'مفعّلة' : 'موقوفة'}</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
      document.querySelectorAll('[data-country]').forEach(b => b.onclick = () => post(`/api/admin/countries/${b.dataset.country}`, { active: b.dataset.on === '1' }));
    }
    if (tab === 'listings') {
      const { listings } = await W.api('GET', '/api/admin/listings');
      box.innerHTML = listings.length ? `<div class="grid g2">${listings.map(l => `<div class="card"><div class="row">${l.photo_id ? `<img src="/api/listing-photos/${l.photo_id}" style="width:90px;height:68px;object-fit:cover;border-radius:10px">` : ''}<div class="grow"><a href="#/listing/${l.id}"><b>${esc(l.title)}</b></a><div class="small muted">${esc(l.seller)} • ${esc(W.COUNTRY[l.country_code])} • ${W.money(l.price, l.currency)}</div>${l.flags ? '<span class="badge red">صورة مكررة</span>' : ''}</div></div>
        <div class="row" style="margin-top:10px"><button class="btn sm" data-ap="${l.id}">${I.check} نشر</button><button class="btn danger sm" data-rj="${l.id}">رفض</button></div></div>`).join('')}</div>` : W.emptyState('لا توجد إعلانات بانتظار المراجعة 👌');
      document.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => post(`/api/admin/listings/${b.dataset.ap}/review`, { approve: true }, 'تم النشر'));
      document.querySelectorAll('[data-rj]').forEach(b => b.onclick = () => W.modal('رفض الإعلان', '<div class="field"><label>السبب (يصل للبائع)</label><input class="input" name="reason" required></div>', async d => { await W.api('POST', `/api/admin/listings/${b.dataset.rj}/review`, { approve: false, reason: d.reason }); W.render(); }));
    }
    if (tab === 'auctions') {
      const { auctions } = await W.api('GET', '/api/admin/auctions');
      box.innerHTML = auctions.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>المزاد</th><th>الحالة</th><th>السعر</th><th>السجل</th><th></th></tr></thead><tbody>${auctions.map(a => `<tr><td><a href="#/auction/${a.id}">${esc(a.title)}</a><div class="small muted">${esc(a.seller)} • ${a.bid_count} مزايدة • ينتهي ${W.fmtDT(a.ends_at)}</div></td><td>${a.status === 'pending_review' ? '<span class="badge warn">بانتظار الموافقة</span>' : esc(a.status)}</td><td>${W.money(a.current_price || a.start_price, a.currency)}</td><td>${a.chain.valid ? '<span class="badge green">سليم</span>' : '<span class="badge red">خلل!</span>'}</td>
        <td class="nowrap">${a.status === 'pending_review' ? `<button class="btn sm" data-aok="${a.id}">موافقة</button><button class="btn danger sm" data-ano="${a.id}">رفض</button>` : `<button class="btn danger sm" data-acx="${a.id}">إلغاء</button>`}</td></tr>`).join('')}</tbody></table></div>` : W.emptyState('لا توجد مزادات نشطة أو معلقة.');
      document.querySelectorAll('[data-aok]').forEach(b => b.onclick = () => post(`/api/admin/auctions/${b.dataset.aok}/review`, { approve: true }));
      document.querySelectorAll('[data-ano]').forEach(b => b.onclick = () => W.modal('رفض المزاد', '<div class="field"><label>السبب</label><input class="input" name="reason" required></div>', async d => { await W.api('POST', `/api/admin/auctions/${b.dataset.ano}/review`, { approve: false, reason: d.reason }); W.render(); }));
      document.querySelectorAll('[data-acx]').forEach(b => b.onclick = () => W.modal('إلغاء المزاد', '<div class="field"><label>السبب (يصل للمتابعين)</label><input class="input" name="reason" required></div>', async d => { await W.api('POST', `/api/auctions/${b.dataset.acx}/cancel`, d); W.render(); }));
    }
    if (tab === 'reports') {
      const st = W.state.query.get('status') || 'open';
      const { reports } = await W.api('GET', '/api/admin/reports?status=' + st);
      const link = r => ({ listing: `#/listing/${r.target_id}`, auction: `#/auction/${r.target_id}`, post: `#/community/${r.target_id}` })[r.target_type];
      box.innerHTML = `<div class="row" style="margin-bottom:10px">${[['open', 'مفتوحة'], ['actioned', 'تم الإجراء'], ['dismissed', 'مرفوضة']].map(([k, l]) => `<a class="chip" href="#/admin/reports?status=${k}" style="${k === st ? 'background:var(--gold-100)' : ''}">${l}</a>`).join('')}</div>
        ${reports.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>البلاغ</th><th>العنصر</th><th>المبلّغ</th><th></th></tr></thead><tbody>${reports.map(r => `<tr><td><b>${esc(r.reason)}</b><div class="small muted">${esc(r.details || '')}</div><div class="small muted">${W.fmtDT(r.created_at)}</div></td><td>${esc(r.target_type)}: ${link(r) ? `<a href="${link(r)}">${esc(r.target_title)}</a>` : esc(r.target_title)}</td><td class="small">${esc(r.reporter || '—')}</td>
          <td class="nowrap">${r.status === 'open' ? `<button class="btn danger sm" data-rp="${r.id}" data-a="remove">إزالة</button><button class="btn danger sm" data-rp="${r.id}" data-a="suspend_user">إيقاف صاحبه</button><button class="btn ghost sm" data-rp="${r.id}" data-a="dismiss">تجاهل</button>` : esc(r.handled_note || '')}</td></tr>`).join('')}</tbody></table></div>` : W.emptyState('لا توجد بلاغات.')}`;
      document.querySelectorAll('[data-rp]').forEach(b => b.onclick = async () => { if (b.dataset.a !== 'dismiss' && !(await W.confirmBox('تأكيد الإجراء؟'))) return; post(`/api/admin/reports/${b.dataset.rp}`, { action: b.dataset.a }); });
    }
    if (tab === 'alerts') {
      const { alerts } = await W.api('GET', '/api/admin/alerts');
      box.innerHTML = `<div class="notice info small" style="margin-bottom:12px">تنبيهات آلية للمراجعة البشرية فقط: أنماط مزايدة غير معتادة، وصور مكررة بين بائعين. لا يُتخذ أي إجراء تلقائي.</div>
        ${alerts.length ? `<div class="card table-wrap"><table class="table"><thead><tr><th>الخطورة</th><th>التنبيه</th><th>العنصر</th><th>الدليل</th><th></th></tr></thead><tbody>${alerts.map(a => `<tr><td><span class="badge ${SEV[a.severity][1]}">${SEV[a.severity][0]}</span></td><td>${esc(a.reason)}<div class="small muted">${W.fmtDT(a.created_at)}</div></td>
          <td><a href="#/${a.target_type === 'auction' ? 'auction' : 'listing'}/${a.target_id}">${esc(a.target_title)}</a></td><td class="small" style="max-width:240px;word-break:break-all">${esc(JSON.stringify(a.evidence || {}))}</td>
          <td class="nowrap"><button class="btn ghost sm" data-al="${a.id}" data-a="cleared">سليم</button><button class="btn danger sm" data-al="${a.id}" data-a="actioned">تم الإجراء</button></td></tr>`).join('')}</tbody></table></div>` : W.emptyState('لا توجد تنبيهات مفتوحة 👌')}`;
      document.querySelectorAll('[data-al]').forEach(b => b.onclick = () => post(`/api/admin/alerts/${b.dataset.al}`, { action: b.dataset.a }));
    }
    if (tab === 'users') {
      const q = W.state.query.get('q') || '';
      const { users } = await W.api('GET', '/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      box.innerHTML = `<form id="uq" class="row" style="margin-bottom:10px"><input class="input" name="q" placeholder="بحث بالاسم أو البريد" value="${esc(q)}" style="flex:1"><button class="btn">بحث</button></form>
        <div class="card table-wrap"><table class="table"><thead><tr><th>المستخدم</th><th>الدولة</th><th>الدور</th><th>الحلال/الإعلانات</th><th></th></tr></thead><tbody>${users.map(x => `<tr><td><b>${esc(x.display_name)}</b><div class="small muted" dir="ltr" style="text-align:right">${esc(x.email)}</div></td><td>${esc(x.country_code)}</td>
          <td>${ROLE[x.role]}${x.admin_country_code ? ' (' + x.admin_country_code + ')' : ''}${x.is_suspended ? ' <span class="badge red">موقوف</span>' : ''}</td><td>${x.camels} / ${x.listings}</td>
          <td class="nowrap"><button class="btn ghost sm" data-sus="${x.id}" data-on="${x.is_suspended ? 0 : 1}">${x.is_suspended ? 'إلغاء الإيقاف' : 'إيقاف'}</button>${isSuper() ? `<button class="btn ghost sm" data-role="${x.id}" data-r="${x.role}">الدور</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      $('#uq').onsubmit = e => { e.preventDefault(); W.go('/admin/users?q=' + encodeURIComponent(e.target.q.value)); };
      document.querySelectorAll('[data-sus]').forEach(b => b.onclick = () => post(`/api/admin/users/${b.dataset.sus}/suspend`, { suspended: b.dataset.on === '1' }));
      document.querySelectorAll('[data-role]').forEach(b => b.onclick = () => W.modal('تغيير الدور', `<div class="stack"><div class="field"><label>الدور</label><select class="input" name="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === b.dataset.r ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>دولة المدير (لمدير الدولة)</label><select class="input" name="admin_country_code"><option value="">—</option>${Object.entries(W.COUNTRY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>`, async d => { await W.api('POST', `/api/admin/users/${b.dataset.role}/role`, d); W.render(); }));
    }
    if (tab === 'partners') {
      const d = await W.api('GET', '/api/admin/partners');
      const CS = { pending: ['بانتظار', 'warn'], active: ['معتمد', 'green'], suspended: ['موقوف', 'red'], rejected: ['مرفوض', ''] };
      box.innerHTML = `<div class="card"><h3>الشركات</h3><div class="table-wrap"><table class="table"><tbody>${d.companies.map(c => `<tr><td><b>${esc(c.name_ar)}</b><div class="small muted">${esc(c.category)} • ${esc(c.country_code)} • ${esc(c.owner_email)}${c.cr_number ? ' • س.ت ' + esc(c.cr_number) : ''}</div></td><td><span class="badge ${CS[c.status][1]}">${CS[c.status][0]}</span></td>
          <td class="nowrap">${c.status !== 'active' ? `<button class="btn sm" data-co="${c.id}" data-a="approve">اعتماد</button>` : `<button class="btn ghost sm" data-co="${c.id}" data-a="suspend">إيقاف</button>`}${c.status === 'pending' ? `<button class="btn danger sm" data-co="${c.id}" data-a="reject">رفض</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">لا توجد شركات</td></tr>'}</tbody></table></div></div>
        <div class="card"><h3>الحملات</h3><div class="table-wrap"><table class="table"><thead><tr><th>الحملة</th><th>الباقة</th><th>الحالة</th><th>الظهور/النقر</th><th></th></tr></thead><tbody>${d.campaigns.map(c => `<tr><td><b>${esc(c.headline)}</b><div class="small muted">${esc(c.company)}${c.section ? ' • ' + esc(c.section) : ''}</div></td><td class="small">${esc(c.package_name)}<div>${W.money(c.amount, c.currency)} • ${c.payment_status === 'paid' ? 'مدفوع' : 'غير مدفوع'}</div></td><td>${esc(c.status)}</td><td>${c.impressions}/${c.clicks}</td>
          <td class="nowrap">${c.status !== 'active' ? `<button class="btn sm" data-ca="${c.id}" data-a="activate">تأكيد الدفع والتفعيل</button>` : `<button class="btn ghost sm" data-ca="${c.id}" data-a="pause">إيقاف</button>`}${c.status === 'pending' ? `<button class="btn danger sm" data-ca="${c.id}" data-a="reject">رفض</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">لا توجد حملات</td></tr>'}</tbody></table></div></div>
        <div class="grid g2"><div class="card"><div class="card-h"><h3>الباقات الإعلانية</h3>${isSuper() ? '<button class="btn sm" id="addPkg">إضافة</button>' : ''}</div><ul class="list">${d.packages.map(p => `<li><span class="grow">${esc(p.name_ar)}<div class="small muted">${esc(p.placement)} • ${p.duration_days} يوم</div></span><b>${W.money(p.price, p.currency)}</b></li>`).join('')}</ul></div>
          <div class="card"><div class="card-h"><h3>عقود الرعاية</h3><button class="btn sm" id="addK">إضافة عقد</button></div><ul class="list">${d.contracts.map(k => `<li><span class="grow">${esc(k.company)} — قسم ${esc(k.section)}<div class="small muted">${W.money(k.value, k.currency)}</div></span><span class="small ${k.ends_on < W.today() ? 'muted' : ''}">ينتهي ${W.fmtDate(k.ends_on)}</span></li>`).join('') || '<li class="muted">لا توجد عقود</li>'}</ul></div></div>
        <div class="card"><h3>الإحالات</h3><ul class="list">${d.referrals.map(r => `<li><span class="grow">${esc(r.referrer)} ← ${esc(r.referred)}</span><span class="small muted">${W.fmtDT(r.created_at)}</span></li>`).join('') || '<li class="muted">لا توجد إحالات</li>'}</ul></div>`;
      document.querySelectorAll('[data-co]').forEach(b => b.onclick = () => post(`/api/admin/companies/${b.dataset.co}`, { action: b.dataset.a }));
      document.querySelectorAll('[data-ca]').forEach(b => b.onclick = () => post(`/api/admin/campaigns/${b.dataset.ca}`, { action: b.dataset.a }));
      const ap = $('#addPkg'); if (ap) ap.onclick = () => W.modal('باقة', `<div class="stack"><input class="input" name="name_ar" placeholder="الاسم" required><select class="input" name="placement"><option value="home_banner">بانر الرئيسية</option><option value="section_sponsor">رعاية قسم</option><option value="directory_top">أعلى الدليل</option><option value="listing_boost">تمييز إعلان</option></select><input class="input" name="duration_days" type="number" min="1" placeholder="المدة بالأيام" required><input class="input" name="price" type="number" min="0" placeholder="السعر ر.ق" required></div>`, async f => { await W.api('POST', '/api/admin/packages', f); W.render(); });
      $('#addK').onclick = () => W.modal('عقد رعاية', `<div class="stack"><select class="input" name="company_id">${d.companies.filter(c => c.status === 'active').map(c => `<option value="${c.id}">${esc(c.name_ar)}</option>`).join('')}</select><input class="input" name="section" placeholder="القسم: herd, market, vet…" required><input class="input" name="value" type="number" min="0" placeholder="القيمة ر.ق" required><div class="row"><input class="input" type="date" name="starts_on" required style="flex:1"><input class="input" type="date" name="ends_on" required style="flex:1"></div><input class="input" name="notes" placeholder="ملاحظات"></div>`, async f => { await W.api('POST', '/api/admin/contracts', f); W.render(); });
    }
    if (tab === 'settings') {
      const { settings: s } = await W.api('GET', '/api/admin/settings');
      box.innerHTML = `<form class="card stack" id="sf" style="max-width:560px"><h3>إعدادات المنصة</h3>
        <label class="check"><input type="checkbox" name="listing_auto_approve" ${s.listing_auto_approve === '1' ? 'checked' : ''} ${isSuper() ? '' : 'disabled'}> نشر الإعلانات والمزادات تلقائياً بدون مراجعة (غير مستحسن)</label>
        <div class="field"><label>عمولة المنصة على الصفقات %</label><input class="input" name="deal_commission_percent" type="number" step="0.1" min="0" max="10" value="${esc(s.deal_commission_percent)}" ${isSuper() ? '' : 'disabled'}></div>
        <div class="field"><label>تمديد المزاد عند المزايدة الأخيرة (ثانية)</label><input class="input" name="auction_anti_snipe_seconds" type="number" min="30" max="900" value="${esc(s.auction_anti_snipe_seconds)}" ${isSuper() ? '' : 'disabled'}></div>
        <div class="field"><label>أقل عدد صفقات لإظهار التثمين الاسترشادي</label><input class="input" name="valuation_min_samples" type="number" min="3" max="100" value="${esc(s.valuation_min_samples)}" ${isSuper() ? '' : 'disabled'}></div>
        ${isSuper() ? '<button class="btn" type="submit">حفظ</button>' : '<p class="small muted">الإعدادات يغيّرها المدير العام فقط.</p>'}</form>`;
      $('#sf').onsubmit = async e => { e.preventDefault(); const d = W.formData(e.target); d.listing_auto_approve = e.target.listing_auto_approve.checked; try { await W.api('PATCH', '/api/admin/settings', d); W.toast('تم الحفظ'); } catch (err) { W.fail(err); } };
    }
  };
})();
