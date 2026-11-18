/* وسم | WASM — واجهة الويب (المرحلة الأولى) — JavaScript بدون أطر، RTL أولاً */
(() => {
  'use strict';
  const I = window.ICONS;
  const W = window.W = window.W || { views: {} };
  W.listeners = W.listeners || {};
  W.on = (ev, fn) => { (W.listeners[ev] = W.listeners[ev] || []).push(fn); };
  W.off = ev => { W.listeners[ev] = []; };
  W.emit = (ev, d) => (W.listeners[ev] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
  const app = document.getElementById('app');
  const state = { user: undefined, countries: [], route: null, ages: [], unread: null };
  const loadAges = async () => { if (!state.ages.length) state.ages = (await api('GET', '/api/age-names')).age_names; return state.ages; };
  const ageLocal = (bd, sex) => { if (!bd || !state.ages.length) return null; const [y1, m1, d1] = bd.split('-').map(Number), [y2, m2, d2] = today().split('-').map(Number); let mo = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0); let r = state.ages[0]; for (const a of state.ages) if (mo >= a.fromMonths) r = a; return sex === 'female' ? r.f : r.m; };

  // ===================== أدوات =====================
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('ar-QA-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined }) : '—';
  const fmtDT = iso => iso ? new Date(iso).toLocaleString('ar-QA-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const today = () => { const d = new Date(Date.now() + 3 * 3600000); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  const ageText = d => { if (d == null) return 'غير معروف'; const y = Math.floor(d / 365); if (y >= 1) return `${y} ${y === 1 ? 'سنة' : y === 2 ? 'سنتان' : y <= 10 ? 'سنوات' : 'سنة'}`; const m = Math.floor(d / 30); return m >= 1 ? `${m} شهر` : `${d} يوم`; };

  const SEX = { female: 'ناقة', male: 'فحل' };
  const SEX_CALF = { female: 'بكرة', male: 'قعود' };
  const STATUS = { active: 'نشطة', pregnant: 'خلفة', nursing: 'مرضع', sold: 'مباعة', dead: 'نافقة', transferred: 'منقولة' };
  const STATUS_CLS = { active: 'green', pregnant: 'gold', nursing: 'gold', sold: '', dead: 'red', transferred: '' };
  const OUTCOME = { pending: 'بانتظار التأكيد', confirmed_pregnant: 'خلفة (مؤكد)', not_pregnant: 'ما لقحت', born: 'ولدت', aborted: 'إجهاض' };
  const EVENT = { weaning: 'فطام', vaccination: 'تحصين', treatment: 'علاج', vet_visit: 'زيارة بيطرية', sale: 'بيع', purchase: 'شراء', transfer: 'نقل', checkup: 'فحص', achievement: 'إنجاز/مشاركة', note: 'ملاحظة' };
  const BREEDS = ['مغاتير', 'مجاهيم', 'أصايل', 'وضح', 'صفر', 'حمر', 'شعل', 'شقح', 'عمانية', 'هجن', 'أخرى'];
  const COLORS = ['أبيض', 'أسود', 'أشعل', 'أصفر', 'أحمر', 'أشقح', 'أملح', 'أزرق'];
  const ACTION_AR = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', upload: 'رفع ملف', share: 'إنشاء رابط مشاركة', revoke_share: 'إلغاء رابط', login: 'دخول', register: 'تسجيل' };
  const ENTITY_AR = { camel: 'مطية', mating: 'تلقيح', birth: 'ولادة', event: 'سجل', media: 'ملف', farm: 'عزبة', user: 'حساب' };
  const FIELD_AR = { name: 'الاسم', tag_number: 'رقم الوسم', sex: 'الجنس', breed: 'الفئة', color: 'اللون', birth_date: 'تاريخ الميلاد', status: 'الحالة', notes: 'الملاحظات', dam_id: 'الأم', sire_id: 'الأب', outcome: 'النتيجة', microchip: 'الشريحة', farm_id: 'العزبة', dam_name_text: 'الأم (خارجية)', sire_name_text: 'الأب (خارجي)', mating_date: 'تاريخ التلقيح', expected_birth_date: 'الولادة المتوقعة' };

  async function api(method, path, body) {
    const opt = { method, headers: { 'X-WASM-Client': '1' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(path, opt);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : null;
    if (!r.ok) {
      if (r.status === 401 && state.user && !path.startsWith('/api/auth') && !path.startsWith('/api/public')) { state.user = null; toast('انتهت الجلسة، سجّل الدخول مجدداً', true); go('/login'); }
      const e = new Error((data && data.message) || 'تعذر الاتصال'); e.code = data && data.error; e.status = r.status; throw e;
    }
    return data;
  }

  function toast(msg, err = false) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    document.getElementById('toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
  }
  const fail = e => toast(e.message || 'حدث خطأ', true);

  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value.trim();
    }
    return o;
  }

  // ===================== نافذة منبثقة =====================
  function modal(title, inner, onSubmit) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate>
      <div class="mh"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${I.x}</button></div>
      <div class="mb">${inner}</div>
      <div class="notice err" data-err hidden></div>
      ${onSubmit ? `<div class="mf"><button class="btn" type="submit">${I.check} حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>` : ''}
    </form>`;
    const close = () => back.remove();
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    const form = back.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!onSubmit) return;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      const errBox = form.querySelector('[data-err]'); errBox.hidden = true;
      try { await onSubmit(formData(form), form); close(); }
      catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
      finally { btn.disabled = false; }
    });
    document.body.appendChild(back);
    const first = form.querySelector('input, select, textarea'); if (first) first.focus();
    return { el: back, close, form };
  }
  const confirmBox = (text) => new Promise(res => {
    const m = modal('تأكيد', `<p>${esc(text)}</p><div class="mf"><button type="button" class="btn danger" data-yes>نعم، متأكد</button><button type="button" class="btn ghost" data-close>تراجع</button></div>`);
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); res(true); };
    m.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) res(false); });
  });

  // ===================== التوجيه =====================
  function go(path) { if (location.hash !== '#' + path) location.hash = path; else render(); }
  const NAV = [
    { group: 'إدارة الحلال', auth: true, items: [
      { k: 'home', path: '/', label: 'الرئيسية', icon: I.home },
      { k: 'herd', path: '/herd', label: 'حلالي', icon: I.camel },
      { k: 'calendar', path: '/calendar', label: 'التقويم والمواعيد', icon: I.calendar },
      { k: 'assistant', path: '/assistant', label: 'المساعد الذكي WASM AI', icon: I.ai },
      { k: 'farms', path: '/farms', label: 'العزب', icon: I.tent },
    ] },
    { group: 'السوق والمزادات', items: [
      { k: 'market', path: '/market', label: 'سوق الإبل', icon: I.market },
      { k: 'auctions', path: '/auctions', label: 'المزادات الإلكترونية', icon: I.gavel },
      { k: 'sires', path: '/market?sex=male', label: 'الأفحل', icon: I.star },
      { k: 'brokers', path: '/brokers', label: 'الوسطاء', icon: I.handshake },
      { k: 'valuation', path: '/valuation', label: 'التثمين الاسترشادي', icon: I.chart },
    ] },
    { group: 'الخدمات', items: [
      { k: 'vet', path: '/directory/vet', label: 'الخدمات البيطرية', icon: I.vet },
      { k: 'feed', path: '/directory/feed', label: 'الأعلاف والمستلزمات', icon: I.feed },
      { k: 'transport', path: '/directory/transport', label: 'نقل الإبل', icon: I.truck },
      { k: 'mazayin', path: '/mazayin', label: 'المزاين والنتائج', icon: I.trophy },
      { k: 'community', path: '/community', label: 'مجتمع أهل الإبل', icon: I.users },
    ] },
    { group: 'حسابي', auth: true, items: [
      { k: 'messages', path: '/messages', label: 'الرسائل', icon: I.chat, badge: 'messages' },
      { k: 'notifications', path: '/notifications', label: 'الإشعارات', icon: I.bell, badge: 'notifications' },
      { k: 'deals', path: '/deals', label: 'صفقاتي', icon: I.check },
      { k: 'mylistings', path: '/my-listings', label: 'إعلاناتي', icon: I.market },
      { k: 'partner', path: '/partner', label: 'شركاء وسم', icon: I.handshake },
      { k: 'account', path: '/account', label: 'حسابي والخصوصية', icon: I.user },
    ] },
  ];
  const ADMIN_NAV = { group: 'الإدارة', items: [{ k: 'admin', path: '/admin', label: 'لوحة الإدارة', icon: I.lock }] };
  const PUBLIC = ['market', 'listing', 'auctions', 'auction', 'brokers', 'directory', 'community', 'mazayin', 'valuation', 'compare'];

  function shell(active, title, content) {
    const u = state.user;
    const groups = NAV.filter(g => u || !g.auth).concat(u && ['super_admin', 'country_admin'].includes(u.role) ? [ADMIN_NAV] : []);
    const badge = k => (k && state.unread && state.unread[k] ? `<span class="soon" style="background:var(--gold-500);color:var(--emerald-900)">${state.unread[k]}</span>` : '');
    const nav = groups.map(g => `<div class="nav-label">${g.group}</div><nav class="nav">${g.items.map(i => `<a href="#${i.path}" class="${i.k === active ? 'active' : ''}">${i.icon}<span>${i.label}</span>${badge(i.badge)}</a>`).join('')}</nav>`).join('');
    const bn = u ? [['home', '/', 'الرئيسية', I.home], ['market', '/market', 'السوق', I.market], ['assistant', '/assistant', 'المساعد', I.ai, true], ['herd', '/herd', 'حلالي', I.camel], ['more', '/more', 'المزيد', I.more]]
      : [['market', '/market', 'السوق', I.market], ['auctions', '/auctions', 'المزادات', I.gavel], ['community', '/community', 'المجتمع', I.users], ['login', '/login', 'دخول', I.user], ['more', '/more', 'المزيد', I.more]];
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar" aria-label="القائمة الرئيسية">
          <a class="brand" href="#/"><img src="/img/logo.svg" alt=""><div><b>وسم</b><small>السوق الخليجي لأهل الإبل</small></div></a>
          ${nav}
          <div class="foot">المرحلة الأولى — نسخة تجريبية<br>© وسم WASM</div>
        </aside>
        <div class="main">
          ${u && u.email && u.email.endsWith('.demo') ? '<div class="demo-banner">⚠️ أنت تستخدم حساباً تجريبياً — جميع الأسماء والسجلات والصور وهمية وغير حقيقية</div>' : ''}
          <header class="topbar">
            <a class="mobile-brand" href="#/"><img src="/img/logo.svg" alt="وسم"><b style="font-family:var(--font-display);color:var(--emerald-800);font-size:1.25rem">وسم</b></a>
            <div class="title">${esc(title)}</div><div class="spacer"></div>
            ${u ? `<a class="icon-btn bell" href="#/notifications" aria-label="الإشعارات">${I.bell}${state.unread && state.unread.notifications ? `<span class="dotc">${state.unread.notifications}</span>` : ''}</a>
            <a class="user-chip" href="#/account"><span class="small">${esc(u.display_name)}</span><span class="avatar">${esc(u.display_name.trim().charAt(0))}</span></a>`
            : `<a class="btn ghost sm" href="#/register">حساب جديد</a><a class="btn sm" href="#/login">دخول</a>`}
          </header>
          <main class="page" id="page">${content}</main>
        </div>
      </div>
      <nav class="bottom-nav" aria-label="التنقل">${bn.map(([k, p, l, ic, ai]) => `<a href="#${p}" class="${k === active ? 'active' : ''} ${ai ? 'ai' : ''}">${ai ? `<span class="bub">${ic}</span>` : ic}<span>${l}</span></a>`).join('')}</nav>`;
    window.scrollTo(0, 0);
  }

  const loading = () => '<div class="empty"><div class="typing"><span></span><span></span><span></span></div></div>';
  const emptyState = (text, action = '') => `<div class="empty">${I.camel}<p>${text}</p>${action}</div>`;

  async function render() {
    const full = location.hash.replace(/^#/, '') || (state.user === null ? '/market' : '/');
    const [hash, qs] = full.split('?');
    state.query = new URLSearchParams(qs || '');
    W.off('auction'); W.off('message');
    if (state.topicES) { state.topicES.close(); state.topicES = null; }
    if (location.pathname.startsWith('/s/')) return viewShared(location.pathname.slice(3));
    if (state.user === undefined) {
      try { state.user = (await api('GET', '/api/me')).user; } catch { state.user = null; }
      if (state.user) startLive();
    }
    const [, a, b, c] = hash.split('/');
    if (!state.user && (hash === '/login' || hash === '/register')) return viewAuth(hash === '/register' ? 'register' : 'login');
    if (!state.user && hash === '/') return go('/market');
    if (!state.user && !PUBLIC.includes(a) && a !== 'more') return viewAuth('login');
    if (state.user && (hash === '/login' || hash === '/register')) return go('/');
    try {
      if (W.views[a]) return await W.views[a](b, c);
      switch (a) {
        case '': return await viewDashboard();
        case 'herd': return await viewHerd();
        case 'camel': return b === 'new' ? camelFormPage() : await viewCamel(b, c || 'overview');
        case 'calendar': return await viewCalendar(b);
        case 'assistant': return await viewAssistant();
        case 'alerts': return await viewAlerts();
        case 'farms': return await viewFarms();
        case 'account': return await viewAccount();
        case 'more': return viewMore();
        default: shell('', 'غير موجود', emptyState('الصفحة غير موجودة', '<a class="btn" href="#/">الرئيسية</a>'));
      }
    } catch (e) {
      if (e.status === 404) shell('', 'غير موجود', emptyState(esc(e.message), '<a class="btn" href="#/">الرئيسية</a>'));
      else if (e.status === 401) viewAuth('login');
      else { shell('', 'خطأ', emptyState(esc(e.message))); fail(e); }
    }
  }
  function startLive() {
    refreshUnread();
    try {
      const es = new EventSource('/api/stream');
      es.addEventListener('notification', ev => { const n = JSON.parse(ev.data); toast('🔔 ' + n.title); refreshUnread(); W.emit('notification', n); });
      es.addEventListener('message', ev => { refreshUnread(); W.emit('message', JSON.parse(ev.data)); });
      state.es = es;
    } catch { /* */ }
  }
  async function refreshUnread() {
    try { state.unread = await api('GET', '/api/unread'); document.querySelectorAll('.bell .dotc').forEach(x => x.remove()); const b = document.querySelector('.bell'); if (b && state.unread.notifications) b.insertAdjacentHTML('beforeend', `<span class="dotc">${state.unread.notifications}</span>`); } catch { /* */ }
  }
  window.addEventListener('hashchange', render);

  // ===================== الدخول والتسجيل =====================
  async function viewAuth(mode) {
    if (!state.countries.length) try { state.countries = (await api('GET', '/api/countries')).countries; } catch { /* offline */ }
    const reg = mode === 'register';
    app.innerHTML = `<div class="auth">
      <section class="art">
        <div><div class="row" style="gap:14px"><img src="/img/logo.svg" alt="" style="width:64px"><div><h1 style="margin:0">وسم</h1><div style="color:rgba(250,246,236,.7)">WASM</div></div></div>
        <p style="margin-top:22px;font-size:1.35rem;font-family:var(--font-display);color:var(--ivory)">«السوق الخليجي لأهل الإبل»</p>
        <p>سجّل حلالك، وتابع التلقيح والولادات والأنساب، واسأل مساعدك الذكي بلهجتك.</p>
        <div class="feat">
          <div>${I.camel}<span>ملف رقمي لكل مطية مع شجرة النسب والمواليد</span></div>
          <div>${I.calendar}<span>تنبيهات تلقائية قبل مواعيد الولادة التقديرية</span></div>
          <div>${I.ai}<span>«لقحت وضحى اليوم من شاهين» — والمساعد يسجل بعد تأكيدك</span></div>
          <div>${I.lock}<span>بياناتك خاصة بك ولا يراها أحد إلا بموافقتك</span></div>
        </div></div>
        <div class="small" style="color:rgba(250,246,236,.55);position:relative;z-index:1">السعودية • قطر • الإمارات • الكويت • البحرين • عُمان</div>
        ${I.dunes}
      </section>
      <section class="form-side"><div class="box">
        <h2>${reg ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}</h2>
        <p class="muted">${reg ? 'ابدأ بإدارة حلالك مجاناً في المرحلة التجريبية.' : 'أهلاً بعودتك إلى وسم.'}</p>
        <form id="authForm" class="stack" novalidate>
          ${reg ? `<div class="field"><label for="dn">الاسم</label><input class="input" id="dn" name="display_name" required autocomplete="name"></div>
          <div class="field"><label for="cc">الدولة</label><select class="input" id="cc" name="country_code">${state.countries.map(c => `<option value="${c.code}" ${c.code === 'QA' ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('')}</select></div>
          <div class="field"><label for="rl">نوع الحساب</label><select class="input" id="rl" name="role"><option value="owner">مالك حلال</option><option value="user">مستخدم عادي</option><option value="trader">تاجر</option><option value="broker">وسيط</option><option value="provider">طبيب أو مقدم خدمة</option><option value="company">شركة</option></select></div>` : ''}
          <div class="field"><label for="em">البريد الإلكتروني</label><input class="input" id="em" name="email" type="email" required autocomplete="email" dir="ltr"></div>
          <div class="field"><label for="pw">كلمة المرور</label><input class="input" id="pw" name="password" type="password" required minlength="${reg ? 10 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}" dir="ltr">${reg ? '<span class="hint">10 أحرف على الأقل وتحتوي أرقاماً وحروفاً</span>' : ''}</div>
          <div class="notice err" id="authErr" hidden></div>
          <button class="btn gold" style="width:100%" type="submit">${reg ? 'إنشاء الحساب' : 'دخول'}</button>
        </form>
        <p class="small" style="margin-top:16px">${reg ? 'لديك حساب؟ <a href="#/login">سجّل الدخول</a>' : 'جديد في وسم؟ <a href="#/register">أنشئ حساباً</a>'}</p>
        ${!reg ? `<div class="notice gold small" style="margin-top:14px">للتجربة: <b dir="ltr">demo@wasm.demo</b> / <b dir="ltr">Wasm-demo-2026</b> (بيانات وهمية)</div>` : ''}
      </div></section></div>`;
    document.getElementById('authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const box = document.getElementById('authErr'); box.hidden = true;
      try {
        const d = formData(e.target);
        const ref = new URLSearchParams(location.search).get('ref') || (state.query && state.query.get('ref'));
        if (reg && ref) d.ref = ref;
        state.user = (await api('POST', reg ? '/api/auth/register' : '/api/auth/login', d)).user;
        startLive(); location.hash = '/'; render();
      } catch (err) { box.textContent = err.message; box.hidden = false; }
    });
  }

  // ===================== الرئيسية =====================
  async function viewDashboard() {
    shell('home', 'الرئيسية', loading());
    const d = await api('GET', '/api/dashboard');
    const sp = W.sponsor ? await W.sponsor('herd') : '';
    const u = state.user;
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
    document.getElementById('page').innerHTML = `${sp}
      <section class="hero-band">
        <h1>${greet}، ${esc(u.display_name.split(' — ').pop())}</h1>
        <p>${d.due_30 ? `لديك ${d.due_30} ${d.due_30 === 1 ? 'ناقة يُتوقع' : 'نوق يُتوقع'} ولادتها خلال 30 يوماً.` : 'لا توجد ولادات متوقعة خلال الثلاثين يوماً القادمة.'}</p>
        <div class="actions row">
          <button class="btn gold" data-act="mating">${I.plus} تسجيل تلقيح</button>
          <button class="btn ghost" style="color:var(--ivory);border-color:rgba(250,246,236,.3)" data-act="birth">${I.plus} تسجيل ولادة</button>
          <a class="btn ghost" style="color:var(--ivory);border-color:rgba(250,246,236,.3)" href="#/assistant">${I.ai} اسأل المساعد</a>
        </div>
        ${I.dunes}
      </section>
      <div class="grid g4">
        <div class="stat hero"><div class="k">إجمالي الحلال النشط</div><div class="v">${d.total}</div><div class="ico-bg">${I.camel}</div></div>
        <div class="stat"><div class="k">النوق / الفحول</div><div class="v">${d.females} <span class="muted" style="font-size:1rem">/ ${d.males}</span></div><div class="ico-bg">${I.users}</div></div>
        <div class="stat"><div class="k">النوق الملقحة</div><div class="v">${d.pregnant}</div><div class="ico-bg">${I.heart}</div></div>
        <div class="stat"><div class="k">ولادات هذا العام</div><div class="v">${d.births_this_year}</div><div class="ico-bg">${I.star}</div></div>
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <section class="card">
          <div class="card-h"><h2>الولادات المتوقعة</h2><a class="btn ghost sm" href="#/calendar">التقويم</a></div>
          ${d.upcoming.length ? `<ul class="list">${d.upcoming.map(b => { const n = daysBetween(today(), b.expected_birth_date); return `
            <li><span class="dot ${n < 0 ? 'warning' : n <= 3 ? 'urgent' : 'info'}"></span>
              <div class="grow"><a class="t" href="#/camel/${b.dam_id}">${esc(b.dam_name)}</a> <span class="muted small">${esc(b.tag_number || '')}</span>
              <div class="small muted">تلقيح ${fmtDate(b.mating_date)}${b.sire_name ? ' • من ' + esc(b.sire_name) : ''}</div></div>
              <div style="text-align:left"><div class="small"><b>${fmtDate(b.expected_birth_date)}</b></div><span class="badge ${n < 0 ? 'warn' : 'gold'}">${n < 0 ? `متجاوزة ${-n} يوم` : n === 0 ? 'اليوم' : `بعد ${n} يوم`}</span></div></li>`; }).join('')}</ul>
            <p class="small muted" style="margin:10px 0 0">⚠️ المواعيد تقديرية بناءً على ${u.gestation_days} يوماً من اللقاح إلى الولادة، ولا تغني عن المتابعة البيطرية.</p>`
            : emptyState('لا توجد ولادات متوقعة. سجّل التلقيح ليظهر الموعد التقديري هنا.', '<button class="btn" data-act="mating">تسجيل تلقيح</button>')}
        </section>
        <section class="card">
          <div class="card-h"><h2>التنبيهات</h2><a class="btn ghost sm" href="#/alerts">الكل</a></div>
          ${alertsList(d.alerts)}
        </section>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-h"><h3>الحلال حسب العمر</h3><a class="btn ghost sm" href="#/herd">حلالي</a></div>
        ${d.ages.groups.length ? `<div class="facts">${d.ages.groups.map(g => `<a class="fact" href="#/herd" data-age="${g.key}"><div class="k">${g.m === g.f ? g.m : g.m + ' / ' + g.f}</div><div class="v">${g.males + g.females} <span class="small muted">${g.key === 'hwar' ? `(${g.males} قعود، ${g.females} بكرة)` : `(${g.males} ${g.m}، ${g.females} ${g.f})`}</span></div></a>`).join('')}</div>` : '<p class="muted">أضف تواريخ الميلاد ليظهر التوزيع.</p>'}
        ${d.ages.unknown ? `<p class="small muted" style="margin:10px 0 0">${d.ages.unknown} بدون تاريخ ميلاد مسجل.</p>` : ''}
      </section>
      <section class="card" style="margin-top:16px">
        <div class="card-h"><h3>آخر النشاطات</h3></div>
        ${d.recent.length ? `<ul class="list">${d.recent.map(r => `<li>${I.history}<div class="grow small">${ACTION_AR[r.action] || r.action} ${ENTITY_AR[r.entity] || r.entity}${r.camel_name ? ` — <a href="#/camel/${r.camel_id}">${esc(r.camel_name)}</a>` : ''}</div><span class="small muted">${fmtDT(r.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">لا يوجد نشاط بعد.</p>'}
      </section>`;
  }

  const alertsList = list => list.length ? `<ul class="list">${list.map(a => `<li><span class="dot ${a.level}"></span><div class="grow small">${a.camel_id ? `<a href="#/camel/${a.camel_id}">${esc(a.text)}</a>` : esc(a.text)}</div></li>`).join('')}</ul>` : '<p class="muted">لا توجد تنبيهات حالياً 👌</p>';

  async function viewAlerts() {
    shell('alerts', 'التنبيهات', loading());
    const { alerts } = await api('GET', '/api/alerts');
    document.getElementById('page').innerHTML = `<h1>التنبيهات</h1><p class="muted">تنبيهات الولادة التقديرية، ومتابعات التحصين والعلاج، وتأكيد اللقاح.</p>
      <div class="card">${alertsList(alerts)}</div>
      <div class="notice gold" style="margin-top:14px">مواعيد الولادة تقديرية ولا تغني عن المتابعة البيطرية. يمكنك تعديل المدة من اللقاح إلى الولادة وموعد التنبيه من <a href="#/account">حسابي</a>.</div>
      <div class="notice info" style="margin-top:10px">الإشعارات الفورية على الجوال والبريد/الواتساب ستُضاف مع تطبيق الجوال (انظر خطة المراحل).</div>`;
  }

  // ===================== حلالي =====================
  let herdFilter = { q: '', sex: '', status: '', age: '' };
  async function viewHerd() {
    shell('herd', 'حلالي', `
      <div class="card-h"><div><h1 style="margin:0">حلالي</h1><p class="muted" style="margin:0">كل مطية لها ملف رقمي مستقل</p></div>
      <a class="btn gold" href="#/camel/new">${I.plus} إضافة مطية</a></div>
      <div class="toolbar">
        <div class="search">${I.search}<input class="input" id="hq" placeholder="ابحث بالاسم أو رقم الوسم…" value="${esc(herdFilter.q)}" aria-label="بحث"></div>
        <div class="seg" id="hsex">${[['', 'الكل'], ['female', 'النوق'], ['male', 'الفحول']].map(([v, l]) => `<button type="button" data-v="${v}" class="${herdFilter.sex === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <select class="input" id="hst" style="width:auto"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${herdFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select class="input" id="hage" style="width:auto"><option value="">كل الأعمار</option>${(await loadAges()).map(a => `<option value="${a.key}" ${herdFilter.age === a.key ? 'selected' : ''}>${a.m === a.f ? a.m : a.m + ' / ' + a.f}</option>`).join('')}<option value="unknown" ${herdFilter.age === 'unknown' ? 'selected' : ''}>بدون تاريخ ميلاد</option></select>
      </div>
      <div id="herdList">${loading()}</div>`);
    const load = async () => {
      const qs = new URLSearchParams(Object.entries(herdFilter).filter(([, v]) => v)).toString();
      const { camels } = await api('GET', '/api/camels' + (qs ? '?' + qs : ''));
      document.getElementById('herdList').innerHTML = camels.length ? `<div class="camel-grid">${camels.map(camelCard).join('')}</div><p class="small muted" style="margin-top:12px">${camels.length} مطية</p>`
        : emptyState(herdFilter.q || herdFilter.sex || herdFilter.status ? 'لا توجد نتائج مطابقة.' : 'لم تسجل أي مطية بعد. ابدأ بإضافة نوقك وفحولك.', '<a class="btn" href="#/camel/new">إضافة مطية</a>');
    };
    let t;
    document.getElementById('hq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { herdFilter.q = e.target.value.trim(); load().catch(fail); }, 250); });
    document.getElementById('hsex').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; herdFilter.sex = b.dataset.v; [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b)); load().catch(fail); });
    document.getElementById('hst').addEventListener('change', e => { herdFilter.status = e.target.value; load().catch(fail); });
    document.getElementById('hage').addEventListener('change', e => { herdFilter.age = e.target.value; load().catch(fail); });
    await load();
  }

  function camelCard(c) {
    const due = c.expected_birth_date ? daysBetween(today(), c.expected_birth_date) : null;
    return `<a class="camel-card" href="#/camel/${c.id}">
      <div class="ph">${c.photo_id ? `<img src="/api/media/${c.photo_id}" alt="${esc(c.name)}" loading="lazy">` : `<div class="ph-fallback">${I.camel}</div>`}
        <span class="badge ${c.sex === 'female' ? 'gold' : 'green'} sex">${c.age_name ? esc(c.age_name.name) : SEX[c.sex]}</span></div>
      <div class="body"><div class="name">${esc(c.name)}</div>
        <div class="meta">${esc([c.age_name ? SEX[c.sex] : null, c.tag_number, c.breed, c.color].filter(Boolean).join(' • ') || '—')}</div>
        <div class="row" style="margin-top:8px;gap:6px"><span class="badge ${STATUS_CLS[c.status]}">${STATUS[c.status]}</span>
        ${due != null ? `<span class="badge outline">${due < 0 ? 'متجاوزة الموعد' : `ولادة بعد ${due} يوم`}</span>` : ''}${c.is_demo ? '<span class="badge">تجريبي</span>' : ''}</div></div></a>`;
  }

  // ===================== نموذج المطية =====================
  async function camelFormPage(existing = null) {
    shell('herd', existing ? 'تعديل المطية' : 'إضافة مطية', loading());
    const [{ camels }, { farms }] = await Promise.all([api('GET', '/api/camels'), api('GET', '/api/farms')]);
    const others = camels.filter(c => !existing || c.id !== existing.id);
    const v = existing || { sex: 'female', status: 'active' };
    const opt = (list, sel) => `<option value="">— غير مسجل في حلالي —</option>` + list.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.tag_number ? ' (' + esc(c.tag_number) + ')' : ''}</option>`).join('');
    document.getElementById('page').innerHTML = `
      <a href="#${existing ? '/camel/' + existing.id : '/herd'}" class="small">${I.chevron} رجوع</a>
      <h1 style="margin-top:8px">${existing ? 'تعديل ملف ' + esc(existing.name) : 'إضافة مطية جديدة'}</h1>
      <form class="card" id="camelForm" novalidate>
        <div class="form-grid">
          <div class="field"><label for="f-name">اسم المطية *</label><input class="input" id="f-name" name="name" required maxlength="80" value="${esc(v.name)}"></div>
          <div class="field"><label for="f-tag">رقم المطية / الوسم</label><input class="input" id="f-tag" name="tag_number" maxlength="80" value="${esc(v.tag_number)}"></div>
          <div class="field"><label>الجنس *</label><div class="seg" id="sexSeg">${['female', 'male'].map(s => `<button type="button" data-v="${s}" class="${v.sex === s ? 'on' : ''}">${SEX[s]}</button>`).join('')}</div><input type="hidden" name="sex" value="${v.sex}"></div>
          <div class="field"><label for="f-st">الحالة</label><select class="input" id="f-st" name="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="f-breed">النوع / الفئة</label><input class="input" id="f-breed" name="breed" list="breeds" value="${esc(v.breed)}"><datalist id="breeds">${BREEDS.map(b => `<option value="${b}">`).join('')}</datalist></div>
          <div class="field"><label for="f-color">اللون</label><input class="input" id="f-color" name="color" list="colors" value="${esc(v.color)}"><datalist id="colors">${COLORS.map(b => `<option value="${b}">`).join('')}</datalist></div>
          <div class="field"><label for="f-bd">تاريخ الميلاد</label><input class="input" id="f-bd" type="date" name="birth_date" max="${today()}" value="${esc(v.birth_date)}"><span class="hint" id="ageHint"></span></div>
          <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="birth_date_estimated" ${v.birth_date_estimated ? 'checked' : ''}> التاريخ تقريبي (غير مؤكد)</label></div>
          <div class="field"><label for="f-dam">الأم (من حلالي)</label><select class="input" id="f-dam" name="dam_id">${opt(others.filter(c => c.sex === 'female'), v.dam_id)}</select></div>
          <div class="field"><label for="f-damt">أو اسم الأم إن لم تكن في حلالي</label><input class="input" id="f-damt" name="dam_name_text" value="${esc(v.dam_name_text)}"></div>
          <div class="field"><label for="f-sire">الأب (من حلالي)</label><select class="input" id="f-sire" name="sire_id">${opt(others.filter(c => c.sex === 'male'), v.sire_id)}</select></div>
          <div class="field"><label for="f-siret">أو اسم الأب إن لم يكن في حلالي</label><input class="input" id="f-siret" name="sire_name_text" value="${esc(v.sire_name_text)}"></div>
          <div class="field"><label for="f-farm">العزبة</label><select class="input" id="f-farm" name="farm_id"><option value="">—</option>${farms.map(f => `<option value="${f.id}" ${f.id === v.farm_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-chip">رقم الشريحة الإلكترونية</label><input class="input" id="f-chip" name="microchip" dir="ltr" value="${esc(v.microchip)}"></div>
          <div class="field full"><label for="f-notes">ملاحظات</label><textarea class="input" id="f-notes" name="notes" maxlength="2000">${esc(v.notes)}</textarea></div>
        </div>
        <div class="notice gold small" style="margin-top:14px">بيانات النسب والملكية تُعرض كـ«مسجلة من المالك» ولا تُعتبر موثقة إلا بمستندات أو جهة تحقق معتمدة.</div>
        <div class="notice err" id="cfErr" hidden style="margin-top:10px"></div>
        <div class="row" style="margin-top:16px"><button class="btn gold" type="submit">${I.check} ${existing ? 'حفظ التعديلات' : 'إضافة المطية'}</button><a class="btn ghost" href="#${existing ? '/camel/' + existing.id : '/herd'}">إلغاء</a></div>
      </form>`;
    const form = document.getElementById('camelForm');
    await loadAges();
    const hint = () => { const n = ageLocal(form.birth_date.value, form.sex.value); document.getElementById('ageHint').textContent = n ? 'الاسم حسب العمر: ' + n : ''; };
    form.birth_date.addEventListener('input', hint); form.addEventListener('click', () => setTimeout(hint)); hint();
    document.getElementById('sexSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; form.sex.value = b.dataset.v; [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b)); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const d = formData(form); const box = document.getElementById('cfErr'); box.hidden = true;
      try {
        const r = existing ? await api('PATCH', '/api/camels/' + existing.id, d) : await api('POST', '/api/camels', d);
        toast(existing ? 'تم حفظ التعديلات' : 'تمت إضافة المطية'); go('/camel/' + r.camel.id);
      } catch (err) { box.textContent = err.message; box.hidden = false; }
    });
  }

  // ===================== الملف الرقمي للمطية =====================
  const TABS = [['overview', 'نظرة عامة'], ['breeding', 'التلقيح والولادات'], ['health', 'الصحة والسجلات'], ['pedigree', 'شجرة النسب'], ['media', 'الصور والمستندات'], ['history', 'سجل التعديلات'], ['share', 'المشاركة']];
  async function viewCamel(id, tab) {
    if (tab === 'edit') { const { camel } = await api('GET', '/api/camels/' + id); return camelFormPage(camel); }
    shell('herd', 'الملف الرقمي', loading());
    const { camel: c } = await api('GET', '/api/camels/' + id);
    const photo = c.photos[0];
    const open = c.matings.find(m => ['pending', 'confirmed_pregnant'].includes(m.outcome));
    const due = open ? daysBetween(today(), open.expected_birth_date) : null;
    document.getElementById('page').innerHTML = `
      <a href="#/herd" class="small">${I.chevron} حلالي</a>
      <section class="profile-head" style="margin-top:10px">
        <div class="profile-photo">${photo ? `<img src="/api/media/${photo.id}" alt="${esc(c.name)}">` : `<div class="ph-fallback" style="display:grid;place-items:center;height:100%;color:var(--gold-500)">${I.camel}</div>`}</div>
        <div>
          <div class="row"><h1 style="margin:0">${esc(c.name)}</h1><span class="badge ${c.sex === 'female' ? 'gold' : 'green'}">${SEX[c.sex]}${c.age_name ? ' • ' + esc(c.age_name.name) : ''}</span><span class="badge ${STATUS_CLS[c.status]}">${STATUS[c.status]}</span>${c.is_demo ? '<span class="badge">بيانات تجريبية</span>' : ''}</div>
          <div class="muted">${esc(c.tag_number ? 'الوسم: ' + c.tag_number : 'بدون رقم وسم')}${c.farm ? ' • ' + esc(c.farm.name) : ''}</div>
          <div class="facts">
            <div class="fact"><div class="k">الفئة</div><div class="v">${esc(c.breed || '—')}</div></div>
            <div class="fact"><div class="k">اللون</div><div class="v">${esc(c.color || '—')}</div></div>
            <div class="fact"><div class="k">العمر</div><div class="v">${c.age_name ? `<b>${esc(c.age_name.name)}</b> • ` : ''}${ageText(c.age_days)}${c.birth_date_estimated ? ' <span class="badge outline">تقريبي</span>' : ''}</div></div>
            <div class="fact"><div class="k">الأم</div><div class="v">${c.dam ? `<a href="#/camel/${c.dam.id}">${esc(c.dam.name)}</a>` : esc(c.dam_name_text || '—')}</div></div>
            <div class="fact"><div class="k">الأب</div><div class="v">${c.sire ? `<a href="#/camel/${c.sire.id}">${esc(c.sire.name)}</a>` : esc(c.sire_name_text || '—')}</div></div>
            <div class="fact"><div class="k">المواليد</div><div class="v">${c.offspring.length}</div></div>
          </div>
          ${open ? `<div class="notice gold" style="margin-top:12px">${I.calendar}<div><b>الولادة المتوقعة: ${fmtDate(open.expected_birth_date)}</b> (${due < 0 ? `متجاوزة بـ ${-due} يوم` : `بعد ${due} يوم`}) — ${OUTCOME[open.outcome]}<br><span class="small">تقديري من تلقيح ${fmtDate(open.mating_date)}، ولا يغني عن المتابعة البيطرية.</span></div></div>` : ''}
          <div class="row" style="margin-top:14px">
            ${c.sex === 'female' ? `<button class="btn" data-act="mating" data-dam="${c.id}">${I.plus} تلقيح</button><button class="btn" data-act="birth" data-dam="${c.id}">${I.plus} ولادة</button>` : ''}
            <button class="btn ghost" data-act="event" data-camel="${c.id}">${I.plus} سجل صحي/تشغيلي</button>
            <a class="btn ghost" href="#/camel/${c.id}/edit">${I.edit} تعديل</a>
            <button class="btn ghost" data-act="share" data-camel="${c.id}">${I.share} مشاركة</button>
          </div>
        </div>
      </section>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tabBody">${loading()}</div>`;
    document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(`/camel/${c.id}/${b.dataset.tab}`); });
    await renderTab(c, tab);
  }

  async function renderTab(c, tab) {
    const body = document.getElementById('tabBody');
    if (tab === 'overview') {
      const items = timelineItems(c).slice(0, 8);
      body.innerHTML = `<div class="grid g2">
        <section class="card"><h3>آخر الأحداث</h3>${items.length ? `<div class="timeline">${items.join('')}</div>` : '<p class="muted">لا توجد سجلات بعد.</p>'}</section>
        <section class="card"><h3>الملاحظات</h3><p style="white-space:pre-wrap">${esc(c.notes || 'لا توجد ملاحظات.')}</p>
          <h3 style="margin-top:16px">المواليد</h3>${c.offspring.length ? `<ul class="list">${c.offspring.map(o => `<li><span class="badge ${o.sex === 'female' ? 'gold' : 'green'}">${SEX_CALF[o.sex]}</span><a class="grow t" href="#/camel/${o.id}">${esc(o.name)}</a><span class="small muted">${fmtDate(o.birth_date)}</span></li>`).join('')}</ul>` : '<p class="muted">لا توجد مواليد مسجلة.</p>'}
          <div class="row" style="margin-top:14px"><button class="btn danger sm" data-act="delete-camel" data-camel="${c.id}" data-name="${esc(c.name)}">${I.trash} حذف المطية</button></div></section></div>`;
    } else if (tab === 'breeding') {
      const rows = c.sex === 'female' ? c.matings : c.sired_matings;
      body.innerHTML = `<div class="grid g2">
        <section class="card"><div class="card-h"><h3>${c.sex === 'female' ? 'سجل التلقيح' : 'التلقيحات التي قام بها'}</h3>${c.sex === 'female' ? `<button class="btn sm" data-act="mating" data-dam="${c.id}">${I.plus} تلقيح</button>` : ''}</div>
          ${rows.length ? `<ul class="list">${rows.map(m => `<li><div class="grow"><div class="t">${fmtDate(m.mating_date)} — ${c.sex === 'female' ? 'من ' + esc(m.sire_name || m.sire_name_text || 'غير مسجل') : `<a href="#/camel/${m.dam_id}">${esc(m.dam_name)}</a>`}</div>
            <div class="small muted">الولادة المتوقعة: ${fmtDate(m.expected_birth_date)} (تقديري)</div></div>
            ${c.sex === 'female' ? `<select class="input" style="width:auto;min-height:36px;padding:4px 10px" data-act="outcome" data-mating="${m.id}" ${m.outcome === 'born' ? 'disabled' : ''}>${Object.entries(OUTCOME).filter(([k]) => k !== 'born' || m.outcome === 'born').map(([k, l]) => `<option value="${k}" ${m.outcome === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${m.outcome !== 'born' ? `<button class="icon-btn" aria-label="حذف" data-act="delete-mating" data-mating="${m.id}">${I.trash}</button>` : ''}` : `<span class="badge">${OUTCOME[m.outcome]}</span>`}</li>`).join('')}</ul>` : '<p class="muted">لا يوجد تلقيح مسجل.</p>'}
        </section>
        ${c.sex === 'female' ? `<section class="card"><div class="card-h"><h3>سجل الولادات</h3><button class="btn sm" data-act="birth" data-dam="${c.id}">${I.plus} ولادة</button></div>
          ${c.births.length ? `<ul class="list">${c.births.map((b, i) => `<li><span class="badge">${c.births.length - i}</span><div class="grow"><div class="t">${fmtDate(b.birth_date)}</div>
            <div class="small muted">${b.outcome === 'stillborn' ? 'نفوق المولود' : `${b.calf_sex ? SEX_CALF[b.calf_sex] : ''} ${b.calf_id ? `— <a href="#/camel/${b.calf_id}">${esc(b.calf_name)}</a>` : ''} ${b.calf_tag ? '(' + esc(b.calf_tag) + ')' : ''}`}</div></div></li>`).join('')}</ul>` : '<p class="muted">لا توجد ولادات مسجلة.</p>'}
        </section>` : ''}</div>`;
    } else if (tab === 'health') {
      body.innerHTML = `<section class="card"><div class="card-h"><h3>السجلات الصحية والتشغيلية</h3><button class="btn sm" data-act="event" data-camel="${c.id}">${I.plus} إضافة</button></div>
        ${c.events.length ? `<ul class="list">${c.events.map(e => `<li><span class="badge ${e.type === 'vaccination' ? 'green' : e.type === 'treatment' ? 'warn' : ''}">${EVENT[e.type]}</span>
          <div class="grow"><div class="t">${esc(e.title)}</div><div class="small muted">${fmtDate(e.event_date)}${e.counterparty ? ' • ' + esc(e.counterparty) : ''}${e.amount != null ? ' • ' + e.amount + ' ' + esc(e.currency || '') : ''}${e.next_due_date ? ` • <b>المتابعة: ${fmtDate(e.next_due_date)}</b>` : ''}</div>${e.details ? `<div class="small">${esc(e.details)}</div>` : ''}</div>
          <button class="icon-btn" aria-label="حذف" data-act="delete-event" data-event="${e.id}">${I.trash}</button></li>`).join('')}</ul>` : '<p class="muted">لا توجد سجلات. أضف التحصينات والعلاجات والزيارات البيطرية والفطام والبيع والنقل.</p>'}
        <div class="notice info small" style="margin-top:12px">وسم يحفظ السجلات فقط ولا يقدم تشخيصاً بيطرياً.</div></section>`;
    } else if (tab === 'pedigree') {
      const p = await api('GET', `/api/camels/${c.id}/pedigree?depth=3`);
      const node = (n, self) => {
        if (!n) return '<div class="pnode none"><div class="n">—</div><div class="s">غير مسجل</div></div>';
        const cls = `pnode ${n.sex === 'female' ? 'f' : 'm'} ${self ? 'self' : ''} ${n.external ? 'ext' : ''}`;
        const inner = `<div class="n">${esc(n.name)}</div><div class="s">${n.external ? 'خارج الحلال' : esc([n.tag_number, n.breed].filter(Boolean).join(' • ') || SEX[n.sex])}${n.verified ? ' ✓ موثق' : ''}</div>`;
        return n.id && !self ? `<a class="${cls}" href="#/camel/${n.id}/pedigree">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
      };
      const g1 = [p.tree], g2 = [p.tree.sire, p.tree.dam], g3 = g2.flatMap(x => [x?.sire, x?.dam]), g4 = g3.flatMap(x => [x?.sire, x?.dam]);
      body.innerHTML = `<section class="card"><h3>شجرة النسب</h3>
        <div class="ped"><div class="gen">${node(g1[0], true)}</div><div class="gen">${g2.map(n => node(n)).join('')}</div><div class="gen">${g3.map(n => node(n)).join('')}</div><div class="gen">${g4.map(n => node(n)).join('')}</div></div>
        <div class="legend" style="margin-top:12px"><span style="color:#4F7FB0">▌ الأب</span><span style="color:#C27BA0">▌ الأم</span><span>إطار متقطع = خارج الحلال</span></div>
        <div class="notice gold small" style="margin-top:12px">${esc(p.notice)}</div></section>
        <section class="card"><h3>النسل (حتى 3 أجيال)</h3>${p.offspring.length ? `<ul class="list">${p.offspring.map(o => `<li><span class="badge">الجيل ${o.generation}</span><a class="grow t" href="#/camel/${o.id}">${esc(o.name)}</a><span class="small muted">${SEX_CALF[o.sex]} • ${fmtDate(o.birth_date)}</span></li>`).join('')}</ul>` : '<p class="muted">لا يوجد نسل مسجل.</p>'}</section>`;
    } else if (tab === 'media') {
      body.innerHTML = `<section class="card"><div class="card-h"><h3>الصور</h3><label class="btn sm" style="cursor:pointer">${I.image} رفع صورة<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-upload="photo" data-camel="${c.id}"></label></div>
        ${c.photos.length ? `<div class="camel-grid">${c.photos.map(p => `<div class="camel-card"><div class="ph"><img src="/api/media/${p.id}" alt="${esc(p.caption || c.name)}" loading="lazy">${p.is_primary ? '<span class="badge gold sex">الرئيسية</span>' : ''}</div><div class="body row" style="justify-content:space-between"><span class="small muted">${esc(p.caption || fmtDT(p.created_at))}</span><button class="icon-btn" aria-label="حذف" data-act="delete-media" data-media="${p.id}">${I.trash}</button></div></div>`).join('')}</div>` : '<p class="muted">لا توجد صور.</p>'}
        <p class="small muted" style="margin-top:10px">الحد الأقصى 5 ميغابايت. تُصغّر الصور تلقائياً قبل الرفع. لا تُستخدم صورك لتدريب نماذج الذكاء الاصطناعي إلا بموافقتك الصريحة.</p></section>
        <section class="card"><div class="card-h"><h3>الفحوص والمستندات</h3><label class="btn sm ghost" style="cursor:pointer">${I.plus} رفع مستند (PDF/صورة)<input type="file" accept="application/pdf,image/jpeg,image/png" hidden data-upload="document" data-camel="${c.id}"></label></div>
        ${c.documents.length ? `<ul class="list">${c.documents.map(d => `<li>${I.lock}<a class="grow" href="/api/media/${d.id}" target="_blank" rel="noopener">${esc(d.caption || 'مستند')} <span class="small muted">${fmtDT(d.created_at)}</span></a><button class="icon-btn" aria-label="حذف" data-act="delete-media" data-media="${d.id}">${I.trash}</button></li>`).join('')}</ul>` : '<p class="muted">لا توجد مستندات. يمكنك رفع شهادات الفحص أو الملكية (تبقى خاصة بك).</p>'}</section>`;
    } else if (tab === 'history') {
      const { history } = await api('GET', `/api/camels/${c.id}/history`);
      body.innerHTML = `<section class="card"><h3>سجل التعديلات</h3><p class="small muted">كل تغيير على هذه المطية محفوظ بتاريخه ولا يمكن تعديله.</p>
        ${history.length ? `<ul class="list">${history.map(h => `<li>${I.history}<div class="grow"><div class="t small">${ACTION_AR[h.action] || h.action} ${ENTITY_AR[h.entity] || h.entity}</div>
          ${h.diff && h.action === 'update' ? `<div class="small muted">${Object.entries(h.diff).filter(([k]) => FIELD_AR[k]).map(([k, [a, b]]) => `${FIELD_AR[k]}: ${esc(a ?? '—')} ← ${esc(b ?? '—')}`).join(' • ')}</div>` : ''}</div><span class="small muted nowrap">${fmtDT(h.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">لا يوجد سجل.</p>'}</section>`;
    } else if (tab === 'share') {
      const { shares } = await api('GET', `/api/camels/${c.id}/shares`);
      const SC = { basic: 'أساسي', pedigree: 'مع النسب', full: 'كامل' };
      body.innerHTML = `<section class="card"><div class="card-h"><h3>روابط المشاركة</h3><button class="btn sm" data-act="share" data-camel="${c.id}">${I.share} رابط جديد</button></div>
        <p class="small muted">شارك ملف المطية برابط محدود الصلاحية والمدة. لا يظهر في الرابط اسمك أو موقع عزبتك أو ملاحظاتك الخاصة أو المستندات.</p>
        ${shares.length ? `<ul class="list">${shares.map(s => { const dead = s.revoked_at || s.expires_at < new Date().toISOString(); return `<li><span class="badge ${dead ? 'red' : 'green'}">${s.revoked_at ? 'ملغى' : dead ? 'منتهي' : 'فعال'}</span><div class="grow small">نطاق: ${SC[s.scope]} • ينتهي ${fmtDT(s.expires_at)} • ${s.view_count} مشاهدة</div>${!dead ? `<button class="btn danger sm" data-act="revoke" data-share="${s.id}" data-camel="${c.id}">إلغاء</button>` : ''}</li>`; }).join('')}</ul>` : '<p class="muted">لا توجد روابط.</p>'}</section>`;
    }
  }

  function timelineItems(c) {
    const items = [];
    c.matings.forEach(m => items.push([m.mating_date, `<div class="tl-item mating"><div class="when">${fmtDate(m.mating_date)}</div><div><b>تلقيح</b> من ${esc(m.sire_name || m.sire_name_text || '—')} <span class="badge">${OUTCOME[m.outcome]}</span></div></div>`]));
    c.births.forEach(b => items.push([b.birth_date, `<div class="tl-item birth"><div class="when">${fmtDate(b.birth_date)}</div><div><b>ولادة</b> ${b.calf_name ? '— ' + esc(b.calf_name) : ''} ${b.calf_sex ? `<span class="badge">${SEX_CALF[b.calf_sex]}</span>` : ''}</div></div>`]));
    c.events.forEach(e => items.push([e.event_date, `<div class="tl-item"><div class="when">${fmtDate(e.event_date)}</div><div><b>${EVENT[e.type]}</b> — ${esc(e.title)}</div></div>`]));
    return items.sort((a, b) => b[0].localeCompare(a[0])).map(x => x[1]);
  }

  // ===================== نوافذ التسجيل =====================
  async function camelOptions(sex, sel) {
    const { camels } = await api('GET', '/api/camels?sex=' + sex);
    return camels.filter(c => !['sold', 'dead', 'transferred'].includes(c.status)).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.tag_number ? ' (' + esc(c.tag_number) + ')' : ''}</option>`).join('');
  }
  async function matingModal(damId) {
    const [dams, sires] = await Promise.all([camelOptions('female', damId), camelOptions('male')]);
    modal('تسجيل تلقيح', `<div class="stack">
      <div class="field"><label>الناقة *</label><select class="input" name="dam_id" required>${dams}</select></div>
      <div class="field"><label>الفحل من حلالي</label><select class="input" name="sire_id"><option value="">— فحل من خارج حلالي —</option>${sires}</select></div>
      <div class="field"><label>أو اسم الفحل الخارجي</label><input class="input" name="sire_name_text" placeholder="مثال: صقر (عزبة أبو سالم)"></div>
      <div class="field"><label>تاريخ التلقيح *</label><input class="input" type="date" name="mating_date" value="${today()}" max="${today()}"></div>
      <div class="field"><label>ملاحظات</label><input class="input" name="notes"></div>
      <div class="notice gold small">سيُحسب موعد الولادة التقديري تلقائياً (${state.user.gestation_days} يوماً) مع تنبيه قبله بـ ${state.user.birth_alert_days} يوماً. الموعد تقديري ولا يغني عن المتابعة البيطرية.</div></div>`,
    async d => { const r = await api('POST', '/api/matings', d); toast(`تم التسجيل — الولادة المتوقعة ${fmtDate(r.mating.expected_birth_date)}`); render(); });
  }
  async function birthModal(damId) {
    const dams = await camelOptions('female', damId);
    modal('تسجيل ولادة', `<div class="stack">
      <div class="field"><label>الأم *</label><select class="input" name="dam_id">${dams}</select></div>
      <div class="field"><label>تاريخ الولادة *</label><input class="input" type="date" name="birth_date" value="${today()}" max="${today()}"></div>
      <div class="field"><label>النتيجة</label><select class="input" name="outcome"><option value="live">مولود حي</option><option value="stillborn">نفوق المولود</option></select></div>
      <div class="field"><label>جنس المولود</label><div class="row"><label class="check"><input type="radio" name="calf_sex" value="female" checked> بكرة</label><label class="check"><input type="radio" name="calf_sex" value="male"> قعود</label></div></div>
      <div class="field"><label>اسم المولود</label><input class="input" name="calf_name" placeholder="يمكن تحديده لاحقاً"></div>
      <div class="field"><label>رقم وسم المولود</label><input class="input" name="calf_tag"></div>
      <div class="notice info small">سيُنشأ ملف للمولود تلقائياً ويُربط بأمه وبالفحل من آخر تلقيح مسجل.</div></div>`,
    async d => { const r = await api('POST', '/api/births', d); toast('تم تسجيل الولادة — مبروك ما جاكم'); if (r.calf) go('/camel/' + r.calf.id); else render(); });
  }
  function eventModal(camelId) {
    const m = modal('إضافة سجل', `<div class="stack">
      <div class="field"><label>النوع *</label><select class="input" name="type">${Object.entries(EVENT).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label>العنوان *</label><input class="input" name="title" required placeholder="مثال: تحصين الحمى القلاعية"></div>
      <div class="field"><label>التاريخ</label><input class="input" type="date" name="event_date" value="${today()}"></div>
      <div class="field"><label>موعد المتابعة القادم</label><input class="input" type="date" name="next_due_date"><span class="hint">سيظهر في التقويم والتنبيهات</span></div>
      <div class="field"><label>الطبيب / الطرف الآخر</label><input class="input" name="counterparty"></div>
      <div class="field" data-amount hidden><label>المبلغ</label><div class="row"><input class="input" name="amount" type="number" min="0" step="any" style="flex:1"><select class="input" name="currency" style="width:auto">${['QAR', 'SAR', 'AED', 'KWD', 'BHD', 'OMR'].map(c => `<option>${c}</option>`).join('')}</select></div></div>
      <div class="field"><label>تفاصيل</label><textarea class="input" name="details"></textarea></div>
      <div class="notice gold small" data-sale hidden>تسجيل البيع أو النقل يغيّر حالة المطية إلى «مباعة/منقولة» ويخرجها من الحلال النشط.</div></div>`,
    async d => { await api('POST', `/api/camels/${camelId}/events`, d); toast('تم الحفظ'); render(); });
    const sel = m.form.type;
    const upd = () => { const v = sel.value; m.form.querySelector('[data-amount]').hidden = !['sale', 'purchase', 'treatment', 'vet_visit'].includes(v); m.form.querySelector('[data-sale]').hidden = !['sale', 'transfer'].includes(v); };
    sel.addEventListener('change', upd);
  }
  function shareModal(camelId) {
    modal('رابط مشاركة محدود', `<div class="stack">
      <div class="field"><label>ما الذي يظهر؟</label><select class="input" name="scope"><option value="basic">أساسي: الاسم والفئة واللون والعمر والصور</option><option value="pedigree">مع شجرة النسب والمواليد</option><option value="full">كامل: مع الولادات والتحصينات والإنجازات</option></select></div>
      <div class="field"><label>مدة الصلاحية</label><select class="input" name="days"><option value="1">يوم واحد</option><option value="7" selected>7 أيام</option><option value="30">30 يوماً</option><option value="90">90 يوماً</option></select></div>
      <div class="notice info small">لا يظهر أبداً: اسمك، موقع العزبة، الملاحظات الخاصة، المبالغ، المستندات. يمكنك إلغاء الرابط في أي وقت.</div></div>`,
    async d => {
      const r = await api('POST', `/api/camels/${camelId}/shares`, d);
      const url = location.origin + r.url;
      const m = modal('تم إنشاء الرابط', `<p>انسخ الرابط وأرسله لمن تريد. <b>لن يظهر مرة أخرى.</b></p><input class="input" dir="ltr" readonly value="${esc(url)}" id="shareUrl"><div class="mf"><button type="button" class="btn" id="copyShare">نسخ</button><button type="button" class="btn ghost" data-close>إغلاق</button></div>`);
      m.el.querySelector('#copyShare').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('تم النسخ'); } catch { m.el.querySelector('#shareUrl').select(); } };
      if (location.hash.endsWith('/share')) render();
    });
  }

  // ضغط الصورة في المتصفح قبل الرفع
  function readFile(file, compress) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('تعذر قراءة الملف'));
      fr.onload = () => {
        if (!compress || !file.type.startsWith('image/')) return res(fr.result);
        const img = new Image();
        img.onload = () => {
          const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', .86));
        };
        img.onerror = () => rej(new Error('صورة غير صالحة'));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ===================== معالجة الأحداث العامة =====================
  document.addEventListener('click', async e => {
    const ag = e.target.closest('[data-age]'); if (ag) herdFilter = { q: '', sex: '', status: '', age: ag.dataset.age };
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const a = el.dataset.act;
    try {
      if (a === 'mating') await matingModal(el.dataset.dam);
      else if (a === 'birth') await birthModal(el.dataset.dam);
      else if (a === 'event') eventModal(el.dataset.camel);
      else if (a === 'share') shareModal(el.dataset.camel);
      else if (a === 'delete-camel') { if (await confirmBox(`حذف «${el.dataset.name}» نهائياً مع كل سجلاتها؟ لا يمكن التراجع.`)) { await api('DELETE', '/api/camels/' + el.dataset.camel); toast('تم الحذف'); go('/herd'); } }
      else if (a === 'delete-mating') { if (await confirmBox('حذف سجل التلقيح؟')) { await api('DELETE', '/api/matings/' + el.dataset.mating); toast('تم الحذف'); render(); } }
      else if (a === 'delete-event') { if (await confirmBox('حذف هذا السجل؟')) { await api('DELETE', '/api/events/' + el.dataset.event); toast('تم الحذف'); render(); } }
      else if (a === 'delete-media') { if (await confirmBox('حذف الملف نهائياً؟')) { await api('DELETE', '/api/media/' + el.dataset.media); toast('تم الحذف'); render(); } }
      else if (a === 'revoke') { await api('DELETE', '/api/shares/' + el.dataset.share); toast('تم إلغاء الرابط'); render(); }
      else if (a === 'logout') { await api('POST', '/api/auth/logout'); state.user = null; if (state.es) state.es.close(); go('/market'); }
    } catch (err) { fail(err); }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    try {
      if (el.dataset.act === 'outcome') { await api('PATCH', '/api/matings/' + el.dataset.mating, { outcome: el.value }); toast('تم تحديث النتيجة'); render(); }
      if (el.dataset.upload) {
        const f = el.files[0]; if (!f) return;
        toast('جارٍ الرفع…');
        const data = await readFile(f, el.dataset.upload === 'photo');
        const r = await api('POST', `/api/camels/${el.dataset.camel}/media`, { data_base64: data, kind: el.dataset.upload, caption: f.name.slice(0, 80) });
        if (r.duplicate_in_my_herd.length) toast(`تنبيه: هذه الصورة مرفوعة مسبقاً لـ ${r.duplicate_in_my_herd.map(d => d.name).join('، ')}`, true);
        else if (r.duplicate_elsewhere) toast('تنبيه: صورة مطابقة موجودة في حساب آخر على المنصة — ستُراجع عند نشر الإعلانات', true);
        else toast('تم الرفع');
        render();
      }
    } catch (err) { fail(err); }
  });

  // ===================== التقويم =====================
  async function viewCalendar(month) {
    const base = month && /^\d{4}-\d{2}$/.test(month) ? month : today().slice(0, 7);
    const [y, m] = base.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const startDow = (first.getUTCDay() + 1) % 7; // الأسبوع يبدأ السبت
    const gridStart = new Date(first.getTime() - startDow * 86400000).toISOString().slice(0, 10);
    const gridEnd = new Date(first.getTime() + (41 - startDow) * 86400000).toISOString().slice(0, 10);
    shell('calendar', 'التقويم', loading());
    const cal = await api('GET', `/api/calendar?from=${gridStart}&to=${gridEnd}`);
    const by = {}; cal.items.forEach(i => (by[i.date] = by[i.date] || []).push(i));
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    const monthName = first.toLocaleDateString('ar-QA-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(new Date(gridStart + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10);
      const evs = by[d] || [];
      cells += `<div class="day ${d.slice(0, 7) !== base ? 'out' : ''} ${d === today() ? 'today' : ''}"><div class="num">${Number(d.slice(8))}</div>${evs.slice(0, 3).map(ev => `<a class="ev ${ev.kind}" href="#/camel/${ev.camel_id}" title="${esc(ev.title + ' ' + ev.sub)}">${esc(ev.title.split(': ').pop())}</a>`).join('')}${evs.length > 3 ? `<span class="small muted">+${evs.length - 3}</span>` : ''}</div>`;
    }
    const monthItems = cal.items.filter(i => i.date.startsWith(base));
    document.getElementById('page').innerHTML = `
      <div class="card-h"><h1 style="margin:0">التقويم والمواعيد</h1>
        <div class="row"><a class="btn ghost sm" href="#/calendar/${prev}" aria-label="الشهر السابق">›</a><b style="min-width:130px;text-align:center">${monthName}</b><a class="btn ghost sm" href="#/calendar/${next}" aria-label="الشهر التالي">‹</a><a class="btn ghost sm" href="#/calendar">اليوم</a></div></div>
      <div class="legend" style="margin-bottom:10px"><span class="l1">ولادة متوقعة (تقديري)</span><span class="l2">ولادة فعلية</span><span class="l3">تلقيح</span><span class="l4">متابعة صحية</span></div>
      <div class="card" style="padding:12px"><div class="cal">${['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div></div>
      <section class="card"><h3>مواعيد ${monthName}</h3>${monthItems.length ? `<ul class="list">${monthItems.map(i => `<li><span class="badge ${i.kind === 'expected_birth' ? 'gold' : i.kind === 'mating' ? 'green' : ''}">${{ expected_birth: 'ولادة متوقعة', birth: 'ولادة', mating: 'تلقيح', follow_up: 'متابعة' }[i.kind]}</span><a class="grow" href="#/camel/${i.camel_id}">${esc(i.title)} <span class="small muted">${esc(i.sub)}</span></a><span class="small nowrap">${fmtDate(i.date)}</span></li>`).join('')}</ul>` : '<p class="muted">لا توجد مواعيد هذا الشهر.</p>'}
      <div class="notice gold small" style="margin-top:10px">${esc(cal.notice)}</div></section>`;
  }

  // ===================== المساعد الذكي =====================
  async function viewAssistant() {
    shell('assistant', 'المساعد الذكي', `
      <div class="chat">
        <div class="chat-head"><div class="ai-ico">${I.ai}</div><div class="grow"><b>مساعد وسم — WASM AI</b><div class="small muted">يفهم لهجتك • يسجل بعد تأكيدك • لا يخترع بيانات</div></div><button class="btn ghost sm" id="clearChat">مسح المحادثة</button></div>
        <div class="msgs" id="msgs">${loading()}</div>
        <form class="composer" id="composer"><input class="input" id="msgIn" placeholder="اكتب… مثال: لقحت وضحى اليوم من شاهين" autocomplete="off" maxlength="1000" aria-label="رسالة"><button class="btn gold" type="submit" aria-label="إرسال">${I.send}</button></form>
      </div>
      <p class="small muted" style="margin-top:8px">📋 = من سجلاتك • 🔮 = تقديري • ✍️ = مسودة من المساعد. المساعد لا ينفذ أي عملية مالية أو مزايدة، ولا يقدم تشخيصاً بيطرياً.</p>`);
    const box = document.getElementById('msgs');
    const { messages } = await api('GET', '/api/ai/messages');
    box.innerHTML = '';
    if (!messages.length) appendMsg({ role: 'assistant', content: 'هلا والله! أنا مساعد وسم 🐪\nأقدر أسجل لك التلقيح والولادة، وأجاوبك عن مواعيد الولادة وسجلات نوقك.', options: ['لقحت وضحى اليوم من شاهين', 'أي النوق عندي بتولد الشهر القادم؟', 'كم عندي حيران؟', 'أبي أبيع الشعلة'].map(x => ({ label: x, value: x })) });
    messages.forEach(appendMsg);
    const form = document.getElementById('composer'), input = document.getElementById('msgIn');
    const send = async (text, shown) => {
      appendMsg({ role: 'user', content: shown || text });
      const typing = document.createElement('div'); typing.className = 'msg assistant'; typing.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>'; box.appendChild(typing); box.scrollTop = box.scrollHeight;
      try { const r = await api('POST', '/api/ai/messages', { text }); typing.remove(); appendMsg({ role: 'assistant', content: r.reply, cards: r.cards, action: r.action, options: r.options, source: r.source }); }
      catch (e) { typing.remove(); appendMsg({ role: 'assistant', content: '⚠️ ' + e.message }); }
    };
    form.addEventListener('submit', e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; send(t); });
    box.addEventListener('click', async e => {
      const chip = e.target.closest('[data-chip]');
      if (chip) return send(chip.dataset.chip, chip.textContent);
      const act = e.target.closest('[data-ai]');
      if (!act) return;
      const card = act.closest('.action-card');
      card.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        if (act.dataset.ai === 'confirm') { const r = await api('POST', `/api/ai/actions/${act.dataset.id}/confirm`); card.querySelector('.st').innerHTML = '<span class="badge green">تم الحفظ ✓</span>'; appendMsg({ role: 'assistant', content: r.reply, source: 'records' }); }
        else { await api('POST', `/api/ai/actions/${act.dataset.id}/cancel`); card.querySelector('.st').innerHTML = '<span class="badge">ملغى</span>'; }
      } catch (err) { fail(err); card.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
    });
    document.getElementById('clearChat').onclick = async () => { await api('DELETE', '/api/ai/messages'); viewAssistant(); };
    input.focus();
  }

  function appendMsg(m) {
    const box = document.getElementById('msgs'); if (!box) return;
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    let html = esc(m.content);
    if (m.source === 'ai_draft') html += '<span class="src badge outline">مسودة من المساعد — راجعها</span>';
    if (m.source === 'ai') html += '<span class="src badge outline">إجابة من نموذج الذكاء الاصطناعي</span>';
    (m.cards || []).forEach(c => {
      if (c.type === 'camel_link') html += `<div class="chips"><a class="chip" href="#/camel/${esc(c.id)}">${I.camel} فتح ملف ${esc(c.name || '')}</a></div>`;
      if (c.type === 'camels') html += `<div class="chips">${c.items.map(x => `<a class="chip" href="#/camel/${esc(x.id)}">${esc(x.name)}${x.tag_number ? ' (' + esc(x.tag_number) + ')' : ''}</a>`).join('')}</div>`;
      if (c.type === 'link') html += `<div class="chips"><a class="chip" href="${esc(c.href)}">${esc(c.label)}</a></div>`;
      if (c.type === 'due') html += `<div class="chips"><a class="chip" href="#/calendar">${I.calendar} عرض في التقويم</a></div>`;
    });
    if (m.action) {
      const st = m.action.status;
      html += `<div class="action-card"><b>${esc(m.action.summary)}</b><dl class="kv">${m.action.fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="st">${st === 'pending' ? `<div class="row"><button class="btn sm" data-ai="confirm" data-id="${esc(m.action.id)}">${I.check} تأكيد وحفظ</button><button class="btn ghost sm" data-ai="cancel" data-id="${esc(m.action.id)}">إلغاء</button></div>`
        : `<span class="badge ${st === 'confirmed' ? 'green' : ''}">${{ confirmed: 'تم الحفظ ✓', cancelled: 'ملغى', expired: 'انتهت الصلاحية' }[st]}</span>`}</div></div>`;
    }
    if (m.options && m.options.length) html += `<div class="chips">${m.options.map(o => `<button type="button" class="chip" data-chip="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
    div.innerHTML = html;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // ===================== العزب =====================
  async function viewFarms() {
    shell('farms', 'العزب', loading());
    const { farms } = await api('GET', '/api/farms');
    document.getElementById('page').innerHTML = `<div class="card-h"><div><h1 style="margin:0">العزب</h1><p class="muted" style="margin:0">نظّم حلالك حسب العزبة أو الموقع</p></div><button class="btn gold" id="addFarm">${I.plus} عزبة جديدة</button></div>
      <div class="grid g3">${farms.map(f => `<div class="card"><div class="row">${I.tent}<h3 style="margin:0">${esc(f.name)}</h3></div><p class="muted small">${esc(f.area_text || '')} • ${esc((state.countries.find(c => c.code === f.country_code) || {}).name_ar || f.country_code)}</p><span class="badge green">${f.camels} مطية</span></div>`).join('') || emptyState('لا توجد عزب بعد.')}</div>
      <div class="notice info small" style="margin-top:14px">إدارة العمال والمصاريف ومخزون الأعلاف للعزبة ستأتي في مرحلة لاحقة. لا نحفظ إحداثيات دقيقة لمواقع العزب حمايةً لخصوصيتك.</div>`;
    if (!state.countries.length) state.countries = (await api('GET', '/api/countries')).countries;
    document.getElementById('addFarm').onclick = () => modal('عزبة جديدة', `<div class="stack"><div class="field"><label>الاسم *</label><input class="input" name="name" required></div>
      <div class="field"><label>الدولة</label><select class="input" name="country_code">${state.countries.map(c => `<option value="${c.code}" ${c.code === state.user.country_code ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('')}</select></div>
      <div class="field"><label>المنطقة (وصف عام)</label><input class="input" name="area_text" placeholder="مثال: الشحانية"></div></div>`, async d => { await api('POST', '/api/farms', d); toast('تمت الإضافة'); render(); });
  }

  // ===================== الحساب =====================
  async function viewAccount() {
    if (!state.countries.length) state.countries = (await api('GET', '/api/countries')).countries;
    const u = state.user;
    const ROLE = { user: 'مستخدم عادي', owner: 'مالك حلال', trader: 'تاجر', broker: 'وسيط', company: 'شركة', provider: 'طبيب أو مقدم خدمة', country_admin: 'مدير دولة', super_admin: 'مدير عام' };
    shell('account', 'حسابي', `<h1>حسابي والخصوصية</h1>
      <div class="grid g2">
        <form class="card stack" id="profileForm"><h3>البيانات الشخصية</h3>
          <div class="field"><label>الاسم</label><input class="input" name="display_name" value="${esc(u.display_name)}"></div>
          <div class="field"><label>البريد</label><input class="input" value="${esc(u.email)}" disabled dir="ltr"></div>
          <div class="field"><label>الجوال</label><input class="input" name="phone" value="${esc(u.phone)}" dir="ltr"></div>
          <div class="field"><label>الدولة</label><select class="input" name="country_code">${state.countries.map(c => `<option value="${c.code}" ${c.code === u.country_code ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('')}</select></div>
          <div class="field"><label>نوع الحساب</label><input class="input" value="${ROLE[u.role]}" disabled></div>
          <h3 style="margin-top:10px">إعدادات الحلال</h3>
          <div class="field"><label>المدة من اللقاح إلى الولادة (يوم)</label><input class="input" type="number" name="gestation_days" min="330" max="420" value="${u.gestation_days}"><span class="hint">الافتراضي 390 يوماً تقريباً (نحو 13 شهراً). عدّلها حسب خبرتك أو توصية طبيبك.</span></div>
          <div class="field"><label>التنبيه قبل الولادة (يوم)</label><input class="input" type="number" name="birth_alert_days" min="1" max="60" value="${u.birth_alert_days}"></div>
          <button class="btn" type="submit">حفظ</button></form>
        <div>
          <form class="card stack" id="privacyForm"><h3>الخصوصية والموافقات</h3>
            <label class="check"><input type="checkbox" name="ai_image_training_consent" ${u.ai_image_training_consent ? 'checked' : ''}><span>أوافق على استخدام صوري لتحسين نماذج الذكاء الاصطناعي في وسم <span class="small muted">(اختياري — معطل افتراضياً)</span></span></label>
            <label class="check"><input type="checkbox" name="partner_data_sharing_consent" ${u.partner_data_sharing_consent ? 'checked' : ''}><span>أوافق على مشاركة بيانات التواصل مع شركاء وسم للعروض <span class="small muted">(اختياري — معطل افتراضياً)</span></span></label>
            <div class="notice info small">ملفات حلالك خاصة بك ولا يطلع عليها أي مستخدم أو شركة إلا عبر رابط مشاركة تنشئه أنت.</div>
            <div class="row"><button class="btn" type="submit">حفظ الموافقات</button><a class="btn ghost" href="/api/me/export" download>تصدير بياناتي (JSON)</a></div></form>
          <form class="card stack" id="pwForm"><h3>تغيير كلمة المرور</h3>
            <div class="field"><label>الحالية</label><input class="input" type="password" name="current_password" autocomplete="current-password" dir="ltr"></div>
            <div class="field"><label>الجديدة</label><input class="input" type="password" name="new_password" autocomplete="new-password" dir="ltr"><span class="hint">سيتم تسجيل خروجك من الأجهزة الأخرى</span></div>
            <button class="btn" type="submit">تغيير</button></form>
          <div class="card stack" id="refCard"><h3>الإحالة وأكواد الخصم</h3><p class="small muted">شارك رابطك مع أهل الإبل، واستخدم أكواد خصم شركاء وسم.</p><div class="row"><button type="button" class="btn ghost sm" id="myRef">رابط الإحالة الخاص بي</button><button type="button" class="btn ghost sm" id="redeem">استخدام كود خصم</button><a class="btn ghost sm" href="#/brokers">ملف الوسيط</a></div></div>
          <div class="card"><button class="btn danger" data-act="logout">${I.logout} تسجيل الخروج</button></div>
        </div></div>`);
    const bind = (id, fn) => document.getElementById(id).addEventListener('submit', async e => { e.preventDefault(); try { await fn(formData(e.target)); } catch (err) { fail(err); } });
    document.getElementById('myRef').onclick = async () => { const r = await api('GET', '/api/referral'); const url = `${location.origin}/?ref=${r.code}#/register`; modal('رابط الإحالة', `<p>انضم عن طريقك: <b>${r.count}</b></p><input class="input" dir="ltr" readonly value="${esc(url)}">`); };
    document.getElementById('redeem').onclick = () => modal('كود خصم', '<div class="field"><label>الكود</label><input class="input" name="code" dir="ltr" required></div>', async d => { const r = await api('POST', '/api/codes/redeem', d); modal('تم ✓', `<p><b>${esc(r.company)}</b>${r.percent ? ` — خصم ${r.percent}%` : ''}</p><p class="small">${esc(r.description || '')}</p><div class="notice info small">${esc(r.notice)}</div>`); });
    bind('profileForm', async d => { state.user = (await api('PATCH', '/api/me', d)).user; toast('تم الحفظ'); });
    bind('privacyForm', async d => { state.user = (await api('PATCH', '/api/me', d)).user; toast('تم حفظ الموافقات'); });
    bind('pwForm', async d => { await api('POST', '/api/me/password', d); toast('تم تغيير كلمة المرور'); document.getElementById('pwForm').reset(); });
  }

  // ===================== الأقسام القادمة =====================
  const SOON = {
    market: ['سوق الإبل', I.market, 2, ['إعلانات بيع وشراء: مغاتير، مجاهيم، أصايل وغيرها', 'فلاتر بالدولة والسعر والنوع والعمر والجنس', 'المفضلة، الإبلاغ، والمشاركة', 'التفاوض وإرسال العروض', 'نشر إعلان مباشرة من ملف المطية', 'تحليل الصور واكتشاف المكرر']],
    auctions: ['المزادات الإلكترونية', I.gavel, 3, ['مزايدة مباشرة تُعالج على الخادم فقط', 'سجل مزايدات غير قابل للتعديل', 'تمديد تلقائي ضد القنص في الثواني الأخيرة', 'إشعارات تجاوز المزايدة وقرب الانتهاء', 'رصد أنماط المزايدة غير المعتادة للمراجعة البشرية']],
    sires: ['الأفحل', I.star, 2, ['دليل الفحول المتاحة للتلقيح', 'سجل نسل كل فحل من بيانات الملاك (بموافقتهم)', 'حجز موعد تلقيح']],
    mazayin: ['المزاين والنتائج', I.trophy, 3, ['جدول المهرجانات في دول الخليج', 'النتائج والمراكز', 'ربط الإنجازات بملف المطية']],
    vet: ['الخدمات البيطرية', I.vet, 3, ['دليل العيادات والأطباء حسب الدولة', 'حجز الزيارات', 'ربط تقارير الزيارة بملف المطية (بموافقة المالك)']],
    feed: ['الأعلاف والمستلزمات', I.feed, 3, ['متاجر شركاء وسم', 'عروض وأكواد خصم', 'طلب وتوصيل']],
    transport: ['نقل الإبل', I.truck, 3, ['ناقلون معتمدون داخل الدولة وبين دول الخليج', 'طلب عرض سعر', 'تتبع الشحنة']],
    brokers: ['الوسطاء', I.handshake, 3, ['ملفات وسطاء موثقين', 'عمولات واضحة', 'تقييمات']],
    community: ['مجتمع أهل الإبل', I.users, 4, ['منشورات ونقاشات', 'أسئلة وأجوبة الخبرة', 'إشراف ومراجعة']],
  };
  function viewSoon(k) {
    const s = SOON[k]; if (!s) return go('/');
    shell(k, s[0], `<div class="card soon-hero"><div class="big">${s[1]}</div><h1>${s[0]}</h1><span class="badge gold">المرحلة ${s[2]}</span>
      <p class="muted" style="max-width:520px;margin:12px auto">هذا القسم مخطط له ضمن المرحلة ${s[2]}. البنية الحالية (الحسابات، الصلاحيات، ملفات الإبل، سجل التدقيق، والمساعد) مصممة لتُبنى عليها هذه الميزات دون إعادة بناء النظام.</p>
      <div class="phase-list">${s[3].map(f => `<div class="notice info">${I.check}<span>${f}</span></div>`).join('')}</div></div>`);
  }
  function viewMore() {
    shell('more', 'المزيد', `<h1>المزيد</h1>${NAV.filter(g => state.user || !g.auth).concat(state.user && ['super_admin', 'country_admin'].includes(state.user.role) ? [ADMIN_NAV] : []).map(g => `<h3 style="margin-top:16px">${g.group}</h3><div class="card" style="padding:6px 14px"><ul class="list">${g.items.map(i => `<li>${i.icon}<a class="grow t" href="#${i.path}">${i.label}</a>${i.soon ? `<span class="badge">${i.soon}</span>` : ''}</li>`).join('')}</ul></div>`).join('')}`);
  }

  // ===================== صفحة المشاركة العامة =====================
  async function viewShared(token) {
    app.innerHTML = `<div class="page" style="margin:0 auto">${loading()}</div>`;
    try {
      const d = await api('GET', '/api/public/share/' + encodeURIComponent(token));
      const c = d.camel;
      const pn = n => n ? `<div class="pnode ${n.sex === 'female' ? 'f' : 'm'} ${n.external ? 'ext' : ''}"><div class="n">${esc(n.name)}</div><div class="s">${n.external ? 'غير مسجل' : esc(n.breed || '')}</div></div>` : '<div class="pnode none"><div class="n">—</div></div>';
      app.innerHTML = `<header class="topbar"><a class="row" href="/"><img src="/img/logo.svg" alt="" style="width:36px"><b style="font-family:var(--font-display);font-size:1.3rem;color:var(--emerald-800)">وسم</b></a><div class="spacer"></div><span class="badge gold">ملف مُشارك • ينتهي ${fmtDT(d.expires_at)}</span></header>
        <main class="page" style="margin:0 auto;max-width:980px">
          <section class="profile-head"><div class="profile-photo">${d.photos[0] ? `<img src="/api/public/share/${encodeURIComponent(token)}/photo/${d.photos[0].id}" alt="">` : ''}</div>
          <div><h1>${esc(c.name)}</h1><div class="row"><span class="badge ${c.sex === 'female' ? 'gold' : 'green'}">${SEX[c.sex]}</span>${c.pedigree_verified ? '<span class="badge green">نسب موثق</span>' : '<span class="badge outline">نسب غير موثق</span>'}</div>
          <div class="facts"><div class="fact"><div class="k">الوسم</div><div class="v">${esc(c.tag_number || '—')}</div></div><div class="fact"><div class="k">الفئة</div><div class="v">${esc(c.breed || '—')}</div></div><div class="fact"><div class="k">اللون</div><div class="v">${esc(c.color || '—')}</div></div><div class="fact"><div class="k">تاريخ الميلاد</div><div class="v">${fmtDate(c.birth_date)}${c.birth_date_estimated ? ' (تقريبي)' : ''}</div></div></div></div></section>
          ${d.photos.length > 1 ? `<div class="camel-grid" style="margin-top:16px">${d.photos.slice(1).map(p => `<div class="camel-card"><div class="ph"><img src="/api/public/share/${encodeURIComponent(token)}/photo/${p.id}" alt=""></div></div>`).join('')}</div>` : ''}
          ${d.pedigree ? `<section class="card" style="margin-top:16px"><h3>النسب</h3><div class="ped" style="grid-template-columns:repeat(3,minmax(140px,1fr))"><div class="gen">${pn({ ...d.pedigree, external: false })}</div><div class="gen">${pn(d.pedigree.sire)}${pn(d.pedigree.dam)}</div><div class="gen">${[d.pedigree.sire?.sire, d.pedigree.sire?.dam, d.pedigree.dam?.sire, d.pedigree.dam?.dam].map(pn).join('')}</div></div></section>` : ''}
          ${d.offspring && d.offspring.length ? `<section class="card"><h3>المواليد (${d.offspring.length})</h3><ul class="list">${d.offspring.map(o => `<li><span class="badge">${SEX_CALF[o.sex]}</span><span class="grow">${esc(o.name)}</span><span class="small muted">${fmtDate(o.birth_date)}</span></li>`).join('')}</ul></section>` : ''}
          ${d.events && d.events.length ? `<section class="card"><h3>السجلات</h3><ul class="list">${d.events.map(e => `<li><span class="badge">${EVENT[e.type]}</span><span class="grow">${esc(e.title)}</span><span class="small muted">${fmtDate(e.event_date)}</span></li>`).join('')}</ul></section>` : ''}
          <div class="notice gold" style="margin-top:16px">${esc(d.notice)}</div>
        </main>`;
    } catch (e) {
      app.innerHTML = `<main class="page" style="margin:0 auto;max-width:600px">${emptyState(esc(e.message), '<a class="btn" href="/">الذهاب إلى وسم</a>')}</main>`;
    }
  }

  Object.assign(W, { api, esc, fmtDate, fmtDT, today, daysBetween, ageText, shell, modal, confirmBox, toast, fail, go, state, I, loading, emptyState, formData, readFile, render, refreshUnread, loadAges, SEX, SEX_CALF, STATUS, BREEDS, COLORS });
  window.addEventListener('load', () => render());
})();
